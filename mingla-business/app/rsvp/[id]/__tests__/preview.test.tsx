/* eslint-disable import/first */
/**
 * ORCH-1150-R2 D-5 — implementor happy-path regression test.
 *
 * Asserts the RSVP in-app preview route (`app/rsvp/[id]/preview.tsx`) EXISTS
 * and is a correct subtractive clone of `app/event/[id]/preview.tsx`:
 *   - REUSES the RSVP-safe public renderer `RsvpPublicBody` (testID
 *     "orch-1150-rsvp-preview"), NEVER the ticket-assuming `PreviewEventView` /
 *     `FoundationEventPreview` / `resolveOfferingCta`
 *     (I-PROPOSED-1150-RSVP-PREVIEW-NO-TICKET-RENDERER).
 *   - The Going / Not-going CTA submit is a PREVIEW no-op: it never imports or
 *     calls `submitPublicRsvp` / the edge function; it shows a "This is a
 *     preview" toast and resolves to a defined state.
 *   - Mirrors the ticketed preview's d_*→server-draft migration + stale/missing
 *     recovery + wrong-wizard (isRsvp===false → /event/{id}/preview) guard, with
 *     every /event/{id}/preview target swapped to /rsvp/{id}/preview.
 *
 * Structural source test — the route's dependency graph (Expo Router +
 * RsvpPublicBody → ParallaxCoverShell → expo-haptics + Zustand stores +
 * AuthContext + React Query) is too heavyweight to mount under the default
 * node/ts-jest config (no RTL installed here — see jest.config.cjs). Mirrors the
 * D-4 sibling (app/rsvp/[id]/__tests__/index.test.tsx) and the event-detail
 * source tests. The tester owns the RTL render-proof under a dedicated config.
 *
 * Fails-on-revert: the route is file-based. DELETING preview.tsx makes
 * expo-router fall through to +not-found.tsx (the white-screen crash, the bug
 * this ORCH fixes). The `readFileSync` here THROWS when the file is absent →
 * every test in this suite errors → the suite fails on revert. Verified by true
 * line deletion of the file (see IMPLEMENT report).
 */
import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";

const SCREEN_SOURCE_PATH = join(__dirname, "..", "preview.tsx");

describe("ORCH-1150-R2 D-5 — RSVP preview route exists + uses the no-ticket renderer", () => {
  // Throws (suite fails) if the file was deleted → the fails-on-revert proof for
  // the missing-route white-screen bug.
  const source = readFileSync(SCREEN_SOURCE_PATH, "utf8");

  test("the RSVP preview route file exists and exports a default screen", () => {
    expect(source.length).toBeGreaterThan(0);
    expect(source).toMatch(/export default function RsvpPreviewRoute/);
  });

  // ORCH-1163 [TEST-MOD-APPROVED ORCH-1163]: retargeted RsvpPublicBody → RsvpOfferingBody/FoundationRsvpPreview (body promoted to offering-rendering).
  // preview.tsx now mounts the thin FoundationRsvpPreview wrapper (which composes
  // the shared, ticketless RsvpOfferingBody) instead of the deleted RsvpPublicBody.
  test("REUSE: renders FoundationRsvpPreview with the preview testID (route resolves, no 404)", () => {
    expect(source).toContain("FoundationRsvpPreview");
    expect(source).toContain("<FoundationRsvpPreview");
    expect(source).toContain('testID="orch-1150-rsvp-preview"');
  });

  test("NO TICKET RENDERER: never imports/renders PreviewEventView / FoundationEventPreview / resolveOfferingCta", () => {
    // The header comment NAMES these to document the rule; the invariant
    // (I-PROPOSED-1150-RSVP-PREVIEW-NO-TICKET-RENDERER) forbids IMPORTING or
    // RENDERING them. Assert no import and no JSX mount, precisely.
    expect(source).not.toMatch(/import\s+\{[^}]*PreviewEventView/);
    expect(source).not.toMatch(/import\s+\{[^}]*FoundationEventPreview/);
    expect(source).not.toContain("<PreviewEventView");
    expect(source).not.toContain("<FoundationEventPreview");
    expect(source).not.toContain("resolveOfferingCta");
    expect(source).not.toContain("MultiDateOverrideSheet");
  });

  test("NO TICKETS: zero ticket tiers + no checkout/price concept in the mapped event", () => {
    // RSVP carries no tiers — the draft→public mapper sets tickets:[].
    expect(source).toMatch(/tickets:\s*\[\]/);
    expect(source).not.toContain("checkoutPublicPath");
    expect(source).not.toContain("mapTicket");
    expect(source).not.toContain("PublicTicketProps");
  });

  test("PREVIEW SUBMIT NO-OP: never imports or CALLS submitPublicRsvp / the edge fn", () => {
    // No import of the live submit service (the documentary header comment may
    // name it; the invariant is no IMPORT and no CALL — assert those precisely).
    expect(source).not.toMatch(/import\s+[^;]*submitPublicRsvp/);
    expect(source).not.toMatch(/from\s+["'][^"']*rsvpEvents["']/);
    // No invocation of the edge-fn-backed submitter.
    expect(source).not.toMatch(/submitPublicRsvp\s*\(/);
    // the no-op handler shows the preview toast + resolves a defined state
    expect(source).toContain("handlePreviewSubmit");
    expect(source).toMatch(/Publish to let guests RSVP/);
  });

  test("D_* MIGRATION: mirrors the event preview's local→server draft migration + stale recovery", () => {
    expect(source).toContain("createServerDraft");
    expect(source).toContain("staleServerDraft");
    // migration replace stays on the /rsvp route (swapped from /event)
    expect(source).toMatch(/\/rsvp\/\$\{serverDraft\.id\}\/preview/);
  });

  test("WRONG-WIZARD GUARD: isRsvp===false redirects to /event/{id}/preview (allowlisted)", () => {
    expect(source).toContain("draft.isRsvp === false");
    expect(source).toMatch(/\/event\/\$\{draft\.id\}\/preview/);
    // the one /event/ literal carries the route-by-event-type strict-grep allowlist
    expect(source).toContain("orch-strict-grep-allow route-by-event-type");
  });

  test("STATES + PROTECTIVE COMMENT: loading spinner shell + DO NOT delete header", () => {
    expect(source).toContain("Spinner");
    expect(source).toContain("DO NOT delete");
    // back is never a dead end
    expect(source).toContain("router.canGoBack()");
  });
});
