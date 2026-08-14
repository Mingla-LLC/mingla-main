#!/usr/bin/env node
/**
 * #1042 [android-signing-fingerprint-audit] — assetlinks.json parity + ratchet gate.
 *
 * ── WHAT THIS GATE PROVES, AND WHAT IT EXPLICITLY DOES NOT ──────────────────────
 *
 * IT DOES NOT PROVE THAT ANY FINGERPRINT IN THESE FILES IS CORRECT. It cannot, and
 * no CI job in this repo ever can. The authority for "which certificate signs the
 * binary Google Play actually ships" is a Play Console screen —
 * `Test and release -> Setup -> App signing` — which CI has no credential to read and
 * no API surface to query. A gate that re-asserted a hardcoded fingerprint against a
 * repo JSON file would be a copy checked against itself: it would print green while
 * the value it is guarding is wrong.
 *
 * That is not hypothetical. It is exactly what happened in #1038: Mingla Host was
 * registered in Google Cloud under the UPLOAD certificate instead of the Play
 * app-signing certificate, Google sign-in failed for every Play-Store organiser for
 * months, and nothing in this repository could see the discrepancy — including
 * `mingla-business/__tests__/assetlinks.consumerAppLinks.test.ts`, which asserted a
 * hardcoded array against the very file that array was copied from (and which, per
 * #1042 F-6, no workflow ever ran).
 *
 * SO THIS GATE CLAIMS ONLY WHAT IT CAN ACTUALLY DEMONSTRATE:
 *   - our two served copies have not drifted apart from each other;
 *   - no fingerprint was silently DELETED from either copy;
 *   - every fingerprint is syntactically a SHA-256 in the exact form Google's
 *     resolver accepts (uppercase, colon-separated, 32 bytes) — a lowercase or
 *     SHA-1-length value is a real, silent App-Links killer;
 *   - no App Links host can be added to either app without being written down.
 *
 * Correctness against the outside world is the job of `scripts/probe-android-applinks.mjs`
 * (scheduled), which asks Google's OWN resolver what it believes — a fact this repo
 * does not contain. Provenance of each fingerprint (which is Play app-signing, which
 * is the EAS upload key, which is the EAS debug keystore) is documented in
 * `docs/runbooks/ANDROID_SIGNING_AND_DEEP_LINK_REGISTRY.md`, because `assetlinks.json`
 * is strict JSON and cannot carry a comment.
 *
 * ── WHY THE RATCHET IS THE LOAD-BEARING PART ────────────────────────────────────
 * Each Mingla Android app has THREE signing identities, not two — Play app-signing,
 * EAS upload/release, and the EAS debug keystore — and each one is the only thing
 * standing between a different install path and dead App Links. #1042 F-2 proved that
 * `90:28:F8:B1:…` (which was carried for eight weeks as a suspected "stale key") is in
 * fact Explorer's LIVE debug keystore. Deleting it would have broken every
 * `development`-profile dev-client build. An unfamiliar fingerprint is presumed to be
 * the third identity until a Play Console or `eas credentials` readback says otherwise,
 * so removal is a ratchet violation, never a cleanup.
 *
 * ── FAILS-ON-REVERT REFERENCE ───────────────────────────────────────────────────
 * Pre-fix HEAD: a7df8c51d. At that commit both files carried TWO fingerprints for
 * `com.mingla.app.v2` (Explorer's upload key `6B:21:64:88:…` was absent), so this gate
 * exits non-zero against it on the MIN_FINGERPRINTS ratchet. Deleting any single
 * fingerprint line from either file reproduces that failure.
 *
 * Usage:  node scripts/ci/issue-1042-assetlinks-parity-check.mjs
 * Exit:   0 = parity + ratchet + format hold · 1 = at least one assertion failed.
 * CI:     .github/workflows/issue-1042-assetlinks-tests.yml (PR-blocking).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../..");

const CONSUMER_PACKAGE = "com.mingla.app.v2";
const EXPECTED_RELATION = "delegate_permission/common.handle_all_urls";

/** The two copies we serve. `key` is the short name used in MIN_FINGERPRINTS. */
const FILES = [
  {
    key: "marketing",
    rel: "mingla-marketing/public/.well-known/assetlinks.json",
    servedAt: "https://usemingla.com/.well-known/assetlinks.json (+ www.)",
  },
  {
    key: "business",
    rel: "mingla-business/public/.well-known/assetlinks.json",
    servedAt: "https://host.usemingla.com/.well-known/assetlinks.json",
  },
];

