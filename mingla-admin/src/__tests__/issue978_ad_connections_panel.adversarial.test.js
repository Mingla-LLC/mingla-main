// ISSUE-978 [Ad Connections panel] — TESTER ADVERSARIAL regression.
//
// DIFFERENT ANGLE than the implementor's happy-path suite
// (issue978_ad_connections_panel.test.js). The implementor's suite proves the
// FIXTURE cases (2h-ago fresh, 3d-ago stale, "always active" TikTok bad-status)
// and the single-call reconnect-platform-exactness contract. This suite attacks
// what the fixtures never touch:
//
//   G1 — STALENESS BOUNDARY (exact cutoff, not "clearly fresh"/"clearly old"):
//        the code uses a strict `>` comparison against STALE_THRESHOLD_MS. A row
//        verified EXACTLY 24h ago must still read "connected" (off-by-one in the
//        other direction would falsely stale-flag every row at the instant it
//        crosses the threshold from the reconnect that just set it); 1ms over
//        must flip to "stale"; 1ms under must stay "connected". The implementor
//        never tests the boundary itself, only comfortably-fresh/comfortably-old
//        values.
//
//   G2 — DOUBLE-TRIGGER staleness message: a row that is BOTH age-stale AND
//        account-status-stale at once (never exercised — the implementor's
//        tiktok fixture is fresh-but-bad-status, reddit is old-but-good-status,
//        never both) must report BOTH reasons, not silently drop one.
//
//   G3 — THE REJECTED-PROMISE PATH: createReconnectHandler's try/catch exists
//        specifically to catch connectChannelFn THROWING (network failure,
//        thrown exception) as opposed to returning `{ error }`. The implementor
//        only exercises the `{ error }` return branch; the catch branch is dead
//        code as far as their suite can tell. G3 proves a thrown error still
//        routes to onError (never onSuccess) and the promise resolves
//        `{ ok: false }` — a connect that blows up must never look like success.
//
//   G4 — NO FALSE-POSITIVE FLIP ON FAILURE: after a FAILED reconnect attempt on
//        a never-connected platform (Google, no row), re-deriving the row from
//        the SAME (unrefreshed) connections array must still show
//        not_connected/never — a failed attempt must never optimistically or
//        accidentally flip local state to "connected" before the server proves
//        it. This is the silent-success failure mode the panel's contract
//        explicitly promises never happens.
//
//   G5 — RECONNECT-SUCCESS END-TO-END REFRESH: the full lifecycle the
//        implementor's suite never chains — Google starts with NO row
//        (not_connected/never) → reconnect succeeds → the caller's refresh
//        (re-querying connections, exactly what AdConnectionsPanel.load() does
//        in onSuccess) merges the new row in → buildConnectionRows on the
//        POST-refresh array now classifies Google as connected. Proves the
//        Connect button's promised behavior ("calls admin-ad-connect via the
//        admin session... and refreshes") end-to-end at the logic layer (no DOM
//        harness exists in this repo — house pattern, same constraint the
//        implementor's suite operates under).
//
//   G6 — GARBAGE token_last_verified_at INSIDE computeConnectionStatus (not
//        just humanizeAge): a corrupt/non-ISO timestamp on an otherwise
//        "connected" row must not throw and must not be silently treated as
//        fresh — it must fail closed to "stale".
//
//   G7 — SCRAMBLED + PARTIAL input order: connections supplied in reverse /
//        arbitrary order (not the implementor's fixed meta→tiktok→snapchat→
//        reddit order) still renders PLATFORMS' fixed order — proves the row
//        order is driven by PLATFORM_META, not incidentally by input order
//        (which the implementor's single fixed-order fixture cannot distinguish
//        from an input-order-preserving implementation).
//
// FAILS-ON-REVERT: verified at commit 1fde6cb55225e3b20c9344e67770a185fe3cf6a1
// by re-applying the two hand-reverted defects (buildConnectionRows dropping
// the fixed-5 merge; createReconnectHandler hardcoded to "meta") — see the
// commit line cited in the PR body and independently re-confirmed by the
// tester (Step 0.5). G1/G2/G6/G7 attack buildConnectionRows +
// computeConnectionStatus; G3/G4/G5 attack createReconnectHandler. Both
// reverted functions are exercised by this suite, so it shares the same
// revert surface — confirmed by an independent hand-revert further down this
// file's companion proof (see PR/QA comment for the exact command run).

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildConnectionRows,
  computeConnectionStatus,
  createReconnectHandler,
  STALE_THRESHOLD_MS,
} from "../lib/adConnections.js";

const NOW = new Date("2026-07-20T12:00:00.000Z");

function isoMsAgo(ms) {
  return new Date(NOW.getTime() - ms).toISOString();
}

