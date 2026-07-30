import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

test("Admin expiry never silently splices queue snapshots", () => {
  const page = fs.readFileSync(
    path.resolve(here, "../pages/RefundOperationsPage.jsx"),
    "utf8",
  );
  const service = fs.readFileSync(
    path.resolve(here, "../services/refundOperationsService.js"),
    "utf8",
  );
  assert.match(
    page,
    /This queue view expired\. Refresh to load the latest refund operations\./,
  );
  assert.match(page, /Refresh queue/);
  assert.match(service, /\{ mode: "list", filters, cursor \}/);
  assert.doesNotMatch(service, /\.from\("source_refunds"\)/);
  for (
    const forbidden of [
      "recipientFingerprint",
      "recipientKeyId",
      "payloadFingerprint",
      "dispatchClaimId",
      "providerIdempotency",
      "attentionToken",
    ]
  ) assert.doesNotMatch(page, new RegExp(forbidden));
  assert.match(page, /delivery\.lastSafeCode/);
  assert.match(page, /delivery\.attempts/);
  assert.match(page, /delivery\.generation/);
});

const { createHmac } = await import("node:crypto");
const {
  appendCapturedQueuePage,
  listSourceRefundOperations,
} = await import("../services/refundOperationsService.js");

test("SC-27 Admin client keeps an updated unseen captured row exactly once", async () => {
  // SC27_EXECUTABLE_UNSEEN_ROW_UPDATE
  // ISSUE_1221_LIVE_SEEK_REVERSION=1 restores the mutable cursor model; the
  // immutable assertions below must fail by skipping the moved unseen row.
  const mutableLiveSeek = process.env.ISSUE_1221_LIVE_SEEK_REVERSION === "1";
  const secret = "issue-1221-sc27-admin-ui-reversion-secret";
  const snapshotId = "12210000-0000-4000-8000-000000000027";
  const rows = [
    {
      id: "12210000-0000-4000-8000-000000000101",
      updatedAt: "2030-01-03T00:00:00.000Z",
      capturedUpdatedAt: "2030-01-03T00:00:00.000Z",
    },
    {
      id: "12210000-0000-4000-8000-000000000102",
      updatedAt: "2030-01-02T00:00:00.000Z",
      capturedUpdatedAt: "2030-01-02T00:00:00.000Z",
    },
    {
      id: "12210000-0000-4000-8000-000000000103",
      updatedAt: "2030-01-01T00:00:00.000Z",
      capturedUpdatedAt: "2030-01-01T00:00:00.000Z",
    },
  ];
  const signCursor = (nextOrdinal) => {
    const payload = JSON.stringify({ v: 1, snapshotId, nextOrdinal });
    const signature = createHmac("sha256", secret)
      .update(payload)
      .digest("base64url");
    return `${Buffer.from(payload).toString("base64url")}.${signature}`;
  };
  const captured = rows.map((row, ordinal) => ({
    ordinal,
    itemKind: "refund_operation",
    itemId: row.id,
    safeSummary: { updatedAt: row.capturedUpdatedAt },
  }));
  const cursors = new Map([
    [signCursor(1), 1],
    [signCursor(2), 2],
  ]);
  let liveCursor = rows[0];
  const invoke = async (name, { body }) => {
    assert.equal(name, "admin-source-refund-operations");
    const nextOrdinal = body.cursor ? cursors.get(body.cursor) : 0;
    assert.notEqual(nextOrdinal, undefined);
    let items;
    if (mutableLiveSeek && nextOrdinal > 0) {
      const next = [...rows]
        .sort((left, right) =>
          right.updatedAt.localeCompare(left.updatedAt) ||
          right.id.localeCompare(left.id)
        )
        .find((row) =>
          row.updatedAt < liveCursor.updatedAt ||
          (row.updatedAt === liveCursor.updatedAt && row.id < liveCursor.id)
        );
      items = next
        ? [{
          ordinal: nextOrdinal,
          itemKind: "refund_operation",
          itemId: next.id,
          safeSummary: { updatedAt: next.updatedAt },
        }]
        : [];
      liveCursor = next ?? liveCursor;
    } else {
      items = captured.slice(nextOrdinal, nextOrdinal + 1);
    }
    return {
      data: {
        snapshot_id: snapshotId,
        snapshot_created_at: "2030-01-04T00:00:00.000Z",
        snapshot_expires_at: "2030-01-04T00:15:00.000Z",
        item_count: 3,
        page_size: 1,
        items,
        nextCursor: items.length && nextOrdinal + 1 < 3
          ? signCursor(nextOrdinal + 1)
          : null,
      },
      error: null,
    };
  };

  let queue = await listSourceRefundOperations({ limit: 1 }, invoke);
  rows[2].updatedAt = "2030-01-05T00:00:00.000Z";
  while (queue.nextCursor) {
    const page = await listSourceRefundOperations(
      { cursor: queue.nextCursor },
      invoke,
    );
    queue = appendCapturedQueuePage(queue, page);
  }

  const ids = queue.items.map((item) => item.itemId);
  assert.deepEqual(
    ids,
    rows.map((row) => row.id),
    `SC27_MUTABLE_LIVE_SEEK_SKIPPED_UNSEEN_ROW:${ids.join(",")}`,
  );
  assert.equal(new Set(ids).size, 3);
  assert.deepEqual(queue.items.map((item) => item.ordinal), [0, 1, 2]);
  assert.equal(
    queue.items[2].safeSummary.updatedAt,
    rows[2].capturedUpdatedAt,
  );
});