/**
 * RATCHET — the minimum number of fingerprints each (file, package) must carry.
 * Adding a fingerprint is always legal. Removing one below this floor is not.
 * Raising a floor is a visible diff in this file; lowering one requires a Play
 * Console / `eas credentials` readback cited in the PR body (#1042 invariant
 * I-PROPOSED-1042-ANDROID-FINGERPRINT-SET-APPEND-ONLY).
 */
const MIN_FINGERPRINTS = {
  "marketing/com.mingla.app.v2": 3,
  "business/com.mingla.app.v2": 3,
  "business/com.sethogieva.minglabusiness": 2,
};

/** Uppercase, colon-separated, exactly 32 bytes. Google's resolver is strict. */
const SHA256_RE = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;

/** App configs the probe and this gate both read. READ-ONLY here. */
const APP_CONFIGS = [
  { rel: "app-mobile/app.json", label: "Explorer" },
  { rel: "mingla-business/app.json", label: "Business" },
];

const RUNBOOK_REL = "docs/runbooks/ANDROID_SIGNING_AND_DEEP_LINK_REGISTRY.md";
const HOSTS_BEGIN = "<!-- ISSUE-1042-HOSTS-TABLE:BEGIN -->";
const HOSTS_END = "<!-- ISSUE-1042-HOSTS-TABLE:END -->";

const failures = [];
const fail = (msg) => failures.push(msg);

const readJson = (rel) => {
  const abs = path.join(REPO_ROOT, rel);
  if (!fs.existsSync(abs)) {
    fail(`MISSING FILE — ${rel} does not exist. It is served publicly; it may never be deleted.`);
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(abs, "utf8"));
  } catch (err) {
    fail(
      `INVALID JSON — ${rel} does not parse: ${err instanceof Error ? err.message : String(err)}\n` +
        `  A malformed assetlinks.json makes Google's resolver return ZERO statements for that host, ` +
        `which silently kills App Links for EVERY package listed on it.`,
    );
    return null;
  }
};

// ── A1/A2/A4 — structure, format, no duplicate packages ────────────────────────
/** @returns {Map<string,string[]>} package_name -> fingerprints, for this file */
function checkFile(file) {
  const byPackage = new Map();
  const entries = readJson(file.rel);
  if (entries === null) return byPackage;

  if (!Array.isArray(entries)) {
    fail(`STRUCTURE — ${file.rel}: root must be a JSON ARRAY of statement objects, got ${typeof entries}.`);
    return byPackage;
  }
  if (entries.length === 0) {
    fail(`STRUCTURE — ${file.rel}: root array is EMPTY. Refusing to pass vacuously.`);
    return byPackage;
  }

  entries.forEach((entry, i) => {
    const where = `${file.rel} entry[${i}]`;
    const relation = entry?.relation;
    if (!Array.isArray(relation) || relation.length !== 1 || relation[0] !== EXPECTED_RELATION) {
      fail(`RELATION — ${where}: "relation" must be exactly ["${EXPECTED_RELATION}"], got ${JSON.stringify(relation)}.`);
    }
    const target = entry?.target;
    if (!target || typeof target !== "object") {
      fail(`TARGET — ${where}: missing "target" object.`);
      return;
    }
    if (target.namespace !== "android_app") {
      fail(`NAMESPACE — ${where}: "namespace" must be "android_app", got ${JSON.stringify(target.namespace)}.`);
    }
    const pkg = target.package_name;
    if (typeof pkg !== "string" || pkg.length === 0) {
      fail(`PACKAGE — ${where}: missing or empty "package_name".`);
      return;
    }
    const prints = target.sha256_cert_fingerprints;
    if (!Array.isArray(prints) || prints.length === 0) {
      fail(`FINGERPRINTS — ${where} (${pkg}): "sha256_cert_fingerprints" must be a NON-EMPTY array.`);
      return;
    }
    prints.forEach((fp, j) => {
      if (typeof fp !== "string" || !SHA256_RE.test(fp)) {
        fail(
          `FORMAT — ${where} (${pkg}) fingerprint[${j}] is not an uppercase colon-separated 32-byte SHA-256:\n` +
            `    ${JSON.stringify(fp)}\n` +
            `  Google's resolver rejects lowercase hex and SHA-1-length values SILENTLY — the statement is ` +
            `simply not matched and App Links stop verifying with no error anywhere.`,
        );
      }
    });
    const dupes = prints.filter((fp, j) => prints.indexOf(fp) !== j);
    if (dupes.length) {
      fail(`DUPLICATE FINGERPRINT — ${where} (${pkg}) repeats: ${[...new Set(dupes)].join(", ")}`);
    }

    if (byPackage.has(pkg)) {
      fail(
        `DUPLICATE PACKAGE — ${file.rel} lists "${pkg}" more than once. Google merges statements, so a ` +
          `second entry silently masks which array is authoritative.`,
      );
      return;
    }
    byPackage.set(pkg, prints);
  });

  return byPackage;
}

