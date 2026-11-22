/**
 * #4548 — tester (Retest 2): a typed, unsaved Guest pack is never dropped when a
 * host leaves the REAL Event or RSVP creator wizard, and a saved or untouched
 * pack never causes a phantom prompt. Harness copied from
 * issue_3431_reveal_owns_focus.test.tsx; the gate and the working copy are REAL,
 * only the pack's network service is mocked. The leave guard and the hardware
 * back hook are captured so their arguments are what is asserted.
 *
 *   WX-1  create, pack-only change: Close asks (discard dialog), does not exit
 *   WX-2  create, nothing typed: Close exits at once (no phantom dialog)
 *   WX-3  draft edit, pack-only change: Close saves the pack, then exits
 *   WX-4  draft edit, failing save: Close stays with the toast; nothing lost
 *   WX-5  the reload guard is dirty only while the change is unsaved
 *   WX-6  another event's pending pack never counts here; unmount clears it
 */
import React from "react";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

type MountedNode = {
  props: any;
  findByType: (type: string) => MountedNode;
};
type MountedTree = { root: MountedNode; unmount: () => void };
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => MountedTree;
  act: (callback: () => void | Promise<void>) => void | Promise<void>;
};
const { act } = TestRenderer;

// React Native's focus tracker, controlled per test. `available: false` models
// a runtime with no TextInput.State.
const mockFocus: { available: boolean; current: unknown } = {
  available: true,
  current: null,
};

jest.mock("react-native", () => ({
  AppState: { addEventListener: () => ({ remove: () => undefined }) },
  StyleSheet: { create: (value: unknown) => value, absoluteFillObject: {} },
  Platform: { OS: "ios", select: (value: Record<string, unknown>) => value.ios },
  View: "View",
  Text: "Text",
  Pressable: "Pressable",
  Image: "Image",
  get TextInput() {
    return mockFocus.available
      ? { State: { currentlyFocusedInput: () => mockFocus.current } }
      : {};
  },
}));

const mockSave = jest.fn<Promise<unknown>, unknown[]>();
jest.mock("../../../services/guestPackService", () => ({
  fetchEventGuestPack: jest.fn(async () => null),
  saveEventGuestPack: (...a: unknown[]) => mockSave(...a),
}));
jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: () => Promise.resolve(null),
    setItem: () => Promise.resolve(),
    removeItem: () => Promise.resolve(),
  },
}));
jest.mock("../../../utils/liveEventConverter", () => ({
  convertDraftToLiveEvent: () => null,
}));

import {
  buildDraftEvent,
  useDraftEventStore,
  type DraftEvent,
} from "../../../store/draftEventStore";
import * as coverHook from "../../../hooks/useServerCoverAdoption";
import * as realGate from "../../../utils/guestPackGate";
import {
  addGuestPackItem,
  ensureGuestPackLoaded,
  GUEST_PACK_SAVE_FAILED_COPY,
  releaseGuestPackSession,
  resetAllGuestPackSessions,
  setGuestPackNote,
} from "../../../utils/guestPackSession";

const guard: Record<string, { dirty: boolean; onRequestLeave: () => void } | undefined> = {};
const hardwareBack: Record<string, any> = {};

// The library keyboard-visible signal the wizards read.
const keyboard = { visible: false, listeners: new Set<() => void>() };
const useKeyboardIsVisible = (): boolean =>
  React.useSyncExternalStore(
    (listener) => {
      keyboard.listeners.add(listener);
      return () => keyboard.listeners.delete(listener);
    },
    () => keyboard.visible,
  );
const setKeyboardVisible = (visible: boolean): void => {
  keyboard.visible = visible;
  keyboard.listeners.forEach((listener) => listener());
};

const scrollToEnd = jest.fn();

