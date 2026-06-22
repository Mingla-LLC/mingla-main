#!/usr/bin/env node
/**
 * ORCH-1216 [Explorer "Get the app" lead-capture] —
 * I-PROPOSED-1216-EXPLORER-ONLY-CTA.
 *
 * WHY: the explorer surface mounts GetTheAppModal; the organiser surface keeps
 * BetaAccessModal (ORCH-1045). Neither modal may cross surfaces. This gate
 * asserts, in glass-nav.tsx:
 *   1. <GetTheAppModal is mounted INSIDE a `surface === 'explorer'` guard.
 *   2. <BetaAccessModal is mounted INSIDE a `surface === 'organiser'` guard.
 * and in the two modal files:
 *   3. get-the-app-modal.tsx does NOT import/mount BetaAccessModal.
 *   4. beta-access-modal.tsx does NOT import/mount GetTheAppModal.
 *
 * `--self-test` injects fixtures (GetTheAppModal mounted in the organiser branch
 * → MUST fire; the compliant split → MUST pass).
 *
 * Model: orch-1211-notif-web-render-safe.mjs.
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd().endsWith("mingla-marketing")
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

const NAV = "mingla-marketing/components/marketing/glass-nav.tsx";
const GETAPP_MODAL = "mingla-marketing/components/marketing/get-the-app-modal.tsx";
const BETA_MODAL = "mingla-marketing/components/marketing/beta-access-modal.tsx";

/**
 * Find the JSX mount of `<Tag` and verify it sits within a `surface === 'wanted'`
 * conditional region. Heuristic: locate each `<Tag` occurrence; require the
 * `surface === 'wanted'` marker to appear in the ~400 chars preceding the mount
 * (the `{surface === 'explorer' ? ( … <Modal /> … ) : null}` block), and require
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
  const app = mountGuardedBy(src, "<GetTheAppModal", "explorer", "organiser");
  if (!app.found) {
    failures.push(`${NAV}: <GetTheAppModal is not mounted at all (explorer CTA wiring missing).`);
  } else if (!app.guarded) {
    failures.push(
      `${NAV}: <GetTheAppModal is NOT inside a \`surface === 'explorer'\` guard ` +
        `(it must never mount on the organiser surface).`,
    );
  }
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
      `${label}: references "${bannedSymbol}" — the explorer + organiser modals ` +
        `must never cross-import/mount each other.`,
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

  // (a) Compliant split → MUST pass.
  const good = `
{surface === 'organiser' ? (
  <BetaAccessModal open={betaOpen} onClose={x} source="organiser_marketing_nav" />
) : null}
{surface === 'explorer' ? (
  <GetTheAppModal open={appOpen} onClose={y} source="explorer_marketing_nav" />
) : null}
`;
  if (runNav(good).length !== 0) {
    selfFailures.push("compliant explorer/organiser split wrongly flagged");
  }

  // (b) GetTheAppModal mounted in the ORGANISER branch → MUST fire.
  const crossed = `
{surface === 'organiser' ? (
  <GetTheAppModal open={appOpen} onClose={y} source="explorer_marketing_nav" />
) : null}
{surface === 'organiser' ? (
  <BetaAccessModal open={betaOpen} onClose={x} source="organiser_marketing_nav" />
) : null}
`;
  if (runNav(crossed).length === 0) {
    selfFailures.push("GetTheAppModal mounted in the organiser branch not flagged");
  }

  // (c) BetaAccessModal mounted in the EXPLORER branch → MUST fire.
  const crossed2 = `
{surface === 'explorer' ? (
  <BetaAccessModal open={betaOpen} onClose={x} source="organiser_marketing_nav" />
) : null}
{surface === 'explorer' ? (
  <GetTheAppModal open={appOpen} onClose={y} source="explorer_marketing_nav" />
) : null}
`;
  if (runNav(crossed2).length === 0) {
    selfFailures.push("BetaAccessModal mounted in the explorer branch not flagged");
  }

  // (d) Cross-ref guard: a modal importing the other → MUST fire.
  const crossRef = [];
  checkNoCrossRef("import { BetaAccessModal } from '...'", "fixture", "BetaAccessModal", crossRef);
  if (crossRef.length === 0) {
    selfFailures.push("cross-import of BetaAccessModal not flagged");
  }

  if (selfFailures.length) {
    console.error("ORCH-1216 I-PROPOSED-1216-EXPLORER-ONLY-CTA self-test FAIL:");
    selfFailures.forEach((m) => console.error("  - " + m));
    process.exit(1);
  }
  console.log(
    "ORCH-1216 I-PROPOSED-1216-EXPLORER-ONLY-CTA self-test PASS (4/4 cases).",
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

const getappAbs = path.join(root, GETAPP_MODAL);
if (fs.existsSync(getappAbs)) {
  checkNoCrossRef(fs.readFileSync(getappAbs, "utf8"), GETAPP_MODAL, "BetaAccessModal", failures);
} else {
  failures.push(`${GETAPP_MODAL}: not found (gate path out of sync).`);
}

const betaAbs = path.join(root, BETA_MODAL);
if (fs.existsSync(betaAbs)) {
  checkNoCrossRef(fs.readFileSync(betaAbs, "utf8"), BETA_MODAL, "GetTheAppModal", failures);
} else {
  failures.push(`${BETA_MODAL}: not found (gate path out of sync).`);
}

if (failures.length > 0) {
  console.error(
    "ORCH-1216 I-PROPOSED-1216-EXPLORER-ONLY-CTA FAIL — the explorer + organiser\n" +
      "lead modals must stay surface-scoped and never cross.\n\nFailures:\n  " +
      failures.join("\n  "),
  );
  process.exit(1);
}
console.log(
  "ORCH-1216 I-PROPOSED-1216-EXPLORER-ONLY-CTA PASS — GetTheAppModal is explorer-\n" +
    "only, BetaAccessModal organiser-only; no cross-import between the two modals.",
);
