import fs from "node:fs";
import path from "node:path";

/**
 * META-ORCH-1002 Sub-D — business Android glass sweep regression check.
 *
 * Two halves (per the Sub-D dispatch):
 *   1. Symptom-B stragglers (3 clear inverted/unguarded BlurView bugs):
 *      - ui/Toast.tsx               — `blurOk` inverted guard fixed
 *      - ari/AiDisclosureModal.tsx  — raw BlurView guarded to opaque on Android
 *      - marketing/BlastCustomersCta.tsx — raw L1 BlurView guarded to opaque on Android
 *   2. Symptom-A sweep — rounded translucent surfaces on the dark business
 *      canvas now carry `overflow: "hidden"` so the fill+border composite to the
 *      radius (kills the inset taupe ring). Dark-canvas translucent fills are
 *      intentionally PRESERVED (glass aesthetic); the fix is the clip only.
 *
 * Pixel rendering can't be unit-asserted (ts-jest testEnvironment:node). These
 * are style/Platform source assertions — the established business CI pattern.
 * On-device pixel verification is the tester's live-fire job.
 *
 * Adversarial angles for the tester (do NOT regress):
 *   - iOS frozen: every guard keeps a real BlurView on iOS (Platform.OS === 'ios').
 *   - No surface flipped its dark-canvas translucent fill to opaque (would flatten
 *     the intended glass look) — Sub-D adds the CLIP, not a fill change, on the
 *     swept Symptom-A surfaces.
 *   - Web path preserved (backdrop-filter detection still drives blurOk on web).
 *   - Stragglers must take the OPAQUE branch specifically on Android, not all
 *     non-iOS platforms (web keeps blur when backdrop-filter is supported).
 */

const componentsDir = path.resolve(__dirname, "..");
const read = (rel: string): string =>
  fs.readFileSync(path.join(componentsDir, rel), "utf8");

const stripComments = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

// Extract a named StyleSheet block `name: { ... }` at 2-space indent.
const styleBlock = (code: string, name: string): string | null => {
  const m = code.match(new RegExp(name + ":\\s*\\{[\\s\\S]*?\\n\\s{2}\\},"));
  return m ? m[0] : null;
};

// ---------------------------------------------------------------------------
// Half 1 — Symptom-B stragglers
// ---------------------------------------------------------------------------

// [TEST-MOD-APPROVED ORCH-1100] — RC-2 generalized the per-component
// `Platform.OS === "android"` opaque-fallback decision into the shared
// `utils/glassBlur.shouldUseRealBlur(windowWidth)` helper (so the mobile-web
// < 768px blur-kill is also covered, not just Android). The BEHAVIORAL
// guarantees these tests protect — iOS keeps real blur, Android opaque ≥0.92,
// the kit `rgba(20,22,26,0.92)` fallback fill — are unchanged; only the location
// of the decision moved. Assertions updated to track the shared helper while
// still pinning the same behavior. The shared helper itself is independently
// covered by `utils/__tests__/glassBlur.test.ts` + the ORCH-1100 regression
// suite. See `Mingla_Artifacts/INVARIANT_REGISTRY.md` (ANDROID glass opaque
// fallback) — generalized, not retired.

