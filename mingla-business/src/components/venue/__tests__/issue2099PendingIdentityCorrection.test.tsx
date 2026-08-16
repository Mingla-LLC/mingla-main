/**
 * #2099 — STRUCTURAL guard for the Amendment 4 §D2 platform split.
 *
 * Scope note (Amendment 4 §D6): a source-string guard may remain as a
 * STRUCTURAL check but CANNOT satisfy UI behaviour. The behavioural proof is
 * the separate rendered suite; this file only pins the module boundary that
 * the independent tester found broken — the shared component must carry the
 * launch slot and nothing else, and the correction owner must not be reachable
 * from either the native graph or an already-eager shared module.
 */

import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../../../..");
const read = (p: string): string => fs.readFileSync(path.join(root, p), "utf8");

const shared = read("src/components/venue/VenueListingContent.tsx");
const launcherWeb = read(
  "src/components/venue/PendingVenueIdentityCorrectionLauncher.web.tsx",
);
const launcherNative = read(
  "src/components/venue/PendingVenueIdentityCorrectionLauncher.native.tsx",
);
const dialog = read("src/components/venue/PendingVenueIdentityCorrectionDialog.web.tsx");
const correctionService = read(
  "src/services/pendingVenueIdentityCorrectionService.web.ts",
);
const sharedService = read("src/services/venueListingsService.ts");

describe("#2099 — shared component carries ONLY the launch slot", () => {
  it("mounts the launcher through the extensionless platform specifier", () => {
    expect(shared).toContain(
      'import { PendingVenueIdentityCorrectionLauncher } from "./PendingVenueIdentityCorrectionLauncher";',
    );
    expect(shared).toContain("<PendingVenueIdentityCorrectionLauncher");
  });

  it("holds no dialog, form state, correction RPC, Input, Modal or correction copy", () => {
    for (const forbidden of [
      "PendingIdentityCorrectionDialog",
      "previewPendingVenueIdentityCorrection",
      "correctPendingVenueIdentity",
      "preview_pending_venue_identity_correction",
      "correct_pending_venue_identity",
      'from "../ui/Input"',
      'from "../ui/Modal"',
      "Correct pending venue",
      "issue-2099-correction-dialog",
      "dependency_counts",
    ]) {
      expect(shared).not.toContain(forbidden);
    }
  });

  it("keeps a success-refetch callback as its only other correction concern", () => {
    expect(shared).toContain("onSuccess=");
    expect(shared).toContain("Pending venue identity corrected.");
  });
});

describe("#2099 — the native launcher is a true no-op", () => {
  it("imports no correction service, dialog, Input, Modal or correction copy", () => {
    for (const forbidden of [
      "PendingVenueIdentityCorrectionDialog",
      "pendingVenueIdentityCorrectionService",
      "correct_pending_venue_identity",
      "preview_pending_venue_identity_correction",
      "../ui/Input",
      "../ui/Modal",
      "Correct venue identity",
      "Correct pending venue",
    ]) {
      expect(launcherNative).not.toContain(forbidden);
    }
  });

  it("returns null unconditionally — no pending-only branch to bypass", () => {
    expect(launcherNative).toContain("return null;");
    expect(launcherNative).not.toContain("pending_review");
  });
});

describe("#2099 — the web launcher defers the correction owner", () => {
  it("reaches the dialog only through an on-intent dynamic import", () => {
    expect(launcherWeb).toContain(
      'await import("./PendingVenueIdentityCorrectionDialog.web")',
    );
    // A STATIC import would put the dialog back in the eager graph.
    expect(launcherWeb).not.toContain(
      'from "./PendingVenueIdentityCorrectionDialog.web"',
    );
    expect(launcherWeb).not.toContain("pendingVenueIdentityCorrectionService");
  });

  it("stays pending-only and surfaces a chunk-load failure with Retry", () => {
    expect(launcherWeb).toContain('claimStatus !== "pending_review"');
    expect(launcherWeb).toContain("Couldn't load the correction tool. Retry.");
  });
});

describe("#2099 — the correction RPCs have exactly one web-only owner", () => {
  it("is no longer reachable through the eager shared service", () => {
    for (const forbidden of [
      "preview_pending_venue_identity_correction",
      "correct_pending_venue_identity",
      "PendingVenueIdentityPreview",
      "correctPendingVenueIdentity",
    ]) {
      expect(sharedService).not.toContain(forbidden);
    }
  });

  it("sends both sealed fingerprints and the full compare-and-swap set", () => {
    expect(correctionService).toContain(
      'supabase.rpc("preview_pending_venue_identity_correction"',
    );
    expect(correctionService).toContain('supabase.rpc("correct_pending_venue_identity"');
    for (const field of [
      "p_expected_schema_fingerprint: p.schema_fingerprint",
      "p_expected_state_fingerprint: p.state_fingerprint",
      "p_expected_updated_at: p.current.updated_at",
      "p_expected_brand_id: p.brand_id",
      "p_expected_place_pool_id: p.place_pool_id",
    ]) {
      expect(correctionService).toContain(field);
    }
  });

  it("throws on RPC error rather than returning a fallback", () => {
    expect(correctionService).toContain("if (error !== null) throw error;");
    expect(correctionService).not.toContain("return null");
  });
});

describe("#2099 — the dialog keeps honest state and the Review confirmation", () => {
  it("keeps preview truth separate from the operator's typed proposal", () => {
    expect(dialog).toContain("touchedRef");
    expect(dialog).toContain('touchedHas(touchedRef.current, "name")');
    expect(dialog).toContain('touchedHas(touchedRef.current, "slug")');
    expect(dialog).toContain('touchedHas(touchedRef.current, "category")');
  });

  it("makes Review the fresh explicit confirmation", () => {
    expect(dialog).toContain('setStep("edit")');
    expect(dialog).toContain('setStep("review")');
    expect(dialog).toContain("const canSubmit = canReview && step === \"review\";");
  });

  it("cannot double-fire a submission", () => {
    expect(dialog).toContain("if (submitInFlight.current) return;");
    expect(dialog).toContain("submitInFlight.current = true;");
  });

  it("refreshes and preserves the proposal on both stale codes", () => {
    expect(dialog).toContain('result.code === "STALE_VERSION"');
    expect(dialog).toContain('result.code === "DEPENDENCY_SCHEMA_CHANGED"');
  });

  it("uses the supported house Input contract, never a widened prop", () => {
    expect(dialog).toContain('variant="text"');
    expect(dialog).not.toContain("autoCapitalize");
  });

  it("announces status politely and keeps 44px targets", () => {
    expect(dialog).toContain('accessibilityLiveRegion="polite"');
    expect(dialog).toContain("minHeight: 44");
    expect(dialog).toContain("minWidth: 44");
  });
});
