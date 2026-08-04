/**
 * Issue #1565 [hub-venue-count] — implementor happy-path regression proof.
 *
 * WHAT SHIPPED: the Hub's Venues pill reads "Venues · 3", exactly as Events,
 * Trips and Experiences already do. Two source edits:
 *   1. `app/(tabs)/hub/_layout.tsx` passes `venue: venueCount` into HubSubNav's
 *      `counts` prop (it previously passed events/trips/experiences and simply
 *      omitted venue, thirteen lines below where `venueCount` is computed).
 *   2. `src/components/hub/HubSubNav.tsx` routes every pill's text through the
 *      exported pure `hubPillLabel`, and the pill label is now "Venues".
 *
 * THE INVARIANT: **"Venues · 0" is unreachable by construction.** The count is
 * every venue the brand has in ANY state (including one still in review),
 * because `deriveHubVisibleTabs` gates the pill's very EXISTENCE on
 * `venueCount > 0 || hasPhysicalLocation || hasPlacePool`. A narrower count
 * would show a brand with one in-review venue a tab reading zero. And when the
 * pill exists via a legacy arm with `venueCount === 0`, the bare label renders
 * — "· 0" would be a lie about a tab standing there for another reason.
 *
 * WHY THIS IS A REAL RENDER, NOT A SOURCE PIN: it mounts the ACTUAL HubSubNav
 * through react-test-renderer (a real devDependency, 19.1.0) under the default
 * node/ts-jest config, reads the JSON tree, and asserts on the STRINGS a user
 * would see. The only source-text assertion is the layout-wiring block (T-8),
 * and it parses + guards its own lookup.
 *
 * EVERY LOOKUP CARRIES A VACUITY GUARD. An assertion over an empty set always
 * passes; `readPills` therefore returns a Map whose size is asserted before any
 * text claim, and the layout parse throws rather than yielding an empty match.
 *
 * APPEND-ONLY — do not weaken.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import React from "react";
import { describe, expect, jest, test } from "@jest/globals";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

// `react-test-renderer` (a real devDependency, 19.1.0) ships no types; the
// repo's established shape for the default node/ts-jest config is a typed
// `require` — see src/components/ui/__tests__/dateField.issue1503.test.tsx.
type Tree = {
  toJSON: () => unknown;
  unmount: () => void;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => Tree;
  act: (callback: () => Promise<void> | void) => void;
};

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: (): void => {}, replace: (): void => {} }),
  usePathname: () => "/(tabs)/hub/events",
}));

import {
  HubSubNav,
  hubPillLabel,
  type HubDataDrivenTabId,
} from "../HubSubNav";
import { deriveHubVisibleTabs } from "../../../hooks/useHubTabs";

// ---------------------------------------------------------------------------
// Render harness — walk the rendered JSON tree and read what a user would see.
// ---------------------------------------------------------------------------

interface PillRead {
  readonly text: string;
  readonly accessibilityLabel: string;
}

type JsonNode =
  | string
  | number
  | null
  | {
      type: string;
      props: Record<string, unknown>;
      children: JsonNode[] | null;
    };

const TEST_ID_PREFIX = "hub-subtab-";

const collectText = (node: JsonNode): string => {
  if (node === null) return "";
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (!Array.isArray(node.children)) return "";
  return node.children.map(collectText).join("");
};

const walk = (node: JsonNode, out: Map<string, PillRead>): void => {
  if (node === null || typeof node === "string" || typeof node === "number") {
    return;
  }
  const testID = node.props?.testID;
  if (typeof testID === "string" && testID.startsWith(TEST_ID_PREFIX)) {
    const a11y = node.props?.accessibilityLabel;
    out.set(testID.slice(TEST_ID_PREFIX.length), {
      text: collectText(node),
      accessibilityLabel: typeof a11y === "string" ? a11y : "",
    });
  }
  for (const child of node.children ?? []) walk(child, out);
};

/**
 * Mount the REAL HubSubNav and return one entry per rendered pill, keyed by
 * tab id. Callers MUST assert on `.size` / key membership before reading text
 * — an empty map would otherwise make every text assertion vacuously true.
 */
const readPills = (
  visibleTabs: readonly HubDataDrivenTabId[] | undefined,
  counts: Partial<Record<HubDataDrivenTabId, number>> | undefined,
): Map<string, PillRead> => {
  let renderer: Tree | undefined;
  TestRenderer.act(() => {
    renderer = TestRenderer.create(
      <HubSubNav visibleTabs={visibleTabs} counts={counts} loading={false} />,
    );
  });
  if (renderer === undefined) throw new Error("HubSubNav failed to mount");
  const tree = renderer.toJSON() as JsonNode;
  const out = new Map<string, PillRead>();
  walk(tree, out);
  const mounted = renderer;
  TestRenderer.act(() => {
    mounted.unmount();
  });
  return out;
};

// ---------------------------------------------------------------------------
// T-0 — harness self-test. If the walker cannot see a pill that indisputably
// renders, every other assertion in this file is vacuous. Fail loudly here.
// ---------------------------------------------------------------------------

