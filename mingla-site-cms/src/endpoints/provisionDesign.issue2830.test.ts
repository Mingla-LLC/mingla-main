import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("#2830 provision starts with the design approved in the setup plan", () => {
  const source = fs.readFileSync(path.resolve(process.cwd(), "src/endpoints/sitesEndpoints.ts"), "utf8");

  it("accepts only registered designs and falls back safely for older signed calls", () => {
    expect(source).toContain("(DESIGN_KEYS as readonly string[]).includes(body.design_key)");
    expect(source).toContain(': "atelier"');
  });

  it("stores that design in the initial site settings rather than requiring a draft first", () => {
    const provision = source.slice(
      source.indexOf("async function provisionOrReconcile"),
      source.indexOf("async function publish("),
    );
    expect(provision).toContain("const designKey");
    expect(provision).toMatch(/data:\s*\{[\s\S]*design:\s*designKey/);
  });
});
