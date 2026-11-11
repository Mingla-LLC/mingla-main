// Issue #3355 rework 2 — the tester's retest-2 FAIL verdict, fixed
// structurally (orchestrator decision 2026-11-11).
//
//   P1-2  (retired in rework 3; see issue_3355_rework_3.implementor.test.ts);
//   P1-18 percent ↔ amount: the latest statement wins, per object (N3);
//   P2-9  values bind to their own code in either word order (N4);
//   P2-19 / P3-20 spelled-out and abbreviated percents, NGN5000, "between …
//         and …", "the end of December" (N5 and the P3 cases);
//         the intent read's stated values are primary, the words the
//         cross-check, and a disagreement is one question naming both;
//   P3-21 a demoted or removed author's brand notes stop reaching other
//         members (source contract here; runtime in the pg17 suite);
//   P2-11 a guided setup completes when its draft is saved and verified; the
//         "get it ready" step is a follow-up that never blocks completion.
//
// (I-ARI-NO-MODEL-STATUS-WORDS was retired in rework 3: status words the records back are kept; see I-ARI-CLAIM-MATCHES-RECEIPT in ariClaimCheck.ts.)
// MINGLA-INVARIANT: I-ARI-STATED-LATEST-PER-OBJECT | issue #3355 | Per code and field the host's latest stated value wins (a percent replaces an amount and the reverse; a correction inside one message keeps the newer value); values bind to the code in their own clause in either word order; two values with no correction, or an intent read that disagrees with the words, make Ari ask one question naming both.
// MINGLA-INVARIANT: I-ARI-FLOW-COMPLETES-ON-DRAFT | issue #3355 | An offering setup run completes, with the draft step's evidence, as soon as its draft is saved and verified; the optional next step (get it ready / publish / cover) is offered once on the completion card and continues in a new run, never holding the first run open.

import {
  assertEquals,
  assertMatch,
  assertNotMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  checkStatedSlots,
  extractStatedSlots,
  mergeModelStatedSlots,
  type ModelStatedValues,
  preserveStatedSlots,
} from "../ariTruthGuards.ts";
import { parseAriIntentRead } from "../ariIntentRead.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const NOW = new Date("2026-11-11T10:00:00Z");
const KEYS = new Set([
  "brand_id",
  "kind",
  "code",
  "value_type",
  "value_bps",
  "value_minor",
  "starts_at",
  "ends_at",
  "max_total_uses",
  "max_uses_per_buyer",
]);

function check(
  messages: string[],
  args: Record<string, unknown>,
  model?: ModelStatedValues,
) {
  const stated = mergeModelStatedSlots(
    extractStatedSlots(messages, NOW),
    model,
    messages,
  );
  return checkStatedSlots({
    toolName: "create_discount",
    toolArgs: args,
    schemaKeys: KEYS,
    stated,
    timezone: "Africa/Lagos",
    currency: "NGN",
    country: "NG",
    now: NOW,
  });
}

// P1-2 (the structural claim guard) was replaced in rework 3 by the claim
// check against the records: issue_3355_rework_3.implementor.test.ts.

// ── P1-18 / P2-9 / P2-19 / P3-20: stated values ─────────────────────────────

Deno.test("P1-18 (N3): the latest of percent and amount wins, never a loop", () => {
  const amount = {
    code: "FAVY10",
    kind: "code",
    value_type: "amount",
    value_minor: 100000,
  };
  const percent = {
    code: "FAVY10",
    kind: "code",
    value_type: "percent",
    value_bps: 1000,
  };
  assertEquals(
    check(
      ["Code FAVY10 10% off", "Actually make it ₦1,000 off instead"],
      amount,
    ).kind,
    "ok",
  );
  assertEquals(
    check(["Code FAVY10 ₦1,000 off", "No, 10% instead"], percent).kind,
    "ok",
  );
  for (
    const message of [
      "Create code FAVY10 for 10% off, actually no, make it ₦1,000 off",
      "FAVY10: not 10%, ₦1,000 off",
    ]
  ) {
    assertEquals(check([message], amount).kind, "ok", message);
    const old = check([message], percent);
    assertEquals(old.kind, "ask", message);
    if (old.kind === "ask") assertMatch(old.text, /NGN\s?1,000\.00 off/);
  }
  // A "yes" to a superseded question never brings the old value back.
  const afterYes = [
    "Code FAVY10 10% off",
    "Actually make it ₦1,000 off instead",
    "yes",
  ];
  assertEquals(check(afterYes, amount).kind, "ok");
  const stale = check(afterYes, percent);
  assertEquals(stale.kind, "ask");
  if (stale.kind === "ask") {
    assertMatch(
      stale.text,
      /you asked for NGN\s?1,000\.00 off, but I had 10% off/,
    );
  }
  // Two values with no correction between them: one question naming both.
  const both = check(["FAVY10 10% off or ₦1,000 off"], amount);
  assertEquals(both.kind, "ask");
  if (both.kind === "ask") {
    assertMatch(both.text, /you said 10% off and ₦1,000 off\. Which one/);
  }
});

