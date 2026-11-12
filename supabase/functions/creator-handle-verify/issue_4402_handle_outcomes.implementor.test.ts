// #4402 — checking a bio code is a state, never a crash.
//
// MINGLA-INVARIANT: I-4402-HANDLE-CHECK-NEVER-500 | issue #4402 | creator-handle-verify answers 200 with verified, pending, review or expired for every provider outcome, saves a review reason only on a flagged handle, never downgrades a verified handle, and turns an internal failure into 500 {error:"internal"} with no unhandled throw.
//
// Fails on origin/main @ 7ace80fa0a: save() wrote review_reason with
// review_required=false (Postgres 23514, HTTP 500 for every "not found"), a
// 200 page without the profile was a clean "pending", and a re-check could
// null verified_at.
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  createHandleVerifyHandler,
  decideHandleVerification,
  handleUpdateFor,
  type HandleVerifyDeps,
  pageShowsProfile,
  parseFollowerText,
  providerFollowerCount,
  type VerifyDecision,
} from "./index.ts";

const ACTOR = "00000000-4402-4000-8000-000000000001";
const HANDLE = "00000000-4402-4000-8000-000000000002";
const future = "2099-01-01T00:00:00.000Z";
const IG_PROFILE =
  '<html><head><meta property="og:description" content="2,337 Followers, 410 Following, 88 Posts - See Instagram photos and videos from Uncle (@uncledelena)"></head></html>';
const IG_PROFILE_WITH_CODE = IG_PROFILE.replace(
  "</head>",
  '<meta name="description" content="bio MINGLA-3367"></head>',
);

/** Mirrors creator_handles_review_shape: CHECK (review_required OR review_reason IS NULL). */
function satisfiesReviewShape(update: Record<string, unknown>): boolean {
  return update.review_required === true || update.review_reason === null;
}

type Saved = { decision: VerifyDecision; count: number | null };

function handler(
  options: {
    body?: string;
    ok?: boolean;
    blocked?: boolean;
    finalUrl?: string | null;
    verifiedAt?: string | null;
    reviewRequired?: boolean;
    expiresAt?: string;
    saveThrows?: boolean;
  } = {},
) {
  const saved: Saved[] = [];
  const reported: unknown[] = [];
  let fetched = 0;
  const deps: HandleVerifyDeps = {
    actorId: () => Promise.resolve(ACTOR),
    load: () =>
      Promise.resolve({
        id: HANDLE,
        creator_account_id: ACTOR,
        platform: "instagram",
        handle: "uncledelena",
        verify_code: "MINGLA-3367",
        verify_started_at: "2026-11-12T09:20:00Z",
        verify_expires_at: options.expiresAt ?? future,
        verified_at: options.verifiedAt ?? null,
        review_required: options.reviewRequired ?? false,
        follower_band: "lt1k",
        follower_source: "self_reported",
      }),
    fetchPublic: () => {
      fetched += 1;
      return Promise.resolve({
        ok: options.ok ?? true,
        blocked: options.blocked ?? false,
        body: options.body ?? "",
        finalUrl: options.finalUrl ?? "https://www.instagram.com/uncledelena/",
      });
    },
    save: (_id, decision, count) => {
      if (options.saveThrows) {
        return Promise.reject({
          code: "23514",
          message: 'violates check constraint "creator_handles_review_shape"',
        });
      }
      saved.push({ decision, count });
      return Promise.resolve();
    },
    recompute: () => Promise.resolve({ verification: "incomplete" }),
    report: (error) => {
      reported.push(error);
    },
  };
  return {
    run: () =>
      createHandleVerifyHandler(deps)(
        new Request("http://local/creator-handle-verify", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ handleId: HANDLE }),
        }),
      ),
    saved,
    reported,
    fetchedCount: () => fetched,
  };
}

Deno.test("#4402 code not seen on a readable page: 200 pending, saved with no review reason", async () => {
  const h = handler({ body: IG_PROFILE });
  const res = await h.run();
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.status, "pending");
  assertEquals(h.saved.length, 1);
  const update = handleUpdateFor(h.saved[0].decision, h.saved[0].count);
  assertEquals(update.review_reason, null);
  assertEquals(update.review_required, false);
  assertEquals(update.last_check_status, "pending");
  assert(
    satisfiesReviewShape(update),
    "the update would violate creator_handles_review_shape",
  );
  assertEquals(
    "verified_at" in update,
    false,
    "a check must never clear verified_at",
  );
});

Deno.test("#4402 an expired code: 200 expired, saved with no review reason", async () => {
  const h = handler({
    body: IG_PROFILE_WITH_CODE,
    expiresAt: "2020-01-01T00:00:00Z",
  });
  const res = await h.run();
  assertEquals(res.status, 200);
  assertEquals((await res.json()).status, "expired");
  const update = handleUpdateFor(h.saved[0].decision, h.saved[0].count);
  assertEquals(update.review_reason, null);
  assertEquals(update.last_check_status, "expired");
  assert(satisfiesReviewShape(update));
});

