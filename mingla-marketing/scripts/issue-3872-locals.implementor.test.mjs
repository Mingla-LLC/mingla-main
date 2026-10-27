import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const source = fs.readFileSync(path.resolve("app/locals/page.tsx"), "utf8");
for (const truth of [
  "up to three Locals",
  "earn $150 after approval",
  "pay for your own visit",
  "paid by Mingla",
  "never comes from the place",
  "three seats per city",
]) {
  assert.match(source, new RegExp(truth.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
}
assert.doesNotMatch(source, /guaranteed|sponsored by the place|free meal/i);
console.log("#3872 Locals marketing truth: pass");
