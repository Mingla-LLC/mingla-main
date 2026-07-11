/**
 * ORCH-1355 — SYMPTOM 2 (guest-limit toggle snap-back) TESTER ADVERSARIAL guard.
 *
 * DIFFERENT ANGLE from the implementor's render suite
 * (RsvpWizardToggleSnapback.orch1355.render.test.tsx), which flushes the 700ms
 * autosave debounce AFTER EACH discrete tap and asserts the resulting payload.
 * This suite attacks the REAL production `RsvpStep5Setup` from angles the
 * implementor did NOT cover:
 *
 *   1. SINGLE-PATCH CALL-COUNT on the REAL component (C-2): the OFF tap must
 *      issue EXACTLY ONE `updateDraft` call carrying BOTH fields
 *      ({ rsvpCapacity: null, rsvpWaitlistEnabled: false }). A spy wraps the
 *      real `handleUpdate`, so this asserts against the shipped RsvpStep5Setup —
 *      reverting C-2 to two writes makes it 2 calls → FAILS.
 *   2. SINGLE-PATCH CALL-COUNT on the REAL component (C-3): the "Private" pick
 *      must issue EXACTLY ONE call carrying { visibility, rsvpDiscoverable }.
 *      Reverting C-3 to two writes → FAILS.
 *   3. DEBOUNCE-COALESCED BURST end-to-end + SERVER ECHO: fire capacity ON → OFF
 *      → "Private" ALL inside ONE 700ms window (no flush between). Only the LAST
 *      queued autosave survives (the debounce coalesces). Assert that ONE
 *      coalesced payload carries cap=null + waitlist=false + visibility=private +
 *      discoverable=false, and that the REAL `upsertServerDraft` echo of it does
 *      NOT snap capacity back ON. Proves OFF survives end-to-end under a burst.
 *   4. RAPID ON/OFF/ON/OFF ending OFF within one window + clientRevision
 *      MONOTONICITY UNDER A BURST: the single coalesced payload must carry the
 *      LATEST revision (== store revision, and strictly the highest) — proving no
 *      stale earlier-revision payload wins the debounce.
 *
 * Fails-on-revert (PRODUCT code, 5d7c8320b): revert C-2 (RsvpStep5Setup
 * toggleCapacity → two writes) → test 1 FAILS; revert C-3 (visibility pick →
 * two writes) → test 2 FAILS. Verified by true line deletion (see TEST report).
 *
 * Run: npx jest --config jest.orch1355.tester.cjs --runInBand
 */

import React from "react";
import { act, fireEvent, render } from "@testing-library/react-native";

jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(() => Promise.resolve(null)),
    setItem: jest.fn(() => Promise.resolve()),
    removeItem: jest.fn(() => Promise.resolve()),
    clear: jest.fn(() => Promise.resolve()),
  },
}));

jest.mock("../../ui/Icon", () => {
  const { View: V } = require("react-native");
  return { Icon: ({ name }: any) => <V testID={`icon-${name}`} /> };
});

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
// Harness mirroring RsvpCreatorWizard's FIXED handleUpdate/queueAutosave wiring
// (fresh-read + stable), but the `updateDraft` prop handed to the REAL
// RsvpStep5Setup is instrumented with a spy so we can count how many times the
// COMPONENT calls it AND read the RAW patch — i.e. we assert against the shipped
// RsvpStep5Setup's single-patch behaviour (C-2/C-3), not a mirror.
// ---------------------------------------------------------------------------
const WizardHarness: React.FC<{
  draftId: string;
  onAutosaveDraft: (draft: DraftEvent) => void;
  rawSpyRef?: React.MutableRefObject<((patch: UpdatePatch) => void) | null>;
}> = ({ draftId, onAutosaveDraft, rawSpyRef }) => {
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

  // The prop handed to the REAL RsvpStep5Setup: record the RAW patch (before
  // handleUpdate stamps clientRevision) so the test can count the component's
  // updateDraft calls, then forward to the real fresh-read handleUpdate.
  const spiedUpdate = React.useCallback(
    (patch: UpdatePatch): void => {
      rawSpyRef?.current?.(patch);
      handleUpdate(patch);
    },
    [handleUpdate, rawSpyRef],
  );

  if (liveDraft === null) return null;
  return (
    <RsvpStep5Setup
      draft={liveDraft}
      updateDraft={spiedUpdate}
      errors={[]}
      showErrors={false}
      onShowToast={() => {}}
      scrollToBottom={() => {}}
      brandDefaultCurrency="USD"
    />
  );
};

const seedRsvpDraft = (): string =>
  useDraftEventStore.getState().createRsvpDraft("brand_tester").id;

