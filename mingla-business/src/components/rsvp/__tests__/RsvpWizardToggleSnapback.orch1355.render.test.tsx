/**
 * ORCH-1355 — RSVP wizard capacity toggle SNAP-BACK regression guard (symptom 2).
 *
 * Seth: "STEP 5 (guest limit): when you select 'limit guest', you CANNOT
 * deselect it — it keeps reselecting (the toggle snaps back ON)."
 *
 * [TEST-MOD-APPROVED ORCH-1355] — this is ORCH-1355's own bug-proving repro,
 * flipped from the failing bug-fingerprint assertions to the FIXED expectations
 * now that C-1/C-2/C-3 landed. It is the runtime fails-on-revert guard.
 *
 * It mounts the REAL production `RsvpStep5Setup` wired to the REAL
 * `draftEventStore` and a mirror of `RsvpCreatorWizard`'s FIXED parent
 * `handleUpdate` + `queueAutosave` wiring (RsvpCreatorWizard.tsx:367-397):
 * a STABLE callback that builds the autosave payload from the store's FRESH
 * post-write state (`getState().getDraft(id)`), never a captured `liveDraft`.
 *
 * FIXED MECHANISM under guard:
 *   - C-2: `toggleCapacity`-OFF now issues ONE combined patch
 *     ({ rsvpCapacity: null, rsvpWaitlistEnabled: false }).
 *   - C-3: the visibility "private" pick issues ONE combined patch
 *     ({ visibility: "private", rsvpDiscoverable: false }).
 *   - C-1: even when a handler fires TWO sequential dependent writes, the
 *     fresh-read `handleUpdate` COMPOUNDS them so the autosave payload carries
 *     both — the OFF write is never dropped, so the server never echoes a stale
 *     capacity back and the toggle stays OFF.
 *
 * Fails-on-revert: delete the fresh-read lines in the harness `handleUpdate`
 * (revert to `{ ...liveDraft, ...patch }`) → the "C-1 isolation" test FAILS.
 * Revert BOTH C-1 (harness) AND C-2 (RsvpStep5Setup) → the real-toggle snap-back
 * tests FAIL.
 *
 * Run: npx jest --config jest.orch1355.render.cjs --runInBand
 */

import React from "react";
import { act, fireEvent, render } from "@testing-library/react-native";

// In-memory AsyncStorage so the persisted store hydrates cleanly (null → no
// rehydrate) without pulling the native module.
jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(() => Promise.resolve(null)),
    setItem: jest.fn(() => Promise.resolve()),
    removeItem: jest.fn(() => Promise.resolve()),
    clear: jest.fn(() => Promise.resolve()),
  },
}));

// Icon is decorative; stub for a fast mount (mirrors the ORCH-1335 render test).
jest.mock("../../ui/Icon", () => {
  const { View: V } = require("react-native");
  return { Icon: ({ name }: any) => <V testID={`icon-${name}`} /> };
});

// draftEventStore imports liveEventConverter only for publishDraft (unused here);
// that chain pulls expo-constants. Cut it — the repro never publishes.
jest.mock("../../../utils/liveEventConverter", () => ({
  convertDraftToLiveEvent: () => null,
}));

import { RsvpStep5Setup } from "../RsvpStep5Setup";
import {
  useDraftEventStore,
  type DraftEvent,
} from "../../../store/draftEventStore";

type UpdatePatch = Partial<Omit<DraftEvent, "id" | "brandId" | "createdAt">>;

