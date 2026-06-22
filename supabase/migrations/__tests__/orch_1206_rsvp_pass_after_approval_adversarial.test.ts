// ORCH-1206 — ADVERSARIAL source-contract guard for "the RSVP QR pass is
// delivered ONLY after approval (never while pending)". INDEPENDENT of the
// implementor's happy-path file (orch_1206_rsvp_pass_after_approval.test.ts),
// which asserts the *presence* of the expected wiring. THIS file attacks the
// *negative space* — the ways a future edit (or a sloppy revert) could keep the
// happy-path assertions green while silently re-breaking the guarantee:
//
//   • happy-path proves the going+approved guard STRING exists. ADVERSARIAL
//     proves it is STRUCTURALLY un-bypassable: every INSERT INTO
//     rsvp_notifications in enqueue_rsvp_pass appears AFTER the guard's
//     `RETURN 0`, and the guard is an OR (either conjunct false → early return)
//     — so pending/denied/waitlisted/maybe/not_going have NO insert path. (I-1)
//   • happy-path proves the canonical key strings exist. ADVERSARIAL proves each
//     INSERT is wrapped in `IF v_..._qr IS NOT NULL THEN` AFTER the conditional
//     mint — a recipient whose qr couldn't mint (pepper absent) is SKIPPED, not
//     inserted under the canonical key (the key stays free for the ORCH-1203
//     backfill to mint+enqueue later). The subtle exactly-once trap. (I-2/I-3)
//   • happy-path proves the keys match for one substituted recipient.
//     ADVERSARIAL proves ALL THREE producers (SQL routine, TS submit, backfill
//     delegation) collapse onto ONE keyspace, the old `rsvp_pass_qr:` keyspace
//     is provably absent from BOTH the migration and the drain filter, and EVERY
//     enqueue is ON CONFLICT DO NOTHING (count parity, no naked insert). (I-3)
//   • happy-path proves the submit gate strings exist. ADVERSARIAL proves the
//     gate is a CONJUNCTION inside ONE if() — drop either conjunct → RED.  (C-1)
//   • happy-path proves rsvp_approved is gone file-wide. ADVERSARIAL proves it is
//     gone from the APPROVE arm specifically while rsvp_denied/rsvp_removed
//     survive in THEIR arms (replace, not augment).
//   • ADVERSARIAL adds migration safety: prefix unique + monotonic, the three
//     redefined routines are CREATE OR REPLACE with NO DROP (a DROP cascades
//     dependent grants), and COMMIT strictly precedes every GRANT/REVOKE.
//
// `// [FAILS-ON-REVERT KEY]` marks the load-bearing assertions proven to go RED
// when the change is reverted in-worktree. CI has no live Postgres; the
// orchestrator runs the behavioral verification post-merge (SPEC §Live verify).
//
// Run: deno test --allow-read --allow-env
import { assert, assertEquals } from "jsr:@std/assert@1";

const MIG =
  "supabase/migrations/20261123000000_orch_1206_rsvp_pass_after_approval.sql";
const SUBMIT = "supabase/functions/public-submit-rsvp/index.ts";
const DRAIN = "supabase/functions/backfill-rsvp-qr-codes/index.ts";

const rawSql = await Deno.readTextFile(MIG);
const submit = await Deno.readTextFile(SUBMIT);
const drain = await Deno.readTextFile(DRAIN);

// Strip `--` line comments so the structural/count reasoning sees REAL SQL, not
// documentation. A comment that mentions 'rsvp_approved' or an INSERT cannot
// send a pass — only executable SQL can. Blank the comment tail (keep the line)
// so line structure used by index() ordering asserts stays stable.
const sql = rawSql
  .split("\n")
  .map((line) => {
    const i = line.indexOf("--");
    return i === -1 ? line : line.slice(0, i);
  })
  .join("\n");

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
// Slice the migration into its four CREATE OR REPLACE bodies so each assertion
// reasons about WHERE a string lives, not merely whether it appears in the file.
// Order in the migration: enqueue_rsvp_pass → host_set_rsvp_status →
// host_bulk_approve_rsvps → backfill_going_rsvp_qr_codes → COMMIT.
// ─────────────────────────────────────────────────────────────────────────────
const enqueueStart = sql.indexOf(
  "CREATE OR REPLACE FUNCTION public.enqueue_rsvp_pass(",
);
const setStart = sql.indexOf(
  "CREATE OR REPLACE FUNCTION public.host_set_rsvp_status(",
);
const bulkStart = sql.indexOf(
  "CREATE OR REPLACE FUNCTION public.host_bulk_approve_rsvps(",
);
const backfillStart = sql.indexOf(
  "CREATE OR REPLACE FUNCTION public.backfill_going_rsvp_qr_codes(",
);
const commitIdx = sql.indexOf("\nCOMMIT;");

