// ORCH-1203 GAP-C1 — ADVERSARIAL source-contract guard. Independent of the
// implementor's happy-path tests (orch_1203_rsvp_qr_backfill.test.ts +
// _shared/__tests__/orch_1203_rsvp_qr_c1_ops_alert.test.ts). The happy-path tests
// assert the *presence* of the expected wiring; THIS file attacks the *negative
// space* — the ways a future edit could silently re-break the fail-closed
// guarantee while leaving the happy-path assertions still green:
//
//   • happy-path proves `biz_rsvp_mint_qr(` exists + the OLD inline mint string is
//     gone. ADVERSARIAL proves the THREE signing primitives (gen_random_bytes /
//     biz_ticket_checkout_token_hash / biz_rsvp_qr_payload) appear ONLY inside the
//     shared routine body and NOWHERE in either RPC body — so no *new* second QR
//     format can drift in even with different variable names (I-4, single-owner).
//   • happy-path proves the two key strings exist. ADVERSARIAL proves the inline
//     and backfill keyspaces are PROVABLY DISJOINT and that EVERY enqueue is
//     guarded by ON CONFLICT DO NOTHING (count match), so re-runs/concurrent runs
//     cannot double-send and a prior passless attempt cannot suppress (I-3).
//   • happy-path proves the going+NULL-qr scope is present. ADVERSARIAL proves the
//     forbidden scopes are ABSENT (no 'maybe'/'not_going' in backfill WHERE, no
//     re-mint of qr_code IS NOT NULL rows) (scope guards).
//   • happy-path proves the alert+RPC ordering. ADVERSARIAL proves the RPC call is
//     STRUCTURALLY OUTSIDE the pepper try/catch (not gated by pepper) and the
//     alert is STRUCTURALLY INSIDE its own nested try/catch (I-1 non-blocking).
//   • ADVERSARIAL adds migration-safety: COMMIT strictly precedes every
//     GRANT/REVOKE/cron, prefix is unique, and submit_event_rsvp is CREATE OR
//     REPLACE with NO DROP (a DROP would drop dependent grants).
//
// `// [FAILS-ON-REVERT KEY]` marks the load-bearing assertions. CI has no live
// Postgres; the orchestrator runs the behavioral verification post-merge.
//
// Run: deno test --allow-read --allow-env
import { assert, assertEquals } from "jsr:@std/assert@1";

const MIG = "supabase/migrations/20261122000000_orch_1203_rsvp_qr_backfill.sql";
const SUBMIT_FN = "supabase/functions/public-submit-rsvp/index.ts";
const BACKFILL_FN = "supabase/functions/backfill-rsvp-qr-codes/index.ts";

const rawSql = await Deno.readTextFile(MIG);
const submitSrc = await Deno.readTextFile(SUBMIT_FN);

// Strip `--` line comments so the I-4 single-owner counts reason about REAL SQL,
// not documentation. (A comment that mentions gen_random_bytes / a helper name
// cannot introduce a second QR format — only executable SQL can.) We blank the
// comment tail rather than delete the line so byte offsets / line structure used
// by the ordering asserts stay stable.
const sql = rawSql
  .split("\n")
  .map((line) => {
    const i = line.indexOf("--");
    return i === -1 ? line : line.slice(0, i);
  })
  .join("\n");

// Count helper — how many times a substring occurs.
const count = (hay: string, needle: string): number => {
  if (needle.length === 0) return 0;
  let n = 0;
  let i = hay.indexOf(needle);
  while (i !== -1) {
    n += 1;
    i = hay.indexOf(needle, i + needle.length);
  }
  return n;
};

// ─────────────────────────────────────────────────────────────────────────────
// Slice the SQL into the three function bodies so we can reason about WHERE each
// signing primitive appears (not just whether it appears anywhere in the file).
// ─────────────────────────────────────────────────────────────────────────────
const mintStart = sql.indexOf("CREATE OR REPLACE FUNCTION public.biz_rsvp_mint_qr(");
const submitStart = sql.indexOf("CREATE OR REPLACE FUNCTION public.submit_event_rsvp(");
const backfillStart = sql.indexOf(
  "CREATE OR REPLACE FUNCTION public.backfill_going_rsvp_qr_codes(",
);
const commitIdx = sql.indexOf("\nCOMMIT;");

