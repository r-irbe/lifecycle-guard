#!/usr/bin/env node
import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(__dirname, "..");

const VERSION = "1.0.0";

const DEFAULT_RULES = [
  {
    id: "no-force-push",
    scope: "destructive-git",
    tool: "bash",
    kind: "command",
    pattern: "\\bgit\\s+push\\b[^\\n]*(--force\\b|--force-with-lease\\b|\\s-f\\b)",
    action: "block",
    reason: "Force pushing rewrites shared history; open a new commit instead.",
    source: "deny-patterns:git-push-force"
  },
  {
    id: "no-history-rewrite",
    scope: "destructive-git",
    tool: "bash",
    kind: "command",
    pattern: "\\bgit\\s+(reset\\s+--hard|filter-branch|filter-repo|reflog\\s+expire|gc\\s+--prune=now)\\b",
    action: "block",
    reason: "History-rewriting commands discard recovery points.",
    source: "deny-patterns:git-reset-hard"
  },
  {
    id: "no-hook-bypass",
    scope: "verification",
    tool: "bash",
    kind: "command",
    pattern: "\\bgit\\s+(commit|push|merge)\\b[^\\n]*(--no-verify\\b|\\s-n\\b)",
    action: "block",
    reason: "Bypassing git hooks skips verification gates.",
    source: "deny-patterns:no-verify"
  }
];

function detectStack(cwd) {
  const stacks = [];
  const gates = [];
  const protectedPaths = [
    {
      id: "credentials",
      glob: "**/.env*",
      action: "block",
      reason: "Credential material must never be edited by an agent.",
      source: "secret-path"
    }
  ];

  const pkgPath = path.join(cwd, "package.json");
  if (fs.existsSync(pkgPath)) {
    stacks.push("node");
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
      if (pkg.scripts?.verify) gates.push("npm run verify");
      if (pkg.scripts?.["verify:fast"]) gates.push("npm run verify:fast");
      if (pkg.scripts?.["check:types"]) gates.push("npm run check:types");
      if (pkg.scripts?.test) gates.push("npm test");
    } catch {
      // ignore invalid package.json during detection
    }
    if (fs.existsSync(path.join(cwd, "package-lock.json"))) {
      protectedPaths.push({
        id: "package-lock",
        glob: "**/package-lock.json",
        action: "warn",
        reason: "Hand-editing a lockfile breaks reproducibility; regenerate it with the package manager.",
        source: "supply-chain"
      });
    }
  }

  if (fs.existsSync(path.join(cwd, "Cargo.toml"))) {
    stacks.push("rust");
    gates.push("cargo test");
  }

  if (fs.existsSync(path.join(cwd, "pyproject.toml"))) {
    stacks.push("python");
    gates.push("pytest");
  }

  if (fs.existsSync(path.join(cwd, "lakefile.lean")) || fs.existsSync(path.join(cwd, "lakefile.toml"))) {
    stacks.push("lean4");
    gates.push("lake build");
  }

  if (fs.existsSync(path.join(cwd, ".github", "workflows"))) {
    protectedPaths.push({
      id: "ci-workflows",
      glob: ".github/workflows/**",
      action: "escalate",
      reason: "CI changes alter what counts as evidence for every future run.",
      source: "ci"
    });
  }

  return {
    cwd,
    stacks: stacks.length > 0 ? stacks : ["generic"],
    gates: gates.length > 0 ? gates : [],
    protectedPaths
  };
}

function buildPolicy(detected, template = "default") {
  const runs = detected.gates.map((cmd, idx) => ({
    id: `gate-${idx + 1}`,
    command: cmd,
    timeoutSeconds: 300
  }));

  return {
    $schema: "https://github.com/r-irbe/lifecycle-guard/schemas/sdlc-policy.v1.json",
    version: 1,
    template,
    protectedBranches: ["main", "master", "release/*"],
    branchNamePattern: "^(feat|fix|docs|chore|refactor|test|perf|ci|build|revert|agent)/[a-z0-9._-]+$",
    branchNameAction: "warn",
    escalation: {
      noApprover: "fail",
      note: "Fail-closed when unattended."
    },
    verification: {
      runs
    },
    rules: DEFAULT_RULES,
    protectedPaths: detected.protectedPaths,
    secrets: {
      enabled: true,
      action: "block",
      allowlist: ["EXAMPLE", "REDACTED", "PLACEHOLDER"],
      minLength: 20
    },
    unicode: {
      enabled: true,
      defaultMode: "typographic-free",
      forbidInvisible: true
    },
    commits: {
      conventional: true,
      maxSubject: 72,
      forbidNoVerify: true
    },
    audit: {
      path: ".pi/harness-bridge/audit.jsonl",
      chain: true,
      recordAllows: false
    }
  };
}

