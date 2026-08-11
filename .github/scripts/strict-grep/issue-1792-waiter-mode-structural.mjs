#!/usr/bin/env node
/**
 * Issue #1792 (#1767 Phase 3b) — WAITER MODE's four structural promises.
 *
 * DESIGN D-11, D-2 AMENDED; SPEC #1788 P-20. Each of these is an ABSENCE, and
 * absences are what tests are worst at: a suite proving "the queue does not
 * branch on source" passes just as happily on a queue that gained a branch
 * nobody exercised. The behavioural halves live in
 * `mingla-business/src/components/venue/__tests__/venueOrderPad.issue1792.test.ts`
 * (the pad's rules, executed) and
 * `supabase/migrations/__tests__/issue_1792_waiter_mode_tabs.test.sql` (real
 * tabs, real RPCs, real payout sweep). This gate holds the four rules that are
 * only ever provable by looking at what is NOT there.
 *
 *   SET-A  THE KITCHEN CANNOT TELL HOW A TICKET ARRIVED. No rendering path in
 *          the Orders queue may consult `source`. D-11 is flat about it, and
 *          the way it erodes is somebody adding a well-meant "Taken by a
 *          waiter" badge — a one-line change that quietly splits the pass's
 *          attention between two kinds of ticket.
 *
 *   SET-B  ONE SPOT SHAPE, AND NO EAGER EDGE TO IT. The pad speaks in the
 *          shipped `QrSpot` / `VenueRef` types — it may not invent its own idea
 *          of what a table is, because two ideas is exactly how a laminate and
 *          a pad come to disagree about which one is table 12. But the import
 *          must stay TYPE-ONLY: a value edge from the Orders chunk to
 *          `../qrSpots` puts that module in two async chunks, so Metro hoists
 *          it into the EAGER `__common` boot payload (measured +1,972 B against
 *          the ORCH-1083 cap, for a twenty-line sort). The two orderings are
 *          instead compared where an import is free — T-SPOT4 in
 *          `venueOrderPad.issue1792.test.ts` runs both and asserts they agree.
 *
 *   SET-C  THE PAD NEVER PRICES ANYTHING (P-20). No client-side money
 *          arithmetic in the order-pad tree, and nothing price-shaped in the
 *          payload it sends. A price sent from a client is ignored server-side
 *          — but the way it gets BELIEVED later is by having been sent once.
 *
 *   SET-D  THE KEYBOARD NEVER BLOCKS THE CONTROL THAT SUBMITS. The Sheet
 *          primitive owns no keyboard logic (ORCH-0892-B v2), so a consumer
 *          with TextInputs supplies its own keyboard-aware scroll — exactly
 *          one, because two same-axis scrollables in one sheet compete for the
 *          gesture and the inner one also defeats the lift.
 *
 * Supports `--self-test` (no repo scan; GOOD + BAD fixtures for every rule).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd().endsWith("mingla-business")
  ? join(process.cwd(), "..")
  : process.cwd();

const BIZ = "mingla-business/src/components/venue";
const PAD_DIR = `${BIZ}/orderPad`;

/** SET-A — the queue's rendering surfaces, and the branch none of them may grow. */
const QUEUE_RENDER_FILES = [
  `${BIZ}/VenueOrderCard.tsx`,
  `${BIZ}/VenueOrderDetailSheet.tsx`,
  `${BIZ}/VenueOrdersModule.tsx`,
];
/**
 * A READ of the field, or either provenance literal. `VenueOrderSource` the
 * TYPE stays legal — the row has `source`, the metrics need it, and hiding it
 * from the model would be a different kind of lie. What is forbidden is a
 * rendering surface CONSULTING it.
 */
