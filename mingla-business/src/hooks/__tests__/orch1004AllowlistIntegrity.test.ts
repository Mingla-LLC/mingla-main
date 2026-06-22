/**
 * ORCH-1004 [Business web data reliability] — TESTER-AUTHORED adversarial
 * regression test (INDEPENDENT angle, distinct from BOTH implementor tests).
 *
 * The implementor's happy-path test proves one hook gates at runtime; the
 * implementor's adversarial test drives the gate's classifier against planted
 * fixtures + runs the gate subprocess + asserts a few named public hooks are
 * ungated.
 *
 * THIS test attacks a different surface: the INTEGRITY + COMPLETENESS of the
 * gate's two curated lists (AUTH_SCOPED_HOOK_FILES + PUBLIC_HOOK_ALLOWLIST),
 * treating them as a security-load-bearing data contract. The dispatch's named
 * risk is "buyer-web can never silently regress behind the auth gate." Two ways
 * that regression sneaks in WITHOUT tripping the implementor's tests:
 *
 *   R1. A public/anon hook is silently dropped from the allowlist and added to
 *       the auth-scoped list (or just gated) — buyer-web breaks. The
 *       implementor's test only checks a FIXED set of names; it cannot catch a
 *       NEW public hook, or an allowlist entry quietly deleted.
 *   R2. The allowlist accumulates an entry that is actually gated, or carries
 *       an empty reason, or the two lists overlap — the gate's own cross-check
 *       covers overlap, but not "every allowlisted hook is genuinely ungated in
 *       real source" as a standalone invariant, nor "every auth-scoped file
 *       that exists in the repo is registered".
 *
 * We parse the lists straight out of the gate's source (the gate exports
 * nothing), then assert invariants against the REAL hook files on disk.
 *
 * Fails-on-revert: this suite fails if the gate's allowlist is emptied, if any
 * allowlisted public hook becomes gated, if a registered auth-scoped hook stops
 * gating, or if an anon-reachable public hook is left neither gated nor
 * allowlisted. Captured in QA_ORCH-1004_DATA_RELIABILITY.md.
 */

import { describe, expect, test } from "@jest/globals";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(__dirname, "..", "..", "..", "..");
const gatePath = path.join(
  repoRoot,
  ".github/scripts/strict-grep/orch-1004-auth-scoped-query-readiness.mjs",
);
const gateSource = readFileSync(gatePath, "utf8");
const hooksDir = path.resolve(__dirname, "..");

// Gate's own gating detection (replicated from gate source; drift is caught by
// the implementor's live-gate subprocess test, so these stay in lock-step).
const SESSION_GATE_EQUIVALENT =
  /enabled\s*=\s*!loading\s*&&\s*session\s*!==\s*null/;
const READS_IS_AUTH_READY = /\bisAuthReady\b/;
// ORCH-1202 lock-step sync (see the line-47 contract: this mirrors the gate's
// detection and drift is caught by the live-gate subprocess test). The gate's
// regex was broadened to also accept the named-variable fold
// `const enabledQuery = isAuthReady && ...` (useSupportStaff.ts) — keep this in
// step so the integrity test reflects the SAME gating predicate the gate uses.
const ENABLED_USES_IS_AUTH_READY =
  /const\s+enabled\w*\s*=\s*[^;]*\bisAuthReady\b|enabled:\s*[^,}\n]*\bisAuthReady\b/;
const isGated = (src: string): boolean =>
  SESSION_GATE_EQUIVALENT.test(src) ||
  (READS_IS_AUTH_READY.test(src) && ENABLED_USES_IS_AUTH_READY.test(src));

// ── Parse the two curated lists out of the gate source ─────────────────────
const extractArrayBlock = (marker: string): string => {
  const start = gateSource.indexOf(marker);
  if (start === -1) throw new Error(`gate marker not found: ${marker}`);
  const open = gateSource.indexOf("[", start);
  const close = gateSource.indexOf("];", open);
  return gateSource.slice(open + 1, close);
};

