import fs from "node:fs";
import path from "node:path";

const source = fs.readFileSync(
  path.join(process.cwd(), "src/components/home/BusinessPulsePanel.tsx"),
  "utf8",
);

const styleBlock = (name: string): string => {
  const start = source.indexOf(`  ${name}: {`);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = source.indexOf("\n  },", start);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
};

describe("#4171 Business Pulse responsive width", () => {
  it("lets the non-desktop pulse fill the available tablet width", () => {
    const narrow = styleBlock("rootNarrow");

    expect(narrow).toContain('width: "100%"');
    expect(narrow).not.toMatch(/maxWidth\s*:/);
    expect(narrow).not.toMatch(/alignSelf\s*:\s*"center"/);
  });
});
