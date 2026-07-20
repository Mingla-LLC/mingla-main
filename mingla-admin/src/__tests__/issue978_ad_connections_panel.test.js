// ISSUE-978 [Ad Connections panel] — happy-path regression coverage.
//
// Gap this closes (#977 Lane B/E/G forensics): admin-ad-connect already
// connects/verifies all 5 platforms and upserts connected/status/
// token_last_verified_at/account_status on success; the admin FRONTEND only
// ever exposed Meta. This suite pins the two behaviors the panel is built on
// (lib/adConnections.js, dependency-free per the house pattern — no DOM
// render harness exists in this repo, so business logic is unit-tested
// directly, same as lib/adBuilder/*.js):
//   1. buildConnectionRows ALWAYS renders exactly 5 rows, in the fixed
//      platform order, even when the live ad_connections table has zero
//      rows for a platform (Google, pre-provisioning — proven live-empty in
//      #977 Lane E/F-7) — never silently drops a channel.
//   2. The Reconnect click handler calls connectChannel with the EXACT
//      platform clicked (not a stale closure / not always "meta").
//   3. Staleness classification: a connected row with an old/absent
//      token_last_verified_at, or a non-active account_status, is flagged
//      "stale" (not falsely shown as healthy "connected").

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildConnectionRows,
  computeConnectionStatus,
  createReconnectHandler,
  humanizeAge,
  PLATFORMS,
} from "../lib/adConnections.js";

const NOW = new Date("2026-07-20T12:00:00.000Z");

const mockConnections = [
  {
    platform: "meta",
    display_name: "Meta · Consumer (Velvet Lounge Ads)",
    external_account_id: "act_123456",
    account_status: "ACTIVE",
    status: "connected",
    connected: true,
    token_last_verified_at: "2026-07-20T10:00:00.000Z", // 2h ago — fresh
    extra: {},
  },
  {
    platform: "tiktok",
    display_name: "TikTok · Consumer",
    external_account_id: "7627974536397766673",
    account_status: "STATUS_DISABLE", // not in the active set
    status: "connected",
    connected: true,
    token_last_verified_at: "2026-07-20T11:59:00.000Z", // 1m ago — fresh age, but bad account_status
    extra: {},
  },
  {
    platform: "snapchat",
    display_name: "Snapchat · Consumer",
    external_account_id: "unconfigured",
    account_status: null,
    status: "invalid",
    connected: false,
    token_last_verified_at: null,
    extra: { last_error: "no ACTIVE funding source on the organization" },
  },
  {
    platform: "reddit",
    display_name: "Reddit · Consumer",
    external_account_id: "t2_abc123",
    account_status: null,
    status: "connected",
    connected: true,
    token_last_verified_at: "2026-07-17T12:00:00.000Z", // 3 days ago — stale by age
    extra: {},
  },
  // NOTE: no "google" row at all — admin-ad-connect never writes one until
  // its secrets are provisioned (409 google_not_provisioned, #977 F-7).
];

describe("ISSUE-978 — buildConnectionRows always renders all 5 platforms", () => {
  it("returns exactly 5 rows, in fixed platform order, even with a missing row (google)", () => {
    const rows = buildConnectionRows(mockConnections, NOW);
    assert.equal(rows.length, 5);
    assert.deepEqual(rows.map((r) => r.platform), PLATFORMS);
    assert.deepEqual(PLATFORMS, ["meta", "tiktok", "snapchat", "google", "reddit"]);
  });

  it("the missing google row renders as an honest not_connected/never — never fabricated", () => {
    const rows = buildConnectionRows(mockConnections, NOW);
    const google = rows.find((r) => r.platform === "google");
    assert.equal(google.state, "not_connected");
    assert.equal(google.row, null);
    assert.equal(google.displayName, null);
    assert.equal(google.verifiedAgeLabel, "never");
    assert.equal(google.reason, "Not connected yet.");
  });

  it("a fresh, active connection (meta) classifies as connected with no reason", () => {
    const rows = buildConnectionRows(mockConnections, NOW);
    const meta = rows.find((r) => r.platform === "meta");
    assert.equal(meta.state, "connected");
    assert.equal(meta.reason, null);
    assert.equal(meta.verifiedAgeLabel, "2h ago");
    assert.equal(meta.externalAccountId, "act_123456");
  });

  it("an invalid row (snapchat) surfaces the persisted extra.last_error verbatim as the plain reason", () => {
    const rows = buildConnectionRows(mockConnections, NOW);
    const snap = rows.find((r) => r.platform === "snapchat");
    assert.equal(snap.state, "not_connected");
    assert.equal(snap.reason, "no ACTIVE funding source on the organization");
  });
});

