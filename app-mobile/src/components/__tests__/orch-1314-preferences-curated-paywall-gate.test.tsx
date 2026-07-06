/**
 * ORCH-1314 [preferences-sheet-curated-paywall-dead-gate] — the "See curated
 * experiences?" section's Mingla+ paywall must be REACHABLE for free users.
 *
 * WHY this test exists (fails-on-revert contract):
 *   The curated section is Mingla+-only, but its paywall was unreachable: the lock
 *   banner was hidden behind a hardcoded `isCuratedLocked={false}` (dead literal),
 *   and the section's controls had no gate — a free user saw it fully unlocked and
 *   could toggle/select with no paywall. The fix wires the gate to the real signal
 *   (`!canAccess('curated_cards')`) and gates the interaction handlers so a locked
 *   free-user tap on the banner, the Switch, OR an experience-type pill presents the
 *   curated paywall (OQ-1 = option (b), Seth 2026-07-05). Gate policy is unchanged
 *   (curated stays Mingla+-only). Invariant
 *   I-PROPOSED-1314-PREFERENCES-PAYWALL-GATE-REACHABLE.
 *
 * Conventions mirror `orch-0943-prefs-apply-coord-coherence.test.tsx` (source
 * pins) + `connections/__tests__/PairingPaywall.orch1239.test.tsx` (decision
 * model). Runs standalone via `require.main === module` (execute with `npx tsx`).
 *
 * fails-on-revert:
 *   • revert line ~1279 to `isCuratedLocked={false}` → Part A match/doesNotMatch fail.
 *   • remove the `!canAccess('curated_cards')` short-circuit from
 *     `handleIntentToggleChange` (Switch) or `handleIntentToggle` (pills) → Part A
 *     body asserts + Part B T-2/T-5 fail.
 */

declare const module: any;
declare const process: any;
declare const require: any;

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function resolveRepoFile(relPath: string): string {
  const appMobilePath = path.resolve(process.cwd(), relPath);
  if (fs.existsSync(appMobilePath)) return appMobilePath;
  return path.resolve(process.cwd(), "app-mobile", relPath);
}

function readSource(relPath: string): string {
  return fs.readFileSync(resolveRepoFile(relPath), "utf8");
}

// ── Behavioral decision models (mirror the fixed handlers) ────────────────────
type CuratedTap = { showPaywall: boolean; feature?: string; mutated?: boolean };

// handleIntentToggleChange (the "See curated experiences?" Switch).
function resolveCuratedToggleTap({ isEditable, canAccessCurated }: { isEditable: boolean; canAccessCurated: boolean }): CuratedTap {
  if (!isEditable) return { showPaywall: false };
  if (!canAccessCurated) return { showPaywall: true, feature: "curated_cards" };
  return { showPaywall: false, mutated: true };
}

// handleIntentToggle (experience-type pills) — same gate (OQ-1 = option b).
function resolveCuratedPillTap({ isEditable, canAccessCurated }: { isEditable: boolean; canAccessCurated: boolean }): CuratedTap {
  if (!isEditable) return { showPaywall: false };
  if (!canAccessCurated) return { showPaywall: true, feature: "curated_cards" };
  return { showPaywall: false, mutated: true };
}

