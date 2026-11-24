// #4514 CI fix: the guest link page reads its form through brand-form-submit
// {op:"link_read"} (service role), so brand_form_my_response is no longer
// anon-executable (the pg17 suite asserts SET ROLE anon gets 42501). This proves
// the edge: the token, form and code grant reach SQL unchanged and never a user
// id; the SQL refusals keep their codes (the page shows "this link doesn't
// work"); a malformed body is 400 and reaches no database; a database error is
// 500; the token is never logged.
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { type BrandFormSubmitDb, handleBrandFormSubmit } from "./submit.ts";

const FORM = "4514f000-0000-4000-8000-000000000001";
const CHALLENGE = "4514c000-0000-4000-8000-000000000001";
const TOKEN = "ab".repeat(32);
const ORIGIN = "https://host.usemingla.com";

function deps(answer?: { data: unknown; error: { message: string } | null }) {
  const calls: Array<[string, string, string | null]> = [];
  const lines: string[] = [];
  const db: BrandFormSubmitDb = {
    switchedOff: () => Promise.resolve(false),
    attemptAdmit: () => Promise.resolve({ allowed: true }),
    userFromBearer: () =>
      Promise.reject(new Error("link_read never reads a bearer")),
    submitCore: () => Promise.reject(new Error("submit core must not run")),
  };
  return {
    calls,
    lines,
    deps: {
      db,
      log: (l: string) => lines.push(l),
      ipSalt: () => Promise.resolve("salt"),
      linkRead: {
        myResponse(formId: string, token: string, challengeId: string | null) {
          calls.push([formId, token, challengeId]);
          return Promise.resolve(
            answer ??
              {
                data: { state: "unanswered", form: { id: formId } },
                error: null,
              },
          );
        },
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

Deno.test("#4514 link_read: the token and code grant reach SQL, the payload passes through", async () => {
  const f = deps();
  const res = await handleBrandFormSubmit(
    post({
      op: "link_read",
      formId: FORM,
      token: TOKEN,
      challengeId: CHALLENGE,
    }, "jwt-ignored"),
    f.deps,
  );
  assertEquals(res.status, 200);
  assertEquals(await res.json(), {
    ok: true,
    read: { state: "unanswered", form: { id: FORM } },
  });
  assertEquals(f.calls, [[FORM, TOKEN, CHALLENGE]]);
  assert(!f.lines.join("\n").includes(TOKEN), "the token is never logged");
});

Deno.test("#4514 link_read: no code grant sends null", async () => {
  const f = deps();
  const res = await handleBrandFormSubmit(
    post({ op: "link_read", formId: FORM, token: TOKEN }),
    f.deps,
  );
  assertEquals(res.status, 200);
  assertEquals(f.calls, [[FORM, TOKEN, null]]);
});

Deno.test("#4514 link_read: SQL refusals keep their codes", async () => {
  for (
    const [message, status] of [
      ["link_invalid", 403],
      ["link_revoked", 403],
      ["form_not_found", 404],
    ] as const
  ) {
    const f = deps({ data: null, error: { message } });
    const res = await handleBrandFormSubmit(
      post({ op: "link_read", formId: FORM, token: TOKEN }),
      f.deps,
    );
    assertEquals(res.status, status, message);
    assertEquals(await res.json(), { ok: false, error: message });
    assert(!f.lines.join("\n").includes(TOKEN), "the token is never logged");
  }
});

Deno.test("#4514 link_read: malformed bodies are 400 and reach no database", async () => {
  for (
    const body of [
      { op: "link_read" },
      { op: "link_read", formId: "nope", token: TOKEN },
      { op: "link_read", formId: FORM, token: "short" },
      { op: "link_read", formId: FORM, token: TOKEN, challengeId: "nope" },
      { op: "link_read", formId: FORM, token: TOKEN, userId: "x" },
    ]
  ) {
    const f = deps();
    const res = await handleBrandFormSubmit(post(body), f.deps);
    assertEquals(res.status, 400, JSON.stringify(body));
    assertEquals(f.calls.length, 0);
  }
});

Deno.test("#4514 link_read: an unknown database error or a bad shape is a 500", async () => {
  for (
    const answer of [{ data: null, error: { message: "boom" } }, {
      data: null,
      error: null,
    }]
  ) {
    const f = deps(answer);
    const res = await handleBrandFormSubmit(
      post({ op: "link_read", formId: FORM, token: TOKEN }),
      f.deps,
    );
    assertEquals(res.status, 500);
    assertEquals((await res.json()).error, "server_error");
  }
});
