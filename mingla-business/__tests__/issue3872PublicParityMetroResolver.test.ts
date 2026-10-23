import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(__dirname, "..", "..");

describe("issue #3872 public pricing Metro resolver", () => {
  it("maps both public parity subpath forms to the shared workspace source", () => {
    const metro = fs.readFileSync(
      path.join(repoRoot, "mingla-business", "metro.config.js"),
      "utf8",
    );

    expect(metro).toMatch(
      /moduleName === "@mingla\/offering-rendering\/publicParityContract"/,
    );
    expect(metro).toMatch(
      /moduleName === "\.\/packages\/offering-rendering\/publicParityContract"/,
    );
    expect(metro).toMatch(
      /WORKSPACE_ROOT,[\s\S]*"packages",[\s\S]*"offering-rendering",[\s\S]*"publicParityContract\.ts"/,
    );
    expect(metro).toMatch(/type: "sourceFile"/);
  });
});
