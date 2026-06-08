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

describe("Sub-D Symptom-B — ui/Toast.tsx blur guard (via shared shouldUseRealBlur)", () => {
  const code = stripComments(read("ui/Toast.tsx"));

  test("blurOk no longer uses the inverted `Platform.OS !== 'web'` guard", () => {
    expect(code).not.toMatch(/blurOk\s*=\s*Platform\.OS\s*!==\s*["']web["']/);
  });

  test("blurOk is computed from the shared shouldUseRealBlur(windowWidth) helper", () => {
    expect(code).toMatch(/import\s*\{[^}]*shouldUseRealBlur[^}]*\}\s*from\s*["'][^"']*glassBlur["']/);
    expect(code).toMatch(/blurOk\s*=\s*shouldUseRealBlur\(windowWidth\)/);
  });

  test("opaque FALLBACK_BACKGROUND is the kit fallback rgba(20, 22, 26, 0.92)", () => {
    expect(code).toMatch(
      /FALLBACK_BACKGROUND\s*=\s*["']rgba\(20,\s*22,\s*26,\s*0\.92\)["']/,
    );
  });
});

describe("Sub-D Symptom-B — ari/AiDisclosureModal.tsx guarded (via shared helper)", () => {
  const code = stripComments(read("ari/AiDisclosureModal.tsx"));

  test("uses the shared shouldUseRealBlur(windowWidth) helper", () => {
    expect(code).toMatch(/import\s*\{[^}]*shouldUseRealBlur[^}]*\}\s*from\s*["'][^"']*glassBlur["']/);
    expect(code).toMatch(/shouldUseRealBlur\(windowWidth\)/);
  });

  test("opaque branch renders an opaque sheet instead of the raw BlurView", () => {
    expect(code).toMatch(
      /!\s*shouldUseRealBlur\(windowWidth\)[\s\S]{0,120}styles\.opaqueSheet/,
    );
  });

  test("opaqueSheet fill is fully opaque (#hex, no rgba alpha)", () => {
    const block = styleBlock(code, "opaqueSheet");
    expect(block).not.toBeNull();
    expect(block!).toMatch(/backgroundColor:\s*["']#[0-9a-fA-F]{6}["']/);
  });

  test("real-blur path still renders a real BlurView", () => {
    expect(code).toMatch(/<BlurView\s+intensity=\{40\}/);
  });
});

describe("Sub-D Symptom-B — marketing/BlastCustomersCta.tsx guarded (via shared helper)", () => {
  const code = stripComments(read("marketing/BlastCustomersCta.tsx"));

  test("uses the shared shouldUseRealBlur(windowWidth) helper", () => {
    expect(code).toMatch(/import\s*\{[^}]*shouldUseRealBlur[^}]*\}\s*from\s*["'][^"']*glassBlur["']/);
    expect(code).toMatch(/blurOk\s*=\s*shouldUseRealBlur\(windowWidth\)/);
  });

  test("L1 renders BlurView when blurOk, opaque fallback otherwise", () => {
    expect(code).toMatch(
      /blurOk\s*\?[\s\S]{0,120}<BlurView[\s\S]{0,400}FALLBACK_BACKGROUND/,
    );
  });

  test("opaque fill is the kit fallback rgba(20, 22, 26, 0.92)", () => {
    expect(code).toMatch(
      /FALLBACK_BACKGROUND\s*=\s*["']rgba\(20,\s*22,\s*26,\s*0\.92\)["']/,
    );
  });
});

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
  ["marketing/ComposerStepWhen.tsx", "pickerPill"],
  ["marketing/AudiencePickerSheet.tsx", "row"],
  // Phase 2 — brand / door / orders / ari / experience
  ["ari/QuickReplyChips.tsx", "chip"],
  ["brand/BrandDeleteSheet.tsx", "warnCard"],
  ["door/DoorSaleNewSheet.tsx", "emptyTiersWrap"],
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
    expect(block!).toMatch(/backgroundColor:\s*glass\.tint\.profileBase/);
  });
});
