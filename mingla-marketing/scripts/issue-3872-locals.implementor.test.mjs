import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// #4636: the page's copy moved into its block content (content/site-blocks/programmes.ts).
const source = ["app/locals/page.tsx", "content/site-blocks/programmes.ts"].map((f) => fs.readFileSync(path.resolve(f), "utf8")).join("\n");
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
