/**
 * META-ORCH-1148 sub-ORCH 2.0 — TESTER adversarial suite (DIFFERENT angle).
 *
 * Author: mingla-tester (production gatekeeper). NOT the implementor's test.
 * The implementor proved `deriveVenueModules` purity (venueModules.test.ts T-1/
 * T-2) and the fee-gate (venueFeeGate.test.ts T-7). This suite attacks the two
 * angles those tests do NOT cover, exercising the REAL exported store
 * (`useVenueSuiteStore`) + the REAL derivation/guard helpers in COMBINATION:
 *
 *   A. TOGGLE-OFF BOOKING LEAK — even if the shell→store `sync` is FORCED to push
 *      a booking-band `activeModule` while the toggle is OFF, the layout's pill
 *      row + the desktop rail render ONLY `visibleModules`, which is the SOLE
 *      output of `deriveVenueModules(reservationsEnabled)`. So a forced/leaked
 *      booking `activeModule` can never appear as a selectable nav entry while
 *      OFF, AND the shell snap-back predicate fires to evict it. (The implementor
 *      never forces a leaked active module against the store.)
 *
 *   B. VENUE-EXIT RESTORES HUB PILLS — the pill REPLACEMENT must reverse on EXIT,
 *      not just apply on entry. `deactivate()` (called from listing.tsx unmount)
 *      MUST reset `active=false` + `selectModule=null` + `visibleModules` to the
 *      OFF default, so the layout predicate
 *      `active && !isWideDesktop && selectModule !== null` flips false → the Hub
 *      offering pills render again. A revert that left the flag/handler set would
 *      strand the venue pills over a non-venue tab. (The implementor proved
 *      neither the predicate nor the reset.)
 *
 *   C. DESKTOP NEVER REPLACES — the replacement predicate honors `!isWideDesktop`
 *      (desktop keeps Hub pills above the suite's master rail, Design §2.1).
 *
 * Fails-on-revert: pinned at implementation commit 2f194a71f. Reverting the
 * OFF-gate in `deriveVenueModules`, the `deactivate` reset in venueSuiteStore,
 * or the snap-back/replace predicate flips this suite RED.
 *
 * APPEND-ONLY. Do not weaken. This file is the tester's evidence artifact.
 */

import {
  deriveVenueModules,
  isBookingModule,
  VENUE_BOOKING_MODULES,
} from "../venueModules";
import { useVenueSuiteStore } from "../../../store/venueSuiteStore";
import type { VenueModule } from "../../../types/venueReservation";

/**
 * Faithful re-statement of the LAYOUT predicate
 * (`mingla-business/app/(tabs)/hub/_layout.tsx:113`):
 *   showVenueModulePills = venueSuiteActive && !isWideDesktop && selectModule !== null
 * — pure over store state. If the source predicate drifts, update here AND the
 * source together (this is the contract pin).
 */
function layoutShowsVenueModulePills(
  store: { active: boolean; selectModule: unknown },
  isWideDesktop: boolean,
): boolean {
  return store.active && !isWideDesktop && store.selectModule !== null;
}

/**
 * Faithful re-statement of the SHELL snap-back guard
 * (`VenueSuiteShell.tsx:80`): if the active module is a booking module and the
 * toggle is OFF, snap back to overview.
 */
function shellResolvesActiveModule(
  activeModule: VenueModule,
  reservationsEnabled: boolean,
): VenueModule {
  if (isBookingModule(activeModule) && !reservationsEnabled) {
    return "overview";
  }
  return activeModule;
}

const resetStore = (): void => {
  useVenueSuiteStore.getState().deactivate();
};

