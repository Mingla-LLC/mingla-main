#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../..");
const SCREEN_PATH = path.join(
  REPO_ROOT,
  "mingla-business/app/brand/[id]/audit-log.tsx",
);
const LABELS_PATH = path.join(
  REPO_ROOT,
  "mingla-business/src/utils/auditTargetLabels.ts",
);

const screen = fs.readFileSync(SCREEN_PATH, "utf8");
const labels = fs.readFileSync(LABELS_PATH, "utf8");

test("issue #3645 screen sends the raw target only through the label resolver", () => {
  assert.match(
    screen,
    /import\s+\{\s*formatAuditTargetSummary\s*\}\s+from\s+["']\.\.\/\.\.\/\.\.\/src\/utils\/auditTargetLabels["']/,
  );
  assert.match(
    screen,
    /formatAuditTargetSummary\(\s*row\.target_type,\s*row\.target_id,?\s*\)/,
  );
  assert.equal(
    screen.match(/\brow\.target_type\b/g)?.length,
    1,
    "raw target_type must have exactly one use: the canonical label resolver",
  );
});

test("issue #3645 visible and screen-reader metadata share the same safe string", () => {
  assert.match(
    screen,
    /accessibilityLabel=\{r\.metadataSummary\}[\s\S]*?\{r\.metadataSummary\}/,
  );
  assert.doesNotMatch(
    screen,
    /\{r\.(?:targetSummary|target_type|targetType)\}/,
    "the rendered card must never bypass metadataSummary",
  );
});

test("issue #3645 unknown target types fail safe instead of being humanised", () => {
  assert.match(labels, /TARGET_LABELS\[targetType\]\s*\?\?\s*["']Record["']/);
  assert.doesNotMatch(
    labels,
    /replace\([^\n]*(?:_|snake|title)/i,
    "unknown internal names must not be cosmetically humanised and exposed",
  );
});
