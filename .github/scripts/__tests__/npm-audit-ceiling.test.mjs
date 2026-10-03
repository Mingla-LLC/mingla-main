import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { test } from "node:test";

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.resolve(here, "../npm-audit-ceiling.mjs");

test("npm-audit-ceiling --self-test passes", () => {
  const res = spawnSync(process.execPath, [script, "--self-test"], {
    encoding: "utf8",
  });
  assert.equal(res.status, 0, res.stderr || res.stdout);
  assert.match(res.stdout, /PASS/);
});
