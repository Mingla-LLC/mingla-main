#!/usr/bin/env node
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const rel = {
  explorerOwner: "app-mobile/src/components/signIn/WelcomeScreen.tsx",
  explorerBackground: "app-mobile/src/components/signIn/WelcomeVideoBackground.tsx",
  hostOwner: "mingla-business/src/components/auth/BusinessWelcomeScreen.tsx",
  hostNative: "mingla-business/src/components/auth/WelcomeVideoBackground.native.tsx",
  hostWeb: "mingla-business/src/components/auth/WelcomeVideoBackground.web.tsx",
};
const assets = {
  explorerPortraitVideo: ["app-mobile/assets/welcome/mingla-welcome-portrait.mp4", "7de5bbf7fe5b67200e446c6fd3bfe3749d67d13f5bb64c0298fc12547f2a24eb"],
  explorerPortraitPoster: ["app-mobile/assets/welcome/mingla-welcome-portrait-poster.jpg", "27d1c1b4df8e690d16805909a0db458d6f7813c19a474eb164f6bfb23a4202c0"],
  hostPortraitVideo: ["mingla-business/assets/welcome/mingla-welcome-portrait.mp4", "7de5bbf7fe5b67200e446c6fd3bfe3749d67d13f5bb64c0298fc12547f2a24eb"],
  hostPortraitPoster: ["mingla-business/assets/welcome/mingla-welcome-portrait-poster.jpg", "27d1c1b4df8e690d16805909a0db458d6f7813c19a474eb164f6bfb23a4202c0"],
  hostLandscapeVideo: ["mingla-business/assets/welcome/mingla-welcome-landscape.mp4", "0fd10d4d76b3da429f6a37f5ded97a63a826bee307f0c553796b6a4284aded02"],
  hostLandscapePoster: ["mingla-business/assets/welcome/mingla-welcome-landscape-poster.jpg", "af81e22dae69e51e52adff1a60e97a9bf22c582cc84049728aa36bba01da47bf"],
};

const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "$1");
const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const requireNeedles = (source, needles, label) => {
  for (const needle of needles) {
    assert.ok(source.includes(needle), `${label}: missing ${needle}`);
  }
};
const forbidNeedles = (source, needles, label) => {
  for (const needle of needles) {
    assert.ok(!source.includes(needle), `${label}: forbidden ${needle}`);
  }
};

function readLive() {
  return {
    source: Object.fromEntries(
      Object.entries(rel).map(([key, file]) => [
        key,
        stripComments(fs.readFileSync(path.join(repoRoot, file), "utf8")),
      ]),
    ),
    assetBytes: Object.fromEntries(
      Object.entries(assets).map(([key, [file]]) => [key, fs.readFileSync(path.join(repoRoot, file))]),
    ),
  };
}

