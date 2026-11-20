// #4514 wave 5: "After they purchase" — the buyer success screen's link request
// (brand-form-submit {op:"purchase_link"}). The SQL rule (possession, the form's
// mode, answered, the per-order cap) is proven by the pg17 suite T-PURCHASE-LINK;
// this proves the edge: the token is hashed before the database sees it, the
// outcomes map to their statuses, the off switch answers 503, a bad body is 400.
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { type BrandFormSubmitDb, handleBrandFormSubmit } from "./submit.ts";
import { sha256Hex } from "./purchaseLink.ts";

const SESSION = "4514c000-0000-4000-8000-000000000001";
const FORM = "4514f000-0000-4000-8000-000000000001";
const BST = "b".repeat(64);
const ORIGIN = "https://host.usemingla.com";

function deps(opts: {
  off?: boolean;
  answer?: { data: unknown; error: { message: string } | null };
}) {
  const calls: Array<[string, string]> = [];
  const logs: string[] = [];
  const db: BrandFormSubmitDb = {
    switchedOff: () => Promise.resolve(opts.off === true),
    countAttempts: () => Promise.resolve({ ip10m: 0, ip24h: 0 }),
    recordAttempt: () => Promise.resolve(),
    userFromBearer: () => Promise.resolve(null),
    submitCore: () => Promise.reject(new Error("submit core must not run")),
  };
  return {
    calls,
    logs,
    deps: {
      db,
      log: (l: string) => logs.push(l),
      ipSalt: () => Promise.resolve("salt"),
      purchase: {
        purchaseLink(sessionId: string, hash: string) {
          calls.push([sessionId, hash]);
          return Promise.resolve(
            opts.answer ??
              {
                data: { outcome: "link", formId: FORM, token: "c".repeat(64) },
                error: null,
              },
          );
        },
      },
    },
  };
}

const post = (body: unknown) =>
  new Request("https://edge.test/brand-form-submit", {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

Deno.test("#4514 W5 purchase_link: the buyer status token is hashed and a link comes back", async () => {
  const f = deps({});
  const res = await handleBrandFormSubmit(
    post({ op: "purchase_link", checkoutSessionId: SESSION, buyerStatusToken: BST }),
    f.deps,
  );
  assertEquals(res.status, 200);
  assertEquals(await res.json(), {
    ok: true,
    outcome: "link",
    formId: FORM,
    token: "c".repeat(64),
  });
  assertEquals(f.calls, [[SESSION, await sha256Hex(BST)]]);
  assert(f.logs.every((l) => !l.includes(BST)), "the token reached a log");
});

Deno.test("#4514 W5 purchase_link: none, answered, not the holder, over the cap", async () => {
  for (
    const [answer, status, error] of [
      [{ data: { outcome: "none" }, error: null }, 200, undefined],
      [{ data: { outcome: "answered", formId: FORM }, error: null }, 200, undefined],
      [{ data: null, error: { message: "link_invalid" } }, 403, "link_invalid"],
      [{ data: null, error: { message: "rate_limited" } }, 429, "rate_limited"],
      [{ data: null, error: { message: "boom" } }, 500, "server_error"],
    ] as const
  ) {
    const f = deps({ answer });
    const res = await handleBrandFormSubmit(
      post({ op: "purchase_link", checkoutSessionId: SESSION, buyerStatusToken: BST }),
      f.deps,
    );
    assertEquals(res.status, status);
    const body = await res.json() as Record<string, unknown>;
    assertEquals(body.error, error);
  }
});

Deno.test("#4514 W5 purchase_link: the off switch answers 503 and a bad body 400", async () => {
  const off = deps({ off: true });
  const paused = await handleBrandFormSubmit(
    post({ op: "purchase_link", checkoutSessionId: SESSION, buyerStatusToken: BST }),
    off.deps,
  );
  assertEquals(paused.status, 503);
  assertEquals(off.calls.length, 0);
  for (
    const body of [
      { op: "purchase_link", checkoutSessionId: "x", buyerStatusToken: BST },
      { op: "purchase_link", checkoutSessionId: SESSION, buyerStatusToken: "short" },
      { op: "purchase_link", checkoutSessionId: SESSION, buyerStatusToken: BST, extra: 1 },
    ]
  ) {
    const f = deps({});
    const res = await handleBrandFormSubmit(post(body), f.deps);
    assertEquals(res.status, 400);
    assertEquals(f.calls.length, 0);
  }
});