// [TEST-MOD-APPROVED #4420] Toast no longer owns glass: it draws its card with
// `<Material kind="sheet">` (iOS blur, Android / phone-web / reduce-transparency
// SOLID alpha 1). The Sub-D guarantee (no inverted web guard, opaque where blur
// is unavailable) now lives in Material and is pinned there.
describe("Sub-D Symptom-B — ui/Toast.tsx glass comes from Material", () => {
  const code = stripComments(read("ui/Toast.tsx"));
  const material = stripComments(read("ui/Material.tsx"));

  test("Toast has no blur decision of its own (no inverted guard, no BlurView)", () => {
    expect(code).not.toMatch(/blurOk\s*=\s*Platform\.OS\s*!==\s*["']web["']/);
    expect(code).not.toMatch(/from\s*["']expo-blur["']/);
    expect(code).toMatch(/<Material kind="sheet"/);
  });

  test("Material computes the web decision from shouldUseRealBlur and falls back to the solid fill", () => {
    expect(material).toMatch(/shouldUseRealBlur\(width\)/);
    expect(material).toMatch(/fill:\s*recipe\.solidFill/);
  });
});

// [TEST-MOD-APPROVED #4420] Wave 5 moved AiDisclosureModal and
// BlastCustomersCta onto <Material> (the one glass owner): no own BlurView, no
// per-file opaque constant. Their Sub-D guarantee (solid where blur is
// unavailable, real blur on iOS) is Material's, pinned in
// issue_4420_material.test.tsx and the Toast block above.
describe.each([["ari/AiDisclosureModal.tsx", "sheet"], ["marketing/BlastCustomersCta.tsx", "chrome"]])(
  "Sub-D Symptom-B — %s glass comes from Material",
  (rel, kind) => {
    const code = stripComments(read(rel));
    test("no BlurView of its own and no per-file opaque fallback", () => {
      expect(code).not.toMatch(/from\s*["']expo-blur["']/);
      expect(code).not.toMatch(/<BlurView\b/);
      expect(code).not.toMatch(/FALLBACK_BACKGROUND|opaqueSheet/);
    });
    test(`draws its surface with <Material kind="${kind}">`, () => {
      expect(code).toMatch(new RegExp(`<Material[^>]*kind="${kind}"`));
    });
  },
);

// ---------------------------------------------------------------------------
// Half 2 — Symptom-A sweep: representative swept surfaces carry overflow:hidden
// ---------------------------------------------------------------------------

// (file, styleName) sample spanning the Phase-1 swept surfaces
// (event / trip / marketing creators + composer = Phase 1; brand / door /
// orders / ari = Phase 2). All confirmed present in the Sub-D target catalog
// and swept in this PR.
const SWEPT: readonly (readonly [string, string])[] = [
  // Phase 1 — creators + composer
  ["event/CreatorStep2When.tsx", "countInputWrap"],
  ["event/CreatorStep2When.tsx", "addDateBtn"],
  ["event/TicketTierEditSheet.tsx", "inputWrap"],
  ["event/TicketTierEditSheet.tsx", "waitlistPanel"],
  ["event/PreviewEventView.tsx", "recurrencePill"],
  ["event/CreatorStep2WhenRepeatPickerSheet.tsx", "weekdayPill"],
  ["trip/IntakeQuestionEditor.tsx", "labelInput"],
  ["trip/IntakeQuestionEditor.tsx", "optionInput"],
  ["trip/TripCreatorStep1Basics.tsx", "textInput"],
  ["trip/PaymentPlanEditor.tsx", "daysInput"],
  // #4523: the schedule's date/time pills became the Mingla calendar field;
  // the composer's rounded segmented control carries the clip.
  ["marketing/ComposerStepWhen.tsx", "segmented"],
  ["marketing/AudiencePickerSheet.tsx", "row"],
  // Phase 2 — brand / door / orders / ari / experience
  ["ari/QuickReplyChips.tsx", "chip"],
  ["brand/BrandDeleteSheet.tsx", "warnCard"],
  // #4389: the door sale sheet became Door mode; its tiles carry the clip.
  ["door/DoorModeScreen.tsx", "tile"],
  ["door/DoorModeScreen.tsx", "chip"],
  ["orders/RefundSheet.tsx", "reasonInputWrap"],
  ["orders/RefundSheet.tsx", "summaryCard"],
];

describe("Sub-D Symptom-A — swept surfaces carry overflow: 'hidden'", () => {
  test.each(SWEPT.map(([f, s]) => [`${f} :: ${s}`, f, s]))(
    "%s clips fill+border to the radius",
    (_label, rel, style) => {
      const code = stripComments(read(rel as string));
      const block = styleBlock(code, style as string);
      expect(block).not.toBeNull();
      // The swept surface must declare a border-radius (it is a rounded surface).
      expect(block!).toMatch(/borderRadius:/);
      // ...and now clip so the fill reaches the corner on Android.
      expect(block!).toMatch(/overflow:\s*["']hidden["']/);
    },
  );

  test("dark-canvas translucent glass fill is PRESERVED, not flattened", () => {
    // Sub-D adds the clip only on these dark-canvas surfaces; the translucent
    // glass.tint.profileBase fill stays (the intended aesthetic). Guard against
    // an over-eager opaque-ification of a representative swept surface.
    const code = stripComments(read("event/CreatorStep2When.tsx"));
    const block = styleBlock(code, "countInputWrap");
    expect(block).not.toBeNull();
    // [TEST-MOD-APPROVED #4420] — the same translucent wash now comes from
    // its Graphite role token (`glass.tint.profileBase` aliased `color.fill.inset`).
    expect(block!).toMatch(/backgroundColor:\s*color\.fill\.inset/);
  });
});