Deno.test("P2-9 (N4): values bind to their own code in either word order", () => {
  const message =
    "10% off until 19 December for FAVY10 and 20% off for GIRLS20";
  const girls = check([message], {
    code: "GIRLS20",
    kind: "code",
    value_type: "percent",
    value_bps: 2000,
  });
  assertEquals(girls.kind, "ok", JSON.stringify(girls));
  if (girls.kind === "ok") assertEquals(girls.args.ends_at, undefined);
  assertEquals(
    check([message], {
      code: "GIRLS20",
      kind: "code",
      value_type: "percent",
      value_bps: 1000,
    }).kind,
    "ask",
  );
  const favy = check([message], {
    code: "FAVY10",
    kind: "code",
    value_type: "percent",
    value_bps: 1000,
  });
  assertEquals(favy.kind === "ok" && favy.args.ends_at, "2026-12-19T22:59:59Z");
  // Code-first order still works; shared words still share.
  const slots = extractStatedSlots([
    "FAVY10 and GIRLS20, both 15% off until 31 December",
  ], NOW);
  assertEquals(slots.per_code?.FAVY10?.value_bps, 1500);
  assertEquals(slots.per_code?.GIRLS20?.value_bps, 1500);
});

Deno.test("P2-19 / P3-20 (N5): number words, pc, per cent, half off, NGN5000, between and end of month", () => {
  const percentOf = (message: string) =>
    extractStatedSlots([message], NOW).value_bps;
  assertEquals(percentOf("Code FAVY10 ten percent off"), 1000);
  assertEquals(percentOf("Code FAVY10 twenty-five percent off"), 2500);
  assertEquals(percentOf("Code FAVY10 10pc off"), 1000);
  assertEquals(percentOf("Code FAVY10 10 pct off"), 1000);
  assertEquals(percentOf("Code FAVY10 10 per cent off"), 1000);
  assertEquals(percentOf("Code FAVY10 half off"), 5000);
  for (const message of ["Code FAVY10 NGN5000 off", "Code FAVY10 ₦5000 off"]) {
    const amount = extractStatedSlots([message], NOW).amount;
    assertEquals([amount?.major, amount?.currency], [5000, "NGN"], message);
  }
  for (
    const message of [
      "Code FAVY10 ten percent off",
      "Code FAVY10 10pc off",
      "Code FAVY10 10 pct off",
      "Code FAVY10 half off",
    ]
  ) {
    assertEquals(
      check([message], {
        code: "FAVY10",
        kind: "code",
        value_type: "amount",
        value_minor: 1000,
      }).kind,
      "ask",
      message,
    );
  }
  const between = extractStatedSlots([
    "Code FAVY10 10% off between 1 and 19 December",
  ], NOW);
  assertEquals(
    [
      between.starts_on?.month,
      between.starts_on?.day,
      between.ends_on?.month,
      between.ends_on?.day,
    ],
    [12, 1, 12, 19],
  );
  const bound = check(["Code FAVY10 10% off between 1 and 19 December"], {
    code: "FAVY10",
    kind: "code",
    value_type: "percent",
    value_bps: 1000,
  });
  assertEquals(
    bound.kind === "ok" && bound.args.starts_at,
    "2026-11-30T23:00:00Z",
  );
  assertEquals(
    bound.kind === "ok" && bound.args.ends_at,
    "2026-12-19T22:59:59Z",
  );
  const monthEnd =
    extractStatedSlots(["Code FAVY10 until the end of December"], NOW).ends_on;
  assertEquals([monthEnd?.year, monthEnd?.month, monthEnd?.day], [
    2026,
    12,
    31,
  ]);
});

function brandClient(timezone: string): SupabaseClient {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve({
              data: {
                default_timezone: timezone,
                country_code: "NG",
                default_currency: "NGN",
              },
              error: null,
            }),
        }),
      }),
    }),
  } as unknown as SupabaseClient;
}