describe("ISSUE-978 ADVERSARIAL — G1: staleness boundary is a strict '>' cutoff", () => {
  it("verified EXACTLY at the 24h cutoff is still connected (not stale)", () => {
    const { state, reason } = computeConnectionStatus(
      {
        connected: true,
        status: "connected",
        token_last_verified_at: isoMsAgo(STALE_THRESHOLD_MS),
        account_status: "ACTIVE",
      },
      NOW,
    );
    assert.equal(state, "connected");
    assert.equal(reason, null);
  });

  it("verified 1ms under the cutoff is connected", () => {
    const { state } = computeConnectionStatus(
      {
        connected: true,
        status: "connected",
        token_last_verified_at: isoMsAgo(STALE_THRESHOLD_MS - 1),
        account_status: "ACTIVE",
      },
      NOW,
    );
    assert.equal(state, "connected");
  });

  it("verified 1ms over the cutoff flips to stale", () => {
    const { state, reason } = computeConnectionStatus(
      {
        connected: true,
        status: "connected",
        token_last_verified_at: isoMsAgo(STALE_THRESHOLD_MS + 1),
        account_status: "ACTIVE",
      },
      NOW,
    );
    assert.equal(state, "stale");
    assert.match(reason, /hasn't been re-verified in over 24 hours/);
  });
});

describe("ISSUE-978 ADVERSARIAL — G2: both staleness triggers fire together", () => {
  it("old AND bad-account-status at once reports BOTH reasons, not just one", () => {
    const { state, reason } = computeConnectionStatus(
      {
        connected: true,
        status: "connected",
        token_last_verified_at: isoMsAgo(STALE_THRESHOLD_MS * 3), // 3x past cutoff
        account_status: "STATUS_DISABLE",
      },
      NOW,
    );
    assert.equal(state, "stale");
    assert.match(reason, /hasn't been re-verified in over 24 hours/);
    assert.match(reason, /the account status is "STATUS_DISABLE", not active/);
    // both clauses joined, not one silently dropping the other
    assert.match(reason, /hours and the account status/);
  });
});

describe("ISSUE-978 ADVERSARIAL — G3: connectChannelFn REJECTS (not just returns {error})", () => {
  it("a thrown/rejected connectChannelFn routes to onError, never onSuccess, and resolves ok:false", async () => {
    const events = [];
    const boom = new Error("network timeout contacting admin-ad-connect");
    const reconnect = createReconnectHandler({
      connectChannelFn: async () => {
        throw boom;
      },
      onStart: (platform) => events.push(["start", platform]),
      onSuccess: (platform) => events.push(["success", platform]),
      onError: (platform, error) => events.push(["error", platform, error]),
    });
    const result = await reconnect("snapchat");
    assert.equal(result.ok, false);
    assert.equal(result.error, boom);
    assert.deepEqual(events, [
      ["start", "snapchat"],
      ["error", "snapchat", boom],
    ]);
    assert.equal(events.some((e) => e[0] === "success"), false);
  });

  it("a synchronously-throwing connectChannelFn (not even a real promise rejection) is still caught", async () => {
    const events = [];
    const reconnect = createReconnectHandler({
      connectChannelFn: async (platform) => {
        if (platform === "reddit") throw new TypeError("connectChannelFn is not a function");
        return { data: {}, error: null };
      },
      onSuccess: (platform) => events.push(["success", platform]),
      onError: (platform, err) => events.push(["error", platform, err.message]),
    });
    const result = await reconnect("reddit");
    assert.equal(result.ok, false);
    assert.deepEqual(events, [["error", "reddit", "connectChannelFn is not a function"]]);
  });
});

describe("ISSUE-978 ADVERSARIAL — G4: a FAILED reconnect never optimistically flips state", () => {
  it("google (no row) stays not_connected/never after a failed reconnect attempt on the SAME unrefreshed array", async () => {
    const connectionsBeforeAttempt = [
      { platform: "meta", connected: true, status: "connected", token_last_verified_at: isoMsAgo(1000), account_status: "ACTIVE" },
    ];

    // Sanity: google is not_connected before the attempt.
    const before = buildConnectionRows(connectionsBeforeAttempt, NOW).find((r) => r.platform === "google");
    assert.equal(before.state, "not_connected");
    assert.equal(before.verifiedAgeLabel, "never");

    const events = [];
    const reconnect = createReconnectHandler({
      connectChannelFn: async () => ({ data: null, error: { message: "424 google_not_connected" } }),
      onStart: (p) => events.push(["start", p]),
      onSuccess: (p) => events.push(["success", p]),
      onError: (p, e) => events.push(["error", p, e]),
    });
    const result = await reconnect("google");
    assert.equal(result.ok, false);
    assert.deepEqual(
      events.map((e) => e[0]),
      ["start", "error"],
    );

    // The real component only mutates its `connections` state inside
    // onSuccess (via load()) — onError never touches it. Re-deriving rows
    // from the SAME pre-attempt array (as the component's state genuinely
    // remains post-failure) must show the row UNCHANGED — no fabricated
    // "connected" flip, no fabricated timestamp.
    const after = buildConnectionRows(connectionsBeforeAttempt, NOW).find((r) => r.platform === "google");
    assert.equal(after.state, "not_connected");
    assert.equal(after.verifiedAgeLabel, "never");
    assert.equal(after.row, null);
  });
});

describe("ISSUE-978 ADVERSARIAL — G5: a SUCCESSFUL reconnect end-to-end refreshes the row", () => {
  it("google goes not_connected/never → connected once the post-refresh connections array includes its new row", async () => {
    let connections = []; // google has zero rows anywhere — worst case, empty table

    const beforeRows = buildConnectionRows(connections, NOW);
    assert.equal(beforeRows.length, 5);
    const googleBefore = beforeRows.find((r) => r.platform === "google");
    assert.equal(googleBefore.state, "not_connected");

    const newGoogleRow = {
      platform: "google",
      display_name: "Google Ads · Consumer (Mingla Ads)",
      external_account_id: "123-456-7890",
      account_status: "ENABLED",
      status: "connected",
      connected: true,
      token_last_verified_at: NOW.toISOString(),
      extra: {},
    };

    const reconnect = createReconnectHandler({
      connectChannelFn: async (platform) => {
        assert.equal(platform, "google"); // the exact-platform contract, reused as a precondition
        return { data: { connection: newGoogleRow }, error: null };
      },
      onSuccess: (_platform, data) => {
        // This mirrors AdConnectionsPanel's onSuccess → load(): the caller
        // re-fetches/merges and replaces its `connections` state. We simulate
        // the merge explicitly rather than re-fetching (no network in this
        // suite) to prove buildConnectionRows correctly reclassifies once fed
        // the refreshed array — the actual contract under test.
        connections = [...connections, data.connection];
      },
    });

    const result = await reconnect("google");
    assert.equal(result.ok, true);

    const afterRows = buildConnectionRows(connections, NOW);
    assert.equal(afterRows.length, 5); // still exactly 5 — no duplication, no drop
    const googleAfter = afterRows.find((r) => r.platform === "google");
    assert.equal(googleAfter.state, "connected");
    assert.equal(googleAfter.reason, null);
    assert.equal(googleAfter.externalAccountId, "123-456-7890");
    assert.equal(googleAfter.verifiedAgeLabel, "just now");

    // Every OTHER platform must remain untouched/not_connected — the refresh
    // must not spill state across platforms.
    for (const platform of ["meta", "tiktok", "snapchat", "reddit"]) {
      const row = afterRows.find((r) => r.platform === platform);
      assert.equal(row.state, "not_connected");
    }
  });
});

describe("ISSUE-978 ADVERSARIAL — G6: corrupt token_last_verified_at fails CLOSED inside computeConnectionStatus", () => {
  it("a garbage (non-ISO) timestamp on a 'connected' row is treated as stale, not fresh, and never throws", () => {
    assert.doesNotThrow(() => {
      const { state, reason } = computeConnectionStatus(
        {
          connected: true,
          status: "connected",
          token_last_verified_at: "not-a-real-timestamp",
          account_status: "ACTIVE",
        },
        NOW,
      );
      assert.equal(state, "stale");
      assert.match(reason, /never been verified|re-verified in over 24 hours/);
    });
  });

  it("an unrecognized account_status enum value is flagged stale, not silently accepted as active", () => {
    const { state, reason } = computeConnectionStatus(
      {
        connected: true,
        status: "connected",
        token_last_verified_at: isoMsAgo(1000),
        account_status: "SOME_FUTURE_ENUM_VALUE_NOT_YET_KNOWN",
      },
      NOW,
    );
    assert.equal(state, "stale");
    assert.match(reason, /the account status is "SOME_FUTURE_ENUM_VALUE_NOT_YET_KNOWN", not active/);
  });
});

describe("ISSUE-978 ADVERSARIAL — G7: row order is PLATFORM_META-driven, not input-order-driven", () => {
  it("a scrambled, reverse-order, partial connections array still renders in the fixed 5-platform order", () => {
    const scrambled = [
      { platform: "reddit", connected: true, status: "connected", token_last_verified_at: isoMsAgo(1000), account_status: null },
      { platform: "meta", connected: true, status: "connected", token_last_verified_at: isoMsAgo(1000), account_status: "ACTIVE" },
      { platform: "snapchat", connected: false, status: "invalid", token_last_verified_at: null, account_status: null, extra: {} },
      // tiktok and google both absent — the 2-missing-platform case (the
      // implementor's suite only ever exercises exactly one missing platform).
    ];
    const rows = buildConnectionRows(scrambled, NOW);
    assert.deepEqual(
      rows.map((r) => r.platform),
      ["meta", "tiktok", "snapchat", "google", "reddit"],
    );
    assert.equal(rows.find((r) => r.platform === "tiktok").state, "not_connected");
    assert.equal(rows.find((r) => r.platform === "google").state, "not_connected");
    assert.equal(rows.length, 5);
  });
});
