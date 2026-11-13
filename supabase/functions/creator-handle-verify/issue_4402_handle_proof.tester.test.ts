// #4402 tester: adversarial angles on creator-handle-verify.
//
// Written by the tester (verdict comment 6829319693), moved into the repo by
// the implementor's rework and updated to Seth's 12 Nov 2026 rule: an admin
// verifies every handle, a rejection sticks, and no audience band is ever
// taken from a page.
//
// T4 (retest 6830468345, P2-A): an admin decision that lands while the profile
// fetch runs is never overwritten. Fails on fdbce4cd91 (unconditional save).
//
// Fails on 1f14a6c44c: T1 (a rejected handle re-verified by a direct POST),
// T2 (a creator-written "5M Followers" became a provider band) and T3 (a
// 20-digit count reached the bigint column).
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  createHandleVerifyHandler,
  decideHandleVerification,
  handleUpdateFor,
  type HandleVerifyDeps,
} from "./index.ts";

const ACTOR = "00000000-4402-4000-8000-0000000000aa";
const HANDLE = "00000000-4402-4000-8000-0000000000bb";
const future = "2099-01-01T00:00:00.000Z";

function run(
  platform: "youtube" | "tiktok" | "instagram",
  body: string,
  lastCheckStatus: string | null = "rejected",
) {
  const saved: Record<string, unknown>[] = [];
  let fetched = 0;
  const deps: HandleVerifyDeps = {
    actorId: () => Promise.resolve(ACTOR),
    // Shape of a handle an admin just REJECTED via admin_creator_handle_decide:
    // verified_at NULL, review_required false, code still valid.
    load: () =>
      Promise.resolve({
        id: HANDLE,
        creator_account_id: ACTOR,
        platform,
        handle: "someone",
        verify_code: "MINGLA-AB12",
        verify_started_at: "2026-11-12T09:00:00Z",
        verify_expires_at: future,
        verified_at: null,
        review_required: false,
        follower_band: "lt1k",
        follower_source: "self_reported",
        last_check_status: lastCheckStatus,
      }),
    fetchPublic: () => {
      fetched += 1;
      return Promise.resolve({
        ok: true,
        blocked: false,
        body,
        finalUrl: null,
      });
    },
    save: (_id, d) => {
      saved.push(handleUpdateFor(d));
      return Promise.resolve({
        saved: true,
        last_check_status: d.check,
        verified: false,
        follower_band: "lt1k",
        follower_source: "self_reported",
      });
    },
    recompute: () => Promise.resolve({ verification: "incomplete" }),
  };
  return {
    saved,
    fetched: () => fetched,
    handler: createHandleVerifyHandler(deps),
  };
}
const post = () =>
  new Request("http://x", {
    method: "POST",
    body: JSON.stringify({ handleId: HANDLE }),
  });

Deno.test("T1 a handle an admin rejected is not re-verified by the creator pressing Check again", async () => {
  const { saved, fetched, handler } = run(
    "youtube",
    '<meta property="og:description" content="my channel MINGLA-AB12">',
  );
  const res = await handler(post());
  const out = await res.json();
  assertEquals(res.status, 200);
  // The rejection sticks (the admin's decision is final until an admin reopens it).
  assert(
    out.status !== "verified",
    `rejected handle re-verified: ${JSON.stringify(saved[0])}`,
  );
  assertEquals(out.status, "rejected");
  assertEquals(fetched(), 0, "a rejected handle must not be fetched");
  assertEquals(saved.length, 0, "a rejected handle must not be written");
});

Deno.test("T1b even a non-rejected handle with the code on the page is never verified by the check", async () => {
  const { saved, handler } = run(
    "instagram",
    '<meta property="og:description" content="10 Followers, 1 Following MINGLA-AB12">',
    null,
  );
  const out = await (await handler(post())).json();
  assertEquals(out.status, "review");
  assertEquals("verified_at" in saved[0], false);
});

