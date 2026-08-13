import assert from "node:assert/strict";
import fs from "node:fs";

const people = fs.readFileSync(
  "mingla-business/src/components/people/PeoplePage.tsx",
  "utf8",
);
const nav = fs.readFileSync(
  "mingla-business/src/components/marketing/MarketingSubNav.tsx",
  "utf8",
);
const oldRoute = fs.readFileSync(
  "mingla-business/app/(tabs)/marketing/audiences/index.tsx",
  "utf8",
);

assert.match(people, /flag\.data===true/);
assert.match(nav, /marketing\/people/);
const tabs = nav.slice(nav.indexOf("const TABS"), nav.indexOf("function detectActive"));
assert.doesNotMatch(tabs, /marketing\/audiences/);
assert.match(oldRoute, /Redirect[\s\S]*marketing\/people/);
console.log("issue-1774 tester strict guard: PASS");
