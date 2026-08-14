#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const ROOT = process.cwd();
const RETIRED_BUSINESS_HASHES = new Set([
  "5ffe0064ff3d315a603d54f8a30706151f9b41f438a0406805ba11cd5215d5a8",
  "d48ac5d9f0d8859204961317222f533d9666c19308c5fcc9abd1ca56ffe8174c",
  "c6157ea01aa5891fd567b0377fe4c3409e2f542e389d5ca71f94d1de4fc0c747",
  "872e8669fe6b371e4b345f35c5c89ebc1e8b4e7f0cf1afe29b73be11c3cdce18",
]);
const ACTIVE_HOST_ASSETS = [
  "mingla-business/assets/images/icon.png",
  "mingla-business/assets/images/android-icon-foreground.png",
  "mingla-business/assets/images/android-icon-monochrome.png",
  "mingla-business/assets/images/favicon.png",
  "mingla-business/assets/images/splash-icon.png",
];
const sha256 = (file) => crypto.createHash("sha256")
  .update(fs.readFileSync(path.join(ROOT, file))).digest("hex");

test("retired BUSINESS artwork cannot remain in any active launch or icon slot", () => {
  for (const file of ACTIVE_HOST_ASSETS) {
    assert.equal(RETIRED_BUSINESS_HASHES.has(sha256(file)), false, file);
  }
});

test("the Host descriptor stays on launch art and never gets squeezed into launcher art", () => {
  const splashHash = sha256("mingla-business/assets/images/splash-icon.png");
  assert.notEqual(sha256("mingla-business/assets/images/icon.png"), splashHash);
  assert.notEqual(sha256("mingla-business/assets/images/android-icon-foreground.png"), splashHash);
  assert.notEqual(sha256("mingla-business/assets/images/favicon.png"), splashHash);
});

test("welcome screens remain regular Mingla and no JS-level duplicate splash is introduced", () => {
  const explorerWelcome = fs.readFileSync(path.join(
    ROOT, "app-mobile/src/components/signIn/WelcomeScreen.tsx"), "utf8");
  const hostWelcome = fs.readFileSync(path.join(
    ROOT, "mingla-business/src/components/auth/BusinessWelcomeScreen.tsx"), "utf8");
  assert.match(explorerWelcome, /MINGLA_WORDMARK/);
  assert.match(hostWelcome, /MINGLA_WORDMARK/);
  assert.doesNotMatch(explorerWelcome, /MINGLA_EXPLORER|splash-icon\.png/);
  assert.doesNotMatch(hostWelcome, /MINGLA_BUSINESS_LOGO|MINGLA_HOST|splash-icon\.png/);
});
