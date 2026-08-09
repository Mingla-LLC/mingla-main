/**
 * Issue #1685 [venue-draft-multi] — TESTER ADVERSARIAL suite.
 *
 * Attacks a DIFFERENT angle from the implementor's happy-path suites
 * (`draftVenueMultiDraft.issue1685.test.ts`, `venueCreateDoorFreshEntry.issue1685.test.tsx`):
 * those suites always PARK brand A's draft — via a `createDraft(<other brand>)`
 * call — before they probe the isolation boundary, so every cross-brand
 * assertion they make lands on the `drafts.find(...)` branch of
 * `activateDraft`, where the `entry.brandId !== brandId` guard exists.
 *
 * The realistic state they never construct is the one where brand A's draft is
 * still the ACTIVE one. Nothing calls `activateBrand` in production any more
 * (issue #1685 D-3 removed its only caller, `app/venue/create.tsx`), so
 * switching the current brand on Home does NOT touch `useDraftVenueStore`:
 * `activeDraftId` / `activeBrandId` keep pointing at the brand the operator was
 * last authoring under, indefinitely.
 *
 * Guards, by SPEC §5 criterion:
 *   A-1/A-2 — SC-7 brand isolation + META-ORCH-1255 Leg B
 *             (I-PROPOSED-1685-VENUE-DRAFTS-ARE-ID-KEYED-AND-BRAND-SCOPED).
 *   A-3     — SPEC §7 T-9 / #1461: a migrated unscoped draft must stay
 *             REACHABLE, not merely stored.
 *   A-4     — SC-3 litter prune must stay bounded across brand alternation.
 *
 * Relative imports only (COMMS-0130: a deep `@mingla/<pkg>/<sub>` specifier
 * resolves the ANCHOR checkout from inside a worktree).
 */
import { beforeEach, describe, expect, test } from "@jest/globals";

import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  draftVenueInProgress,
  draftVenuesForBrand,
  useDraftVenueStore,
} from "../draftVenueStore";

const PERSIST_KEY = "mingla-business-draft-venue-v3";
const BRAND_A = "brand-alpha";
const BRAND_B = "brand-bravo";

const store = useDraftVenueStore;

beforeEach(async () => {
  await AsyncStorage.removeItem(PERSIST_KEY);
  store.getState().reset();
});

// ---------------------------------------------------------------------------
// A-1 / A-2 — the ACTIVE-draft cross-brand boundary (SC-7)
// ---------------------------------------------------------------------------
describe("#1685 adversarial — brand B must not open brand A's ACTIVE draft", () => {
  /**
   * A-0 vacuity guard: the state under attack must genuinely be the one the
   * product reaches — brand A's draft ACTIVE (not parked) and genuinely
   * resume-worthy. Without this, A-1/A-2 could pass against an empty store.
   */
  test("A-0 — the attacked state is real: A's draft is ACTIVE and in progress", () => {
    const a1 = store.getState().createDraft(BRAND_A);
    store.getState().patch({ workingName: "Alpha Secret", step: 4 });

    const s = store.getState();
    expect(s.activeDraftId).toBe(a1);
    expect(s.activeBrandId).toBe(BRAND_A);
    expect(draftVenueInProgress(s)).toBe(true);
    // It is ACTIVE, not parked — this is the branch the pinned suites skip.
    expect(s.drafts.some((e) => e.id === a1)).toBe(false);
  });

  test("A-1 — activateDraft REFUSES a cross-brand id even when that draft is active", () => {
    const a1 = store.getState().createDraft(BRAND_A);
    store.getState().patch({ workingName: "Alpha Secret", step: 4 });

    // Operator leaves /venue/create and switches the current brand on Home.
    // No production code calls activateBrand, so the store still points at A.
    const opened = store.getState().activateDraft(a1, BRAND_B);

    // SC-7: "hand-navigating to /venue/create?draft=<A's id> while brand B is
    // current lands on the name gate with a fresh draft — never inside brand
    // A's work". The route takes its RESUME branch on `true`, so `true` here
    // IS the leak.
    expect(opened).toBe(false);
  });

  test("A-2 — a refused activation leaves A's ownership and content untouched", () => {
    const a1 = store.getState().createDraft(BRAND_A);
    store.getState().patch({ workingName: "Alpha Secret", step: 4 });

    store.getState().activateDraft(a1, BRAND_B);

    const s = store.getState();
    // Brand B must never end up authoring inside brand A's draft: the wizard
    // submits under `currentBrand`, so a silent adoption here would file brand
    // A's venue under brand B.
    expect(s.activeBrandId).not.toBe(BRAND_B);
    // And brand B must see nothing of A's work.
    expect(draftVenuesForBrand(s, BRAND_B)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// A-3 — a migrated unscoped draft must be REACHABLE, not merely stored (T-9)
// ---------------------------------------------------------------------------
describe("#1685 adversarial — a migrated unscoped legacy draft stays reachable", () => {
  test("A-3 — after the create door runs, the legacy draft is offered to a brand", async () => {
    // A genuine pre-change v3 blob whose draft was never scoped to a brand
    // (the #1461 case): `activeBrandId: null`, real half-built venue at top level.
    await AsyncStorage.setItem(
      PERSIST_KEY,
      JSON.stringify({
        state: {
          workingName: "Unscoped Orphan",
          displayName: "Unscoped Orphan",
          step: 6,
          activeBrandId: null,
          drafts: {},
        },
        version: 0,
      }),
    );
    await store.persist.rehydrate();

    // Vacuity guard — the migrator really did carry a resume-worthy draft.
    expect(draftVenueInProgress(store.getState())).toBe(true);
    expect(store.getState().workingName).toBe("Unscoped Orphan");

    // The ONLY thing a real operator can do next is press "+", which is the
    // create door: `createDraft(<their brand>)`. There is no UI that can emit
    // the orphan's draft id, because it has no "Finish adding …" row.
    store.getState().createDraft(BRAND_A);

    // SPEC §7 T-9 promises the arriving brand adopts it (#1461). If the entry
    // is parked with `brandId: null` it matches NO brand's resume rows and is
    // unreachable forever — silent data loss, the exact failure this work item
    // exists to prevent.
    const rows = draftVenuesForBrand(store.getState(), BRAND_A).filter((e) =>
      draftVenueInProgress(e.state),
    );
    expect(rows.map((e) => e.state.workingName)).toContain("Unscoped Orphan");
  });
});

// ---------------------------------------------------------------------------
// A-4 — litter stays bounded when brands alternate (SC-3, boundary case)
// ---------------------------------------------------------------------------
describe("#1685 adversarial — litter prune under brand alternation", () => {
  test("A-4 — alternating '+' presses across two brands never accumulate", () => {
    for (let i = 0; i < 10; i += 1) {
      store.getState().createDraft(BRAND_A);
      store.getState().createDraft(BRAND_B);
    }
    const parked = store.getState().drafts;
    // The prune in `createDraft` is scoped to the INCOMING brand, so an empty
    // draft belonging to the outgoing brand can survive one round-trip. One
    // blank per non-active brand is the ceiling; anything above that is an
    // unbounded storage leak across a long session.
    const blanks = parked.filter((e) => !draftVenueInProgress(e.state));
    expect(blanks.length).toBeLessThanOrEqual(1);
    expect(parked.filter((e) => draftVenueInProgress(e.state))).toEqual([]);
  });
});
