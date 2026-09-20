import React from "react";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
jest.mock("react-native", () => ({
  AppState: { addEventListener: () => ({ remove: () => undefined }) },
  StyleSheet: { create: (styles: unknown) => styles, absoluteFillObject: {} },
  Platform: { OS: "ios", select: (choices: any) => choices.ios ?? choices.default },
  View: "View", Text: "Text", Pressable: "Pressable", TextInput: "TextInput", Image: "Image",
}));
jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true, default: { getItem: async () => null, setItem: async () => undefined, removeItem: async () => undefined },
}));
jest.mock("../../../utils/liveEventConverter", () => ({ convertDraftToLiveEvent: () => null }));
jest.mock("../../ui/Icon", () => ({ Icon: () => null }));
jest.mock("../../intel/TurnoutForecastCard", () => ({ TurnoutForecastCard: () => null }));
jest.mock("../../intel/useTurnoutFocusTarget", () => ({ useTurnoutFocusTarget: () => false }));

import { buildDraftEvent, useDraftEventStore } from "../../../store/draftEventStore";
import { RsvpStep5Setup } from "../RsvpStep5Setup";
import * as liveAdapter from "../../../utils/liveEventAdapter";
import * as mapper from "../../../utils/serverDraftEventMapper";
import * as coverHook from "../../../hooks/useServerCoverAdoption";

type Node = { type: unknown; props: any; findAll: (predicate: (node: Node) => boolean) => Node[] };
type Tree = { root: Node; unmount: () => void };
const renderer = require("react-test-renderer") as {
  create: (element: React.ReactElement) => Tree;
  act: (callback: () => void | Promise<void>) => void | Promise<void>;
};
const { act } = renderer;
const updateLiveRsvp = jest.fn(async (..._args: unknown[]) => undefined);
const updateLiveEventFields = jest.fn(() => ({ ok: true }));
const queryClient = { invalidateQueries: jest.fn() };
const leaf = (name: string) => (props: any) => React.createElement(name, props, props.children);

