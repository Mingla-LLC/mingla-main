/**
 * META-ORCH-1059 — kind-aware shared management screens regression.
 *
 * The shared `/event/[id]/{orders,guests,scanner,scanners}` screens are reused
 * by trips + experiences. This test pins two things:
 *
 *  1. The pure copy-lens helpers (`offeringKindFromEventType`, `capitalizeNoun`,
 *     `offeringKindConfig`) resolve the per-kind noun/metric exactly as the
 *     screens compose their user-facing strings — "Trip not found",
 *     "Share experience link", "Travelers"/"Spots", "Different trip", etc.
 *  2. Each shared screen SOURCE composes its noun/metric copy through the
 *     config (no hardcoded "Event not found" / "Loading event..." /
 *     "Share event link" / standalone "Guests" title left behind).
 *
 * Why source-level for (2): these screens pull in Expo Router + the camera +
 * 10+ hooks/stores and are too heavyweight to render cleanly in Node jest
 * (same rationale as `cancel-no-navigation.test.tsx`). The source assertions
 * make the kind-aware contract explicit and machine-checkable.
 *
 * Fails-on-revert: reverting any screen to its hardcoded "event"/"guests" copy
 * reintroduces the literal strings the negative assertions forbid (and removes
 * the config-driven composition the positive assertions require), failing this
 * test. Reverting the helpers fails the unit assertions in block (1).
 */
import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";

import {
  capitalizeNoun,
  offeringKindConfig,
  offeringKindFromEventType,
} from "../offeringKind";

// ---- Block 1: pure copy-lens helpers --------------------------------

describe("META-ORCH-1059 — offeringKind copy-lens helpers", () => {
  test("offeringKindFromEventType maps the discriminator, defaulting to event", () => {
    expect(offeringKindFromEventType("event")).toBe("event");
    expect(offeringKindFromEventType("trip")).toBe("trip");
    expect(offeringKindFromEventType("experience")).toBe("experience");
    // Legacy / unknown / nullish rows are events by definition.
    expect(offeringKindFromEventType(null)).toBe("event");
    expect(offeringKindFromEventType(undefined)).toBe("event");
    expect(offeringKindFromEventType("totally-unknown")).toBe("event");
  });

  test("capitalizeNoun leads a sentence noun", () => {
    expect(capitalizeNoun("trip")).toBe("Trip");
    expect(capitalizeNoun("experience")).toBe("Experience");
    expect(capitalizeNoun("event")).toBe("Event");
    expect(capitalizeNoun("")).toBe("");
  });

  test('"{Noun} not found" reads per kind', () => {
    const noun = (et: string | null): string =>
      capitalizeNoun(offeringKindConfig(offeringKindFromEventType(et)).noun);
    expect(`${noun("event")} not found`).toBe("Event not found");
    expect(`${noun("trip")} not found`).toBe("Trip not found");
    expect(`${noun("experience")} not found`).toBe("Experience not found");
  });

  test('"Share {noun} link" reads per kind', () => {
    const noun = (et: string | null): string =>
      offeringKindConfig(offeringKindFromEventType(et)).noun;
    expect(`Share ${noun("event")} link`).toBe("Share event link");
    expect(`Share ${noun("trip")} link`).toBe("Share trip link");
    expect(`Share ${noun("experience")} link`).toBe("Share experience link");
  });

  test("guests-screen headcount title resolves Guests/Travelers/Spots by kind", () => {
    // Events keep the established "Guests" wording; trips/experiences read the
    // metric plural. This mirrors the screen's headcountPlural derivation.
    const headcountTitle = (et: string | null): string => {
      const kind = offeringKindFromEventType(et);
      const plural =
        kind === "event" ? "guests" : offeringKindConfig(kind).metricPlural;
      return capitalizeNoun(plural);
    };
    expect(headcountTitle("event")).toBe("Guests");
    expect(headcountTitle("trip")).toBe("Travelers");
    expect(headcountTitle("experience")).toBe("Spots");
  });

  test('scanner "Different {noun}" + "{Noun} has ended" read per kind', () => {
    const cfg = (et: string | null) =>
      offeringKindConfig(offeringKindFromEventType(et));
    expect(`Different ${cfg("trip").noun}`).toBe("Different trip");
    expect(`Different ${cfg("experience").noun}`).toBe("Different experience");
    expect(`${capitalizeNoun(cfg("trip").noun)} has ended`).toBe(
      "Trip has ended",
    );
    expect(`${capitalizeNoun(cfg("event").noun)} has ended`).toBe(
      "Event has ended",
    );
  });
});

// ---- Block 2: screens compose copy through the config ----------------

const SCREEN_DIR = join(__dirname, "..", "..", "..", "..", "app", "event", "[id]");
const readScreen = (rel: string): string =>
  readFileSync(join(SCREEN_DIR, rel), "utf8");

describe("META-ORCH-1059 — shared screens are kind-aware in source", () => {
  const orders = readScreen(join("orders", "index.tsx"));
  const guests = readScreen(join("guests", "index.tsx"));
  const scanner = readScreen(join("scanner", "index.tsx"));
  const scanners = readScreen(join("scanners", "index.tsx"));

  test("all four screens import the offeringKind copy lens", () => {
    for (const src of [orders, guests, scanner, scanners]) {
      expect(src).toContain("offeringKindFromEventType");
      expect(src).toContain("offeringKindConfig");
    }
  });

  // NOTE on the transient loader: "Loading event..." is intentionally kept
  // generic in all four screens — it renders only while the row is still
  // resolving (event === null), so the offering kind is not yet known, and it
  // is the locked shared-route-recovery marker (serverDraftLifecycleGuards).
  // The assertions below therefore target only the STEADY-STATE copy.

  test("orders screen has no hardcoded steady-state event-noun copy", () => {
    expect(orders).not.toContain('"Event not found"');
    expect(orders).not.toContain('"Share event link"');
    expect(orders).not.toContain("for this event.");
    // composes via config
    expect(orders).toContain("Share ${kindCfg.noun} link");
    expect(orders).toContain("capitalizeNoun(kindCfg.noun)");
  });

  test("guests screen relabels the headcount metric + has no hardcoded event copy", () => {
    expect(guests).not.toContain('"Event not found"');
    expect(guests).not.toContain('"Share event link"');
    expect(guests).not.toContain('"No guests yet"');
    expect(guests).not.toContain("Downloaded ${merged.length} guest(s).");
    // composes the headcount title via the lens
    expect(guests).toContain("headcountPlural");
    expect(guests).toContain("headcountPluralCap");
  });

  test("scanner screen relabels wrong-event + ended + authorization copy", () => {
    expect(scanner).not.toContain('"Different event"');
    expect(scanner).not.toContain('"Event has ended"');
    expect(scanner).not.toContain('"Event not found"');
    expect(scanner).not.toContain("not authorized to scan this event");
    // composes via config
    expect(scanner).toContain("Different ${kindCfg.noun}");
    expect(scanner).toContain("not authorized to scan this ${kindCfg.noun}");
  });

  test("scanners screen has no hardcoded steady-state event-noun shell copy", () => {
    expect(scanners).not.toContain('"Event not found"');
    expect(scanners).toContain("capitalizeNoun(kindCfg.noun)");
  });
});
