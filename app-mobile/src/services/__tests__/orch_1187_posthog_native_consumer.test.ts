// @ts-nocheck
/* eslint-disable @typescript-eslint/no-require-imports */
//
// META-ORCH-1187 [Growth Analytics Hub] Phase 1 — LEG 3 happy-path regression
// (consumer app-mobile). The implementor-owned regression test (the tester
// writes a second, adversarial one).
//
// app-mobile has NO jest/RTL runner; the repo convention is node:assert
// source-assertions (see orch_1148_consumer_realtime_freshness.test.ts). Every
// assertion below FAILS on a TRUE LINE-DELETION of the policy it protects
// (fails-on-revert), NOT merely on a comment-out.
//
// Protected policies (all from the spec, native leg):
//   - masked native session replay is enabled (maskAllTextInputs/Images true) — §4.H
//   - the PostHog key is read STATICALLY (Constants.expoConfig.extra) — COMMS-0028
//   - init no-ops gracefully when the key is missing — T-10
//   - the Settings "Analytics" toggle is wired to optOut/optIn — §4.F(b) / T-19
//   - the US ingestion host literal is present — I-PROPOSED-1187-POSTHOG-HOST-US
//
// Run with:
//   node app-mobile/src/services/__tests__/orch_1187_posthog_native_consumer.test.ts

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../../..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

let passed = 0;
const ok = (cond, msg) => {
  assert.ok(cond, msg);
  passed += 1;
};

// ── postHogService.ts ────────────────────────────────────────────────────────
const svc = read("src/services/postHogService.ts");
// Comment-stripped CODE — so a doc-comment mention of a literal does not satisfy
// an assertion (true fails-on-revert vs LINE-DELETION of the real code).
const svcCode = svc
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

// US host literal (region lock) — must be in CODE, not only a comment.
ok(
  svcCode.includes("https://us.i.posthog.com"),
  "postHogService must hard-code the US ingestion host (region lock).",
);

// Masked native session replay — the security gate (CODE, comment-stripped).
ok(
  /enableSessionReplay:\s*true/.test(svcCode),
  "native session replay must be ENABLED (enableSessionReplay: true).",
);
ok(
  /maskAllTextInputs:\s*true/.test(svcCode),
  "native replay must mask all text inputs (maskAllTextInputs: true) — PII gate.",
);
ok(
  /maskAllImages:\s*true/.test(svcCode),
  "native replay must mask all images (maskAllImages: true) — PII gate.",
);
ok(
  !/maskAllTextInputs:\s*false/.test(svcCode) &&
    !/maskAllImages:\s*false/.test(svcCode),
  "masking must NEVER be set false (a replay capturing PII is an automatic FAIL).",
);

// Static key read (COMMS-0028) — extra read present, no dynamic process.env[...].
ok(
  svcCode.includes("Constants.expoConfig?.extra"),
  "the key must be read from Constants.expoConfig.extra (Hermes/OTA-safe, COMMS-0028).",
);
ok(
  !/process\.env\s*\[/.test(svcCode),
  "no dynamic process.env[...] read — not inlined by babel-preset-expo (COMMS-0028).",
);

// No-op on missing key (T-10): the init guards on an empty key and returns.
ok(
  /if\s*\(\s*!key\b/.test(svc) || /key\.length\s*===\s*0/.test(svc),
  "initialize() must no-op gracefully when the key is missing (T-10).",
);

// Opt-out / opt-in API exist (Settings toggle wiring).
ok(/optOut\s*\(\s*\)\s*:/.test(svc), "postHogService must expose optOut().");
ok(/optIn\s*\(\s*\)\s*:/.test(svc), "postHogService must expose optIn().");

// ── appStore.ts — the persisted opt-out flag ────────────────────────────────
const store = read("src/store/appStore.ts");
ok(
  /analyticsOptOut:\s*boolean/.test(store),
  "appStore must declare analyticsOptOut: boolean.",
);
ok(
  /setAnalyticsOptOut/.test(store),
  "appStore must expose setAnalyticsOptOut.",
);
ok(
  /analyticsOptOut:\s*state\.analyticsOptOut/.test(store),
  "analyticsOptOut must be PERSISTED (present in partialize).",
);

// ── AccountSettings.tsx — the Settings toggle wired to optOut/optIn ──────────
const settings = read("src/components/profile/AccountSettings.tsx");
ok(
  /postHogService\.optOut\(\)/.test(settings) &&
    /postHogService\.optIn\(\)/.test(settings),
  "the Analytics toggle must call postHogService.optOut()/optIn() (T-19).",
);

// ── SwipeableCards.tsx — the 5 behavior events mirror Mixpanel ───────────────
const cards = read("src/components/SwipeableCards.tsx");
for (const ev of [
  "card_viewed",
  "card_expanded",
  "card_saved",
  "card_dismissed",
  "deck_exhausted",
]) {
  ok(
    new RegExp(`postHogService\\.capture\\(\\s*["']${ev}["']`).test(cards),
    `SwipeableCards must capture "${ev}" alongside the Mixpanel site.`,
  );
}

// ── Conversion: purchase (ConsumerEventDetailScreen) + signup (index) ───────
const purchase = read("src/screens/Event/ConsumerEventDetailScreen.tsx");
ok(
  /postHogService\.capture\(\s*["']purchase_completed["']/.test(purchase),
  "consumer purchase success must capture purchase_completed (SC-5).",
);
const boot = read("app/index.tsx");
ok(
  /postHogService\.capture\(\s*["']signup_completed["']/.test(boot),
  "consumer signup must capture signup_completed (SC-5).",
);
ok(
  /postHogService\.identify\(/.test(boot),
  "consumer must identify(user.id) at the Mixpanel-identify site (SC-7).",
);

// ── Provider mounted at root layout ─────────────────────────────────────────
const layout = read("app/_layout.tsx");
ok(
  /<PostHogAnalyticsProvider[\s>]/.test(layout),
  "root layout must mount <PostHogAnalyticsProvider> (autocapture + replay).",
);

console.log(
  `OK: ORCH-1187 consumer PostHog native regression — ${passed} assertions passed`,
);
