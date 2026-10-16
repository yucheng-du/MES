import { createReadStream } from "node:fs";
import { mkdir, stat, unlink, writeFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import multipart from "@fastify/multipart";
import type { FastifyInstance } from "fastify";
import type pg from "pg";
import { z } from "zod";
import { actor } from "./auth.js";
import { audit, ensure, id, one, transaction } from "./db.js";

const types: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};
export async function registerFiles(app: FastifyInstance, pool: pg.Pool) {
  const storage = resolve(
    process.env.FILE_STORAGE_DIR ??
      fileURLToPath(new URL("../../../.local/uploads/", import.meta.url)),
  );
  await mkdir(storage, { recursive: true, mode: 0o700 });
  await app.register(multipart, {
    limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 5, parts: 6 },
  });
  app.post("/api/files", async (req) => {
    const user = actor(req, "manager", "quality", "operator", "warehouse");
    const visibility = z.enum(["business", "personnel"]).parse((req.query as any).purpose ?? "business");
    ensure(visibility !== "personnel" || user.role === "admin", "人员档案附件仅管理员可上传", 403, "FORBIDDEN");
    const upload = await req.file();
    ensure(upload, "请选择附件", 400, "VALIDATION");
    const name = upload.filename
      .replace(/[\r\n/\\\x00-\x1f]/g, "_")
      .slice(0, 180);
    const ext = extname(name).toLowerCase();
    const mime = types[ext];
    ensure(
      mime,
      "支持 PDF、PNG、JPEG、WebP、TXT、CSV、XLSX、DOCX",
      400,
      "VALIDATION",
    );
    const buffer = await upload.toBuffer();
    ensure(buffer.length > 0, "附件不能为空", 400, "VALIDATION");
    if (ext === ".pdf")
      ensure(
        buffer.subarray(0, 5).toString() === "%PDF-",
        "文件不是有效 PDF",
        400,
        "VALIDATION",
      );
    if (ext === ".png")
      ensure(
        buffer
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
        "文件不是有效 PNG",
        400,
        "VALIDATION",
      );
    if (ext === ".jpg" || ext === ".jpeg")
      ensure(
        buffer[0] === 255 && buffer[1] === 216,
        "文件不是有效 JPEG",
        400,
        "VALIDATION",
      );
    const fileId = id();
    const path = resolve(storage, fileId);
    await writeFile(path, buffer, { flag: "wx", mode: 0o600 });
    try {
      await transaction(pool, async (db) => {
        await db.query(
          "INSERT INTO uploaded_files(id,name,mime,size,sha256,uploaded_by,visibility) VALUES($1,$2,$3,$4,$5,$6,$7)",
          [
            fileId,
            name,
            mime,
            buffer.length,
            createHash("sha256").update(buffer).digest("hex"),
            user.id,
            visibility,
          ],
        );
        await audit(db, user.id, "upload", "files", fileId, {
          name,
          size: buffer.length,
        });
      });
    } catch (error) {
      await unlink(path).catch(() => {});
      throw error;
    }
    return {
      id: fileId,
      name,
      size: buffer.length,
      mime,
      url: `/api/files/${fileId}`,
    };
  });
  app.get("/api/files/:id/info", async (req) => {
    const user = actor(req);
    const fileId = z
      .string()
      .uuid()
      .parse((req.params as { id: string }).id);
    const row = await one(
      pool,
      "SELECT id,name,mime,size,created_at,visibility,uploaded_by FROM uploaded_files WHERE id=$1",
      [fileId],
      "附件不存在",
    );
    ensure(row.visibility !== "personnel" || user.role === "admin" || row.uploaded_by === user.id, "无权读取人员档案附件", 403, "FORBIDDEN");
    return { id: row.id, name: row.name, mime: row.mime, size: row.size, created_at: row.created_at, url: `/api/files/${fileId}` };
  });
  app.get("/api/files/:id", async (req, reply) => {
    const user = actor(req);
    const fileId = z
      .string()
      .uuid()
      .parse((req.params as { id: string }).id);
    const row = await one(
      pool,
      "SELECT * FROM uploaded_files WHERE id=$1",
      [fileId],
      "附件不存在",
    );
    ensure(row.visibility !== "personnel" || user.role === "admin" || row.uploaded_by === user.id, "无权读取人员档案附件", 403, "FORBIDDEN");
    const path = resolve(storage, fileId);
    const exists = await stat(path).catch(() => null);
    ensure(exists?.isFile(), "附件存储暂不可用", 503, "STORAGE_UNAVAILABLE");
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Cache-Control", "private, no-store");
    reply.header(
      "Content-Disposition",
      `attachment; filename="document${extname(row.name)}"; filename*=UTF-8''${encodeURIComponent(row.name)}`,
    );
    reply.type(row.mime);
    return reply.send(createReadStream(path));
  });
}
