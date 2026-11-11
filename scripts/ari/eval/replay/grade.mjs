/**
 * #3355 Wave F (F1) — the replay grader. Pure: no I/O, no Node or Deno APIs,
 * so the Deno CI replay (stub model) and the Node live replay (real model on
 * the local stack) grade with the same code.
 *
 * Each turn is graded on four things:
 *   - route: what the turn became (a proposal card for a tool, a setup card,
 *     a parked setup, or plain text);
 *   - proposal args: the values the host stated reach the card exactly;
 *   - reply claims: the reply never says a write happened unless a
 *     proposal card is on screen this turn, never over-promises, and says
 *     what the scenario needs (e.g. People → Import from the guide);
 *   - no same card twice: a turn never shows the card the previous turn
 *     showed.
 * Every fact is one point. A scenario's score is its passed facts over its
 * facts, out of 100; the run's score is the mean of the suite scores.
 */

/** A reply that says Ari already wrote something. */
export const PAST_WRITE_CLAIM =
  /\b(?:I(?:'ve|’ve| have)?|Ari(?: has)?)\s+(?:already\s+)?(?:proposed|created|saved|sent|published|updated|set up|made|added)\b/i;

/** A reply that says Mingla can't do it. */
export const NOT_AVAILABLE =
  "not (?:yet )?available|isn['’]t available|aren['’]t available|not supported|(?:can['’]t|cannot|unable to) (?:create|make|set up|do) (?:discount|promo|that)";

/** A reply that says a website exists or went live when nothing was built. */
export const WEBSITE_OVER_PROMISE =
  "(?:I(?:'ve|’ve| have)? (?:built|created|published|launched|made|set up) (?:your|a|the) (?:new )?(?:web)?site)|(?:your (?:new )?(?:web)?site is (?:now )?(?:live|ready|published|up))|(?:here(?:'s|’s| is) your (?:new )?(?:web)?site)";

/** The setup card that trapped the host on 2026-11-10. */
export const EVENT_SETUP_TRAP =
  "What['’]s the event called|event setup|Let['’]s set up your event";

function pattern(value) {
  return value instanceof RegExp ? value : new RegExp(value, "i");
}

function matchesValue(expected, actual) {
  if (expected && typeof expected === "object" && "oneOf" in expected) {
    return expected.oneOf.some((item) => matchesValue(item, actual));
  }
  if (expected && typeof expected === "object" && "match" in expected) {
    return typeof actual === "string" && pattern(expected.match).test(actual);
  }
  return JSON.stringify(expected) === JSON.stringify(actual);
}

function fact(name, passed, expected, actual) {
  return { fact: name, passed: Boolean(passed), expected, actual };
}

/**
 * observed = {
 *   route: "proposal:<tool>" | "flow_card:<flow_key>" | "parked" | "text" | "error",
 *   tool?, args?, text, card_id?, new_flow_runs?: string[],
 *   runs?: { flow_key, status }[], handoffs?: string[]
 * }
 */
export function gradeTurn(expect, observed, previous = null) {
  const facts = [];
  const text = String(observed.text ?? "");
  if (expect.route) {
    const allowed = Array.isArray(expect.route) ? expect.route : [expect.route];
    facts.push(
      fact(
        "route",
        allowed.includes(observed.route),
        allowed.join(" | "),
        observed.route,
      ),
    );
  }
  if (expect.not_route) {
    const banned = Array.isArray(expect.not_route)
      ? expect.not_route
      : [expect.not_route];
    facts.push(
      fact(
        "route is not",
        !banned.some((item) => String(observed.route).startsWith(item)),
        `not ${banned.join(" | ")}`,
        observed.route,
      ),
    );
  }
  if (expect.proposal) {
    facts.push(
      fact(
        "proposal tool",
        observed.tool === expect.proposal.tool,
        expect.proposal.tool,
        observed.tool ?? null,
      ),
    );
    for (const [key, value] of Object.entries(expect.proposal.args ?? {})) {
      const actual = observed.args?.[key] ?? null;
      facts.push(
        fact(`proposal ${key}`, matchesValue(value, actual), value, actual),
      );
    }
  }
  if (expect.no_new_flow_run) {
    facts.push(
      fact(
        "no setup started",
        (observed.new_flow_runs ?? []).length === 0,
        [],
        observed.new_flow_runs ?? [],
      ),
    );
  }
  for (const [flowKey, status] of Object.entries(expect.run_status ?? {})) {
    const actual =
      (observed.runs ?? []).find((run) => run.flow_key === flowKey)?.status ??
        null;
    facts.push(fact(`${flowKey} run`, actual === status, status, actual));
  }
  for (const needle of expect.reply_must ?? []) {
    facts.push(
      fact(
        `reply says /${needle}/`,
        pattern(needle).test(text),
        needle,
        text.slice(0, 200),
      ),
    );
  }
  for (const needle of expect.reply_must_not ?? []) {
    facts.push(
      fact(
        `reply never says /${String(needle).slice(0, 40)}/`,
        !pattern(needle).test(text),
        `not ${needle}`,
        text.slice(0, 200),
      ),
    );
  }
  // Always: claims match receipts, no same card twice, no time zone handoff.
  const claims = PAST_WRITE_CLAIM.test(text);
  facts.push(
    fact(
      "claims match the card on screen",
      !claims || String(observed.route).startsWith("proposal:"),
      "no past-write claim without a proposal card",
      claims ? text.slice(0, 160) : "no claim",
    ),
  );
  if (previous?.card_id && observed.card_id) {
    facts.push(
      fact(
        "never the same card twice",
        previous.card_id !== observed.card_id,
        `not ${previous.card_id}`,
        observed.card_id,
      ),
    );
  }
  facts.push(
    fact(
      "no time zone handoff",
      !(observed.handoffs ?? []).includes("timezone"),
      "no timezone handoff",
      observed.handoffs ?? [],
    ),
  );
  return facts;
}

/** Grade a whole scripted thread: one entry per turn. */
export function gradeThread(fixture, observedTurns) {
  const turns = fixture.turns.map((turn, index) => {
    const observed = observedTurns[index] ?? { route: "error", text: "" };
    const facts = gradeTurn(
      turn.expect ?? {},
      observed,
      index > 0 ? observedTurns[index - 1] : null,
    );
    return { say: turn.say, observed, facts };
  });
  const facts = turns.flatMap((turn) => turn.facts);
  const passedFacts = facts.filter((item) => item.passed).length;
  return {
    id: fixture.id,
    passed: facts.length > 0 && passedFacts === facts.length,
    score: facts.length ? round(passedFacts / facts.length * 100) : 0,
    facts_passed: passedFacts,
    facts_total: facts.length,
    turns,
  };
}

export function round(value, places = 1) {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

/** p50 / p95 of a list of milliseconds (nearest rank). */
export function percentiles(values) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) =>
    a - b
  );
  const rank = (p) =>
    sorted.length
      ? sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)]
      : null;
  return { n: sorted.length, p50: rank(0.5), p95: rank(0.95) };
}