// ---------------------------------------------------------------------------
// Parent wiring mirroring RsvpCreatorWizard.tsx:367-397 AFTER the ORCH-1355 fix:
// a STABLE handleUpdate (deps hold only stable refs — draftId + store setters)
// that reads the FRESH post-write draft from the store for the autosave payload,
// so two sequential writes in one handler COMPOUND instead of clobbering. This
// is the exact updateDraft the real wizard threads into the step's `updateDraft`
// prop + its onAutosaveDraft.
// ---------------------------------------------------------------------------
const WizardHarness: React.FC<{
  draftId: string;
  onAutosaveDraft: (draft: DraftEvent) => void;
  exposeUpdate?: (fn: (patch: UpdatePatch) => void) => void;
}> = ({ draftId, onAutosaveDraft, exposeUpdate }) => {
  const liveDraft =
    useDraftEventStore((s) => s.drafts.find((d) => d.id === draftId)) ?? null;
  const updateDraft = useDraftEventStore((s) => s.updateDraft);
  const markDraftDirty = useDraftEventStore((s) => s.markDraftDirty);

  const latestDraftRef = React.useRef<DraftEvent | null>(liveDraft);
  const clientRevisionRef = React.useRef<number>(liveDraft?.clientRevision ?? 0);
  const autosaveTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  React.useEffect(() => {
    latestDraftRef.current = liveDraft;
    clientRevisionRef.current = Math.max(
      clientRevisionRef.current,
      liveDraft?.clientRevision ?? 0,
    );
  }, [liveDraft]);

  // queueAutosave — RsvpCreatorWizard.tsx:256-268 (700ms debounce).
  const queueAutosave = React.useCallback(
    (draft: DraftEvent): void => {
      if (autosaveTimerRef.current !== null) {
        clearTimeout(autosaveTimerRef.current);
      }
      autosaveTimerRef.current = setTimeout(() => {
        autosaveTimerRef.current = null;
        onAutosaveDraft(draft);
      }, 700);
    },
    [onAutosaveDraft],
  );

  // handleUpdate — ORCH-1355 FIXED shape (RsvpCreatorWizard.tsx:367-397): STABLE
  // deps + FRESH post-write read from the store. NO captured `liveDraft` in the
  // autosave payload.
  const handleUpdate = React.useCallback(
    (patch: UpdatePatch): void => {
      const nextRevision = clientRevisionRef.current + 1;
      clientRevisionRef.current = nextRevision;
      const revisionedPatch = { ...patch, clientRevision: nextRevision };
      markDraftDirty(draftId, nextRevision);
      updateDraft(draftId, revisionedPatch);
      const fresh =
        useDraftEventStore.getState().getDraft(draftId) ?? latestDraftRef.current;
      if (fresh === null) return;
      const nextDraft: DraftEvent = {
        ...fresh,
        updatedAt: new Date().toISOString(),
      };
      latestDraftRef.current = nextDraft;
      queueAutosave(nextDraft);
    },
    [draftId, markDraftDirty, queueAutosave, updateDraft],
  );

  // Expose the current handleUpdate so the C-1 isolation test can fire two raw
  // sequential dependent writes (the double-write shape the container fix must
  // compound). handleUpdate is stable so this runs once.
  React.useEffect(() => {
    exposeUpdate?.(handleUpdate);
  }, [exposeUpdate, handleUpdate]);

  if (liveDraft === null) return null;
  return (
    <RsvpStep5Setup
      draft={liveDraft}
      updateDraft={handleUpdate}
      errors={[]}
      showErrors={false}
      onShowToast={() => {}}
      scrollToBottom={() => {}}
      brandDefaultCurrency="USD"
    />
  );
};

const seedRsvpDraft = (): string => {
  const store = useDraftEventStore.getState();
  const draft = store.createRsvpDraft("brand_test");
  return draft.id;
};

