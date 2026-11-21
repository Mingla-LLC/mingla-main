// #4514 wave 1 review fixes, edge side (findings 3 and 9). Hermetic: the real handler and the
// real shared contract over an in-memory database whose core behaves like PostgreSQL where it
// matters here (jsonb refuses NUL and lone surrogates with 22P05; a data exception is 22xxx).
// MINGLA-INVARIANT: I-4514-BAD-INPUT-IS-VALIDATION | issue #4514 | no request body reaches a 500 through brand-form-submit: input the database cannot store is refused as 422 form_answers_invalid before the core, and any data exception the core raises maps to the same 422 (T-INPUT, T-NO500 here; pg17 T-HOSTILE).
import {
  assert,
  assertEquals,
  assertNotEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type BrandFormSubmitDb,
  clientIp,
  defaultIpSalt,
  handleBrandFormSubmit,
  hashIp,
} from "./submit.ts";
import {
  coreErrorCode,
  unstorableAnswerErrors,
} from "../_shared/brandFormsContract.ts";

const FORM = "4514f000-0000-4000-8000-000000000001";
const ORIGIN = "https://host.usemingla.com";
const Q = "11111111-1111-4111-8111-111111111111";
const ROOT_A = "a".repeat(48);
const ROOT_B = "b".repeat(48);

interface Fake {
  db: BrandFormSubmitDb;
  cores: string[];
  hashes: string[];
}