export function runOrch1314CuratedPaywallGateTest() {
  const prefs = readSource("src/components/PreferencesSheet.tsx");

  // ── Part A — source-structure pins (catch the exact revert) ──────────────────
  assert.match(
    prefs,
    /isCuratedLocked=\{!canAccess\('curated_cards'\)\}/,
    "Part A (fails-on-revert): isCuratedLocked MUST be wired to !canAccess('curated_cards')",
  );
  assert.doesNotMatch(
    prefs,
    /isCuratedLocked=\{false\}/,
    "Part A (fails-on-revert): the dead literal `isCuratedLocked={false}` must be gone",
  );

  // handleIntentToggleChange (Switch) short-circuits to the paywall BEFORE mutating.
  const toggleStart = prefs.indexOf("const handleIntentToggleChange = useCallback(");
  assert.ok(toggleStart !== -1, "Part A: handleIntentToggleChange must exist");
  const toggleBlock = prefs.slice(toggleStart, prefs.indexOf("}, [", toggleStart));
  const toggleGateIdx = toggleBlock.indexOf("!canAccess('curated_cards')");
  const toggleSetIntentIdx = toggleBlock.indexOf("setIntentToggle(newValue)");
  assert.ok(toggleGateIdx !== -1, "Part A (fails-on-revert): handleIntentToggleChange must gate on !canAccess('curated_cards')");
  assert.match(toggleBlock, /setPaywallFeature\('curated_cards'\)/, "Part A: Switch gate sets curated feature");
  assert.match(toggleBlock, /setShowPaywall\(true\)/, "Part A: Switch gate opens the paywall");
  assert.ok(
    toggleGateIdx < toggleSetIntentIdx,
    "Part A: the paywall short-circuit must come BEFORE setIntentToggle (no silent flip)",
  );
  assert.match(toggleBlock, /canAccess/, "Part A: canAccess referenced in handleIntentToggleChange");

  // handleIntentToggle (pills) short-circuits to the paywall BEFORE selecting.
  const pillStart = prefs.indexOf("const handleIntentToggle = useCallback(");
  assert.ok(pillStart !== -1, "Part A: handleIntentToggle must exist");
  const pillBlock = prefs.slice(pillStart, prefs.indexOf("}, [", pillStart));
  const pillGateIdx = pillBlock.indexOf("!canAccess('curated_cards')");
  const pillSelectIdx = pillBlock.indexOf("setSelectedIntents(");
  assert.ok(pillGateIdx !== -1, "Part A (fails-on-revert): handleIntentToggle must gate on !canAccess('curated_cards')");
  assert.ok(
    pillGateIdx < pillSelectIdx,
    "Part A: the pill paywall short-circuit must come BEFORE setSelectedIntents (no silent select)",
  );

  // ── Part B — behavioral decision model ───────────────────────────────────────
  // T-2: free user taps Switch → paywall, intent NOT mutated.
  {
    const r = resolveCuratedToggleTap({ isEditable: true, canAccessCurated: false });
    assert.equal(r.showPaywall, true, "T-2: free → paywall");
    assert.equal(r.feature, "curated_cards", "T-2: feature is curated_cards");
    assert.notEqual(r.mutated, true, "T-2: intent NOT mutated for a locked free user");
  }
  // T-3: read-only participant view → NO paywall.
  {
    const r = resolveCuratedToggleTap({ isEditable: false, canAccessCurated: false });
    assert.equal(r.showPaywall, false, "T-3: read-only → no paywall");
  }
  // T-4: Mingla+ user → mutates normally, no paywall.
  {
    const r = resolveCuratedToggleTap({ isEditable: true, canAccessCurated: true });
    assert.equal(r.showPaywall, false, "T-4: Mingla+ → no paywall");
    assert.equal(r.mutated, true, "T-4: Mingla+ toggle mutates normally");
  }
  // T-5: free user taps a pill → paywall, intents unchanged (OQ-1 = option b).
  {
    const r = resolveCuratedPillTap({ isEditable: true, canAccessCurated: false });
    assert.equal(r.showPaywall, true, "T-5: free pill tap → paywall");
    assert.equal(r.feature, "curated_cards", "T-5: pill feature is curated_cards");
    assert.notEqual(r.mutated, true, "T-5: intents unchanged for a locked free user");
  }
  {
    const r = resolveCuratedPillTap({ isEditable: true, canAccessCurated: true });
    assert.equal(r.showPaywall, false, "T-5b: Mingla+ pill selects normally");
    assert.equal(r.mutated, true, "T-5b: Mingla+ pill mutates");
  }
}

if (require.main === module) {
  try {
    runOrch1314CuratedPaywallGateTest();
    console.log("PASS ORCH-1314 preferences curated paywall gate (banner + switch + pills)");
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}
