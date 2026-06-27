// @ts-nocheck
// META-ORCH-1233 Item 3 — ADVERSARIAL (tester). DIFFERENT ANGLE than the implementor's
// single hardcoded {x:155,width:155}: this test reconstructs the REAL two-tab box model
// from the actual style tokens (capsule borderWidth, tabs1016Row paddingHorizontal,
// flex:1 split) for a realistic screen width, computes the spotlight rect for BOTH
// Events-active AND Trips-active, and asserts the NO-BLEED INVARIANT — the pill's left
// edge sits at the active tab's content-left and its right edge never crosses onto the
// neighbor — at the CORRECTED targetX, and PROVES the OLD (buggy) targetX violated it.
// Also sweeps spotlightInset values (so the term still composes) and guards targetWidth.
//
// Append-only / immutable. Run: `node <thisfile>`.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function resolveRepoFile(relPath) {
  const direct = path.resolve(process.cwd(), relPath);
  if (fs.existsSync(direct)) return direct;
  return path.resolve(process.cwd(), 'app-mobile', relPath);
}
function readSource(relPath) {
  return fs.readFileSync(resolveRepoFile(relPath), 'utf8');
}

// Pull the real constants from source so the model can't drift from the shipped code.
function extractTokens() {
  const src = readSource('src/components/DiscoverScreen.tsx');
  const rowPad = Number((src.match(/const\s+TABS_1016_ROW_PADDING_H\s*=\s*(\d+)/) || [])[1]);
  const stylePad = Number((src.match(/tabs1016Row:\s*\{[\s\S]*?paddingHorizontal:\s*(\d+)/) || [])[1]);
  const capsuleBorder = Number(
    (src.match(/pillBar1016Capsule:\s*\{[\s\S]*?borderWidth:\s*(\d+)/) || [])[1],
  );
  // spotlightInset lives in designSystem.ts
  const ds = readSource('src/constants/designSystem.ts');
  const inset = Number((ds.match(/spotlightInset:\s*(\d+)/) || [])[1]);
  return { rowPad, stylePad, capsuleBorder, inset };
}

// Reconstruct the capsule padding-box and the two tabs' onLayout (parent-relative) x/width.
// Capsule is full-bleed minus the absolute container's filterBar paddingHorizontal; the
// exact outer width is irrelevant to the bleed invariant — what matters is the row's
// content box and the two flex:1 tabs inside it. We model a concrete content width.
function buildBoxModel({ rowContentWidth, rowPad }) {
  // tabs1016Row content box starts at +rowPad inside the capsule padding-box.
  // Two flex:1 tabs split rowContentWidth evenly; onLayout.x is row-content-relative.
  const tabW = rowContentWidth / 2;
  // onLayout x is relative to tabs1016Row (its PADDING box origin == content origin here
  // since RN onLayout for flex children is measured from the parent's content box start).
  const events = { x: 0, width: tabW };
  const trips = { x: tabW, width: tabW };
  // The capsule padding-box origin is rowPad to the LEFT of the row content box.
  // So a tab's TRUE left in capsule-space = rowPad + layout.x.
  return { events, trips, tabW, rowPad };
}

function spotlightRect(layout, { rowPad, inset, useFix }) {
  const targetX = (useFix ? rowPad : 0) + layout.x + inset;
  const targetWidth = layout.width - inset * 2;
  return { left: targetX, right: targetX + targetWidth, width: targetWidth };
}

// True tab extent in capsule-space (the space spotlight.left lives in).
function tabExtent(layout, rowPad) {
  const left = rowPad + layout.x;
  return { left, right: left + layout.width };
}

function runItem3Adversarial() {
  const { rowPad, stylePad, capsuleBorder, inset } = extractTokens();
  assert.equal(rowPad, 4, 'Item3-adv: TABS_1016_ROW_PADDING_H must be 4');
  assert.equal(stylePad, rowPad, 'Item3-adv: drift — style padding must equal the constant');
  assert.equal(inset, 0, 'Item3-adv: spotlightInset is 0 in designSystem (no-op term)');
  assert.equal(capsuleBorder, 1, 'Item3-adv: capsule borderWidth sanity (1)');

  // Realistic content width (e.g. 360px capsule inner). Bleed invariant must hold for any.
  for (const rowContentWidth of [320, 351, 360, 400]) {
    const bm = buildBoxModel({ rowContentWidth, rowPad });
    const tol = 0.5; // px

    for (const [name, layout] of [['events', bm.events], ['trips', bm.trips]]) {
      const tab = tabExtent(layout, rowPad);

      // ── FIXED: pill left aligns to the tab's true content-left within tolerance,
      //    and right edge does NOT cross the tab's right edge (no neighbor bleed). ──
      const fixed = spotlightRect(layout, { rowPad, inset, useFix: true });
      assert.ok(
        Math.abs(fixed.left - tab.left) <= tol,
        `Item3-adv[${name}@${rowContentWidth}]: FIXED pill left (${fixed.left}) must align to tab left (${tab.left})`,
      );
      assert.ok(
        fixed.right <= tab.right + tol,
        `Item3-adv[${name}@${rowContentWidth}]: FIXED pill right (${fixed.right}) must not exceed tab right (${tab.right})`,
      );
      // Pill width must still be full tab width (targetWidth unchanged at inset 0).
      assert.equal(fixed.width, layout.width, `Item3-adv[${name}]: FIXED width === tab width`);
    }

    // ── PROVE the OLD math bled: with Trips active, the buggy pill (useFix:false)
    //    overhangs LEFT into Events' territory by exactly rowPad px. ──
    const buggyTrips = spotlightRect(bm.trips, { rowPad, inset, useFix: false });
    const tripsExtent = tabExtent(bm.trips, rowPad);
    const eventsExtent = tabExtent(bm.events, rowPad);
    assert.equal(
      buggyTrips.left,
      tripsExtent.left - rowPad,
      `Item3-adv[trips@${rowContentWidth}]: BUGGY pill left is rowPad too far left (proves the bleed)`,
    );
    // The buggy left edge lands INSIDE the Events tab extent → visible bleed onto Events.
    assert.ok(
      buggyTrips.left < eventsExtent.right,
      `Item3-adv[trips@${rowContentWidth}]: BUGGY pill left (${buggyTrips.left}) bleeds into Events (ends ${eventsExtent.right})`,
    );
    // And the FIXED version does NOT bleed into Events.
    const fixedTrips = spotlightRect(bm.trips, { rowPad, inset, useFix: true });
    assert.ok(
      fixedTrips.left >= eventsExtent.right - tol,
      `Item3-adv[trips@${rowContentWidth}]: FIXED pill left (${fixedTrips.left}) must not enter Events (ends ${eventsExtent.right})`,
    );
  }

  // ── spotlightInset sweep: the rowPad term must COMPOSE with a non-zero inset
  //    (so a future inset raise still aligns). targetX = rowPad + x + inset. ──
  for (const sweepInset of [0, 2, 4]) {
    const bm = buildBoxModel({ rowContentWidth: 360, rowPad });
    const r = spotlightRect(bm.trips, { rowPad, inset: sweepInset, useFix: true });
    const tab = tabExtent(bm.trips, rowPad);
    // With inset, pill insets symmetrically: left = tab.left + inset, width = tabW - 2*inset.
    assert.equal(r.left, tab.left + sweepInset, `Item3-adv: inset ${sweepInset} → left = tabLeft + inset`);
    assert.equal(r.width, bm.tabW - sweepInset * 2, `Item3-adv: inset ${sweepInset} → width = tabW - 2*inset`);
    // Still no right-edge bleed.
    assert.ok(r.right <= tab.right + 0.5, `Item3-adv: inset ${sweepInset} → no right bleed`);
  }

  // ── targetWidth integrity guard: source must NOT have altered the width formula. ──
  const src = readSource('src/components/DiscoverScreen.tsx');
  assert.match(
    src,
    /const\s+targetWidth\s*=\s*layout\.width\s*-\s*cc\.nav\.spotlightInset\s*\*\s*2;/,
    'Item3-adv: targetWidth formula must remain layout.width - inset*2 (untouched)',
  );
  // And targetX must include the rowPad term (the actual fix).
  assert.match(
    src,
    /const\s+targetX\s*=\s*TABS_1016_ROW_PADDING_H\s*\+\s*layout\.x\s*\+\s*cc\.nav\.spotlightInset;/,
    'Item3-adv: targetX must add TABS_1016_ROW_PADDING_H',
  );
}

if (require.main === module) {
  try {
    runItem3Adversarial();
    console.log('PASS META-ORCH-1233 Item3 ADVERSARIAL no-bleed invariant (both tabs) + inset sweep');
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

module.exports = { runItem3Adversarial };
