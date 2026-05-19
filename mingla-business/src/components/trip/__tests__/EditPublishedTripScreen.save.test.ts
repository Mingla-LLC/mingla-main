/**
 * ORCH-0876 [Trip CRUD + Purchase Flow Completion] — implementor happy-path
 * regression test per ORCH-0840 [Regression-test enforcement + append-only CI].
 *
 * Pins the published-trip Save flow contract: EditPublishedTripScreen.tsx
 * MUST route through `useUpdateLiveTripFields` (server RPC), MUST surface
 * the generalized ChangeSummaryModal with `entityLabel="trip"`, MUST fire
 * the fire-and-forget tripChangeNotifier on `ok: true`, and MUST display
 * the "Saved. Live now." confirmation toast on success.
 *
 * F-17 architecture invariant: trips skip Zustand-only-writes; every save
 * goes server-side via the RPC. Any future refactor that bypasses this
 * trips the regression.
 *
 * Spec: SPEC_ORCH-0876_V2_FULL_PARITY §6 + §7.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC_ROOT = join(__dirname, "..", "..", "..");
function read(rel: string): string {
  return readFileSync(join(SRC_ROOT, rel), "utf8");
}

describe("ORCH-0876 — EditPublishedTripScreen save flow contract", () => {
  const SRC = read("components/trip/EditPublishedTripScreen.tsx");

  test("routes save through useUpdateLiveTripFields mutation hook", () => {
    expect(SRC).toContain('import { useUpdateLiveTripFields } from "../../hooks/useTrips"');
    expect(SRC).toMatch(/const updateLiveTripMutation = useUpdateLiveTripFields\(\)/);
    expect(SRC).toMatch(/updateLiveTripMutation\.mutateAsync\(\{\s*eventId:\s*trip\.id,\s*patch,\s*reason:\s*preflight\.trimmedReason,?\s*\}\)/);
  });

  test("renders the generalized ChangeSummaryModal with entityLabel='trip'", () => {
    expect(SRC).toContain('import { ChangeSummaryModal } from "../event/ChangeSummaryModal"');
    expect(SRC).toMatch(/<ChangeSummaryModal\b[\s\S]*?entityLabel="trip"/);
  });

  test("passes trip diff arrays through to the modal", () => {
    expect(SRC).toMatch(/tripDayDiffs=\{modal\.dayDiffs\}/);
    expect(SRC).toMatch(/tripInclusionDiffs=\{modal\.inclusionDiffs\}/);
    expect(SRC).toMatch(/tripPricingTierDiffs=\{modal\.pricingTierDiffs\}/);
  });

  test("pre-flights the client-side fast-path guard before the RPC", () => {
    expect(SRC).toContain(
      'import { validateLiveTripFieldUpdate } from "../../utils/publishedTripEditGuards"',
    );
    // The preflight call must come BEFORE updateLiveTripMutation.mutateAsync
    const preflightIdx = SRC.indexOf("const preflight = validateLiveTripFieldUpdate(");
    const rpcIdx = SRC.indexOf("updateLiveTripMutation.mutateAsync");
    expect(preflightIdx).toBeGreaterThan(-1);
    expect(rpcIdx).toBeGreaterThan(-1);
    expect(preflightIdx).toBeLessThan(rpcIdx);
  });

  test("fires tripChangeNotifier on ok=true (fire-and-forget)", () => {
    expect(SRC).toContain(
      'import {\n  deriveTripChannelFlags,\n  notifyTripChanged,\n} from "../../services/tripChangeNotifier"',
    );
    expect(SRC).toMatch(/void notifyTripChanged\(/);
    expect(SRC).toMatch(/deriveTripChannelFlags\(\s*result\.severity,\s*hasWebPurchaseOrders,?\s*\)/);
  });

  test("surfaces success toast 'Saved. Live now.' then navigates back", () => {
    expect(SRC).toMatch(/showToast\("Saved\. Live now\."\)/);
    expect(SRC).toMatch(/setTimeout\(\s*\(\)\s*=>\s*\{[\s\S]*?router\.back\(\)/);
  });

  test("uses the absolute-positioned Toast primitive (no inline absolute wrap)", () => {
    // The shared Toast primitive self-positions; importing it directly is the
    // canonical pattern per feedback_toast_needs_absolute_wrap.md.
    expect(SRC).toContain('import { Toast } from "../ui/Toast"');
    expect(SRC).toMatch(/<Toast\b[\s\S]*?visible=\{toast\.visible\}/);
  });

  test("Save button is disabled while submitting", () => {
    expect(SRC).toMatch(/label="Save changes"[\s\S]*?disabled=\{submitting\}/);
  });

  test("EditAfterPublishTripBanner renders above the section accordion", () => {
    expect(SRC).toContain(
      'import { EditAfterPublishTripBanner } from "./EditAfterPublishTripBanner"',
    );
    // Banner appears before the SECTIONS.map(...) accordion.
    const bannerIdx = SRC.indexOf("<EditAfterPublishTripBanner");
    const sectionMapIdx = SRC.indexOf("SECTIONS.map((sec)");
    expect(bannerIdx).toBeGreaterThan(-1);
    expect(sectionMapIdx).toBeGreaterThan(-1);
    expect(bannerIdx).toBeLessThan(sectionMapIdx);
  });

  test("six sections in the locked order (Basics, Itinerary, Inclusions, Pricing, Cover, Settings)", () => {
    const sectionsMatch = SRC.match(/const SECTIONS:\s*readonly\s+SectionConfig\[\][\s\S]*?\];/);
    expect(sectionsMatch).not.toBeNull();
    const sections = sectionsMatch![0];
    const keyOrder = Array.from(sections.matchAll(/key:\s*"([^"]+)"/g)).map(
      (m) => m[1],
    );
    expect(keyOrder).toEqual([
      "basics",
      "itinerary",
      "inclusions",
      "pricing",
      "cover",
      "settings",
    ]);
  });

  test("seeds local edit state from server Trip on mount AND re-seeds on prop change", () => {
    expect(SRC).toMatch(/useEffect\([\s\S]*?setEditState\(tripToLocalEditState\(trip\)\)/);
  });

  test("emits all 7 cover_media_* keys when cover URL changes", () => {
    // buildLiveTripPatch must include the full 7-field cover cluster on URL change.
    const fn = SRC.match(/function buildLiveTripPatch[\s\S]*?\n\}/);
    expect(fn).not.toBeNull();
    const body = fn![0];
    expect(body).toMatch(/patch\.cover_media_url/);
    expect(body).toMatch(/patch\.cover_media_type/);
    expect(body).toMatch(/patch\.cover_media_provider/);
    expect(body).toMatch(/patch\.cover_media_source_url/);
    expect(body).toMatch(/patch\.cover_media_credit/);
    expect(body).toMatch(/patch\.cover_media_credit_url/);
    expect(body).toMatch(/patch\.cover_media_alt/);
  });
});
