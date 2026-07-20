#!/usr/bin/env node
/**
 * ISSUE-1001 [brand logo consolidation] — ONE MASTER PER MARK, MIRRORS ARE
 * BYTE-IDENTICAL, DELETED DUPLICATES STAY DELETED.
 * I-PROPOSED-1001-BRAND-ASSET-CANON rule (b).
 *
 * WHY THIS GATE EXISTS: before #1001 the wordmark PNG existed as 4 committed
 * byte-identical copies (app-mobile assets, business assets, admin src, admin
 * public), the business lockup as 3, plus a stray hash-named icon dup. Copies
 * drift. #1001 made `packages/brand-assets/` the single committed source of
 * truth; static hosts that physically must serve a file keep byte-identical
 * MIRRORS, registered below.
 *
 * THE RULES enforced here:
 *   1. Every master exists in packages/brand-assets/.
 *   2. Every registered mirror is byte-identical (md5) to its master.
 *   3. The 7 deleted duplicate paths never reappear (by path), and no
 *      tracked .png/.svg outside the registered set carries a master's
 *      bytes (by content — a resurrected dup under a NEW name also fails).
 *   4. Check-only derivative anchor: app-mobile/assets/icon.png (an Expo
 *      app.json build input — never repointed) must equal the square master.
 *
 * Fails-on-revert: re-adding any deleted dup (any path), drifting a mirror
 * byte, or removing a master makes this exit 1. `--self-test` proves it.
 *
 * Exit codes: 0 clean, 1 violation, 2 script error / inconclusive.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

const MASTER_DIR = "packages/brand-assets";

export const MASTERS = [
  `${MASTER_DIR}/mingla-wordmark.png`,
  `${MASTER_DIR}/mingla-wordmark.svg`,
  `${MASTER_DIR}/mingla-wordmark-email.png`,
  `${MASTER_DIR}/mingla-business-logo.png`,
  `${MASTER_DIR}/mingla-business-logo.svg`,
  `${MASTER_DIR}/mingla-app-icon-500.png`,
];

/** mirror path → master path (mirror bytes MUST equal master bytes). */
export const MIRRORS = {
  "mingla-business/public/brand/mingla-business-logo.png":
    `${MASTER_DIR}/mingla-business-logo.png`,
  "mingla-business/public/brand/mingla-business-logo.svg":
    `${MASTER_DIR}/mingla-business-logo.svg`,
  "mingla-marketing/public/brand/mingla-business-logo.png":
    `${MASTER_DIR}/mingla-business-logo.png`,
  "mingla-marketing/public/brand/mingla-business-logo.svg":
    `${MASTER_DIR}/mingla-business-logo.svg`,
  "mingla-marketing/public/brand/mingla-wordmark.svg":
    `${MASTER_DIR}/mingla-wordmark.svg`,
  "mingla-marketing/public/brand/email/mingla-wordmark-email.png":
    `${MASTER_DIR}/mingla-wordmark-email.png`,
  "mingla-admin/public/mingla-icon.png": `${MASTER_DIR}/mingla-app-icon-500.png`,
};

/** Expo build inputs that legitimately share master bytes — checked, not repointed. */
export const DERIVATIVE_ANCHORS = {
  "app-mobile/assets/icon.png": `${MASTER_DIR}/mingla-app-icon-500.png`,
};

/** The 7 paths deleted by ISSUE-1001 — they must never reappear. */
export const DELETED_PATHS = [
  "mingla-admin/src/assets/mingla-logo.png",
  "mingla-admin/public/mingla-logo.png",
  "app-mobile/assets/6850c6540f4158618f67e1fdd72281118b419a35.png",
  "mingla-business/assets/mingla_official_logo.png",
  "app-mobile/assets/mingla_official_logo.png",
  "mingla-business/assets/brand/mingla-business-logo.png",
  "mingla-business/assets/brand/mingla-business-logo.svg",
];

function md5Of(buf) {
  return createHash("md5").update(buf).digest("hex");
}

/**
 * Pure check against an injectable filesystem view:
 *   fsView = {
 *     exists(rel): boolean,
 *     read(rel): Buffer,
 *     listTrackedImages(): string[]   // tracked .png/.svg relative paths
 *   }
 * Returns a violations string[].
 */
export function check(fsView) {
  const violations = [];
  const masterMd5 = new Map(); // master path → md5

  for (const master of MASTERS) {
    if (!fsView.exists(master)) {
      violations.push(`MASTER MISSING: ${master}`);
      continue;
    }
    masterMd5.set(master, md5Of(fsView.read(master)));
  }

  for (const [mirror, master] of Object.entries(MIRRORS)) {
    if (!fsView.exists(mirror)) {
      violations.push(`MIRROR MISSING: ${mirror} (serves ${master})`);
      continue;
    }
    if (!masterMd5.has(master)) continue; // master-missing already reported
    if (md5Of(fsView.read(mirror)) !== masterMd5.get(master)) {
      violations.push(
        `MIRROR DRIFT: ${mirror} is not byte-identical to ${master}. ` +
          `Update the MASTER first, then copy bytes to every mirror.`,
      );
    }
  }

  for (const [anchor, master] of Object.entries(DERIVATIVE_ANCHORS)) {
    if (!fsView.exists(anchor)) {
      violations.push(`DERIVATIVE ANCHOR MISSING: ${anchor}`);
      continue;
    }
    if (!masterMd5.has(master)) continue;
    if (md5Of(fsView.read(anchor)) !== masterMd5.get(master)) {
      violations.push(
        `DERIVATIVE ANCHOR DRIFT: ${anchor} no longer equals ${master} — ` +
          `if the store icon intentionally changed, update the master + this gate together.`,
      );
    }
  }

  for (const deleted of DELETED_PATHS) {
    if (fsView.exists(deleted)) {
      violations.push(
        `RESURRECTED DUPLICATE: ${deleted} was deleted by ISSUE-1001 — ` +
          `import from @mingla/brand-assets (or a registered mirror) instead.`,
      );
    }
  }

  // Content-level uniqueness: no tracked .png/.svg outside the registered
  // set may carry a master's bytes (catches resurrection under a NEW name).
  const allowed = new Set([
    ...MASTERS,
    ...Object.keys(MIRRORS),
    ...Object.keys(DERIVATIVE_ANCHORS),
  ]);
  const md5ToMaster = new Map(
    [...masterMd5.entries()].map(([p, h]) => [h, p]),
  );
  for (const rel of fsView.listTrackedImages()) {
    if (allowed.has(rel)) continue;
    let buf;
    try {
      buf = fsView.read(rel);
    } catch {
      continue; // tracked but deleted in worktree
    }
    const master = md5ToMaster.get(md5Of(buf));
    if (master !== undefined) {
      violations.push(
        `UNREGISTERED COPY: ${rel} is byte-identical to ${master} — ` +
          `delete it and import from @mingla/brand-assets, or register it as a mirror in this gate.`,
      );
    }
  }

  return violations;
}

