// ORCH-1270 F-DS-1 [regression] — a recipient whose message ALREADY reached Twilio
// (its marketing_messages row carries a provider_message_id) must be SKIPPED on the
// next cron pass, EVEN IF a lost terminal UPDATE left that row at the non-terminal
// status 'queued'. This closes the MEDIUM latent double-send hole the tester proved
// on real Postgres (TEST_ORCH-1270_SMS_QUIET_HOURS_DEFER.md, defect F-DS-1): a
// deferred sibling re-parks the campaign to 'scheduled', cron re-picks, and the
// orphaned 'queued'-but-already-dispatched recipient gets a SECOND text.
//
// Angle: drive the REAL exported guard `shouldSkipDispatchedRecipient` from index.ts
// (NOT a re-implementation) so a revert of the F-DS-1 fix fails this file
// BEHAVIORALLY, plus source-contract teeth for the two DB-coupled halves (the
// SELECT that must fetch provider_message_id, and the error-checked/throwing
// post-send terminal UPDATE).
//
// Run:
//   deno test --allow-read --allow-net --allow-env --no-check \
//     supabase/functions/marketing-send/orch-1270-fds1.test.ts
//
// Importing index.ts boots its top-level serve() HTTP listener, so each test
// disables the resource/op sanitizer (harmless here) — same recipe as
// orch-1270-tester-boundaries.test.ts.
//
// fails-on-revert (cite this point, proven in the TEST/impl report): delete the
// `provider_message_id` branch from `shouldSkipDispatchedRecipient` (revert step 1)
// → the 'queued'+provider_id row is NO LONGER skipped → the mock adapter is called a
// SECOND time for a recipient already texted → the behavioral test AND the
// `queued+id → true` guard-matrix assertion both FAIL. Removing provider_message_id
// from the SELECT, or discarding the sent-UPDATE error, fails the source-contract
// tests below.

import { assert, assertEquals } from "jsr:@std/assert@1";
import { shouldSkipDispatchedRecipient } from "./index.ts";

const t = (name: string, fn: () => void) =>
  Deno.test({ name, sanitizeResources: false, sanitizeOps: false, fn });

const SRC = await Deno.readTextFile("supabase/functions/marketing-send/index.ts");

// ── Guard unit matrix (the REAL shipped helper) ────────────────────────────────

t("fresh recipient (null row) → NOT skipped (must be processed)", () => {
  assertEquals(shouldSkipDispatchedRecipient(null), false);
});

t("terminal 'sent' row → skipped", () => {
  assertEquals(shouldSkipDispatchedRecipient({ status: "sent" }), true);
});

t("terminal 'failed' row → skipped", () => {
  assertEquals(shouldSkipDispatchedRecipient({ status: "failed" }), true);
});

t("retryable 'deferred' row (no provider id) → NOT skipped (must re-attempt in-window)", () => {
  assertEquals(
    shouldSkipDispatchedRecipient({ status: "deferred", provider_message_id: null }),
    false,
  );
});

t("retryable 'queued' row (no provider id) → NOT skipped (genuinely fresh in-flight)", () => {
  assertEquals(
    shouldSkipDispatchedRecipient({ status: "queued", provider_message_id: null }),
    false,
  );
});

t("F-DS-1: 'queued' row WITH provider_message_id (lost terminal write) → SKIPPED", () => {
  // The exact fault-path state: adapter.send() SUCCEEDED on a prior pass (a
  // provider_message_id was returned/persisted) but the status→'sent' write was
  // lost, leaving a non-terminal 'queued' row. A non-null provider id proves the
  // recipient already reached Twilio — it MUST be skipped now, never re-texted.
  assertEquals(
    shouldSkipDispatchedRecipient({
      status: "queued",
      provider_message_id: "SM_already_dispatched_pass1",
    }),
    true,
  );
});

t("F-DS-1: 'deferred' row WITH provider_message_id → SKIPPED (dispatched trumps status)", () => {
  assertEquals(
    shouldSkipDispatchedRecipient({ status: "deferred", provider_message_id: "SMxyz" }),
    true,
  );
});

// ── Behavioral two-pass reproduction (mock DB + mock adapter, REAL guard) ───────

