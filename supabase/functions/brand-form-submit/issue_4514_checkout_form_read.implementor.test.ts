// #4514 wave 5 review fix 1: the checkout's form read (brand-form-submit
// {op:"checkout_form"}). The SQL rule (brand_form_checkout_visible, shared with
// brand_form_checkout_check) is proven by the pg17 suite T-CHECKOUT-VIS; this
// proves the edge: the buyer is read from the bearer, a private ticket link is
// hashed before the database sees it (never the raw token), a malformed body is
// 400, a database error is 500 and the form payload passes through unchanged.
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { type BrandFormSubmitDb, handleBrandFormSubmit } from "./submit.ts";

const EVENT = "4514e000-0000-4000-8000-000000000001";
const USER = "4514a000-0000-4000-8000-000000000001";
const LINK = "AbCdEfGhIjKlMnOpQrStUv";
const ORIGIN = "https://host.usemingla.com";

function deps(opts: {
  user?: string | null;
  answer?: { data: unknown; error: { message: string } | null };
}) {
  const calls: Array<[string, string | null, string | null]> = [];
  const bearers: string[] = [];
  const db: BrandFormSubmitDb = {
    switchedOff: () => Promise.resolve(false),
    attemptAdmit: () => Promise.resolve({ allowed: true }),
    userFromBearer: (jwt: string) => {
      bearers.push(jwt);
      return Promise.resolve(opts.user ?? null);
    },
    submitCore: () => Promise.reject(new Error("submit core must not run")),
  };
  return {
    calls,
    bearers,
    deps: {
      db,
      log: () => undefined,
      ipSalt: () => Promise.resolve("salt"),
      checkout: {
        checkoutForm(
          eventId: string,
          userId: string | null,
          hash: string | null,
        ) {
          calls.push([eventId, userId, hash]);
          return Promise.resolve(
            opts.answer ?? {
              data: { active: true, mode: "required_step", formId: "f" },
              error: null,
            },
          );
        },
        hashTicketLink: (token: string) => Promise.resolve(`hmac(${token})`),
      },
    },
  };
}

const post = (body: unknown, bearer?: string) =>
  new Request("https://edge.test/brand-form-submit", {
    method: "POST",
    headers: {
      origin: ORIGIN,
      "content-type": "application/json",
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
    },
    body: JSON.stringify(body),
  });

Deno.test("#4514 W5 fix 1 checkout_form: the signed-in buyer and the hashed link reach SQL", async () => {
  const f = deps({ user: USER });
  const res = await handleBrandFormSubmit(
    post(
      { op: "checkout_form", eventId: EVENT, ticketLinkToken: LINK },
      "jwt-1",
    ),
    f.deps,
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body, {
    ok: true,
    form: { active: true, mode: "required_step", formId: "f" },
  });
  assertEquals(f.bearers, ["jwt-1"]);
  assertEquals(f.calls, [[EVENT, USER, `hmac(${LINK})`]]);
  assert(
    !JSON.stringify(f.calls).includes(`"${LINK}"`),
    "the raw link never reaches SQL",
  );
});

Deno.test("#4514 W5 fix 1 checkout_form: an anonymous buyer with no link sends nulls", async () => {
  const f = deps({});
  const res = await handleBrandFormSubmit(
    post({ op: "checkout_form", eventId: EVENT }),
    f.deps,
  );
  assertEquals(res.status, 200);
  assertEquals(f.calls, [[EVENT, null, null]]);
});

Deno.test("#4514 W5 fix 1 checkout_form: malformed bodies are 400 and reach no database", async () => {
  for (
    const body of [
      { op: "checkout_form" },
      { op: "checkout_form", eventId: "not-a-uuid" },
      { op: "checkout_form", eventId: EVENT, ticketLinkToken: "short" },
      { op: "checkout_form", eventId: EVENT, extra: 1 },
    ]
  ) {
    const f = deps({});
    const res = await handleBrandFormSubmit(post(body), f.deps);
    assertEquals(res.status, 400, JSON.stringify(body));
    assertEquals(f.calls.length, 0);
  }
});

Deno.test("#4514 W5 fix 1 checkout_form: a database error is a 500 the step can retry", async () => {
  const f = deps({ answer: { data: null, error: { message: "boom" } } });
  const res = await handleBrandFormSubmit(
    post({ op: "checkout_form", eventId: EVENT }),
    f.deps,
  );
  assertEquals(res.status, 500);
  assertEquals((await res.json()).error, "server_error");
});
