/**
 * #2830 tester — opening the setup screen to look must not take the plan lock.
 * A heartbeat before "who else is here?" has answered would lock a teammate's
 * running Ari out of its own writes (`sites_plan_locked`) for ten minutes.
 */
import React from "react";

const mockFlow = { data: undefined as unknown, isError: false, refetch: jest.fn() };
const mockLockTakeOver = jest.fn();
const mockTakeMutate = jest.fn();
const mockStart: { onHand: null | (() => void) } = { onHand: null };

jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn(), replace: jest.fn(), setParams: jest.fn() }) }));
jest.mock("../../../../services/supabase", () => ({ supabase: { from: jest.fn(), functions: { invoke: jest.fn() }, rpc: jest.fn() } }));
jest.mock("../../../../sites/planApi", () => ({ useSaveBrandSitePlan: () => ({ mutate: jest.fn() }) }));
jest.mock("../../../../sites/planRoutes", () => ({ firstOfferingRoute: () => null }));
jest.mock("../../../../sites/setupApi", () => ({
  SetupFlowError: class extends Error {},
  planBuildDone: () => false,
  useSetupFlowState: () => mockFlow,
  useTakeOverSetup: () => ({ mutate: mockTakeMutate, isPending: false }),
  useSetupDraft: () => ({ state: { kind: "not_ready" }, start: jest.fn(), retry: jest.fn() }),
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
jest.mock("../SetupStart", () => ({ SetupStart: (p: { onHand: () => void }) => { mockStart.onHand = p.onHand; return null; } }));
jest.mock("../../website/WebsiteContext", () => ({
  useWebsite: () => ({
    brandId: "b", brandName: "Lantern", phone: false, toast: jest.fn(), asking: false, askAdmin: jest.fn(),
    lock: { takeOver: mockLockTakeOver, takingOver: false },
    controller: { site: { data: null, isLoading: false, refetch: jest.fn() }, publicationReceipt: { data: null }, previewGrant: { refetch: () => Promise.resolve() } },
  }),
}));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WebsiteSetupScreen } from "../WebsiteSetupScreen";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, create } = require("react-test-renderer") as {
  act: (fn: () => unknown) => Promise<void>;
  create: (node: React.ReactElement) => { root: { findAll: (t: (n: { props: Record<string, any> }) => boolean) => { props: Record<string, any> }[] } };
};

const plan = (lock: { active: boolean; heldByMe: boolean; holderName: string | null }) => ({
  canManage: true,
  site: null,
  plan: { revision: 1, activePart: "brand", skippedParts: [], approvedAt: null },
  parts: [],
  setupStatus: null,
  completeness: { fields: [] },
  lock,
});
const render = async (planData: unknown, onHeartbeat: jest.Mock) => {
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(
      <QueryClientProvider client={new QueryClient()}>
        <WebsiteSetupScreen step="brand" search={{}} planQuery={{ data: planData, isLoading: false, isError: false, refetch: jest.fn() } as never} grant={{} as never} onHeartbeat={onHeartbeat} />
      </QueryClientProvider>,
    );
  });
  return tree;
};
const free = { active: false, heldByMe: false, holderName: null };

describe("state 1 respects presence", () => {
  it("a watcher on the start screen cannot take the form while a teammate's Ari run is live", async () => {
    mockFlow.data = { runId: "r", status: "active", stepKey: "offer", revision: 1, mine: false, stopped: false, ownerName: "Ama", ownerSince: null, lastActivityAt: null, conversationId: null, canTakeOver: true, lastTakeover: null };
    const beat = jest.fn();
    await render({ ...plan(free), plan: null }, beat);
    expect(mockStart.onHand).not.toBeNull();
    await act(async () => { mockStart.onHand?.(); });
    // Runtime proof on the local stack: this took the plan lock during the owner's live run.
    expect(beat).not.toHaveBeenCalled();
  });
});