describe("ORCH-1355 symptom 2 — tester adversarial (single-patch + burst-coalesce + echo)", () => {
  beforeEach(() => {
    useDraftEventStore.getState().reset();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  test("C-2 — the OFF tap issues EXACTLY ONE combined updateDraft patch on the REAL component (cap:null + waitlist:false)", async () => {
    const id = seedRsvpDraft();
    const rawSpyRef: React.MutableRefObject<
      ((patch: UpdatePatch) => void) | null
    > = { current: null };
    const spy = jest.fn();
    rawSpyRef.current = spy;

    const screen = await render(
      <WizardHarness draftId={id} onAutosaveDraft={() => {}} rawSpyRef={rawSpyRef} />,
    );

    // Turn capacity ON first (so the next tap is the real OFF path).
    await act(async () => {
      fireEvent.press(screen.getByTestId("rsvp-capacity-toggle"));
    });
    expect(useDraftEventStore.getState().getDraft(id)?.rsvpCapacity).toBe(1);

    // Isolate the OFF tap.
    spy.mockClear();
    await act(async () => {
      fireEvent.press(screen.getByTestId("rsvp-capacity-toggle"));
    });

    // ADVERSARIAL ASSERTION — the shipped C-2 must issue ONE combined write.
    // Reverting C-2 to two writes makes this 2 → FAILS.
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({
      rsvpCapacity: null,
      rsvpWaitlistEnabled: false,
    });
    expect(useDraftEventStore.getState().getDraft(id)?.rsvpCapacity).toBeNull();
  });

  test("C-3 — the Private pick issues EXACTLY ONE combined updateDraft patch on the REAL component (visibility + rsvpDiscoverable)", async () => {
    const id = seedRsvpDraft();
    await act(async () => {
      useDraftEventStore
        .getState()
        .updateDraft(id, { visibility: "public", rsvpDiscoverable: true });
    });
    const rawSpyRef: React.MutableRefObject<
      ((patch: UpdatePatch) => void) | null
    > = { current: null };
    const spy = jest.fn();
    rawSpyRef.current = spy;

    const screen = await render(
      <WizardHarness draftId={id} onAutosaveDraft={() => {}} rawSpyRef={rawSpyRef} />,
    );

    spy.mockClear();
    await act(async () => {
      fireEvent.press(screen.getByTestId("rsvp-visibility-private"));
    });

    // ADVERSARIAL ASSERTION — the shipped C-3 must issue ONE combined write.
    // Reverting C-3 to two writes makes this 2 → FAILS.
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({
      visibility: "private",
      rsvpDiscoverable: false,
    });
    const d = useDraftEventStore.getState().getDraft(id);
    expect(d?.visibility).toBe("private");
    expect(d?.rsvpDiscoverable).toBe(false);
  });

  test("burst — capacity ON→OFF→Private inside ONE debounce window coalesces to ONE autosave that carries the OFF state, and the server echo does NOT snap back", async () => {
    jest.useFakeTimers();
    const id = seedRsvpDraft();
    // editMeta must exist for the real echo guard to accept the echoed payload.
    useDraftEventStore.getState().beginDraftEdit(id);
    useDraftEventStore
      .getState()
      .updateDraft(id, { visibility: "public", rsvpDiscoverable: true });

    const autosaved: DraftEvent[] = [];
    const screen = await render(
      <WizardHarness draftId={id} onAutosaveDraft={(d) => autosaved.push(d)} />,
    );

    // Three taps, NO timer advance between them → the 700ms debounce keeps
    // resetting, so only the LAST queued autosave will ever fire.
    await act(async () => {
      fireEvent.press(screen.getByTestId("rsvp-capacity-toggle")); // ON  → cap=1
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId("rsvp-capacity-toggle")); // OFF → cap=null, waitlist=false
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId("rsvp-visibility-private")); // private + discover off
    });

    // Nothing has fired yet — the burst has not settled.
    expect(autosaved.length).toBe(0);

    // Settle the single surviving timer.
    await act(async () => {
      jest.advanceTimersByTime(800);
    });

    // Exactly ONE coalesced autosave.
    expect(autosaved.length).toBe(1);
    const payload = autosaved[0];
    expect(payload.rsvpCapacity).toBeNull();
    expect(payload.rsvpWaitlistEnabled).toBe(false);
    expect(payload.visibility).toBe("private");
    expect(payload.rsvpDiscoverable).toBe(false);

    // Client store agrees (OFF + private) before the echo.
    expect(useDraftEventStore.getState().getDraft(id)?.rsvpCapacity).toBeNull();

    // SERVER ECHO through the real path → must NOT snap capacity back ON.
    await act(async () => {
      useDraftEventStore.getState().upsertServerDraft(payload);
    });
    const echoed = useDraftEventStore.getState().getDraft(id);
    expect(echoed?.rsvpCapacity).toBeNull(); // capacityOn === false, no snap-back
    expect(echoed?.visibility).toBe("private");
    expect(echoed?.rsvpDiscoverable).toBe(false);
  });

  test("burst — rapid ON/OFF/ON/OFF ending OFF within one window lands OFF, and the coalesced payload carries the LATEST (highest) clientRevision", async () => {
    jest.useFakeTimers();
    const id = seedRsvpDraft();
    const startRev =
      useDraftEventStore.getState().getDraft(id)?.clientRevision ?? 0;

    const autosaved: DraftEvent[] = [];
    const screen = await render(
      <WizardHarness draftId={id} onAutosaveDraft={(d) => autosaved.push(d)} />,
    );

    // 4 taps ending OFF, no flush between → coalesce.
    for (let i = 0; i < 4; i++) {
      await act(async () => {
        fireEvent.press(screen.getByTestId("rsvp-capacity-toggle"));
      });
    }
    expect(autosaved.length).toBe(0); // still coalescing

    await act(async () => {
      jest.advanceTimersByTime(800);
    });

    // One coalesced autosave, landing OFF (even number of taps).
    expect(autosaved.length).toBe(1);
    const payload = autosaved[0];
    expect(payload.rsvpCapacity).toBeNull();
    expect(useDraftEventStore.getState().getDraft(id)?.rsvpCapacity).toBeNull();

    // MONOTONICITY UNDER BURST: the surviving payload is the LATEST write, so its
    // clientRevision equals the store's current revision AND advanced by >= 4.
    const storeRev =
      useDraftEventStore.getState().getDraft(id)?.clientRevision ?? -1;
    expect(payload.clientRevision).toBe(storeRev);
    expect((payload.clientRevision ?? 0) - startRev).toBeGreaterThanOrEqual(4);
  });
});
