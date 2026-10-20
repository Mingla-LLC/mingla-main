// MINGLA-INVARIANT: I-3697-RECONCILE-CLEARS-ONLY-ON-ABSENCE | issue #3697 | a dead Mingla plan's hold is released only after the provider confirms every recorded object is gone; an unchecked or surviving object keeps the hold
/**
 * Issue #3697 — "Check with Meta" on a dead plan.
 *
 * Production 2026-10-20: plan 534424c7 (hash 1fde3e33…) failed while saving
 * after Meta made campaign 52609719519827. The recovery card showed three
 * warnings and no button, and the $120 hold stayed "held". Meta no longer
 * has the campaign, so the plan should clear on the first click.
 *
 * FAILS ON REVERT: delete the `reconcile_provider_objects` branch in
 * ad-plan/index.ts (the handler answers action_invalid), or
 * _shared/adPlanReconcile.ts (imports fail).
 */
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { AdApiError } from "../adChannelCore.ts";
import {
  deletionOrder,
  isMetaObjectMissing,
  probeMetaObjects,
  type ProviderObjectProbe,
  RECONCILE_DELETE_PHRASE,
  reconcileDecision,
  recordedProviderObjects,
  unsupportedProbes,
} from "../adPlanReconcile.ts";
import { handleAdPlan, type ReconcileProvider } from "../../ad-plan/index.ts";

const PLAN_ID = "534424c7-9143-474c-87ca-ae16ff051391";
const VERSION_ID = "534424c7-0000-4000-8000-000000000002";
const HASH = "1fde3e33cd9611bda2806c7b3b10b8987c563fe7" + "0".repeat(24);
const CONNECTION_ID = "534424c7-0000-4000-8000-000000000021";
const ADMIN = {
  id: "a0000000-0000-4000-8000-000000000001",
  email: "admin@test.local",
};

const failedCreateEvent = {
  id: "e1",
  campaign_id: null,
  platform: "meta",
  action: "create_failed",
  external_ids: {
    external_campaign_id: "52609719519827",
    external_adset_id: null,
    plan_version_id: VERSION_ID,
    plan_hash: HASH,
  },
  provider_response: { db_error: "ad_campaign_plan_binding_mismatch" },
};

Deno.test("#3697 lists every recorded provider object once", () => {
  const objects = recordedProviderObjects({
    attempts: [{
      command: "create_paused_objects",
      platform: "meta",
      external_ids: { external_campaign_id: "52609719519827" },
    }, {
      command: "activate",
      platform: "meta",
      external_ids: { campaign_id: "999" },
    }],
    failureEvents: [failedCreateEvent, {
      ...failedCreateEvent,
      action: "create_failed",
      external_ids: { external_creative_id: "777", plan_hash: HASH },
      provider_response: { creative_residue_id: "778" },
    }],
  });
  assertEquals(objects, [
    { platform: "meta", level: "campaign", external_id: "52609719519827" },
    { platform: "meta", level: "creative", external_id: "777" },
    { platform: "meta", level: "creative", external_id: "778" },
  ]);
});

const probe = (
  verdict: ProviderObjectProbe["verdict"],
  level: ProviderObjectProbe["level"] = "campaign",
  external_id = "52609719519827",
): ProviderObjectProbe => ({
  platform: "meta",
  level,
  external_id,
  verdict,
  provider_status: null,
  detail: null,
});

Deno.test("#3697 only an all-absent answer clears; unknown never clears", () => {
  assertEquals(reconcileDecision([probe("absent")]).verdict, "clear");
  assertEquals(
    reconcileDecision([probe("absent"), probe("exists", "ad", "1")]).verdict,
    "still_exists",
  );
  assertEquals(
    reconcileDecision([probe("absent"), probe("unknown", "ad", "1")]).verdict,
    "unknown",
  );
  assertEquals(
    unsupportedProbes([{
      platform: "tiktok",
      level: "campaign",
      external_id: "1",
    }])[0]
      .verdict,
    "unknown",
  );
  assertEquals(
    deletionOrder([
      probe("exists", "creative", "c"),
      probe("exists", "campaign", "a"),
      probe("absent", "ad_set", "s"),
      probe("exists", "ad", "d"),
    ]).map((row) => row.level),
    ["ad", "campaign", "creative"],
  );
});