// Execute the complete actual create/edit hosts, real setup step, real shared
// stepper and real state/diff/payload owners. Substitute infrastructure/native
// leaves only; never copy the save/continue logic into a test harness.
function loadHost(mode: "create" | "edit"): React.ComponentType<any> {
  const file = mode === "create" ? path.resolve(__dirname, "../RsvpCreatorWizard.tsx") : path.resolve(__dirname, "../../event/EditPublishedScreen.tsx");
  const output = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
  const resolve = (name: string): any => {
    if (name === "react") return React;
    if (name === "react-native") return require("react-native");
    if (name.endsWith("/RsvpStep5Setup")) return { RsvpStep5Setup };
    if (name.endsWith("/draftEventStore")) return { useDraftEventStore };
    if (name.endsWith("/liveEventStore")) return { useLiveEventStore: (selector: any) => selector({ updateLiveEventFields }) };
    if (name.endsWith("/liveEventAdapter")) return liveAdapter;
    if (name.endsWith("/serverDraftEventMapper")) return mapper;
    // #3407: the create host now runs the real server-cover adoption hook
    // (inert here — no fetchServerCover is passed), registered as #3439 does.
    if (name.endsWith("/useServerCoverAdoption")) return coverHook;
    if (name.endsWith("/editPublishedSections")) return require("../../event/editPublishedSections");
    if (name.endsWith("/rsvpHubMetrics")) return require("../../../utils/rsvpHubMetrics");
    if (name.endsWith("/designSystem")) return require("../../../constants/designSystem");
    if (name.endsWith("/desktopLayout")) return require("../../../constants/desktopLayout");
    if (name === "expo-router") return { useRouter: () => ({ replace: jest.fn(), push: jest.fn(), canGoBack: () => false }) };
    if (name === "@tanstack/react-query") return { useQueryClient: () => queryClient };
    if (name === "react-native-safe-area-context") return { useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
    if (name.endsWith("/SmartScrollView")) return { ScrollView: React.forwardRef((props: any, _ref) => React.createElement("ScrollView", props, props.children)) };
    if (name.endsWith("/useKeyboardIsVisible")) return { useKeyboardIsVisible: () => false };
    if (name.endsWith("/useResponsiveLayout")) return { useResponsiveLayout: () => ({ isWideDesktop: false }) };
    // #3409: the create host now runs the real step-change scroll hook
    // (pure React, scrolls the harness ScrollView ref), registered as #3439 does.
    if (name.endsWith("/useScrollToTopOnStepChange")) return require("../../../hooks/useScrollToTopOnStepChange");
    if (name.endsWith("/useBrandStripeStatus")) return { useBrandStripeStatus: () => ({ data: "active" }) };
    if (name.endsWith("/useBrands")) return { useBrand: () => ({ data: null }) };
    if (name.endsWith("/useCurrentBrandRole")) return { useCurrentBrandRole: () => ({ rank: "owner" }) };
    if (name.endsWith("/permissionGates")) return { canPerformAction: () => true };
    if (name.endsWith("/draftRsvpValidation")) return { validateRsvpPublish: () => [], validateRsvpStep: () => [] };
    if (name.endsWith("/draftEventValidation")) return { validateStep: () => [] };
    if (name.endsWith("/draftEventPristine")) return { isDraftEventPristine: () => false };
    if (name.endsWith("/chipInPayoutReadiness")) return { isChipInPayoutReady: () => true };
    if (name.endsWith("/paidPublishGuards") || name.endsWith("/rsvpRpcFailure")) return {};
    if (name.endsWith("/eventOrdersService")) return { buildSoldCountContextFromOrders: () => ({ soldCountByTier: {}, capacityFloorByTier: {}, soldCountForEvent: 0 }) };
    if (name.endsWith("/perNightCapacity")) return { isPerNightCapacity: () => false };
    if (name.endsWith("/useEventOrders")) return { useEventReconciliation: () => ({ data: [], status: "ready" }), useEventHasWebPurchases: () => ({ data: false }) };
    if (name.endsWith("/useBusinessEvents")) return { businessEventKeys: { detail: (id: string) => [id], list: (id: string) => [id] } };
    if (name.endsWith("/usePublicEvents")) return { publicEventKeys: { detailById: (id: string) => [id], detailBySlug: (...ids: string[]) => ids, brandBySlug: (id: string) => [id] } };
    if (name.endsWith("/rsvpEvents")) return { updateLiveRsvp };
    if (name.endsWith("/themePreviewContent")) return { buildDraftThemePreview: () => null };
    if (/(orderRefundService|publishedEventEditGuards|tierEditGuardCopy|eventCoverMediaService|businessEvents|pricingSwitchesService|refundPolicyWrites|refundPolicyTerms)$/.test(name)) return {};
    if (name === "@mingla/brand-assets") return { MINGLA_BUSINESS_LOGO: 1 };
    if (name.endsWith("/createDeferredTurnoutIntelProvider")) return { createDeferredTurnoutIntelProvider: () => leaf("IntelProvider") };
    // #1780: the create host now also mounts the invite-selection surfaces
    // (Your Book picker, review summary, publish confirmation) and the #3446
    // Android back hook. None of them is this suite's subject — the typed
    // guest count on Step 5 and the host/edit parity are — so they are
    // substituted as inert leaves and hooks, exactly like the other
    // infrastructure boundaries above. The invite flag is off, which is the
    // shipped default, so the invite step is not in the create host's stepper.
    // Real invite behaviour is proved by the #1780 suites.
    if (name.endsWith("/context/AuthContext")) return { useAuth: () => ({ isAuthReady: true, user: { id: "issue-3402-user" }, signOut: jest.fn() }) };
    if (name.endsWith("/useFeatureFlag")) return { useFeatureFlag: () => ({ data: false, isLoading: false }) };
    if (name.endsWith("/useOfferingInvitePlan")) return { useOfferingInvitePlanSummary: () => ({ plan: { data: undefined }, quote: { data: undefined }, refreshAuthoritative: async () => ({ plan: null, quote: null }) }) };
    if (name.endsWith("/useWizardHardwareBack")) return { useWizardHardwareBack: () => undefined };
    if (name.endsWith("/InvitePeopleStep")) return { InvitePeopleStep: leaf("InvitePeopleStep"), InvitePeoplePublishConfirmation: leaf("InvitePeoplePublishConfirmation"), InvitePlanReviewSummary: leaf("InvitePlanReviewSummary") };
    const exportName = name.split("/").pop()!;
    if (/^(Button|ConfirmDialog|GlassCard|Icon|IconChrome|Stepper|TopBar|Toast|CreatorStep\d\w+|RsvpStep7Preview|PublishErrorsSheet|ChangeSummaryModal|EditAfterPublishBanner|ThemeControlRow|ThemeSheet)$/.test(exportName)) return { [exportName]: leaf(exportName) };
    throw new Error(`Unclassified host boundary: ${name}`);
  };
  const module = { exports: {} as Record<string, React.ComponentType<any>> };
  new Function("require", "module", "exports", output)(resolve, module, module.exports);
  return module.exports[mode === "create" ? "RsvpCreatorWizard" : "EditPublishedScreen"];
}
const Create = loadHost("create");
const Edit = loadHost("edit");
const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const roots: Tree[] = [];
beforeEach(() => { jest.useFakeTimers(); updateLiveRsvp.mockClear(); updateLiveEventFields.mockClear(); });
afterEach(() => { act(() => { roots.splice(0).forEach(tree => tree.unmount()); }); jest.useRealTimers(); });
const host = (tree: Tree, id: string): Node => {
  const nodes = tree.root.findAll(node => typeof node.type === "string" && node.props.testID === id);
  expect(nodes).toHaveLength(1);
  return nodes[0];
};
const call = async (tree: Tree, id: string, action: string, ...args: any[]) => {
  await act(async () => { host(tree, id).props[action](...args); });
};
async function mount(mode: "create" | "edit", capacity = 50): Promise<Tree> {
  const draft = { ...buildDraftEvent("brand", ID, "2026-09-15T00:00:00Z"), serverSlug: "fixture", isRsvp: true, name: "Count timing", rsvpCapacity: capacity, rsvpAllowPlusOnes: true, rsvpPlusOnesMax: 2 };
  useDraftEventStore.setState({ drafts: [draft], draftEditMeta: {} });
  const liveEvent = { ...draft, serverEventId: ID, eventSlug: "fixture", brandSlug: "brand", status: "live", dates: [], rsvpGoingCount: 0 };
  let tree!: Tree;
  await act(async () => { tree = renderer.create(mode === "create" ? <Create draft={draft} brand={null} isCreateMode={false} initialStep={4} onExit={() => undefined} onOpenPreview={() => undefined} /> : <Edit liveEvent={liveEvent} rsvpMode />); });
  roots.push(tree);
  if (mode === "edit") {
    const section = tree.root.findAll(node => node.type === "Pressable" && /^RSVP.*section/.test(String(node.props.accessibilityLabel)))[0];
    expect(section).toBeDefined();
    await act(async () => { section.props.onPress(); });
  }
  return tree;
}

test.each(["create", "edit"] as const)("#3402 %s host: in-range typing is live while still focused", async mode => {
  const tree = await mount(mode);
  await call(tree, "rsvp-capacity-value", "onFocus");
  await call(tree, "rsvp-capacity-value", "onChangeText", "300");
  expect(host(tree, "rsvp-capacity-value").props.value).toBe("300");
  if (mode === "create") expect(useDraftEventStore.getState().getDraft(ID)?.rsvpCapacity).toBe(300);
  else {
    const save = tree.root.findAll(node => node.type === "Button" && node.props.label === "Save changes")[0];
    expect(save.props.disabled).toBe(false);
    await act(async () => { save.props.onPress(); });
    const summary = tree.root.findAll(node => node.type === "ChangeSummaryModal")[0];
    expect(summary.props.visible).toBe(true);
    let pending!: Promise<void>;
    await act(async () => { pending = summary.props.onConfirm("Fixture count edit"); jest.advanceTimersByTime(2_000); await pending; });
    expect(updateLiveRsvp).toHaveBeenCalledTimes(1);
    expect(updateLiveRsvp.mock.calls[0][1]).toMatchObject({ rsvpCapacity: 300 });
  }
});

test.each(["create", "edit"] as const)("#3402 %s host: blur clamps before real host navigation and survives remount", async mode => {
  const tree = await mount(mode);
  await call(tree, "rsvp-capacity-value", "onFocus");
  await call(tree, "rsvp-capacity-value", "onChangeText", "0");
  expect(host(tree, "rsvp-capacity-value").props.value).toBe("0");
  await call(tree, "rsvp-capacity-value", "onBlur");
  expect(host(tree, "rsvp-capacity-value").props.value).toBe("1");
  if (mode === "create") {
    const next = tree.root.findAll(node => node.type === "Button" && node.props.label === "Continue")[0];
    await act(async () => { next.props.onPress(); });
    expect(useDraftEventStore.getState().getDraft(ID)?.rsvpCapacity).toBe(1);
  } else {
    // A real accordion section switch unmounts the NumberStepper.
    const section = tree.root.findAll(node => node.type === "Pressable" && /^Basics section/.test(String(node.props.accessibilityLabel)))[0];
    await act(async () => { section.props.onPress(); });
    const rsvp = tree.root.findAll(node => node.type === "Pressable" && /^RSVP.*section/.test(String(node.props.accessibilityLabel)))[0];
    await act(async () => { rsvp.props.onPress(); });
    expect(host(tree, "rsvp-capacity-value").props.value).toBe("1");
  }
});

test.each(["create", "edit"] as const)("#3402 %s host: a hold continues from a live typed count", async mode => {
  const tree = await mount(mode);
  await call(tree, "rsvp-capacity-value", "onFocus");
  await call(tree, "rsvp-capacity-value", "onChangeText", "80");
  await call(tree, "rsvp-capacity-inc", "onLongPress");
  await call(tree, "rsvp-capacity-inc", "onPressOut");
  expect(host(tree, "rsvp-capacity-value").props.value).toBe("81");
});