// ── A5 — the ratchet ───────────────────────────────────────────────────────────
function checkRatchet(fileKey, byPackage) {
  for (const [mapKey, min] of Object.entries(MIN_FINGERPRINTS)) {
    const [key, pkg] = mapKey.split("/");
    if (key !== fileKey) continue;
    const prints = byPackage.get(pkg);
    if (!prints) {
      fail(
        `RATCHET — ${fileKey}: package "${pkg}" is GONE from the file entirely (MIN_FINGERPRINTS ` +
          `requires ${min}). Removing a package removes App Links for every install of that app.`,
      );
      continue;
    }
    if (prints.length < min) {
      fail(
        `RATCHET — ${fileKey}/${pkg}: ${prints.length} fingerprint(s), minimum is ${min}.\n` +
          `  A fingerprint was DELETED. Each Mingla Android app has THREE signing identities (Play\n` +
          `  app-signing / EAS upload / EAS debug) and each one is the only thing keeping a different\n` +
          `  install path's App Links alive. #1042 F-2: 90:28:F8:B1:… is Explorer's LIVE debug keystore,\n` +
          `  not a stale key. If a removal is genuinely correct, cite the Play Console or\n` +
          `  \`eas credentials\` readback in the PR body and lower the floor in this file deliberately.\n` +
          `  See ${RUNBOOK_REL}.`,
      );
    }
  }
}

// ── A3 — cross-file deep-equality for the consumer package ─────────────────────
function checkCrossFileParity(perFile) {
  const marketing = perFile.marketing?.get(CONSUMER_PACKAGE);
  const business = perFile.business?.get(CONSUMER_PACKAGE);
  if (!marketing || !business) return; // already reported by the ratchet

  const equal = marketing.length === business.length && marketing.every((fp, i) => fp === business[i]);
  if (!equal) {
    fail(
      `CROSS-FILE MISMATCH — the "${CONSUMER_PACKAGE}" fingerprint arrays have DRIFTED between our two\n` +
        `  served copies. They must be deep-equal, order included.\n` +
        `    mingla-marketing (${marketing.length}): ${JSON.stringify(marketing, null, 2).replace(/\n/g, "\n    ")}\n` +
        `    mingla-business  (${business.length}): ${JSON.stringify(business, null, 2).replace(/\n/g, "\n    ")}\n` +
        `  Explorer autoVerifies BOTH usemingla.com and host.usemingla.com, so a fingerprint present\n` +
        `  on one host and absent on the other verifies half the app's links and silently drops the rest.`,
    );
  }
}

