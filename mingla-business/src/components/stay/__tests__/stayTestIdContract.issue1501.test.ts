/**
 * Issue #1501 [add-rooms-form] — THE testID CONTRACT.
 *
 * #1501 rewrote the Add Rooms or Places editor: `styles.field` deleted, every
 * toggle turned into an OptionCard, the amenities field turned into a ChipInput,
 * both name textareas turned into a NameBuilder, and the whole form regrouped
 * into six sections inside a form column beside a summary rail. That is a large
 * surface change, and testIDs are the contract every downstream Maestro flow,
 * tester suite and future regression proof addresses the screen through.
 *
 * So: every testID that existed BEFORE this issue must still exist AFTER it,
 * spelled exactly the same, and still attached to the same kind of thing. Three
 * of them moved to a NEW HOST but kept their MEANING, which is the point:
 *
 *   stay-offering-amenities -> the ChipInput's TEXT FIELD
 *   stay-bulk-names         -> the NameBuilder's "add one by one" TEXT FIELD
 *   stay-unit-names         -> the NameBuilder's "add one by one" TEXT FIELD
 *
 * Each still identifies "the thing an operator types into", so a flow that
 * types a name into `stay-bulk-names` still types a name.
 *
 * The list below is enumerated from the file as it stood at the #1501 base
 * commit (b4dd54815). It is deliberately a SOURCE assertion rather than a
 * render one: several of these ids live on the availability manager and the
 * list, which no single mount reaches, and the contract being protected is
 * "the string still exists in this component", not "it renders in state X".
 * The render suites cover behaviour.
 *
 * FAILS-ON-REVERT: rename or drop any pre-#1501 testID -> ID-1 FAILS.
 *
 * Append-only: NEW file; modifies/deletes no existing test.
 */

import fs from "node:fs";
import path from "node:path";

const businessRoot = path.resolve(__dirname, "..", "..", "..", "..");
const manager = fs.readFileSync(
  path.join(businessRoot, "src/components/stay/StayInventoryManager.tsx"),
  "utf8",
);

/**
 * The source with COMMENTS STRIPPED.
 *
 * Load-bearing: this file documents the deleted `styles.field` verbatim so a
 * future reader knows what went wrong, and the doc comments in the component do
 * the same. A naive `not.toContain` would therefore match the EXPLANATION and
 * fail forever, which teaches the next engineer to delete the explanation. The
 * assertions below run against code only.
 */
const code = manager
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

/** Every literal testID present at the #1501 base commit b4dd54815. */
const LITERAL_TEST_IDS: readonly string[] = [
  "stay-add-bulk",
  "stay-add-place",
  "stay-add-room",
  "stay-add-single",
  "stay-availability-finance-copy",
  "stay-availability-from",
  "stay-availability-permission-copy",
  "stay-availability-save",
  "stay-availability-to",
  "stay-bulk-names",
  "stay-finance-permission-copy",
  "stay-inventory-add",
  "stay-inventory-empty-add",
  "stay-inventory-list-scroll",
  "stay-inventory-permission-copy",
  "stay-inventory-retry",
  "stay-inventory-search",
  "stay-night-price",
  "stay-night-quantity",
  "stay-offering-add-photos",
  "stay-offering-amenities",
  "stay-offering-capacity",
  "stay-offering-description",
  "stay-offering-editor-scroll",
  "stay-offering-fee-amount",
  "stay-offering-fee-label",
  "stay-offering-guests",
  "stay-offering-instant",
  "stay-offering-name",
  "stay-offering-no-show",
  "stay-offering-policy",
  "stay-offering-price",
  "stay-offering-quantity",
  "stay-offering-request",
  "stay-offering-save",
  "stay-place-capacity",
  "stay-place-end-time",
  "stay-place-exclusive",
  "stay-place-fixed",
  "stay-place-full-day",
  "stay-place-overnight-only",
  "stay-place-price",
  "stay-place-public",
  "stay-place-repeating",
  "stay-place-start-time",
  "stay-stop-sell",
  "stay-unit-names",
  "stay-units-named",
  "stay-units-pooled",
];

