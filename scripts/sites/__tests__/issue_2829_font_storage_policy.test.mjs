// #2829 AD-3 — self-hosted fonts live in the existing approved-media bucket
// under fonts/<sha256>.woff2: the bucket accepts woff2, and the runtime reader
// may read exactly that path shape (no site segment, no other extension) and
// nothing new besides.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const SQL = fs.readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../bootstrap-sites-cms.sql"),
  "utf8",
);

test("#2829 the approved bucket accepts woff2 font files (and W11's TrueType previews)", () => {
  assert.match(SQL, /'sites-media-approved',\s*'sites-media-approved',\s*false,\s*\d+,[^)]*?ARRAY\['image\/webp', 'font\/woff2', 'font\/ttf', 'video\/mp4'\]::text\[\]/);
});

test("#2829 the runtime reader may read content-addressed font files only", () => {
  const policy = SQL.slice(SQL.indexOf("CREATE POLICY sites_runtime_reader_select"), SQL.indexOf("-- Execute PostgreSQL's real regex engine"));
  assert.ok(policy.includes(String.raw`AND name ~ '^fonts/[0-9a-f]{64}\.woff2$'`));
  const pattern = /\^fonts\/\[0-9a-f\]\{64\}\\\.woff2\$/;
  assert.match(policy, pattern);
  const font = new RegExp(String.raw`^fonts/[0-9a-f]{64}\.woff2$`);
  assert.ok(font.test(`fonts/${"d".repeat(64)}.woff2`));
  for (const bad of [`fonts/${"d".repeat(63)}.woff2`, `fonts/../${"d".repeat(64)}.woff2`, `fonts/x/${"d".repeat(64)}.woff2`, `fonts/${"d".repeat(64)}.ttf`]) {
    assert.ok(!font.test(bad), bad);
  }
  // The SQL self-check exercises the same grammar in PostgreSQL's engine.
  assert.ok(SQL.includes(`AND ('fonts/' || repeat('d', 64) || '.woff2') ~ font_pattern`));
});