const parseAuthScopedFiles = (): string[] => {
  const block = extractArrayBlock("const AUTH_SCOPED_HOOK_FILES");
  return [...block.matchAll(/"([^"]+\.ts)"/g)].map((m) => m[1]);
};

// Each allowlist row is `["file.ts", "reason"]`.
const parseAllowlist = (): Array<[string, string]> => {
  const block = extractArrayBlock("const PUBLIC_HOOK_ALLOWLIST");
  return [...block.matchAll(/\[\s*"([^"]+\.ts)"\s*,\s*"([^"]*)"\s*\]/g)].map(
    (m) => [m[1], m[2]] as [string, string],
  );
};

const AUTH_SCOPED = parseAuthScopedFiles();
const ALLOWLIST = parseAllowlist();
const ALLOWLIST_FILES = ALLOWLIST.map(([f]) => f);

describe("ORCH-1004 allowlist integrity — parse sanity", () => {
  test("both curated lists parsed non-empty from the gate source", () => {
    expect(AUTH_SCOPED.length).toBeGreaterThanOrEqual(20);
    expect(ALLOWLIST.length).toBeGreaterThanOrEqual(4);
  });
});

describe("ORCH-1004 — R2: every allowlisted PUBLIC hook is genuinely ungated + reasoned", () => {
  test.each(ALLOWLIST)(
    "allowlisted %s is ungated in real source AND carries a non-empty anon reason",
    (file, reason) => {
      // The reason is load-bearing audit metadata — an empty reason means a
      // hook was waved through the gate with no justification.
      expect(reason.trim().length).toBeGreaterThan(10);
      const abs = path.join(hooksDir, file);
      if (!existsSync(abs)) return; // public hook may be absent in some checkouts
      const src = readFileSync(abs, "utf8");
      // P0: an allowlisted buyer-web hook must NOT be gated on isAuthReady, or
      // the anonymous read path is silently starved.
      expect(isGated(src)).toBe(false);
    },
  );
});

describe("ORCH-1004 — R1: lists are disjoint + complete vs. real source", () => {
  test("no file appears in BOTH the auth-scoped list and the allowlist", () => {
    const overlap = AUTH_SCOPED.filter((f) => ALLOWLIST_FILES.includes(f));
    expect(overlap).toEqual([]);
  });

  test("every registered auth-scoped hook that exists on disk is genuinely gated", () => {
    for (const file of AUTH_SCOPED) {
      const abs = path.join(hooksDir, file);
      if (!existsSync(abs)) continue;
      const src = readFileSync(abs, "utf8");
      expect(isGated(src)).toBe(true);
    }
  });

  test("NO public hook silently regresses behind the gate: every usePublic* / useIntakeSchema hook on disk is in the allowlist and ungated", () => {
    // Enumerate the actually-anon-reachable hook families by naming convention
    // + the known dual-use intake hook. If a NEW public hook is added and left
    // neither gated nor allowlisted, this catches it (the implementor's fixed
    // name-list test cannot).
    const fs = require("node:fs") as typeof import("node:fs");
    const onDisk = fs
      .readdirSync(hooksDir)
      .filter((f) => /^usePublic.*\.ts$/.test(f) && !f.endsWith(".test.ts"));
    // useIntakeSchema is dual-use and must also be allowlisted.
    const intake = "useIntakeSchema.ts";
    if (existsSync(path.join(hooksDir, intake))) onDisk.push(intake);

    for (const file of onDisk) {
      const src = readFileSync(path.join(hooksDir, file), "utf8");
      // anon path intact: not gated
      expect(isGated(src)).toBe(false);
      // and explicitly accounted for in the allowlist (so the auditor knows
      // it was a deliberate decision, not an oversight)
      expect(ALLOWLIST_FILES).toContain(file);
    }
  });
});
