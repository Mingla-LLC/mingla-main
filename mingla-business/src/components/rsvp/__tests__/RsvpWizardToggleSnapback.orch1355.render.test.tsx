/**
 * ORCH-1355 — RSVP wizard capacity toggle SNAP-BACK repro (symptom 2).
 *
 * Seth: "STEP 5 (guest limit): when you select 'limit guest', you CANNOT
 * deselect it — it keeps reselecting (the toggle snaps back ON)."
 *
 * This is a DETERMINISTIC runtime proof (source theory is capped at "suspected").
 * It mounts the REAL production `RsvpStep5Setup` wired to the REAL
 * `draftEventStore` and a VERBATIM copy of `RsvpCreatorWizard`'s parent
 * `handleUpdate` + `queueAutosave` wiring (RsvpCreatorWizard.tsx:194-386) — the
 * `updateDraft`/`onAutosaveDraft` props the real wizard hands the step.
 *
 * PROVEN MECHANISM: `toggleCapacity` (RsvpStep5Setup.tsx:175-179) fires TWO
 * sequential `updateDraft` calls when turning capacity OFF (rsvpCapacity:null,
 * then rsvpWaitlistEnabled:false). Both run against the SAME captured `liveDraft`
 * closure inside `handleUpdate`, which rebuilds the autosave payload as
 * `{ ...liveDraft, ...patch }`. The SECOND call's payload spreads the STALE
 * captured `liveDraft` (rsvpCapacity still = the old number) and its patch does
 * NOT re-include rsvpCapacity — so the `rsvpCapacity:null` write from the first
 * call is DROPPED from the debounced autosave payload. The persisted/echoed
 * draft keeps the old capacity → the toggle snaps back ON.
 *
 * The client store is momentarily correct (cap=null); the AUTOSAVE PAYLOAD is
 * stale (cap=old). That payload is what reaches the server and echoes back.
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

// ---------------------------------------------------------------------------
// VERBATIM parent wiring from RsvpCreatorWizard.tsx:194-386. This is the exact
// updateDraft (handleUpdate) + queueAutosave the real wizard threads into the
// step's `updateDraft` prop and its onAutosaveDraft. Copied — not adapted — so
// the repro exercises the production reconciliation, not a simplification.
// ---------------------------------------------------------------------------
const WizardHarness: React.FC<{
  draftId: string;
  onAutosaveDraft: (draft: DraftEvent) => void;
}> = ({ draftId, onAutosaveDraft }) => {
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

  // handleUpdate — RsvpCreatorWizard.tsx:367-386, deps INCLUDE liveDraft.
  const handleUpdate = React.useCallback(
    (patch: Partial<Omit<DraftEvent, "id" | "brandId" | "createdAt">>): void => {
      if (liveDraft === null) return;
      const nextRevision = clientRevisionRef.current + 1;
      clientRevisionRef.current = nextRevision;
      const revisionedPatch = { ...patch, clientRevision: nextRevision };
      markDraftDirty(liveDraft.id, nextRevision);
      updateDraft(liveDraft.id, revisionedPatch);
      const nextDraft = {
        ...liveDraft,
        ...revisionedPatch,
        updatedAt: new Date().toISOString(),
      };
      latestDraftRef.current = nextDraft;
      queueAutosave(nextDraft);
    },
    [liveDraft, markDraftDirty, queueAutosave, updateDraft],
  );

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

describe("ORCH-1355 — capacity toggle snap-back (autosave drops the OFF write)", () => {
  beforeEach(() => {
    useDraftEventStore.getState().reset();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  test("turning capacity OFF autosaves a STALE rsvpCapacity (the snap-back seed)", async () => {
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

    // Tap again → OFF. This is the double-updateDraft path (cap:null, then
    // waitlist:false). The client store MUST end at cap=null.
    await act(async () => {
      fireEvent.press(screen.getByTestId("rsvp-capacity-toggle"));
    });
    expect(getCap()).toBeNull(); // client store is momentarily correct

    // Flush the 700ms autosave debounce.
    await act(async () => {
      jest.advanceTimersByTime(800);
    });

    // The autosave that actually fired is the payload the server persists +
    // echoes. THE BUG: it carries the STALE capacity (1), not null — so the
    // OFF write never reaches the server and the toggle snaps back ON.
    const lastAutosave = autosaved[autosaved.length - 1];
    expect(lastAutosave).toBeDefined();

    // --- The assertion that documents the defect (current: BUG) ------------
    // Fails-on-fix seed: after ORCH-1355 makes handleUpdate stable/ref-based,
    // this payload will carry rsvpCapacity === null and this expectation flips.
    expect(lastAutosave.rsvpCapacity).toBe(1); // STALE — bug fingerprint
    expect(lastAutosave.rsvpCapacity).not.toBeNull();

    // Divergence proof: client store says OFF, autosave payload says ON.
    expect(getCap()).toBeNull();
  });

  test("the stale autosave, once echoed by the server, SNAPS THE TOGGLE BACK ON", async () => {
    // End-to-end closure: the stale payload reaches the server, is persisted +
    // echoed, and the real upsertServerDraft/shouldApplyServerDraft path
    // re-applies it → draft.rsvpCapacity flips back to a number → the toggle
    // (capacityOn = rsvpCapacity !== null) re-selects.
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

    const stalePayload = autosaved[autosaved.length - 1];
    expect(stalePayload.rsvpCapacity).toBe(1); // stale payload leaves the client

    // Client is OFF right now…
    expect(
      useDraftEventStore.getState().getDraft(id)?.rsvpCapacity,
    ).toBeNull();

    // …server echoes the stale payload back (same clientRevision).
    await act(async () => {
      useDraftEventStore.getState().upsertServerDraft(stalePayload);
    });

    // SNAP-BACK: capacity is a number again → the toggle re-selects.
    const echoed = useDraftEventStore.getState().getDraft(id);
    expect(echoed?.rsvpCapacity).toBe(1);
    expect(echoed?.rsvpCapacity !== null).toBe(true); // capacityOn === true
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
});
