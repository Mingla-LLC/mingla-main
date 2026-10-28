import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { processScheduledInstallments } from "../index.ts";

type Planned = { data: unknown; error: null };

function fakeSupabase(plans: Planned[]) {
  const operations: Array<{ table: string; method: string; args: unknown[] }> =
    [];
  class Query implements PromiseLike<Planned> {
    constructor(private table: string) {}
    private op(method: string, ...args: unknown[]) {
      operations.push({ table: this.table, method, args });
      return this;
    }
    select(...args: unknown[]) {
      return this.op("select", ...args);
    }
    eq(...args: unknown[]) {
      return this.op("eq", ...args);
    }
    neq(...args: unknown[]) {
      return this.op("neq", ...args);
    }
    is(...args: unknown[]) {
      return this.op("is", ...args);
    }
    in(...args: unknown[]) {
      return this.op("in", ...args);
    }
    gt(...args: unknown[]) {
      return this.op("gt", ...args);
    }
    lte(...args: unknown[]) {
      return this.op("lte", ...args);
    }
    lt(...args: unknown[]) {
      return this.op("lt", ...args);
    }
    order(...args: unknown[]) {
      return this.op("order", ...args);
    }
    limit(...args: unknown[]) {
      return this.op("limit", ...args);
    }
    update(...args: unknown[]) {
      return this.op("update", ...args);
    }
    maybeSingle() {
      this.op("maybeSingle");
      return Promise.resolve(plans.shift() ?? { data: null, error: null });
    }
    then<TResult1 = Planned, TResult2 = never>(
      onfulfilled?:
        | ((value: Planned) => TResult1 | PromiseLike<TResult1>)
        | null,
      onrejected?:
        | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
        | null,
    ): PromiseLike<TResult1 | TResult2> {
      return Promise.resolve(plans.shift() ?? { data: [], error: null }).then(
        onfulfilled,
        onrejected,
      );
    }
  }
  return {
    client: {
      from(table: string) {
        operations.push({ table, method: "from", args: [] });
        return new Query(table);
      },
      rpc() {
        return Promise.resolve({ data: null, error: null });
      },
    } as never,
    operations,
  };
}

const noNotices: Planned = { data: [], error: null };

Deno.test("#3645 scheduler runs reconcile, notice, due and retry passes in order", async () => {
  const fake = fakeSupabase([
    { data: [], error: null },
    noNotices,
    { data: [{ id: "due", collection_method: "pay_link" }], error: null },
    { data: [{ id: "retry", collection_method: "pay_link" }], error: null },
  ]);
  const triggers: string[] = [];
  const result = await processScheduledInstallments(fake.client, {
    deps: {
      now: () => new Date("2027-03-01T12:00:00Z"),
      charge: async (input) => {
        triggers.push(`${input.installmentId}:${input.trigger}`);
        return { outcome: "pay_link_sent" };
      },
    },
  });
  assertEquals(triggers, ["due:cron", "retry:retry"]);
  assertEquals(result.processed, 2);
  assertEquals(result.pay_links_sent, 2);
  const tables = fake.operations.filter((op) => op.method === "from").map((
    op,
  ) => op.table);
  assertEquals(tables.slice(0, 4), [
    "order_installment_charge_attempts",
    "order_installments",
    "order_installments",
    "order_installments",
  ]);
  const inFlightFilters = fake.operations.filter((op) =>
    op.method === "is" && op.args[0] === "in_flight_attempt_id" &&
    op.args[1] === null
  );
  assertEquals(inFlightFilters.length, 2);
  const statusFlips = fake.operations.filter((op) =>
    op.method === "update" &&
    (op.args[0] as Record<string, unknown>).status === "scheduled"
  );
  assertEquals(
    statusFlips.length,
    0,
    "pay-link retries stay failed for checkpoint handling",
  );
});

Deno.test("#3645 notice claim sends once and reports the link as both notice and pay-link", async () => {
  const fake = fakeSupabase([
    { data: [], error: null },
    {
      data: [{
        id: "notice-1",
        order_id: "order-1",
        collection_method: "pay_link",
        due_at: "2027-03-03T12:00:00Z",
        orders: { events: { brand_id: "brand-1", title: "Trip" } },
      }],
      error: null,
    },
    { data: { id: "notice-1" }, error: null },
    { data: [], error: null },
    { data: [], error: null },
  ]);
  let sends = 0;
  const result = await processScheduledInstallments(fake.client, {
    deps: {
      now: () => new Date("2027-03-01T12:00:00Z"),
      sendPayLink: async () => {
        sends += 1;
        return {
          ok: true,
          linkId: "link-1",
          emailSent: true,
          pushSent: false,
          url: "https://example.test",
        };
      },
    },
  });
  assertEquals(sends, 1);
  assertEquals(result.notices_sent, 1);
  assertEquals(result.pay_links_sent, 1);
});

Deno.test("#3645 failed notice delivery releases its claim for the next cron", async () => {
  const source = await Deno.readTextFile(
    new URL("../index.ts", import.meta.url),
  );
  assertStringIncludes(
    source,
    "await resetNoticeClaim(supabase, installmentId)",
  );
  assertStringIncludes(source, '.is("pre_charge_notice_sent_at", null)');
  assertStringIncludes(source, "p_count_failure: countFailure");
  if (!/"failed",\s*"not_created",\s*false/.test(source)) {
    throw new Error("404 auto-card reconciliation must not count a failure");
  }
});