function realFsView() {
  return {
    exists: (rel) => existsSync(path.join(REPO_ROOT, rel)),
    read: (rel) => readFileSync(path.join(REPO_ROOT, rel)),
    listTrackedImages: () => {
      const out = execFileSync(
        "git",
        ["ls-files", "-z", "*.png", "*.svg"],
        { cwd: REPO_ROOT, maxBuffer: 64 * 1024 * 1024 },
      );
      return out.toString("utf8").split("\0").filter(Boolean);
    },
  };
}

function selfTest() {
  const tmp = path.join(
    os.tmpdir(),
    `issue-1001-parity-selftest-${process.pid}`,
  );
  rmSync(tmp, { recursive: true, force: true });

  const seed = (rel, content) => {
    const abs = path.join(tmp, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  };
  const view = (extraTracked = []) => ({
    exists: (rel) => existsSync(path.join(tmp, rel)),
    read: (rel) => readFileSync(path.join(tmp, rel)),
    listTrackedImages: () => [
      ...MASTERS,
      ...Object.keys(MIRRORS),
      ...Object.keys(DERIVATIVE_ANCHORS),
      ...extraTracked,
    ],
  });

  // Pristine fixture tree: distinct bytes per mark, mirrors copied from masters.
  const bytesFor = (master) => Buffer.from(`bytes-of-${master}`);
  for (const master of MASTERS) seed(master, bytesFor(master));
  for (const [mirror, master] of Object.entries(MIRRORS)) {
    seed(mirror, bytesFor(master));
  }
  for (const [anchor, master] of Object.entries(DERIVATIVE_ANCHORS)) {
    seed(anchor, bytesFor(master));
  }

  const cases = [];
  cases.push(["all-parity fixture passes", check(view()).length === 0]);

  // Drift one mirror byte → fail.
  seed("mingla-admin/public/mingla-icon.png", Buffer.from("drifted-bytes"));
  cases.push([
    "one drifted mirror fails",
    check(view()).some((v) => v.startsWith("MIRROR DRIFT")),
  ]);
  seed(
    "mingla-admin/public/mingla-icon.png",
    bytesFor(`${MASTER_DIR}/mingla-app-icon-500.png`),
  );

  // Missing master → fail.
  rmSync(path.join(tmp, `${MASTER_DIR}/mingla-wordmark.png`));
  cases.push([
    "missing master fails",
    check(view()).some((v) => v.startsWith("MASTER MISSING")),
  ]);
  seed(`${MASTER_DIR}/mingla-wordmark.png`, bytesFor(`${MASTER_DIR}/mingla-wordmark.png`));

  // Resurrected deleted path → fail.
  seed("app-mobile/assets/mingla_official_logo.png", Buffer.from("zombie"));
  cases.push([
    "resurrected deleted path fails",
    check(view()).some((v) => v.startsWith("RESURRECTED DUPLICATE")),
  ]);
  rmSync(path.join(tmp, "app-mobile/assets/mingla_official_logo.png"));

  // Unregistered content copy under a NEW name → fail.
  seed(
    "mingla-business/assets/sneaky-copy.png",
    bytesFor(`${MASTER_DIR}/mingla-business-logo.png`),
  );
  cases.push([
    "unregistered byte-identical copy under a new name fails",
    check(view(["mingla-business/assets/sneaky-copy.png"])).some((v) =>
      v.startsWith("UNREGISTERED COPY")
    ),
  ]);

  rmSync(tmp, { recursive: true, force: true });

  let ok = true;
  for (const [name, pass] of cases) {
    if (!pass) {
      ok = false;
      console.error(`SELF-TEST FAIL: ${name}`);
    }
  }
  if (!ok) process.exit(1);
  console.log(
    `issue-1001-brand-asset-parity self-test OK (${cases.length}/${cases.length} cases).`,
  );
  process.exit(0);
}

function main() {
  if (process.argv.includes("--self-test")) selfTest();

  let violations;
  try {
    violations = check(realFsView());
  } catch (err) {
    console.error("issue-1001-brand-asset-parity: script error:", err.message);
    process.exit(2);
  }
  if (violations.length > 0) {
    console.error(
      "✗ ISSUE-1001 / I-PROPOSED-1001-BRAND-ASSET-CANON (b) — brand-asset parity broken:",
    );
    for (const v of violations) console.error("  - " + v);
    process.exit(1);
  }
  console.log(
    "✓ ISSUE-1001: single master per mark; all mirrors byte-identical; deleted dups still gone.",
  );
}

main();
