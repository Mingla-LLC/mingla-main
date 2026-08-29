const path = require("node:path");

const businessModules = path.resolve(
  __dirname,
  "../../../../mingla-business/node_modules",
);

Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  value: true,
});

describe("issue #2788 Consumer hero render dependency ownership", () => {
  it("loads React and its renderer from the one reviewed Business owner", () => {
    const suiteReact = require("react");
    const ownerReact = require(path.join(businessModules, "react"));
    const suiteRenderer = require("react-test-renderer");
    const ownerRenderer = require(
      path.join(businessModules, "react-test-renderer"),
    );
    const suiteReactNative = require("react-native");
    const ownerReactNativeWeb = require(
      path.join(businessModules, "react-native-web"),
    );

    expect(suiteReact).toBe(ownerReact);
    expect(suiteRenderer).toBe(ownerRenderer);
    expect(suiteReactNative).toBe(ownerReactNativeWeb);
    expect(require.resolve("react")).toBe(
      require.resolve(path.join(businessModules, "react")),
    );
    expect(require.resolve("react-test-renderer")).toBe(
      require.resolve(path.join(businessModules, "react-test-renderer")),
    );
  });

  it("executes effects through that same React and renderer pair", async () => {
    const React = require("react");
    const TestRenderer = require("react-test-renderer");
    const effect = jest.fn();

    function EffectProbe() {
      React.useEffect(effect, []);
      return null;
    }

    await TestRenderer.act(async () => {
      TestRenderer.create(React.createElement(EffectProbe));
    });

    expect(effect).toHaveBeenCalledTimes(1);
  });
});
