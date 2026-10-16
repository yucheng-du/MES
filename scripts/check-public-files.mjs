import { execFileSync } from "node:child_process";

// Inspect the actual Git index, so ignored files and unstaged changes cannot
// accidentally make a release check appear safer than the committed content.
const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);
const forbiddenPaths = [
  /(^|\/)(?:\.local|node_modules|backups|playwright-report|test-results|\.gradle|build|dist)(?:\/|$)/,
  /(^|\/)\.env(?:$|\.(?!example$))/,
  /(?:local\.properties|\.(?:jks|keystore|pem|key|p12|apk|aab|dump|sqlite3?))$/i,
  /^apps\/android\/app\/libs\/.*\.(?:aar|jar)$/i,
  /^docs\/(?:IMPLEMENTATION|VALIDATION)\.md$/,
];
const contentRules = [
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  [
    "GitHub token",
    /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/,
  ],
  ["cloud access key", /\bAKIA[A-Z0-9]{16}\b/],
  ["personal absolute path", /(?:\/Users\/|\/home\/)[A-Za-z0-9._-]+\//],
];
const failures = [];
for (const file of files) {
  if (forbiddenPaths.some((pattern) => pattern.test(file)))
    failures.push(`${file}: private/generated file`);
  const data = execFileSync("git", ["show", `:${file}`], {
    maxBuffer: 16 * 1024 * 1024,
  });
  if (data.includes(0)) continue;
  const text = data.toString("utf8");
  for (const [name, pattern] of contentRules)
    if (pattern.test(text)) failures.push(`${file}: ${name}`);
}
if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else
  console.log(`Public-file check passed for ${files.length} indexed files.`);
