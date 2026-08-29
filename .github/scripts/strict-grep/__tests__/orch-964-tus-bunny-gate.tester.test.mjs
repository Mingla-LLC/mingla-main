/**
 * TESTER-AUTHORED adversarial companion for issue #964 (D-4): TUS/Bunny
 * event-cover upload gate coverage.
 *
 * ANGLE — this test attacks a DIFFERENT axis than the gate modules' built-in
 * self-check modes. Those prove OMISSION: drop a live invariant → the gate trips.
 * This test proves REINTRODUCTION / SECRET-LEAK: take the REAL live source, splice a dead
 * Cloudinary-era shape or the Bunny library secret back into client-reachable /
 * webhook code, and assert the gate's exported `scan()` reports the exact failure
 * class. It binds `scan()` to the genuine on-disk live files (not synthetic
 * fixtures) so the POSITIVE case is a real "live shape is clean" proof, and the
 * mutations are derived from that same live source.
 *
 * scan() contracts (per the gate modules):
 *   orch-0770  scan({uploadIntent, shared, bunnyStream, config, publicPage})
 *   orch-0770b scan({webhook, bunnyStream, sourceUploaded})
 *
 * #958 masking note: this file imports the gates' pure `scan()` functions
 * directly and never spawns a nested `node --test` child — so no NODE_TEST_CONTEXT
 * inheritance and no silently-masked child failures. Every assertion below
 * surfaces to this process's own exit code.
 *
 * Run: `node --test orch-964-tus-bunny-gate.tester.test.mjs`
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { scan as scan0770 } from "../orch-0770-event-cover-video-processing.mjs";
import { scan as scan0770b } from "../orch-0770b-bunny-webhook-family.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
// __tests__ → strict-grep → scripts → .github → repo root (cwd-independent).
const REPO_ROOT = join(__dirname, "..", "..", "..", "..");
const read = (rel) => readFileSync(join(REPO_ROOT, rel), "utf8");

// Live source paths — mirror the gates' own REL maps.
const P = {
  uploadIntent: "supabase/functions/event-cover-video-upload-intent/index.ts",
  shared: "supabase/functions/_shared/eventCoverVideo.ts",
  bunnyStream: "supabase/functions/_shared/bunnyStream.ts",
  config: "supabase/config.toml",
  publicPage: "mingla-business/src/components/event/PublicEventPage.tsx",
  webhook: "supabase/functions/event-cover-video-webhook/index.ts",
  sourceUploaded: "supabase/functions/event-cover-video-source-uploaded/index.ts",
};

const live0770 = () => ({
  uploadIntent: read(P.uploadIntent),
  shared: read(P.shared),
  bunnyStream: read(P.bunnyStream),
  config: read(P.config),
  publicPage: read(P.publicPage),
});

const live0770b = () => ({
  webhook: read(P.webhook),
  bunnyStream: read(P.bunnyStream),
  sourceUploaded: read(P.sourceUploaded),
});

const hasPrefix = (failures, prefix) => failures.some((m) => m.startsWith(prefix));

// ── POSITIVE — the unmodified live shapes must be clean (proves both directions) ──

test("orch-0770: unmodified LIVE sources produce ZERO failures", () => {
  const f = scan0770(live0770());
  assert.deepEqual(f, [], `live TUS/Bunny sources should be clean, got: ${JSON.stringify(f)}`);
});

test("orch-0770b: unmodified LIVE sources produce ZERO failures", () => {
  const f = scan0770b(live0770b());
  assert.deepEqual(f, [], `live webhook-family sources should be clean, got: ${JSON.stringify(f)}`);
});

// ── orch-0770 — reintroduction / secret-leak ──

test("orch-0770: leaking the Bunny AccessKey into client-reachable upload-intent CODE trips UI-SEC", () => {
  const s = live0770();
  // Real code (survives comment-strip): the library secret handed to the client.
  s.uploadIntent += "\nconst __leakedDescriptor = { AccessKey: bunnyLibraryApiKey };\n";
  const f = scan0770(s);
  assert.ok(hasPrefix(f, "UI-SEC:"), `expected a UI-SEC secret-leak failure, got: ${JSON.stringify(f)}`);
});

test("orch-0770: reintroducing verifyCloudinaryNotificationSignature into _shared trips SH-CLD", () => {
  const s = live0770();
  s.shared += "\nexport function verifyCloudinaryNotificationSignature() { return true; }\n";
  const f = scan0770(s);
  assert.ok(hasPrefix(f, "SH-CLD:"), `expected an SH-CLD Cloudinary-reintroduction failure, got: ${JSON.stringify(f)}`);
});

test("orch-0770: reintroducing the x-cld-timestamp header into _shared trips SH-CLD", () => {
  const s = live0770();
  s.shared += '\nconst __legacyHeader = "x-cld-timestamp";\n';
  const f = scan0770(s);
  assert.ok(hasPrefix(f, "SH-CLD:"), `expected an SH-CLD Cloudinary-reintroduction failure, got: ${JSON.stringify(f)}`);
});

test("orch-0770: flipping coverVideoProvider away from \"bunny\" trips SH-1", () => {
  const s = live0770();
  s.shared = s.shared.replace('return "bunny"', 'return "cloudinary"');
  const f = scan0770(s);
  assert.ok(hasPrefix(f, "SH-1:"), `expected an SH-1 provider-flip failure, got: ${JSON.stringify(f)}`);
});

// ── orch-0770b — webhook-family authenticity / fail-closed / reintroduction ──

test("orch-0770b: removing verifyBunnyWebhookSignature from the webhook trips WH-1", () => {
  const s = live0770b();
  s.webhook = s.webhook.replaceAll("verifyBunnyWebhookSignature", "noopSignatureCheck");
  const f = scan0770b(s);
  assert.ok(hasPrefix(f, "WH-1:"), `expected a WH-1 signature-authenticity failure, got: ${JSON.stringify(f)}`);
});

// [TEST-MOD-APPROVED #2715 A13] Missing derivatives stay retryable and non-destructive.
test("orch-0770b: reverting derivative lag to processed_mp4_unavailable trips WH-6", () => {
  const s = live0770b();
  s.webhook = s.webhook.replace("derivative_not_ready", "processed_mp4_unavailable");
  const f = scan0770b(s);
  assert.ok(hasPrefix(f, "WH-6:"), `expected a WH-6 retryability failure, got: ${JSON.stringify(f)}`);
});

test("orch-0770b: acknowledging missing derivatives with 2xx trips WH-6", () => {
  const s = live0770b();
  s.webhook = s.webhook.replace(
    'return jsonResponse({ error: "derivative_not_ready" }, 503);',
    'return jsonResponse({ error: "derivative_not_ready" }, 200);',
  );
  const f = scan0770b(s);
  assert.ok(hasPrefix(f, "WH-6:"), `expected a WH-6 HTTP-status failure, got: ${JSON.stringify(f)}`);
});

test("orch-0770b: deleting the asset during derivative lag trips WH-6", () => {
  const s = live0770b();
  s.webhook = s.webhook.replace(
    'return jsonResponse({ error: "derivative_not_ready" }, 503);',
    'await deps.destroyCoverVideoAsset(existingJob); return jsonResponse({ error: "derivative_not_ready" }, 503);',
  );
  const f = scan0770b(s);
  assert.ok(hasPrefix(f, "WH-6:"), `expected a WH-6 destructive-lag failure, got: ${JSON.stringify(f)}`);
});

test("orch-0770b: terminally failing the job during derivative lag trips WH-6", () => {
  const s = live0770b();
  s.webhook = s.webhook.replace(
    'return jsonResponse({ error: "derivative_not_ready" }, 503);',
    'await supabase.rpc("cover_video_transition_job", { p_to_status: "failed" }); return jsonResponse({ error: "derivative_not_ready" }, 503);',
  );
  const f = scan0770b(s);
  assert.ok(hasPrefix(f, "WH-6:"), `expected a WH-6 terminal-lag failure, got: ${JSON.stringify(f)}`);
});

test("orch-0770b: reintroducing the x-cld-timestamp header into the webhook trips WH-CLD", () => {
  const s = live0770b();
  s.webhook += '\nconst __t = req.headers.get("x-cld-timestamp");\n';
  const f = scan0770b(s);
  assert.ok(hasPrefix(f, "WH-CLD:"), `expected a WH-CLD Cloudinary-reintroduction failure, got: ${JSON.stringify(f)}`);
});

test("orch-0770b: reintroducing verifyCloudinaryNotificationSignature into the webhook trips WH-CLD", () => {
  const s = live0770b();
  s.webhook += "\nverifyCloudinaryNotificationSignature(rawBody);\n";
  const f = scan0770b(s);
  assert.ok(hasPrefix(f, "WH-CLD:"), `expected a WH-CLD Cloudinary-reintroduction failure, got: ${JSON.stringify(f)}`);
});
