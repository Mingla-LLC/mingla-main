#!/usr/bin/env node
/**
 * ORCH-1150 [snap suggestions auto-draft + navigate to drafts] — structural gate.
 *
 * WHY: the business snap flow (app/experience/snap.tsx) used to render a
 * transient per-card "Suggested experiences" review (ExperienceReviewCards →
 * Accept/Edit/Reject) where ONLY tapping Accept turned a proposal into a draft;
 * leaving the screen stranded the proposals. ORCH-1150 replaces that with
 * auto-draft-ALL: the instant the parser returns N≥1 suggestions, every
 * proposal is confirmed into a draft (client loop over the existing confirm
 * path) and the brand is navigated to the Hub Experiences (Drafts) tab. The
 * per-card review surface is DELETED.
 *
 * RULE — this gate asserts ALL of (SPEC §9):
 *   1. app/experience/snap.tsx does NOT import/reference ExperienceReviewCards
 *      (FAIL if the per-card review is reintroduced).
 *   2. ExperienceReviewCards.tsx + ExperienceConfirmationCard.tsx do NOT exist
 *      on disk (FAIL if restored).
 *   3. snap.tsx references `confirmAll` AND `router.replace(...)` to
 *      "/(tabs)/hub/experiences" (FAIL if the auto-draft+navigate is reverted).
 *   4. AriChatScreen.tsx does NOT import usePendingExperiences/confirmAll and
 *      STILL imports useConfirmPendingAction (FAIL if auto-confirm bleeds into
 *      Ari — Ari keeps MANUAL per-action confirm).
 *
 * Self-test (--self-test) runs synthetic violating + passing fixtures so the
 * gate provably catches the bug class.
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd().endsWith("mingla-business")
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

const SNAP = path.join(root, "mingla-business/app/experience/snap.tsx");
const ARI = path.join(root, "mingla-business/src/screens/ari/AriChatScreen.tsx");
const REVIEW_CARDS = path.join(
  root,
  "mingla-business/src/components/experience/ExperienceReviewCards.tsx",
);
const CONFIRM_CARD = path.join(
  root,
  "mingla-business/src/components/experience/ExperienceConfirmationCard.tsx",
);

// ── Pure checks (operate on source strings) so --self-test can reuse them. ──
const REVIEW_REF = /ExperienceReviewCards/;
const CONFIRM_ALL_REF = /\bconfirmAll\b/;
const REPLACE_TO_DRAFTS =
  /router\.replace\(\s*[A-Za-z0-9_]*[^)]*\)/; // any router.replace(...)
const DRAFTS_ROUTE_LITERAL = /"\/\(tabs\)\/hub\/experiences"/;

function checkSnapSource(src, failures) {
  // (1) no per-card review reintroduced
  if (REVIEW_REF.test(src)) {
    failures.push(
      "snap.tsx references ExperienceReviewCards — the per-card Accept/Reject review must NOT be reintroduced (ORCH-1150 §9.1).",
    );
  }
  // (3) auto-draft+navigate present
  if (!CONFIRM_ALL_REF.test(src)) {
    failures.push(
      "snap.tsx does not reference `confirmAll` — the auto-draft-all loop is missing (ORCH-1150 §9.3).",
    );
  }
  if (!REPLACE_TO_DRAFTS.test(src) || !DRAFTS_ROUTE_LITERAL.test(src)) {
    failures.push(
      'snap.tsx must `router.replace(...)` to "/(tabs)/hub/experiences" after auto-draft (ORCH-1150 §9.3).',
    );
  }
}

function checkAriSource(src, failures) {
  // (4) Ari must keep manual confirm + must not pull the auto-confirm hook
  if (/usePendingExperiences/.test(src) || CONFIRM_ALL_REF.test(src)) {
    failures.push(
      "AriChatScreen.tsx references usePendingExperiences/confirmAll — auto-confirm must NOT bleed into Ari; Ari keeps MANUAL per-action confirm (ORCH-1150 §9.4 / SC-8).",
    );
  }
  if (!/useConfirmPendingAction/.test(src)) {
    failures.push(
      "AriChatScreen.tsx no longer imports useConfirmPendingAction — Ari's manual confirm path regressed (ORCH-1150 §9.4 / SC-8).",
    );
  }
}

// ── Self-test ───────────────────────────────────────────────────────────────
if (process.argv.includes("--self-test")) {
  const selfFailures = [];
  const expect = (label, fn, src, shouldFail) => {
    const f = [];
    fn(src, f);
    const failed = f.length > 0;
    if (failed !== shouldFail) {
      selfFailures.push(
        `SELF-TEST "${label}": expected ${shouldFail ? "FAIL" : "PASS"}, got ${failed ? "FAIL" : "PASS"}`,
      );
    }
  };

  const goodSnap = `
    const ids = result.pending_actions.map((p) => p.id);
    const tally = await confirmAll(ids);
    router.replace("/(tabs)/hub/experiences" as never);
  `;
  const revertedSnap = `
    import { ExperienceReviewCards } from "../../src/components/experience/ExperienceReviewCards";
    onAccept={async (id) => { await confirm({ id }); }}
  `;
  const noNavSnap = `const tally = await confirmAll(ids);`;

  expect("good snap (auto-draft+navigate)", checkSnapSource, goodSnap, false);
  expect("reverted snap (per-card review)", checkSnapSource, revertedSnap, true);
  expect("snap missing navigate", checkSnapSource, noNavSnap, true);

  const goodAri = `import { useConfirmPendingAction } from "../../hooks/useConfirmPendingAction";
    const confirm = useConfirmPendingAction(chat.conversationId);`;
  const ariBleed = `import { useConfirmPendingAction } from "../../hooks/useConfirmPendingAction";
    import { usePendingExperiences } from "../../hooks/usePendingExperiences";`;
  const ariNoManual = `const x = 1;`;

  expect("good Ari (manual confirm only)", checkAriSource, goodAri, false);
  expect("Ari auto-confirm bleed", checkAriSource, ariBleed, true);
  expect("Ari lost manual confirm", checkAriSource, ariNoManual, true);

  if (selfFailures.length) {
    console.error("ORCH-1150 gate SELF-TEST FAILED:");
    selfFailures.forEach((f) => console.error("  - " + f));
    process.exit(1);
  }
  console.log("ORCH-1150 gate self-test PASS (6/6 cases).");
  process.exit(0);
}

// ── npm wiring check ─────────────────────────────────────────────────────────
function checkNpmWiring(failures) {
  const pkgPath = path.join(root, "mingla-business/package.json");
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  } catch (error) {
    failures.push(`ORCH-1150 wiring: mingla-business/package.json parse failed: ${error.message}`);
    return;
  }
  const script = pkg.scripts?.["test:orch-1150"];
  if (typeof script !== "string" || !script.includes("orch-1150-snap-auto-draft.mjs")) {
    failures.push(
      "ORCH-1150 wiring: mingla-business/package.json missing scripts[\"test:orch-1150\"] pointing at the gate script.",
    );
  }
}

const failures = [];

// (2) deleted-on-disk
if (fs.existsSync(REVIEW_CARDS)) {
  failures.push(
    "ExperienceReviewCards.tsx still exists on disk — the per-card review component must be DELETED (ORCH-1150 §9.2).",
  );
}
if (fs.existsSync(CONFIRM_CARD)) {
  failures.push(
    "ExperienceConfirmationCard.tsx still exists on disk — the per-card confirmation component must be DELETED (ORCH-1150 §9.2).",
  );
}

if (!fs.existsSync(SNAP)) {
  failures.push(`ORCH-1150: snap route not found at ${SNAP}.`);
} else {
  checkSnapSource(fs.readFileSync(SNAP, "utf8"), failures);
}

if (!fs.existsSync(ARI)) {
  failures.push(`ORCH-1150: AriChatScreen not found at ${ARI}.`);
} else {
  checkAriSource(fs.readFileSync(ARI, "utf8"), failures);
}

// No other importer of the deleted components anywhere in the business tree.
function grepImporters(dir, failures) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      grepImporters(full, failures);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      const src = fs.readFileSync(full, "utf8");
      if (
        /ExperienceReviewCards|ExperienceConfirmationCard/.test(src) &&
        !full.endsWith("orch-1150-snap-auto-draft.mjs")
      ) {
        failures.push(
          `${path.relative(root, full)}: still imports/references a deleted review component (ExperienceReviewCards/ExperienceConfirmationCard) — ORCH-1150 §9.1/§9.2.`,
        );
      }
    }
  }
}
grepImporters(path.join(root, "mingla-business/src"), failures);
grepImporters(path.join(root, "mingla-business/app"), failures);

checkNpmWiring(failures);

if (failures.length) {
  console.error("ORCH-1150 snap auto-draft gate FAILED:");
  failures.forEach((f) => console.error("  - " + f));
  process.exit(1);
}
console.log(
  "ORCH-1150 gate PASS: snap auto-drafts all suggestions + navigates to drafts; review components deleted; Ari manual-confirm untouched.",
);
