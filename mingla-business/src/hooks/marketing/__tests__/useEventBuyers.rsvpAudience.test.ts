/**
 * useEventBuyers.rsvpAudience.test.ts — ORCH-1150-R2 (D-8).
 *
 * RSVP events have ZERO `orders` rows, so the Blasts audience must come from
 * `event_rsvps` (going-guests) via `resolveRsvpGuests`, NOT `resolveEventBuyers`
 * (orders-derived). The shared Blasts screen (DO-NOT-TOUCH) calls
 * `useEventBuyers(eventId)` with no event-type, so the hook probes
 * `events.event_type` and routes RSVP events to the event_rsvps resolver.
 *
 * Hook-render tests need a QueryClientProvider + RN harness (not installed at
 * this layer) — source-grep is the established resolution here (mirrors
 * useAudienceList.test.ts). The resolver-selection contract is the thing that
 * must not silently regress.
 *
 * Fails-on-revert: deleting the resolveRsvpGuests import / the `=== "rsvp"`
 * branch / the type-probe makes these assertions fail (the hook would fall
 * back to resolveEventBuyers for RSVP events → permanently-empty Blasts).
 */
import fs from "node:fs";
import path from "node:path";

const HOOK_PATH = path.resolve(__dirname, "..", "useEventBuyers.ts");

describe("useEventBuyers RSVP audience routing (ORCH-1150-R2 D-8)", () => {
  let source: string;

  beforeAll(() => {
    source = fs.readFileSync(HOOK_PATH, "utf8");
  });

  it("imports resolveRsvpGuests (the event_rsvps-backed resolver)", () => {
    expect(source).toMatch(/import\s*\{[\s\S]*resolveRsvpGuests[\s\S]*\}\s*from\s*["'].*marketingAudienceService["']/);
  });

  it("routes RSVP events to resolveRsvpGuests and others to resolveEventBuyers", () => {
    // The queryFn must branch on the resolved type.
    expect(source).toMatch(/resolvedType\s*===\s*"rsvp"\s*[\s\S]{0,40}resolveRsvpGuests/);
    expect(source).toContain("resolveEventBuyers");
  });

  it("accepts an optional eventType arg and falls back to an events.event_type probe", () => {
    // Optional override param per the SPEC contract.
    expect(source).toMatch(/eventType\?:\s*EventBuyersAudienceType/);
    // Internal probe so the DO-NOT-TOUCH blasts screen (no eventType) still
    // auto-detects RSVP events.
    expect(source).toContain('.from("events")');
    expect(source).toContain('event_type');
    expect(source).toMatch(/event_type\s*===\s*"rsvp"\s*\?\s*"rsvp"\s*:\s*"event"/);
  });

  it("waits for the type probe before firing the wrong resolver on first paint", () => {
    // audienceEnabled must require the type to be known (passed or probed).
    expect(source).toMatch(/audienceEnabled/);
    expect(source).toMatch(/eventType !== undefined \|\| typeProbe\.data !== undefined/);
  });

  it("keys the audience cache by event-type so ticketed/RSVP don't collide", () => {
    expect(source).toMatch(/byEvent:\s*\(\s*\n?\s*eventId: string,\s*\n?\s*eventType: EventBuyersAudienceType/);
  });
});
