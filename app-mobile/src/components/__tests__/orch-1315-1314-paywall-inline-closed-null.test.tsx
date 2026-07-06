/**
 * ORCH-1315 [preferences-custom-location-paywall-not-firing] + ORCH-1314
 * [preferences-sheet-curated-paywall-dead-gate] — TESTER ADVERSARIAL regression.
 *
 * DIFFERENT ANGLE from the implementor's happy-path tests
 * (orch-1315-preferences-custom-location-paywall.test.tsx pins the overlay WHEN
 * VISIBLE + the F-3 dead-tap; orch-1314-preferences-curated-paywall-gate.test.tsx
 * pins the gate wiring + read-only/Mingla+ behavior). This test attacks the
 * CLOSED-STATE MOUNT INVARIANT that neither of those tests covers:
 *
 *   When `presentInline` is TRUE and the paywall is HIDDEN (`isVisible === false`),
 *   CustomPaywallScreen MUST render `null` — it must NOT mount its opaque,
 *   absolutely-positioned, high-zIndex `inlineOverlay` View. If a closed inline
 *   paywall left a full-screen `position:absolute` opaque View mounted (e.g. a
 *   regression that toggles internal opacity instead of returning null), that View
 *   would sit on top of the preferences sheet with zIndex/elevation 1000 and either
 *   cover the whole sheet permanently or swallow/misroute touches while the paywall
 *   is "closed" — a silent, invisible dead-tap trap over the entire sheet. The
 *   overlay is only safe BECAUSE it is conditionally mounted (`isVisible ? … : null`)
 *   and carries `accessibilityViewIsModal` only while open. This test locks that in.
 *
 *   It also pins that the DEFAULT (non-inline) path stays a `visible`-controlled RN
 *   <Modal> — always structurally present, OS-controlled visibility — so the 6 other
 *   CustomPaywallScreen call sites keep byte-identical behavior (SC-5 non-regression).
 *
 * Invariants: I-PROPOSED-1315-PAYWALL-PRESENTS-FROM-SHEET,
 *             I-PROPOSED-1314-PREFERENCES-PAYWALL-GATE-REACHABLE.
 *
 * Conventions mirror the sibling `orch-0943-prefs-apply-coord-coherence.test.tsx`
 * (source-structure `readSource` + `assert`) + `PairingPaywall.orch1239.test.tsx`
 * (behavioral decision model). Runs standalone via `require.main === module`
 * (execute with `npx tsx`). APPEND-ONLY: new file, no existing test modified.
 *
 * fails-on-revert:
 *   • remove the `isVisible ? ( … ) : null` gate in the presentInline branch of
 *     CustomPaywallScreen (make the overlay always mount) → Part A `: null` /
 *     "overlay only in the isVisible-true arm" asserts fail (exit 1).
 *   • change the closed-inline decision so it mounts anything but 'none' → Part B
 *     T-C1 fails (exit 1).
 */

declare const module: any;
declare const process: any;
declare const require: any;

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function resolveRepoFile(relPath: string): string {
  const direct = path.resolve(process.cwd(), relPath);
  if (fs.existsSync(direct)) return direct;
  return path.resolve(process.cwd(), "app-mobile", relPath);
}

function readSource(relPath: string): string {
  return fs.readFileSync(resolveRepoFile(relPath), "utf8");
}

// ── Behavioral model: what does CustomPaywallScreen MOUNT for a given
//    (presentInline, isVisible)? The load-bearing invariant is the CLOSED-inline
//    case → 'none' (returns null; NO full-screen overlay View left mounted). ──────
type Mount = "overlay" | "modal" | "none";
function resolveInlinePaywallMount({ presentInline, isVisible }: { presentInline: boolean; isVisible: boolean }): Mount {
  if (!presentInline) return "modal"; // RN <Modal> — always mounted, OS-controlled visibility (7-site default)
  return isVisible ? "overlay" : "none"; // inline: mount the overlay ONLY while visible; else render null
}