export function checkContract(fixture) {
  const s = fixture.source;
  for (const [key, [, expectedHash]] of Object.entries(assets)) {
    assert.equal(sha256(fixture.assetBytes[key]), expectedHash, `asset hash: ${key}`);
  }

  requireNeedles(s.explorerOwner, [
    'const WELCOME_TAGLINE = "Places, plans, and experiences\\nworth showing up for"',
    '"Places, plans, and experiences worth showing up for"',
    "MINGLA_WORDMARK",
    'accessibilityLabel="Mingla"',
    'justifyContent: "space-evenly"',
    "styles.logoContainer",
    "styles.tagline",
    "styles.authGroup",
    'backgroundColor: WELCOME_VIDEO_VEIL',
    'const WELCOME_VIDEO_VEIL = "rgba(255,255,255,0.64)"',
    "Math.max(insets.bottom, WELCOME_CONTENT_GUTTER)",
    "<WelcomeVideoBackground />",
    'accessibilityLabel={t(\'auth:welcome.continue_with_google\')}',
    'accessibilityLabel={t(\'auth:welcome.continue_with_apple\')}',
    "LEGAL_URLS.termsOfService",
    "LEGAL_URLS.privacyPolicy",
  ], "explorer owner");
  forbidNeedles(s.explorerOwner, ["LinearGradient", "HEADLINE_WORDS", "Dates,", "headlineAccent"], "explorer owner");

  requireNeedles(s.hostOwner, [
    'const WELCOME_TAGLINE = "Great places and experiences\\ndeserve to be discovered."',
    '"Great places and experiences deserve to be discovered."',
    'import { MINGLA_WORDMARK } from "@mingla/brand-assets"',
    "Image.resolveAssetSource(MINGLA_WORDMARK).uri",
    'alt: "Mingla"',
    'accessibilityLabel="Mingla"',
    "const WELCOME_NATIVE_LOGO_CAP = 320",
    "const WELCOME_DESKTOP_LOGO_CAP = 420",
    "const logoHeight = logoWidth * 480 / 1356",
    'justifyContent: "space-evenly"',
    'const WELCOME_VIDEO_VEIL = "rgba(255,255,255,0.64)"',
    'backgroundColor: WELCOME_VIDEO_VEIL',
    'accessibilityLabel="Continue with Apple"',
    'accessibilityLabel="Continue with Google"',
    'accessibilityLabel="Continue with Email"',
    'setMode("email-input")',
    'setMode("otp-input")',
    'setMode("otp-verifying")',
    "keyboardPad > 0 ? keyboardPad + 42 : 0",
  ], "host owner");
  forbidNeedles(s.hostOwner, ["MINGLA_BUSINESS_LOGO", "mingla-business-logo.png", "HEADLINE_WORDS", "List experiences", "LinearGradient"], "host owner");

  const backgroundCommon = [
    "useVideoPlayer(null",
    ".loop = true",
    ".muted = true",
    ".replaceAsync(",
    ".play()",
    ".pause()",
    'addListener("statusChange"',
    'status === "error"',
    "onFirstFrameRender={revealVideo}",
    'contentFit="cover"',
    'nativeControls={false}',
    "AppState.addEventListener",
    '"reduceMotionChanged"',
    "subscription.remove()",
    "console.warn(",
    'pointerEvents="none"',
    'importantForAccessibility="no-hide-descendants"',
    'accessible={false}',
  ];
  requireNeedles(s.explorerBackground, [...backgroundCommon, "PORTRAIT_VIDEO", "PORTRAIT_POSTER", '"textureView"', "eligibleRef.current = reduceMotion === false && isActive && !failed", "!eligibleRef.current"], "explorer background");
  requireNeedles(s.hostNative, [...backgroundCommon, "PORTRAIT_VIDEO", "PORTRAIT_POSTER", '"textureView"', "eligibleRef.current = reduceMotion === false && isActive && !failed", "!eligibleRef.current"], "host native background");
  requireNeedles(s.hostWeb, [...backgroundCommon, "LANDSCAPE_VIDEO", "LANDSCAPE_POSTER", "saveData", "matchMedia", "onConnectionChange", "playsInline", "eligibleRef.current = !reduceMotion && !saveData && isActive && !failed", "!eligibleRef.current"], "host web background");
  forbidNeedles(s.explorerBackground, ["landscape"], "explorer background orientation");
  forbidNeedles(s.hostNative, ["landscape"], "host native orientation");
  forbidNeedles(s.hostWeb, ["portrait"], "host web orientation");
  forbidNeedles(s.hostOwner, ["mingla-welcome-portrait", "mingla-welcome-landscape"], "host owner orientation isolation");

  for (const key of ["explorerBackground", "hostNative", "hostWeb"]) {
    const posterIndex = s[key].indexOf("<Image");
    const videoIndex = s[key].indexOf("<VideoView");
    assert.ok(posterIndex >= 0 && videoIndex > posterIndex, `${key}: poster must precede video`);
  }
  const explorerBackgroundIndex = s.explorerOwner.indexOf("<WelcomeVideoBackground />");
  const explorerVeilIndex = s.explorerOwner.indexOf('style={styles.videoVeil}');
  const explorerUiIndex = s.explorerOwner.indexOf("<SafeAreaView");
  assert.ok(explorerBackgroundIndex < explorerVeilIndex && explorerVeilIndex < explorerUiIndex, "explorer layer order");
  const hostBackgroundIndex = s.hostOwner.indexOf("<WelcomeVideoBackground />");
  const hostVeilIndex = s.hostOwner.indexOf('style={styles.videoVeil}');
  const hostUiIndex = s.hostOwner.indexOf("<SafeAreaView");
  assert.ok(hostBackgroundIndex < hostVeilIndex && hostVeilIndex < hostUiIndex, "host layer order");
}

function expectMutationToFail(base, mutate, label) {
  const fixture = {
    source: { ...base.source },
    assetBytes: { ...base.assetBytes },
  };
  mutate(fixture);
  assert.throws(() => checkContract(fixture), undefined, label);
}

function selfTest() {
  const good = readLive();
  checkContract(good);
  expectMutationToFail(good, (x) => { x.source.explorerOwner = x.source.explorerOwner.replace("Places, plans, and experiences\\nworth showing up for", "Dates and hangouts"); }, "copy/gradient family");
  expectMutationToFail(good, (x) => { x.source.hostOwner = x.source.hostOwner.replace(/MINGLA_WORDMARK/g, "MINGLA_BUSINESS_LOGO"); }, "logo family");
  expectMutationToFail(good, (x) => { x.source.hostNative = x.source.hostNative.replace(/portrait/g, "landscape"); }, "orientation family");
  expectMutationToFail(good, (x) => { x.source.hostOwner = x.source.hostOwner.replace("rgba(255,255,255,0.64)", "rgba(0,0,0,0.64)"); }, "overlay family");
  expectMutationToFail(good, (x) => { x.source.hostWeb = x.source.hostWeb.replace("status === \"error\"", "status === \"never\""); }, "error fallback family");
  expectMutationToFail(good, (x) => { x.source.hostNative = x.source.hostNative.replace("eligibleRef.current = reduceMotion === false", "eligibleRef.current = true || reduceMotion === false"); }, "reduced motion family");
  expectMutationToFail(good, (x) => { x.assetBytes.hostLandscapeVideo = Buffer.from(x.assetBytes.hostLandscapeVideo); x.assetBytes.hostLandscapeVideo[100] ^= 1; }, "asset family");
  process.stdout.write("issue-2052 self-test: 1 GOOD + 7 BAD fixtures passed\n");
}

if (process.argv.includes("--self-test")) selfTest();
else {
  checkContract(readLive());
  process.stdout.write("issue-2052 video welcome contract: PASS\n");
}
