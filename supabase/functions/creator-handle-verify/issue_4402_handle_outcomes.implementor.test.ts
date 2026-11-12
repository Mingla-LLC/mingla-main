// #4402 — checking a bio code records evidence for an admin; it never
// verifies, never sets an audience, and is never a crash.
//
// MINGLA-INVARIANT: I-4402-HANDLE-CHECK-NEVER-500 | issue #4402 | creator-handle-verify answers 200 with review, expired, rejected or verified for every provider outcome, every saved row keeps the handle flagged for a person (creator_handles_review_shape), and an internal failure is 500 {error:"internal"} with no unhandled throw.
// MINGLA-INVARIANT: I-4402-HANDLE-CHECK-NEVER-VERIFIES | issue #4402 | creator-handle-verify never writes verified_at, follower_band, follower_source or a follower count, and never fetches or writes a handle an admin rejected (Seth, 12 Nov 2026: an admin verifies every handle).
//
// Fails on origin/main @ 7ace80fa0a: save() wrote review_reason with
// review_required=false (Postgres 23514, HTTP 500 for every "not found"), and
// the code on the page set verified_at and a provider audience band.
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
const FORBIDDEN = [
  "verified_at",
  "follower_band",
  "follower_source",
  "provider_follower_count",
];

/** Mirrors creator_handles_review_shape: CHECK (review_required OR review_reason IS NULL). */
function satisfiesReviewShape(update: Record<string, unknown>): boolean {
  return update.review_required === true || update.review_reason === null;
}

function assertEvidenceOnly(update: Record<string, unknown>) {
  for (const key of FORBIDDEN) {
    assertEquals(key in update, false, `a check must never write ${key}`);
  }
  assertEquals(update.review_required, true, "the handle stays with a person");
  assert(satisfiesReviewShape(update));
}

function handler(
  options: {
    body?: string;
    ok?: boolean;
    blocked?: boolean;
    finalUrl?: string | null;
    verifiedAt?: string | null;
    reviewRequired?: boolean;
    lastCheckStatus?: string | null;
    followerSource?: string;
    expiresAt?: string;
    saveThrows?: boolean;
  } = {},
) {
  const saved: VerifyDecision[] = [];
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
        review_required: options.reviewRequired ?? true,
        follower_band: "lt1k",
        follower_source: options.followerSource ?? "self_reported",
        last_check_status: options.lastCheckStatus ?? null,
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
    save: (_id, decision) => {
      if (options.saveThrows) {
        return Promise.reject({
          code: "23514",
          message: 'violates check constraint "creator_handles_review_shape"',
        });
      }
      saved.push(decision);
      return Promise.resolve();
    },
    recompute: () => Promise.resolve({ verification: "review" }),
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

Deno.test("#4402 the code on a readable page is evidence only: 200 review/code_seen, never verified", async () => {
  const h = handler({ body: IG_PROFILE_WITH_CODE });
  const res = await h.run();
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.status, "review");
  assertEquals(body.check, "code_seen");
  assertEquals(
    body.followerBand,
    "lt1k",
    "the band is the saved one, untouched",
  );
  assertEquals(body.followerSource, "self_reported");
  const update = handleUpdateFor(h.saved[0], "2026-11-12T10:00:00.000Z");
  assertEvidenceOnly(update);
  assertEquals(update.last_check_status, "code_seen");
  assertEquals(update.review_reason, "code_seen");
});

Deno.test("#4402 code not seen on a readable page: 200 review/code_not_seen, CHECK-valid", async () => {
  const h = handler({ body: IG_PROFILE });
  const res = await h.run();
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.status, "review");
  assertEquals(body.check, "code_not_seen");
  assertEquals(body.reason, "verification_code_not_found");
  const update = handleUpdateFor(h.saved[0]);
  assertEvidenceOnly(update);
  assertEquals(update.last_check_status, "code_not_seen");
});

Deno.test("#4402 an expired code: 200 expired, still with a person", async () => {
  const h = handler({
    body: IG_PROFILE_WITH_CODE,
    expiresAt: "2020-01-01T00:00:00Z",
  });
  const res = await h.run();
  assertEquals(res.status, 200);
  assertEquals((await res.json()).status, "expired");
  const update = handleUpdateFor(h.saved[0]);
  assertEvidenceOnly(update);
  assertEquals(update.last_check_status, "expired");
});

Deno.test("#4402 a 200 page without the profile is unreadable, never 'not found'", async () => {
  const shell =
    "<html><head><title>Instagram</title></head><body><script>window.__x=1</script></body></html>";
  const h = handler({ body: shell });
  const body = await (await h.run()).json();
  assertEquals(body.status, "review");
  assertEquals(body.reason, "provider_unreadable");
  const update = handleUpdateFor(h.saved[0]);
  assertEvidenceOnly(update);
  assertEquals(update.last_check_status, "unreadable");
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

Deno.test("#4402 blocked status codes record provider_fetch_blocked", async () => {
  const h = handler({ ok: false, blocked: true });
  const body = await (await h.run()).json();
  assertEquals(body.status, "review");
  assertEquals(body.reason, "provider_fetch_blocked");
  assertEvidenceOnly(handleUpdateFor(h.saved[0]));
});

Deno.test("#4402 a handle an admin approved is never fetched or rewritten, and reports 'admin'", async () => {
  const h = handler({
    verifiedAt: "2026-11-12T09:30:00Z",
    reviewRequired: false,
    lastCheckStatus: "verified",
    followerSource: "admin",
  });
  const res = await h.run();
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.status, "verified");
  assertEquals(body.followerSource, "admin");
  assertEquals(h.fetchedCount(), 0);
  assertEquals(h.saved.length, 0);
});

Deno.test("#4402 a rejected handle is never fetched or written", async () => {
  const h = handler({
    reviewRequired: false,
    lastCheckStatus: "rejected",
    body: IG_PROFILE_WITH_CODE,
  });
  const res = await h.run();
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.status, "rejected");
  assertEquals(h.fetchedCount(), 0);
  assertEquals(h.saved.length, 0);
});

Deno.test("#4402 no follower text sets an audience, on any platform", () => {
  for (
    const platform of ["instagram", "youtube", "tiktok", "snapchat"] as const
  ) {
    const decision = decideHandleVerification(
      { verify_code: "MINGLA-3367", verify_expires_at: future, platform },
      {
        ok: true,
        blocked: false,
        body:
          '<meta property="og:description" content="5M Followers MINGLA-3367"><script>{"followerCount":5000000}</script>',
      },
    );
    assertEquals(Object.keys(decision).sort(), ["check", "reason"]);
    assertEvidenceOnly(handleUpdateFor(decision));
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