describe("ORCH-1355 — capacity toggle snap-back (autosave must NOT drop the OFF write)", () => {
  beforeEach(() => {
    useDraftEventStore.getState().reset();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  test("turning capacity OFF autosaves rsvpCapacity=null + rsvpWaitlistEnabled=false (no stale drop)", async () => {
    jest.useFakeTimers(); // capture the 700ms autosave setTimeout from the start
    const id = seedRsvpDraft();
    const autosaved: DraftEvent[] = [];
    const onAutosave = (d: DraftEvent): void => {
      autosaved.push(d);
    };

    const screen = await render(
      <WizardHarness draftId={id} onAutosaveDraft={onAutosave} />,
    );

    const getCap = (): number | null =>
      useDraftEventStore.getState().getDraft(id)?.rsvpCapacity ?? null;

    // Precondition: capacity is OFF.
    expect(getCap()).toBeNull();

    // Tap "Limit the guest list" → ON. Store capacity becomes 1.
    await act(async () => {
      fireEvent.press(screen.getByTestId("rsvp-capacity-toggle"));
    });
    expect(getCap()).toBe(1);

    // Tap again → OFF. C-2 makes this ONE combined write (cap:null +
    // waitlist:false). The client store MUST end at cap=null.
    await act(async () => {
      fireEvent.press(screen.getByTestId("rsvp-capacity-toggle"));
    });
    expect(getCap()).toBeNull();

    // Flush the 700ms autosave debounce.
    await act(async () => {
      jest.advanceTimersByTime(800);
    });

    // The autosave that actually fired is the payload the server persists +
    // echoes. FIXED: it carries the OFF write, not the stale capacity.
    const lastAutosave = autosaved[autosaved.length - 1];
    expect(lastAutosave).toBeDefined();

    // --- FIXED expectations (were `=== 1` bug fingerprint pre-ORCH-1355) ------
    expect(lastAutosave.rsvpCapacity).toBeNull();
    expect(lastAutosave.rsvpWaitlistEnabled).toBe(false);

    // Store and autosave payload AGREE (both OFF) — the divergence is gone.
    expect(getCap()).toBeNull();
  });

  test("the OFF autosave, once echoed by the server, does NOT snap the toggle back ON", async () => {
    // End-to-end closure: the (now correct) payload reaches the server, is
    // persisted + echoed, and the real upsertServerDraft/shouldApplyServerDraft
    // path re-applies it → draft.rsvpCapacity stays null → the toggle
    // (capacityOn = rsvpCapacity !== null) stays OFF.
    jest.useFakeTimers();
    const id = seedRsvpDraft();
    const autosaved: DraftEvent[] = [];
    // beginDraftEdit mirrors the wizard mount (RsvpCreatorWizard.tsx:241-246) so
    // the editMeta the echo-guard consults exists.
    useDraftEventStore.getState().beginDraftEdit(id);
    const screen = await render(
      <WizardHarness draftId={id} onAutosaveDraft={(d) => autosaved.push(d)} />,
    );

    await act(async () => {
      fireEvent.press(screen.getByTestId("rsvp-capacity-toggle")); // ON
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId("rsvp-capacity-toggle")); // OFF
    });
    await act(async () => {
      jest.advanceTimersByTime(800);
    });

    const payload = autosaved[autosaved.length - 1];
    expect(payload.rsvpCapacity).toBeNull(); // correct payload leaves the client

    // Client is OFF right now…
    expect(
      useDraftEventStore.getState().getDraft(id)?.rsvpCapacity,
    ).toBeNull();

    // …server echoes the payload back (same clientRevision).
    await act(async () => {
      useDraftEventStore.getState().upsertServerDraft(payload);
    });

    // NO SNAP-BACK: capacity is still null → the toggle stays OFF.
    const echoed = useDraftEventStore.getState().getDraft(id);
    expect(echoed?.rsvpCapacity).toBeNull();
    expect(echoed?.rsvpCapacity !== null).toBe(false); // capacityOn === false
  });

  test("C-1 isolation — handleUpdate COMPOUNDS two sequential dependent writes into the autosave payload (fresh-read, not a stale closure)", async () => {
    // This bypasses RsvpStep5Setup and drives the container's handleUpdate raw,
    // firing the exact double-write a multi-field handler issues. It isolates
    // C-1: reverting the fresh-read lines to `{ ...liveDraft, ...patch }` drops
    // the first write → this FAILS (the handleUpdate fails-on-revert vector).
    jest.useFakeTimers();
    const id = seedRsvpDraft();
    // Precondition: capacity is a real number (mirrors 'capacity ON').
    await act(async () => {
      useDraftEventStore.getState().updateDraft(id, { rsvpCapacity: 5 });
    });

    const autosaved: DraftEvent[] = [];
    // No-op default so `update` is always callable; the harness effect replaces
    // it with the real handleUpdate on mount. If exposure ever failed, no write
    // fires → `last` is undefined → the assertions below fail loudly.
    let update: (patch: UpdatePatch) => void = () => {};
    await render(
      <WizardHarness
        draftId={id}
        onAutosaveDraft={(d) => autosaved.push(d)}
        exposeUpdate={(fn) => {
          update = fn;
        }}
      />,
    );

    // Two sequential DEPENDENT writes in one synchronous batch. The SECOND patch
    // does NOT re-include rsvpCapacity; a stale-closure handleUpdate rebuilds the
    // payload from the pre-write draft (cap=5) and DROPS the null. The fresh-read
    // handleUpdate reads the post-write store each call, so they compound.
    await act(async () => {
      update({ rsvpCapacity: null });
      update({ rsvpWaitlistEnabled: false });
    });
    await act(async () => {
      jest.advanceTimersByTime(800);
    });

    const last = autosaved[autosaved.length - 1];
    expect(last).toBeDefined();
    // FIXED expectation — the OFF write is NOT dropped.
    expect(last.rsvpCapacity).toBeNull();
    expect(last.rsvpWaitlistEnabled).toBe(false);
  });

  test("picking Private persists visibility=private AND rsvpDiscoverable=false in one write (C-3)", async () => {
    jest.useFakeTimers();
    const id = seedRsvpDraft();
    // Precondition: discovery ON + visibility public, so the forced OFF is real.
    await act(async () => {
      useDraftEventStore
        .getState()
        .updateDraft(id, { visibility: "public", rsvpDiscoverable: true });
    });
    const autosaved: DraftEvent[] = [];
    const screen = await render(
      <WizardHarness draftId={id} onAutosaveDraft={(d) => autosaved.push(d)} />,
    );

    await act(async () => {
      fireEvent.press(screen.getByTestId("rsvp-visibility-private"));
    });
    await act(async () => {
      jest.advanceTimersByTime(800);
    });

    const last = autosaved[autosaved.length - 1];
    expect(last).toBeDefined();
    // Autosave payload carries BOTH (the forced discover-OFF is not dropped).
    expect(last.visibility).toBe("private");
    expect(last.rsvpDiscoverable).toBe(false);
    // Store agrees.
    const d = useDraftEventStore.getState().getDraft(id);
    expect(d?.visibility).toBe("private");
    expect(d?.rsvpDiscoverable).toBe(false);
  });

  test("CONTROL — a single-write toggle (plus-ones) autosaves the CORRECT value", async () => {
    // Plus-ones OFF→ON is a single updateDraft (combined patch), so its autosave
    // payload is NOT stale. This isolates the defect to the DOUBLE-write path.
    jest.useFakeTimers();
    const id = seedRsvpDraft();
    const autosaved: DraftEvent[] = [];
    const screen = await render(
      <WizardHarness
        draftId={id}
        onAutosaveDraft={(d) => autosaved.push(d)}
      />,
    );

    await act(async () => {
      fireEvent.press(screen.getByTestId("rsvp-plusones-toggle"));
    });

    await act(async () => {
      jest.advanceTimersByTime(800);
    });

    const last = autosaved[autosaved.length - 1];
    expect(last.rsvpAllowPlusOnes).toBe(true); // single-write path is correct
    expect(last.rsvpPlusOnesMax).toBe(1);
  });

  test("clientRevision increases strictly monotonically across writes (autosave payloads)", async () => {
    // Guards SC-5: the fresh-read handleUpdate keeps clientRevision monotonic
    // (+1 per write) — the stability fix does not break the revision counter.
    jest.useFakeTimers();
    const id = seedRsvpDraft();
    const autosaved: DraftEvent[] = [];
    const screen = await render(
      <WizardHarness draftId={id} onAutosaveDraft={(d) => autosaved.push(d)} />,
    );

    const revs: number[] = [];
    for (const testId of [
      "rsvp-plusones-toggle",
      "rsvp-contribution-toggle",
      "rsvp-private-guestlist",
      "rsvp-hide-count",
    ]) {
      await act(async () => {
        fireEvent.press(screen.getByTestId(testId));
      });
      await act(async () => {
        jest.advanceTimersByTime(800);
      });
      revs.push(autosaved[autosaved.length - 1].clientRevision ?? 0);
    }

    for (let i = 1; i < revs.length; i++) {
      expect(revs[i]).toBeGreaterThan(revs[i - 1]);
    }
  });
});
