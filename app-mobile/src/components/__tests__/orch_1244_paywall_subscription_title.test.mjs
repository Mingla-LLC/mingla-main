#!/usr/bin/env node
/**
 * ORCH-1244 [Apple Guideline 3.1.2(c)] — the auto-renewing subscription's TITLE
 * must be shown in the purchase flow. The paywall already shows length, price,
 * per-month price, and functional Privacy + Terms links (forensics verified); the
 * ONLY gap was the missing subscription NAME.
 *
 * Source-structural suite (no jest/RTL in app-mobile; the full RevenueCat +
 * react-i18next + RN render graph is not node-loadable — same convention as the
 * other ORCH-1244 / orch-1190 / orch-1171 suites).
 *
 * Contract proven:
 *   T1  A `subscriptionTitle` Text is rendered above the package list.
 *   T2  Its source is the real StoreKit product title (pkg.product.title) with a
 *       fallback to the i18n "Mingla+" (billing:tier.plus_name) — never empty.
 *   T3  A `subscriptionTitle` style exists.
 *   T4  The compliant length / price / legal-link elements are UNTOUCHED
 *       (planLabel/getPeriodLabelKey, priceString, Terms + Privacy links) —
 *       guards against an accidental regression of the already-passing elements.
 *
 * Run: node --test src/components/__tests__/orch_1244_paywall_subscription_title.test.mjs
 *
 * FAILS-ON-REVERT: removing the subscriptionTitle Text or its style flips T1/T3;
 * dropping the product.title / plus_name source flips T2.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MOBILE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const src = fs.readFileSync(
  path.join(MOBILE_ROOT, 'src/components/CustomPaywallScreen.tsx'),
  'utf8',
);

test('T1: a subscriptionTitle Text is rendered', () => {
  assert.match(
    src,
    /<Text\s+style=\{styles\.subscriptionTitle\}>/,
    'the subscription title element must be rendered in the purchase flow',
  );
});

test('T2: title source = pkg.product.title with "Mingla+" (plus_name) fallback', () => {
  // Find the subscriptionTitle JSX block and assert both the real StoreKit title
  // and the i18n brand fallback are present.
  const idx = src.indexOf('styles.subscriptionTitle');
  assert.ok(idx !== -1);
  const block = src.slice(idx, idx + 220);
  assert.match(block, /product\.title/, 'must surface the real StoreKit product title');
  assert.match(
    block,
    /t\(\s*['"]billing:tier\.plus_name['"]\s*\)/,
    'must fall back to the i18n "Mingla+" so a title is always shown',
  );
});

test('T3: subscriptionTitle style is defined', () => {
  assert.match(
    src,
    /subscriptionTitle:\s*\{/,
    'styles.subscriptionTitle must exist',
  );
});

test('T4: compliant length / price / legal elements remain present (no regression)', () => {
  assert.match(src, /getPeriodLabelKey/, 'length label must remain');
  assert.match(src, /product\.priceString/, 'price must remain');
  assert.match(src, /termsOfService/, 'Terms link must remain');
  assert.match(src, /privacyPolicy/, 'Privacy link must remain');
});
