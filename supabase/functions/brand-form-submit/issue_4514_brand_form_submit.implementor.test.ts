// #4514 brand-form-submit (SC-6, SC-8, SC-18, SC-19, SC-20, SC-22, SC-23). Hermetic: the real
// handler and the real shared contract over an in-memory database; the SQL core's own rules
// are proved by supabase/migrations/__tests__/issue_4514_brand_forms.implementor.pg17.test.sql.
// MINGLA-INVARIANT: I-4514-FORM-LINK-ONE-FORM-ONE-RECIPIENT | issue #4514 | with a personal link token the core is called with that link only (any signed-in user, RSVP or order in the body is dropped), and a token refused for another form writes nothing (T-LINK here; pg17 T-LINK).
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type BrandFormSubmitDb,
  corsFor,
  handleBrandFormSubmit,
} from "./submit.ts";
import {
  BRAND_FORM_ERROR_STATUS,
  coreErrorCode,
  corePayload,
  parseSubmitRequest,
} from "../_shared/brandFormsContract.ts";

const FORM = "4514f000-0000-4000-8000-000000000001";
const OTHER_FORM = "4514f000-0000-4000-8000-000000000002";
const USER = "4514a000-0000-4000-8000-000000000001";
const RSVP = "4514b000-0000-4000-8000-000000000001";
const TOKEN = "a".repeat(64);
const ORIGIN = "https://host.usemingla.com";

interface Fake {
  db: BrandFormSubmitDb;
  attempts: string[];
  cores: Array<Record<string, unknown>>;
  logs: string[];
}

