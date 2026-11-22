// #4541 wave 1, brand-form-submit (R1.14 page_form, R8.4 address and admission,
// R8.5 bot ticket, the new error codes). Hermetic: the real handler over an
// in-memory database. The SQL admission itself is proved by
// supabase/migrations/__tests__/issue_4541_forms_fixes.implementor.pg17.test.sql (T-11).
// MINGLA-INVARIANT: I-4541-PLATFORM-ADDRESS-ONLY | issue #4541 | brand-form-submit keys its limits on the platform-set address (cf-connecting-ip, then x-real-ip), never a caller-supplied x-forwarded-for hop, and takes one admission before any other database work (T-ADDR, T-ORDER).
//
// FAILS-ON-REVERT: reading x-forwarded-for again fails T-ADDR; moving the switch read before
// the admission fails T-ORDER; dropping the page_form op fails T-PAGE; issuing or accepting
// tickets without the HMAC or the age window fails T-BOT.
import {
  assert,
  assertEquals,
  assertNotEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  __resetUnknownIpLogForTest,
  type AttemptBucket,
  type BrandFormSubmitDb,
  handleBrandFormSubmit,
  hashIp,
} from "./submit.ts";
import {
  BOT_TICKET_MAX_AGE_MS,
  issueBotTicket,
  verifyBotTicket,
} from "./botTicket.ts";
import {
  BRAND_FORM_CORE_CODES,
  BRAND_FORM_ERROR_STATUS,
  coreErrorCode,
} from "../_shared/brandFormsContract.ts";
import { SCOPED_SECRET_LABELS } from "../_shared/derivedSecret.ts";

const FORM = "45410000-0000-4000-8000-0000000000f1";
const EVENT = "45410000-0000-4000-8000-0000000000e1";
const ORIGIN = "https://host.usemingla.com";
const SALT = "s".repeat(64);
const KEY = () => Promise.resolve("k".repeat(64));

interface Fake {
  db: BrandFormSubmitDb;
  calls: string[];
  admits: Array<{ hash: string; formId: string | null; bucket: AttemptBucket }>;
  logs: string[];
  pageReads: string[];
}

function fake(opts: { allowed?: boolean; off?: boolean; page?: unknown } = {}): Fake {
  const calls: string[] = [];
  const admits: Fake["admits"] = [];
  const logs: string[] = [];
  const pageReads: string[] = [];
  const db: BrandFormSubmitDb = {
    switchedOff: () => {
      calls.push("switchedOff");
      return Promise.resolve(opts.off === true);
    },
    attemptAdmit: (hash, formId, bucket) => {
      calls.push("attemptAdmit");
      admits.push({ hash, formId, bucket });
      return Promise.resolve({ allowed: opts.allowed !== false });
    },
    userFromBearer: () => {
      calls.push("userFromBearer");
      return Promise.resolve("45410000-0000-4000-8000-0000000000a1");
    },
    submitCore: () => {
      calls.push("submitCore");
      return Promise.resolve({
        data: { responseId: "r1", editCount: 0, versionId: "v1", created: true },
        error: null,
      });
    },
  };
  return { db, calls, admits, logs, pageReads };
}

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("https://x.supabase.co/functions/v1/brand-form-submit", {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN, ...headers },
    body: JSON.stringify(body),
  });
}

