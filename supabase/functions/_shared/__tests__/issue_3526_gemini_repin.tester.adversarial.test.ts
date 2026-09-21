// issue #3526 [Gemini repin] — TESTER adversarial suite.
//
// APPEND-ONLY, IMMUTABLE. A different angle from the implementor's suite, which
// asserts the repin is present at an ENUMERATED list of files. This suite
// refuses to take a list: it DERIVES the set of Gemini senders from the code
// itself, runs the real matcher against every depletion_signal shape that is
// LIVE in production today, and attacks the failure-detail scrubber with input
// a provider could actually return.
//
// The unfalsifiable-test class (feedback_unfalsifiable_test_bug_class.md) is
// the thing being guarded against: a test whose scope is hand-written to match
// the implementation cannot see anything the implementor forgot.
//
// Cases marked TESTER-DEFECT are RED on 2bdfca583 by design; they pin the
// contract the fix must satisfy.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { GEMINI_THINKING_LEVEL_MINIMAL } from "../geminiModel.ts";
import { scrubFailureDetail, FAILURE_DETAIL_MAX } from "../toolLeadFailure.ts";
import { matchClassBDepletion } from "../../api-health-probe/logic.ts";

const FUNCTIONS = new URL("../../", import.meta.url);

/** Every .ts file under supabase/functions/ that is not a test. */
function productionFiles(dir = FUNCTIONS, acc: string[] = []): string[] {
  for (const e of Deno.readDirSync(dir)) {
    const child = new URL(e.name + (e.isDirectory ? "/" : ""), dir);
    if (e.isDirectory) {
      if (e.name === "node_modules" || e.name === "__tests__") continue;
      productionFiles(child, acc);
    } else if (e.name.endsWith(".ts") && !e.name.endsWith(".test.ts")) {
      acc.push(child.pathname);
    }
  }
  return acc;
}

/**
 * DERIVED, not enumerated: a Gemini sender is any production file that both
 * builds a :generateContent URL and POSTs a generationConfig. `geminiModel.ts`
 * only defines the URL helper, so it is not itself a sender.
 */
