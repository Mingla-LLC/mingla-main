import fs from "node:fs";
import path from "node:path";

describe("#2794 tester — successful-open truth on local trip promotion", () => {
  test("the preparing/redirect placeholder cannot write a Recent open", () => {
    const source = fs.readFileSync(
      path.join(__dirname, "..", "[id]", "edit.tsx"),
      "utf8",
    );
    const writerStart = source.indexOf("useSuccessfulBusinessRecentOpen({");
    const writerEnd = source.indexOf("\n  });", writerStart);
    expect(writerStart).toBeGreaterThan(-1);
    expect(writerEnd).toBeGreaterThan(writerStart);

    const writer = source.slice(writerStart, writerEnd);
    expect(writer).toMatch(/ready:\s*!isClientOnlyId\s*&&/);
    expect(writer).toMatch(/tripQuery\.data\s*!=\s*null/);
    expect(writer).not.toMatch(
      /ready:\s*isClientOnlyId\s*\?\s*currentBrand\s*!==\s*null/,
    );
  });
});
