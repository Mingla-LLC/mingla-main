#!/usr/bin/env node
/**
 * High/critical npm audit ceiling with an explicit GHSA allowlist.
 *
 * Why: `npm audit --audit-level=high` merge-blocks every Sites/CMS PR when an
 * advisory has no patched release (GHSA-vfj7-8cjw-p6xm / braces@<=3.0.3, npm
 * latest still 3.0.3). That turns an external advisory database into a
 * merge-blocker — the #3642 decision forbids that class of gate. Dependabot
 * security alerts remain the reporter for allowlisted GHSAs.
 *
 * Usage (from a package directory with node_modules installed):
 *   node ../.github/scripts/npm-audit-ceiling.mjs
 *   node ../.github/scripts/npm-audit-ceiling.mjs --allowlist ../.github/npm-audit-allowlist.json
 *   node ../.github/scripts/npm-audit-ceiling.mjs --self-test
 *
 * Exit 0 — no remaining high/critical after allowlist collapse.
 * Exit 1 — one or more high/critical remain, or the allowlist/audit is unreadable.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ALLOWLIST = path.resolve(
  __dirname,
  "../npm-audit-allowlist.json",
);
const GHSA_RE = /GHSA-[a-z0-9-]+/i;
const BLOCKING = new Set(["high", "critical"]);

function parseArgs(argv) {
  const out = { allowlist: DEFAULT_ALLOWLIST, selfTest: false, auditJson: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--self-test") out.selfTest = true;
    else if (a === "--allowlist") out.allowlist = path.resolve(argv[++i] ?? "");
    else if (a === "--audit-json") out.auditJson = path.resolve(argv[++i] ?? "");
    else if (a === "--help" || a === "-h") out.help = true;
    else throw new Error(`unknown_arg:${a}`);
  }
  return out;
}

function loadAllowlist(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const doc = JSON.parse(raw);
  if (!doc || typeof doc !== "object" || !Array.isArray(doc.advisories)) {
    throw new Error(`allowlist_invalid:${filePath}`);
  }
  const ids = new Set();
  for (const row of doc.advisories) {
    const ghsa = String(row?.ghsa ?? "");
    if (!GHSA_RE.test(ghsa)) {
      throw new Error(`allowlist_bad_ghsa:${JSON.stringify(row)}`);
    }
    ids.add(ghsa.toUpperCase());
  }
  return { ids, doc };
}

function ghsaFromUrl(url) {
  const m = String(url ?? "").match(GHSA_RE);
  return m ? m[0].toUpperCase() : null;
}

/**
 * A package is fully allowlisted when every via edge is either an allowlisted
 * advisory or another package that is itself fully allowlisted.
 */
function fullyAllowlistedPackages(vulnerabilities, allowlistedGhsa) {
  const excused = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    for (const [name, vuln] of Object.entries(vulnerabilities)) {
      if (excused.has(name)) continue;
      const vias = Array.isArray(vuln?.via) ? vuln.via : [];
      if (vias.length === 0) continue;
      let ok = true;
      for (const item of vias) {
        if (item && typeof item === "object") {
          const ghsa = ghsaFromUrl(item.url);
          if (!ghsa || !allowlistedGhsa.has(ghsa)) {
            ok = false;
            break;
          }
        } else {
          const ref = String(item ?? "");
          if (!excused.has(ref)) {
            ok = false;
            break;
          }
        }
      }
      if (ok) {
        excused.add(name);
        changed = true;
      }
    }
  }
  return excused;
}

function severityRank(sev) {
  switch (String(sev ?? "").toLowerCase()) {
    case "critical":
      return 4;
    case "high":
      return 3;
    case "moderate":
      return 2;
    case "low":
      return 1;
    default:
      return 0;
  }
}

function rankToSeverity(rank) {
  if (rank >= 4) return "critical";
  if (rank >= 3) return "high";
  if (rank >= 2) return "moderate";
  if (rank >= 1) return "low";
  return "none";
}

