import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../../../..");
const read = (relative: string): string =>
  fs.readFileSync(path.join(root, relative), "utf8");

const lazyHosts = [
  "app/(tabs)/people/import.tsx",
  "src/components/people/PeoplePage.tsx",
  "src/components/people/ManualGroupDetail.tsx",
  "src/components/people/ManualGroupFlow.tsx",
];

describe("#2395 tester — deferred Manual-group UI remains actionable", () => {
  test.each(lazyHosts)(
    "%s has visible accessible loading instead of a blank Suspense fallback",
    (file) => {
      const source = read(file);
      expect(source).not.toContain("<React.Suspense fallback={null}>");
      expect(source).toContain("accessibilityLiveRegion");
      expect(source).toMatch(/Loading|Preparing|Opening/);
    },
  );

  test.each(lazyHosts)(
    "%s contains a local chunk-error boundary with an explicit retry/reset path",
    (file) => {
      const source = read(file);
      expect(source).toContain("ErrorBoundary");
      expect(source).toMatch(/Try again|Retry/);
      expect(source).toMatch(/onReset|resetKeys|retry/i);
    },
  );
});

jest.mock("../../ui/Button", () => ({
  Button: (props: Record<string, unknown>) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const LocalReact = require("react") as typeof import("react");
    return LocalReact.createElement("MockButton", props);
  },
}));
jest.mock("../../ui/Icon", () => ({ Icon: () => null }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ReactRuntime = require("react") as typeof import("react");
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  create: (node: React.ReactElement) => any;
  act: (callback: () => void | Promise<void>) => void | Promise<void>;
};

const textOf = (node: any): string => {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(textOf).join(" ");
  return node && typeof node === "object" ? textOf(node.children ?? []) : "";
};

describe("#2395 tester — deferred Manual-group rendered behavior", () => {
  test("an actual deferred host announces loading and then renders its resolved content", async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { RetryableLazyErrorBoundary } = require("../../ui/RetryableLazyBoundary") as typeof import("../../ui/RetryableLazyBoundary");
    let resolve!: (value: { default: React.ComponentType<{ label: string }> }) => void;
    const loader = jest.fn(
      () =>
        new Promise<{ default: React.ComponentType<{ label: string }> }>((done) => {
          resolve = done;
        }),
    );
    const Loaded = ({ label }: { label: string }) =>
      ReactRuntime.createElement("LoadedManualGroup", null, label);
    const Boundary = RetryableLazyErrorBoundary as React.ComponentType<{
      loader: typeof loader;
      componentProps: { label: string };
      loadingLabel: string;
    }>;
    let tree: any;

    await TestRenderer.act(async () => {
      tree = TestRenderer.create(
        ReactRuntime.createElement(Boundary, {
          loader,
          componentProps: { label: "Manual group ready" },
          loadingLabel: "Opening group members…",
        }),
      );
    });

    expect(textOf(tree.toJSON())).toContain("Opening group members…");
    expect(
      tree.root.findAll(
        (node: any) =>
          node.props.accessibilityLiveRegion === "polite" &&
          node.props.children === "Opening group members…",
      )[0],
    ).toBeDefined();
    expect(loader).toHaveBeenCalledTimes(1);

    await TestRenderer.act(async () => {
      resolve({ default: Loaded });
      await Promise.resolve();
    });
    expect(textOf(tree.toJSON())).toContain("Manual group ready");
    expect(textOf(tree.toJSON())).not.toContain("Opening group members…");
  });
});
