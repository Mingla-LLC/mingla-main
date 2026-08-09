/**
 * Issue #1685 [venue-draft-multi] — draftVenueStore list-model regression suite
 * (SPEC §9 supporting suite; §7 T-4…T-10, T-15, T-16, T-17).
 *
 * Guards I-PROPOSED-1685-VENUE-DRAFTS-ARE-ID-KEYED-AND-BRAND-SCOPED:
 *   - drafts are addressed by client id and carry their owning brand;
 *   - one brand can hold several concurrent unfinished venues;
 *   - brand B can never open brand A's draft;
 *   - the persist KEY is never renamed (the highest-consequence trap in this
 *     work item — a rename silently destroys every operator's in-progress
 *     venue on update), proven BEHAVIOURALLY by writing a legacy v3 blob to the
 *     literal key and rehydrating the real store through the real migrator;
 *   - single-draft deletion is deleteDraft/deleteActiveDraft, NEVER
 *     reset(brandId), which wipes the brand's whole parking lot.
 *
 * Runs under the stock mingla-business/jest.config.cjs.
 */
import { beforeEach, describe, expect, test } from "@jest/globals";
import React from "react";

import AsyncStorage from "@react-native-async-storage/async-storage";
import { readFileSync } from "fs";
import { join } from "path";

import {
  draftVenueInProgress,
  draftVenuesForBrand,
  draftVenueForBrand,
  useDraftVenueStore,
  useVenueDraftEntriesForBrand,
  type DraftVenueEntry,
} from "../draftVenueStore";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

// react-test-renderer ships no bundled types; CJS-require it the way the
// ORCH-0976 route suites do (proven under this stock config).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (el: React.ReactElement) => { unmount: () => void };
  act: (cb: () => void) => void;
};

/**
 * The persist key, spelled out as a LITERAL. Issue #1685 keeps the `-v3` name
 * and moves the shape with `version` + `migrate`; renaming it to `-v4` would
 * orphan every in-progress draft on every device.
 */
const PERSIST_KEY = "mingla-business-draft-venue-v3";

const store = useDraftVenueStore;

const seedLegacyBlob = async (
  state: unknown,
  version: number,
): Promise<void> => {
  await AsyncStorage.setItem(PERSIST_KEY, JSON.stringify({ state, version }));
  await store.persist.rehydrate();
};

beforeEach(async () => {
  await AsyncStorage.removeItem(PERSIST_KEY);
  store.getState().reset();
});

// ---------------------------------------------------------------------------
// Persist contract — the key-rename trap (SPEC §4.1.7)
// ---------------------------------------------------------------------------
describe("#1685 persist contract — the key is NOT renamed", () => {
  test("name is still `mingla-business-draft-venue-v3` and version is 4", () => {
    const options = store.persist.getOptions();
    expect(options.name).toBe(PERSIST_KEY);
    expect(options.version).toBe(4);
    // The literal must also be present in the source, so a rename cannot pass
    // by mutating the constant this test reads.
    const source = readFileSync(join(__dirname, "..", "draftVenueStore.ts"), "utf8");
    expect(source).toContain(`name: "${PERSIST_KEY}"`);
    expect(source).toContain("version: 4");
    expect(source).not.toContain("mingla-business-draft-venue-v4");
  });
});