describe("#1565 T-0 — the render harness actually sees pills", () => {
  test("mounting three known tabs yields exactly three readable pills", () => {
    const pills = readPills(["events", "trips", "experiences"], undefined);
    expect(pills.size).toBe(3);
    expect([...pills.keys()].sort()).toEqual(["events", "experiences", "trips"]);
    // Non-empty text proves collectText traverses, not just that nodes exist.
    for (const [id, pill] of pills) {
      expect(pill.text.length).toBeGreaterThan(0);
      expect(pill.accessibilityLabel).toContain("sub-tab");
      expect(id.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// T-1..T-4 — the shipped behaviour: the Venues pill carries its count.
// ---------------------------------------------------------------------------

describe("#1565 — the Venues pill shows a count, like the other pills", () => {
  test("T-1 — MANY venues: the pill reads 'Venues · 3'", () => {
    const pills = readPills(
      ["events", "trips", "experiences", "venue"],
      { events: 2, trips: 0, experiences: 5, venue: 3 },
    );
    expect(pills.size).toBe(4); // vacuity guard
    expect(pills.has("venue")).toBe(true); // vacuity guard
    expect(pills.get("venue")?.text).toBe("Venues · 3");
    // Parity: the venue pill is formatted EXACTLY like its peers.
    expect(pills.get("events")?.text).toBe("Events · 2");
    expect(pills.get("experiences")?.text).toBe("Experiences · 5");
  });

  test("T-2 — ONE venue: the pill reads 'Venues · 1'", () => {
    const pills = readPills(["events", "venue"], { events: 1, venue: 1 });
    expect(pills.size).toBe(2); // vacuity guard
    expect(pills.has("venue")).toBe(true); // vacuity guard
    expect(pills.get("venue")?.text).toBe("Venues · 1");
  });

  test("T-3 — the label is pluralised: 'Venues', never bare 'Venue'", () => {
    const pills = readPills(["venue"], { venue: 2 });
    expect(pills.size).toBe(1); // vacuity guard
    const venue = pills.get("venue");
    expect(venue).toBeDefined(); // vacuity guard
    expect(venue?.text).toBe("Venues · 2");
    expect(venue?.text.startsWith("Venue ")).toBe(false);
    expect(venue?.accessibilityLabel).toBe("Venues sub-tab");
  });

  test("T-4 — the count survives a LARGE value verbatim (no truncation/cap)", () => {
    const pills = readPills(["venue"], { venue: 47 });
    expect(pills.size).toBe(1); // vacuity guard
    expect(pills.get("venue")?.text).toBe("Venues · 47");
  });
});

// ---------------------------------------------------------------------------
// T-5..T-7 — the invariant: "Venues · 0" is unreachable by construction.
// ---------------------------------------------------------------------------

describe("#1565 — 'Venues · 0' is unreachable by construction", () => {
  test("T-5 — ZERO venues: deriveHubVisibleTabs omits the pill entirely", () => {
    const visible = deriveHubVisibleTabs(
      { events: 3, trips: 0, experiences: 0 },
      { venueCount: 0 },
    );
    // Vacuity guard: the gate produced SOMETHING, so "no venue" is a real
    // exclusion rather than an empty result that would trivially satisfy it.
    expect(visible.length).toBeGreaterThan(0);
    expect(visible).toContain("events");
    expect(visible).not.toContain("venue");

    // ...and rendering that exact tab list produces no venue pill at all.
    const pills = readPills(visible as HubDataDrivenTabId[], {
      events: 3,
      venue: 0,
    });
    expect(pills.size).toBe(visible.length); // vacuity guard
    expect(pills.has("events")).toBe(true); // vacuity guard
    expect(pills.has("venue")).toBe(false);
  });

  test("T-6 — hasPhysicalLocation-ONLY: pill exists at venueCount 0 and reads a BARE 'Venues'", () => {
    // The legacy arm can show the pill for a reason that has nothing to do
    // with the count. "· 0" there would be a lie about why the tab exists.
    const visible = deriveHubVisibleTabs(
      { events: 1, trips: 0, experiences: 0 },
      { venueCount: 0, hasPhysicalLocation: true },
    );
    expect(visible.length).toBeGreaterThan(0); // vacuity guard
    expect(visible).toContain("venue"); // the pill DOES exist here

    const pills = readPills(visible as HubDataDrivenTabId[], {
      events: 1,
      venue: 0, // exactly what the layout threads for such a brand
    });
    expect(pills.size).toBe(visible.length); // vacuity guard
    expect(pills.has("venue")).toBe(true); // vacuity guard
    expect(pills.get("venue")?.text).toBe("Venues");
    expect(pills.get("venue")?.text).not.toContain("·");
    expect(pills.get("venue")?.text).not.toContain("0");
  });

  test("T-6b — hasPlacePool-ONLY behaves identically", () => {
    const visible = deriveHubVisibleTabs(
      { events: 0, trips: 1, experiences: 0 },
      { venueCount: 0, hasPlacePool: true },
    );
    expect(visible.length).toBeGreaterThan(0); // vacuity guard
    expect(visible).toContain("venue");

    const pills = readPills(visible as HubDataDrivenTabId[], {
      trips: 1,
      venue: 0,
    });
    expect(pills.size).toBe(visible.length); // vacuity guard
    expect(pills.has("venue")).toBe(true); // vacuity guard
    expect(pills.get("venue")?.text).toBe("Venues");
  });

  test("T-7 — an UNDEFINED venue count also renders the bare label", () => {
    const pills = readPills(["venue"], { events: 1 });
    expect(pills.size).toBe(1); // vacuity guard
    expect(pills.has("venue")).toBe(true); // vacuity guard
    expect(pills.get("venue")?.text).toBe("Venues");
  });

  test("T-7b — NO reachable input renders the exact string 'Venues · 0'", () => {
    // Sweep every count the layout can thread, plus undefined.
    const candidates: Array<number | undefined> = [
      undefined, 0, 1, 2, 3, 10,
    ];
    const rendered: string[] = [];
    for (const venue of candidates) {
      const pills = readPills(["venue"], { venue });
      expect(pills.has("venue")).toBe(true); // per-iteration vacuity guard
      rendered.push(pills.get("venue")?.text ?? "");
    }
    // Vacuity guard: the sweep produced one string per candidate.
    expect(rendered).toHaveLength(candidates.length);
    expect(rendered.every((s) => s.length > 0)).toBe(true);
    expect(rendered).not.toContain("Venues · 0");
    expect(rendered).toContain("Venues"); // the bare-label branch was exercised
    expect(rendered).toContain("Venues · 3"); // the counted branch was exercised
  });
});

// ---------------------------------------------------------------------------
// T-8 — the layout actually threads the count (the one-line omission that
// issue #1565 exists to close).
// ---------------------------------------------------------------------------

describe("#1565 — the Hub layout threads venueCount into HubSubNav", () => {
  const HUB_LAYOUT = readFileSync(
    join(__dirname, "../../../../app/(tabs)/hub/_layout.tsx"),
    "utf8",
  );

  /** Parse the `counts={{ ... }}` object literal handed to <HubSubNav>. */
  const parseCountsKeys = (): string[] => {
    const block = HUB_LAYOUT.match(/counts=\{\{([\s\S]*?)\}\}/);
    if (block === null) {
      throw new Error(
        "counts={{ ... }} block not found in app/(tabs)/hub/_layout.tsx — " +
          "this test can no longer see what it claims to guard",
      );
    }
    const keys: string[] = [];
    const entryRe = /^\s*(\w+)\s*:/gm;
    let m: RegExpExecArray | null;
    while ((m = entryRe.exec(block[1])) !== null) keys.push(m[1]);
    return keys;
  };

  test("T-8a — the parse is non-vacuous (it found the real counts block)", () => {
    expect(HUB_LAYOUT.length).toBeGreaterThan(1000);
    expect(HUB_LAYOUT).toContain("<HubSubNav");
    // venueCount is still computed where the issue said it was.
    expect(HUB_LAYOUT).toMatch(
      /venueCount\s*=\s*venueListings\.data\?\.length\s*\?\?\s*0/,
    );
    const keys = parseCountsKeys();
    expect(keys.length).toBeGreaterThanOrEqual(4);
  });

  test("T-8b — counts carries venue alongside events/trips/experiences", () => {
    const keys = parseCountsKeys();
    expect(keys).toContain("events"); // vacuity guard: we parsed the right block
    expect(keys).toContain("trips");
    expect(keys).toContain("experiences");
    expect(keys).toContain("venue"); // <- the fix
    // And it is wired to the already-computed count, not a fresh/narrower read.
    expect(HUB_LAYOUT).toMatch(/venue:\s*venueCount\s*,/);
  });
});

// ---------------------------------------------------------------------------
// T-9 — hubPillLabel as a pure function (the shared rule the component uses).
// ---------------------------------------------------------------------------

describe("#1565 — hubPillLabel rules", () => {
  const cases: ReadonlyArray<
    readonly [HubDataDrivenTabId, string, number | undefined, string]
  > = [
    ["venue", "Venues", 3, "Venues · 3"],
    ["venue", "Venues", 1, "Venues · 1"],
    ["venue", "Venues", 0, "Venues"],
    ["venue", "Venues", undefined, "Venues"],
    ["events", "Events", 0, "Events · 0"], // unchanged: draft-only brands
    ["events", "Events", 4, "Events · 4"],
    ["trips", "Trips", 2, "Trips · 2"],
    ["experiences", "Experiences", 9, "Experiences · 9"],
    ["getstarted", "Get started", 7, "Get started"], // pre-existing rule
    ["getstarted", "Get started", undefined, "Get started"],
  ];

  test("T-9 — the case table is non-empty and every row holds", () => {
    expect(cases.length).toBeGreaterThan(0); // vacuity guard
    let checked = 0;
    for (const [id, label, count, expected] of cases) {
      expect(hubPillLabel(id, label, count)).toBe(expected);
      checked += 1;
    }
    expect(checked).toBe(cases.length); // vacuity guard: every row ran
  });
});