assert(mintStart !== -1, "shared mint routine must exist");
assert(submitStart !== -1, "submit_event_rsvp must be redefined");
assert(backfillStart !== -1, "backfill function must exist");
assert(commitIdx !== -1, "migration must COMMIT the function defs");
// The three CREATEs appear in this order: mint < submit < backfill < COMMIT.
assert(
  mintStart < submitStart && submitStart < backfillStart &&
    backfillStart < commitIdx,
  "function order: biz_rsvp_mint_qr → submit_event_rsvp → backfill → COMMIT",
);

const mintBody = sql.slice(mintStart, submitStart);
const submitBody = sql.slice(submitStart, backfillStart);
const backfillBody = sql.slice(backfillStart, commitIdx);

// ─────────────────────────────────────────────────────────────────────────────
// ANGLE 1 — I-4 is a REAL single-owner: the signing primitives live ONLY in the
// shared routine. A future inline re-mint (even renamed vars) would re-introduce
// one of these three primitives into a RPC body → RED here, green on happy-path.
// ─────────────────────────────────────────────────────────────────────────────
Deno.test("ADV/I-4 — gen_random_bytes appears ONLY in the shared mint body", () => {
  // [FAILS-ON-REVERT KEY]
  assertEquals(
    count(mintBody, "gen_random_bytes"),
    1,
    "the token entropy source is minted exactly once, in the shared routine",
  );
  assertEquals(
    count(submitBody, "gen_random_bytes"),
    0,
    "submit_event_rsvp must NOT mint inline (no second QR format)",
  );
  assertEquals(
    count(backfillBody, "gen_random_bytes"),
    0,
    "backfill must NOT mint inline (no second QR format)",
  );
});

Deno.test("ADV/I-4 — biz_ticket_checkout_token_hash is composed ONLY in the shared mint", () => {
  // [FAILS-ON-REVERT KEY]
  // The token-hash helper is invoked once (the mint). It is also NAMED in the
  // pepper-assert helper reference inside backfill — so we assert it is never
  // *called as a hash-of-a-fresh-token* outside the mint by checking the call
  // shape (`biz_ticket_checkout_token_hash(v_token`).
  assertEquals(
    count(sql, "public.biz_ticket_checkout_token_hash(v_token"),
    1,
    "exactly ONE fresh-token hash composition — in biz_rsvp_mint_qr",
  );
  assert(
    mintBody.includes("public.biz_ticket_checkout_token_hash(v_token"),
    "that single composition lives in the shared routine",
  );
  assertEquals(
    count(submitBody, "biz_ticket_checkout_token_hash(v_token"),
    0,
    "submit no longer hashes a fresh token inline",
  );
  assertEquals(
    count(backfillBody, "biz_ticket_checkout_token_hash(v_token"),
    0,
    "backfill no longer hashes a fresh token inline",
  );
});

Deno.test("ADV/I-4 — biz_rsvp_qr_payload is composed ONLY in the shared mint", () => {
  // [FAILS-ON-REVERT KEY]
  assertEquals(
    count(mintBody, "biz_rsvp_qr_payload"),
    1,
    "the qr payload is built exactly once — in the shared routine",
  );
  assertEquals(
    count(submitBody, "biz_rsvp_qr_payload"),
    0,
    "submit_event_rsvp must NOT build a qr payload inline",
  );
  assertEquals(
    count(backfillBody, "biz_rsvp_qr_payload"),
    0,
    "backfill must NOT build a qr payload inline",
  );
});

