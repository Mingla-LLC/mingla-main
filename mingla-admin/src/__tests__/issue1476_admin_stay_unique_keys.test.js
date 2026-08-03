import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const detail = read("src/components/entity/EntityDetailView.jsx");
const stay = read("src/components/stay/StayOperationsPanel.jsx");

test("entity fields prefer a supplied stable key and retain a unique fallback", () => {
  assert.match(detail, /key=\{field\.key \|\| `\$\{field\.label \|\| "field"\}-\$\{fi\}`\}/);
});

test("repeated Stay notifications and timeline events use their immutable ids", () => {
  assert.match(stay, /`notification-\$\{item\.id\}`/);
  assert.match(stay, /`timeline-\$\{event\.id\}`/);
  assert.doesNotMatch(stay, /notifications\.map\(\(item\) => field\(item\.categoryKey,[^)]*\)\)/);
});