Deno.test("#3697 Meta probe: not-found and DELETED are absent, only after the account reads", async () => {
  const notFound = new AdApiError({
    platform: "meta",
    code: 100,
    subcode: 33,
    message: "Unsupported get request. Object does not exist",
  });
  assert(isMetaObjectMissing(notFound));
  assert(
    !isMetaObjectMissing(
      new AdApiError({ platform: "meta", code: 190, message: "token" }),
    ),
  );
  const calls: string[] = [];
  const graph = (_method: string, path: string) => {
    calls.push(path);
    if (path === "act_1234") return Promise.resolve({ id: "act_1234" });
    if (path === "52609719519827") return Promise.reject(notFound);
    if (path === "2") return Promise.resolve({ id: "2", status: "DELETED" });
    if (path === "3") return Promise.resolve({ id: "3", status: "ACTIVE" });
    return Promise.reject(new Error("network down"));
  };
  const probes = await probeMetaObjects(graph, "act_1234", [
    { platform: "meta", level: "campaign", external_id: "52609719519827" },
    { platform: "meta", level: "ad_set", external_id: "2" },
    { platform: "meta", level: "ad", external_id: "3" },
    { platform: "meta", level: "creative", external_id: "4" },
  ]);
  assertEquals(probes.map((row) => row.verdict), [
    "absent",
    "absent",
    "exists",
    "unknown",
  ]);
  assertEquals(calls[0], "act_1234");

  const unreadable = await probeMetaObjects(
    () => Promise.reject(notFound),
    "1234",
    [{ platform: "meta", level: "campaign", external_id: "52609719519827" }],
  );
  assertEquals(
    unreadable[0].verdict,
    "unknown",
    "a wrong-account token must not read as deleted",
  );
});

// ── ad-plan handler ─────────────────────────────────────────────────────────

type Row = Record<string, unknown>;

class MiniDb {
  inserts: { table: string; row: Row }[] = [];
  rpcCalls: { name: string; args: Row }[] = [];
  auth = {
    getUser: (token: string) =>
      Promise.resolve(
        token === "admin"
          ? { data: { user: ADMIN }, error: null }
          : { data: { user: null }, error: { message: "bad" } },
      ),
  };
  constructor(readonly tables: Record<string, Row[]>) {}
  from(table: string) {
    const db = this;
    const filters: ((row: Row) => boolean)[] = [];
    const read = (row: Row, column: string) => {
      const [base, key] = column.split("->>");
      const value = row[base];
      return key === undefined
        ? value
        : value && typeof value === "object"
        ? (value as Row)[key] ?? null
        : null;
    };
    const rows = () =>
      (db.tables[table] ?? []).filter((row) => filters.every((f) => f(row)));
    const query = {
      select: () => query,
      eq: (column: string, value: unknown) => {
        filters.push((row) => read(row, column) === value);
        return query;
      },
      is: (column: string, value: unknown) => {
        filters.push((row) => (read(row, column) ?? null) === value);
        return query;
      },
      in: (column: string, values: unknown[]) => {
        filters.push((row) => values.includes(read(row, column)));
        return query;
      },
      gte: () => query,
      order: () => query,
      limit: () => query,
      maybeSingle: () =>
        Promise.resolve({ data: rows()[0] ?? null, error: null }),
      insert: (row: Row) => {
        db.inserts.push({ table, row });
        return Promise.resolve({ data: null, error: null });
      },
      then: (resolve: (value: unknown) => unknown) =>
        Promise.resolve({ data: rows(), error: null }).then(resolve),
    };
    return query;
  }
  rpc(name: string, args: Row) {
    this.rpcCalls.push({ name, args });
    return Promise.resolve({
      data: { plan: { id: PLAN_ID, state: "cancelled_before_create" } },
      error: null,
    });
  }
}

function deadPlanDb(overrides: Record<string, Row[]> = {}) {
  return new MiniDb({
    admin_users: [{ id: "admin-row", email: ADMIN.email, status: "active" }],
    ad_plans: [{
      id: PLAN_ID,
      owner_kind: "mingla",
      client_kind: "admin",
      brand_id: null,
      state: "creation_failed_terminal",
      current_version_id: VERSION_ID,
    }],
    ad_plan_versions: [{ id: VERSION_ID, plan_id: PLAN_ID, plan_hash: HASH }],
    ad_plan_provider_allocations: [{
      plan_version_id: VERSION_ID,
      platform: "meta",
      connection_id: CONNECTION_ID,
    }],
    ad_connections: [{
      id: CONNECTION_ID,
      platform: "meta",
      external_account_id: "act_1234",
    }],
    ad_provider_attempts: [{
      plan_version_id: VERSION_ID,
      command: "create_paused_objects",
      platform: "meta",
      external_ids: { external_campaign_id: "52609719519827" },
    }],
    ad_status_events: [failedCreateEvent],
    ad_campaigns: [],
    ...overrides,
  });
}