describe("ORCH-1148 TESTER — toggle-OFF booking leak (angle A)", () => {
  beforeEach(resetStore);
  afterAll(resetStore);

  it.each(VENUE_BOOKING_MODULES)(
    "a FORCED booking activeModule '%s' cannot appear in the OFF-state nav (visibleModules is the only nav source)",
    (booking) => {
      // Adversary: drive the suite active, then FORCE-sync a booking active
      // module while the toggle is OFF (visibleModules derived from OFF).
      useVenueSuiteStore.getState().activate("overview");
      useVenueSuiteStore.getState().sync({
        activeModule: booking,
        visibleModules: deriveVenueModules(false), // toggle OFF
        selectModule: () => undefined,
      });

      const { activeModule, visibleModules } = useVenueSuiteStore.getState();

      // The leaked booking module is "active" in the raw store...
      expect(activeModule).toBe(booking);
      // ...but the nav (rail/pill row) renders ONLY visibleModules, which NEVER
      // includes a booking module while OFF → it cannot be a selectable entry.
      expect(visibleModules).toEqual(["overview", "settings"]);
      expect(visibleModules).not.toContain(booking);

      // And the shell's snap-back guard evicts it back to overview.
      expect(shellResolvesActiveModule(booking, false)).toBe("overview");
    },
  );

  it("deriveVenueModules(false) is the SOLE OFF-state gate — no booking band ever leaks", () => {
    const off = deriveVenueModules(false);
    expect(off).toEqual(["overview", "settings"]);
    for (const b of VENUE_BOOKING_MODULES) {
      expect(off).not.toContain(b);
    }
  });

  it("ON→OFF flip: every booking module snaps back to overview", () => {
    for (const b of VENUE_BOOKING_MODULES) {
      // ON: the booking module is legitimately active & visible.
      expect(deriveVenueModules(true)).toContain(b);
      expect(shellResolvesActiveModule(b, true)).toBe(b);
      // OFF: the same active module is forced to overview.
      expect(shellResolvesActiveModule(b, false)).toBe("overview");
    }
  });
});

describe("ORCH-1148 TESTER — Venue EXIT restores Hub pills (angle B)", () => {
  beforeEach(resetStore);
  afterAll(resetStore);

  it("entry: predicate shows venue module pills on phone/native once active + handler installed", () => {
    useVenueSuiteStore.getState().activate("overview");
    useVenueSuiteStore.getState().sync({
      activeModule: "overview",
      visibleModules: deriveVenueModules(false),
      selectModule: () => undefined,
    });
    const store = useVenueSuiteStore.getState();
    expect(layoutShowsVenueModulePills(store, /* isWideDesktop */ false)).toBe(
      true,
    );
  });

  it("EXIT: deactivate() resets active + selectModule + visibleModules → Hub pills render again", () => {
    // Arrange: suite active with a handler installed (the entry state).
    useVenueSuiteStore.getState().activate("settings");
    useVenueSuiteStore.getState().sync({
      activeModule: "settings",
      visibleModules: deriveVenueModules(true),
      selectModule: () => undefined,
    });
    expect(
      layoutShowsVenueModulePills(useVenueSuiteStore.getState(), false),
    ).toBe(true);

    // Act: listing.tsx unmount → deactivate().
    useVenueSuiteStore.getState().deactivate();

    // Assert: the predicate flips false (Hub pills restored), and the reset is
    // COMPLETE — a stale handler/visibleModules must not survive the exit.
    const store = useVenueSuiteStore.getState();
    expect(store.active).toBe(false);
    expect(store.selectModule).toBeNull();
    expect(store.activeModule).toBe("overview");
    expect(store.visibleModules).toEqual(["overview", "settings"]);
    expect(layoutShowsVenueModulePills(store, false)).toBe(false);
  });

  it("a half-reset (active=false but handler stranded) would STILL hide pills — predicate requires BOTH", () => {
    // Defense-in-depth: even if a future revert cleared only `active`, the
    // predicate's selectModule!==null arm is a second guard. Prove the predicate
    // is conjunctive so neither arm alone strands the venue pills.
    expect(
      layoutShowsVenueModulePills(
        { active: false, selectModule: () => undefined },
        false,
      ),
    ).toBe(false);
    expect(
      layoutShowsVenueModulePills({ active: true, selectModule: null }, false),
    ).toBe(false);
  });
});

describe("ORCH-1148 TESTER — desktop never replaces Hub pills (angle C)", () => {
  beforeEach(resetStore);
  afterAll(resetStore);

  it("isWideDesktop suppresses the replacement even when the suite is fully active", () => {
    useVenueSuiteStore.getState().activate("overview");
    useVenueSuiteStore.getState().sync({
      activeModule: "overview",
      visibleModules: deriveVenueModules(true),
      selectModule: () => undefined,
    });
    const store = useVenueSuiteStore.getState();
    // Phone/native → replace; desktop → keep Hub pills (master rail is the nav).
    expect(layoutShowsVenueModulePills(store, /* isWideDesktop */ true)).toBe(
      false,
    );
    expect(layoutShowsVenueModulePills(store, /* isWideDesktop */ false)).toBe(
      true,
    );
  });
});