// ---------------------------------------------------------------------------
// T-8 / T-9 / T-10 — the v3 -> v4 migration, through the REAL persist path
// ---------------------------------------------------------------------------
describe("#1685 T-8/T-9/T-10 — v3 -> v4 migration", () => {
  test("T-8 — both legacy drafts survive with every field intact", async () => {
    await seedLegacyBlob(
      {
        // Legacy ACTIVE (top-level) draft, owned by brand a.
        workingName: "Lumen Wine Bar",
        displayName: "Lumen Wine Bar",
        venueCategory: "bar",
        formattedAddress: "12 Ossington Ave",
        city: "Toronto",
        contactPhone: "+14165550123",
        step: 3,
        activeBrandId: "brand-a",
        // Legacy PARKED per-brand record.
        drafts: {
          "brand-b": {
            workingName: "Vine Hall",
            displayName: "Vine Hall",
            venueCategory: "restaurant",
            formattedAddress: "9 Dundas St W",
            step: 5,
          },
        },
      },
      0,
    );

    const s = store.getState();
    // The active draft stayed at top level and gained an id.
    expect(s.activeBrandId).toBe("brand-a");
    expect(s.activeDraftId).not.toBeNull();
    expect(s.activeDraftId?.startsWith("dv_")).toBe(true);
    expect(s.workingName).toBe("Lumen Wine Bar");
    expect(s.formattedAddress).toBe("12 Ossington Ave");
    expect(s.city).toBe("Toronto");
    expect(s.contactPhone).toBe("+14165550123");
    expect(s.step).toBe(3);

    // The parked record entry became ONE list entry with its brand stamped.
    expect(Array.isArray(s.drafts)).toBe(true);
    expect(s.drafts).toHaveLength(1);
    const carried = s.drafts[0];
    expect(carried.brandId).toBe("brand-b");
    expect(carried.id.startsWith("dv_")).toBe(true);
    expect(carried.state.workingName).toBe("Vine Hall");
    expect(carried.state.formattedAddress).toBe("9 Dundas St W");
    expect(carried.state.step).toBe(5);
    // Additive-optional defaults materialised exactly as hydration does today.
    expect(carried.state.galleryUrls).toEqual([]);
    expect(carried.state.themeOverrides).toBeNull();
    expect(carried.state.submissionVenueId).toBeNull();
    expect(carried.state.contactPhoneCountryIso).toBeNull();

    // Both are genuinely resumable.
    expect(draftVenueInProgress(draftVenueForBrand(s, "brand-a"))).toBe(true);
    expect(draftVenueInProgress(draftVenueForBrand(s, "brand-b"))).toBe(true);
  });

  test("T-9 — an unscoped legacy draft is carried, then adopted by the first brand", async () => {
    await seedLegacyBlob(
      { workingName: "Unscoped Venue", step: 2, activeBrandId: null, drafts: {} },
      0,
    );
    expect(store.getState().activeBrandId).toBeNull();
    expect(store.getState().workingName).toBe("Unscoped Venue");
    const adoptedId = store.getState().activeDraftId;
    expect(adoptedId).not.toBeNull();

    // #1461 — the first brand to arrive stamps it; the work is NOT replaced.
    store.getState().activateBrand("brand-late");
    expect(store.getState().activeBrandId).toBe("brand-late");
    expect(store.getState().workingName).toBe("Unscoped Venue");
    expect(store.getState().activeDraftId).toBe(adoptedId);
  });

  test("T-10 — a malformed blob degrades to an empty list without throwing", async () => {
    await seedLegacyBlob(
      { workingName: "Survivor", step: 1, activeBrandId: "brand-a", drafts: "garbage" },
      0,
    );
    expect(store.getState().drafts).toEqual([]);
    // The top-level draft is STILL carried — malformed siblings must not cost
    // the operator the venue they were actually working on.
    expect(store.getState().workingName).toBe("Survivor");
    expect(store.getState().step).toBe(1);
  });

  test("a blob already at version 4 passes through untouched", async () => {
    const entry: DraftVenueEntry = {
      id: "dv_already",
      brandId: "brand-a",
      updatedAt: "2026-08-01T00:00:00.000Z",
      state: { ...store.getState(), workingName: "Already v4" },
    };
    await seedLegacyBlob(
      {
        ...store.getState(),
        workingName: "",
        activeBrandId: "brand-a",
        activeDraftId: null,
        drafts: [entry],
      },
      4,
    );
    expect(store.getState().drafts).toHaveLength(1);
    expect(store.getState().drafts[0].id).toBe("dv_already");
    expect(store.getState().drafts[0].state.workingName).toBe("Already v4");
  });
});

