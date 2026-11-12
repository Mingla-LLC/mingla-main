import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createCreatorVerifyHandler } from "../creator-verify/index.ts";
import {
  createHandleVerifyHandler,
  decideHandleVerification,
} from "./index.ts";

const ACTOR = "00000000-3872-4000-8000-000000000001";
const HANDLE = "00000000-3872-4000-8000-000000000002";
const future = "2099-01-01T00:00:00.000Z";

Deno.test("#3872 handle proof needs the exact code; #4402: it is evidence, never a verdict", () => {
  assertEquals(
    decideHandleVerification(
      { verify_code: "MINGLA-A1B2", verify_expires_at: future },
      {
        ok: true,
        blocked: false,
        body:
          '<meta content="hello MINGLA-A1B2"><script>{"followerCount":12500}</script>',
      },
    ),
    { check: "code_seen", reason: "code_seen" },
  );
  assertEquals(
    decideHandleVerification(
      { verify_code: "MINGLA-A1B2", verify_expires_at: future },
      {
        ok: true,
        blocked: false,
        body:
          '<meta property="og:description" content="120 Followers, 3 Following - a different biography">',
      },
    ).check,
    "code_not_seen",
  );
});

Deno.test("#3872 a blocked social fetch routes to review and never passes", () => {
  assertEquals(
    decideHandleVerification(
      { verify_code: "MINGLA-A1B2", verify_expires_at: future },
      { ok: false, blocked: true, body: "MINGLA-A1B2" },
    ),
    { check: "unreadable", reason: "provider_fetch_blocked" },
  );
});

Deno.test("#3872 an expired proof cannot verify even when the code is visible", () => {
  assertEquals(
    decideHandleVerification(
      { verify_code: "MINGLA-A1B2", verify_expires_at: "2020-01-01T00:00:00Z" },
      { ok: true, blocked: false, body: "MINGLA-A1B2" },
    ).check,
    "expired",
  );
});

Deno.test("#3872 handle endpoint owns the row and recomputes creator truth", async () => {
  let saved = "";
  let recomputed = 0;
  const handler = createHandleVerifyHandler({
    actorId: () => Promise.resolve(ACTOR),
    load: () =>
      Promise.resolve({
        id: HANDLE,
        creator_account_id: ACTOR,
        platform: "instagram",
        handle: "mingla.creator",
        verify_code: "MINGLA-A1B2",
        verify_started_at: "2026-01-01T00:00:00Z",
        verify_expires_at: future,
        verified_at: null,
      }),
    fetchPublic: () =>
      Promise.resolve({ ok: true, blocked: false, body: "bio MINGLA-A1B2" }),
    save: (_id, decision) => {
      saved = decision.check;
      return Promise.resolve();
    },
    recompute: () => {
      recomputed += 1;
      return Promise.resolve({ verification: "incomplete" });
    },
  });
  const response = await handler(
    new Request("http://local", {
      method: "POST",
      headers: {
        authorization: "Bearer user",
        "content-type": "application/json",
      },
      body: JSON.stringify({ handleId: HANDLE }),
    }),
  );
  assertEquals(response.status, 200);
  assertEquals(saved, "code_seen");
  assertEquals(recomputed, 1);
  assertEquals((await response.json()).status, "review");
});

Deno.test("#3872 creator verification endpoint rejects anonymous callers", async () => {
  const response = await createCreatorVerifyHandler({
    actorId: () => Promise.resolve(null),
    recompute: () => Promise.resolve({}),
  })(new Request("http://local", { method: "POST" }));
  assertEquals(response.status, 401);
});
