// META-ORCH-1062 — TESTER ADVERSARIAL regression (different angle than the
// implementor's happy-path buildScorerInvokeBody unit test).
//
// The implementor's test (meta_orch_1062_approve_scorer_loop.test.ts) only
// asserts the SHAPE of the scorer invoke body. It never exercises the
// runApproveGoLive ORCHESTRATION — the most behaviorally dangerous part of the
// keystone. This test drives runApproveGoLive directly with an injected fake
// admin client and attacks the orchestrator-LOCKED policy decisions:
//
//   Q1 partial-success-stays-live  : ≥1 signal scores ⇒ is_servable NOT rolled back.
//   Q1 total-failure-rollback      : every signal fails ⇒ is_servable rolled back to false
//                                     with bouncer_reason='scoring_failed_on_approve'.
//   Q3 re-bounce-fail off-deck     : bounce fails ⇒ NO servable flip, NO scoring, reason stored.
//   Ordering invariant             : the is_servable=true flip is committed BEFORE the
//                                     first run-signal-scorer invoke (scorer SELECT filters
//                                     is_servable=true; flipping after would score nothing).
//
// fails-on-revert proof for THIS test: see the QA report — reverting the Q1
// rollback block (removing the totalFailure branch) makes the
// "total scorer failure rolls is_servable back to false" assertion FAIL.
//
// Run: deno test --allow-all supabase/functions/admin-review-venue-claim/__tests__/meta_orch_1062_approve_orchestration.adversarial.test.ts

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";

import { runApproveGoLive } from "../index.ts";

const PPID = "pp-adv-1";

// A place_pool row that the REAL _shared/bouncer.ts bounce() PASSES:
// cluster-A restaurant, OPERATIONAL, name+lat+lng, own-domain website, hours,
// Google photos + stored photos. (Matched against the real bouncer rules.)
const PASSING_ROW = {
  id: PPID,
  name: "Lantern & Vine",
  lat: 38.9,
  lng: -77.03,
  types: ["restaurant", "bar"],
  business_status: "OPERATIONAL",
  website: "https://lanternandvine.com",
  opening_hours: { periods: [{ open: { day: 0, time: "1700" } }] },
  photos: [{ name: "g1" }, { name: "g2" }],
  stored_photo_urls: [
    "https://cdn/x1.jpg",
    "https://cdn/x2.jpg",
    "https://cdn/x3.jpg",
    "https://cdn/x4.jpg",
    "https://cdn/x5.jpg",
  ],
  review_count: 120,
  rating: 4.6,
};

// A row the REAL bounce() FAILS (cluster-A, no website + no hours ⇒ B4 + B6).
const FAILING_ROW = {
  ...PASSING_ROW,
  website: null,
  opening_hours: null,
};

interface RecordedUpdate {
  table: string;
  patch: Record<string, unknown>;
  seq: number;
}

interface RecordedInvoke {
  fn: string;
  body: unknown;
  seq: number;
}

/**
 * Fake admin client faithful to the supabase-js surface runApproveGoLive uses:
 *  - .from(table).select(...).eq(...).maybeSingle()  → the place_pool read
 *  - .from(table).update(patch).eq(...)              → servable flip / rollback / reason
 *  - .from('signal_definitions').select('id').eq('is_active', true) → signals
 *  - .functions.invoke('run-signal-scorer', { body }) → per-signal scorer
 */
