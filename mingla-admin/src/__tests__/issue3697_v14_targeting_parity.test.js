import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), "utf8");

describe("issue #3697 Admin targeting parity", () => {
  const audience = read("src/components/campaign-builder/StepAudience.jsx");
  const payload = read("src/lib/adBuilder/payload.js");

  it("resolves one logical interest across every selected provider", () => {
    assert.match(audience, /searchablePlatforms\.map\(async \(platform\)/);
    assert.match(audience, /kind: "interest"/);
    assert.match(audience, /candidate\.name/);
    assert.match(audience, /platform: "reddit", id: chip\.name/);
    assert.match(audience, /a missing mapping blocks the plan/i);
    assert.match(payload, /interestIds\[name\.toLocaleLowerCase/);
  });

  it("never describes unresolved city targeting as a country fallback", () => {
    assert.match(audience, /blocks the immutable plan/);
    assert.match(audience, /never\s+falls back silently/);
    assert.doesNotMatch(
      audience,
      /campaigns fall back to country targeting for that city/,
    );
  });
});