// The core serialises like supabase-js and refuses what PostgreSQL's jsonb refuses.
function pgLikeFake(
  core?: (json: string) => {
    data: Record<string, unknown> | null;
    error:
      | { message: string; details?: string | null; code?: string | null }
      | null;
  },
): Fake {
  const cores: string[] = [];
  const hashes: string[] = [];
  const db: BrandFormSubmitDb = {
    switchedOff: () => Promise.resolve(false),
    countAttempts: () => Promise.resolve({ ip10m: 0, ip24h: 0 }),
    recordAttempt: (h) => {
      hashes.push(h);
      return Promise.resolve();
    },
    userFromBearer: () =>
      Promise.resolve("4514a000-0000-4000-8000-000000000001"),
    submitCore: (p) => {
      const json = JSON.stringify(p);
      cores.push(json);
      if (
        /\\u0000|\\ud[89ab][0-9a-f]{2}(?!\\ud[c-f])|(?<!\\ud[89ab][0-9a-f]{2})\\ud[c-f][0-9a-f]{2}/i
          .test(json)
      ) {
        return Promise.resolve({
          data: null,
          error: {
            message: "unsupported Unicode escape sequence",
            code: "22P05",
          },
        });
      }
      return Promise.resolve(
        core ? core(json) : {
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
  return { db, cores, hashes };
}

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("https://x.supabase.co/functions/v1/brand-form-submit", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: ORIGIN,
      authorization: "Bearer jwt",
      "x-forwarded-for": "203.0.113.9, 10.0.0.1",
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function run(f: Fake, req: Request, salt = "s".repeat(64)) {
  const res = await handleBrandFormSubmit(req, {
    db: f.db,
    log: () => {},
    ipSalt: () => Promise.resolve(salt),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const HOSTILE: Array<[string, unknown]> = [
  ["NUL in a text answer", { [Q]: "a\u0000b" }],
  ["NUL in an answer key", { ["q\u0000"]: "x" }],
  ["a lone high surrogate", { [Q]: "x\uD800" }],
  ["a lone low surrogate", { [Q]: "\uDC00x" }],
  ["NUL inside a multi choice", { [Q]: ["yes", "\u0000"] }],
  ["an object answer", { [Q]: { deep: { deeper: 1 } } }],
  ["a nested array answer", { [Q]: [["yes"]] }],
];

Deno.test("T-INPUT input the database cannot store is 422 form_answers_invalid and never reaches the core", async () => {
  for (const [label, answers] of HOSTILE) {
    const f = pgLikeFake();
    const r = await run(f, post({ formId: FORM, answers }));
    assertEquals(r.status, 422, label);
    assertEquals(r.body.error, "form_answers_invalid", label);
    assert(Array.isArray(r.body.errors) && r.body.errors.length === 1, label);
    assertEquals(f.cores.length, 0, label);
  }
  assertEquals(
    unstorableAnswerErrors({ [Q]: "fine", x: 3, y: ["a", "b"], z: null }),
    [],
  );
});

Deno.test("T-NO500 no answer of any type yields a server error", async () => {
  // The core answers a data exception for an impossible date, as wave 1's SQL did (22008).
  const core = (json: string) =>
    /2026-02-30|0000-01-01/.test(json)
      ? {
        data: null,
        error: {
          message: 'date/time field value out of range: "2026-02-30"',
          code: "22008",
        },
      }
      : /"x{5000}"/.test(json)
      ? {
        data: null,
        error: {
          message: "form_answers_invalid",
          details: `[{"questionId":"${Q}","code":"too_long"}]`,
          code: "22023",
        },
      }
      : {
        data: {
          responseId: "r1",
          editCount: 0,
          versionId: "v1",
          created: true,
        },
        error: null,
      };
  const bodies: unknown[] = [
    ...HOSTILE.map(([, answers]) => ({ formId: FORM, answers })),
    { formId: FORM, answers: { [Q]: "2026-02-30" } },
    { formId: FORM, answers: { [Q]: "0000-01-01" } },
    { formId: FORM, answers: { [Q]: "x".repeat(5000) } },
    { formId: FORM, answers: { [Q]: 1e308 } },
    { formId: FORM, answers: { [Q]: -0.000001 } },
    { formId: FORM, answers: { [Q]: true } },
    { formId: FORM, answers: { [Q]: "" } },
    { formId: FORM, answers: { [Q]: "‮😀 emoji and bidi" } },
    { formId: FORM, answers: {}, expectedEditCount: 1e12 },
    { formId: FORM, answers: {}, expectedEditCount: 1.5 },
    '{"formId":"' + FORM + '","answers":{"q":"\\u0000"}}',
    "[]",
    "null",
    '{"formId":' + "[".repeat(5000) + "]".repeat(5000) + "}",
  ];
  for (const body of bodies) {
    const f = pgLikeFake(core);
    const r = await run(f, post(body));
    assertNotEquals(r.status, 500, JSON.stringify(body).slice(0, 80));
    assert(
      [200, 400, 413, 422].includes(r.status),
      `${r.status} for ${JSON.stringify(body).slice(0, 80)}`,
    );
  }
});

Deno.test("T-NO500 a data exception from the core maps to 422 form_answers_invalid, other failures stay 500", async () => {
  for (const code of ["22008", "22P02", "22P05", "22003", "2201B"]) {
    const f = pgLikeFake(() => ({
      data: null,
      error: { message: "some data error", code },
    }));
    const r = await run(f, post({ formId: FORM, answers: { [Q]: "ok" } }));
    assertEquals(r.status, 422, code);
    assertEquals(r.body.error, "form_answers_invalid", code);
    assertEquals(r.body.errors, [{ questionId: null, code: "type" }]);
  }
  assertEquals(
    coreErrorCode("permission denied for table x", "42501"),
    "server_error",
  );
  assertEquals(coreErrorCode("boom", null), "server_error");
  assertEquals(coreErrorCode("form_closed", "22023"), "form_closed");
});

Deno.test("T-SALT the address salt is derived from the service-role key, not a constant in the repo", async () => {
  const a = await defaultIpSalt({ get: () => ROOT_A });
  const b = await defaultIpSalt({ get: () => ROOT_B });
  assertEquals(a.length, 64);
  assertNotEquals(a, b);
  assertEquals(a, await defaultIpSalt({ get: () => ROOT_A }));
  await assertRejects(() => defaultIpSalt({ get: () => undefined }));
  // The same address hashes differently under a different root.
  assertNotEquals(
    await hashIp("203.0.113.9", a),
    await hashIp("203.0.113.9", b),
  );
  await assertRejects(() => hashIp("203.0.113.9", ""));
});

Deno.test("T-SALT the address is read exactly as forms-submit reads it (first x-forwarded-for hop)", async () => {
  const req = (h: Record<string, string>) =>
    new Request("https://x", { headers: h });
  assertEquals(
    clientIp(req({ "x-forwarded-for": "198.51.100.4, 10.0.0.1" })),
    "198.51.100.4",
  );
  // A spoofable header the forms function does not read is ignored.
  assertEquals(
    clientIp(
      req({
        "cf-connecting-ip": "192.0.2.1",
        "x-forwarded-for": "198.51.100.4",
      }),
    ),
    "198.51.100.4",
  );
  assertEquals(clientIp(req({})), "unknown");
  const f = pgLikeFake();
  const salt = await defaultIpSalt({ get: () => ROOT_A });
  await run(
    f,
    post({ formId: FORM, answers: { [Q]: "ok" } }, {
      "cf-connecting-ip": "192.0.2.1",
    }),
    salt,
  );
  assertEquals(f.hashes, [await hashIp("203.0.113.9", salt)]);
});

Deno.test("T-SALT no salt: the request fails closed (500) and nothing is written", async () => {
  const f = pgLikeFake();
  const res = await handleBrandFormSubmit(
    post({ formId: FORM, answers: { [Q]: "ok" } }),
    {
      db: f.db,
      log: () => {},
      ipSalt: () => Promise.reject(new Error("scoped_secret_root_unavailable")),
    },
  );
  assertEquals(res.status, 500);
  assertEquals(f.cores.length, 0);
  assertEquals(f.hashes.length, 0);
});