Deno.test("ADV/I-4 — BOTH RPCs reach the QR via biz_rsvp_mint_qr and nothing else", () => {
  // [FAILS-ON-REVERT KEY]
  // submit calls the shared routine twice (guest + primary); backfill twice
  // (primary loop + guest loop). Four call sites total, all `biz_rsvp_mint_qr(`.
  assertEquals(
    count(submitBody, "public.biz_rsvp_mint_qr("),
    2,
    "submit mints guest + primary via the shared routine (2 call sites)",
  );
  assertEquals(
    count(backfillBody, "public.biz_rsvp_mint_qr("),
    2,
    "backfill mints primary + guest via the shared routine (2 call sites)",
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// ANGLE 3 — I-3 double-send / key isolation. Prove keyspaces are PROVABLY
// disjoint and EVERY enqueue is ON CONFLICT DO NOTHING (count parity).
// ─────────────────────────────────────────────────────────────────────────────
Deno.test("ADV/I-3 — inline vs backfill keyspaces are PROVABLY disjoint", () => {
  // The inline dispatcher (in public-submit-rsvp) uses `rsvp_pass:${rsvpId}:...`.
  // The backfill uses `rsvp_pass_qr:<id>`. These share the `rsvp_pass` stem but
  // the backfill prefix has the `_qr:` infix the inline key can NEVER produce —
  // because the inline key's char after `rsvp_pass` is always `:` (a colon),
  // never `_`. Prove that structurally.
  const inlineKey = "`rsvp_pass:${rsvpId}:${r.guestId ?? \"primary\"}`";
  // [FAILS-ON-REVERT KEY]
  assert(
    submitSrc.includes(inlineKey),
    "inline dispatcher key is rsvp_pass:<rsvpId>:<guestId|primary> (colon infix)",
  );
  // The inline key literally starts `rsvp_pass:` (colon), the backfill `rsvp_pass_qr:`
  // (underscore). A string starting with `rsvp_pass_qr:` cannot start with
  // `rsvp_pass:` because position 9 differs (`_` vs `:`). Pin both literals.
  assert(
    sql.includes("'rsvp_pass_qr:' || v_rec.rsvp_id::text") &&
      sql.includes("'rsvp_pass_qr:' || v_rec.guest_id::text"),
    "backfill keys carry the _qr: infix",
  );
  assertEquals(
    count(sql, "'rsvp_pass:'"),
    0,
    "the migration never enqueues a bare inline `rsvp_pass:` key — it is the QR keyspace owner",
  );
});

Deno.test("ADV/I-3 — every backfill enqueue is guarded by ON CONFLICT DO NOTHING", () => {
  const inserts = count(backfillBody, "INSERT INTO public.rsvp_notifications");
  const guards = count(backfillBody, "ON CONFLICT (idempotency_key) DO NOTHING");
  // [FAILS-ON-REVERT KEY]
  assertEquals(inserts, 2, "exactly two enqueues: primary + guest");
  assertEquals(
    guards,
    inserts,
    "EVERY enqueue is idempotent — no unguarded INSERT can double-send on re-run",
  );
  // The QR is the load-bearing field of the enqueued pass (handleRsvpPass gates
  // the email on qrCode!==null) — prove the minted qr is written, not a literal NULL.
  assertEquals(
    count(backfillBody, "'qrCode',         v_qr"),
    2,
    "both passes carry the freshly-minted qr (never a null qrCode that would skip email)",
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// ANGLE 4 — scope guards: forbidden scopes are ABSENT from the backfill WHERE.
// ─────────────────────────────────────────────────────────────────────────────
Deno.test("ADV/scope — backfill NEVER touches maybe / not_going / waitlisted rows", () => {
  // [FAILS-ON-REVERT KEY]
  for (const forbidden of ["'maybe'", "'not_going'", "'waitlisted'"]) {
    assertEquals(
      count(backfillBody, forbidden),
      0,
      `backfill must not reference ${forbidden} (going-only scope)`,
    );
  }
  // The only rsvp_status comparison in the backfill is = 'going'.
  assertEquals(
    count(backfillBody, "rsvp_status = 'going'"),
    2,
    "both loops filter rsvp_status = 'going' (primary + guest parent)",
  );
});

Deno.test("ADV/scope — backfill re-mints ONLY NULL-qr rows (never overwrites an existing qr)", () => {
  // [FAILS-ON-REVERT KEY]
  // It must filter on qr_code IS NULL for both the primary (r.qr_code) and guest
  // (g.qr_code) loop, and must NEVER select `qr_code IS NOT NULL` to re-mint.
  assert(
    backfillBody.includes("r.qr_code IS NULL") &&
      backfillBody.includes("g.qr_code IS NULL"),
    "both loops are scoped to NULL-qr rows (idempotent, no overwrite)",
  );
  assertEquals(
    count(backfillBody, "qr_code IS NOT NULL"),
    0,
    "backfill must never re-mint a row that already has a qr",
  );
});

Deno.test("ADV/scope — pepper-absent path returns 0 WITHOUT raising (cron-safe)", () => {
  // The assert is wrapped so a thrown pepper assertion becomes a no-op return 0,
  // never an unhandled EXCEPTION that would error the cron tick.
  const assertIdx = backfillBody.indexOf(
    "biz_ticket_checkout_assert_qr_pepper(p_qr_token_pepper)",
  );
  assert(assertIdx !== -1, "backfill asserts the pepper");
  const swallowIdx = backfillBody.indexOf("EXCEPTION WHEN OTHERS THEN", assertIdx);
  const nullReturnIdx = backfillBody.indexOf("RETURN 0;");
  // [FAILS-ON-REVERT KEY]
  assert(
    swallowIdx !== -1 && swallowIdx > assertIdx,
    "the pepper assert RAISE is swallowed (WHEN OTHERS), not propagated",
  );
  assert(
    nullReturnIdx !== -1 && backfillBody.includes("IF v_pepper IS NULL THEN"),
    "absent pepper → RETURN 0 (no-op), proven before any mint loop",
  );
  // No bare RAISE in the backfill body (other than inside the swallowed block) —
  // the function must never throw to its caller.
  assertEquals(
    count(backfillBody, "RAISE EXCEPTION"),
    0,
    "backfill never RAISEs to its caller — the cron tick can't error on misconfig",
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// ANGLE 2 — I-1 non-blocking, STRUCTURAL. The RPC call must be OUTSIDE the pepper
// try/catch (not gated by pepper), and the alert INSIDE its own nested try/catch.
// ─────────────────────────────────────────────────────────────────────────────
Deno.test("ADV/I-1 — the RSVP RPC call is OUTSIDE the pepper try/catch (never gated by pepper)", () => {
  const pepperTryIdx = submitSrc.indexOf("qrPepper = qrTokenPepper();");
  assert(pepperTryIdx !== -1, "the pepper resolve must exist");
  // The catch block that handles a missing pepper closes before the RPC. The RPC
  // call must come AFTER that catch's closing — i.e. the RPC is not nested in the
  // pepper try. We locate the missing-pepper catch's trailing comment, then the RPC.
  const catchCloseMarker =
    "[public-submit-rsvp] ops alert for missing pepper failed (non-fatal)";
  const catchCloseIdx = submitSrc.indexOf(catchCloseMarker);
  const rpcIdx = submitSrc.indexOf(
    'const { data, error } = await admin.rpc("submit_event_rsvp"',
  );
  assert(catchCloseIdx !== -1, "the swallow-log of the alert failure must exist");
  // [FAILS-ON-REVERT KEY]
  assert(
    rpcIdx !== -1 && rpcIdx > catchCloseIdx,
    "submit_event_rsvp RPC is invoked AFTER the pepper catch closes — write proceeds regardless of pepper",
  );
  // And the RPC is passed qrPepper (which may be null) — never gated behind a
  // `if (qrPepper)` guard.
  const head = submitSrc.slice(0, rpcIdx);
  assertEquals(
    count(head, "if (qrPepper"),
    0,
    "the RPC call is never gated behind an `if (qrPepper)` (I-1 fail-open)",
  );
  assert(
    submitSrc.includes("p_qr_token_pepper: qrPepper,"),
    "the (possibly-null) pepper is passed straight through to the RPC",
  );
});

Deno.test("ADV/I-1 — the ops alert sits in a NESTED try/catch that swallows its own failure", () => {
  // The alert must be reachable only after a pepper-resolve failure AND be wrapped
  // in an inner try whose catch is `} catch (alertErr) {`. Prove the inner try
  // opens AFTER the outer pepper catch opens and the inner catch swallows alertErr.
  const outerCatchIdx = submitSrc.indexOf(
    '} catch (err) {\n    console.error(\n      "[public-submit-rsvp] qr_token_pepper unavailable',
  );
  assert(outerCatchIdx !== -1, "outer missing-pepper catch must exist");
  const alertIdx = submitSrc.indexOf("await sendOpsAlertEmail({", outerCatchIdx);
  const innerCatchIdx = submitSrc.indexOf("} catch (alertErr) {", alertIdx);
  // The inner try opening must be between the outer catch and the alert call.
  const innerTryIdx = submitSrc.lastIndexOf("try {", alertIdx);
  // [FAILS-ON-REVERT KEY]
  assert(
    alertIdx !== -1 && innerCatchIdx !== -1,
    "alert exists and is followed by a `catch (alertErr)`",
  );
  assert(
    innerTryIdx > outerCatchIdx && innerTryIdx < alertIdx,
    "the alert's enclosing try opens inside the pepper catch, before the alert",
  );
  assert(
    innerCatchIdx > alertIdx,
    "the alertErr catch closes the alert's own try — a send failure can't escape",
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// ANGLE 5 — migration safety: COMMIT precedes all grants/cron; unique prefix; no
// DROP of submit_event_rsvp (a DROP would drop dependent grants).
// ─────────────────────────────────────────────────────────────────────────────
Deno.test("ADV/migration — COMMIT strictly precedes every GRANT / REVOKE / cron.schedule", () => {
  const firstRevoke = sql.indexOf("REVOKE EXECUTE ON FUNCTION");
  const firstGrant = sql.indexOf("GRANT  EXECUTE ON FUNCTION");
  const cronSchedule = sql.indexOf("SELECT cron.schedule(");
  // [FAILS-ON-REVERT KEY]
  assert(commitIdx !== -1, "migration must COMMIT");
  assert(
    firstRevoke > commitIdx && firstGrant > commitIdx && cronSchedule > commitIdx,
    "GRANT/REVOKE/cron all come AFTER COMMIT (DDL-txn isolation convention)",
  );
});

Deno.test("ADV/migration — submit_event_rsvp is CREATE OR REPLACE with NO DROP (grants preserved)", () => {
  // A DROP FUNCTION submit_event_rsvp would cascade-drop its existing grants; the
  // refactor must be an in-place CREATE OR REPLACE only.
  // [FAILS-ON-REVERT KEY]
  assertEquals(
    count(sql, "DROP FUNCTION public.submit_event_rsvp"),
    0,
    "submit_event_rsvp must be replaced in place, never dropped",
  );
  assert(
    sql.includes("CREATE OR REPLACE FUNCTION public.submit_event_rsvp("),
    "submit_event_rsvp is redefined via CREATE OR REPLACE",
  );
  // No DROP of the shared mint or backfill either.
  assertEquals(
    count(sql, "DROP FUNCTION public.biz_rsvp_mint_qr"),
    0,
    "the shared mint is never dropped",
  );
});

Deno.test("ADV/migration — single unique version prefix 20261122000000", async () => {
  const entries: string[] = [];
  for await (const e of Deno.readDir("supabase/migrations")) {
    if (e.isFile && e.name.startsWith("20261122000000")) entries.push(e.name);
  }
  // [FAILS-ON-REVERT KEY]
  assertEquals(
    entries.length,
    1,
    `exactly one migration with prefix 20261122000000 (found: ${entries.join(", ")})`,
  );
  assertEquals(entries[0], "20261122000000_orch_1203_rsvp_qr_backfill.sql");
});

// ─────────────────────────────────────────────────────────────────────────────
// ANGLE 3b — edge fn drain isolation: the drainer filters ONLY the QR keyspace
// AND only pending rows, so it can never replay/resend an inline pass.
// ─────────────────────────────────────────────────────────────────────────────
Deno.test("ADV/I-3 — drainer is isolated to pending rsvp_pass rows only", async () => {
  const fn = await Deno.readTextFile(BACKFILL_FN);
  // ORCH-1206 (I-3) SUPERSEDES the old two-keyspace split: submit / approve /
  // backfill now share the SINGLE canonical `rsvp_pass:` keyspace, so the drain
  // selects ALL still-pending rsvp_pass rows (template_key + status). The
  // status='pending' guard + rsvp-notify's own already-sent short-circuit keep
  // it from re-invoking a delivered pass.
  // [FAILS-ON-REVERT KEY]
  assert(
    fn.includes('.eq("template_key", "rsvp_pass")'),
    "drain query is scoped to rsvp_pass rows (canonical keyspace, ORCH-1206)",
  );
  assert(
    fn.includes('.eq("status", "pending")'),
    "drain only touches still-pending rows (already-sent rows are skipped)",
  );
  // The retired `rsvp_pass_qr:` keyspace must no longer be referenced.
  assertEquals(
    count(fn, "rsvp_pass_qr:"),
    0,
    "the retired rsvp_pass_qr: keyspace is gone (one keyspace, I-3)",
  );
});
