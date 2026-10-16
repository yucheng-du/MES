import { spawn } from "node:child_process";
const programs = [
  ["api", ["run", "dev", "-w", "@mes/api"]],
  ["web", ["run", "dev", "-w", "@mes/web"]],
];
const children = programs.map(([label, args]) => {
  const child = spawn(process.platform === "win32" ? "npm.cmd" : "npm", args, {
    stdio: "inherit",
    env: process.env,
    detached: process.platform !== "win32",
  });
  child.on("error", (error) => {
    console.error(`${label}: ${error.message}`);
    close(1);
  });
  child.on("exit", (code) => {
    if (code) close(code);
  });
  return child;
});
let stopping = false;
function close(code = 0) {
  if (stopping) return;
  stopping = true;
  children.forEach((child) => {
    if (!child.pid) return;
    try {
      if (process.platform === "win32") child.kill("SIGTERM");
      else process.kill(-child.pid, "SIGTERM");
    } catch (error) {
      if (error.code !== "ESRCH") console.error(error.message);
    }
  });
  setTimeout(() => process.exit(code), 400).unref();
}
process.on("SIGINT", () => close());
process.on("SIGTERM", () => close());