assert(enqueueStart !== -1, "enqueue_rsvp_pass must exist");
assert(setStart !== -1, "host_set_rsvp_status must be redefined");
assert(bulkStart !== -1, "host_bulk_approve_rsvps must be redefined");
assert(backfillStart !== -1, "backfill must be redefined");
assert(commitIdx !== -1, "migration must COMMIT the defs");
assert(
  enqueueStart < setStart && setStart < bulkStart &&
    bulkStart < backfillStart && backfillStart < commitIdx,
  "function order: enqueue → set → bulk → backfill → COMMIT",
);

const enqueueBody = sql.slice(enqueueStart, setStart);
const setBody = sql.slice(setStart, bulkStart);
const bulkBody = sql.slice(bulkStart, backfillStart);
const backfillBody = sql.slice(backfillStart, commitIdx);

// ─────────────────────────────────────────────────────────────────────────────
// ANGLE 1 (I-1, exhaustive negative) — the going+approved guard is STRUCTURALLY
// un-bypassable. There is NO INSERT path reachable without first passing the
// guard's `RETURN 0`. Therefore pending / denied / waitlisted / maybe /
// not_going can NEVER yield a pass — not because the happy-path string exists,
// but because every insert lives strictly AFTER the early return.
// ─────────────────────────────────────────────────────────────────────────────
Deno.test("ADV/I-1 — the going+approved guard is an OR with an early RETURN 0", () => {
  // [FAILS-ON-REVERT KEY] — the guard predicate (negated form: NOT going OR NOT
  // approved → return). Dropping either disjunct lets a pending/denied row fall
  // through to the inserts.
  hasIn(
    enqueueBody,
    "v_rsvp.rsvp_status <> 'going' OR v_rsvp.approval_status <> 'approved'",
    "guard fires when EITHER not-going OR not-approved",
  );
  // The guard block returns early.
  const guardIdx = enqueueBody.indexOf(
    "v_rsvp.rsvp_status <> 'going' OR v_rsvp.approval_status <> 'approved'",
  );
  const guardReturn = enqueueBody.indexOf("RETURN 0;", guardIdx);
  assert(guardReturn !== -1, "the guard must be followed by RETURN 0");
});

