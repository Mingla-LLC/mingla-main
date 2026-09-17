import React from "react";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

// CI installs the renderer but not a separate @types package. Keep the narrow
// test boundary explicit, matching the existing #976 runtime suites.
type MountedNode = { props: any; findByType: (type: string) => MountedNode; findAllByType: (type: string) => MountedNode[] };
type MountedTree = { root: MountedNode; unmount: () => void };
const TestRenderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => MountedTree;
  act: (callback: () => void | Promise<void>) => void | Promise<void>;
};
const { act } = TestRenderer;

jest.mock("react-native", () => ({
  AppState: { addEventListener: () => ({ remove: () => undefined }) },
  StyleSheet: { create: (value: unknown) => value, absoluteFillObject: {} },
  Platform: { OS: "ios", select: (value: Record<string, unknown>) => value.ios },
  View: "View", Text: "Text", Pressable: "Pressable", Image: "Image",
}));
jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: { getItem: () => Promise.resolve(null), setItem: () => Promise.resolve(), removeItem: () => Promise.resolve() },
}));
jest.mock("../../../utils/liveEventConverter", () => ({ convertDraftToLiveEvent: () => null }));

import { buildDraftEvent, useDraftEventStore, type DraftEvent } from "../../../store/draftEventStore";
import { forgetServerCoverBase, recordServerCoverBase, type ServerDraftCover } from "../../../utils/draftCoverBase";
import * as coverHook from "../../../hooks/useServerCoverAdoption";