/** Template testIDs that address a row by id. */
const TEMPLATE_TEST_IDS: readonly string[] = [
  "stay-availability-${offering.id}",
  "stay-edit-${offering.id}",
  "stay-filter-${item.id}",
  "stay-live-${offering.id}",
  "stay-media-remove-${item.id}",
  "stay-pause-${offering.id}",
];

describe("#1501 — every pre-existing testID survives the rewrite", () => {
  it("ID-0 — VACUITY GUARD: the source really loaded", () => {
    // Without this, a bad path would make every `toContain` below run against
    // an empty string and fail loudly — but a bad REGEX would not. Anchor on
    // something that must exist.
    expect(manager.length).toBeGreaterThan(10_000);
    expect(manager).toContain("export function StayInventoryManager");
    expect(LITERAL_TEST_IDS).toHaveLength(49);
  });

  it("ID-1 — all 49 literal testIDs are present, spelled exactly", () => {
    for (const testID of LITERAL_TEST_IDS) {
      expect({ testID, present: manager.includes(`testID="${testID}"`) }).toEqual(
        { testID, present: true },
      );
    }
  });

  it("ID-2 — all 6 templated row testIDs are present", () => {
    for (const template of TEMPLATE_TEST_IDS) {
      expect({
        template,
        present: manager.includes("testID={`" + template + "`}"),
      }).toEqual({ template, present: true });
    }
  });

  it("ID-3 — the three RELOCATED ids landed on their new hosts", () => {
    // The amenities id belongs to the ChipInput's text field.
    expect(manager).toMatch(
      /<ChipInput[\s\S]{0,600}?testID="stay-offering-amenities"/,
    );
    // Both name lists belong to a NameBuilder's "add one by one" field.
    expect(manager).toMatch(
      /<NameBuilder[\s\S]{0,600}?testID="stay-bulk-names"/,
    );
    expect(manager).toMatch(
      /<NameBuilder[\s\S]{0,600}?testID="stay-unit-names"/,
    );
    // ...and neither name list is a raw multiline textarea any more.
    expect(manager).not.toMatch(/multiline[\s\S]{0,200}testID="stay-bulk-names"/);
    expect(manager).not.toMatch(/multiline[\s\S]{0,200}testID="stay-unit-names"/);
  });

  it("ID-4 — `styles.field` is gone and no stacked measure carries `flex`", () => {
    // The deleted entry, verbatim. Its return is the #1501 regression.
    expect(code).not.toContain("field: { flex: 1, minWidth: 140");
    // The three axis-scoped replacements exist and `fieldStack` is flex-free.
    expect(code).toContain(
      'fieldStack: { width: "100%", minWidth: 0, gap: spacing.xs }',
    );
    expect(code).toContain("fieldPair: {");
    expect(code).toContain("fieldNum: {");
    // `span` is REQUIRED at the type level — no `?`.
    expect(code).toContain("span: FieldSpan;");
    expect(code).not.toContain("span?: FieldSpan");
    // ...and every call site passes it.
    const callSites = code.match(/<LabeledInput\b/g) ?? [];
    const spans = code.match(/\n\s+span="(stack|pair|num)"/g) ?? [];
    expect(callSites.length).toBeGreaterThan(0);
    expect(spans).toHaveLength(callSites.length);
  });

  it("ID-5 — the override-with-undefined pattern never returns", () => {
    // react-native-web keeps the BASE style's atomic class when an override
    // sets the key to `undefined`, so the cap silently survives. #1484 shipped
    // exactly that. Omitting the KEY is the only form the web resolver honours.
    expect(code).not.toContain("maxWidth: undefined");
    expect(code).not.toContain("flexBasis: undefined");
  });
});