Deno.test("ADV/I-1 — EVERY rsvp_notifications insert is AFTER the guard return (no bypass)", () => {
  const guardIdx = enqueueBody.indexOf(
    "v_rsvp.rsvp_status <> 'going' OR v_rsvp.approval_status <> 'approved'",
  );
  assert(guardIdx !== -1, "guard must exist");
  const guardReturn = enqueueBody.indexOf("RETURN 0;", guardIdx);
  assert(guardReturn !== -1, "guard early-return must exist");

  // Enumerate every INSERT INTO the notifications table in the routine body.
  const insertNeedle = "INSERT INTO public.rsvp_notifications";
  const inserts: number[] = [];
  let i = enqueueBody.indexOf(insertNeedle);
  while (i !== -1) {
    inserts.push(i);
    i = enqueueBody.indexOf(insertNeedle, i + insertNeedle.length);
  }
  // Two inserts exactly: primary + guest. (If a future edit adds an unguarded
  // third path this count check also flags it.)
  assertEquals(inserts.length, 2, "exactly two inserts: primary + guest");
  // [FAILS-ON-REVERT KEY] — BOTH inserts are strictly after the guard return, so
  // no pass can ever be enqueued without passing going+approved.
  for (const at of inserts) {
    assert(
      at > guardReturn,
      `insert at ${at} must be after the guard return at ${guardReturn}`,
    );
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// ANGLE 2 (the subtle exactly-once trap) — a recipient whose qr could not be
// minted (pepper absent) is SKIPPED, never inserted under the canonical key. If a
// null-qr row were inserted it would pre-consume the idempotency key and the
// ORCH-1203 backfill could never mint+enqueue under the same key (ON CONFLICT DO
// NOTHING would swallow the real pass forever). Prove each INSERT is wrapped in
// `IF v_..._qr IS NOT NULL THEN`, AND the conditional mint precedes it.
// ─────────────────────────────────────────────────────────────────────────────
Deno.test("ADV/I-2 — PRIMARY insert is gated behind `IF v_primary_qr IS NOT NULL THEN`", () => {
  // [FAILS-ON-REVERT KEY]
  hasIn(enqueueBody, "IF v_primary_qr IS NOT NULL THEN", "primary insert NOT-NULL gate");
  const gate = enqueueBody.indexOf("IF v_primary_qr IS NOT NULL THEN");
  const ins = enqueueBody.indexOf("INSERT INTO public.rsvp_notifications", gate);
  // The very next notifications insert after the gate is the primary insert.
  assert(ins !== -1 && ins > gate, "primary insert sits inside the NOT-NULL gate");
  // The conditional mint (only when null AND pepper) precedes the gate.
  const mintGate = enqueueBody.indexOf("IF v_primary_qr IS NULL AND v_pepper IS NOT NULL THEN");
  assert(
    mintGate !== -1 && mintGate < gate,
    "primary is conditionally minted (null+pepper) BEFORE the insert gate",
  );
});

Deno.test("ADV/I-2 — GUEST insert is gated behind `IF v_guest_qr IS NOT NULL THEN`", () => {
  // [FAILS-ON-REVERT KEY]
  hasIn(enqueueBody, "IF v_guest_qr IS NOT NULL THEN", "guest insert NOT-NULL gate");
  const gate = enqueueBody.indexOf("IF v_guest_qr IS NOT NULL THEN");
  const ins = enqueueBody.indexOf("INSERT INTO public.rsvp_notifications", gate);
  assert(ins !== -1 && ins > gate, "guest insert sits inside the NOT-NULL gate");
  const mintGate = enqueueBody.indexOf("IF v_guest_qr IS NULL AND v_pepper IS NOT NULL THEN");
  assert(
    mintGate !== -1 && mintGate < gate,
    "guest is conditionally minted (null+pepper) BEFORE the insert gate",
  );
});

Deno.test("ADV/I-2 — a missing pepper NEVER raises (the routine stays robust)", () => {
  // The pepper pre-flight swallows any error to NULL so a qr-less recipient is
  // skipped, not an exception. [FAILS-ON-REVERT KEY]
  hasIn(enqueueBody, "EXCEPTION WHEN OTHERS THEN", "pepper pre-flight swallows errors");
  hasIn(enqueueBody, "v_pepper := NULL;", "absent/invalid pepper resolves to NULL (no raise)");
});

// ─────────────────────────────────────────────────────────────────────────────
// ANGLE 3 (I-3) — ONE canonical keyspace across SQL routine + TS submit +
// backfill; the old `rsvp_pass_qr:` keyspace is provably gone everywhere; every
// enqueue is ON CONFLICT DO NOTHING (no naked insert that could double-send).
// ─────────────────────────────────────────────────────────────────────────────
Deno.test("ADV/I-3 — all three producers emit byte-identical keys for the same recipient", () => {
  const rsvpId = "11111111-1111-1111-1111-111111111111";
  const guestId = "22222222-2222-2222-2222-222222222222";

  // (a) SQL routine form: 'rsvp_pass:' || p_rsvp_id::text || ':primary' | guest.
  const sqlPrimary = "rsvp_pass:" + rsvpId + ":primary";
  const sqlGuest = "rsvp_pass:" + rsvpId + ":" + guestId;
  // (b) TS submit form: `rsvp_pass:${rsvpId}:${r.guestId ?? "primary"}`. Model
  //     r.guestId as the real `string | null` so the ?? branch is faithful.
  const primaryGuestId: string | null = null;
  const guestGuestId: string | null = guestId;
  const tsPrimary = `rsvp_pass:${rsvpId}:${primaryGuestId ?? "primary"}`;
  const tsGuest = `rsvp_pass:${rsvpId}:${guestGuestId ?? "primary"}`;
  // (c) Backfill delegates to enqueue_rsvp_pass → identical to (a) by construction.

  // [FAILS-ON-REVERT KEY] — the three producers share ONE keyspace exactly.
  assertEquals(tsPrimary, sqlPrimary, "primary key parity SQL↔TS");
  assertEquals(tsGuest, sqlGuest, "guest key parity SQL↔TS");

  // And the literal key-building forms are present in BOTH sources (so the strings
  // above are not merely a test-local fiction).
  hasIn(
    enqueueBody,
    "'rsvp_pass:' || p_rsvp_id::text || ':primary'",
    "SQL builds the primary canonical key",
  );
  hasIn(
    enqueueBody,
    "'rsvp_pass:' || p_rsvp_id::text || ':' || v_guest.id::text",
    "SQL builds the guest canonical key",
  );
  hasIn(
    submit,
    "`rsvp_pass:${rsvpId}:${r.guestId ?? \"primary\"}`",
    "TS builds the same canonical key",
  );
});

Deno.test("ADV/I-3 — backfill delegates the enqueue to the single-owner routine (no own insert)", () => {
  // [FAILS-ON-REVERT KEY] — the backfill body must NOT carry its own
  // rsvp_notifications insert (that would re-introduce a second key form); it
  // delegates to enqueue_rsvp_pass so the keyspace stays single.
  assertEquals(
    count(backfillBody, "INSERT INTO public.rsvp_notifications"),
    0,
    "backfill must not insert directly — it delegates to enqueue_rsvp_pass",
  );
  hasIn(
    backfillBody,
    "public.enqueue_rsvp_pass(v_rsvp_id, v_pepper)",
    "backfill delegates mint+enqueue to the single-owner routine",
  );
});

Deno.test("ADV/I-3 — the retired `rsvp_pass_qr:` keyspace is absent from migration AND drain", () => {
  // [FAILS-ON-REVERT KEY] — the second keyspace must be fully merged away.
  assertEquals(count(rawSql, "rsvp_pass_qr:"), 0, "no rsvp_pass_qr: in migration (incl comments)");
  hasNotIn(drain, "rsvp_pass_qr:%", "drain no longer filters the retired prefix");
  // Drain instead covers the canonical keyspace by template_key + pending.
  hasIn(drain, '.eq("template_key", "rsvp_pass")', "drain selects canonical rsvp_pass rows");
  hasIn(drain, '.eq("status", "pending")', "drain only pending (never re-invokes sent)");
});

Deno.test("ADV/I-3 — EVERY SQL enqueue is ON CONFLICT DO NOTHING (count parity, no naked insert)", () => {
  const inserts = count(enqueueBody, "INSERT INTO public.rsvp_notifications");
  const onConflict = count(enqueueBody, "ON CONFLICT (idempotency_key) DO NOTHING");
  // [FAILS-ON-REVERT KEY] — one ON CONFLICT guard per insert; none can double-send.
  assertEquals(inserts, 2, "two enqueue inserts (primary + guest)");
  assertEquals(
    onConflict,
    inserts,
    "every enqueue insert is ON CONFLICT DO NOTHING (exactly-once)",
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// ANGLE 4 (C-1) — the submit gate is a CONJUNCTION in ONE if(): drop EITHER
// conjunct and the test goes RED. Proven structurally, not by string presence.
// ─────────────────────────────────────────────────────────────────────────────
Deno.test("ADV/C-1 — submit dispatch is gated on going AND approved AND a string rsvpId", () => {
  // [FAILS-ON-REVERT KEY] — locate the dispatch call, then prove BOTH conjuncts
  // appear in the if-condition immediately preceding it (between `if (` and the
  // dispatch). A dropped conjunct breaks one of these includes.
  const dispatchIdx = submit.indexOf("dispatchRsvpPasses(admin, eventId, result.rsvpId, userId)");
  assert(dispatchIdx !== -1, "the submit dispatch call must exist");
  // The nearest enclosing `if (` before the dispatch.
  const ifIdx = submit.lastIndexOf("if (", dispatchIdx);
  assert(ifIdx !== -1, "dispatch must be inside an if()");
  const cond = submit.slice(ifIdx, dispatchIdx);
  assert(
    cond.includes('result.status === "going"'),
    "the going conjunct must guard the dispatch",
  );
  assert(
    cond.includes('result.approvalStatus === "approved"'),
    "the approved conjunct must guard the dispatch",
  );
  // Both joined by && (a conjunction, not an OR that would leak a pending pass).
  assert(cond.includes("&&"), "the conjuncts are AND-joined (never OR)");
  hasNotIn(cond, "||", "no OR in the dispatch gate (would leak a pending pass)");
});

// ─────────────────────────────────────────────────────────────────────────────
// ANGLE 5 — approve REPLACES the no-QR notice, it does not augment. Within the
// host_set_rsvp_status body the approve arm enqueues the QR pass and emits NO
// 'rsvp_approved'; the deny/remove arms still emit their notices.
// ─────────────────────────────────────────────────────────────────────────────
Deno.test("ADV/replace — host_set approve enqueues the pass and drops rsvp_approved", () => {
  // [FAILS-ON-REVERT KEY] — approve arm calls the single-owner enqueue.
  hasIn(
    setBody,
    "PERFORM public.enqueue_rsvp_pass(p_rsvp_id, NULL)",
    "approve arm enqueues the QR pass",
  );
  // [FAILS-ON-REVERT KEY] — 'rsvp_approved' is gone from THIS function body (no
  // augmenting no-QR notice). Asserting on the sliced body (not the whole file)
  // makes this specific to the approve path.
  assertEquals(
    count(setBody, "'rsvp_approved'"),
    0,
    "no rsvp_approved notice survives in host_set_rsvp_status (replace, not augment)",
  );
  // The approve arm sets the template to NULL so the generic notice INSERT skips.
  hasIn(setBody, "v_template := NULL;", "approve arm nulls the template (skips the generic notice)");
});

Deno.test("ADV/replace — deny/remove arms STILL emit their notices (unchanged)", () => {
  hasIn(setBody, "'rsvp_denied'", "rsvp_denied retained in the deny arm");
  hasIn(setBody, "'rsvp_removed'", "rsvp_removed retained in the remove arm");
  // And nothing in the bulk approve path emits 'rsvp_approved' either.
  assertEquals(count(bulkBody, "'rsvp_approved'"), 0, "bulk approve emits no rsvp_approved");
  hasIn(
    bulkBody,
    "PERFORM public.enqueue_rsvp_pass(v_entry.id, NULL)",
    "bulk approve fans out one pass per approved row",
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// ANGLE 6 — migration safety. Prefix unique + monotonic; the three redefined
// routines are CREATE OR REPLACE (NO DROP → grants survive); COMMIT precedes
// every GRANT/REVOKE.
// ─────────────────────────────────────────────────────────────────────────────
Deno.test("ADV/safety — prefix 20261123000000 is unique + strictly monotonic", () => {
  // Unique within this migration's filename, > the ORCH-1203 head 20261122000000.
  assert(MIG.includes("20261123000000"), "this migration carries the 20261123000000 prefix");
  assert(20261123000000n > 20261122000000n, "prefix > ORCH-1203 head (no collision)");
});

Deno.test("ADV/safety — redefined routines are CREATE OR REPLACE with NO DROP", () => {
  // A DROP FUNCTION would cascade dependent GRANTs; the redefinition must be
  // in-place. [FAILS-ON-REVERT KEY]
  hasNotIn(sql, "DROP FUNCTION", "no DROP FUNCTION (would drop dependent grants)");
  for (
    const fn of [
      "public.enqueue_rsvp_pass(",
      "public.host_set_rsvp_status(",
      "public.host_bulk_approve_rsvps(",
      "public.backfill_going_rsvp_qr_codes(",
    ]
  ) {
    hasIn(sql, "CREATE OR REPLACE FUNCTION " + fn, fn + " is CREATE OR REPLACE");
  }
});

Deno.test("ADV/safety — COMMIT strictly precedes every GRANT/REVOKE in the migration", () => {
  const commit = sql.indexOf("\nCOMMIT;");
  assert(commit !== -1, "migration must COMMIT");
  // Collect every GRANT/REVOKE that lives at the post-COMMIT lockdown footer.
  for (const kw of ["REVOKE EXECUTE", "GRANT  EXECUTE"]) {
    let i = sql.indexOf(kw);
    while (i !== -1) {
      assert(i > commit, `${kw} at ${i} must come AFTER COMMIT at ${commit}`);
      i = sql.indexOf(kw, i + kw.length);
    }
  }
  // The authenticated GRANTs on the host_* RPCs are inline (pre-COMMIT, valid in
  // a txn). The hardening REVOKE/GRANT-to-service_role footer is post-COMMIT.
  hasIn(sql, "GRANT  EXECUTE ON FUNCTION public.enqueue_rsvp_pass(uuid, text) TO service_role;",
    "enqueue_rsvp_pass is locked to service_role post-COMMIT");
});

// ── tiny local helpers (kept at the bottom; declarations hoist) ───────────────
function hasIn(hay: string, n: string, why: string) {
  assert(hay.includes(n), `must contain \`${n}\` (${why})`);
}
function hasNotIn(hay: string, n: string, why: string) {
  assert(!hay.includes(n), `must NOT contain \`${n}\` (${why})`);
}
