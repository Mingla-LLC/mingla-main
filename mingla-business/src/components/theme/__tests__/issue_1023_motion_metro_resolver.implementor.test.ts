// issue #1023 review — the dev server resolves lazy `./packages/...` chunk
// requests from the two workspace packages (the web motion player and the 58
// Lottie files) by re-rooting them at the workspace and delegating to Metro's
// own resolver, instead of 404-ing against mingla-business/.
import path from "node:path";

import { describe, expect, test } from "@jest/globals";

type Resolution = { filePath?: string; type?: string; delegated?: string; platform?: string };
type MetroConfig = {
  resolver: { resolveRequest: (context: unknown, moduleName: string, platform: string) => Resolution };
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const metro = require("../../../../metro.config.js") as MetroConfig;
const WORKSPACE = path.resolve(__dirname, "../../../../..");
const context = {
  resolveRequest: (_ctx: unknown, moduleName: string, platform: string): Resolution => ({
    delegated: moduleName,
    platform,
  }),
};

describe("#1023 Metro resolves lazy workspace chunk requests", () => {
  test.each([
    ["./packages/offering-rendering/ThemeEntranceAnimationWebImpl", "packages/offering-rendering/ThemeEntranceAnimationWebImpl"],
    ["./packages/theme-animations/lottie/confetti.intro.json", "packages/theme-animations/lottie/confetti.intro.json"],
    ["./packages/offering-rendering/OfferingRefundLadder", "packages/offering-rendering/OfferingRefundLadder"],
  ])("%s → the workspace file, resolved by Metro", (moduleName, target) => {
    const out = metro.resolver.resolveRequest(context, moduleName, "web");
    expect(out).toEqual({ delegated: path.join(WORKSPACE, target), platform: "web" });
  });

  test("the pinned exact entries keep their results", () => {
    const out = metro.resolver.resolveRequest(context, "./packages/offering-rendering/publicParityContract", "web");
    expect(out.filePath).toBe(path.join(WORKSPACE, "packages", "offering-rendering", "publicParityContract.ts"));
  });

  test("other packages are untouched", () => {
    const out = metro.resolver.resolveRequest(context, "./packages/phone-input/index", "web");
    expect(out.delegated).toBe("./packages/phone-input/index");
  });
});
