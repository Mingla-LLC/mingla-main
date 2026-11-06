/**
 * #3355 bug 18 — Brand Edit's return, rendered.
 *
 * 1. The Brand Edit route: after a save (or Back) with no history it goes to
 *    the opener's `returnTo`, else the brand's own page — never Account. With
 *    history it goes back.
 * 2. Ari's Website setup pane opens Brand Edit with Ari's own path as
 *    `returnTo`, so the owner lands back in the setup.
 *
 * The pure ordering rules live in issue_3355_brand_edit_return.implementor.test.ts.
 */
import React from "react";

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

type Node = { type: unknown; props: Record<string, unknown> };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  act: (callback: () => void) => void;
  create: (node: React.ReactElement) => {
    root: { findAll: (predicate: (node: Node) => boolean) => Node[] };
    unmount: () => void;
  };
};

jest.mock("react-native", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactModule = require("react");
  const host =
    (name: string) =>
    ({ children, ...props }: { children?: React.ReactNode }) =>
      ReactModule.createElement(name, props, children);
  return {
    Pressable: host("pressable"),
    ScrollView: host("scroll-view"),
    StyleSheet: { create: (styles: unknown) => styles },
    Text: host("text"),
    View: host("view"),
  };
});
// Every design token reads as a harmless value; layout is not under test.
jest.mock("../../constants/designSystem", () => {
  const token: object = new Proxy(
    {},
    { get: (_target, key) => (key === "__esModule" ? false : token) },
  );
  return token;
});

const router = {
  back: jest.fn(),
  canGoBack: jest.fn(() => false),
  push: jest.fn(),
  replace: jest.fn(),
};
let params: Record<string, string | undefined> = {};
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => params,
  useRouter: () => router,
}));
jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("../../components/brand/BrandEditView", () => ({
  BrandEditView: (props: Record<string, unknown>) =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("react").createElement("brand-edit-view", props),
}));
jest.mock("../../context/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1" }, isAuthReady: true }),
}));
jest.mock("../../store/currentBrandStore", () => {
  const useCurrentBrandStore = (select: (s: object) => unknown) =>
    select({ setCurrentBrand: () => undefined });
  useCurrentBrandStore.getState = () => ({ currentBrandId: null });
  return { useCurrentBrandStore };
});
jest.mock("../../hooks/useBrands", () => ({
  useBrand: () => ({
    data: { id: "b1", displayName: "Lantern Supper Club" },
    isFetched: true,
    isLoading: false,
  }),
  useUpdateBrand: () => ({ mutateAsync: jest.fn() }),
}));
jest.mock("../../services/brandMapping", () => ({
  joinBrandDescription: () => null,
}));
jest.mock("../../services/supabase", () => ({
  supabase: { functions: { invoke: jest.fn() } },
}));
jest.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: undefined, isLoading: false, isError: false }),
}));

/* eslint-disable @typescript-eslint/no-require-imports */
const BrandEditRoute = (
  require("../../../app/brand/[id]/edit") as { default: React.FC }
).default;
/* eslint-enable @typescript-eslint/no-require-imports */

function mountRoute() {
  let r!: ReturnType<typeof TestRenderer.create>;
  TestRenderer.act(() => {
    r = TestRenderer.create(<BrandEditRoute />);
  });
  return r;
}

function afterSave(r: ReturnType<typeof mountRoute>): void {
  const [view] = r.root.findAll((n) => n.type === "brand-edit-view");
  TestRenderer.act(() => (view.props.onAfterSave as () => void)());
}

beforeEach(() => {
  router.back.mockClear();
  router.push.mockClear();
  router.replace.mockClear();
  router.canGoBack.mockReturnValue(false);
  params = { id: "b1" };
});

describe("#3355 Brand Edit route — where a save returns", () => {
  test("opened by Ari with no history: back to Ari's setup", () => {
    params = { id: "b1", returnTo: "/(tabs)/ari?brandId=b1&sitesIntent=setup" };
    const r = mountRoute();
    afterSave(r);
    expect(router.replace).toHaveBeenCalledWith(
      "/(tabs)/ari?brandId=b1&sitesIntent=setup",
    );
    expect(router.back).not.toHaveBeenCalled();
    TestRenderer.act(() => r.unmount());
  });

  test("no history and no returnTo: the brand's own page, never Account", () => {
    const r = mountRoute();
    afterSave(r);
    expect(router.replace).toHaveBeenCalledWith("/brand/b1");
    expect(JSON.stringify(router.replace.mock.calls)).not.toContain("account");
    TestRenderer.act(() => r.unmount());
  });

  test("an outside returnTo is ignored", () => {
    params = { id: "b1", returnTo: "https://evil.test/x" };
    const r = mountRoute();
    afterSave(r);
    expect(router.replace).toHaveBeenCalledWith("/brand/b1");
    TestRenderer.act(() => r.unmount());
  });

  test("with history, Back and after-save go back", () => {
    router.canGoBack.mockReturnValue(true);
    params = { id: "b1", returnTo: "/(tabs)/ari" };
    const r = mountRoute();
    afterSave(r);
    const [view] = r.root.findAll((n) => n.type === "brand-edit-view");
    TestRenderer.act(() => (view.props.onCancel as () => void)());
    expect(router.back).toHaveBeenCalledTimes(2);
    expect(router.replace).not.toHaveBeenCalled();
    TestRenderer.act(() => r.unmount());
  });
});