// ---------------------------------------------------------------------------
// T-5 / T-6 / T-7 — mint, concurrency, isolation
// ---------------------------------------------------------------------------
describe("#1685 T-5/T-6/T-7 — mint, concurrency, brand isolation", () => {
  test("T-5 — ten '+' presses with no typing leave at most one draft and zero rows", () => {
    const ids: string[] = [];
    for (let i = 0; i < 10; i += 1) ids.push(store.getState().createDraft("brand-a"));
    // Every press minted a DISTINCT id (the create door never reuses one).
    expect(new Set(ids).size).toBe(10);
    const entries = draftVenuesForBrand(store.getState(), "brand-a");
    expect(entries.length).toBeLessThanOrEqual(1);
    expect(entries.filter((e) => draftVenueInProgress(e.state))).toHaveLength(0);
    expect(store.getState().drafts.filter((e) => e.brandId === "brand-a")).toHaveLength(0);
  });

  test("T-6 — three concurrent drafts under ONE brand, each resumable by id", () => {
    const a = store.getState().createDraft("brand-a");
    store.getState().patch({ workingName: "Lumen Wine Bar", step: 3 });
    const b = store.getState().createDraft("brand-a");
    store.getState().patch({ workingName: "Vine Hall", step: 5 });
    const c = store.getState().createDraft("brand-a");
    store.getState().patch({ workingName: "Third Room", step: 1 });

    expect(new Set([a, b, c]).size).toBe(3);
    const rows = draftVenuesForBrand(store.getState(), "brand-a").filter((e) =>
      draftVenueInProgress(e.state),
    );
    expect(rows).toHaveLength(3);

    expect(store.getState().activateDraft(a, "brand-a")).toBe(true);
    expect(store.getState().workingName).toBe("Lumen Wine Bar");
    expect(store.getState().step).toBe(3);

    expect(store.getState().activateDraft(b, "brand-a")).toBe(true);
    expect(store.getState().workingName).toBe("Vine Hall");
    expect(store.getState().step).toBe(5);

    expect(store.getState().activateDraft(c, "brand-a")).toBe(true);
    expect(store.getState().workingName).toBe("Third Room");
    expect(store.getState().step).toBe(1);

    // Nothing was overwritten by the round trip.
    expect(store.getState().getDraftEntry(a)?.state.workingName).toBe("Lumen Wine Bar");
    expect(store.getState().getDraftEntry(b)?.state.workingName).toBe("Vine Hall");
  });

  test("T-7 / T-4 — brand B sees nothing of brand A and cannot open A's draft", () => {
    const a1 = store.getState().createDraft("brand-a");
    store.getState().patch({ workingName: "Alpha One", step: 2 });
    store.getState().createDraft("brand-a");
    store.getState().patch({ workingName: "Alpha Two", step: 4 });

    expect(draftVenuesForBrand(store.getState(), "brand-b")).toEqual([]);

    // Brand B is current; hand-navigating to brand A's draft id must fail
    // CLOSED and change nothing (META-ORCH-1255 isolation boundary).
    store.getState().createDraft("brand-b");
    const beforeIds = store.getState().drafts.map((e) => e.id);
    expect(store.getState().activateDraft(a1, "brand-b")).toBe(false);
    expect(store.getState().drafts.map((e) => e.id)).toEqual(beforeIds);
    expect(store.getState().getDraftEntry(a1)?.state.workingName).toBe("Alpha One");
    expect(store.getState().activeBrandId).toBe("brand-b");

    // An unknown id also fails closed.
    expect(store.getState().activateDraft("dv_nope", "brand-b")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// T-15 / T-16 — deletion scope
// ---------------------------------------------------------------------------
describe("#1685 T-15/T-16 — deletion scope", () => {
  test("T-15 — deleteActiveDraft removes ONE draft; reset(brandId) would remove both", () => {
    const x = store.getState().createDraft("brand-a");
    store.getState().patch({ workingName: "Submitting X", step: 9 });
    const y = store.getState().createDraft("brand-a");
    store.getState().patch({ workingName: "Sibling Y", step: 4, city: "Lagos" });
    // Re-activate X so it is the draft being submitted.
    expect(store.getState().activateDraft(x, "brand-a")).toBe(true);

    store.getState().deleteActiveDraft();

    expect(store.getState().getDraftEntry(x)).toBeNull();
    const survivor = store.getState().getDraftEntry(y);
    expect(survivor).not.toBeNull();
    expect(survivor?.state.workingName).toBe("Sibling Y");
    expect(survivor?.state.step).toBe(4);
    expect(survivor?.state.city).toBe("Lagos");

    // The counter-proof: the primitive the submit path USED to call destroys
    // the survivor too. This is exactly why VenueCreatorWizard must not call it.
    store.getState().reset("brand-a");
    expect(store.getState().getDraftEntry(y)).toBeNull();
  });

  test("T-15 (source) — the wizard's submit paths clear ONE draft, never the brand's drafts", () => {
    const wizard = readFileSync(
      join(__dirname, "..", "..", "components", "venue", "VenueCreatorWizard.tsx"),
      "utf8",
    );
    const deletes = wizard.match(/useDraftVenueStore\.getState\(\)\.deleteActiveDraft\(\)/g) ?? [];
    expect(deletes).toHaveLength(3);
    expect(wizard).not.toMatch(/useDraftVenueStore\.getState\(\)\.reset\(/);
  });

  test("T-16 — logout wipes everything (Constitution #6)", () => {
    store.getState().createDraft("brand-a");
    store.getState().patch({ workingName: "Alpha", step: 2 });
    store.getState().createDraft("brand-b");
    store.getState().patch({ workingName: "Beta", step: 3 });

    store.getState().reset();

    const s = store.getState();
    expect(s.drafts).toEqual([]);
    expect(s.activeDraftId).toBeNull();
    expect(s.activeBrandId).toBeNull();
    expect(s.workingName).toBe("");
    expect(s.displayName).toBe("");
    expect(s.step).toBe(0);
    expect(draftVenuesForBrand(s, "brand-a")).toEqual([]);
    expect(draftVenuesForBrand(s, "brand-b")).toEqual([]);
  });

  test("deleteDraft on a PARKED id leaves the active draft untouched", () => {
    const parked = store.getState().createDraft("brand-a");
    store.getState().patch({ workingName: "Parked One", step: 2 });
    store.getState().createDraft("brand-a");
    store.getState().patch({ workingName: "Active One", step: 6 });

    store.getState().deleteDraft(parked);

    expect(store.getState().getDraftEntry(parked)).toBeNull();
    expect(store.getState().workingName).toBe("Active One");
    expect(store.getState().step).toBe(6);
    expect(store.getState().activeDraftId).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// T-17 — selector stability (the infinite useSyncExternalStore loop hazard)
// ---------------------------------------------------------------------------
describe("#1685 T-17 — useVenueDraftEntriesForBrand is referentially stable", () => {
  test("re-rendering with no draft change returns the SAME array reference", () => {
    store.getState().createDraft("brand-a");
    store.getState().patch({ workingName: "Stable Venue", step: 2 });

    const seen: DraftVenueEntry[][] = [];
    let bump: () => void = () => undefined;
    let renders = 0;

    const Harness: React.FC = () => {
      const [, setTick] = React.useState(0);
      bump = () => setTick((t) => t + 1);
      renders += 1;
      seen.push(useVenueDraftEntriesForBrand("brand-a"));
      return null;
    };

    let tree: { unmount: () => void } | null = null;
    TestRenderer.act(() => {
      tree = TestRenderer.create(React.createElement(Harness));
    });
    TestRenderer.act(() => {
      bump();
    });

    // A render loop would blow the render count far past this.
    expect(renders).toBeLessThan(10);
    expect(seen.length).toBeGreaterThanOrEqual(2);
    expect(seen[seen.length - 1]).toBe(seen[seen.length - 2]);
    expect(seen[seen.length - 1]).toHaveLength(1);
    expect(seen[seen.length - 1][0].state.workingName).toBe("Stable Venue");

    TestRenderer.act(() => {
      (tree as unknown as { unmount: () => void }).unmount();
    });
  });
});