Deno.test("T2 a creator-written channel description cannot set a provider audience band", () => {
  const body =
    '<meta property="og:description" content="Food in Lagos. 5M Followers soon! MINGLA-AB12">';
  const d = decideHandleVerification({
    verify_code: "MINGLA-AB12",
    verify_expires_at: future,
    platform: "youtube",
  }, { ok: true, blocked: false, body });
  const update = handleUpdateFor(d);
  // No band from any text the creator controls (or any page at all).
  assertEquals(
    "follower_band" in update,
    false,
    `spoofed band: ${JSON.stringify(update)}`,
  );
  assertEquals(
    "follower_source" in update,
    false,
    `spoofed source: ${JSON.stringify(update)}`,
  );
});

Deno.test("T3 a parsed follower count never reaches the database, so it cannot overflow bigint", async () => {
  const { saved, handler } = run(
    "instagram",
    '<meta property="og:description" content="99999999999999999999 Followers">',
    null,
  );
  const res = await handler(post());
  assertEquals(res.status, 200);
  for (const row of saved) {
    for (const key of Object.keys(row)) {
      assert(!/follower|count/i.test(key), `a check wrote ${key}`);
    }
  }
});

// A fake store with the same compare-and-set rule as
// issue_4402_record_handle_check: write only while the handle still waits for
// an admin with the code the check read.
function raceStore(adminDecision: "reject" | "approve" | "new_code") {
  const row = {
    id: HANDLE,
    creator_account_id: ACTOR,
    platform: "instagram" as const,
    handle: "someone",
    verify_code: "MINGLA-AB12",
    verify_started_at: "2026-11-12T09:00:00Z",
    verify_expires_at: future,
    verified_at: null as string | null,
    review_required: true,
    follower_band: "lt1k",
    follower_source: "self_reported",
    last_check_status: null as string | null,
    rejected_note: null as string | null,
  };
  let writes = 0;
  const deps: HandleVerifyDeps = {
    actorId: () => Promise.resolve(ACTOR),
    load: () => Promise.resolve({ ...row }),
    fetchPublic: () => {
      // The admin acts while our request waits on the platform.
      if (adminDecision === "reject") {
        Object.assign(row, {
          review_required: false,
          last_check_status: "rejected",
          rejected_note: "Not their account",
        });
      } else if (adminDecision === "approve") {
        Object.assign(row, {
          review_required: false,
          verified_at: "2026-11-12T09:05:00Z",
          last_check_status: "verified",
          follower_band: "1k_10k",
          follower_source: "admin",
        });
      } else {
        Object.assign(row, { verify_code: "MINGLA-ZZ99" });
      }
      return Promise.resolve({
        ok: true,
        blocked: false,
        body: "bio MINGLA-AB12",
        finalUrl: null,
      });
    },
    save: (read, d) => {
      const pending = row.review_required && row.verified_at === null &&
        row.last_check_status !== "rejected" &&
        row.last_check_status !== "verified" &&
        row.verify_code === read.verify_code;
      if (pending) {
        Object.assign(row, handleUpdateFor(d));
        writes += 1;
      }
      return Promise.resolve({
        saved: pending,
        last_check_status: row.last_check_status,
        verified: row.verified_at !== null && !row.review_required,
        follower_band: row.follower_band,
        follower_source: row.follower_source,
      });
    },
    recompute: () => Promise.resolve({ verification: "review" }),
  };
  return {
    row,
    writes: () => writes,
    handler: createHandleVerifyHandler(deps),
  };
}

Deno.test("T4 a rejection that lands during the fetch sticks: nothing written, 200 rejected", async () => {
  const s = raceStore("reject");
  const res = await s.handler(post());
  assertEquals(res.status, 200);
  const out = await res.json();
  assertEquals(out.status, "rejected");
  assertEquals(s.writes(), 0);
  assertEquals(s.row.last_check_status, "rejected");
  assertEquals(s.row.review_required, false);
});

Deno.test("T4b an approval that lands during the fetch sticks: 200 verified, admin band kept", async () => {
  const s = raceStore("approve");
  const out = await (await s.handler(post())).json();
  assertEquals(out.status, "verified");
  assertEquals(out.followerSource, "admin");
  assertEquals(s.writes(), 0);
  assertEquals(s.row.review_required, false);
});

Deno.test("T4c evidence for an old code is not written over a new code", async () => {
  const s = raceStore("new_code");
  const out = await (await s.handler(post())).json();
  assertEquals(out.status, "review");
  assertEquals(out.reason, "superseded");
  assertEquals(s.writes(), 0);
  assertEquals(s.row.last_check_status, null);
});
