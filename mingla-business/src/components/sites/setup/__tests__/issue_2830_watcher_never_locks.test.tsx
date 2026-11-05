/**
 * #2830 P1 — a watcher must not lock. A heartbeat from someone only looking would
 * refuse the active owner's Ari writes for ten minutes.
 */
import React from "react";

const mockFlow = { data: undefined as unknown, isError: false, refetch: jest.fn() };
const mockDraftArgs: { canManage?: boolean }[] = [];

jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn(), replace: jest.fn(), setParams: jest.fn() }) }));
jest.mock("../../../../services/supabase", () => ({ supabase: { from: jest.fn(), functions: { invoke: jest.fn() }, rpc: jest.fn() } }));
jest.mock("../../../../sites/planApi", () => ({ useSaveBrandSitePlan: () => ({ mutate: jest.fn() }) }));
jest.mock("../../../../sites/planRoutes", () => ({ firstOfferingRoute: () => null }));
jest.mock("../../../../sites/setupApi", () => ({
  SetupFlowError: class extends Error {},
  planBuildDone: () => false,
  useSetupFlowState: () => mockFlow,
  useTakeOverSetup: () => ({ mutate: jest.fn(), isPending: false }),
  useSetupDraft: (args: { canManage?: boolean }) => {
    mockDraftArgs.push(args);
    return { state: { kind: "not_ready" }, refusal: null, start: jest.fn(), retry: jest.fn() };
  },
}));
jest.mock("../../../../store/currentBrandStore", () => ({ useCurrentBrandStore: () => jest.fn() }));
jest.mock("../../../ui/ConfirmDialog", () => ({ ConfirmDialog: () => null }));
jest.mock("../../../ui/SafeScreen", () => ({ SafeScreen: ({ children }: { children: React.ReactNode }) => children }));
jest.mock("../../../ui/Sheet", () => ({ Sheet: () => null }));
jest.mock("../../../../wrappers/SmartScrollView", () => ({ ScrollView: ({ children }: { children: React.ReactNode }) => children }));
jest.mock("../../website/WebsiteIcon", () => ({ WebsiteIcon: () => null }));
jest.mock("../../website/preview/SitePreviewPanel", () => ({ SitePreviewPanel: () => null }));
jest.mock("../../website/sections/PublishSection", () => ({ PublishSection: () => null }));
jest.mock("../../plan/OfferingsPart", () => ({ OfferingsPart: () => null }));
jest.mock("../../plan/PlanDesignPart", () => ({ PlanDesignPart: () => null }));
jest.mock("../../plan/StoryPart", () => ({ StoryPart: () => null }));
jest.mock("../SetupBrandStep", () => ({ SetupBrandStep: () => null }));
jest.mock("../SetupDraftStep", () => ({ SetupDraftStep: () => null }));
jest.mock("../SetupLive", () => ({ SetupLive: () => null }));
jest.mock("../SetupStart", () => ({ SetupStart: () => null }));
jest.mock("../../website/WebsiteContext", () => ({
  useWebsite: () => ({
    brandId: "b", brandName: "Lantern", phone: false, toast: jest.fn(), asking: false, askAdmin: jest.fn(),
    lock: { takeOver: jest.fn(), takingOver: false },
    controller: { site: { data: null, isLoading: false, refetch: jest.fn() }, publicationReceipt: { data: null }, previewGrant: { refetch: () => Promise.resolve() } },
  }),
}));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WebsiteSetupScreen } from "../WebsiteSetupScreen";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, create } = require("react-test-renderer") as {
  act: (fn: () => unknown) => Promise<void>;
  create: (node: React.ReactElement) => { unmount: () => void };
};
const mounted: { unmount: () => void }[] = [];
// The heartbeat and poll timers must not outlive a test (they keep Jest alive).
afterEach(async () => {
  await act(async () => { mounted.splice(0).forEach((tree) => tree.unmount()); });
});

const plan = {
  canManage: true,
  site: null,
  plan: { revision: 1, activePart: "brand", skippedParts: [], approvedAt: null },
  parts: [],
  setupStatus: null,
  completeness: { fields: [] },
  lock: { active: false, heldByMe: false, holderName: null },
};
const open = async (beat: jest.Mock) => {
  await act(async () => {
    mounted.push(create(
      <QueryClientProvider client={new QueryClient()}>
        <WebsiteSetupScreen step="brand" search={{}} planQuery={{ data: plan, isLoading: false, isError: false, refetch: jest.fn() } as never} grant={{} as never} onHeartbeat={beat} />
      </QueryClientProvider>,
    ));
  });
};
const run = (over: Record<string, unknown>) => ({ runId: "r", status: "active", stepKey: "brand", revision: 2, mine: false, stopped: false, ownerName: "Ama", ownerSince: null, lastActivityAt: null, conversationId: null, canTakeOver: true, lastTakeover: null, ...over });

describe("who locks", () => {
  beforeEach(() => { mockDraftArgs.length = 0; mockFlow.isError = false; });

  it("before anyone else's run is known: no lock and no compose (the tester's P1)", async () => {
    // A heartbeat sent while this answer loads would take the form from an
    // owner who is mid-run, and nothing on this screen could give it back.
    mockFlow.data = undefined;
    const beat = jest.fn();
    await open(beat);
    expect(beat).not.toHaveBeenCalled();
    expect(mockDraftArgs.at(-1)?.canManage).toBe(false);
  });
  it("a teammate's active run: no lock, and this screen never composes", async () => {
    mockFlow.data = run({});
    const beat = jest.fn();
    await open(beat);
    expect(beat).not.toHaveBeenCalled();
    expect(mockDraftArgs.at(-1)?.canManage).toBe(false);
  });
  it("a teammate's stopped run: no lock until they choose Continue", async () => {
    mockFlow.data = run({ stopped: true });
    const beat = jest.fn();
    await open(beat);
    expect(beat).not.toHaveBeenCalled();
  });
  it("nobody here, once known: this person holds the form", async () => {
    mockFlow.data = null;
    const beat = jest.fn();
    await open(beat);
    expect(beat).toHaveBeenCalledTimes(1);
    expect(mockDraftArgs.at(-1)?.canManage).toBe(true);
  });
  it("my own run: this person holds the form", async () => {
    mockFlow.data = run({ mine: true });
    const beat = jest.fn();
    await open(beat);
    expect(beat).toHaveBeenCalledTimes(1);
  });
});
