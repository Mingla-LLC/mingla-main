// MINGLA-INVARIANT: I-3682-HOST-FOLLOWBUTTON-METRO-SUBPATH | issue #3682 | Host Public pages resolve the lazy FollowButton package subpath to the workspace source on iOS, Android and web.
import path from "node:path";

type MetroResolution = { filePath: string; type: string };
type MetroConfig = {
  resolver: {
    resolveRequest: (
      context: unknown,
      moduleName: string,
      platform: string,
    ) => MetroResolution;
  };
};

const metro = require("../metro.config.js") as MetroConfig;

describe("issue #3682 FollowButton Metro resolver", () => {
  const expected = {
    filePath: path.resolve(
      __dirname,
      "..",
      "..",
      "packages",
      "brand-rendering",
      "FollowButton.tsx",
    ),
    type: "sourceFile",
  };

  it.each(["ios", "android", "web"])(
    "resolves the lazy package subpath on %s",
    (platform) => {
      expect(
        metro.resolver.resolveRequest(
          {},
          "@mingla/brand-rendering/FollowButton",
          platform,
        ),
      ).toEqual(expected);
    },
  );

  it.each(["ios", "android", "web"])(
    "recovers Metro's rewritten app-relative subpath on %s",
    (platform) => {
      expect(
        metro.resolver.resolveRequest(
          {},
          "./packages/brand-rendering/FollowButton",
          platform,
        ),
      ).toEqual(expected);
    },
  );
});