const SOURCE_BRANCH_RE =
  /\.source\b|["']guest_qr["']|["']guest_page["']|(?<!VenueOrder)(?<!type )\bsource\s*===/;

/** SET-B — the pad's spot list is the Spots inventory's list. */
const PAD_LOGIC = `${PAD_DIR}/venueOrderPad.ts`;
const SPOT_TYPE_IMPORT_RE =
  /import\s+type\s*\{[^}]*\bQrSpot\b[^}]*\}\s*from\s*["']\.\.\/qrSpots["']/s;
/** A VALUE import of the same module — the eager edge. */
const SPOT_VALUE_IMPORT_RE =
  /import\s*(?!type)\{[^}]*\}\s*from\s*["']\.\.\/qrSpots["']/s;

/** SET-C — no client-side money in the pad tree. */
const PAD_TREE = [
  PAD_LOGIC,
  `${PAD_DIR}/VenueOrderPadSheet.tsx`,
  `${PAD_DIR}/VenueTabsCard.tsx`,
  "mingla-business/src/hooks/useVenueOrderPad.ts",
  "mingla-business/src/hooks/useVenueOrderTabs.ts",
];
/**
 * Arithmetic ON a money field. Rendering a server number is fine and constant;
 * COMBINING two of them is the thing that creates a number nobody can trace to
 * a row. `* quantity`, `subtotal + service`, `reduce(sum + cents)` — all of it
 * belongs to the edge function.
 */
const MONEY_MATH_RE =
  /(?:Cents|cents|_cents)\s*[*+\-/]\s*[A-Za-z0-9_(]|[A-Za-z0-9_)]\s*[*+\-/]\s*(?:[A-Za-z_$][\w.]*)?(?:Cents|cents|_cents)\b/;

/** SET-D — the pad's keyboard contract. */
const PAD_SHEET = `${PAD_DIR}/VenueOrderPadSheet.tsx`;
const TABS_CARD = `${PAD_DIR}/VenueTabsCard.tsx`;
const RN_SCROLLVIEW_IMPORT_RE =
  /import\s*\{[^}]*\bScrollView\b[^}]*\}\s*from\s*["']react-native["']/s;
const SMART_SCROLL_IMPORT_RE = /from\s*["'][^"']*wrappers\/SmartScrollView["']/;

/** SET-E — anti-vacuity. A gate that goes green because its target moved is the
 *  failure class the registry exists to prevent. */
const MUST_EXIST = [...QUEUE_RENDER_FILES, ...PAD_TREE];

/** Comments EXPLAIN these prohibitions at length; a scan that tripped over its
 *  own documentation would be worthless. */
function stripComments(code) {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, "\n")
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("--");
    })
    .join("\n");
}

function scanQueueSource(label, rawCode, failures) {
  const code = stripComments(rawCode);
  if (SOURCE_BRANCH_RE.test(code)) {
    failures.push(
      `${label}: [queue-is-blind-to-provenance] the Orders queue consults an ` +
        `order's \`source\`. D-11: a staff-taken ticket and a scanned one land ` +
        `on the same card in the same view, and the kitchen cannot tell them ` +
        `apart. If a badge is genuinely wanted, that is a product decision — ` +
        `make it in the open, not in a render branch.`,
    );
  }
}

function scanSpotReuse(label, rawCode, failures) {
  const code = stripComments(rawCode);
  if (!SPOT_TYPE_IMPORT_RE.test(code)) {
    failures.push(
      `${label}: [one-spot-shape] the pad no longer speaks in the shipped ` +
        `\`QrSpot\` type from ../qrSpots. D-11: the pad picks from the SAME ` +
        `qr_spots rows the printed codes come from, so table numbers can never ` +
        `disagree — and a second definition of what a table is IS that ` +
        `disagreement.`,
    );
  }
  if (SPOT_VALUE_IMPORT_RE.test(code)) {
    failures.push(
      `${label}: [one-spot-shape] a VALUE import of ../qrSpots. That module then ` +
        `lives in two async chunks and Metro hoists it into the EAGER __common ` +
        `boot payload — measured +1,972 B against the ORCH-1083 cap, for a ` +
        `twenty-line sort. Keep it \`import type\`; T-SPOT4 compares the two ` +
        `orderings at test time, where an import is free.`,
    );
  }
}

function scanMoneyMath(label, rawCode, failures) {
  const code = stripComments(rawCode);
  for (const line of code.split("\n")) {
    if (MONEY_MATH_RE.test(line)) {
      failures.push(
        `${label}: [server-prices-everything] the order pad does arithmetic on a ` +
          `money field: \`${line.trim().slice(0, 90)}\`. SPEC P-20: every number ` +
          `comes back from venue-order-staff, computed from server-read menu ` +
          `rows. Ask for a preview instead.`,
      );
      return;
    }
  }
}

