/**
 * Issue #2755 — a Menu request failure is never represented as successful
 * emptiness. This file is additive: the pre-existing venue and ordering suites
 * remain immutable and continue to guard their own contracts.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { resolvePublicVenueMenuPresentation } from "@mingla/brand-rendering/PublicVenueScreen";

describe("#2755 public venue Menu request truth", () => {
  test.each([
    ["cold loading", "loading", true, 0, true, true, "Loading menu…"],
    ["populated success", "ready", false, 2, true, false, "Updating menu…"],
    ["successful empty", "ready", false, 0, false, false, "Loading menu…"],
    ["populated refresh", "ready", true, 2, true, true, "Updating menu…"],
    ["cold failure", "error", false, 0, true, true, "Menu couldn’t load"],
    [
      "stale failure",
      "error",
      false,
      2,
      true,
      true,
      "Menu may be out of date.",
    ],
  ] as const)(
    "%s",
    (_name, state, fetching, count, hasMenu, showState, copy) => {
      expect(
        resolvePublicVenueMenuPresentation(state, fetching, count, true),
      ).toMatchObject({ hasMenu, showState, copy });
    },
  );

  test("Stay remains menu-free even while a request state is unresolved", () => {
    expect(
      resolvePublicVenueMenuPresentation("error", false, 0, false).hasMenu,
    ).toBe(false);
  });

  test("Consumer keeps one query identity and structurally retains cached menu data", () => {
    const hook = readFileSync(
      resolve(process.cwd(), "../app-mobile/src/hooks/usePublicVenue.ts"),
      "utf8",
    );
    expect(hook).toContain("publicVenueKeys.bySlug(brandSlug, venueSlug)");
    expect(hook).toContain('next?.menuState === "error"');
    expect(hook).toContain("menu: previous.menu");
    expect(hook).toContain("menuWindows: previous.menuWindows");
  });

  test("Consumer service isolates Menu failure instead of throwing the venue away", () => {
    const service = readFileSync(
      resolve(
        process.cwd(),
        "../app-mobile/src/services/publicVenueService.ts",
      ),
      "utf8",
    );
    expect(service).not.toContain(
      "if (menuResult.error !== null) throw menuResult.error",
    );
    expect(service).toContain(
      'menuState: menuResult.error === null ? "ready" : "error"',
    );
  });

  test("the shared boundary requires lifecycle truth and both adapters supply it", () => {
    const screen = readFileSync(
      resolve(
        process.cwd(),
        "../packages/brand-rendering/PublicVenueScreen.tsx",
      ),
      "utf8",
    );
    const buyer = readFileSync(
      resolve(
        process.cwd(),
        "app/b/[brandSlug]/v/[venueSlug].tsx",
      ),
      "utf8",
    );
    const consumer = readFileSync(
      resolve(
        process.cwd(),
        "../app-mobile/app/b/[brandSlug]/v/[venueSlug].tsx",
      ),
      "utf8",
    );
    expect(screen).toContain("menuLifecycle: PublicVenueMenuLifecycle;");
    expect(screen).not.toContain("menuLifecycle?:");
    expect(screen).not.toContain('menuLifecycle = { state: "ready"');
    expect(buyer).toContain("menuLifecycle={{");
    expect(consumer).toContain("menuLifecycle={{");
  });
});
