#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const EXPECTED_ASSETS = {
  "mingla-business/assets/images/icon.png": [
    "d16e3e15956a552a6608014962857d61b1442c8db738d000fca5f155527a2307", 1024, 1024,
  ],
  "mingla-business/assets/images/android-icon-foreground.png": [
    "c0192aeeee72a0547bcbbad17081581c0d1d34865e83ee28eef6b3be25835a78", 1024, 1024,
  ],
  "mingla-business/assets/images/android-icon-monochrome.png": [
    "427f4f97b1facfafec6450c04848e3b88b6f3c862b4a33cb01519cc62fd62393", 432, 432,
  ],
  "mingla-business/assets/images/favicon.png": [
    "f8a50ee40a7d3011dada2815120eb9052d1682d970f67b4b39e6db7a85cdb187", 48, 48,
  ],
  "mingla-business/assets/images/splash-icon.png": [
    "4c0d6c7f83751eec9411a6a5b51cd8dc071261c6d46033a4638882e0a4d95f16", 2000, 2000,
  ],
};

const fail = (message) => {
  throw new Error(`[issue-2050 native launch] ${message}`);
};
const sha256 = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");
const pngSize = (buffer) => [buffer.readUInt32BE(16), buffer.readUInt32BE(20)];
const splashPlugin = (config) => {
  const entry = config.expo.plugins.find((plugin) =>
    plugin === "expo-splash-screen" ||
    (Array.isArray(plugin) && plugin[0] === "expo-splash-screen"));
  return Array.isArray(entry) ? entry[1] : null;
};

export function validate(model) {
  const { consumer, host, hostConfigSource, assets } = model;
  const consumerSplash = splashPlugin(consumer);
  const hostSplash = splashPlugin(host);
  const expectedConsumerSplash = {
    image: "./assets/splash-icon.png",
    imageWidth: 240,
    resizeMode: "contain",
    backgroundColor: "#FAFAFA",
    dark: { backgroundColor: "#FAFAFA" },
  };
  const expectedHostSplash = {
    image: "./assets/images/splash-icon.png",
    imageWidth: 240,
    resizeMode: "contain",
    backgroundColor: "#eb7825",
    dark: { backgroundColor: "#eb7825" },
  };
  if (JSON.stringify(consumerSplash) !== JSON.stringify(expectedConsumerSplash)) {
    fail("Explorer splash must be explicit, 240 wide, and #FAFAFA in both themes");
  }
  if (JSON.stringify(hostSplash) !== JSON.stringify(expectedHostSplash)) {
    fail("Host splash must be explicit, 240 wide, and Mingla orange in both themes");
  }
  if (host.expo.name !== "Mingla Host") fail("Host display name drifted");
  if (host.expo.icon !== "./assets/images/icon.png") fail("Host icon path drifted");
  if (host.expo.android.adaptiveIcon.foregroundImage !==
      "./assets/images/android-icon-foreground.png") fail("Host adaptive foreground drifted");
  if (host.expo.android.adaptiveIcon.backgroundColor.toLowerCase() !== "#eb7825") {
    fail("Host adaptive icon background drifted");
  }
  if (host.expo.web.favicon !== "./assets/images/favicon.png") fail("Host favicon drifted");

  const immutable = {
    hostBundle: host.expo.ios.bundleIdentifier,
    hostPackage: host.expo.android.package,
    consumerBundle: consumer.expo.ios.bundleIdentifier,
    consumerPackage: consumer.expo.android.package,
    consumerScheme: consumer.expo.scheme,
  };
  const expectedImmutable = {
    hostBundle: "com.sethogieva.minglabusiness",
    hostPackage: "com.sethogieva.minglabusiness",
    consumerBundle: "com.mingla.app.v2",
    consumerPackage: "com.mingla.app.v2",
    consumerScheme: "com.mingla.app.v2",
  };
  if (JSON.stringify(immutable) !== JSON.stringify(expectedImmutable)) {
    fail("immutable native identity changed during visual rename");
  }
  if (!hostConfigSource.includes('scheme: "mingla-business"')) {
    fail("immutable Host native scheme changed during visual rename");
  }

  for (const [file, expected] of Object.entries(EXPECTED_ASSETS)) {
    const actual = assets[file];
    if (!actual || JSON.stringify(actual) !== JSON.stringify(expected)) {
      fail(`${file} is not the approved asset bytes and geometry`);
    }
  }
}

function loadModel() {
  const consumer = JSON.parse(fs.readFileSync(path.join(ROOT, "app-mobile/app.json"), "utf8"));
  const host = JSON.parse(fs.readFileSync(path.join(ROOT, "mingla-business/app.json"), "utf8"));
  const hostConfigSource = fs.readFileSync(path.join(ROOT, "mingla-business/app.config.ts"), "utf8");
  const assets = {};
  for (const file of Object.keys(EXPECTED_ASSETS)) {
    const bytes = fs.readFileSync(path.join(ROOT, file));
    assets[file] = [sha256(bytes), ...pngSize(bytes)];
  }
  return { consumer, host, hostConfigSource, assets };
}

if (process.argv.includes("--self-test")) {
  const good = loadModel();
  validate(good);
  const mutations = [
    (x) => { splashPlugin(x.consumer).imageWidth = 241; },
    (x) => { splashPlugin(x.consumer).dark.backgroundColor = "#000000"; },
    (x) => { splashPlugin(x.host).image = "./assets/images/icon.png"; },
    (x) => { splashPlugin(x.host).backgroundColor = "#FAFAFA"; },
    (x) => { x.host.expo.name = "Mingla Business"; },
    (x) => { x.hostConfigSource = x.hostConfigSource.replace(
      'scheme: "mingla-business"', 'scheme: "mingla-host"'); },
    (x) => { x.host.expo.android.adaptiveIcon.foregroundImage = "./host-lockup.png"; },
    (x) => { x.assets["mingla-business/assets/images/splash-icon.png"][0] = "0".repeat(64); },
  ];
  for (const mutate of mutations) {
    const fixture = structuredClone(good);
    mutate(fixture);
    let rejected = false;
    try { validate(fixture); } catch { rejected = true; }
    if (!rejected) fail("BAD fixture passed");
  }
  console.log("PASS issue-2050 native launch: 1 GOOD + 8 BAD fixtures");
} else {
  validate(loadModel());
  console.log("PASS issue-2050 native launch identity");
}