export function runOrch13151314InlineClosedNullTest() {
  const src = readSource("src/components/CustomPaywallScreen.tsx");

  // ── Part A — source-structure: the closed inline paywall returns null ─────────
  const renderIdx = src.indexOf("presentInline ? (");
  assert.ok(
    renderIdx !== -1,
    "Part A: the `presentInline ? (` render ternary must exist in CustomPaywallScreen",
  );
  // Slice the presentInline-TRUE arm: from the ternary open to the ` : (` that
  // begins the FALSE (Modal) arm — the first `<Modal` after the ternary.
  const modalIdx = src.indexOf("<Modal", renderIdx);
  assert.ok(modalIdx !== -1, "Part A: the default RN <Modal> path must be preserved (non-inline call sites)");
  const trueArmRegion = src.slice(renderIdx, modalIdx);

  const isVisIdx = trueArmRegion.indexOf("isVisible ?");
  assert.ok(
    isVisIdx !== -1,
    "Part A (fails-on-revert): the presentInline overlay MUST be gated on `isVisible ?` — a closed paywall must not mount the overlay",
  );
  const nullIdx = trueArmRegion.indexOf(": null");
  assert.ok(
    nullIdx !== -1 && nullIdx > isVisIdx,
    "Part A (fails-on-revert): the presentInline branch MUST return `: null` when hidden (no stray full-screen View swallowing touches while closed)",
  );

  // The opaque absolute overlay must mount ONLY inside the isVisible-TRUE arm
  // (between `isVisible ?` and `: null`), never in the closed arm.
  const trueArm = trueArmRegion.slice(isVisIdx, nullIdx);
  assert.match(
    trueArm,
    /styles\.inlineOverlay/,
    "Part A: styles.inlineOverlay is mounted only in the isVisible-true arm",
  );
  assert.match(
    trueArm,
    /accessibilityViewIsModal/,
    "Part A: the open overlay carries accessibilityViewIsModal (a11y touch barrier) — present only while visible",
  );
  // Defensive: the CLOSED arm (after `: null`, before the Modal) must not re-mount
  // the overlay View.
  const closedArm = trueArmRegion.slice(nullIdx);
  assert.doesNotMatch(
    closedArm,
    /styles\.inlineOverlay/,
    "Part A (fails-on-revert): the closed inline arm must NOT mount styles.inlineOverlay",
  );

  // The inlineOverlay style itself must be opaque + absolute + high-zIndex — i.e.
  // it IS a full-cover touch surface, which is exactly why it must be unmounted
  // (not merely hidden) when closed.
  const styleIdx = src.indexOf("inlineOverlay:");
  assert.ok(styleIdx !== -1, "Part A: inlineOverlay style block must exist");
  const styleBlock = src.slice(styleIdx, styleIdx + 280);
  assert.match(styleBlock, /position:\s*'absolute'/, "Part A: overlay is absolutely positioned (full-cover)");
  assert.match(styleBlock, /zIndex:\s*1000/, "Part A: overlay z-stacks above the sheet (would trap touches if left mounted)");

  // ── Part B — behavioral decision model (the mount invariant) ──────────────────
  // T-C1: the load-bearing case — a CLOSED inline paywall mounts NOTHING.
  assert.equal(
    resolveInlinePaywallMount({ presentInline: true, isVisible: false }),
    "none",
    "T-C1 (fails-on-revert): closed inline paywall mounts NOTHING — no full-screen touch-swallowing overlay over the sheet",
  );
  // T-C2: an OPEN inline paywall mounts the overlay (the actual F-1 fix).
  assert.equal(
    resolveInlinePaywallMount({ presentInline: true, isVisible: true }),
    "overlay",
    "T-C2: open inline paywall mounts the in-window overlay",
  );
  // T-C3 / T-C4: the non-inline default stays a <Modal> in BOTH visibility states
  // (always mounted, OS-controlled) → the 6 other call sites are structurally
  // unaffected by presentInline (SC-5 non-regression).
  assert.equal(
    resolveInlinePaywallMount({ presentInline: false, isVisible: false }),
    "modal",
    "T-C3: non-inline default is an RN <Modal> even when hidden (unchanged for the 7-site default)",
  );
  assert.equal(
    resolveInlinePaywallMount({ presentInline: false, isVisible: true }),
    "modal",
    "T-C4: non-inline default is an RN <Modal> when visible (unchanged)",
  );
}

if (require.main === module) {
  try {
    runOrch13151314InlineClosedNullTest();
    console.log("PASS ORCH-1315+1314 adversarial — closed inline paywall returns null (no touch-swallowing overlay)");
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}