function fake(opts: {
  off?: boolean;
  /** #4541 R8.4: the atomic admission's answer (default: admitted). */
  admit?: boolean;
  user?: string | null;
  core?: (
    p: Record<string, unknown>,
  ) => {
    data: Record<string, unknown> | null;
    error: { message: string; details?: string | null } | null;
  };
} = {}): Fake {
  const attempts: string[] = [];
  const cores: Array<Record<string, unknown>> = [];
  const logs: string[] = [];
  const db: BrandFormSubmitDb = {
    switchedOff: () => Promise.resolve(opts.off === true),
    // #4541 R8.4: one admission row per request (its bucket), written before
    // any other database work; the old count-then-record pair is gone.
    attemptAdmit: (_h, _f, bucket) => {
      attempts.push(bucket);
      return Promise.resolve({ allowed: opts.admit !== false });
    },
    userFromBearer: () =>
      Promise.resolve(opts.user === undefined ? USER : opts.user),
    submitCore: (p) => {
      cores.push(p);
      return Promise.resolve(
        opts.core ? opts.core(p) : {
          data: {
            responseId: "r1",
            editCount: 0,
            versionId: "v1",
            created: true,
          },
          error: null,
        },
      );
    },
  };
  return { db, attempts, cores, logs };
}

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("https://x.supabase.co/functions/v1/brand-form-submit", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: ORIGIN,
      "x-forwarded-for": "203.0.113.9",
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function run(
  f: Fake,
  req: Request,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await handleBrandFormSubmit(req, {
    db: f.db,
    log: (l) => f.logs.push(l),
    ipSalt: () => Promise.resolve("t".repeat(64)),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const ANSWERS = { "11111111-1111-4111-8111-111111111111": "yes" };

Deno.test("T-OK a signed-in holder's answer is saved through the core with their RSVP", async () => {
  const f = fake();
  const r = await run(
    f,
    post({ formId: FORM, answers: ANSWERS, rsvpId: RSVP }, {
      authorization: "Bearer jwt",
    }),
  );
  assertEquals(r.status, 200);
  assertEquals(r.body.responseId, "r1");
  assertEquals(f.cores[0].credential, {
    kind: "user",
    userId: USER,
    rsvpId: RSVP,
  });
  assertEquals(f.cores[0].source, "page");
  // #4541 R8.4: the admission row (accepted/rejected are no longer recorded separately).
  assertEquals(f.attempts, ["unknown"]);
});

Deno.test("T-AUTH no token and no sign-in: 401 and the core is never called", async () => {
  const f = fake({ user: null });
  const r = await run(
    f,
    post({ formId: FORM, answers: ANSWERS }, {
      authorization: "Bearer anon-key",
    }),
  );
  assertEquals(r.status, 401);
  assertEquals(r.body.error, "sign_in_required");
  assertEquals(f.cores.length, 0);
});

Deno.test("T-LINK a personal link ignores the bearer, RSVP and order in the body", async () => {
  const f = fake();
  const r = await run(
    f,
    post({ formId: FORM, answers: ANSWERS, token: TOKEN, rsvpId: RSVP }, {
      authorization: "Bearer jwt",
    }),
  );
  assertEquals(r.status, 200);
  assertEquals(f.cores[0].credential, {
    kind: "link",
    token: TOKEN,
    challengeId: null,
  });
  assertEquals(f.cores[0].source, "link");
});

Deno.test("T-LINK SC-22 a token for another form is refused (403) and nothing is written", async () => {
  const f = fake({
    core: () => ({ data: null, error: { message: "link_wrong_form" } }),
  });
  const r = await run(
    f,
    post({ formId: OTHER_FORM, answers: ANSWERS, token: TOKEN }),
  );
  assertEquals(r.status, 403);
  assertEquals(r.body.error, "link_wrong_form");
  // #4541 R8.4: a refused submit still counts (its admission row was written first).
  assertEquals(f.attempts, ["unknown"]);
});

Deno.test("T-LINK SC-20 an existing answer through a link needs the code", async () => {
  const f = fake({
    core: () => ({ data: null, error: { message: "code_required" } }),
  });
  const r = await run(
    f,
    post({
      formId: FORM,
      answers: ANSWERS,
      token: TOKEN,
      expectedEditCount: 0,
    }),
  );
  assertEquals(r.status, 403);
  assertEquals(r.body.error, "code_required");
});

Deno.test("T-LINK revoked and unknown tokens are refused", async () => {
  for (const code of ["link_revoked", "link_invalid"]) {
    const f = fake({ core: () => ({ data: null, error: { message: code } }) });
    const r = await run(
      f,
      post({ formId: FORM, answers: ANSWERS, token: TOKEN }),
    );
    assertEquals(r.status, 403);
    assertEquals(r.body.error, code);
  }
});

Deno.test("T-PAUSED SC-23 the database off switch answers 503 before anything else", async () => {
  const f = fake({ off: true });
  const r = await run(
    f,
    post({ formId: FORM, answers: ANSWERS }, { authorization: "Bearer jwt" }),
  );
  assertEquals(r.status, 503);
  assertEquals(r.body.error, "forms_paused");
  assertEquals(f.cores.length, 0);
});

Deno.test("T-RATE SC-23 a request the admission refuses: 429 and the core is never called", async () => {
  // #4541 R8.4: the limits (20 / 10 min, 100 / 24 h) are counted atomically in
  // SQL (brand_form_attempt_admit, proved by the M-A pg17 suite T-11).
  const f = fake({ admit: false });
  const r = await run(
    f,
    post({ formId: FORM, answers: ANSWERS }, { authorization: "Bearer jwt" }),
  );
  assertEquals(r.status, 429);
  assertEquals(r.body.error, "rate_limited");
  assertEquals(f.cores.length, 0);
  assertEquals(f.attempts, ["unknown"]);
});

Deno.test("T-CORE every core refusal maps to its status, with its details", async () => {
  const cases: Array<
    [string, string | null, number, string, Record<string, unknown>]
  > = [
    [
      "form_answers_invalid",
      '[{"questionId":"q1","code":"required"}]',
      422,
      "form_answers_invalid",
      { errors: [{ questionId: "q1", code: "required" }] },
    ],
    ["form_changed", '{"versionId":"v2"}', 409, "form_changed", {
      versionId: "v2",
    }],
    ["response_stale", '{"editCount":3}', 409, "response_stale", {
      editCount: 3,
    }],
    ["form_closed", null, 410, "form_closed", {}],
    ["not_holder", null, 403, "not_holder", {}],
    ["form_not_on_event", null, 403, "form_not_on_event", {}],
    ["some unexpected failure", null, 500, "server_error", {}],
  ];
  for (const [message, details, status, code, extra] of cases) {
    const f = fake({
      core: () => ({ data: null, error: { message, details } }),
    });
    const r = await run(
      f,
      post({ formId: FORM, answers: ANSWERS }, { authorization: "Bearer jwt" }),
    );
    assertEquals(r.status, status, message);
    assertEquals(r.body.error, code);
    for (const [k, v] of Object.entries(extra)) assertEquals(r.body[k], v);
  }
});

Deno.test("T-SHAPE bad bodies are 400; oversize is 413; unknown origins are 403", async () => {
  const f = fake();
  assertEquals((await run(f, post("not json"))).status, 400);
  assertEquals(
    (await run(f, post({ formId: "nope", answers: {} }))).status,
    400,
  );
  assertEquals((await run(f, post({ formId: FORM, answers: [] }))).status, 400);
  assertEquals(
    (await run(f, post({ formId: FORM, answers: {}, extra: 1 }))).status,
    400,
  );
  assertEquals(
    (await run(f, post({ formId: FORM, answers: {}, token: "short" }))).status,
    400,
  );
  assertEquals(
    (await run(
      f,
      post({ formId: FORM, answers: {}, rsvpId: RSVP, orderId: RSVP }),
    )).status,
    400,
  );
  assertEquals(
    (await run(f, post({ formId: FORM, answers: { q: "x".repeat(40_000) } })))
      .status,
    413,
  );
  assertEquals(
    (await run(
      f,
      post({ formId: FORM, answers: {} }, { origin: "https://evil.example" }),
    )).status,
    403,
  );
  assertEquals(f.cores.length, 0);
});

Deno.test("T-CORS native apps (no Origin) and the host web origins are allowed", () => {
  assert(corsFor(null) !== null);
  assertEquals(
    corsFor("https://host.usemingla.com")?.["Access-Control-Allow-Origin"],
    "https://host.usemingla.com",
  );
  assert(corsFor("https://mingla-business-abc-123.vercel.app") !== null);
  assertEquals(corsFor("https://usemingla.com.evil.example"), null);
});

Deno.test("T-CONTRACT parse, payload and code helpers", () => {
  const p = parseSubmitRequest({
    formId: FORM.toUpperCase(),
    answers: {},
    expectedEditCount: 2,
    source: "pass",
  });
  assertEquals(p?.formId, FORM);
  assertEquals(
    parseSubmitRequest({ formId: FORM, answers: {}, expectedEditCount: -1 }),
    null,
  );
  assertEquals(
    parseSubmitRequest({ formId: FORM, answers: {}, source: "fax" }),
    null,
  );
  assertEquals(corePayload({ formId: FORM, answers: {} }, null), null);
  assertEquals(coreErrorCode("form_closed"), "form_closed");
  assertEquals(coreErrorCode("permission denied for table x"), "server_error");
  assertEquals(BRAND_FORM_ERROR_STATUS.forms_paused, 503);
});
