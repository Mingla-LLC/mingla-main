import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createCreatorVerifyHandler } from "../creator-verify/index.ts";
import {
  createHandleVerifyHandler,
  decideHandleVerification,
  followerBand,
} from "./index.ts";

const ACTOR = "00000000-3872-4000-8000-000000000001";
const HANDLE = "00000000-3872-4000-8000-000000000002";
const future = "2099-01-01T00:00:00.000Z";

Deno.test("#3872 follower bands use deterministic launch boundaries", () => {
  assertEquals(
    [999, 1_000, 10_000, 50_000, 250_000, 1_000_000].map(followerBand),
    [
      "lt1k",
      "1k_10k",
      "10k_50k",
      "50k_250k",
      "250k_1m",
      "gt1m",
    ],
  );
});

Deno.test("#3872 handle proof requires the exact code and takes provider followers when visible", () => {
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
    {
      status: "verified",
      followerBand: "10k_50k",
      followerSource: "provider",
      reason: null,
    },
  );
  assertEquals(
    decideHandleVerification(
      { verify_code: "MINGLA-A1B2", verify_expires_at: future },
      { ok: true, blocked: false, body: "a different biography" },
    ).status,
    "pending",
  );
});

Deno.test("#3872 a blocked social fetch routes to review and never passes", () => {
  assertEquals(
    decideHandleVerification(
      { verify_code: "MINGLA-A1B2", verify_expires_at: future },
      { ok: false, blocked: true, body: "MINGLA-A1B2" },
    ),
    {
      status: "review",
      followerBand: null,
      followerSource: "self_reported",
      reason: "provider_fetch_blocked",
    },
  );
});

Deno.test("#3872 an expired proof cannot verify even when the code is visible", () => {
  assertEquals(
    decideHandleVerification(
      { verify_code: "MINGLA-A1B2", verify_expires_at: "2020-01-01T00:00:00Z" },
      { ok: true, blocked: false, body: "MINGLA-A1B2" },
    ).status,
    "expired",
  );
});

Deno.test("#3872 handle endpoint owns the row and recomputes creator truth", async () => {
  let saved = "";
  let conflict = true;
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
      saved = decision.status;
      return Promise.resolve();
    },
    recompute: (_id, isConflict) => {
      conflict = isConflict;
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
  assertEquals(saved, "verified");
  assertEquals(conflict, false);
});

Deno.test("#3872 creator verification endpoint rejects anonymous callers", async () => {
  const response = await createCreatorVerifyHandler({
    actorId: () => Promise.resolve(null),
    recompute: () => Promise.resolve({}),
  })(new Request("http://local", { method: "POST" }));
  assertEquals(response.status, 401);
});
