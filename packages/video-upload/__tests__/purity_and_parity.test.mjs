// #3040 T-PKG — the package stays pure JavaScript (OTA-safe) and its limits
// match the edge defaults and the lane migration's CHECK text.
// MINGLA-INVARIANT: I-VIDEO-OTA-PURE-JS | issue #3040 | packages/video-upload contains no native code or native-module imports
// MINGLA-INVARIANT: I-VIDEO-LIMITS-PARITY | issue #3040 | duration, size and rendition limits are identical across client package, edge defaults and DB CHECKs
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { VIDEO_LIMITS } from "../index.js";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = join(PACKAGE_ROOT, "..", "..");

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? [path, ...walk(path)] : [path];
  });

test("no native folders, no expo module config, no react-native or expo imports", () => {
  const entries = walk(PACKAGE_ROOT);
  for (const entry of entries) {
    const name = entry.slice(PACKAGE_ROOT.length + 1);
    assert.ok(!/(^|\/)(ios|android)(\/|$)/.test(name), `native folder ${name}`);
    assert.ok(!name.endsWith("expo-module.config.json"), "expo-module.config.json present");
  }
  const sources = entries.filter((entry) => /\.(js|mjs|cjs|ts)$/.test(entry) && !entry.includes("__tests__"));
  assert.ok(sources.length >= 2);
  for (const file of sources) {
    const text = readFileSync(file, "utf8");
    assert.doesNotMatch(text, /from\s+["'](react-native|expo)[^"']*["']/, `${file} imports a native module`);
    assert.doesNotMatch(text, /require\(\s*["'](react-native|expo)[^"']*["']\s*\)/, `${file} requires a native module`);
  }
  const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8"));
  assert.equal(pkg.name, "@mingla/video-upload");
  assert.equal(pkg.dependencies, undefined, "no dependencies");
});

const EDGE = join(REPO_ROOT, "supabase", "functions", "_shared", "eventCoverVideo.ts");
const MIGRATIONS = join(REPO_ROOT, "supabase", "migrations");
const laneMigration = () => {
  if (!existsSync(MIGRATIONS)) return null;
  const name = readdirSync(MIGRATIONS).find((file) => /_issue_3040_video_lane_1080p_owners\.sql$/.test(file));
  return name ? join(MIGRATIONS, name) : null;
};
// The edge defaults and the lane migration land in the server wave of PR-1.
// Until that wave is in this tree the cross-layer half cannot be measured, and
// it says so instead of passing quietly; once the migration exists it binds.
const serverWave = laneMigration();
const pending = serverWave === null ? "server wave (lane migration) not in this tree yet" : false;

test("edge defaults equal VIDEO_LIMITS", { skip: pending }, () => {
  const edge = readFileSync(EDGE, "utf8");
  const def = (env) => {
    const match = new RegExp(`${env}"\\)\\s*\\?\\?\\s*"(\\d+)"`).exec(edge);
    assert.ok(match, `edge default for ${env} not found`);
    return Number(match[1]);
  };
  assert.equal(def("EVENT_COVER_FINAL_MAX_BYTES"), VIDEO_LIMITS.FINAL_MAX_BYTES);
  assert.equal(def("EVENT_COVER_MAX_SOURCE_VIDEO_BYTES"), VIDEO_LIMITS.SOURCE_MAX_BYTES);
  assert.equal(def("EVENT_COVER_MAX_DURATION_MS"), VIDEO_LIMITS.MAX_DURATION_MS);
  assert.match(edge, new RegExp(`AD_MIN_DURATION_MS\\s*=\\s*${VIDEO_LIMITS.AD_MIN_DURATION_MS}`));
  assert.match(edge, new RegExp(`MAX_RENDITION_HEIGHT\\s*=\\s*${VIDEO_LIMITS.MAX_RENDITION_HEIGHT}`));
});

test("lane migration CHECKs equal VIDEO_LIMITS", { skip: pending }, () => {
  const sql = readFileSync(serverWave, "utf8");
  assert.match(sql, new RegExp(`processed_bytes\\s*<=\\s*${VIDEO_LIMITS.FINAL_MAX_BYTES}`));
  assert.match(sql, new RegExp(`source_bytes\\s*<=\\s*${VIDEO_LIMITS.SOURCE_MAX_BYTES}`));
  assert.match(sql, new RegExp(`source_duration_ms\\s*>=\\s*${VIDEO_LIMITS.AD_MIN_DURATION_MS}`));
});
