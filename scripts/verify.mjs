// Only include checks that do not require the author's prompt library or backups.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const evidence = fs.mkdtempSync(path.join(os.tmpdir(), "nai-source-tests-"));
const electron = require("electron");
const checks = ["prompt-chips", "seed", "personal-prompts", "v5", "release-check"];
const env = { ...process.env };
for (const key of ["ELECTRON_RUN_AS_NODE", "NAI_VERIFY_ASAR", "NAI_VERIFY_EXPECT_LEGACY", "NAI_VERIFY_RESTART_PROFILE", "NAI_VERIFY_REDUCED_MOTION"]) delete env[key];

for (const name of checks) {
  const directory = path.join(evidence, name);
  fs.mkdirSync(directory);
  console.log(`Checking ${name}...`);
  const log = [];
  const code = await new Promise((resolve, reject) => {
    const child = spawn(electron, [path.join(root, `scripts/verify-${name}.cjs`)], {
      cwd: root,
      env: { ...env, NAI_VERIFY_EVIDENCE: directory },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const timeout = setTimeout(() => { child.kill(); reject(new Error(`${name} timed out`)); }, 120000);
    child.stdout.on("data", chunk => log.push(chunk));
    child.stderr.on("data", chunk => log.push(chunk));
    child.once("error", error => { clearTimeout(timeout); reject(error); });
    child.once("exit", code => { clearTimeout(timeout); resolve(code); });
  }).catch(error => { console.error(error.message); return 1; });
  fs.writeFileSync(path.join(directory, "process.log"), Buffer.concat(log));
  if (code !== 0) {
    console.error(Buffer.concat(log).toString("utf8"));
    console.error(`Test evidence: ${directory}`);
    process.exit(1);
  }
  console.log(`${name}: passed`);
}
console.log(`${checks.length} checks passed. Test evidence: ${evidence}`);