function makeFakeAdmin(opts: {
  ppRow: Record<string, unknown> | null;
  signals: Array<{ id: string }>;
  scorerOutcome: (signalId: string) => { data?: unknown; error?: { message: string } };
}) {
  const updates: RecordedUpdate[] = [];
  const invokes: RecordedInvoke[] = [];
  let seq = 0;

  const from = (table: string) => {
    const builder: Record<string, unknown> = {};
    let pendingPatch: Record<string, unknown> | null = null;
    let isSignalsSelect = false;

    builder.select = (sel: string) => {
      if (table === "signal_definitions") isSignalsSelect = true;
      void sel;
      return builder;
    };
    builder.update = (patch: Record<string, unknown>) => {
      pendingPatch = patch;
      return builder;
    };
    builder.eq = (_col: string, _val: unknown) => {
      // signal_definitions select resolves on the .eq('is_active', true) await
      if (table === "signal_definitions" && isSignalsSelect) {
        return Promise.resolve({ data: opts.signals, error: null });
      }
      // an update resolves on its terminal .eq()
      if (pendingPatch) {
        updates.push({ table, patch: pendingPatch, seq: seq++ });
        const p = pendingPatch;
        pendingPatch = null;
        void p;
        return Promise.resolve({ data: null, error: null });
      }
      return builder;
    };
    builder.maybeSingle = () => {
      if (table === "place_pool") {
        return Promise.resolve({ data: opts.ppRow, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    };
    return builder;
  };

  const functions = {
    invoke: (fn: string, args: { body: unknown }) => {
      invokes.push({ fn, body: args.body, seq: seq++ });
      const body = args.body as { signal_id?: string };
      const outcome = opts.scorerOutcome(body.signal_id ?? "");
      return Promise.resolve({ data: outcome.data ?? null, error: outcome.error ?? null });
    },
  };

  return { client: { from, functions }, updates, invokes };
}

Deno.test("META-ORCH-1062 ADVERSARIAL: partial scorer success keeps the venue LIVE (Q1)", async () => {
  // 3 signals; signal_2 fails, the other two score. Q1: ≥1 success ⇒ stay live.
  const signals = [{ id: "s1" }, { id: "s2" }, { id: "s3" }];
  const fake = makeFakeAdmin({
    ppRow: PASSING_ROW,
    signals,
    scorerOutcome: (sid) =>
      sid === "s2" ? { error: { message: "boom" } } : { data: { success: true } },
  });

  // deno-lint-ignore no-explicit-any
  const res = await runApproveGoLive(fake.client as any, PPID, null);

  assert(res.rebounced, "should have re-bounced");
  assertEquals(res.servable, true, "partial success must stay servable");
  assertEquals(res.rolled_back, false, "partial success must NOT roll back");
  assertEquals(res.scored_signals.sort(), ["s1", "s3"]);
  assertEquals(res.failed_signals.length, 1);
  assertEquals(res.failed_signals[0].signal_id, "s2");

  // No rollback update with is_servable:false may exist.
  const rolledBack = fake.updates.some(
    (u) => u.patch.is_servable === false,
  );
  assert(!rolledBack, "no is_servable:false rollback update on partial success");
});

Deno.test("META-ORCH-1062 ADVERSARIAL: TOTAL scorer failure rolls is_servable back to false (Q1)", async () => {
  const signals = [{ id: "s1" }, { id: "s2" }];
  const fake = makeFakeAdmin({
    ppRow: PASSING_ROW,
    signals,
    scorerOutcome: () => ({ error: { message: "scorer 500" } }),
  });

  // deno-lint-ignore no-explicit-any
  const res = await runApproveGoLive(fake.client as any, PPID, null);

  assertEquals(res.scored_signals.length, 0);
  assertEquals(res.failed_signals.length, 2);
  assertEquals(res.rolled_back, true, "total failure must roll back");
  assertEquals(res.servable, false, "result.servable must be false after rollback");

  // A rollback update writing is_servable:false + the diagnostic reason must exist.
  const rb = fake.updates.find((u) => u.patch.is_servable === false);
  assert(rb, "expected a rollback update writing is_servable:false");
  assertEquals(rb!.patch.bouncer_reason, "scoring_failed_on_approve");
});

Deno.test("META-ORCH-1062 ADVERSARIAL: re-bounce FAIL leaves venue off-deck, never scores (Q3)", async () => {
  const fake = makeFakeAdmin({
    ppRow: FAILING_ROW, // real bounce() returns is_servable:false (B4+B6)
    signals: [{ id: "s1" }],
    scorerOutcome: () => ({ data: { success: true } }),
  });

  // deno-lint-ignore no-explicit-any
  const res = await runApproveGoLive(fake.client as any, PPID, null);

  assert(res.rebounced, "re-bounce ran");
  assertEquals(res.servable, false, "bounce-fail must not grant servable");
  assertEquals(res.rolled_back, false, "not a rollback — never flipped in the first place");
  assert(res.bounce_reasons.length > 0, "bounce reasons surfaced to admin");

  // The scorer must NEVER be invoked when the re-bounce fails.
  assertEquals(fake.invokes.length, 0, "no scorer invoke on bounce-fail");
  // No update may flip is_servable:true.
  const flippedTrue = fake.updates.some((u) => u.patch.is_servable === true);
  assert(!flippedTrue, "is_servable must not be flipped true on bounce-fail");
  // The bouncer_reason must be recorded for the admin.
  const reasonWrite = fake.updates.find((u) => "bouncer_reason" in u.patch);
  assert(reasonWrite, "bouncer_reason recorded on bounce-fail");
});

// ─── ORCH-1067 — T-08: business-authored re-bounce in runApproveGoLive ───────
// A business-authored projection (fetched_via='business_authored') with REAL
// uploaded stored photos but NO Google `photos` must FLIP is_servable=true at
// approve (B7 skipped, B8 satisfied) and proceed to scoring. Pre-ORCH-1067 this
// row B7-rejected and stayed off-deck forever. The BOUNCER_SELECT now includes
// fetched_via so the injected row carries provenance into bounce(). fails-on-
// revert: removing the bouncer.ts B7-skip guard makes this row fail B7 →
// res.servable=false → this test fails.
const BUSINESS_AUTHORED_ROW = {
  ...PASSING_ROW,
  id: PPID,
  fetched_via: "business_authored",
  photos: [], // not on Google → zero Google photo metadata
  stored_photo_urls: ["https://cdn/uploaded1.jpg", "https://cdn/uploaded2.jpg"],
};

Deno.test("ORCH-1067 ADVERSARIAL T-08: business-authored row (no Google photos) flips servable at approve and scores", async () => {
  const fake = makeFakeAdmin({
    ppRow: BUSINESS_AUTHORED_ROW,
    signals: [{ id: "s1" }, { id: "s2" }],
    scorerOutcome: () => ({ data: { success: true } }),
  });

  // deno-lint-ignore no-explicit-any
  const res = await runApproveGoLive(fake.client as any, PPID, null);

  assert(res.rebounced, "should have re-bounced");
  assertEquals(res.servable, true, "business-authored w/ stored photos must flip servable (B7 skipped)");
  assertEquals(res.rolled_back, false, "no rollback on a clean business-authored row");
  // B7 must NOT appear in the surfaced bounce reasons.
  assert(
    !res.bounce_reasons.some((r) => r.startsWith("B7")),
    `B7 must not fire for business-authored; got ${JSON.stringify(res.bounce_reasons)}`,
  );
  // It proceeds to scoring (servable flip → scorer invoked per signal).
  assertEquals(res.scored_signals.sort(), ["s1", "s2"]);
});

Deno.test("ORCH-1067 ADVERSARIAL T-08b: business-authored row with NO stored photos stays off-deck (B8, not B7)", async () => {
  const fake = makeFakeAdmin({
    ppRow: { ...BUSINESS_AUTHORED_ROW, stored_photo_urls: [] },
    signals: [{ id: "s1" }],
    scorerOutcome: () => ({ data: { success: true } }),
  });

  // deno-lint-ignore no-explicit-any
  const res = await runApproveGoLive(fake.client as any, PPID, null);

  assertEquals(res.servable, false, "no stored photos ⇒ must NOT go live");
  assert(res.bounce_reasons.some((r) => r.startsWith("B8")), "expected B8 (stored-photo gate)");
  assert(!res.bounce_reasons.some((r) => r.startsWith("B7")), "B7 must not fire for business-authored");
  assertEquals(fake.invokes.length, 0, "no scorer invoke when bounce fails");
});

Deno.test("META-ORCH-1062 ADVERSARIAL: servable flip is committed BEFORE the first scorer invoke (ordering)", async () => {
  const fake = makeFakeAdmin({
    ppRow: PASSING_ROW,
    signals: [{ id: "s1" }, { id: "s2" }],
    scorerOutcome: () => ({ data: { success: true } }),
  });

  // deno-lint-ignore no-explicit-any
  await runApproveGoLive(fake.client as any, PPID, null);

  const flip = fake.updates.find((u) => u.patch.is_servable === true);
  assert(flip, "expected the servable flip update");
  const firstInvokeSeq = fake.invokes.length > 0 ? fake.invokes[0].seq : Infinity;
  assert(
    flip!.seq < firstInvokeSeq,
    "is_servable=true must be committed before the first run-signal-scorer invoke " +
      `(flip seq ${flip!.seq} vs first invoke seq ${firstInvokeSeq}) — the scorer ` +
      "SELECT filters is_servable=true, so flipping after would score nothing.",
  );

  // And every invoke must carry signal_id (defense against 1062-A re-emerging).
  for (const inv of fake.invokes) {
    const body = inv.body as { signal_id?: string };
    assert(
      typeof body.signal_id === "string" && body.signal_id.length > 0,
      "every scorer invoke from runApproveGoLive must carry a non-empty signal_id",
    );
  }
});
