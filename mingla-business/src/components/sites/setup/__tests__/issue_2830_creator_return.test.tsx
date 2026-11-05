/**
 * #2830 T-RET-2 — a creator opened from Website setup shows the way back and
 * lands there however it ends. Opened any other way, or with a hostile returnTo,
 * nothing changes.
 *
 * Rendered: the experience creator (the route with the most exits of its own).
 * The event, RSVP and trip routes carry the same check; their structure is pinned
 * in .github/scripts/strict-grep/issue-2830-sites-foundation.mjs.
 */
import React from "react";

const mockReplace = jest.fn();
const mockBack = jest.fn();
let mockParams: Record<string, string | undefined> = {};
let mockCanGoBack = true;
let mockJustPublished = false;
let mockWizardProps: Record<string, (...args: unknown[]) => void> = {};

jest.mock("expo-router", () => ({
  useRouter: () => ({ replace: mockReplace, back: mockBack, canGoBack: () => mockCanGoBack, push: jest.fn() }),
  useLocalSearchParams: () => mockParams,
}));
jest.mock("@tanstack/react-query", () => ({
  ...jest.requireActual("@tanstack/react-query"),
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}));
jest.mock("../../../../hooks/useExperienceDetail", () => ({ experienceDetailKeys: { detail: () => ["d"] } }));
jest.mock("../../../../hooks/useExperiencesByBrand", () => ({ experienceKeys: { listByBrand: () => ["l"] } }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("../../../../hooks/useCurrentBrand", () => ({ useCurrentBrand: () => ({ id: "b" }) }));
jest.mock("../../../ui/SafeScreen", () => ({ SafeScreen: ({ children }: { children: React.ReactNode }) => children }));
jest.mock("../../../experience/LazyExperienceCreatorWizard", () => ({
  LazyExperienceCreatorWizard: (props: Record<string, (...args: unknown[]) => void>) => {
    mockWizardProps = props;
    return null;
  },
}));
jest.mock("../../../../utils/justPublishedSignal", () => ({
  isJustPublishedPending: () => mockJustPublished,
  markJustPublished: jest.fn(),
}));

type TestNode = { props: Record<string, any>; findAll: (test: (node: TestNode) => boolean) => TestNode[] };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, create } = require("react-test-renderer") as {
  act: (fn: () => unknown) => Promise<void>;
  create: (node: React.ReactElement) => { root: TestNode; unmount: () => void };
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Route = (require("../../../../../app/experience/create") as { default: React.FC }).default;

const SETUP = "/brand/b/website/setup?step=first_offering";

async function mount() {
  let tree!: ReturnType<typeof create>;
  await act(async () => { tree = create(<Route />); });
  await act(async () => { await Promise.resolve(); });
  return tree;
}
const bar = (tree: { root: TestNode }) => tree.root.findAll((n) => n.props.testID === "creator-return-back" && typeof n.props.onPress === "function");

beforeEach(() => {
  mockReplace.mockClear();
  mockBack.mockClear();
  mockParams = {};
  mockCanGoBack = true;
  mockJustPublished = false;
});

describe("#2830 T-RET-2 the experience creator's way back", () => {
  it("from setup: the bar shows, and pressing it, closing or finishing all land on setup", async () => {
    mockParams = { returnTo: SETUP };
    const tree = await mount();
    expect(bar(tree).length).toBeGreaterThan(0);
    await act(async () => { bar(tree)[0].props.onPress(); });
    expect(mockReplace).toHaveBeenLastCalledWith(SETUP);
    await act(async () => { mockWizardProps.onCancel(); });
    expect(mockReplace).toHaveBeenLastCalledWith(SETUP);
    expect(mockBack).not.toHaveBeenCalled();
    await act(async () => { mockWizardProps.onComplete("e1"); });
    expect(mockReplace).toHaveBeenLastCalledWith(`${SETUP}&added=experience&addedId=e1`);
  });

  it("the experience wizard has no autosave, so the bar doesn't promise one", async () => {
    mockParams = { returnTo: SETUP };
    const tree = await mount();
    const words = JSON.stringify(tree.root.findAll((n) => typeof n.props.children === "string").map((n) => n.props.children));
    expect(words).toContain("Back to website setup");
    expect(words).not.toContain("Saved as a draft");
  });

  it("opened any other way: no bar, today's exits exactly", async () => {
    const tree = await mount();
    expect(bar(tree)).toHaveLength(0);
    await act(async () => { mockWizardProps.onCancel(); });
    expect(mockBack).toHaveBeenCalledTimes(1);
    await act(async () => { mockWizardProps.onComplete("e1"); });
    expect(mockReplace).toHaveBeenLastCalledWith("/(tabs)/hub/experiences");
    mockJustPublished = true;
    await act(async () => { mockWizardProps.onComplete("e2"); });
    expect(mockReplace).toHaveBeenLastCalledWith("/experience/e2");
  });

  it.each(["https://x.test/brand/b/website/setup", "//x.test/brand/b/website/setup", "/brand/b/edit", "/account"])("a returnTo of %s is ignored", async (returnTo) => {
    mockParams = { returnTo };
    const tree = await mount();
    expect(bar(tree)).toHaveLength(0);
    await act(async () => { mockWizardProps.onComplete("e1"); });
    expect(mockReplace).toHaveBeenLastCalledWith("/(tabs)/hub/experiences");
    tree.unmount();
  });
});
