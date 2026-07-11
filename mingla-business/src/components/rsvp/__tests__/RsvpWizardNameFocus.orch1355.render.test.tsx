/**
 * ORCH-1355 — RSVP wizard NAME-field focus repro (symptom 1).
 *
 * Seth: "when you START TYPING in the NAME field, it automatically deselects
 * like there is a focus issue" (the TextInput drops the keyboard after a
 * keystroke).
 *
 * Native keyboard focus/blur is not observable in jsdom, so the DECISIVE,
 * jsdom-observable signal for this class is a REMOUNT of the field: a controlled
 * RN <TextInput> only drops the keyboard when it (or an ancestor) unmounts +
 * remounts. This test mounts the REAL production `CreatorStep1Basics` (the RSVP
 * Step-1 body) wired to a VERBATIM copy of `RsvpCreatorWizard`'s parent
 * `handleUpdate` (RsvpCreatorWizard.tsx:367-386, deps INCLUDE liveDraft → new
 * identity every keystroke) + fresh `baseProps` every render (line 578), then
 * instruments the name field's MOUNT count.
 *
 * A mount-counting probe occupies the name-<Input> reconciliation slot. Whether
 * the field remounts depends ONLY on reconciliation ABOVE the field (the churn
 * the unstable callback + fresh props cause) — which the probe faithfully
 * measures. mounts===1 across N keystrokes REFUTES the remount theory;
 * mounts>1 CONFIRMS it.
 *
 * Run: npx jest --config jest.orch1355.render.cjs --runInBand
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

// Probe that occupies the name-field <Input> slot and records mount/render
// counts on globalThis (jest.mock factory may only touch `mock*`/global scope).
jest.mock("../../ui/Input", () => {
  const React2 = require("react");
  const { TextInput } = require("react-native");
  const g: any = globalThis;
  g.__inputMounts = 0;
  g.__inputRenders = 0;
  return {
    Input: ({ value, onChangeText, accessibilityLabel }: any) => {
      g.__inputRenders += 1;
      React2.useEffect(() => {
        g.__inputMounts += 1;
      }, []);
      return (
        <TextInput
          value={value ?? ""}
          onChangeText={onChangeText}
          accessibilityLabel={accessibilityLabel}
          testID="name-input"
        />
      );
    },
  };
});

// GlassCard is imported by CreatorStep1Basics (kept only via `void GlassCard`);
// stub it to keep the mount free of blur/native deps.
jest.mock("../../ui/GlassCard", () => {
  const { View: V } = require("react-native");
  return { GlassCard: (p: any) => <V {...p} /> };
});

// draftEventStore imports liveEventConverter only for publishDraft (unused here);
// that chain pulls expo-constants. Cut it — the repro never publishes.
jest.mock("../../../utils/liveEventConverter", () => ({
  convertDraftToLiveEvent: () => null,
}));

import { CreatorStep1Basics } from "../../event/CreatorStep1Basics";
import {
  useDraftEventStore,
  type DraftEvent,
} from "../../../store/draftEventStore";

// VERBATIM parent wiring from RsvpCreatorWizard.tsx:194-386 (the unstable
// handleUpdate + fresh baseProps the real wizard hands the Step-1 body).
const WizardHarness: React.FC<{ draftId: string }> = ({ draftId }) => {
  const g: any = globalThis;
  g.__harnessRenders = (g.__harnessRenders ?? 0) + 1;

  const liveDraft =
    useDraftEventStore((s) => s.drafts.find((d) => d.id === draftId)) ?? null;
  const updateDraft = useDraftEventStore((s) => s.updateDraft);
  const markDraftDirty = useDraftEventStore((s) => s.markDraftDirty);

  const clientRevisionRef = React.useRef<number>(liveDraft?.clientRevision ?? 0);

  const handleUpdate = React.useCallback(
    (patch: Partial<Omit<DraftEvent, "id" | "brandId" | "createdAt">>): void => {
      if (liveDraft === null) return;
      const nextRevision = clientRevisionRef.current + 1;
      clientRevisionRef.current = nextRevision;
      const revisionedPatch = { ...patch, clientRevision: nextRevision };
      markDraftDirty(liveDraft.id, nextRevision);
      updateDraft(liveDraft.id, revisionedPatch);
    },
    [liveDraft, markDraftDirty, updateDraft],
  );

  if (liveDraft === null) return null;

  // baseProps rebuilt fresh every render — RsvpCreatorWizard.tsx:578.
  const baseProps = {
    draft: liveDraft,
    updateDraft: handleUpdate,
    errors: [],
    showErrors: false,
    onShowToast: () => {},
    scrollToBottom: () => {},
  } as any;

  return <CreatorStep1Basics {...baseProps} />;
};

describe("ORCH-1355 — name field remount-on-keystroke probe", () => {
  beforeEach(() => {
    useDraftEventStore.getState().reset();
    const g: any = globalThis;
    g.__inputMounts = 0;
    g.__inputRenders = 0;
    g.__harnessRenders = 0;
  });

  test("typing into the name field: does the field REMOUNT?", async () => {
    const store = useDraftEventStore.getState();
    const draft = store.createRsvpDraft("brand_test");
    const g: any = globalThis;

    const screen = await render(<WizardHarness draftId={draft.id} />);

    // Field mounted exactly once at initial render.
    const mountsAfterInitial = g.__inputMounts;
    const rendersAfterInitial = g.__inputRenders;
    const harnessAfterInitial = g.__harnessRenders;
    expect(mountsAfterInitial).toBe(1);

    // Simulate typing "Set" one keystroke at a time (RN onChangeText delivers
    // the FULL field value each keystroke).
    for (const next of ["S", "Se", "Set"]) {
      await act(async () => {
        fireEvent.changeText(screen.getByTestId("name-input"), next);
      });
    }

    // eslint-disable-next-line no-console
    console.log(
      `[ORCH-1355 symptom1] inputMounts=${g.__inputMounts} ` +
        `inputRenders=${g.__inputRenders} (initial ${rendersAfterInitial}) ` +
        `harnessRenders=${g.__harnessRenders} (initial ${harnessAfterInitial})`,
    );

    // The controlled flow works: value accumulated.
    expect(useDraftEventStore.getState().getDraft(draft.id)?.name).toBe("Set");

    // Churn is real: the unstable handleUpdate + fresh baseProps re-render the
    // step body (and thus the field) on every keystroke.
    expect(g.__inputRenders).toBeGreaterThan(rendersAfterInitial);
    expect(g.__harnessRenders).toBeGreaterThan(harnessAfterInitial);

    // THE VERDICT: mounts stays 1 → NO remount → re-render preserves the native
    // field (refutes the remount theory at the component level). If this ever
    // exceeds 1, the field remounts and the keyboard drop is proven here.
    expect(g.__inputMounts).toBe(1);
  });
});
