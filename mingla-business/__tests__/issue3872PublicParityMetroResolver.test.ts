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

describe("issue #3872 public pricing Metro resolver", () => {
  it.each([
    "@mingla/offering-rendering/publicParityContract",
    "./packages/offering-rendering/publicParityContract",
  ])("resolves %s to the shared workspace source", (moduleName) => {
    const result = metro.resolver.resolveRequest({}, moduleName, "web");
    expect(result).toEqual({
      filePath: path.resolve(
        __dirname,
        "..",
        "..",
        "packages",
        "offering-rendering",
        "publicParityContract.ts",
      ),
      type: "sourceFile",
    });
  });
});
