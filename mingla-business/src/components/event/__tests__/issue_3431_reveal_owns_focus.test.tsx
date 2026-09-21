/**
 * #3431 (RSVP creator tutorial, 2026-09-17) — the deferred scroll-to-bottom
 * reveal runs only for the field that armed it.
 *
 * SYMPTOM: on RSVP Step 5, tapping "Max guests" threw the page to the bottom
 * ("Who can find this") before it came back to the field.
 *
 * CAUSE: Step 1's Description (and Step 3's online link) call the wizard's
 * `scrollToBottom` on focus. Unless a keyboard is already up, that only ARMS a
 * scroll-to-end for when the keyboard finishes rising (#1027). The armed flag
 * was cleared only by a keyboard closing. With a hardware keyboard Description
 * raises no keyboard, so the flag outlived the field and fired on the next
 * keyboard frame from ANY field — Max guests' number pad.
 *
 * WHAT RUNS HERE: the REAL Event and RSVP creator wizards, mounted the way
 * issue3439CoverTiming mounts them (TypeScript transpiled, native chrome and
 * unrelated boundaries substituted). Their real `scrollToBottom`, keyboard
 * effect and refs execute; only the keyboard signal, React Native's focus
 * tracker and the scroll view are controlled. Edit published carries the same
 * mechanism and is checked for parity at source level (its import graph is too
 * wide to mount here).
 *
 * FAILS ON REVERT: restore the ungated `performScrollToEnd()` in a wizard's
 * keyboard effect (or stop recording the arming field) and "the recording"
 * case scrolls, turning this suite red.
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
    if (name.endsWith("/draftEventPristine")) return { isDraftEventPristine: () => false };
    if (name.endsWith("/brandPayout")) return { payoutGateStatus: () => "ready" };
    if (name.endsWith("/chipInPayoutReadiness")) return { isChipInPayoutReady: () => true };
    if (name.endsWith("/paidPublishGuards") || name.endsWith("/rsvpRpcFailure")) return {};
    if (name.endsWith("/refundPolicyTerms")) return { OfferingRefundTermsError: class extends Error {} };
    if (name.endsWith("/recurrenceRule")) return { expandRecurrenceToDates: () => [] };
    if (name === "@mingla/brand-assets") return { MINGLA_BUSINESS_LOGO: 1 };
    if (name.endsWith("/createDeferredTurnoutIntelProvider")) {
      return { createDeferredTurnoutIntelProvider: () => leaf("IntelProvider") };
    }
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

const description = { field: "description" };
const maxGuests = { field: "max-guests" };

const roots: MountedTree[] = [];
beforeAll(() => {
  // performScrollToEnd defers to the next frame; run it at once.
  Reflect.set(globalThis, "requestAnimationFrame", (callback: (time: number) => void) => {
    callback(0);
    return 0;
  });
});
beforeEach(() => {
  jest.useFakeTimers();
  scrollToEnd.mockClear();
  mockFocus.available = true;
  mockFocus.current = null;
  keyboard.visible = false;
});
afterEach(() => {
  act(() => {
    roots.splice(0).forEach((root) => root.unmount());
  });
  jest.useRealTimers();
});

async function mount(kind: "event" | "rsvp"): Promise<{ scrollToBottom: () => void }> {
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
      <Wizard draft={draft} brand={null} isCreateMode={false} initialStep={0} onExit={() => undefined} onOpenPreview={() => undefined} />,
    );
  });
  roots.push(root);
  const step = root.root.findByType("CreatorStep1Basics");
  expect(typeof step.props.scrollToBottom).toBe("function");
  return { scrollToBottom: () => root.root.findByType("CreatorStep1Basics").props.scrollToBottom() };
}

describe.each(["event", "rsvp"] as const)("%s creator — deferred reveal belongs to the arming field", (kind) => {
  test("the recording: Description armed it with no keyboard, then Max guests' keyboard shows → no scroll", async () => {
    const wizard = await mount(kind);
    mockFocus.current = description;
    await act(async () => wizard.scrollToBottom());
    expect(scrollToEnd).not.toHaveBeenCalled();
    // Hardware keyboard: nothing rose. The host moves on to another field.
    mockFocus.current = maxGuests;
    await act(async () => setKeyboardVisible(true));
    expect(scrollToEnd).not.toHaveBeenCalled();
  });

  test("#1027 unchanged: Description's own keyboard finishes rising → the form scrolls to the end once", async () => {
    const wizard = await mount(kind);
    mockFocus.current = description;
    await act(async () => wizard.scrollToBottom());
    await act(async () => setKeyboardVisible(true));
    expect(scrollToEnd).toHaveBeenCalledTimes(1);
    expect(scrollToEnd).toHaveBeenCalledWith({ animated: true });
  });

  test("the arming field lost focus before any keyboard showed → no scroll", async () => {
    const wizard = await mount(kind);
    mockFocus.current = description;
    await act(async () => wizard.scrollToBottom());
    mockFocus.current = null;
    await act(async () => setKeyboardVisible(true));
    expect(scrollToEnd).not.toHaveBeenCalled();
  });

  test("a reveal is used at most once: a later keyboard for the same field does not scroll again", async () => {
    const wizard = await mount(kind);
    mockFocus.current = description;
    await act(async () => wizard.scrollToBottom());
    await act(async () => setKeyboardVisible(true));
    await act(async () => setKeyboardVisible(false));
    await act(async () => setKeyboardVisible(true));
    expect(scrollToEnd).toHaveBeenCalledTimes(1);
  });

  test("a runtime that cannot report focus keeps the pre-#3431 reveal", async () => {
    const wizard = await mount(kind);
    mockFocus.available = false;
    await act(async () => wizard.scrollToBottom());
    await act(async () => setKeyboardVisible(true));
    expect(scrollToEnd).toHaveBeenCalledTimes(1);
  });

  test("keyboard already up → scrolls immediately, as before", async () => {
    const wizard = await mount(kind);
    await act(async () => setKeyboardVisible(true));
    mockFocus.current = description;
    await act(async () => wizard.scrollToBottom());
    expect(scrollToEnd).toHaveBeenCalledTimes(1);
  });
});

describe("Edit published carries the same guard", () => {
  const code = (rel: string): string =>
    fs
      .readFileSync(path.join(process.cwd(), rel), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n");
  const helper = (src: string): string => {
    const start = src.indexOf("const focusedTextInput = ");
    const end = src.indexOf("export const ", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    return src.slice(start, end).trim();
  };

  test("same focus helper as the mounted wizards, recorded on arm, gating the keyboard-shown scroll", () => {
    const edit = code("src/components/event/EditPublishedScreen.tsx");
    const rsvp = code("src/components/rsvp/RsvpCreatorWizard.tsx");
    const event = code("src/components/event/EventCreatorWizard.tsx");
    expect(helper(edit)).toBe(helper(rsvp));
    expect(helper(event)).toBe(helper(rsvp));
    for (const src of [edit, rsvp, event]) {
      expect(src).toMatch(/revealOwnerRef\.current = focusedTextInput\(\);\s*pendingScrollToBottomRef\.current = true;/);
      expect(src).toMatch(
        /pendingScrollToBottomRef\.current = false;\s*if \(revealStillOwnsFocus\(revealOwnerRef\.current\)\) \{\s*performScrollToEnd\(\);\s*\}/,
      );
      expect(src).not.toMatch(/pendingScrollToBottomRef\.current = false;\s*performScrollToEnd\(\);/);
    }
  });
});