/**
 * The run's scores. suites = { replay: [graded threads], flows: [{id,
 * passed, facts}], route_table: { total, misroutes } }. Each suite scores out
 * of 100; overall is their mean.
 */
export function scoreRun(suites) {
  const scores = {};
  if (suites.replay?.length) {
    scores.replay = round(
      suites.replay.reduce((sum, item) => sum + item.score, 0) /
        suites.replay.length,
    );
  }
  if (suites.flows?.length) {
    const ran = suites.flows.filter((item) => !item.skipped);
    scores.flows = ran.length
      ? round(ran.filter((item) => item.passed).length / ran.length * 100)
      : 0;
  }
  if (suites.route_table?.total) {
    scores.route_table = round(
      (1 - suites.route_table.misroutes / suites.route_table.total) * 100,
    );
  }
  const values = Object.values(scores);
  return {
    ...scores,
    overall: values.length
      ? round(values.reduce((sum, value) => sum + value, 0) / values.length)
      : 0,
  };
}

/** Points that count as a release-blocking drop (2 or more). */
export const GATE_DROP_POINTS = 2;

/**
 * The release gate: compare a run's scores with the stored baseline. Any
 * suite (or overall) that drops by GATE_DROP_POINTS or more fails; a suite
 * the baseline scored and the run is missing also fails.
 */
export function compareToBaseline(baseline, run, dropPoints = GATE_DROP_POINTS) {
  const drops = [];
  const base = baseline?.scores ?? {};
  const now = run?.scores ?? {};
  for (const [suite, before] of Object.entries(base)) {
    const after = now[suite];
    if (typeof after !== "number") {
      drops.push({ suite, before, after: null, drop: null, reason: "missing" });
      continue;
    }
    const drop = round(before - after);
    if (drop >= dropPoints) drops.push({ suite, before, after, drop });
  }
  return { ok: drops.length === 0, drops };
}

/** The stored baseline for a run (what gate.mjs compares later runs with). */
export function baselineFromRun(run) {
  return {
    schemaVersion: 1,
    ownerIssue: "#3355",
    description:
      "Ari live-eval baseline (local stack, Gemini Flash). scripts/ari/eval/gate.mjs fails a run that drops 2+ points on any suite or overall. Refresh with run-live.mjs --write-baseline, or gate.mjs --promote --run=<run.json>, after a reviewed improvement.",
    run_id: run.run_id,
    ran_at: run.ran_at,
    revision: run.revision,
    scores: run.scores,
    replay: (run.suites?.replay ?? []).map((item) => ({ id: item.id, score: item.score })),
    flows: (run.suites?.flows ?? []).map((item) => ({
      id: item.id,
      verdict: item.skipped ? "skipped" : item.passed ? "pass" : "fail",
    })),
    route_table: {
      total: run.suites?.route_table?.total ?? 0,
      misroutes: run.suites?.route_table?.misroutes ?? 0,
    },
    latency: run.latency ?? null,
  };
}
