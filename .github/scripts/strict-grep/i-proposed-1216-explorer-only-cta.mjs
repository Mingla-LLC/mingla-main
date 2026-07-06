#!/usr/bin/env node
/**
 * ORCH-1216 [Explorer "Get the app" lead-capture] —
 * I-PROPOSED-1216-EXPLORER-ONLY-CTA.
 *
 * AMENDED by ORCH-1319 → BETA/ORGANISER-ONLY. The GetTheAppModal half is GONE:
 * ORCH-1319 deleted the explorer lead modal (the app is live on both public
 * stores; the explorer CTA now links straight to the store / desktop QR). What
 * remains — and what this gate STILL protects — is the LIVE organiser
 * `BetaAccessModal`: it must stay mounted organiser-only and must never be
 * cross-imported by any explorer surface. Do NOT delete this gate.
 *
 * WHY (organiser): the organiser (`/business`) surface mounts BetaAccessModal
 * (ORCH-1045). It must never leak onto the explorer surface. This gate asserts:
 *   1. <BetaAccessModal is mounted INSIDE a `surface === 'organiser'` guard in
 *      glass-nav.tsx.
 *   2. beta-access-modal.tsx does NOT import/mount a GetTheAppModal (the deleted
 *      explorer modal must never come back as a cross-import).
 *
 * `--self-test` injects fixtures (BetaAccessModal mounted in the explorer branch
 * → MUST fire; the compliant organiser-only mount → MUST pass).
 *
 * Model: orch-1211-notif-web-render-safe.mjs.
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd().endsWith("mingla-marketing")
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

const NAV = "mingla-marketing/components/marketing/glass-nav.tsx";
const BETA_MODAL = "mingla-marketing/components/marketing/beta-access-modal.tsx";

/**
 * Find the JSX mount of `<Tag` and verify it sits within a `surface === 'wanted'`
 * conditional region. Heuristic: locate the `<Tag` occurrence; require the
 * `surface === 'wanted'` marker to appear in the ~400 chars preceding the mount
 * (the `{surface === 'organiser' ? ( … <Modal /> … ) : null}` block), and require
 * the OPPOSITE surface marker NOT to be the nearest-preceding guard.
 */
function mountGuardedBy(src, tag, wanted, other) {
  const idx = src.indexOf(tag);
  if (idx === -1) return { found: false };
  const before = src.slice(Math.max(0, idx - 400), idx);
  const wantedMarker = `surface === '${wanted}'`;
  const otherMarker = `surface === '${other}'`;
  const wantedPos = before.lastIndexOf(wantedMarker);
  const otherPos = before.lastIndexOf(otherMarker);
  // The wanted guard must be present AND be the nearest-preceding surface guard.
  const guarded = wantedPos !== -1 && wantedPos > otherPos;
  return { found: true, guarded };
}

function checkNav(src, failures) {
  const beta = mountGuardedBy(src, "<BetaAccessModal", "organiser", "explorer");
  if (!beta.found) {
    failures.push(`${NAV}: <BetaAccessModal is not mounted at all (organiser CTA wiring broke).`);
  } else if (!beta.guarded) {
    failures.push(
      `${NAV}: <BetaAccessModal is NOT inside a \`surface === 'organiser'\` guard ` +
        `(it must never mount on the explorer surface).`,
    );
  }
}

function checkNoCrossRef(src, label, bannedSymbol, failures) {
  if (src.includes(bannedSymbol)) {
    failures.push(
      `${label}: references "${bannedSymbol}" — the organiser beta modal must never ` +
        `cross-import/mount the (deleted) explorer get-the-app modal.`,
    );
  }
}

// ---- Self-test
if (process.argv.includes("--self-test")) {
  const selfFailures = [];
  const runNav = (src) => {
    const f = [];
    checkNav(src, f);
    return f;
  };

  // (a) Compliant organiser-only mount → MUST pass.
  const good = `
{surface === 'organiser' ? (
  <BetaAccessModal open={betaOpen} onClose={x} source="organiser_marketing_nav" />
) : null}
{surface === 'explorer' ? (
  <AppQrPanel open={qrOpen} onClose={y} />
) : null}
`;
  if (runNav(good).length !== 0) {
    selfFailures.push("compliant organiser-only BetaAccessModal mount wrongly flagged");
  }

  // (b) BetaAccessModal mounted in the EXPLORER branch → MUST fire.
  const crossed = `
{surface === 'explorer' ? (
  <BetaAccessModal open={betaOpen} onClose={x} source="organiser_marketing_nav" />
) : null}
`;
  if (runNav(crossed).length === 0) {
    selfFailures.push("BetaAccessModal mounted in the explorer branch not flagged");
  }

  // (c) BetaAccessModal not mounted at all → MUST fire.
  const missing = `
{surface === 'explorer' ? (
  <AppQrPanel open={qrOpen} onClose={y} />
) : null}
`;
  if (runNav(missing).length === 0) {
    selfFailures.push("missing BetaAccessModal mount not flagged");
  }

  // (d) Cross-ref guard: the beta modal importing the deleted GetTheAppModal → MUST fire.
  const crossRef = [];
  checkNoCrossRef("import { GetTheAppModal } from '...'", "fixture", "GetTheAppModal", crossRef);
  if (crossRef.length === 0) {
    selfFailures.push("cross-import of GetTheAppModal not flagged");
  }

  if (selfFailures.length) {
    console.error("ORCH-1216 I-PROPOSED-1216-EXPLORER-ONLY-CTA self-test FAIL:");
    selfFailures.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log(
    "ORCH-1216 I-PROPOSED-1216-EXPLORER-ONLY-CTA self-test PASS (4/4 cases; " +
      "AMENDED beta/organiser-only by ORCH-1319 — explorer modal deleted).",
  );
  process.exit(0);
}

// ---- Live mode
const failures = [];
const navAbs = path.join(root, NAV);
if (!fs.existsSync(navAbs)) {
  console.error(`ORCH-1216 gate FAIL — target not found at ${NAV} (gate path out of sync).`);
  process.exit(1);
}
checkNav(fs.readFileSync(navAbs, "utf8"), failures);

const betaAbs = path.join(root, BETA_MODAL);
if (fs.existsSync(betaAbs)) {
  checkNoCrossRef(fs.readFileSync(betaAbs, "utf8"), BETA_MODAL, "GetTheAppModal", failures);
} else {
  failures.push(`${BETA_MODAL}: not found (gate path out of sync).`);
}

if (failures.length > 0) {
  console.error(
    "ORCH-1216 I-PROPOSED-1216-EXPLORER-ONLY-CTA FAIL — the organiser beta modal must\n" +
      "stay mounted organiser-only and never cross-import the (deleted) explorer modal.\n\nFailures:\n  " +
      failures.join("\n  "),
  );
  process.exit(1);
}
console.log(
  "ORCH-1216 I-PROPOSED-1216-EXPLORER-ONLY-CTA PASS — BetaAccessModal is organiser-\n" +
    "only; no cross-import of the deleted explorer get-the-app modal (AMENDED by ORCH-1319).",
);