/**
 * Effective severity after removing allowlisted advisory edges and packages
 * that exist only because of those advisories.
 */
function effectiveSeverity(name, vulnerabilities, excused, allowlistedGhsa, seen = new Set()) {
  if (excused.has(name)) return "none";
  if (seen.has(name)) return "none";
  seen.add(name);
  const vuln = vulnerabilities[name];
  if (!vuln) return "none";
  let rank = 0;
  for (const item of Array.isArray(vuln.via) ? vuln.via : []) {
    if (item && typeof item === "object") {
      const ghsa = ghsaFromUrl(item.url);
      if (ghsa && allowlistedGhsa.has(ghsa)) continue;
      rank = Math.max(rank, severityRank(item.severity ?? vuln.severity));
    } else {
      const ref = String(item ?? "");
      if (excused.has(ref)) continue;
      // Dangling package refs must not collapse to "none" (fail-open). Use the
      // child's effective severity when present; otherwise keep this vuln's own.
      if (!Object.prototype.hasOwnProperty.call(vulnerabilities, ref)) {
        rank = Math.max(rank, severityRank(vuln.severity));
        continue;
      }
      rank = Math.max(
        rank,
        severityRank(
          effectiveSeverity(ref, vulnerabilities, excused, allowlistedGhsa, seen),
        ),
      );
    }
  }
  return rankToSeverity(rank);
}

function evaluateAudit(audit, allowlistedGhsa) {
  if (!audit || typeof audit !== "object" || Array.isArray(audit)) {
    throw new Error("audit_unreadable");
  }
  // npm audit error payloads (registry/ENOAUDIT/etc.) must not pass as zero
  // findings — defaulting missing vulnerabilities to {} would fail open.
  if (audit.error != null) {
    const err = audit.error;
    const code = typeof err === "object" && err ? (err.code ?? "unknown") : "unknown";
    const summary =
      typeof err === "object" && err
        ? (err.summary ?? err.detail ?? JSON.stringify(err))
        : String(err);
    throw new Error(`audit_error:${code}:${String(summary).slice(0, 200)}`);
  }
  if (
    !Object.prototype.hasOwnProperty.call(audit, "vulnerabilities") ||
    typeof audit.vulnerabilities !== "object" ||
    audit.vulnerabilities === null ||
    Array.isArray(audit.vulnerabilities)
  ) {
    throw new Error("audit_missing_vulnerabilities");
  }
  const vulnerabilities = audit.vulnerabilities;
  const excused = fullyAllowlistedPackages(vulnerabilities, allowlistedGhsa);
  const blocking = [];
  for (const name of Object.keys(vulnerabilities).sort()) {
    const eff = effectiveSeverity(
      name,
      vulnerabilities,
      excused,
      allowlistedGhsa,
    );
    if (BLOCKING.has(eff)) {
      blocking.push({ name, severity: eff });
    }
  }
  return {
    excused: [...excused].sort(),
    blocking,
    allowlistedGhsa: [...allowlistedGhsa].sort(),
  };
}

