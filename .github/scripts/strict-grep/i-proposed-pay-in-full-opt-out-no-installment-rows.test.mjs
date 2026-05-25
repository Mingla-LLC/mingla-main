#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const script = resolve(
  __dirname,
  "i-proposed-pay-in-full-opt-out-no-installment-rows.mjs",
);

const output = execFileSync(process.execPath, [script, "--self-test"], {
  encoding: "utf8",
});

assert.match(output, /positive=0, negative=1/);
assert.match(output, /PASS/);

console.log("i-proposed-pay-in-full-opt-out-no-installment-rows.test.mjs: PASS");