Deno.test("Stated values: the intent read is primary, the words the cross-check (both agent paths share this stage)", async () => {
  const parameters = {
    properties: Object.fromEntries([...KEYS].map((key) => [key, {}])),
  };
  const brand_id = "22222222-2222-4222-8222-222222222222";
  const run = (
    ownerMessages: string[],
    toolArgs: Record<string, unknown>,
    modelStated: ModelStatedValues,
  ) =>
    preserveStatedSlots({
      toolName: "create_discount",
      toolArgs: { brand_id, ...toolArgs },
      parameters,
      ownerMessages,
      userClient: brandClient("Africa/Lagos"),
      now: NOW,
      modelStated,
    });
  // The newest message changes the value in words the parser cannot read:
  // the read's value (grounded in those words) is the latest statement.
  const changed = await run(
    ["Code FAVY10 10% off", "hmm make it fifteen"],
    { code: "FAVY10", kind: "code", value_type: "percent", value_bps: 1500 },
    { code: "FAVY10", percent_off: 15 },
  );
  assertEquals(changed.kind, "ok", JSON.stringify(changed));
  // The read and the words disagree about the same message: one question.
  const disagree = await run(
    ["Code FAVY10 10 percent off, maybe 15"],
    { code: "FAVY10", kind: "code", value_type: "percent", value_bps: 1500 },
    { code: "FAVY10", percent_off: 15 },
  );
  assertEquals(disagree.kind, "ask");
  if (disagree.kind === "ask") {
    assertMatch(disagree.text, /you said 10% off and 15% off/);
  }
  // Per code: the read's end day for FAVY10 never reaches GIRLS20.
  const words = [
    "FAVY10 runs till Christmas Eve the 24th of Dec and GIRLS20 till 31 Dec",
  ];
  const model: ModelStatedValues = {
    per_code: [{ code: "FAVY10", ends_on: "2026-12-24" }, {
      code: "GIRLS20",
      ends_on: "2026-12-31",
    }],
  };
  const favy = await run(words, { code: "FAVY10", kind: "code" }, model);
  assertEquals(favy.kind === "ok" && favy.args.ends_at, "2026-12-24T22:59:59Z");
  const girls = await run(words, { code: "GIRLS20", kind: "code" }, model);
  assertEquals(
    girls.kind === "ok" && girls.args.ends_at,
    "2026-12-31T22:59:59Z",
  );
  // An invented value is still dropped.
  const invented = await run(
    ["Code FAVY10 for my party"],
    { code: "FAVY10", kind: "code" },
    { code: "FAVY10", percent_off: 90, ends_on: "2027-01-05" },
  );
  assertEquals(invented.kind === "ok" && invented.args.ends_at, undefined);
});

Deno.test("Stated values: the intent read carries per-code values and is still strict", () => {
  const ctx = { openFlow: null, toolNames: new Set(["create_discount"]) };
  const read = parseAriIntentRead({
    intent: "tool",
    target: "create_discount",
    confidence: 0.9,
    stated_values: {
      per_code: [{ code: "FAVY10", percent_off: 10 }, {
        code: "GIRLS20",
        percent_off: 20,
      }],
    },
  }, ctx);
  assertEquals(read?.stated_values.per_code?.length, 2);
  assertEquals(
    parseAriIntentRead({
      intent: "tool",
      target: "create_discount",
      confidence: 0.9,
      stated_values: { per_code: [{ code: "FAVY10", title: "nope" }] },
    }, ctx),
    null,
    "an unknown key inside per_code makes the whole read invalid",
  );
  assertEquals(
    parseAriIntentRead({
      intent: "tool",
      target: "create_discount",
      confidence: 0.9,
      stated_values: { per_code: [{ percent_off: 10 }] },
    }, ctx),
    null,
    "a per-code entry needs its code",
  );
});

// ── P3-21: brand notes at read time ─────────────────────────────────────────

Deno.test("P3-21: brand notes reach other members only while their author may speak for the brand", async () => {
  const sql = await Deno.readTextFile(
    new URL(
      "../../../migrations/20280620113355_issue_3355_ari_memory_brand_voice.sql",
      import.meta.url,
    ),
  );
  assertMatch(
    sql,
    /CREATE OR REPLACE FUNCTION public\.ari_memory_brand_voice\(/,
  );
  assertMatch(sql, />= public\.biz_role_rank\('marketing_manager'\)/);
  // Both read paths: the list Ari's context loads, and the table's policy.
  const list = sql.slice(
    sql.indexOf("CREATE OR REPLACE FUNCTION public.ari_memory_list"),
  );
  assertMatch(
    list,
    /AND public\.ari_memory_brand_voice\(n\.brand_id, n\.user_id\)\)/,
  );
  const policy = sql.slice(
    sql.indexOf("CREATE POLICY ari_memory_notes_scoped_read"),
  );
  assertMatch(
    policy,
    /AND public\.ari_memory_brand_voice\(brand_id, user_id\)/,
  );
  // Rows are kept: nothing here deletes or deactivates a note.
  assertNotMatch(
    sql,
    /DELETE FROM public\.ari_memory_notes|SET active = false/i,
  );
});
