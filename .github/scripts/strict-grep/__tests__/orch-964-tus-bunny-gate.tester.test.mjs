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
 *   orch-0770b scan(<every key of the gate's exported REL map>)
 *
 * [TEST-MOD-APPROVED #2905] The 0770b source set GREW — the reconciler
 * (event-cover-video-reaper/index.ts) joined the webhook family because it now
 * synthesises webhook bodies, so its enum crossing and stall deadline are
 * webhook-family invariants. A hand-copied three-key source list left the new
 * source absent; `scan()` reads an absent source as "" and every RP-* rule then
 * fired on a PRISTINE tree — a rule that always fires carries no information.
 * The live builder below is now DERIVED from the gate's exported REL map, so
 * this class of drift cannot recur, and a completeness test below proves every
 * declared source is load-bearing.
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
import { REL as REL_0770B, scan as scan0770b } from "../orch-0770b-bunny-webhook-family.mjs";

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

// [TEST-MOD-APPROVED #2905] Derived from the gate's own REL map, not a copied
// literal: whatever sources the 0770b gate declares, this fixture supplies.
const live0770b = () =>
  Object.fromEntries(
    Object.entries(REL_0770B).map(([key, rel]) => [key, read(rel)]),
  );

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

// ── orch-0770b — #2905 source-set completeness + reconciler (RP-*) invariants ──
//
// Appended for #2905. The RP-* rules cover the reconciler
// (event-cover-video-reaper/index.ts), which replays a Bunny API video-object
// status as a webhook body. Two failure modes are proven here against the REAL
// on-disk sources, in BOTH directions: the pristine tree is clean (test 2
// above), and each individual invariant genuinely trips when reverted.

test("orch-0770b: the live fixture supplies every source the gate declares, and each one is load-bearing", () => {
  const live = live0770b();
  assert.deepEqual(
    Object.keys(live).sort(),
    Object.keys(REL_0770B).sort(),
    "the live fixture must supply exactly the gate's declared source set",
  );
  // Path-rename tripwire: the two paths this file already named by hand must
  // still be the ones the gate reads.
  assert.equal(REL_0770B.webhook, P.webhook, "0770b webhook source path drifted");
  assert.equal(REL_0770B.sourceUploaded, P.sourceUploaded, "0770b source-uploaded path drifted");
  assert.equal(REL_0770B.bunnyStream, P.bunnyStream, "0770b bunnyStream source path drifted");
  // Every declared source must matter: omitting any one of them must NOT scan
  // clean. This is what makes "absent source reads as empty" a loud failure
  // rather than a silently-skipped rule set.
  for (const key of Object.keys(REL_0770B)) {
    const short = { ...live };
    delete short[key];
    assert.notDeepEqual(
      scan0770b(short),
      [],
      `omitting the ${key} source must not scan clean — that source's rules would be dark`,
    );
  }
});

test("orch-0770b: dropping the reconciler's named enum crossing trips RP-1", () => {
  const s = live0770b();
  s.reaper = s.reaper.replaceAll("bunnyApiVideoStatusAsWebhookStatus", "identityStatus");
  const f = scan0770b(s);
  assert.ok(hasPrefix(f, "RP-1:"), `expected an RP-1 enum-crossing failure, got: ${JSON.stringify(f)}`);
});

test("orch-0770b: replaying the raw API video-object status as the webhook Status trips RP-1", () => {
  const s = live0770b();
  s.reaper = s.reaper.replace("Status: webhookStatus", "Status: provider.video.status");
  assert.ok(
    /\bStatus:\s*provider\.video\.status/.test(s.reaper),
    "fixture mutation must actually plant the raw API status in the webhook body",
  );
  const f = scan0770b(s);
  assert.ok(hasPrefix(f, "RP-1:"), `expected an RP-1 raw-status failure, got: ${JSON.stringify(f)}`);
});

test("orch-0770b: removing the reconciler's stall deadline constant trips RP-2", () => {
  const s = live0770b();
  s.reaper = s.reaper.replaceAll("COVER_VIDEO_STALL_MS", "SOME_OTHER_BOUND");
  const f = scan0770b(s);
  assert.ok(hasPrefix(f, "RP-2:"), `expected an RP-2 stall-deadline failure, got: ${JSON.stringify(f)}`);
});

test("orch-0770b: removing the reconciler's stall evaluator trips RP-2", () => {
  const s = live0770b();
  s.reaper = s.reaper.replaceAll("evaluateCoverVideoStall", "neverStalls");
  const f = scan0770b(s);
  assert.ok(hasPrefix(f, "RP-2:"), `expected an RP-2 stall-evaluator failure, got: ${JSON.stringify(f)}`);
});