function loadWizard(kind: "event" | "rsvp"): React.ComponentType<any> {
  const file =
    kind === "event"
      ? path.resolve(__dirname, "../EventCreatorWizard.tsx")
      : path.resolve(__dirname, "../../rsvp/RsvpCreatorWizard.tsx");
  const output = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.React,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText;
  const leaf = (name: string) => (props: any) =>
    React.createElement(name, props, props.children);
  // Everything this suite is about comes first; the rest mirrors
  // issue3439CoverTiming. A boundary that suite has not classified yet (a
  // wizard import added by a later change) gets inert stubs — components render
  // as leaves, hooks return an empty object — because this suite exercises the
  // reveal, not those modules.
  const unclassified = (): unknown =>
    new Proxy(
      {},
      {
        get: (_target, prop) => {
          if (typeof prop !== "string" || prop === "__esModule") return undefined;
          if (/^use[A-Z]/.test(prop)) return () => ({});
          if (/^[A-Z]/.test(prop)) return leaf(prop);
          return undefined;
        },
      },
    );
  // [TEST-MOD-APPROVED #1780] Fixtures for the #1780/#3446 boundaries classified below.
  // The catch-all above answers an unknown module with a Proxy that reads ANY capitalised
  // export as a component. `PENDING_WIZARD_INVITE_SUMMARY` is a frozen plain OBJECT in the
  // product, so that rule handed the wizard a function, `useState` ran it as a lazy
  // initializer, and the leaf threw on `props.children`. The classifications below say what
  // each boundary actually is. State chosen to match issue3439CoverTiming on this branch:
  // the flag settled OFF over a settled saved plan with zero people — the rollback-ready
  // state, so both wizards keep the pre-#1780 step walk and the plain publish dialog. One
  // fixture per wizard load, so the stubs return stable identities across renders as the
  // real query results would. Nothing here touches the reveal: every assertion in this file
  // still turns on scrollToBottom, the keyboard signal and which field armed it.
  const settledIdle = { isPending: false, isFetching: false, isError: false }; // [TEST-MOD-APPROVED #1780]
  const settledOffFlag = { ...settledIdle, data: false }; // [TEST-MOD-APPROVED #1780]
  const emptyInvitePlan = { eventId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", eventType: kind, selectionRevision: 0, selectedCount: 0, brandPersonIds: [], selectionHash: "0".repeat(64), state: "draft", publishedSelectionRevision: null, updatedAt: null }; // [TEST-MOD-APPROVED #1780]
  const inviteSummaryStub = { plan: { ...settledIdle, data: emptyInvitePlan }, quote: { ...settledIdle, data: undefined }, refreshAuthoritative: async () => ({ plan: emptyInvitePlan, quote: null }) }; // [TEST-MOD-APPROVED #1780]
  const boundaryRequire = (name: string): any => {
    if (name === "react") return React;
    if (name === "react-native") return require("react-native");
    if (name.endsWith("/useKeyboardIsVisible")) return { useKeyboardIsVisible };
    if (name.endsWith("/SmartScrollView")) {
      return {
        ScrollView: React.forwardRef((props: any, ref) => {
          React.useImperativeHandle(ref, () => ({ scrollToEnd, scrollTo: () => undefined }));
          return React.createElement("ScrollView", props, props.children);
        }),
      };
    }
    if (name.endsWith("/draftEventStore")) return { buildDraftEvent, useDraftEventStore };
    if (name.endsWith("/useServerCoverAdoption")) return coverHook;
    if (name.endsWith("/designSystem")) return require("../../../constants/designSystem");
    if (name.endsWith("/desktopLayout")) return require("../../../constants/desktopLayout");
    if (name === "expo-router") return { useRouter: () => ({ replace: jest.fn(), push: jest.fn() }) };
    if (name === "react-native-safe-area-context") {
      return { useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
    }
    if (name.endsWith("/useResponsiveLayout")) return { useResponsiveLayout: () => ({ isWideDesktop: false }) };
    if (name.endsWith("/useBrandStripeStatus")) return { useBrandStripeStatus: () => ({ data: "ready" }) };
    if (name.endsWith("/draftEventValidation")) {
      return { validatePublish: () => [], validateStep: () => [], computePublishability: () => ({ status: "ready" }) };
    }
    if (name.endsWith("/draftRsvpValidation")) return { validateRsvpPublish: () => [], validateRsvpStep: () => [] };
    if (name.endsWith("/draftEventPristine")) return { isDraftEventPristine: () => true };
    if (name.endsWith("/brandPayout")) return { payoutGateStatus: () => "ready" };
    if (name.endsWith("/chipInPayoutReadiness")) return { isChipInPayoutReady: () => true };
    if (name.endsWith("/paidPublishGuards") || name.endsWith("/rsvpRpcFailure")) return {};
    // #3645 — pure, so it is supplied REAL: the order of "save, then publish".
    if (name.endsWith("/rsvpPublishWithoutChipIns")) return jest.requireActual("../../../utils/rsvpPublishWithoutChipIns");
    // #4420 — the wizards' invite publish gate (pure; real module).
    if (name.endsWith("/invites/wizardInvitePublishGate")) return jest.requireActual("../../invites/wizardInvitePublishGate");
    if (name.endsWith("/refundPolicyTerms")) return { OfferingRefundTermsError: class extends Error {} };
    // #4548 tester: the REAL gate (the REAL working copy registers with it below).
    if (name.endsWith("/guestPackGate")) return realGate;
    if (name.endsWith("/hooks/useUnsavedChangesGuard")) return { useUnsavedChangesGuard: (a: { dirty: boolean; onRequestLeave: () => void }) => { guard[kind] = a; } };
    if (name.endsWith("/recurrenceRule")) return { expandRecurrenceToDates: () => [] };
    if (name === "@mingla/brand-assets") return { MINGLA_BUSINESS_LOGO: 1 };
    if (name.endsWith("/createDeferredTurnoutIntelProvider")) {
      return { createDeferredTurnoutIntelProvider: () => leaf("IntelProvider") };
    }
    // [TEST-MOD-APPROVED #1780] Session and native chrome added by #1780/#3446, stubbed like
    // the router, keyboard and layout hooks above: auth is read only for signOut on the
    // invite step's re-auth exit, and hardware back is a no-op off Android (#3446).
    if (name.endsWith("/context/AuthContext")) return { useAuth: () => ({ signOut: async () => undefined }) }; // [TEST-MOD-APPROVED #1780]
    if (name.endsWith("/hooks/useWizardHardwareBack")) return { useWizardHardwareBack: (a: unknown) => { hardwareBack[kind] = a; } }; // [TEST-MOD-APPROVED #1780]
    if (name.endsWith("/hooks/useFeatureFlag")) return { useFeatureFlag: () => settledOffFlag }; // [TEST-MOD-APPROVED #1780]
    if (name.endsWith("/hooks/useOfferingInvitePlan")) return { useOfferingInvitePlanSummary: () => inviteSummaryStub }; // [TEST-MOD-APPROVED #1780]
    // [TEST-MOD-APPROVED #1780] The lazy invite owner (#1780 moved the invite cluster off the
    // wizards' static import graph). Its three surfaces render as named leaves like the step
    // bodies below; the bridge renders nothing and reports the settled empty summary, as the
    // real bridge reports the hook's result; PENDING_WIZARD_INVITE_SUMMARY is the product's
    // "not read yet" OBJECT, never a component.
    if (name.endsWith("/invites/LazyInvitePeopleStep")) return { InvitePlanSummaryBridge: ({ onChange }: { onChange: (summary: unknown) => void }) => { React.useEffect(() => { onChange(inviteSummaryStub); }, [onChange]); return null; }, PENDING_WIZARD_INVITE_SUMMARY: { plan: { data: undefined, isPending: true, isFetching: true, isError: false }, quote: { data: undefined, isPending: true, isFetching: true, isError: false }, refreshAuthoritative: async () => ({ plan: null, quote: null }) }, InvitePeopleStep: leaf("InvitePeopleStep"), InvitePlanReviewSummary: leaf("InvitePlanReviewSummary"), InvitePeoplePublishConfirmation: leaf("InvitePeoplePublishConfirmation") }; // [TEST-MOD-APPROVED #1780]
    if (name.endsWith("/invites/InvitePeopleStep")) return { InvitePeopleStep: leaf("InvitePeopleStep"), InvitePlanReviewSummary: leaf("InvitePlanReviewSummary"), InvitePeoplePublishConfirmation: leaf("InvitePeoplePublishConfirmation") }; // [TEST-MOD-APPROVED #1780]
    // [TEST-MOD-APPROVED #4420] the Event wizard's footer is the shared StepperFooter; it renders the same Button leaves.
    if (name.endsWith("/ui/Stepper")) return { Stepper: leaf("Stepper"), StepperFooter: (p: any) => React.createElement(React.Fragment, null, p.previousLabel !== undefined && p.onBack !== undefined ? React.createElement("Button", { label: p.previousLabel, onPress: p.onBack, disabled: p.backDisabled === true }) : null, React.createElement("Button", { label: p.continueLabel, onPress: p.onContinue, disabled: p.continueDisabled === true, loading: p.continueLoading === true, testID: p.continueTestID })) };
    const exportName = name.split("/").pop()!;
    if (/^(Button|ConfirmDialog|GlassCard|Icon|IconChrome|Stepper|TopBar|Toast|CreatorStep\d\w+|RsvpStep\d\w+|PublishErrorsSheet)$/.test(exportName)) {
      return { [exportName]: leaf(exportName) };
    }
    return unclassified();
  };
  const module = { exports: {} as Record<string, React.ComponentType<any>> };
  new Function("require", "module", "exports", output)(boundaryRequire, module, module.exports);
  return module.exports[kind === "event" ? "EventCreatorWizard" : "RsvpCreatorWizard"];
}

const Wizards = { event: loadWizard("event"), rsvp: loadWizard("rsvp") };
const ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

type Any = any;
const OTHER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const roots: MountedTree[] = [];

beforeEach(() => {
  mockSave.mockReset();
  resetAllGuestPackSessions();
});
afterEach(async () => {
  await act(async () => {
    roots.splice(0).forEach((root) => root.unmount());
  });
});

async function mountWizard(kind: "event" | "rsvp", isCreateMode: boolean, onExit: jest.Mock): Promise<MountedTree> {
  const draft: DraftEvent = {
    ...buildDraftEvent("brand", ID, "2026-09-17T00:00:00Z"),
    serverSlug: "draft",
    isRsvp: kind === "rsvp",
    name: "Lantern Room",
    clientRevision: 1,
  };
  useDraftEventStore.setState({ drafts: [draft], draftEditMeta: {} });
  const Wizard = Wizards[kind];
  let root!: MountedTree;
  await act(async () => {
    root = TestRenderer.create(
      <Wizard draft={draft} brand={null} isCreateMode={isCreateMode} initialStep={0} onExit={onExit} onOpenPreview={() => undefined} />,
    );
  });
  roots.push(root);
  return root;
}

const typePack = async (eventId: string, note: string): Promise<void> => {
  await act(async () => {
    await ensureGuestPackLoaded(eventId);
    setGuestPackNote(eventId, note);
  });
};
const close = async (kind: "event" | "rsvp"): Promise<void> => {
  await act(async () => {
    guard[kind]!.onRequestLeave();
    await new Promise((r) => setTimeout(r, 10));
  });
};
const all = (root: MountedTree, type: string): Any[] =>
  (root.root as Any).findAll((n: Any) => n.type === type);
const dialogOpen = (root: MountedTree): boolean =>
  all(root, "ConfirmDialog").some((n) => n.props.visible === true);
const toastText = (root: MountedTree): string =>
  JSON.stringify(all(root, "Toast").map((n) => n.props.message ?? n.props.text ?? null));

describe.each(["event", "rsvp"] as const)("#4548 %s creator wizard: leaving with a Guest pack", (kind) => {
  test("WX-1 create, pack-only change: Close asks and does not exit", async () => {
    const onExit = jest.fn();
    const root = await mountWizard(kind, true, onExit);
    await typePack(ID, "Door code 4548");
    await close(kind);
    expect(onExit).not.toHaveBeenCalled();
    expect(dialogOpen(root)).toBe(true);
    expect(mockSave).not.toHaveBeenCalled();
  });

  test("WX-2 create, nothing typed: Close never shows a phantom dialog", async () => {
    const onExit = jest.fn();
    const root = await mountWizard(kind, true, onExit);
    await act(async () => {
      await ensureGuestPackLoaded(ID);
    });
    expect(guard[kind]!.dirty).toBe(false);
    await close(kind);
    expect(dialogOpen(root)).toBe(false);
  });

  test("WX-3 draft edit, pack-only change: Close saves the pack, then exits", async () => {
    const onExit = jest.fn();
    await mountWizard(kind, false, onExit);
    await typePack(ID, "Door code 4548");
    mockSave.mockResolvedValue({ note: "Door code 4548", items: [], updatedAt: null });
    await close(kind);
    expect(mockSave).toHaveBeenCalledWith(ID, { note: "Door code 4548", items: [] });
    expect(onExit).toHaveBeenCalledWith("abandoned");
  });

  test("WX-4 draft edit, failing save: Close stays with the toast and keeps the text", async () => {
    const onExit = jest.fn();
    const root = await mountWizard(kind, false, onExit);
    await typePack(ID, "Door code 4548");
    mockSave.mockRejectedValue(new Error("network down"));
    await close(kind);
    expect(onExit).not.toHaveBeenCalled();
    expect(toastText(root)).toContain(GUEST_PACK_SAVE_FAILED_COPY);
    expect(realGate.hasPendingGuestPack(ID)).toBe(true);
  });

  test("WX-5 the reload guard is dirty only while the change is unsaved", async () => {
    await mountWizard(kind, false, jest.fn());
    await act(async () => {
      await ensureGuestPackLoaded(ID);
    });
    expect(guard[kind]!.dirty).toBe(false);
    await typePack(ID, "Door code 4548");
    expect(guard[kind]!.dirty).toBe(true);
    mockSave.mockResolvedValue({ note: "Door code 4548", items: [], updatedAt: null });
    await act(async () => {
      await realGate.flushGuestPack(ID);
    });
    expect(guard[kind]!.dirty).toBe(false);
    // Typing it back to the saved text is not a change either.
    await typePack(ID, "Door code 4548x");
    await typePack(ID, "Door code 4548");
    expect(guard[kind]!.dirty).toBe(false);
  });

  test("WX-6 another event's pending pack never counts here; unmount clears this one", async () => {
    const onExit = jest.fn();
    const root = await mountWizard(kind, false, onExit);
    await typePack(OTHER, "Somebody else's door");
    expect(guard[kind]!.dirty).toBe(false);
    await close(kind);
    expect(mockSave).not.toHaveBeenCalled();
    expect(onExit).toHaveBeenCalledWith("abandoned");
    releaseGuestPackSession(OTHER);
    await typePack(ID, "Door code 4548");
    expect(realGate.hasPendingGuestPack(ID)).toBe(true);
    await act(async () => {
      root.unmount();
    });
    roots.splice(roots.indexOf(root), 1);
    expect(realGate.hasPendingGuestPack(ID)).toBe(false);
  });

  test("WX-7 draft edit, an invalid pack (empty link row): Close neither exits nor sends it", async () => {
    const onExit = jest.fn();
    const root = await mountWizard(kind, false, onExit);
    await act(async () => {
      await ensureGuestPackLoaded(ID);
      addGuestPackItem(ID);
    });
    await close(kind);
    expect(onExit).not.toHaveBeenCalled();
    expect(mockSave).not.toHaveBeenCalled();
    void toastText(root);
  });
});