t("cron re-pick after a LOST terminal update never re-texts an already-dispatched recipient", () => {
  const campaign = "camp-fds1";
  // DB keyed by the uq_mkt_msg_campaign_phone identity (campaign|phone).
  const store = new Map<string, { status: string; provider_message_id: string | null }>();
  const adapterCalls = new Map<string, number>();

  // Recipient A: a PRIOR pass dispatched to Twilio (provider id persisted) but the
  // terminal status→'sent' write was LOST → row stranded at non-terminal 'queued'.
  store.set(`${campaign}|+12125550000`, {
    status: "queued",
    provider_message_id: "SM_A_dispatched_pass1",
  });
  // Recipient B: never processed (fresh — no row yet).
  const audience = ["+12125550000", "+14155550000"];

  // Faithful loop shape: the skip decision is the REAL shipped guard; a NON-skipped
  // recipient is dispatched via the (mock) adapter and recorded 'sent'.
  function runPass() {
    for (const phone of audience) {
      const existing = store.get(`${campaign}|${phone}`) ?? null;
      if (shouldSkipDispatchedRecipient(existing)) continue;
      adapterCalls.set(phone, (adapterCalls.get(phone) ?? 0) + 1); // mock provider send
      store.set(`${campaign}|${phone}`, {
        status: "sent",
        provider_message_id: `SM_${phone}_new`,
      });
    }
  }

  runPass();

  // A was ALREADY dispatched (provider id present) → guard skips it → the adapter is
  // NOT called a second time. This is the F-DS-1 double-send fix.
  assertEquals(adapterCalls.has("+12125550000"), false, "A must NOT be re-dispatched");
  // Its lost-update orphan row is left untouched by this pass (not overwritten).
  assertEquals(
    store.get(`${campaign}|+12125550000`)?.provider_message_id,
    "SM_A_dispatched_pass1",
  );
  // B was genuinely fresh → dispatched exactly once.
  assertEquals(adapterCalls.get("+14155550000"), 1, "B (fresh) must be dispatched once");

  // A redundant re-pick: still zero new calls for either (both now dispatched/sent).
  runPass();
  assertEquals(adapterCalls.has("+12125550000"), false, "still never a second text to A");
  assertEquals(adapterCalls.get("+14155550000"), 1, "B not re-sent either");

  // Exactly one row per distinct recipient (the uq_mkt_msg_campaign_phone identity).
  assertEquals(store.size, 2);
});

// ── Source-contract teeth for the DB-coupled halves (step 1 select + step 2 write) ─

function srcHas(re: RegExp, why: string) {
  assert(re.test(SRC), `marketing-send/index.ts must match ${re} (${why})`);
}

t("step 1: the existing-row SELECT fetches provider_message_id (anti-revert)", () => {
  srcHas(
    /\.select\(\s*["'][^"']*provider_message_id[^"']*["']\s*\)[\s\S]*?\.eq\(\s*["']recipient_phone["']/,
    "the (campaign, phone) SELECT must include provider_message_id so the guard sees a dispatched-but-non-terminal row",
  );
});

t("step 1: the send loop skips via the shared dispatched-recipient guard (anti-revert)", () => {
  srcHas(
    /if\s*\(\s*shouldSkipDispatchedRecipient\(\s*existing\s*\)\s*\)\s*\{\s*continue;/,
    "the send loop must skip already-terminal-OR-dispatched recipients via shouldSkipDispatchedRecipient(existing)",
  );
  // And the guard itself must OR-in the provider_message_id check (the actual fix).
  srcHas(
    /export function shouldSkipDispatchedRecipient[\s\S]*?provider_message_id\s*!==\s*null/,
    "shouldSkipDispatchedRecipient must skip rows with a non-null provider_message_id",
  );
});

t("step 2: the post-send terminal 'sent' UPDATE is error-checked + throws on a lost write (anti-revert)", () => {
  // The lost-update fix: the sent-branch update must CAPTURE { error } (was
  // previously discarded) and THROW rather than fall through to `delivered += 1`.
  srcHas(
    /error:\s*sentErr\b/,
    "the sent-branch UPDATE must capture its error (was previously discarded)",
  );
  srcHas(
    /throw new Error\(\s*[`'"]sms_sent_terminal_update_lost/,
    "a lost terminal 'sent' write must THROW (loud) so the campaign is not re-picked — never silently leave a re-sendable orphan",
  );
});
