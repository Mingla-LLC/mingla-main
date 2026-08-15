import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../../../..");
const component = fs.readFileSync(path.join(root, "src/components/venue/VenueListingContent.tsx"), "utf8");
const service = fs.readFileSync(path.join(root, "src/services/venueListingsService.ts"), "utf8");

describe("#2099 pending venue identity correction", () => {
  it("is structurally web-only and pending-only", () => {
    expect(component).toContain('Platform.OS === "web" && venue?.claimStatus === "pending_review"');
    expect(component).toContain('label="Correct venue identity"');
    expect(component).toContain('testID="issue-2099-correction-dialog"');
  });

  it("keeps honest preview, stale, retry, offline and submitting states", () => {
    for (const token of [
      "Checking whether this venue can be corrected.",
      "The venue changed while this form was open.",
      "Your entries are preserved; retry when you're online.",
      "Correcting the pending venue identity.",
      "Retry check",
      'accessibilityLiveRegion="polite"',
    ]) expect(component).toContain(token);
  });

  it("uses the two server-owned RPCs and sends both sealed fingerprints", () => {
    expect(service).toContain('supabase.rpc("preview_pending_venue_identity_correction"');
    expect(service).toContain('supabase.rpc("correct_pending_venue_identity"');
    expect(service).toContain("p_expected_schema_fingerprint: p.schema_fingerprint");
    expect(service).toContain("p_expected_state_fingerprint: p.state_fingerprint");
    expect(service).toContain("updated_at");
  });
});
