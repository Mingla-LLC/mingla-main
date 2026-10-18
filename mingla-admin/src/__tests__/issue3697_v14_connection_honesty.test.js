import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  AUTO_VERIFY_INTERVAL_MS,
  autoVerificationPlatforms,
  buildConnectionRows,
  createReconnectHandler,
} from "../lib/adConnections.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (relativePath) => fs.readFileSync(path.join(HERE, "..", relativePath), "utf8");
const NOW = new Date("2026-10-17T16:00:00.000Z");

const connected = (platform, verifiedAt, accountStatus = "ACTIVE") => ({
  platform,
  connected: true,
  status: "connected",
  account_status: accountStatus,
  token_last_verified_at: verifiedAt,
  extra: {},
});

describe("ISSUE-3697 v1.4 — connection copy and actions tell the truth", () => {
  it("distinguishes missing, invalid, verification-due and healthy rows", () => {
    const rows = buildConnectionRows([
      connected("meta", "2026-10-17T15:00:00.000Z"),
      connected("tiktok", "2026-10-15T15:00:00.000Z", "STATUS_ENABLE"),
      {
        platform: "snapchat",
        connected: false,
        status: "invalid",
        account_status: "DISABLED",
        token_last_verified_at: null,
        extra: { last_error: "Funding source is inactive." },
      },
    ], NOW);

    const meta = rows.find((row) => row.platform === "meta");
    assert.equal(meta.operatorState, "connected");
    assert.equal(meta.action, "status");
    assert.equal(meta.actionLabel, "Verify now");

    const tiktok = rows.find((row) => row.platform === "tiktok");
    assert.equal(tiktok.state, "stale", "legacy fail-closed state remains compatible");
    assert.equal(tiktok.operatorState, "verification_due");
    assert.equal(tiktok.operatorLabel, "Verification due");
    assert.equal(tiktok.action, "status");

    const snapchat = rows.find((row) => row.platform === "snapchat");
    assert.equal(snapchat.operatorState, "needs_attention");
    assert.equal(snapchat.actionLabel, "Reconnect");
    assert.equal(snapchat.operatorReason, "Funding source is inactive.");

    const google = rows.find((row) => row.platform === "google");
    assert.equal(google.operatorState, "not_connected");
    assert.equal(google.actionLabel, "Connect");
  });

  it("never auto-connects missing or invalid rows and rate-limits connected checks", () => {
    const rows = [
      connected("meta", NOW.toISOString()),
      connected("reddit", NOW.toISOString(), null),
      { platform: "google", connected: false, status: "invalid" },
    ];
    const nowMs = NOW.getTime();

    assert.deepEqual(
      autoVerificationPlatforms(rows, {}, nowMs),
      ["meta", "reddit"],
    );
    assert.deepEqual(
      autoVerificationPlatforms(rows, {
        meta: nowMs - AUTO_VERIFY_INTERVAL_MS + 1,
        reddit: nowMs - AUTO_VERIFY_INTERVAL_MS,
      }, nowMs),
      ["reddit"],
    );
  });

  it("sends explicit status checks through the consumer lane", async () => {
    const calls = [];
    const events = [];
    const act = createReconnectHandler({
      connectChannelFn: async (...args) => {
        calls.push(args);
        return { data: { connection: { platform: args[0] } }, error: null };
      },
      lane: "consumer",
      onSuccess: (platform, _data, action) => events.push([platform, action]),
    });

    await act("meta", "status");
    assert.deepEqual(calls, [["meta", "status", "consumer"]]);
    assert.deepEqual(events, [["meta", "status"]]);
  });

  it("wires bounded visible-tab verification and removes the duplicate Meta card", () => {
    const panel = read("components/AdConnectionsPanel.jsx");
    const page = read("pages/AdEnginePage.jsx");

    assert.match(panel, /connectChannel\(platform, "status", "consumer"\)/);
    assert.match(panel, /AUTO_VERIFY_INTERVAL_MS/);
    assert.match(panel, /visibilitychange/);
    assert.match(panel, /reconnect\(row\.platform, row\.action\)/);
    assert.doesNotMatch(page, /Meta connection — detail/);
    assert.doesNotMatch(page, /Connect Meta/);
  });
});
