import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const service = fs.readFileSync(path.resolve(here, "../identityReadService.js"), "utf8");
const helperStart = service.indexOf("export function followerNumber");
const helperEnd = service.indexOf("// ── Unified Person", helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, "follower row helpers are present");
const helperModule = await import(
  `data:text/javascript;base64,${Buffer.from(service.slice(helperStart, helperEnd)).toString("base64")}`
);
const {
  mergeFollowerSortedBrandRows,
  parseFollowerSortPage,
  parseFollowerStatsRows,
} = helperModule;

describe("#3682 Admin brand follower sorting", () => {
  it("uses the follower RPC with current filters, direction and page", () => {
    assert.match(service, /sortKey === "follower_count"/);
    assert.match(service, /"admin_list_brands_by_followers"/);
    for (const argument of [
      "p_search",
      "p_claim_status",
      "p_status",
      "p_payment_provider",
      "p_ascending",
      "p_offset",
      "p_limit",
    ]) {
      assert.ok(service.includes(argument), `forwards ${argument}`);
    }
    assert.match(service, /total:\s*parsedFollowerPage\.total/);
  });

  it("preserves the RPC order while merging fetched brand rows", () => {
    const rows = mergeFollowerSortedBrandRows(
      [
        { id: "b", name: "Second fetched" },
        { id: "a", name: "First fetched" },
      ],
      [
        { brandId: "a", followerCount: "3402", newThisWeek: "61" },
        { brandId: "b", followerCount: 310, newThisWeek: 0 },
      ],
    );
    assert.deepEqual(
      rows.map((row) => [row.id, row.follower_count, row.new_this_week]),
      [
        ["a", 3402, 61],
        ["b", 310, 0],
      ],
    );
  });

  it("fails closed for malformed, duplicate, or negative sort rows", () => {
    for (const page of [
      null,
      { total: "bad", rows: [] },
      { total: 1, rows: [{ brandId: "a", followerCount: -1, newThisWeek: 0 }] },
      {
        total: 2,
        rows: [
          { brandId: "a", followerCount: 1, newThisWeek: 0 },
          { brandId: "a", followerCount: 1, newThisWeek: 0 },
        ],
      },
    ]) {
      assert.throws(() => parseFollowerSortPage(page), /malformed/);
    }
  });

  it("preserves null stats for deleted brands", () => {
    assert.deepEqual(
      parseFollowerSortPage({
        total: 1,
        rows: [{ brandId: "deleted", followerCount: null, newThisWeek: null }],
      }),
      {
        total: 1,
        rows: [{ brandId: "deleted", followerCount: null, newThisWeek: null }],
      },
    );
  });

  it("accepts complete live stats and rejects omissions or foreign rows", () => {
    assert.deepEqual(
      parseFollowerStatsRows(
        [{ brand_id: "a", follower_count: "0", new_this_week: 0 }],
        ["a"],
      ),
      [{ brand_id: "a", follower_count: 0, new_this_week: 0 }],
    );
    assert.throws(() => parseFollowerStatsRows([], ["a"]), /malformed/);
    assert.throws(
      () => parseFollowerStatsRows(
        [{ brand_id: "other", follower_count: 1, new_this_week: 0 }],
        ["a"],
      ),
      /malformed/,
    );
  });
});
