import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.resolve(__dirname, "../bin/lifecycle-guard.mjs");

function runCli(args, cwd) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    encoding: "utf8"
  });
}

describe("lifecycle-guard CLI", () => {
  it("prints usage on --help and exits 0", () => {
    const res = runCli(["--help"]);
    assert.equal(res.status, 0);
    assert.match(res.stdout, /lifecycle-guard v1\.0\.0/);
    assert.match(res.stdout, /setup \[--detect\]/);
    assert.match(res.stdout, /policy check/);
    assert.match(res.stdout, /verify/);
  });

  it("detects stack and writes .pi/harness-bridge/policy.json on setup --detect", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lg-test-"));
    try {
      fs.writeFileSync(
        path.join(tmp, "package.json"),
        JSON.stringify({ name: "sample", scripts: { test: "node -e \"process.exit(0)\"" } }),
        "utf8"
      );
      fs.writeFileSync(path.join(tmp, "Cargo.toml"), "[package]\nname = \"sample\"\n", "utf8");

      const setupRes = runCli(["setup", "--detect", "--template", "agent-fleet"], tmp);
      assert.equal(setupRes.status, 0, setupRes.stderr);
      const parsed = JSON.parse(setupRes.stdout);
      assert.equal(parsed.ok, true);
      assert.ok(parsed.stacks.includes("node"));
      assert.ok(parsed.stacks.includes("rust"));
      assert.equal(parsed.template, "agent-fleet");

      const policyPath = path.join(tmp, ".pi", "harness-bridge", "policy.json");
      assert.equal(fs.existsSync(policyPath), true);

      const checkRes = runCli(["policy", "check", tmp], tmp);
      assert.equal(checkRes.status, 0, checkRes.stderr);
      assert.match(checkRes.stdout, /policy check ok/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("fails policy check on schema error or invisible unicode carrier", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lg-test-bad-"));
    try {
      const policyDir = path.join(tmp, ".pi", "harness-bridge");
      fs.mkdirSync(policyDir, { recursive: true });
      fs.writeFileSync(
        path.join(policyDir, "policy.json"),
        JSON.stringify({ version: 2, branchNameAction: "invalid-action" }),
        "utf8"
      );
      const badSchemaRes = runCli(["policy", "check", tmp], tmp);
      assert.equal(badSchemaRes.status, 1);
      assert.match(badSchemaRes.stderr, /schema error/);

      // Valid policy but invisible zero-width character in source file
      runCli(["setup", "--force"], tmp);
      fs.writeFileSync(path.join(tmp, "infected.js"), "const x = \"\u200B\";\n", "utf8");
      const badUnicodeRes = runCli(["policy", "check", tmp], tmp);
      assert.equal(badUnicodeRes.status, 1);
      assert.match(badUnicodeRes.stderr, /unicode error/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("runs configured verification gates via verify", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lg-test-verify-"));
    try {
      fs.writeFileSync(
        path.join(tmp, "package.json"),
        JSON.stringify({ name: "verify-sample", scripts: { test: "node -e \"process.exit(0)\"" } }),
        "utf8"
      );
      runCli(["setup", "--detect"], tmp);
      const verifyRes = runCli(["verify"], tmp);
      assert.equal(verifyRes.status, 0, verifyRes.stderr);
      assert.match(verifyRes.stdout, /1 gate\(s\) passed/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