function deriveGeminiSenders(): string[] {
  const out: string[] = [];
  for (const path of productionFiles()) {
    const src = Deno.readTextFileSync(path).replace(/\/\/[^\n]*/g, "");
    if (path.endsWith("/_shared/geminiModel.ts")) continue;
    const buildsUrl = /geminiGenerateContentUrl\(|:generateContent/.test(src);
    const sends = /generationConfig\s*:/.test(src);
    if (buildsUrl && sends) out.push(path); // absolute
  }
  return out.sort();
}

/** Display name: everything from `supabase/functions/` onward. */
const short = (abs: string) => abs.slice(abs.indexOf("/supabase/functions/") + 1);

Deno.test("#3526 TESTER — the derived sender set is larger than any hand-written list", () => {
  const senders = deriveGeminiSenders();
  // Sanity: the derivation must actually find the senders we know about, or the
  // test below would pass vacuously — the unfalsifiable-test trap in reverse.
  assert(
    senders.some((s) => s.includes("competitor-intel-worker")),
    `derivation found no competitor-intel-worker; senders=${senders.map(short).join(", ")}`,
  );
  assert(
    senders.length >= 8,
    `derivation found only ${senders.length} senders, expected >= 8: ${
      senders.map(short).join(", ")
    }`,
  );
});

Deno.test("#3526 TESTER-DEFECT — EVERY derived Gemini sender sets thinking_level", () => {
  // A Gemini 3 model that receives no thinking config defaults to `medium` and
  // bills those tokens as output at $3.75/1M. The implementor's suite asserts
  // this over a hand-written list of six files; this one derives the list, and
  // the four public growth tools fall out of the gap.
  // issue #3526 round 2 — COUNT the requests, do not merely detect one. A
  // presence check passed `growth-tools-run`, which builds TWO requests, when
  // the thinking line was deleted from one of them. Caught by the implementor's
  // own fails-on-revert run; strengthened here too so the two suites do not
  // share a blind spot.
  const missing: string[] = [];
  for (const abs of deriveGeminiSenders()) {
    const src = Deno.readTextFileSync(abs).replace(/\/\/[^\n]*/g, "");
    const configs = (src.match(/generationConfig\s*:/g) ?? []).length;
    const levels = (src.match(/thinkingConfig\s*:\s*\{\s*thinking_level/g) ?? []).length;
    if (levels < configs) missing.push(`${short(abs)} (${levels}/${configs})`);
  }
  assertEquals(
    missing,
    [],
    `these Gemini senders inherit the billable default thinking level: ${missing.join(", ")}`,
  );
  assertEquals(GEMINI_THINKING_LEVEL_MINIMAL, "minimal");
});

// ── the failure-detail scrubber, attacked with real provider shapes ─────────

Deno.test("#3526 TESTER — scrubFailureDetail survives adversarial provider detail", () => {
  // A Google API key is AIza + 35 url-safe chars. The column is durable, so a
  // leak here is permanent.
  const key = "AIza" + "b".repeat(35);
  const cases: Array<[string, string, (out: string) => boolean]> = [
    [
      "bare key in the body",
      `quota exceeded for key ${key} on project 1071011312558`,
      (o) => !o.includes(key) && o.includes("[redacted]"),
    ],
    [
      "key echoed back inside a URL",
      `GET https://generativelanguage.googleapis.com/v1beta/models?key=${key} failed`,
      (o) => !o.includes(key),
    ],
    [
      "two keys, one bare one in a query param",
      `first ${key} then ?key=${key}&alt=json`,
      (o) => !o.includes(key),
    ],
    [
      "key positioned beyond the truncation point",
      "x".repeat(FAILURE_DETAIL_MAX + 50) + " " + key,
      (o) => !o.includes(key) && o.length <= FAILURE_DETAIL_MAX,
    ],
    [
      "replacement-pattern characters in the detail must not corrupt the output",
      "error $& $' $` $1 happened",
      (o) => o.includes("$&") && o.includes("$1"),
    ],
  ];
  for (const [name, input, ok] of cases) {
    const out = scrubFailureDetail(input) ?? "";
    assert(ok(out), `${name}: scrub produced ${JSON.stringify(out)}`);
    assert(out.length <= FAILURE_DETAIL_MAX, `${name}: exceeded ${FAILURE_DETAIL_MAX}`);
  }
  assertEquals(scrubFailureDetail("   "), null);
  assertEquals(scrubFailureDetail(undefined), null);
});

// ── the widened matcher, against every shape LIVE in production ────────────

Deno.test("#3526 TESTER — widening gemini regresses no other live depletion_signal", () => {
  // Read off production api_health_services on 2026-09-21 (read-only). Three
  // distinct pre-#3526 shapes exist and all must keep matching: `http` as a
  // number, `http` as an array, and a header-only signal.
  const LIVE = {
    openai: { reactive: { http: 429, field: "type", match: "insufficient_quota" } },
    resend: { reactive: { http: 429, field: "type", match: "quota_exceeded" } },
    mapbox: { reactive: { http: 429, field: "status_text", match: "429" } },
    google_places: { reactive: { http: [429], field: "status_text", match: "RESOURCE_EXHAUSTED" } },
    serper: { reactive: { http: [400, 401, 402, 403, 429], field: "body", match: "Not enough credits" } },
    pexels: { header: { name: "x-ratelimit-remaining", warn: 2500 } },
  } as const;

  const obs = (http: number, code: string | null, text: string | null) => [{
    http_status: http, error_code: code, error_text: text,
    observed_at: "2026-09-21T16:00:00Z",
  }];

  // deno-lint-ignore no-explicit-any
  const m = (sig: unknown, rows: unknown, cached?: number) =>
    matchClassBDepletion(sig as any, rows as any, cached);

  assertEquals(m(LIVE.openai, obs(429, "insufficient_quota", null)).depleted, true);
  assertEquals(m(LIVE.openai, obs(429, "rate_limit_exceeded", null)).depleted, false);
  assertEquals(m(LIVE.resend, obs(429, "quota_exceeded", null)).depleted, true);
  assertEquals(m(LIVE.mapbox, obs(429, null, "429 Too Many Requests")).depleted, true);
  assertEquals(m(LIVE.google_places, obs(429, null, "RESOURCE_EXHAUSTED")).depleted, true);
  assertEquals(m(LIVE.serper, obs(402, null, "Not enough credits")).depleted, true);
  assertEquals(m(LIVE.serper, obs(500, null, "Not enough credits")).depleted, false);
  assertEquals(m(LIVE.pexels, [], 100).depleted, true);
  assertEquals(m(LIVE.pexels, [], 9999).depleted, false);

  // A pre-#3526 single-object signal keeps reporting the historical kind.
  assertEquals(m(LIVE.openai, obs(429, "insufficient_quota", null)).kind, "depletion");
});

// ── cross-surface: the edge constant has a second owner in the admin app ────

const REPO = new URL("../../../../", import.meta.url);
const readRepo = (rel: string) => Deno.readTextFileSync(new URL(rel, REPO));

Deno.test("#3526 TESTER-DEFECT — the admin owns NO per-place cost at all", () => {
  // ORIGINAL ASSERTION (tester, bc9f9ad2c): each of the admin's five copies of
  // the per-place rate must EQUAL the edge constant. That encoded the verdict's
  // fallback remedy — "or reduce it to one exported constant ... set to 0.0089".
  //
  // REPLACED, and deliberately STRENGTHENED, on the coordinator's ruling: "the
  // admin client must stop owning the cost model ... do not duplicate the
  // number a sixth time." Asserting the copies AGREE still leaves five copies
  // that must be kept in step by hand at the next repricing — which is the
  // defect one level up. Asserting there are NO copies cannot be satisfied by a
  // stale-but-matching number, so it is strictly harder to pass than what it
  // replaces. Nothing here is loosened: every original site is still checked,
  // and the check on each is now "holds no rate" rather than "holds the right
  // rate".
  //
  // The server publishes {per_place_cost_usd, cost_guard_usd, ...} on
  // `intelligence_coverage` and `city_coverage`; the admin renders what it is
  // told and blocks the run when it is told nothing.
  const edge = readRepo("supabase/functions/run-place-intelligence-trial/index.ts");
  const edgeCost = Number(/const PER_PLACE_COST_USD = ([0-9.]+);/.exec(edge)?.[1]);
  const edgeGuard = Number(/const COST_GUARD_USD = ([0-9.]+);/.exec(edge)?.[1]);
  assert(Number.isFinite(edgeCost) && Number.isFinite(edgeGuard));
  // The edge function must still PUBLISH the model, or the client has nothing
  // to render and this whole design collapses into a silent block.
  assert(
    /cost_model:\s*buildCostModel\(\)/.test(edge),
    "the edge function must publish its cost model on the admin's read paths",
  );
  assertEquals(
    (edge.match(/cost_model:\s*buildCostModel\(\)/g) ?? []).length,
    2,
    "both intelligence_coverage and city_coverage must carry the cost model",
  );

  // Every site the original assertion named, now checked for ABSENCE.
  const sites = [
    "mingla-admin/src/hooks/useBulkRunDispatcher.js",
    "mingla-admin/src/components/placeIntelligenceTrial/IntelligenceOverviewTab.jsx",
    "mingla-admin/src/components/placeIntelligenceTrial/TrialResultsTab.jsx",
    "mingla-admin/src/components/placeIntelligenceTrial/RunRemainderConfirmModal.jsx",
    "mingla-admin/src/components/placeIntelligenceTrial/RunRemainderOnAllConfirmModal.jsx",
    "mingla-admin/src/components/placeIntelligenceTrial/ActiveRunCard.jsx",
    "mingla-admin/src/services/intelligenceCoverageEstimators.js",
    "mingla-admin/src/services/intelligenceCoverageService.js",
  ];
  // issue #3526 round 3 — RESTORING COVERAGE THE ROUND-2 REWRITE DROPPED.
  //
  // Round 2 replaced "every copy EQUALS the edge constant" with "there are no
  // copies". Stronger against a stale-but-matching number, and it added three
  // sites — but it recognises a rate only when spelled `0.00…`, so it is blind
  // to a re-introduction at any rate >= $0.01. That is not hypothetical: this
  // very file's sibling comment documents Google doubling the rate to ~$0.0178
  // on 1 Jan 2027. Measured, all injected into IntelligenceOverviewTab.jsx:
  //
  //   injection                      round-1 check   round-2 check
  //   const PER_PLACE_COST_USD = 0.0089    misses        CATCHES
  //   const PER_PLACE_COST_USD = 0.0178    CATCHES        misses   <-- the 2027 rate
  //   const PER_PLACE_COST_USD = 0.012     CATCHES        misses
  //   const PER_PLACE_COST_USD = 8.9e-3     misses        misses
  //   const PER_PLACE_COST_USD = 0.89 / 100 misses        misses
  //
  // So the third check below is by NAME, not by magnitude or notation: any
  // cost-shaped identifier bound to a numeric literal, in either casing. The
  // client may hold the SHAPE of a cost model; it may not hold a NUMBER.
  const RATE_LITERAL = /\b0\.00[0-9]+\b/;
  // Case-insensitive with an optional underscore, so SCREAMING_SNAKE and
  // camelCase are one rule: PER_PLACE_COST_USD, perPlaceCostUsd, COST_GUARD_USD,
  // costGuardUsd, COST_DRIFT_TOLERANCE_USD_PER_PLACE, costDriftToleranceUsdPerPlace.
  // The leading [\w$]* may be empty, so an identifier that STARTS with the token
  // still matches.
  //
  // `usd` is REQUIRED, and that is what keeps the rule honest rather than
  // over-fitted. Two legitimate client constants are cost-adjacent and carry no
  // money: `PER_PLACE_BROWSER_THROTTLE_MS` (a delay) and
  // `COST_DRIFT_TOLERANCE_FRACTION` (dimensionless — the server publishes the
  // absolute tolerance and this is only the fallback multiplier). The admin may
  // hold shapes and ratios; it may not hold a DOLLAR amount.
  // Residual, stated rather than over-fitted: a copy named without `usd`
  // (`PER_PLACE_RATE = 0.0178`) is still caught by RATE_LITERAL only when it is
  // spelled `0.00…`. Naming it `usd` is the convention everywhere here.
  const COST_IDENT_BOUND_TO_NUMBER =
    /\b[\w$]*(?:per_?place|cost_?guard|cost_?drift)[\w$]*usd[\w$]*\s*[:=]\s*[-+]?[0-9]/i;
  const offenders: string[] = [];
  for (const rel of sites) {
    const code = readRepo(rel)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    const name = rel.split("/").pop();
    const rate = RATE_LITERAL.exec(code);
    if (rate) offenders.push(`${name} holds rate ${rate[0]}`);
    if (/COST_GUARD_USD\s*=\s*[0-9]/.test(code)) {
      offenders.push(`${name} holds its own cost guard`);
    }
    const bound = COST_IDENT_BOUND_TO_NUMBER.exec(code);
    if (bound) offenders.push(`${name} binds a cost identifier to a number: ${bound[0].trim()}`);
  }
  assertEquals(
    offenders,
    [],
    `the admin must hold NO per-place rate and NO cost guard of its own — the ` +
      `server owns both and publishes them. Offenders: ${offenders.join("; ")}. ` +
      `Baltimore (1,205 remaining) is the live case: at the edge rate the ` +
      `server demands confirm_high_cost from ${Math.ceil(edgeGuard / edgeCost)} ` +
      `places, and any client copy that disagrees makes that city unstartable.`,
  );

  // And the client must actually READ the published model, not merely lack a
  // constant — a client that computes nothing would also pass the check above.
  for (
    const rel of [
      "mingla-admin/src/hooks/useBulkRunDispatcher.js",
      "mingla-admin/src/components/placeIntelligenceTrial/TrialResultsTab.jsx",
      "mingla-admin/src/components/placeIntelligenceTrial/RunRemainderConfirmModal.jsx",
    ]
  ) {
    assert(
      /costModel/.test(readRepo(rel)),
      `${rel} must consume the server's cost model`,
    );
  }
});

Deno.test("#3526 TESTER-DEFECT — no admin confirmation names the retired model", () => {
  // Copy Seth reads before authorising spend still says the run uses
  // "Gemini 2.5 Flash" and cites the 2.5 pricing page as its cost source.
  const offenders: string[] = [];
  for (
    const rel of [
      "mingla-admin/src/components/placeIntelligenceTrial/RunRemainderConfirmModal.jsx",
      "mingla-admin/src/components/placeIntelligenceTrial/RunRemainderOnAllConfirmModal.jsx",
    ]
  ) {
    if (/Gemini 2\.5 Flash|pricing\/gemini-2-5-flash/.test(readRepo(rel))) {
      offenders.push(rel.split("/").pop()!);
    }
  }
  assertEquals(
    offenders,
    [],
    `admin confirmation copy still names the retired model: ${offenders.join(", ")}`,
  );
});

Deno.test("#3526 TESTER — a retirement stays loud even though depleted goes false", () => {
  // api-health-probe/index.ts sets detail.depleted = (kind === "depletion"), so
  // a 404 retirement now reports depleted:false. The tile must still go DOWN on
  // it — if an alert ever keys off `depleted` instead of `status`, the exact
  // outage #3526 exists to catch goes quiet again.
  const gemini = {
    reactive: [
      { http: 429, match: "RESOURCE_EXHAUSTED", field: "type", kind: "depletion" },
      { http: 403, match: "PERMISSION_DENIED", field: "type", kind: "refusal" },
      { http: 404, match: "NOT_FOUND", field: "type", kind: "retirement" },
    ],
  };
  const at = (http: number, code: string) => [{
    http_status: http, error_code: code, error_text: null,
    observed_at: "2026-09-21T16:22:26Z",
  }];
  // deno-lint-ignore no-explicit-any
  const m = (rows: unknown) => matchClassBDepletion(gemini as any, rows as any);

  const retire = m(at(404, "NOT_FOUND"));
  assertEquals(retire.depleted, true, "the matcher must still MATCH a retirement");
  assertEquals(retire.kind, "retirement");
  const refuse = m(at(403, "PERMISSION_DENIED"));
  assertEquals(refuse.kind, "refusal");
  const quota = m(at(429, "RESOURCE_EXHAUSTED"));
  assertEquals(quota.kind, "depletion");
  // The 17-Sep and 21-Sep faults were invisible under the OLD single matcher.
  const old = { reactive: { http: 429, match: "RESOURCE_EXHAUSTED", field: "type" } };
  // deno-lint-ignore no-explicit-any
  assertEquals(matchClassBDepletion(old as any, at(404, "NOT_FOUND") as any).depleted, false);
});
