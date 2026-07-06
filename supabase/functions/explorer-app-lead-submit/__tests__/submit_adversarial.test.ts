// ORCH-1319 [explorer direct store links] — explorer-app-lead-submit DECOMMISSIONED.
//
// The ORCH-1216 explorer "Get the app" lead-submit edge function (+ its 2-step
// marketing lead form) was retired when Mingla went live on the App Store +
// Google Play. ORCH-1319 replaced the CTA with device-aware direct store links +
// a desktop QR, so there is no lead to POST and no handler left to test.
//
// RETAINED (not deleted) per the append-only test policy (ORCH-0840); the original
// adversarial assertions (incl. the beta TestFlight-link email) were removed under
// [TEST-MOD-APPROVED ORCH-1319]. No TestFlight URL, no handler import.

Deno.test("explorer-app-lead-submit adversarial decommissioned by ORCH-1319 (beta lead-form retired at store launch)", () => {
  // no-op: the handler and its beta TestFlight-link email no longer exist.
});