function provider(
  answer: "absent" | "exists",
  removed: string[] = [],
): ReconcileProvider {
  let current = answer;
  return {
    probe: (_connection, objects) =>
      Promise.resolve(objects.map((object) => ({
        ...object,
        verdict: current,
        provider_status: current === "exists" ? "PAUSED" : null,
        detail: null,
      }))),
    remove: (_connection, object) => {
      removed.push(`${object.level}:${object.external_id}`);
      current = "absent";
      return Promise.resolve();
    },
  };
}

async function call(
  db: MiniDb,
  body: Row,
  reconcileProvider: ReconcileProvider,
) {
  const response = await handleAdPlan(
    new Request("https://edge.test/ad-plan", {
      method: "POST",
      headers: {
        authorization: "Bearer admin",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        action: "reconcile_provider_objects",
        plan_version_id: VERSION_ID,
        plan_hash: HASH,
        ...body,
      }),
    }),
    // deno-lint-ignore no-explicit-any
    { db: db as any, reconcileProvider },
  );
  return { status: response.status, body: await response.json() as Row };
}

Deno.test("#3697 Check with Meta: nothing left → the clear RPC gets every absent ID", async () => {
  const db = deadPlanDb();
  const result = await call(db, {}, provider("absent"));
  assertEquals(result.status, 200);
  assertEquals(result.body.verdict, "cleared");
  assertEquals(db.rpcCalls.map((row) => row.name), ["ad_plan_reconcile_clear"]);
  assertEquals(db.rpcCalls[0].args.p_evidence, [{
    platform: "meta",
    level: "campaign",
    external_id: "52609719519827",
    verdict: "absent",
    provider_status: null,
  }]);
  const audit = db.inserts.find((row) => row.row.action === "reconcile_check");
  assert(audit, "every check is audited");
  assertEquals(audit.row.to_status, "clear");
});

Deno.test("#3697 Check with Meta: something left → listed, hold kept, no RPC", async () => {
  const db = deadPlanDb();
  const result = await call(db, {}, provider("exists"));
  assertEquals(result.status, 200);
  assertEquals(result.body.verdict, "still_exists");
  assertEquals(db.rpcCalls.length, 0);
  assertEquals((result.body.accounts as Row).meta, "act_1234");
  assertEquals((result.body.objects as Row[])[0].external_id, "52609719519827");
});

Deno.test("#3697 Delete on provider needs the typed phrase, then re-checks before clearing", async () => {
  const removed: string[] = [];
  const refused = await call(deadPlanDb(), {
    delete_on_provider: true,
    phrase: "delete",
  }, provider("exists", removed));
  assertEquals(refused.status, 400);
  assertEquals(removed, []);

  const db = deadPlanDb();
  const done = await call(
    db,
    { delete_on_provider: true, phrase: RECONCILE_DELETE_PHRASE },
    provider("exists", removed),
  );
  assertEquals(done.status, 200);
  assertEquals(removed, ["campaign:52609719519827"]);
  assertEquals(done.body.verdict, "cleared");
  assert(db.inserts.some((row) => row.row.action === "reconcile_deleted"));
});

Deno.test("#3697 reconcile refuses live, Host and campaign-bound plans", async () => {
  const live = await call(
    deadPlanDb({
      ad_plans: [{
        id: PLAN_ID,
        owner_kind: "mingla",
        brand_id: null,
        state: "live",
        current_version_id: VERSION_ID,
      }],
    }),
    {},
    provider("absent"),
  );
  assertEquals(live.status, 409);

  const bound = await call(
    deadPlanDb({
      ad_campaigns: [{
        id: "c1",
        plan_version_id: VERSION_ID,
        platform: "meta",
        external_campaign_id: "52609719519827",
      }],
    }),
    {},
    provider("absent"),
  );
  assertEquals(bound.status, 409);
  assertEquals(bound.body.detail, "plan_has_campaign_rows_use_end_plan");

  const wrongHash = await call(
    deadPlanDb(),
    { plan_hash: "a".repeat(64) },
    provider("absent"),
  );
  assertEquals(wrongHash.status, 409);
});
