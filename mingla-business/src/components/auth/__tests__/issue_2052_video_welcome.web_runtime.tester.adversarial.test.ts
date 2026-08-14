import fs from "node:fs";
import path from "node:path";

describe("issue #2052 Host web runtime compatibility", () => {
  test("the welcome screen never calls React Native Image.resolveAssetSource on web", () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, "../BusinessWelcomeScreen.tsx"),
      "utf8",
    );

    // React Native Web does not expose this native static method. Calling it
    // during render throws before any provider button becomes reachable.
    expect(source).not.toContain("Image.resolveAssetSource(");
  });
});