async function run(f: Fake, req: Request, page?: unknown) {
  const res = await handleBrandFormSubmit(req, {
    db: f.db,
    log: (l) => f.logs.push(l),
    ipSalt: () => Promise.resolve(SALT),
    page: {
      pageForm: (eventId) => {
        f.pageReads.push(eventId);
        return Promise.resolve(
          page === "error"
            ? { data: null, error: { message: "boom" } }
            : { data: page ?? { active: false }, error: null },
        );
      },
      botTicketKey: KEY,
    },
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const SUBMIT = {
  formId: FORM,
  eventId: EVENT,
  answers: { "11111111-1111-4111-8111-111111111111": "yes" },
};

Deno.test("T-ADDR SC-48 two forged x-forwarded-for values from one client land in one bucket", async () => {
  const f = fake();
  await run(
    f,
    post(SUBMIT, {
      authorization: "Bearer jwt",
      "cf-connecting-ip": "1.1.1.1",
      "x-forwarded-for": "8.8.8.8",
    }),
  );
  await run(
    f,
    post(SUBMIT, {
      authorization: "Bearer jwt",
      "cf-connecting-ip": "1.1.1.1",
      "x-forwarded-for": "9.9.9.9, 10.0.0.1",
    }),
  );
  assertEquals(f.admits.length, 2);
  assertEquals(f.admits[0].hash, f.admits[1].hash);
  assertEquals(f.admits[0].hash, await hashIp("1.1.1.1", SALT));
  assertEquals(f.admits.map((a) => a.bucket), ["submit", "submit"]);
  assertEquals(f.admits[0].formId, FORM);
});

Deno.test("T-ADDR with no platform address every caller shares the unknown bucket, logged once", async () => {
  __resetUnknownIpLogForTest();
  const f = fake();
  await run(f, post(SUBMIT, { authorization: "Bearer jwt", "x-forwarded-for": "8.8.8.8" }));
  await run(f, post(SUBMIT, { authorization: "Bearer jwt", "x-forwarded-for": "9.9.9.9" }));
  assertEquals(f.admits.map((a) => a.bucket), ["unknown", "unknown"]);
  assertEquals(f.admits[0].hash, f.admits[1].hash);
  assertEquals(f.logs.filter((l) => l.includes("ip_unknown")).length, 1);
});

Deno.test("T-ORDER the admission is the first database call; a refused one stops everything (429)", async () => {
  const f = fake({ allowed: false });
  const r = await run(
    f,
    post(SUBMIT, { authorization: "Bearer jwt", "cf-connecting-ip": "1.1.1.1" }),
  );
  assertEquals(r.status, 429);
  assertEquals(r.body.error, "rate_limited");
  assertEquals(f.calls, ["attemptAdmit"]);
  const ok = fake();
  await run(ok, post(SUBMIT, { authorization: "Bearer jwt", "cf-connecting-ip": "1.1.1.1" }));
  assertEquals(ok.calls, ["attemptAdmit", "switchedOff", "userFromBearer", "submitCore"]);
});

Deno.test("T-PAGE R1.14 page_form returns exactly the SQL payload, plus a bot ticket for a live form", async () => {
  const payload = {
    active: true,
    mode: "required_step",
    formId: FORM,
    name: "Guest questions",
    questionCount: 1,
    versionId: "45410000-0000-4000-8000-0000000000b1",
    definition: { questions: [] },
    requiredForm: { formId: FORM, versionId: "45410000-0000-4000-8000-0000000000b1" },
    doorFullAnswers: false,
    brand: { brandId: "b", displayName: "Brand" },
  };
  const f = fake();
  const r = await run(
    f,
    post({ op: "page_form", eventId: EVENT.toUpperCase() }, { "cf-connecting-ip": "1.1.1.1" }),
    payload,
  );
  assertEquals(r.status, 200);
  const { botTicket, ...rest } = r.body as Record<string, unknown>;
  assertEquals(rest, payload);
  assert(typeof botTicket === "string" && botTicket.includes("."));
  assertEquals(f.pageReads, [EVENT]);
  assertEquals(f.admits.map((a) => a.bucket), ["read"]);
  assertEquals(f.admits[0].formId, null);
  // No live form: the payload as is, and no ticket.
  const g = fake();
  const none = await run(g, post({ op: "page_form", eventId: EVENT }), {
    active: false,
    switchedOff: true,
  });
  assertEquals(none.body, { active: false, switchedOff: true });
});

Deno.test("T-PAGE page_form is limited per address, refuses bad bodies and reports a database error", async () => {
  const limited = fake({ allowed: false });
  const r = await run(limited, post({ op: "page_form", eventId: EVENT }));
  assertEquals(r.status, 429);
  assertEquals(limited.pageReads.length, 0);
  for (const bad of [{ op: "page_form" }, { op: "page_form", eventId: "x" }, { op: "page_form", eventId: EVENT, extra: 1 }]) {
    const f = fake();
    const res = await run(f, post(bad));
    assertEquals(res.status, 400);
    assertEquals(f.admits.length, 0);
  }
  const broken = fake();
  const err = await run(broken, post({ op: "page_form", eventId: EVENT }), "error");
  assertEquals(err.status, 500);
  assertEquals(err.body.error, "server_error");
});

Deno.test("T-BOT R8.5 a ticket is valid only for its form and campaign, 3 s to 2 h old, untampered", async () => {
  const t0 = 1_800_000_000_000;
  const ticket = await issueBotTicket(FORM, "c1", KEY, t0);
  assert(ticket !== null);
  assertEquals(await verifyBotTicket(ticket, FORM, "c1", KEY, t0 + 2_000), false);
  assertEquals(await verifyBotTicket(ticket, FORM, "c1", KEY, t0 + 3_000), true);
  assertEquals(await verifyBotTicket(ticket, FORM, "c1", KEY, t0 + BOT_TICKET_MAX_AGE_MS + 1), false);
  assertEquals(await verifyBotTicket(ticket, FORM, "c2", KEY, t0 + 5_000), false);
  assertEquals(await verifyBotTicket(ticket, EVENT, "c1", KEY, t0 + 5_000), false);
  const [issued, sig] = ticket.split(".");
  const flipped = sig.slice(0, -1) + (sig.endsWith("A") ? "B" : "A");
  assertEquals(await verifyBotTicket(`${issued}.${flipped}`, FORM, "c1", KEY, t0 + 5_000), false);
  const other = () => Promise.resolve("o".repeat(64));
  assertEquals(await verifyBotTicket(ticket, FORM, "c1", other, t0 + 5_000), false);
  for (const junk of [undefined, null, 3, "", "a.b.c", "x".repeat(300)]) {
    assertEquals(await verifyBotTicket(junk, FORM, "c1", KEY, t0 + 5_000), false);
  }
  // No key: nothing is issued and nothing verifies (the Unknown path fails closed).
  const none = () => Promise.reject(new Error("scoped_secret_root_unavailable"));
  assertEquals(await issueBotTicket(FORM, null, none, t0), null);
  assertEquals(await verifyBotTicket(ticket, FORM, "c1", none, t0 + 5_000), false);
  assertEquals(SCOPED_SECRET_LABELS.brandFormBotTicket, "brand-form-bot-ticket");
  assertNotEquals(await issueBotTicket(FORM, null, KEY, t0), await issueBotTicket(FORM, "c1", KEY, t0));
});

Deno.test("T-CODES §15 the new codes and their statuses", () => {
  assertEquals(BRAND_FORM_ERROR_STATUS.not_current, 403);
  assertEquals(BRAND_FORM_ERROR_STATUS.open_reply_limit, 429);
  assertEquals(BRAND_FORM_ERROR_STATUS.bot_check_failed, 422);
  assert(BRAND_FORM_CORE_CODES.includes("not_current"));
  assert(BRAND_FORM_CORE_CODES.includes("open_reply_limit"));
  assertEquals(coreErrorCode("not_current", "42501"), "not_current");
  assertEquals(coreErrorCode("open_reply_limit", "54000"), "open_reply_limit");
});

Deno.test("T-CODES a not_current refusal from the core is a 403", async () => {
  const f = fake();
  f.db.submitCore = () =>
    Promise.resolve({ data: null, error: { message: "not_current", code: "42501" } });
  const r = await run(f, post(SUBMIT, { authorization: "Bearer jwt", "cf-connecting-ip": "1.1.1.1" }));
  assertEquals(r.status, 403);
  assertEquals(r.body.error, "not_current");
});
