import { access, readFile } from "node:fs/promises";
import { spawn } from "node:child_process";

const required = [
  ".env.example", "README.md", "CHANGELOG.md", "docs/setup.md",
  "docs/operations/troubleshooting.md", "docs/release/known-limitations.md",
  "docs/release/checklist.md", "docs/security/threat-model.md",
];
for (const file of required) await access(file);

const manifest = JSON.parse(await readFile("package.json", "utf8"));
if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) throw new Error("Root version must use semantic versioning");
if (Number(process.versions.node.split(".")[0]) < 22) throw new Error("Node.js 22 or newer is required");

const child = spawn(process.execPath, ["--version"], { stdio: "ignore" });
const exitCode = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); });
if (exitCode !== 0) throw new Error("Child process startup/shutdown check failed");

process.stdout.write(`Release readiness passed for v${manifest.version}: required documentation, semantic version, runtime, startup, and clean shutdown verified.\n`);
