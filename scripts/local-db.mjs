import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const folder = `${root}.local/postgres`;
const port = process.env.LOCAL_PG_PORT ?? "55432";
const user = process.env.LOCAL_PG_USER ?? process.env.USER ?? "mes_dev";
const run = (program, args, allowFail = false) => {
  const result = spawnSync(program, args, { stdio: "inherit", cwd: root });
  if (!allowFail && result.status !== 0) process.exit(result.status ?? 1);
  return result.status;
};
mkdirSync(`${root}.local`, { recursive: true });
if (process.argv[2] === "stop") {
  if (existsSync(`${folder}/PG_VERSION`))
    run("pg_ctl", ["-D", folder, "-m", "fast", "stop"]);
  process.exit(0);
}
if (!existsSync(`${folder}/PG_VERSION`))
  run("initdb", [
    "-D",
    folder,
    "-U",
    user,
    "-A",
    "trust",
    "--encoding=UTF8",
    "--locale=C",
  ]);
const running =
  spawnSync("pg_ctl", ["-D", folder, "status"], { stdio: "ignore" }).status ===
  0;
if (!running)
  run("pg_ctl", [
    "-D",
    folder,
    "-l",
    `${root}.local/postgres.log`,
    "-o",
    `-p ${port} -h 127.0.0.1`,
    "start",
  ]);
for (const database of ["mes_next", "mes_next_test", "mes_equipment_parity_test"]) {
  const result = spawnSync(
    "psql",
    [
      "-h",
      "127.0.0.1",
      "-p",
      port,
      "-U",
      user,
      "-d",
      "postgres",
      "-tAc",
      `SELECT 1 FROM pg_database WHERE datname='${database}'`,
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    console.error(result.stderr);
    process.exit(1);
  }
  if (result.stdout.trim() !== "1")
    run("createdb", ["-h", "127.0.0.1", "-p", port, "-U", user, database]);
}
if (!existsSync(`${root}.env`))
  writeFileSync(
    `${root}.env`,
    `DATABASE_URL=postgres://${user}@127.0.0.1:${port}/mes_next\nTEST_DATABASE_URL=postgres://${user}@127.0.0.1:${port}/mes_next_test\nEQUIPMENT_TEST_DATABASE_URL=postgres://${user}@127.0.0.1:${port}/mes_equipment_parity_test\nAPP_ORIGIN=http://localhost:5173,http://127.0.0.1:5173\nPORT=4300\nHOST=127.0.0.1\nFACTORY_TIMEZONE=Asia/Shanghai\n`,
  );
console.log(
  `Local PostgreSQL ready on 127.0.0.1:${port}. Existing .env was preserved.`,
);