function scanKeyboard(label, rawCode, failures, { isSheet }) {
  const code = stripComments(rawCode);
  if (isSheet) {
    if (!SMART_SCROLL_IMPORT_RE.test(code)) {
      failures.push(
        `${label}: [keyboard-never-blocks] the pad sheet has TextInputs and no ` +
          `SmartScrollView. ORCH-0892-B v2: the Sheet primitive owns no keyboard ` +
          `logic, so the consumer supplies the keyboard-aware scroll — or the ` +
          `keyboard covers the button that sends the order.`,
      );
    }
    if (RN_SCROLLVIEW_IMPORT_RE.test(code)) {
      failures.push(
        `${label}: [keyboard-never-blocks] the pad sheet imports react-native's ` +
          `ScrollView beside the keyboard-aware one. Two same-axis scrollables ` +
          `in one sheet compete for the gesture, and the inner one defeats the ` +
          `lift. ONE scroll.`,
      );
    }
    const scrolls = (code.match(/<ScrollView/g) ?? []).length;
    if (scrolls > 1) {
      failures.push(
        `${label}: [keyboard-never-blocks] ${scrolls} scrollables in one sheet. ` +
          `Nested same-axis scroll — see above.`,
      );
    }
    return;
  }
  // The tabs card renders inside the venue hub's PLAIN ScrollView, which does
  // not lift a focused field. It may not collect text at all.
  if (/<TextInput\b/.test(code)) {
    failures.push(
      `${label}: [keyboard-never-blocks] the open-tabs card collects text while ` +
        `rendering inside the hub's plain ScrollView, which does not lift a ` +
        `focused field above the keyboard. Hand the form to the pad sheet ` +
        `(\`onBillTab\`), where the lift is.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Self-test fixtures. GOOD + BAD for every rule, in both directions.
// ---------------------------------------------------------------------------
const GOOD_QUEUE = `
import { venueOrderDestinationLabel, type VenueOrder } from "./venueOrderViews";
export function VenueOrderCard({ order }: { order: VenueOrder }) {
  return <Text>{venueOrderDestinationLabel(order)}</Text>;
}
`;
const BAD_QUEUE_FIELD = `
export function VenueOrderCard({ order }) {
  return <Text>{order.source === "staff" ? "Taken by a waiter" : "Scanned"}</Text>;
}
`;
const BAD_QUEUE_LITERAL = `
export function VenueOrderCard({ order }) {
  const scanned = kind === "guest_qr";
  return <Text>{scanned ? "QR" : "Pad"}</Text>;
}
`;

const GOOD_SPOTS = `
import type { QrSpot, VenueRef } from "../qrSpots";
export function orderableSpotGroups(spots, venues) {
  return [...byVenue.entries()].map(([venueId, list]) => ({ venueId, list }));
}
`;
const BAD_SPOTS_OWN_LIST = `
export interface OrderPadSpot { id: string; label: string; }
export function orderableSpotGroups(spots, venues) {
  const byVenue = new Map();
  for (const spot of spots) byVenue.set(spot.venueId, spot);
  return [...byVenue.values()];
}
`;
const BAD_SPOTS_EAGER_EDGE = `
import type { VenueRef } from "../qrSpots";
import { groupSpotsByVenue, isPrintable, type QrSpot } from "../qrSpots";
export function orderableSpotGroups(spots, venues) {
  return groupSpotsByVenue(spots, venues);
}
`;

const GOOD_MONEY = `
export function cartItemCount(lines) {
  return lines.reduce((sum, l) => sum + l.quantity, 0);
}
export function render(preview) {
  return formatCurrency(preview.totalCents, preview.currency, true);
}
`;
const BAD_MONEY_SUM = `
export function cartTotal(lines) {
  return lines.reduce((sum, l) => sum + l.unitPriceCents * l.quantity, 0);
}
`;
const BAD_MONEY_ADD = `
export function total(preview) {
  return preview.subtotalCents + preview.serviceChargeCents;
}
`;

const GOOD_SHEET = `
import { Pressable, Text, TextInput, View } from "react-native";
import { ScrollView } from "../../../wrappers/SmartScrollView";
export function VenueOrderPadSheet() {
  return <ScrollView><TextInput /></ScrollView>;
}
`;
const BAD_SHEET_NO_SMART = `
import { ScrollView, TextInput } from "react-native";
export function VenueOrderPadSheet() {
  return <ScrollView><TextInput /></ScrollView>;
}
`;
const BAD_SHEET_NESTED = `
import { TextInput, View } from "react-native";
import { ScrollView } from "../../../wrappers/SmartScrollView";
export function VenueOrderPadSheet() {
  return (
    <ScrollView>
      <ScrollView><TextInput /></ScrollView>
    </ScrollView>
  );
}
`;

const GOOD_CARD = `
export function VenueTabsCard({ onBillTab }) {
  return <Pressable onPress={() => onBillTab(tab)}><Text>Send the bill</Text></Pressable>;
}
`;
const BAD_CARD_INPUTS = `
export function VenueTabsCard() {
  return <View><TextInput value={name} /></View>;
}
`;

function selfTest() {
  const problems = [];
  const check = (name, fn, code, shouldFail, opts = {}) => {
    const out = [];
    fn("fixture", code, out, opts);
    const failed = out.length > 0;
    if (failed !== shouldFail) {
      problems.push(
        `self-test ${name}: expected ${shouldFail ? "FAIL" : "PASS"}, got ${
          failed ? `FAIL (${out[0]})` : "PASS"
        }`,
      );
    }
  };

  check("A/good", scanQueueSource, GOOD_QUEUE, false);
  check("A/bad-field", scanQueueSource, BAD_QUEUE_FIELD, true);
  check("A/bad-literal", scanQueueSource, BAD_QUEUE_LITERAL, true);
  // The comment that EXPLAINS the rule must not trip it.
  check("A/good-comment", scanQueueSource, "// order.source is never read here\n", false);

  check("B/good", scanSpotReuse, GOOD_SPOTS, false);
  check("B/bad-own-list", scanSpotReuse, BAD_SPOTS_OWN_LIST, true);
  check("B/bad-eager-edge", scanSpotReuse, BAD_SPOTS_EAGER_EDGE, true);

  check("C/good", scanMoneyMath, GOOD_MONEY, false);
  check("C/bad-sum", scanMoneyMath, BAD_MONEY_SUM, true);
  check("C/bad-add", scanMoneyMath, BAD_MONEY_ADD, true);

  check("D/good-sheet", scanKeyboard, GOOD_SHEET, false, { isSheet: true });
  check("D/bad-no-smart", scanKeyboard, BAD_SHEET_NO_SMART, true, { isSheet: true });
  check("D/bad-nested", scanKeyboard, BAD_SHEET_NESTED, true, { isSheet: true });
  check("D/good-card", scanKeyboard, GOOD_CARD, false, { isSheet: false });
  check("D/bad-card-inputs", scanKeyboard, BAD_CARD_INPUTS, true, { isSheet: false });

  if (problems.length > 0) {
    console.error("issue-1792 waiter-mode structural gate SELF-TEST failed:");
    for (const p of problems) console.error(`- ${p}`);
    process.exit(1);
  }
  console.log(
    "issue-1792 waiter-mode structural gate self-test passed (15 fixtures, GOOD+BAD for every rule).",
  );
  process.exit(0);
}

if (process.argv.includes("--self-test")) selfTest();

// ---------------------------------------------------------------------------
// Repo scan.
// ---------------------------------------------------------------------------
const failures = [];

for (const rel of MUST_EXIST) {
  if (!existsSync(join(root, rel))) {
    failures.push(
      `${rel}: [anti-vacuity] the file this gate guards does not exist. A gate ` +
        `that passes because its target moved proves nothing — re-point it in ` +
        `the same PR that moved the file.`,
    );
  }
}

for (const rel of QUEUE_RENDER_FILES) {
  const abs = join(root, rel);
  if (!existsSync(abs)) continue; // already reported
  scanQueueSource(rel, readFileSync(abs, "utf8"), failures);
}

if (existsSync(join(root, PAD_LOGIC))) {
  scanSpotReuse(PAD_LOGIC, readFileSync(join(root, PAD_LOGIC), "utf8"), failures);
}

for (const rel of PAD_TREE) {
  const abs = join(root, rel);
  if (!existsSync(abs)) continue;
  scanMoneyMath(rel, readFileSync(abs, "utf8"), failures);
}

for (const [rel, isSheet] of [[PAD_SHEET, true], [TABS_CARD, false]]) {
  const abs = join(root, rel);
  if (!existsSync(abs)) continue;
  scanKeyboard(rel, readFileSync(abs, "utf8"), failures, { isSheet });
}

if (failures.length > 0) {
  console.error("issue-1792 waiter-mode structural gate failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  `issue-1792 waiter-mode structural gate passed (${MUST_EXIST.length} guarded files).`,
);
