// #4514 wave 3: the link page's one-time code actions on brand-form-submit (C2,
// decision 12). Hermetic: the real handler and ./code.ts over an in-memory stand-in
// for the SQL rail that behaves like brand_form_code_begin / _challenge / _settle
// (purpose and link checks, 5 tries, one use). The SQL itself is proven in the pg17
// suite (T-W3-CODE).
// MINGLA-INVARIANT: I-4514-FORM-CODE-THIS-LINK-ONLY | issue #4514 | a link-page code check settles only a brand form challenge of the same link and form, never a claim or add-contact challenge, never another link's; five wrong codes lock it and a used code is never accepted again (T-CODE-* here; pg17 T-W3-CODE).
import {
  assert,
  assertEquals,
  assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { type BrandFormSubmitDb, handleBrandFormSubmit } from "./submit.ts";
import {
  type CodeDeps,
  maskEmail,
  maskPhone,
  parseCodeRequest,
} from "./code.ts";
import { contactCodeHash } from "../_shared/contactCode.ts";

const FORM = "4514f000-0000-4000-8000-000000000001";
const OTHER_FORM = "4514f000-0000-4000-8000-000000000002";
const ORIGIN = "https://host.usemingla.com";
const TOK_A = "a".repeat(64);
const TOK_B = "b".repeat(64);
const SALT = "code-salt-for-tests";
const CLAIM_CHALLENGE = "4514c000-0000-4000-8000-0000000000cc";

interface Challenge {
  purpose: string;
  link: string | null;
  channel: "email" | "phone";
  target: string;
  hash: string | null;
  attempts: number;
  consumed: boolean;
}

interface World {
  deps: CodeDeps;
  challenges: Map<string, Challenge>;
  sent: Array<{ channel: string; target: string; code: string }>;
  calls: string[];
  logs: string[];
  limited: Set<string>;
  phoneApproves: boolean;
}

// The links: A is Wes (email + phone) on FORM; B is Val (email only) on FORM.
const LINKS: Record<
  string,
  { formId: string; email: string | null; phone: string | null }
> = {
  [TOK_A]: { formId: FORM, email: "wes@example.test", phone: "+12025551001" },
  [TOK_B]: { formId: FORM, email: "val@example.test", phone: null },
};

function world(): World {
  const w: World = {
    challenges: new Map(),
    sent: [],
    calls: [],
    logs: [],
    limited: new Set(),
    phoneApproves: false,
    deps: undefined as unknown as CodeDeps,
  };
  // A claim sign-in challenge (another purpose) that exists in the same table.
  w.challenges.set(CLAIM_CHALLENGE, {
    purpose: "add_contact",
    link: null,
    channel: "email",
    target: "wes@example.test",
    hash: null,
    attempts: 0,
    consumed: false,
  });
  w.deps = {
    codeSalt: () => Promise.resolve(SALT),
    log: (l) => w.logs.push(l),
    allow: (scope) =>
      Promise.resolve(w.limited.has(scope.split(":")[0]) ? "limited" : "allow"),
    sendEmail: (target, code) => {
      w.sent.push({ channel: "email", target, code });
      return Promise.resolve(true);
    },
    startPhone: (phone) => {
      w.sent.push({ channel: "phone", target: phone, code: "" });
      return Promise.resolve({ ok: true });
    },
    checkPhone: () => Promise.resolve({ ok: true, approved: w.phoneApproves }),
    rpc: (name, args) => {
      w.calls.push(name);
      const link = LINKS[String(args.p_token)];
      if (name === "brand_form_link_resolve") {
        if (!link) {
          return Promise.resolve({ data: { outcome: "invalid" }, error: null });
        }
        return Promise.resolve({
          data: {
            outcome: "ok",
            formId: link.formId,
            channels: [link.email ? "email" : null, link.phone ? "phone" : null]
              .filter(Boolean),
          },
          error: null,
        });
      }
      if (name === "brand_form_code_begin") {
        if (!link) {
          return Promise.resolve({ data: { outcome: "invalid" }, error: null });
        }
        const ch = args.p_channel as "email" | "phone";
        const target = ch === "email" ? link.email : link.phone;
        if (!target) {
          return Promise.resolve({
            data: { outcome: ch === "email" ? "no_email" : "no_phone" },
            error: null,
          });
        }
        w.challenges.set(String(args.p_challenge_id), {
          purpose: "brand_form_access",
          link: String(args.p_token),
          channel: ch,
          target,
          hash: (args.p_code_hash as string | null) ?? null,
          attempts: 0,
          consumed: false,
        });
        return Promise.resolve({
          data: { outcome: "started", target },
          error: null,
        });
      }
      const c = w.challenges.get(String(args.p_challenge_id));
      const ofThisLink = !!c && c.purpose === "brand_form_access" &&
        c.link === args.p_token && !c.consumed;
      if (name === "brand_form_code_challenge") {
        return Promise.resolve({
          data: ofThisLink
            ? {
              outcome: "ok",
              channel: c!.channel,
              target: c!.target,
              formId: LINKS[c!.link!].formId,
            }
            : { outcome: "invalid" },
          error: null,
        });
      }
      if (name === "brand_form_code_settle") {
        if (!ofThisLink) {
          return Promise.resolve({ data: { outcome: "invalid" }, error: null });
        }
        if (c!.attempts >= 5) {
          return Promise.resolve({ data: { outcome: "locked" }, error: null });
        }
        c!.attempts += 1;
        const ok = c!.channel === "email"
          ? c!.hash === args.p_code_hash
          : args.p_provider_approved === true;
        if (!ok) {
          return Promise.resolve({
            data: { outcome: "bad_code", attemptsLeft: 5 - c!.attempts },
            error: null,
          });
        }
        c!.consumed = true;
        return Promise.resolve({ data: { outcome: "ok" }, error: null });
      }
      return Promise.resolve({
        data: null,
        error: { message: "unexpected rpc " + name },
      });
    },
  };
  return w;
}

const db: BrandFormSubmitDb = {
  switchedOff: () => Promise.resolve(false),
  attemptAdmit: () => Promise.resolve({ allowed: true }),
  userFromBearer: () => Promise.resolve(null),
  submitCore: () => Promise.reject(new Error("the code path never submits")),
};

async function call(
  w: World,
  body: Record<string, unknown>,
  switchedOff = false,
) {
  const res = await handleBrandFormSubmit(
    new Request("https://x/brand-form-submit", {
      method: "POST",
      headers: {
        origin: ORIGIN,
        "content-type": "application/json",
        "x-forwarded-for": "203.0.113.9",
      },
      body: JSON.stringify(body),
    }),
    {
      db: { ...db, switchedOff: () => Promise.resolve(switchedOff) },
      code: w.deps,
      ipSalt: () => Promise.resolve("ip-salt"),
      log: (l) => w.logs.push(l),
    },
  );
  return {
    status: res.status,
    body: await res.json() as Record<string, unknown>,
  };
}

Deno.test("T-CODE-BEGIN: the code goes to the contact on file, masked; the client never learns the address", async () => {
  const w = world();
  const r = await call(w, { op: "code_begin", formId: FORM, token: TOK_A });
  assertEquals(r.status, 200);
  assertEquals(r.body.channel, "email");
  assertEquals(r.body.sentTo, "w•••@example.test");
  assertEquals(r.body.otherChannel, true);
  assertEquals(w.sent.length, 1);
  assertEquals(w.sent[0].target, "wes@example.test");
  assertFalse(JSON.stringify(r.body).includes("wes@example.test"));
  const phone = await call(w, {
    op: "code_begin",
    formId: FORM,
    token: TOK_A,
    channel: "phone",
  });
  assertEquals(phone.status, 200);
  assertEquals(phone.body.sentTo, "•••• 1001");
});

Deno.test("T-CODE-BEGIN: no contact on that channel, a link of another form, a bad token: refused, nothing sent", async () => {
  const w = world();
  assertEquals(
    (await call(w, {
      op: "code_begin",
      formId: FORM,
      token: TOK_B,
      channel: "phone",
    })).body.error,
    "no_contact",
  );
  const other = await call(w, {
    op: "code_begin",
    formId: OTHER_FORM,
    token: TOK_A,
  });
  assertEquals(other.status, 403);
  assertEquals(other.body.error, "link_invalid");
  assertEquals(
    (await call(w, { op: "code_begin", formId: FORM, token: "c".repeat(64) }))
      .body.error,
    "link_invalid",
  );
  assertEquals(
    (await call(w, { op: "code_begin", formId: FORM, token: "short" })).status,
    400,
  );
  assertEquals(w.sent.length, 0);
});

Deno.test("T-CODE-LIMIT: over the address send or check limit: 429, nothing sent, nothing settled", async () => {
  const w = world();
  w.limited.add("bf_code_send");
  const r = await call(w, { op: "code_begin", formId: FORM, token: TOK_A });
  assertEquals(r.status, 429);
  assertEquals(w.sent.length, 0);
  w.limited.clear();
  const begun = await call(w, { op: "code_begin", formId: FORM, token: TOK_A });
  w.limited.add("bf_code_check");
  const v = await call(w, {
    op: "code_verify",
    formId: FORM,
    token: TOK_A,
    challengeId: begun.body.challengeId,
    code: w.sent[0].code,
  });
  assertEquals(v.status, 429);
  assertFalse(w.calls.includes("brand_form_code_settle"));
});

Deno.test("T-CODE-BRUTE: five wrong codes count down, then even the right code is locked", async () => {
  const w = world();
  const begun = await call(w, { op: "code_begin", formId: FORM, token: TOK_A });
  const id = String(begun.body.challengeId);
  const right = w.sent[0].code;
  const wrong = right === "000000" ? "111111" : "000000";
  for (let left = 4; left >= 0; left--) {
    const r = await call(w, {
      op: "code_verify",
      formId: FORM,
      token: TOK_A,
      challengeId: id,
      code: wrong,
    });
    assertEquals(r.status, 400);
    assertEquals(r.body.error, "bad_code");
    assertEquals(r.body.attemptsLeft, left);
  }
  const locked = await call(w, {
    op: "code_verify",
    formId: FORM,
    token: TOK_A,
    challengeId: id,
    code: right,
  });
  assertEquals(locked.status, 429);
  assertEquals(locked.body.error, "locked");
});

Deno.test("T-CODE-REPLAY: a used code is never accepted again", async () => {
  const w = world();
  const begun = await call(w, { op: "code_begin", formId: FORM, token: TOK_A });
  const body = {
    op: "code_verify",
    formId: FORM,
    token: TOK_A,
    challengeId: begun.body.challengeId,
    code: w.sent[0].code,
  };
  const ok = await call(w, body);
  assertEquals(ok.status, 200);
  assertEquals(ok.body, { ok: true, challengeId: begun.body.challengeId });
  const again = await call(w, body);
  assertEquals(again.status, 400);
  assertEquals(again.body.error, "code_invalid");
});

Deno.test("T-CODE-WRONGLINK: another link (or another form) cannot use this challenge; nothing is settled", async () => {
  const w = world();
  const begun = await call(w, { op: "code_begin", formId: FORM, token: TOK_A });
  const viaB = await call(w, {
    op: "code_verify",
    formId: FORM,
    token: TOK_B,
    challengeId: begun.body.challengeId,
    code: w.sent[0].code,
  });
  assertEquals(viaB.body.error, "code_invalid");
  const otherForm = await call(w, {
    op: "code_verify",
    formId: OTHER_FORM,
    token: TOK_A,
    challengeId: begun.body.challengeId,
    code: w.sent[0].code,
  });
  assertEquals(otherForm.body.error, "code_invalid");
  assertFalse(w.calls.includes("brand_form_code_settle"));
  assertEquals(w.challenges.get(String(begun.body.challengeId))!.attempts, 0);
});

Deno.test("T-CODE-PURPOSE: a claim or add-contact challenge never settles through a form link", async () => {
  const w = world();
  const r = await call(w, {
    op: "code_verify",
    formId: FORM,
    token: TOK_A,
    challengeId: CLAIM_CHALLENGE,
    code: "123456",
  });
  assertEquals(r.status, 400);
  assertEquals(r.body.error, "code_invalid");
  assertFalse(w.calls.includes("brand_form_code_settle"));
  assertEquals(w.challenges.get(CLAIM_CHALLENGE)!.attempts, 0);
});

Deno.test("T-CODE-DIGEST: email codes are stored as a salted digest, never the code", async () => {
  const w = world();
  const begun = await call(w, { op: "code_begin", formId: FORM, token: TOK_A });
  const stored = w.challenges.get(String(begun.body.challengeId))!;
  assert(stored.hash !== null && stored.hash !== w.sent[0].code);
  assertEquals(
    stored.hash,
    await contactCodeHash(
      new TextEncoder().encode(SALT),
      String(begun.body.challengeId),
      w.sent[0].code,
    ),
  );
});

Deno.test("T-CODE-PHONE: a phone code settles only with the provider's approval", async () => {
  const w = world();
  const begun = await call(w, {
    op: "code_begin",
    formId: FORM,
    token: TOK_A,
    channel: "phone",
  });
  const body = {
    op: "code_verify",
    formId: FORM,
    token: TOK_A,
    challengeId: begun.body.challengeId,
    code: "123456",
  };
  assertEquals((await call(w, body)).body.error, "bad_code");
  w.phoneApproves = true;
  assertEquals((await call(w, body)).status, 200);
});

Deno.test("T-CODE-SHAPE: unknown keys, a non-6-digit code and the emergency switch are refused", async () => {
  const w = world();
  assertEquals(
    (await call(w, {
      op: "code_begin",
      formId: FORM,
      token: TOK_A,
      email: "x@y.z",
    })).status,
    400,
  );
  assertEquals(
    (await call(w, {
      op: "code_verify",
      formId: FORM,
      token: TOK_A,
      challengeId: CLAIM_CHALLENGE,
      code: "12ab",
    })).body.error,
    "bad_request",
  );
  assertEquals(
    (await call(w, { op: "code_begin", formId: FORM, token: TOK_A }, true))
      .status,
    503,
  );
  assertEquals(
    parseCodeRequest({
      op: "code_begin",
      formId: FORM,
      token: TOK_A,
      channel: "fax",
    }),
    null,
  );
});

Deno.test("T-CODE-LOGS: logs never carry a token, a code or a contact", async () => {
  const w = world();
  const begun = await call(w, { op: "code_begin", formId: FORM, token: TOK_A });
  await call(w, {
    op: "code_verify",
    formId: FORM,
    token: TOK_A,
    challengeId: begun.body.challengeId,
    code: "000001",
  });
  const all = w.logs.join("\n");
  for (
    const secret of [TOK_A, w.sent[0].code, "wes@example.test", "+12025551001"]
  ) {
    assertFalse(all.includes(secret), "log leaked " + secret.slice(0, 4));
  }
});

Deno.test("masks keep only a hint", () => {
  assertEquals(maskEmail("sam@example.com"), "s•••@example.com");
  assertEquals(maskPhone("+2348012345678"), "•••• 5678");
});