const INVISIBLE_CODEPOINTS = new Set([
  0x200b, 0x200c, 0x200d, 0x200e, 0x200f,
  0x202a, 0x202b, 0x202c, 0x202d, 0x202e,
  0x2066, 0x2067, 0x2068, 0x2069, 0xfeff
]);

function scanUnicodeInFile(filePath) {
  const findings = [];
  let text;
  try {
    text = fs.readFileSync(filePath, "utf8");
  } catch {
    return findings;
  }
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const ch of line) {
      const cp = ch.codePointAt(0);
      if (
        INVISIBLE_CODEPOINTS.has(cp) ||
        (cp >= 0xe0000 && cp <= 0xe007f)
      ) {
        findings.push(
          `${filePath}:${i + 1}: banned invisible/bidi/tag Unicode codepoint U+${cp.toString(16).toUpperCase()}`
        );
      }
    }
  }
  return findings;
}

function walkSourceFiles(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (
      entry.name === ".git" ||
      entry.name === "node_modules" ||
      entry.name === "dist" ||
      entry.name === ".lake" ||
      entry.name === "target"
    ) {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkSourceFiles(full, out);
    } else if (/\.(mjs|cjs|js|ts|json|md|py|rs|lean|sh|yml|yaml)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function validatePolicyAgainstSchema(policy, schema) {
  const errors = [];
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
    return ["Policy root must be a JSON object."];
  }
  for (const req of schema.required ?? ["version"]) {
    if (!(req in policy)) {
      errors.push(`Missing required top-level property: "${req}".`);
    }
  }
  if (policy.version !== 1) {
    errors.push(`Unsupported policy version: ${JSON.stringify(policy.version)} (expected 1).`);
  }
  const validActions = new Set(["allow", "warn", "escalate", "block"]);
  const validKinds = new Set(["command", "path", "content", "commit-message", "diff"]);

  if (policy.branchNameAction !== undefined && !validActions.has(policy.branchNameAction)) {
    errors.push(`Invalid branchNameAction: "${policy.branchNameAction}".`);
  }
  if (policy.rules !== undefined) {
    if (!Array.isArray(policy.rules)) {
      errors.push(`"rules" must be an array.`);
    } else {
      for (const [idx, rule] of policy.rules.entries()) {
        for (const req of ["id", "scope", "kind", "pattern", "action", "reason"]) {
          if (!rule || typeof rule[req] !== "string" || rule[req].length === 0) {
            errors.push(`rules[${idx}] is missing required string field "${req}".`);
          }
        }
        if (rule?.kind && !validKinds.has(rule.kind)) {
          errors.push(`rules[${idx}].kind "${rule.kind}" is not valid.`);
        }
        if (rule?.action && !validActions.has(rule.action)) {
          errors.push(`rules[${idx}].action "${rule.action}" is not valid.`);
        }
      }
    }
  }
  if (policy.protectedPaths !== undefined) {
    if (!Array.isArray(policy.protectedPaths)) {
      errors.push(`"protectedPaths" must be an array.`);
    } else {
      for (const [idx, pp] of policy.protectedPaths.entries()) {
        for (const req of ["id", "glob", "action", "reason"]) {
          if (!pp || typeof pp[req] !== "string" || pp[req].length === 0) {
            errors.push(`protectedPaths[${idx}] is missing required string field "${req}".`);
          }
        }
        if (pp?.action && !validActions.has(pp.action)) {
          errors.push(`protectedPaths[${idx}].action "${pp.action}" is not valid.`);
        }
      }
    }
  }
  return errors;
}

function resolvePolicyPath(target) {
  const base = path.resolve(target || process.cwd());
  if (fs.existsSync(base) && fs.statSync(base).isFile()) {
    return { policyPath: base, rootDir: path.dirname(path.dirname(base)) };
  }
  const candidates = [
    path.join(base, ".pi", "harness-bridge", "policy.json"),
    path.join(base, ".lifecycle-guard", "policy.json")
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      return { policyPath: c, rootDir: base };
    }
  }
  return { policyPath: candidates[0], rootDir: base };
}

function printHelp() {
  process.stdout.write(
    `lifecycle-guard v${VERSION} — Fail-closed SDLC policy and verification CLI\n\n` +
      `Usage:\n` +
      `  lifecycle-guard setup [--detect] [--template <name>] [--cwd <dir>] [--force]\n` +
      `  lifecycle-guard policy check [path]\n` +
      `  lifecycle-guard verify [--cwd <dir>]\n` +
      `  lifecycle-guard --help | --version\n\n` +
      `Commands:\n` +
      `  setup          Detect project stack and write .pi/harness-bridge/policy.json\n` +
      `  policy check   Validate policy.json against schemas/policy.schema.json and check unicode hygiene\n` +
      `  verify         Execute verification gates configured in policy.json\n`
  );
}