// ── A6 — every autoVerify host is written down in the runbook ──────────────────
/** @returns {{host:string, app:string, pkg:string}[]} */
function declaredHosts() {
  const out = [];
  for (const cfg of APP_CONFIGS) {
    const abs = path.join(REPO_ROOT, cfg.rel);
    if (!fs.existsSync(abs)) {
      fail(`MISSING CONFIG — ${cfg.rel} does not exist; the App Links host list cannot be derived.`);
      continue;
    }
    let json;
    try {
      json = JSON.parse(fs.readFileSync(abs, "utf8"));
    } catch (err) {
      fail(`INVALID JSON — ${cfg.rel}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    const android = json?.expo?.android ?? {};
    const pkg = android.package ?? "(unknown package)";
    for (const filter of android.intentFilters ?? []) {
      if (filter?.autoVerify !== true) continue;
      for (const d of filter.data ?? []) {
        if (d?.scheme !== "https" || typeof d.host !== "string") continue;
        if (!out.some((h) => h.host === d.host && h.pkg === pkg)) {
          out.push({ host: d.host, app: cfg.label, pkg });
        }
      }
    }
  }
  if (out.length === 0) {
    fail(
      "VACUOUS — zero autoVerify https hosts were discovered across both app configs. Both apps DO " +
        "declare App Links hosts, so an empty result means this check silently stopped checking.",
    );
  }
  return out;
}

function checkRunbookHosts(hosts) {
  const abs = path.join(REPO_ROOT, RUNBOOK_REL);
  if (!fs.existsSync(abs)) {
    fail(
      `MISSING RUNBOOK — ${RUNBOOK_REL} does not exist. It is the only place the provenance of each\n` +
        `  fingerprint is written down (assetlinks.json is strict JSON and cannot carry a comment).`,
    );
    return;
  }
  const text = fs.readFileSync(abs, "utf8");
  const begin = text.indexOf(HOSTS_BEGIN);
  const end = text.indexOf(HOSTS_END);
  if (begin === -1 || end === -1 || end < begin) {
    fail(
      `RUNBOOK HOSTS TABLE — ${RUNBOOK_REL} must contain a table delimited by\n` +
        `    ${HOSTS_BEGIN}\n    ${HOSTS_END}\n` +
        `  listing every host either app autoVerifies.`,
    );
    return;
  }
  const table = text.slice(begin + HOSTS_BEGIN.length, end);
  for (const h of hosts) {
    // The host must appear in a row that also names the package that declares it —
    // "documented" means the pairing is documented, not merely the hostname.
    const row = table
      .split("\n")
      .find((line) => line.includes(`\`${h.host}\``) && line.includes(`\`${h.pkg}\``));
    if (!row) {
      fail(
        `UNDOCUMENTED APP LINKS HOST — ${h.app} (${h.pkg}) declares autoVerify on "${h.host}", but no row\n` +
          `  in ${RUNBOOK_REL}'s HOSTS table names that (host, package) pair.\n` +
          `  A new App Links host that nobody wrote down is exactly the #1038 failure shape: the app\n` +
          `  depends on an external statement file, and nothing in the repo records that it does.\n` +
          `  Add a row (host + package + who serves it + whether it publishes a statement).`,
      );
    }
  }
}

// ── main ───────────────────────────────────────────────────────────────────────
console.log("#1042 assetlinks parity + ratchet gate");
console.log("  NOTE: this gate CANNOT certify that any fingerprint is correct — see the header.\n");

const perFile = {};
for (const file of FILES) {
  const byPackage = checkFile(file);
  perFile[file.key] = byPackage;
  checkRatchet(file.key, byPackage);
  const summary = [...byPackage.entries()].map(([pkg, fps]) => `${pkg}=${fps.length}`).join(", ");
  console.log(`  ${file.rel}\n    served at ${file.servedAt}\n    ${summary || "(nothing parsed)"}`);
}

checkCrossFileParity(perFile);

const hosts = declaredHosts();
console.log(`\n  autoVerify hosts declared in app config: ${hosts.map((h) => `${h.host} (${h.app})`).join(", ") || "(none)"}`);
checkRunbookHosts(hosts);

if (failures.length > 0) {
  console.error(`\nISSUE-1042 ASSETLINKS GATE FAIL — ${failures.length} assertion(s) failed:\n`);
  for (const f of failures) console.error(`  - ${f}\n`);
  console.error(
    "Reference: docs/runbooks/ANDROID_SIGNING_AND_DEEP_LINK_REGISTRY.md · invariant\n" +
      "I-PROPOSED-1042-ANDROID-FINGERPRINT-SET-APPEND-ONLY · pre-fix HEAD a7df8c51d.",
  );
  process.exit(1);
}

console.log(
  "\nPASS — both copies parse, every fingerprint is a well-formed uppercase SHA-256, the\n" +
    "com.mingla.app.v2 arrays are deep-equal across both files, no package is duplicated, no\n" +
    "fingerprint count fell below its floor, and every autoVerify host is documented.\n" +
    "This says NOTHING about whether the fingerprints are the right ones — only Play Console\n" +
    "and scripts/probe-android-applinks.mjs can speak to that.",
);
process.exit(0);