function runNpmAuditJson() {
  const res = spawnSync("npm", ["audit", "--json"], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  // npm audit exits non-zero when findings exist; stdout is still JSON.
  const stdout = res.stdout || "";
  if (!stdout.trim()) {
    throw new Error(
      `npm_audit_empty_stdout:status=${res.status}:stderr=${(res.stderr || "").slice(0, 400)}`,
    );
  }
  return JSON.parse(stdout);
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function selfTest() {
  const allow = new Set(["GHSA-VFJ7-8CJW-P6XM"]);
  const bracesOnly = {
    vulnerabilities: {
      braces: {
        severity: "high",
        via: [
          {
            severity: "high",
            url: "https://github.com/advisories/GHSA-vfj7-8cjw-p6xm",
          },
        ],
      },
      micromatch: { severity: "high", via: ["braces"] },
    },
  };
  const r1 = evaluateAudit(bracesOnly, allow);
  assert(r1.blocking.length === 0, "T1 braces-only tree must pass");
  assert(r1.excused.includes("micromatch"), "T1 micromatch excused");

  const mixed = {
    vulnerabilities: {
      braces: {
        severity: "high",
        via: [
          {
            severity: "high",
            url: "https://github.com/advisories/GHSA-vfj7-8cjw-p6xm",
          },
        ],
      },
      sass: { severity: "high", via: ["braces"] },
      payload: {
        severity: "moderate",
        via: [
          {
            severity: "moderate",
            url: "https://github.com/advisories/GHSA-jg8r-5jh2-v2xj",
          },
        ],
      },
      "@payloadcms/next": {
        severity: "high",
        via: ["payload", "sass"],
      },
      lodash: {
        severity: "high",
        via: [
          {
            severity: "high",
            url: "https://github.com/advisories/GHSA-dead-beef-cafe",
          },
        ],
      },
    },
  };
  const r2 = evaluateAudit(mixed, allow);
  assert(
    r2.blocking.length === 1 && r2.blocking[0].name === "lodash",
    `T2 only unrelated high remains, got ${JSON.stringify(r2.blocking)}`,
  );
  assert(
    !r2.blocking.some((b) => b.name === "@payloadcms/next"),
    "T2 payload+sass parent drops to moderate after braces allowlist",
  );

  const emptyAllow = evaluateAudit(bracesOnly, new Set());
  assert(emptyAllow.blocking.length === 2, "T3 empty allowlist still blocks");

  // Allowlist file shape
  const { ids } = loadAllowlist(DEFAULT_ALLOWLIST);
  assert(ids.has("GHSA-VFJ7-8CJW-P6XM"), "T4 default allowlist contains GHSA-vfj7");

  let threw = false;
  try {
    evaluateAudit({ error: { code: "ENOAUDIT", summary: "audit unavailable" } }, allow);
  } catch (err) {
    threw = String(err?.message ?? err).startsWith("audit_error:ENOAUDIT:");
  }
  assert(threw, "T5 npm audit error payload must fail closed");

  threw = false;
  try {
    evaluateAudit({ metadata: {} }, allow);
  } catch (err) {
    threw = String(err?.message ?? err) === "audit_missing_vulnerabilities";
  }
  assert(threw, "T6 missing vulnerabilities map must fail closed");

  const dangling = {
    vulnerabilities: {
      parent: { severity: "high", via: ["missing-child"] },
    },
  };
  const r7 = evaluateAudit(dangling, allow);
  assert(
    r7.blocking.length === 1 && r7.blocking[0].name === "parent",
    `T7 dangling via ref must keep parent high, got ${JSON.stringify(r7.blocking)}`,
  );

  console.log("npm-audit-ceiling self-test: PASS");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(
      "Usage: node npm-audit-ceiling.mjs [--allowlist path] [--audit-json path] [--self-test]",
    );
    process.exit(0);
  }
  if (args.selfTest) {
    selfTest();
    return;
  }

  const { ids: allowlistedGhsa } = loadAllowlist(args.allowlist);
  const audit = args.auditJson
    ? JSON.parse(fs.readFileSync(args.auditJson, "utf8"))
    : runNpmAuditJson();
  const result = evaluateAudit(audit, allowlistedGhsa);

  if (result.excused.length > 0) {
    console.log(
      `npm-audit-ceiling: allowlisted-collapse ${result.excused.length} package(s) via ${result.allowlistedGhsa.join(",")}`,
    );
    for (const name of result.excused) {
      console.log(`  excused: ${name}`);
    }
  }

  if (result.blocking.length > 0) {
    console.error(
      `npm-audit-ceiling: ${result.blocking.length} high/critical remain after allowlist`,
    );
    for (const row of result.blocking) {
      console.error(`  ${row.severity} ${row.name}`);
    }
    process.exit(1);
  }

  console.log("npm-audit-ceiling: PASS (no high/critical outside allowlist)");
}

try {
  main();
} catch (err) {
  console.error(
    `npm-audit-ceiling: ${err instanceof Error ? err.message : String(err)}`,
  );
  process.exit(1);
}
