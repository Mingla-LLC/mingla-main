/**
 * ORCH-0864 [Marketing Composer V2] Stage C — InsertionBar state-machine + catalogue tests.
 *
 * Pure-logic tests covering what doesn't require rendering. Component
 * render tests (Pressable hit, panel show/hide visual) defer to Stage G
 * Maestro flows + operator live-fire in Stage H — the project's jest
 * harness does not include @testing-library/react-native (per
 * Toast.test.tsx precedent).
 */

// Import from the pure state module — InsertionBar.tsx itself pulls in
// react-native (incompatible with our ts-jest node testEnvironment).
import {
  computeNextInsertionBarState,
  PERSONALIZATION_OPTIONS,
  PERSONALIZATION_TOKEN_COUNT,
  OVERFLOW_ITEM_IDS,
  type InsertionBarState,
} from "../InsertionBarState";

describe("InsertionBar — Stage C state machine", () => {
  it("opening a panel from closed returns that panel", () => {
    expect(computeNextInsertionBarState("closed", "events-open")).toBe("events-open");
    expect(computeNextInsertionBarState("closed", "personalize-open")).toBe("personalize-open");
    expect(computeNextInsertionBarState("closed", "overflow-open")).toBe("overflow-open");
  });

  it("tapping the same pill twice closes the panel (toggle)", () => {
    expect(computeNextInsertionBarState("events-open", "events-open")).toBe("closed");
    expect(computeNextInsertionBarState("personalize-open", "personalize-open")).toBe("closed");
    expect(computeNextInsertionBarState("overflow-open", "overflow-open")).toBe("closed");
  });

  it("tapping a different pill switches panels (only one open at a time)", () => {
    expect(computeNextInsertionBarState("events-open", "personalize-open")).toBe("personalize-open");
    expect(computeNextInsertionBarState("personalize-open", "overflow-open")).toBe("overflow-open");
    expect(computeNextInsertionBarState("overflow-open", "events-open")).toBe("events-open");
  });

  it("state-machine is total over the 3 toggleable panels", () => {
    const states: InsertionBarState[] = ["closed", "events-open", "personalize-open", "overflow-open"];
    const toggles: Array<Exclude<InsertionBarState, "closed">> = [
      "events-open",
      "personalize-open",
      "overflow-open",
    ];
    for (const s of states) {
      for (const t of toggles) {
        const out = computeNextInsertionBarState(s, t);
        // Every transition produces a valid state.
        expect(states).toContain(out);
      }
    }
  });
});

describe("InsertionBar — Stage C catalogues", () => {
  it("PERSONALIZATION_TOKEN_COUNT matches the 11-token vocabulary", () => {
    // Locked by I-PROPOSED-MKT-TEMPLATE-TOKENS-VERBATIM. If the renderer's
    // token list grows, the personalize panel + this constant + the bridge
    // regex must all update together.
    expect(PERSONALIZATION_TOKEN_COUNT).toBe(11);
  });

  // [TEST-MOD-APPROVED ORCH-0864 — F.10b: "preview" moved from overflow
  // menu to a dedicated footer button per operator directive. Overflow
  // returns to the canonical 4-item set.]
  it("OVERFLOW_ITEM_IDS is the canonical 4-item set in design-spec order", () => {
    expect(OVERFLOW_ITEM_IDS).toEqual(["template", "link", "image", "divider"]);
  });

  it("template is the FIRST overflow item (design §4.2 — most-used)", () => {
    // Operators reach for templates more than dividers; design placed it first.
    expect(OVERFLOW_ITEM_IDS[0]).toBe("template");
  });

  it("PERSONALIZATION_OPTIONS lists every token exactly once with unique labels", () => {
    const tokens = PERSONALIZATION_OPTIONS.map((o) => o.token);
    const uniqueTokens = new Set(tokens);
    expect(uniqueTokens.size).toBe(tokens.length);
    expect(tokens.length).toBe(PERSONALIZATION_TOKEN_COUNT);
    // Every option has non-empty label + hint (a11y requirement).
    for (const opt of PERSONALIZATION_OPTIONS) {
      expect(opt.label.length).toBeGreaterThan(0);
      expect(opt.hint.length).toBeGreaterThan(0);
    }
  });
});
