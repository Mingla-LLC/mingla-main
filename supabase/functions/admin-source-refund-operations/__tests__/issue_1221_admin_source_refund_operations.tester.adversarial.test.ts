import {
  assert,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
const source = await Deno.readTextFile(new URL("../index.ts", import.meta.url));
Deno.test("Admin auth precedes cursor parsing and cursor validation is bounded", () => {
  assert(
    source.indexOf('from("admin_users")') <
      source.indexOf("decodeCursor(body.cursor)"),
  );
  assertStringIncludes(source, "value.length > 1024");
  assertStringIncludes(source, "difference |=");
  assertStringIncludes(
    source,
    'return reply({ error: "invalid_cursor" }, 400)',
  );
  assertStringIncludes(source, 'errorCode === "snapshot_expired"');
  assertStringIncludes(source, "? 410");
  assertStringIncludes(source, "!allowedEnumValues[key].has(item)");
  assert(
    source.indexOf("allowedEnumValues[key]") <
      source.indexOf("JSON.stringify(filters)"),
  );
});

const {
  createAdminSourceRefundOperationsHandler,
} = await import("../index.ts");

interface Sc27Row {
  id: string;
  updatedAt: string;
  capturedUpdatedAt: string;
}

interface Sc27Item {
  ordinal: number;
  itemKind: "refund_operation";
  itemId: string;
  safeSummary: { updatedAt: string };
}

interface Sc27Envelope {
  snapshot_id: string;
  snapshot_created_at: string;
  snapshot_expires_at: string;
  item_count: number;
  page_size: number;
  items: Sc27Item[];
  nextCursor: string | null;
}

Deno.test("SC-27 signed Edge pages keep an updated unseen row captured exactly once", async () => {
  // SC27_EXECUTABLE_UNSEEN_ROW_UPDATE
  // Passing issue-1221-live-seek-reversion to `deno test` switches the fake RPC
  // to mutable DESC (updated_at,id) seek; the immutable assertions below must fail.
  const mutableLiveSeek = Deno.args.includes(
    "issue-1221-live-seek-reversion",
  );
  const snapshotId = "12210000-0000-4000-8000-000000000027";
  const adminId = "12210000-0000-4000-8000-000000000001";
  const secret = "issue-1221-sc27-test-secret-is-at-least-32-bytes";
  const rows: Sc27Row[] = [
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
  let captured: Sc27Item[] | null = null;
  let liveCursor: Sc27Row | null = null;
  const resolveContext = async () => ({
    userId: adminId,
    isActiveAdmin: true,
    rpc: async (
      name: string,
      args: Record<string, unknown>,
    ) => {
      assert(name === "admin_list_source_refund_operations");
      const nextOrdinal = Number(args.p_next_ordinal);
      if (args.p_snapshot_id === null) {
        captured = [...rows]
          .sort((left, right) =>
            right.updatedAt.localeCompare(left.updatedAt) ||
            right.id.localeCompare(left.id)
          )
          .map((row, ordinal) => ({
            ordinal,
            itemKind: "refund_operation" as const,
            itemId: row.id,
            safeSummary: { updatedAt: row.capturedUpdatedAt },
          }));
        liveCursor = rows[0];
      }
      let items: Sc27Item[];
      if (mutableLiveSeek && nextOrdinal > 0) {
        const cursor = liveCursor;
        const next = cursor
          ? [...rows]
            .sort((left, right) =>
              right.updatedAt.localeCompare(left.updatedAt) ||
              right.id.localeCompare(left.id)
            )
            .find((row) =>
              row.updatedAt < cursor.updatedAt ||
              (row.updatedAt === cursor.updatedAt && row.id < cursor.id)
            )
          : undefined;
        items = next
          ? [{
            ordinal: nextOrdinal,
            itemKind: "refund_operation",
            itemId: next.id,
            safeSummary: { updatedAt: next.updatedAt },
          }]
          : [];
        liveCursor = next ?? null;
      } else {
        items = (captured ?? []).slice(nextOrdinal, nextOrdinal + 1);
      }
      return {
        data: [{
          snapshot_id: snapshotId,
          snapshot_created_at: "2030-01-04T00:00:00.000Z",
          snapshot_expires_at: "2030-01-04T00:15:00.000Z",
          item_count: 3,
          page_size: 1,
          items,
        }],
        error: null,
      };
    },
  });
  const handler = createAdminSourceRefundOperationsHandler(
    resolveContext,
    secret,
  );
  const request = (body: Record<string, unknown>) =>
    handler(
      new Request("https://refunds.test/admin-source-refund-operations", {
        method: "POST",
        headers: {
          authorization: "Bearer issue-1221-test-admin",
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      }),
    );

  const first = await (await request({
    mode: "list",
    filters: { sourceType: ["rsvp_contribution"] },
    limit: 1,
  })).json() as Sc27Envelope;
  rows[2].updatedAt = "2030-01-05T00:00:00.000Z";
  const second = await (await request({
    mode: "list",
    filters: { sourceType: ["rsvp_contribution"] },
    cursor: first.nextCursor,
  })).json() as Sc27Envelope;
  const third = await (await request({
    mode: "list",
    filters: { sourceType: ["rsvp_contribution"] },
    cursor: second.nextCursor,
  })).json() as Sc27Envelope;

  const items = [...first.items, ...second.items, ...third.items];
  const ids = items.map((item) => item.itemId);
  assert(
    ids.join(",") === rows.map((row) => row.id).join(","),
    `SC27_MUTABLE_LIVE_SEEK_SKIPPED_UNSEEN_ROW:${ids.join(",")}`,
  );
  assert(new Set(ids).size === 3);
  assert(items.map((item) => item.ordinal).join(",") === "0,1,2");
  assert(
    items[2].safeSummary.updatedAt === rows[2].capturedUpdatedAt,
    "SC27_CAPTURED_SUMMARY_WAS_REFRESHED_FROM_LIVE_TRUTH",
  );
});