Deno.test("#4402 a 200 page without the profile goes to a person, never 'not found'", async () => {
  const shell =
    "<html><head><title>Instagram</title></head><body><script>window.__x=1</script></body></html>";
  const h = handler({ body: shell });
  const res = await h.run();
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.status, "review");
  assertEquals(body.reason, "provider_unreadable");
  const update = handleUpdateFor(h.saved[0].decision, h.saved[0].count);
  assertEquals(update.review_required, true);
  assertEquals(update.review_reason, "provider_unreadable");
  assertEquals(update.last_check_status, "unreadable");
  assert(satisfiesReviewShape(update));
});

Deno.test("#4402 a login page after redirects is unreadable, even if it mentions the code", async () => {
  const h = handler({
    body: "Log in to see MINGLA-3367",
    finalUrl: "https://www.instagram.com/accounts/login/?next=/uncledelena/",
  });
  const body = await (await h.run()).json();
  assertEquals(body.status, "review");
  assertEquals(body.reason, "provider_unreadable");
});

Deno.test("#4402 blocked status codes keep provider_fetch_blocked and go to review", async () => {
  const h = handler({ ok: false, blocked: true });
  const body = await (await h.run()).json();
  assertEquals(body.status, "review");
  assertEquals(body.reason, "provider_fetch_blocked");
  assert(satisfiesReviewShape(handleUpdateFor(h.saved[0].decision, null)));
});

Deno.test("#4402 an already-verified handle is never fetched or downgraded", async () => {
  const h = handler({ verifiedAt: "2026-11-12T09:30:00Z", body: "" });
  const res = await h.run();
  assertEquals(res.status, 200);
  assertEquals((await res.json()).status, "verified");
  assertEquals(h.fetchedCount(), 0);
  assertEquals(h.saved.length, 0);
});

Deno.test("#4402 a handle flagged for a person can still be re-checked and pass", async () => {
  const h = handler({
    verifiedAt: "2026-11-12T09:30:00Z",
    reviewRequired: true,
    body: IG_PROFILE_WITH_CODE,
  });
  const body = await (await h.run()).json();
  assertEquals(body.status, "verified");
  assertEquals(h.fetchedCount(), 1);
});

Deno.test("#4402 the code on a readable page verifies and takes Instagram's follower line", async () => {
  const h = handler({ body: IG_PROFILE_WITH_CODE });
  const body = await (await h.run()).json();
  assertEquals(body.status, "verified");
  assertEquals(body.followerBand, "1k_10k");
  assertEquals(body.followerSource, "provider");
  const update = handleUpdateFor(
    h.saved[0].decision,
    h.saved[0].count,
    "2026-11-12T10:00:00.000Z",
  );
  assertEquals(update.verified_at, "2026-11-12T10:00:00.000Z");
  assertEquals(update.provider_follower_count, 2337);
  assertEquals(update.review_reason, null);
});

Deno.test("#4402 og:description follower counts: 2,337 / 12.5K / 1.2M", () => {
  assertEquals(parseFollowerText("2,337 Followers, 410 Following"), 2337);
  assertEquals(parseFollowerText("12.5K Followers, 3 Following"), 12500);
  assertEquals(parseFollowerText("1.2M Followers, 9 Following"), 1200000);
  assertEquals(parseFollowerText("No followers line here"), null);
  const og = (text: string) =>
    `<meta content="${text}" property="og:description">`;
  assertEquals(providerFollowerCount(og("2,337 Followers, 1 Following")), 2337);
  assertEquals(
    providerFollowerCount(og("12.5K Followers, 1 Following")),
    12500,
  );
  assertEquals(
    providerFollowerCount(og("1.2M Followers, 1 Following")),
    1200000,
  );
  assertEquals(providerFollowerCount("<html></html>"), null);
  for (
    const [text, band] of [["2,337", "1k_10k"], ["12.5K", "10k_50k"], [
      "1.2M",
      "gt1m",
    ]]
  ) {
    const decision = decideHandleVerification(
      {
        verify_code: "MINGLA-3367",
        verify_expires_at: future,
        platform: "instagram",
      },
      { ok: true, blocked: false, body: og(`${text} Followers, 1 Following`) },
    );
    assertEquals(decision.status, "pending");
    assertEquals(decision.followerBand, band);
    assertEquals(decision.followerSource, "provider");
  }
});

Deno.test("#4402 profile markers per platform; X is never readable", () => {
  assertEquals(pageShowsProfile("instagram", IG_PROFILE), true);
  assertEquals(pageShowsProfile("instagram", "<html></html>"), false);
  assertEquals(
    pageShowsProfile("youtube", '{"channelMetadataRenderer":{}}'),
    true,
  );
  assertEquals(pageShowsProfile("tiktok", '{"userInfo":{"user":{}}}'), true);
  assertEquals(
    pageShowsProfile(
      "snapchat",
      '<meta property="og:description" content="Add me">',
    ),
    true,
  );
  assertEquals(pageShowsProfile("x", IG_PROFILE), false);
});

Deno.test("#4402 a save failure is a 500 {error:'internal'}, reported, never a throw", async () => {
  const h = handler({ body: IG_PROFILE, saveThrows: true });
  const res = await h.run();
  assertEquals(res.status, 500);
  assertEquals(await res.json(), { error: "internal" });
  assertEquals(h.reported.length, 1);
});