// Mount the complete real wizard component with its real hooks/store. Compile
// TypeScript syntax only; substitute native chrome/step rendering and unrelated
// validation/payment/intelligence boundaries. All wizard callbacks, state,
// adoption, autosave bookkeeping and publish handling execute unchanged.
function loadWizard(kind: "event" | "rsvp"): React.ComponentType<any> {
  const file = kind === "event" ? path.resolve(__dirname, "../EventCreatorWizard.tsx") : path.resolve(__dirname, "../../rsvp/RsvpCreatorWizard.tsx");
  const source = fs.readFileSync(file, "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
  const leaf = (name: string) => (props: any) => React.createElement(name, props, props.children);
  const boundaryRequire = (name: string): any => {
    if (name === "react") return React;
    if (name === "react-native") return require("react-native");
    if (name.endsWith("/draftEventStore")) return { buildDraftEvent, useDraftEventStore };
    if (name.endsWith("/useServerCoverAdoption")) return coverHook;
    if (name.endsWith("/designSystem")) return require("../../../constants/designSystem");
    if (name.endsWith("/desktopLayout")) return require("../../../constants/desktopLayout");
    if (name === "expo-router") return { useRouter: () => ({ replace: jest.fn(), push: jest.fn() }) };
    if (name === "react-native-safe-area-context") return { useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
    if (name.endsWith("/SmartScrollView")) return { ScrollView: React.forwardRef((props: any, _ref) => React.createElement("ScrollView", props, props.children)) };
    if (name.endsWith("/useKeyboardIsVisible")) return { useKeyboardIsVisible: () => false };
    if (name.endsWith("/useResponsiveLayout")) return { useResponsiveLayout: () => ({ isWideDesktop: false }) };
    if (name.endsWith("/useBrandStripeStatus")) return { useBrandStripeStatus: () => ({ data: "ready" }) };
    if (name.endsWith("/draftEventValidation")) return { validatePublish: () => [], validateStep: () => [], computePublishability: () => ({ status: "ready" }) };
    if (name.endsWith("/draftRsvpValidation")) return { validateRsvpPublish: () => [], validateRsvpStep: () => [] };
    if (name.endsWith("/draftEventPristine")) return { isDraftEventPristine: () => false };
    if (name.endsWith("/brandPayout")) return { payoutGateStatus: () => "ready" };
    if (name.endsWith("/chipInPayoutReadiness")) return { isChipInPayoutReady: () => true };
    if (name.endsWith("/paidPublishGuards") || name.endsWith("/rsvpRpcFailure")) return {};
    if (name.endsWith("/refundPolicyTerms")) return { OfferingRefundTermsError: class extends Error {} };
    if (name.endsWith("/recurrenceRule")) return { expandRecurrenceToDates: () => [] };
    if (name === "@mingla/brand-assets") return { MINGLA_BUSINESS_LOGO: 1 };
    if (name.endsWith("/createDeferredTurnoutIntelProvider")) return { createDeferredTurnoutIntelProvider: () => leaf("IntelProvider") };
    const exportName = name.split("/").pop()!;
    if (/^(Button|ConfirmDialog|GlassCard|Icon|IconChrome|Stepper|TopBar|Toast|CreatorStep\d\w+|RsvpStep\d\w+|PublishErrorsSheet)$/.test(exportName)) return { [exportName]: leaf(exportName) };
    throw new Error(`Unclassified wizard boundary: ${name}`);
  };
  const module = { exports: {} as Record<string, React.ComponentType<any>> };
  new Function("require", "module", "exports", output)(boundaryRequire, module, module.exports);
  return module.exports[kind === "event" ? "EventCreatorWizard" : "RsvpCreatorWizard"];
}

const EventWizard = loadWizard("event");
const RsvpWizard = loadWizard("rsvp");
const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const VIDEO = "https://example.invalid/finished-video.mp4";
const cover: ServerDraftCover = { coverMediaUrl: VIDEO, coverMediaType: "video", coverMediaPosterUrl: null, coverMediaProvider: null, coverMediaSourceUrl: null, coverMediaCredit: null, coverMediaCreditUrl: null, coverMediaAlt: null };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}
function seed(isRsvp: boolean): DraftEvent {
  const draft = { ...buildDraftEvent("brand", ID, "2026-09-15T00:00:00Z"), serverSlug: "draft", isRsvp, name: "Cover timing", clientRevision: 1 };
  useDraftEventStore.setState({ drafts: [draft], draftEditMeta: {} });
  recordServerCoverBase(ID, null);
  return draft;
}
const roots: MountedTree[] = [];
beforeEach(() => { jest.useFakeTimers(); forgetServerCoverBase(); });
afterEach(() => { act(() => { roots.splice(0).forEach(root => root.unmount()); }); jest.useRealTimers(); });

test.each(["event", "rsvp"] as const)("#3439 %s: completed cover arriving by autosave echo clears the publishing block", async kind => {
  const initial = seed(kind === "rsvp");
  const read = deferred<ServerDraftCover | null>();
  const fetchServerCover = jest.fn(() => read.promise);
  const Wizard = kind === "event" ? EventWizard : RsvpWizard;
  let root!: MountedTree;
  await act(async () => { root = TestRenderer.create(<Wizard draft={initial} brand={null} isCreateMode={false} initialStep={3} fetchServerCover={fetchServerCover} onExit={() => undefined} onOpenPreview={() => undefined} />); });
  roots.push(root);
  await act(async () => { root.root.findByType("CreatorStep4Cover").props.onCoverVideoProcessingChange(true); });
  // Real store echo while the pending server read has not returned yet.
  await act(async () => { expect(useDraftEventStore.getState().upsertServerDraft({ ...useDraftEventStore.getState().getDraft(ID)!, ...cover })).toBe(true); });
  expect(useDraftEventStore.getState().getDraft(ID)?.coverMediaUrl).toBe(VIDEO);
  await act(async () => { read.resolve(cover); await read.promise; });
  // Move through the actual wizard Continue handlers to reach the publish dock.
  for (let step = 3; step < (kind === "event" ? 6 : 5); step++) {
    await act(async () => { root.root.findAllByType("Button").find(node => node.props.label === "Continue")!.props.onPress(); });
  }
  await act(async () => { jest.advanceTimersByTime(15_000); });
  expect(fetchServerCover.mock.calls.length).toBeGreaterThan(1);
  const publish = root.root.findAllByType("Button").find(node => String(node.props.label).startsWith("Publish"))!;
  expect(publish.props.disabled).toBe(false);
});

test.each(["event", "rsvp"] as const)("#3439 %s: poll-before-echo control adopts the video and clears processing", async kind => {
  const initial = seed(kind === "rsvp");
  const read = deferred<ServerDraftCover | null>();
  const fetchServerCover = jest.fn(() => read.promise);
  const Wizard = kind === "event" ? EventWizard : RsvpWizard;
  let root!: MountedTree;
  await act(async () => { root = TestRenderer.create(<Wizard draft={initial} brand={null} isCreateMode={false} initialStep={3} fetchServerCover={fetchServerCover} onExit={() => undefined} onOpenPreview={() => undefined} />); });
  roots.push(root);
  await act(async () => { root.root.findByType("CreatorStep4Cover").props.onCoverVideoProcessingChange(true); });
  await act(async () => { read.resolve(cover); await read.promise; });
  expect(useDraftEventStore.getState().getDraft(ID)?.coverMediaUrl).toBe(VIDEO);
  for (let step = 3; step < (kind === "event" ? 6 : 5); step++) {
    await act(async () => { root.root.findAllByType("Button").find(node => node.props.label === "Continue")!.props.onPress(); });
  }
  const publish = root.root.findAllByType("Button").find(node => String(node.props.label).startsWith("Publish"))!;
  expect(publish.props.disabled).toBe(false);
});

test.each(["event", "rsvp"] as const)("#3439 %s: a newer host cover choice survives a late server read", async kind => {
  const initial = seed(kind === "rsvp");
  const read = deferred<ServerDraftCover | null>();
  const Wizard = kind === "event" ? EventWizard : RsvpWizard;
  let root!: MountedTree;
  await act(async () => { root = TestRenderer.create(<Wizard draft={initial} brand={null} isCreateMode={false} initialStep={3} fetchServerCover={() => read.promise} onExit={() => undefined} onOpenPreview={() => undefined} />); });
  roots.push(root);
  const photo = "https://example.invalid/newer-host-choice.jpg";
  await act(async () => { root.root.findByType("CreatorStep4Cover").props.updateDraft({ coverMediaUrl: photo, coverMediaType: "image" }); });
  await act(async () => { read.resolve(cover); await read.promise; });
  expect(useDraftEventStore.getState().getDraft(ID)?.coverMediaUrl).toBe(photo);
});

test.each(["event", "rsvp"] as const)("#3439 %s: failed server read retries without erasing the draft", async kind => {
  const initial = seed(kind === "rsvp");
  let calls = 0;
  const fetchServerCover = jest.fn(async () => {
    calls++;
    if (calls === 1) throw new Error("offline fixture");
    return cover;
  });
  const Wizard = kind === "event" ? EventWizard : RsvpWizard;
  let root!: MountedTree;
  await act(async () => { root = TestRenderer.create(<Wizard draft={initial} brand={null} isCreateMode={false} initialStep={3} fetchServerCover={fetchServerCover} onExit={() => undefined} onOpenPreview={() => undefined} />); });
  roots.push(root);
  expect(useDraftEventStore.getState().getDraft(ID)?.coverMediaUrl).toBeNull();
  await act(async () => { root.root.findByType("CreatorStep4Cover").props.onCoverVideoProcessingChange(true); });
  await act(async () => { jest.advanceTimersByTime(5_000); });
  expect(fetchServerCover.mock.calls.length).toBeGreaterThan(1);
  expect(useDraftEventStore.getState().getDraft(ID)?.coverMediaUrl).toBe(VIDEO);
});

test.each(["event", "rsvp"] as const)("#3439 %s: missing server reader does not invent a publishing block", async kind => {
  const initial = seed(kind === "rsvp");
  const Wizard = kind === "event" ? EventWizard : RsvpWizard;
  let root!: MountedTree;
  await act(async () => { root = TestRenderer.create(<Wizard draft={initial} brand={null} isCreateMode={false} initialStep={kind === "event" ? 6 : 5} onExit={() => undefined} onOpenPreview={() => undefined} />); });
  roots.push(root);
  const publish = root.root.findAllByType("Button").find(node => String(node.props.label).startsWith("Publish"))!;
  expect(publish.props.disabled).toBe(false);
});

test("#3439 resumed ticketed wizard must not publish a stale cover before its initial server read completes", async () => {
  const initial = seed(false);
  const read = deferred<ServerDraftCover | null>();
  const published: DraftEvent[] = [];
  let root!: MountedTree;
  await act(async () => { root = TestRenderer.create(<EventWizard draft={initial} brand={null} isCreateMode={false} initialStep={6} fetchServerCover={() => read.promise} onExit={() => undefined} onOpenPreview={() => undefined} onPublishDraft={async (draft: DraftEvent) => { published.push(draft); return { brandSlug: "brand", eventSlug: "event" }; }} />); });
  roots.push(root);
  const publish = root.root.findAllByType("Button").find(node => String(node.props.label).startsWith("Publish"))!;
  if (!publish.props.disabled) {
    await act(async () => { publish.props.onPress(); });
    const dialog = root.root.findAllByType("ConfirmDialog").find(node => node.props.visible)!;
    let confirmation!: Promise<void>;
    await act(async () => { confirmation = dialog.props.onConfirm(); jest.advanceTimersByTime(1_300); await confirmation; });
  }
  // An initial authoritative read is still unresolved and contains a finished
  // cover. Publishing may wait or safely reconcile, but cannot send stale null.
  expect(published.filter(draft => draft.coverMediaUrl == null)).toHaveLength(0);
  await act(async () => { read.resolve(cover); await read.promise; });
});