describe("ISSUE-978 — staleness detection (both triggers)", () => {
  it("a connected row with a fresh timestamp but an inactive account_status (tiktok) is STALE, not green", () => {
    const rows = buildConnectionRows(mockConnections, NOW);
    const tiktok = rows.find((r) => r.platform === "tiktok");
    assert.equal(tiktok.state, "stale");
    assert.match(tiktok.reason, /account status is "STATUS_DISABLE", not active/);
  });

  it("a connected row whose token was verified >24h ago (reddit) is STALE by age", () => {
    const rows = buildConnectionRows(mockConnections, NOW);
    const reddit = rows.find((r) => r.platform === "reddit");
    assert.equal(reddit.state, "stale");
    assert.match(reddit.reason, /hasn't been re-verified in over 24 hours/);
  });

  it("connected + null token_last_verified_at is stale (never verified), not silently green", () => {
    const { state, reason } = computeConnectionStatus(
      { connected: true, status: "connected", token_last_verified_at: null, account_status: "ACTIVE" },
      NOW,
    );
    assert.equal(state, "stale");
    assert.match(reason, /has never been verified/);
  });

  it("humanizeAge: never / just now / minutes / hours / days, never throws on bad input", () => {
    assert.equal(humanizeAge(null, NOW), "never");
    assert.equal(humanizeAge("not-a-date", NOW), "never");
    assert.equal(humanizeAge(NOW.toISOString(), NOW), "just now");
    assert.equal(humanizeAge("2026-07-20T11:30:00.000Z", NOW), "30m ago");
    assert.equal(humanizeAge("2026-07-20T09:00:00.000Z", NOW), "3h ago");
    assert.equal(humanizeAge("2026-07-17T12:00:00.000Z", NOW), "3d ago");
  });
});

describe("ISSUE-978 — Reconnect handler calls connectChannel with the EXACT platform clicked", () => {
  it("clicking Reconnect on tiktok invokes connectChannelFn('tiktok', 'connect') — not a stale/wrong platform", async () => {
    const calls = [];
    const reconnect = createReconnectHandler({
      connectChannelFn: async (platform, action) => {
        calls.push([platform, action]);
        return { data: { connection: { platform, connected: true } }, error: null };
      },
    });
    await reconnect("tiktok");
    assert.deepEqual(calls, [["tiktok", "connect"]]);
  });

  it("each of the 5 platforms round-trips its own platform id through the handler (no cross-platform leakage)", async () => {
    for (const platform of PLATFORMS) {
      const calls = [];
      const reconnect = createReconnectHandler({
        connectChannelFn: async (p, a) => {
          calls.push([p, a]);
          return { data: {}, error: null };
        },
      });
      await reconnect(platform);
      assert.deepEqual(calls, [[platform, "connect"]]);
    }
  });

  it("onStart/onSuccess fire in order on a successful connect", async () => {
    const events = [];
    const reconnect = createReconnectHandler({
      connectChannelFn: async (platform) => ({ data: { connection: { platform } }, error: null }),
      onStart: (platform) => events.push(["start", platform]),
      onSuccess: (platform, data) => events.push(["success", platform, data]),
    });
    const result = await reconnect("meta");
    assert.equal(result.ok, true);
    assert.deepEqual(events, [
      ["start", "meta"],
      ["success", "meta", { connection: { platform: "meta" } }],
    ]);
  });

  it("onError fires (not onSuccess) when connectChannelFn returns an edge error — the row stays actionable", async () => {
    const events = [];
    const edgeError = { message: "424 meta_page_not_assigned" };
    const reconnect = createReconnectHandler({
      connectChannelFn: async () => ({ data: null, error: edgeError }),
      onStart: (platform) => events.push(["start", platform]),
      onSuccess: (platform) => events.push(["success", platform]),
      onError: (platform, error) => events.push(["error", platform, error]),
    });
    const result = await reconnect("google");
    assert.equal(result.ok, false);
    assert.deepEqual(events, [
      ["start", "google"],
      ["error", "google", edgeError],
    ]);
  });
});
