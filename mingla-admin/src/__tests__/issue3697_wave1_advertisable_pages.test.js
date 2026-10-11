/**
 * toward #3697 Wave 1 — admin destination service calls the shared RPC
 * and keeps trip/experience URL helpers off `/e/`.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const SERVICE = path.join(ROOT, "mingla-admin/src/services/adDestinationsService.js");

test("Wave 1: adDestinationsService lists via ad_advertisable_pages RPC", () => {
  const src = fs.readFileSync(SERVICE, "utf8");
  assert.match(src, /ad_advertisable_pages/);
  assert.match(src, /listAdvertisablePages/);
  assert.match(src, /p_include_unavailable/);
  assert.match(src, /p_types/);
});

test("A4-5: trip and experience URL helpers never use /e/", () => {
  const src = fs.readFileSync(SERVICE, "utf8");
  assert.match(src, /\/t\/\$\{brandSlug\}\/\$\{slug\}/);
  assert.match(src, /\/exp\/\$\{brandSlug\}\/\$\{slug\}/);
  assert.doesNotMatch(
    src,
    /function tripUrl[\s\S]*\/e\//,
  );
});

test("PUBLIC_WEB_ORIGIN stays host.usemingla.com (create-gate parity)", () => {
  const src = fs.readFileSync(SERVICE, "utf8");
  assert.match(src, /export const PUBLIC_WEB_ORIGIN = "https:\/\/host\.usemingla\.com"/);
});
