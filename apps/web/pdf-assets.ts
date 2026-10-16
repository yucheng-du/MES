import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { Plugin } from "vite";

// PDF.js imports these two JavaScript decoders by their stable filenames.
// Serving them locally lets strict CSP deployments render JBIG2/JPX without wasm-unsafe-eval.
export function pdfAssets(): Plugin {
  const directory = join(
    dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json")),
    "wasm",
  );
  const files = ["jbig2_nowasm_fallback.js", "openjpeg_nowasm_fallback.js"];
  const licenses = [
    "LICENSE_JBIG2",
    "LICENSE_OPENJPEG",
    "LICENSE_PDFJS_JBIG2",
    "LICENSE_PDFJS_OPENJPEG",
  ];
  const notices = async () => {
    const paths = [
      join(directory, "..", "LICENSE"),
      ...licenses.map((name) => join(directory, name)),
      join(directory, "..", "cmaps", "LICENSE"),
      join(directory, "..", "standard_fonts", "LICENSE_FOXIT"),
      join(directory, "..", "standard_fonts", "LICENSE_LIBERATION"),
    ];
    return (
      await Promise.all(
        paths.map(
          async (path) =>
            `\n\n${path.split("/").slice(-2).join("/")}\n${await readFile(path, "utf8")}`,
        ),
      )
    ).join("");
  };
  return {
    name: "mes-pdf-assets",
    configureServer(server) {
      server.middlewares.use("/pdf-assets", (request, response, next) => {
        const filename = (request.url ?? "").split("?")[0].replace(/^\//, "");
        if (!files.includes(filename)) {
          next();
          return;
        }
        void readFile(join(directory, filename))
          .then((data) => {
            response.setHeader(
              "Content-Type",
              "text/javascript; charset=utf-8",
            );
            response.setHeader("X-Content-Type-Options", "nosniff");
            response.end(data);
          })
          .catch(next);
      });
    },
    async generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "pdf-assets/THIRD-PARTY-NOTICES.txt",
        source: await notices(),
      });
      for (const filename of files)
        this.emitFile({
          type: "asset",
          fileName: `pdf-assets/${filename}`,
          source: await readFile(join(directory, filename)),
        });
    },
  };
}