function getArgValue(args, flag) {
  const eq = args.find((a) => a.startsWith(`${flag}=`));
  if (eq) return eq.slice(flag.length + 1);
  const idx = args.indexOf(flag);
  if (idx >= 0 && idx + 1 < args.length) return args[idx + 1];
  return undefined;
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    printHelp();
    process.exit(0);
  }
  if (args.includes("--version") || args.includes("-v")) {
    process.stdout.write(`${VERSION}\n`);
    process.exit(0);
  }

  const cmd = args[0];
  const cwd = path.resolve(getArgValue(args, "--cwd") || process.cwd());

  if (cmd === "setup") {
    const template = getArgValue(args, "--template") || "default";
    const force = args.includes("--force");
    const detected = detectStack(cwd);
    const policy = buildPolicy(detected, template);
    const outDir = path.join(cwd, ".pi", "harness-bridge");
    const outPath = path.join(outDir, "policy.json");

    if (!fs.existsSync(outPath) || force) {
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(outPath, `${JSON.stringify(policy, null, 2)}\n`, "utf8");
    }

    process.stdout.write(
      JSON.stringify(
        {
          ok: true,
          stacks: detected.stacks,
          gates: detected.gates,
          template,
          policyPath: outPath
        },
        null,
        2
      ) + "\n"
    );
    process.exit(0);
  }

  if (cmd === "policy") {
    const sub = args[1];
    if (sub !== "check" && sub !== "validate") {
      process.stderr.write(`Unknown policy subcommand: ${sub ?? "(none)"}\n`);
      process.exit(2);
    }
    const targetArg = args[2] && !args[2].startsWith("-") ? args[2] : cwd;
    const { policyPath, rootDir } = resolvePolicyPath(targetArg);
    if (!fs.existsSync(policyPath)) {
      process.stderr.write(`Policy file not found at ${policyPath}\n`);
      process.exit(1);
    }
    let policy;
    try {
      policy = JSON.parse(fs.readFileSync(policyPath, "utf8"));
    } catch (err) {
      process.stderr.write(`Invalid JSON in ${policyPath}: ${err.message}\n`);
      process.exit(1);
    }
    const schemaPath = path.join(pkgRoot, "schemas", "policy.schema.json");
    const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
    const errors = validatePolicyAgainstSchema(policy, schema);

    const unicodeFindings = [];
    if (policy.unicode?.forbidInvisible !== false) {
      for (const file of walkSourceFiles(rootDir)) {
        unicodeFindings.push(...scanUnicodeInFile(file));
      }
    }

    if (errors.length > 0 || unicodeFindings.length > 0) {
      for (const e of errors) process.stderr.write(`schema error: ${e}\n`);
      for (const u of unicodeFindings) process.stderr.write(`unicode error: ${u}\n`);
      process.exit(1);
    }

    process.stdout.write(
      `policy check ok: ${policyPath} (rules=${policy.rules?.length ?? 0}, protectedPaths=${policy.protectedPaths?.length ?? 0}, escalation=${policy.escalation?.noApprover ?? "fail"})\n`
    );
    process.exit(0);
  }

  if (cmd === "verify") {
    const { policyPath, rootDir } = resolvePolicyPath(cwd);
    if (!fs.existsSync(policyPath)) {
      process.stderr.write(`Policy file not found at ${policyPath}; run lifecycle-guard setup first.\n`);
      process.exit(1);
    }
    const policy = JSON.parse(fs.readFileSync(policyPath, "utf8"));
    const runs = policy.verification?.runs ?? [];
    for (const run of runs) {
      const command = typeof run === "string" ? run : run.command;
      if (!command) continue;
      process.stdout.write(`lifecycle-guard verify: running ${command}...\n`);
      const res = spawnSync(command, {
        cwd: rootDir,
        shell: true,
        stdio: "inherit"
      });
      if (res.status !== 0) {
        process.stderr.write(`lifecycle-guard verify failed on ${command} (exit ${res.status ?? 1})\n`);
        process.exit(res.status ?? 1);
      }
    }
    process.stdout.write(`lifecycle-guard verify: ${runs.length} gate(s) passed.\n`);
    process.exit(0);
  }

  process.stderr.write(`Unknown command: ${cmd}\nRun lifecycle-guard --help for usage.\n`);
  process.exit(2);
}

main();
