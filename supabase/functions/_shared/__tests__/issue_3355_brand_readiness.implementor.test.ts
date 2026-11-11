// Issue #3355 P2 — canonical brand readiness read for Ari (implementor happy path).
//
// MINGLA-INVARIANT: I-BRAND-READINESS-SINGLE-SOURCE | issue #3355 | No Ari module computes its own brand missing-items list: get_brand_readiness, get_operator_snapshot and the launch plan all read public.brand_readiness (pinned below; SQL behaviour pinned by supabase/migrations/__tests__/issue_3355_brand_readiness.implementor.pg17.test.sql).
//
// Drives the shipped modules:
//   * get_brand_readiness checks membership, then calls brand_readiness with
//     the action, and refuses an action outside the closed vocabulary;
//   * get_operator_snapshot carries the canonical checklist and money split
//     (can sell vs can be paid out) and no hand-made list (C1, C2, C12, D-30);
//   * the launch plan's "still needed" and payout lines come from that
//     checklist, never "Payouts are enabled" when only selling works;
//   * the brand-wide "not now" write maps refusals to plain words, verifies
//     its readback, and its confirmation card names the item in owner words;
//   * the edge's item labels equal the migration's catalogue.
//
// Run: deno test --no-check --allow-env --allow-read \
//   supabase/functions/_shared/__tests__/issue_3355_brand_readiness.implementor.test.ts

import {
  assert,
  assertEquals,
  assertMatch,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { AGENT_TOOLS, findTool, READ_ONLY_TOOL_NAMES } from "../agentTools.ts";
import { AGENT_TOOL_AUTHORIZATION } from "../agentToolAuthorization.ts";
import { TENANT_SCOPED_READ_TOOL_NAMES } from "../agentTenantScope.ts";
import { ToolError } from "../agentToolHelpers.ts";
import { buildBrandLaunchPlan } from "../agentLaunchPlan.ts";
import { buildAriOnboardingSetupReply } from "../agentToolsets.ts";
import { buildProposalPresentation } from "../ariPresentation/registry.ts";
import {
  ACTION_READINESS_ITEM_LABELS,
  BRAND_READINESS_ITEM_LABELS,
  READINESS_ACTIONS,
} from "../readinessCatalog.ts";

const ROOT = new URL("../../../../", import.meta.url);
const USER = "11111111-1111-4111-8111-111111111111";
const BRAND = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";

type Rpc = { fn: string; args: Record<string, unknown> };

const ROLE_RANK: Record<string, number> = {
  scanner: 10,
  marketing_manager: 20,
  finance_manager: 30,
  event_manager: 40,
  brand_admin: 50,
  brand_owner: 60,
};

function readinessFixture(overrides: Record<string, unknown> = {}) {
  const item = (
    key: string,
    label: string,
    group: string,
    state: string,
    extra: Record<string, unknown> = {},
  ) => ({
    key,
    label,
    group,
    state,
    severity: state === "verified" || state === "not_applicable"
      ? "done"
      : "skippable",
    blocks_action: false,
    value_preview: state === "verified" ? "Set" : null,
    deferrable: true,
    deferral: null,
    skip_in_ari: false,
    owner_action: "answer",
    fix: {
      route: `/brand/${BRAND}/edit`,
      route_label: "Brand profile",
      can_caller_fix: true,
      who_can_fix: "a brand admin or the owner",
    },
    ask: { control: "text" },
    verify: { probe: "brand_readiness", item_key: key },
    ...extra,
  });
  return {
    brand_id: BRAND,
    action: null,
    can_proceed: true,
    context_revision: "a".repeat(64),
    evaluated_at: "2026-11-01T10:00:00Z",
    counts: { blocking: 0, can_wait: 3, done: 3, deferred: 1 },
    money: {
      can_sell: true,
      can_be_paid_out: false,
      sell_reason: "ready",
      payout_reason: "payouts_disabled",
      rail: "stripe",
      currency: "GBP",
      terms_accepted_by_caller: true,
    },
    items: [
      item("name", "Brand name", "identity", "verified"),
      item("contact_email", "Contact email", "contact", "missing"),
      item("contact_phone", "Contact phone", "contact", "missing", {
        deferral: {
          by_user_id: USER,
          by_display_name: "Ada Owner",
          at: "2026-11-01T09:00:00Z",
          until: null,
          reason: "Email only",
        },
        skip_in_ari: true,
      }),
      item("social_links", "Website or social link", "contact", "verified"),
      item("design_key", "Website design", "website", "missing"),
      item("money.can_sell", "Ready to sell paid tickets", "money", "verified"),
    ],
    ...overrides,
  };
}

function fakeClient(opts: {
  rpc?: (fn: string, args: Record<string, unknown>) => {
    data?: unknown;
    error?: { code?: string; message: string } | null;
  };
  profile?: Record<string, unknown>;
  owned?: Array<Record<string, unknown>>;
}) {
  const calls: Rpc[] = [];
  const owned = opts.owned ??
    [{
      id: BRAND,
      name: "Lantern Supper Club",
      slug: "lantern",
      default_currency: "GBP",
      cover_media_url: null,
    }];
  const builder = (table: string) => {
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "is", "not", "order", "limit", "in"]) {
      chain[m] = () => chain;
    }
    chain.maybeSingle = () =>
      Promise.resolve({
        data: table === "brands" ? opts.profile ?? null : null,
        error: null,
      });
    chain.then = (resolve: (v: unknown) => unknown) =>
      resolve({
        data: table === "brands" ? owned : [],
        error: null,
      });
    return chain;
  };
  const client = {
    from: builder,
    rpc: (fn: string, args: Record<string, unknown>) => {
      // The shipped authorization wrapper asks the database for ranks.
      if (fn === "biz_brand_effective_rank_for_caller") {
        const member = owned.some((brand) => brand.id === args.p_brand_id);
        return Promise.resolve({ data: member ? 60 : 0, error: null });
      }
      if (fn === "biz_role_rank") {
        return Promise.resolve({
          data: ROLE_RANK[String(args.p_role)] ?? 0,
          error: null,
        });
      }
      calls.push({ fn, args });
      const out = opts.rpc?.(fn, args) ?? { data: null, error: null };
      return Promise.resolve({
        data: out.data ?? null,
        error: out.error ?? null,
      });
    },
  };
  // deno-lint-ignore no-explicit-any
  return { client: client as any, calls };
}

Deno.test("#3355 P2: the three readiness tools are registered, authorized and classified", () => {
  const names = AGENT_TOOLS.map((tool) => tool.name);
  for (
    const name of [
      "get_brand_readiness",
      "defer_readiness_item",
      "undefer_readiness_item",
    ]
  ) {
    assert(names.includes(name), `${name} registered`);
    assert(AGENT_TOOL_AUTHORIZATION[name], `${name} authorized`);
  }
  assert(READ_ONLY_TOOL_NAMES.has("get_brand_readiness"));
  assert(TENANT_SCOPED_READ_TOOL_NAMES.has("get_brand_readiness"));
  // Writes go through a protected confirmation, never inline.
  assert(!READ_ONLY_TOOL_NAMES.has("defer_readiness_item"));
  assert(!READ_ONLY_TOOL_NAMES.has("undefer_readiness_item"));
  // D-30: the snapshot is a read (inline, no card).
  assert(READ_ONLY_TOOL_NAMES.has("get_operator_snapshot"));
  assertEquals(
    AGENT_TOOL_AUTHORIZATION.get_brand_readiness.requiredRole,
    "scanner",
  );
});

Deno.test("#3355 P2: get_brand_readiness checks membership then reads the canonical RPC with the action", async () => {
  const { client, calls } = fakeClient({
    rpc: (fn) =>
      fn === "brand_readiness"
        ? { data: readinessFixture({ action: "publish_paid" }) }
        : {},
  });
  const tool = findTool("get_brand_readiness")!;
  const result = await tool.executor(
    { brand_id: BRAND, action: "publish_paid" },
    client,
    USER,
  ) as Record<string, unknown>;
  assertEquals(calls, [{
    fn: "brand_readiness",
    args: { p_brand_id: BRAND, p_action: "publish_paid" },
  }]);
  assertEquals(result.action, "publish_paid");
  assertEquals((result.money as Record<string, unknown>).can_sell, true);
  assertEquals(
    (result.money as Record<string, unknown>).can_be_paid_out,
    false,
  );
  const phone = (result.items as Array<Record<string, unknown>>).find((i) =>
    i.key === "contact_phone"
  )!;
  assertEquals(phone.skip_in_ari, true);
  assertEquals(
    (phone.deferral as Record<string, unknown>).by_display_name,
    "Ada Owner",
  );

  // Not a member: refused before any RPC.
  const denied = fakeClient({ rpc: () => ({ data: readinessFixture() }) });
  await assertRejects(
    () => tool.executor({ brand_id: OTHER }, denied.client, USER),
    ToolError,
  );
  assertEquals(denied.calls.length, 0);

  // Closed action vocabulary.
  await assertRejects(
    () =>
      tool.executor(
        { brand_id: BRAND, action: "publish_everything" },
        client,
        USER,
      ),
    ToolError,
    "action must be",
  );

  // Migration not applied yet: a typed, honest "unavailable".
  const missing = fakeClient({
    rpc: () => ({
      error: { code: "PGRST202", message: "Could not find the function" },
    }),
  });
  const error = await assertRejects(
    () => tool.executor({ brand_id: BRAND }, missing.client, USER),
    ToolError,
  );
  assertEquals((error as ToolError).code, "READINESS_UNAVAILABLE");
});

Deno.test("#3355 P2: the operator snapshot carries the canonical checklist and money split, not its own list", async () => {
  const { client, calls } = fakeClient({
    profile: {
      id: BRAND,
      name: "Lantern Supper Club",
      slug: "lantern",
      description: "Supper clubs.",
      city: "London",
      country_code: "GB",
      default_currency: "GBP",
      // The old hand-made list would have called this "has socials" (C1).
      social_links: { instagram: "" },
      custom_links: [],
    },
    rpc: (fn) =>
      fn === "brand_readiness"
        ? { data: readinessFixture() }
        // A stale probe that disagrees: the snapshot must not use it.
        : fn === "pg_brand_can_collect"
        ? { data: false }
        : {},
  });
  const snapshot = await findTool("get_operator_snapshot")!.executor(
    { brand_id: BRAND },
    client,
    USER,
  ) as Record<string, unknown>;
  assertEquals(calls.map((c) => c.fn), ["brand_readiness"]);
  assertEquals(calls[0].args, { p_brand_id: BRAND, p_action: null });
  const selected = snapshot.selected_brand as Record<string, unknown>;
  assert(!("genuinely_missing" in selected), "no hand-made missing list");
  const readiness = selected.readiness as Record<string, unknown>;
  const items = readiness.items as Array<Record<string, unknown>>;
  assertEquals(
    items.map((i) => i.key),
    readinessFixture().items.map((i) => i.key),
  );
  // C2: contact email is in the canonical list.
  assertEquals(items.find((i) => i.key === "contact_email")?.state, "missing");
  assertEquals(
    (items.find((i) => i.key === "contact_phone")?.not_now as Record<
      string,
      unknown
    >).by,
    "Ada Owner",
  );
  assertEquals(
    snapshot.payout_ready,
    true,
    "can sell comes from the canonical read",
  );
  assertEquals(snapshot.can_be_paid_out, false);
  assertEquals(selected.readiness_unavailable, false);
});

Deno.test("#3355 P2: snapshot lists up to 50 brands with the requested one first (C12)", async () => {
  const owned = Array.from({ length: 60 }, (_, index) => ({
    id: `44444444-4444-4444-8444-${String(index).padStart(12, "0")}`,
    name: `Brand ${index}`,
    slug: `brand-${index}`,
    default_currency: "GBP",
    cover_media_url: null,
  }));
  const requested = owned[55].id;
  const { client } = fakeClient({
    owned,
    profile: { id: requested, name: "Brand 55" },
    rpc: (fn) => fn === "brand_readiness" ? { data: readinessFixture() } : {},
  });
  const snapshot = await findTool("get_operator_snapshot")!.executor(
    { brand_id: requested },
    client,
    USER,
  ) as Record<string, unknown>;
  const brands = snapshot.brands as Array<Record<string, unknown>>;
  assertEquals(brands.length, 50);
  assertEquals(brands[0].id, requested);
});

Deno.test("#3355 P2: while the read is not deployed the snapshot says so and invents nothing", async () => {
  const { client } = fakeClient({
    profile: { id: BRAND, name: "Lantern Supper Club" },
    rpc: (fn) =>
      fn === "brand_readiness"
        ? {
          error: {
            code: "PGRST202",
            message: "Could not find the function public.brand_readiness",
          },
        }
        : fn === "pg_brand_can_collect"
        ? { data: false }
        : {},
  });
  const snapshot = await findTool("get_operator_snapshot")!.executor(
    { brand_id: BRAND },
    client,
    USER,
  ) as Record<string, unknown>;
  const selected = snapshot.selected_brand as Record<string, unknown>;
  assertEquals(selected.readiness, null);
  assertEquals(selected.readiness_unavailable, true);
  assert(!("genuinely_missing" in selected));
});

Deno.test("#3355 P2: the launch plan reads the canonical checklist and says can-sell vs paid-out honestly", () => {
  const plan = buildBrandLaunchPlan({
    brandName: "Lantern Supper Club",
    observations: [{
      tool: "get_operator_snapshot",
      args: { brand_id: BRAND },
      result: {
        selected_brand: {
          name: "Lantern Supper Club",
          city: "London",
          readiness: {
            counts: readinessFixture().counts,
            money: readinessFixture().money,
            items: readinessFixture().items.map((i) => ({
              key: i.key,
              label: i.label,
              group: i.group,
              state: i.state,
              severity: i.severity,
              not_now: i.deferral
                ? {
                  by: "Ada Owner",
                  at: i.deferral.at,
                  reason: i.deferral.reason,
                }
                : null,
            })),
          },
        },
        offerings: [],
        payout_ready: true,
      },
      elapsedMs: 1,
    }, {
      tool: "get_brand_site",
      args: { brand_id: BRAND },
      result: { website_state: "not_set_up" },
      elapsedMs: 1,
    }],
  });
  // Canonical profile gaps (email + phone), not website rows, not done rows.
  assert(plan.missing.includes("Contact email"));
  assert(plan.missing.includes("Contact phone (set aside for now)"));
  assert(!plan.missing.some((m) => /Website design|Brand name/.test(m)));
  assert(plan.missing.includes("a bank for payouts (owner)"));
  assert(
    !plan.missing.some((m) => /payment setup so the brand can sell/.test(m)),
  );
  const payouts = plan.steps.find((step) => step.id === "payouts-and-terms")!;
  // P6 (D-10): the spec's own words for a sell-before-bank brand.
  assertMatch(payouts.detail, /You can sell now; payouts start once/);
  assert(!/Payouts are enabled|Payout collection is ready/.test(plan.text));
  assertEquals(payouts.state, "active");

  const unread = buildBrandLaunchPlan({
    brandName: "Lantern Supper Club",
    observations: [{
      tool: "get_operator_snapshot",
      args: { brand_id: BRAND },
      result: {
        selected_brand: {
          name: "Lantern Supper Club",
          readiness: null,
          readiness_unavailable: true,
        },
        offerings: [],
        payout_ready: false,
      },
      elapsedMs: 1,
    }],
  });
  assert(unread.missing.includes("a verified brand checklist"));
  assertEquals(unread.steps[0].state, "active");
  assertMatch(unread.steps[0].detail, /couldn't read the brand checklist/);
});

Deno.test("#3355 P2: onboarding setup reply names the canonical gaps", () => {
  const reply = buildAriOnboardingSetupReply(
    [
      {
        tool: "update_onboarding_plan",
        args: {},
        result: { state: { owner_provided_details: ["Currency: GBP"] } },
        elapsedMs: 1,
      },
      {
        tool: "get_operator_snapshot",
        args: {},
        result: {
          selected_brand: {
            readiness: {
              items: readinessFixture().items.map((i) => ({
                key: i.key,
                label: i.label,
                group: i.group,
                severity: i.severity,
              })),
            },
          },
        },
        elapsedMs: 1,
      },
    ],
    "Lantern Supper Club",
  );
  assertMatch(
    reply,
    /brand checklist still needs: contact email, contact phone/,
  );
  assert(!/website design/.test(reply), "website rows are not profile gaps");
});

Deno.test("#3355 P2: not now writes verify their readback and refuse in plain words", async () => {
  const defer = findTool("defer_readiness_item")!;
  const ok = fakeClient({
    rpc: () => ({
      data: {
        brand_id: BRAND,
        item_key: "contact_phone",
        item: {
          key: "contact_phone",
          state: "missing",
          deferral: {
            by_display_name: "Ada Owner",
            at: "2026-11-01T09:00:00Z",
          },
        },
      },
    }),
  });
  const saved = await defer.executor(
    { brand_id: BRAND, item_key: "contact_phone", reason: "Email only" },
    ok.client,
    USER,
  ) as Record<string, unknown>;
  assertEquals(ok.calls[0], {
    fn: "brand_readiness_defer",
    args: {
      p_brand_id: BRAND,
      p_item_key: "contact_phone",
      p_reason: "Email only",
    },
  });
  assertEquals(saved.state, "missing", "a not-now never marks the item done");
  assertEquals(saved.still_on_home_list, true);
  assertEquals(saved.label, "Contact phone");

  const unverified = fakeClient({
    rpc: () => ({
      data: {
        item: { key: "contact_phone", state: "missing", deferral: null },
      },
    }),
  });
  const notSaved = await assertRejects(
    () =>
      defer.executor(
        { brand_id: BRAND, item_key: "contact_phone" },
        unverified.client,
        USER,
      ),
    ToolError,
  );
  assertEquals((notSaved as ToolError).code, "WRITE_NOT_VERIFIED");

  for (
    const [code, words] of [
      ["readiness_item_not_deferrable", /can't be set aside/],
      ["readiness_defer_forbidden", /skip it for this chat/],
    ] as const
  ) {
    const refused = fakeClient({
      rpc: () => ({ error: { code: "P0001", message: code } }),
    });
    const error = await assertRejects(
      () =>
        defer.executor(
          { brand_id: BRAND, item_key: "money.can_be_paid_out" },
          refused.client,
          USER,
        ),
      ToolError,
    );
    assertEquals((error as ToolError).code, "DOMAIN_REFUSED");
    assertMatch((error as ToolError).message, words);
    assert(
      !(error as ToolError).message.includes(code),
      "no codes in owner words",
    );
  }

  // Unknown keys never reach the database.
  const none = fakeClient({});
  await assertRejects(
    () =>
      defer.executor(
        { brand_id: BRAND, item_key: "team.role" },
        none.client,
        USER,
      ),
    ToolError,
    "item_key",
  );
  assertEquals(none.calls.length, 0);

  const undo = await findTool("undefer_readiness_item")!.executor(
    { brand_id: BRAND, item_key: "contact_phone" },
    fakeClient({
      rpc: () => ({
        data: { cleared: true, item: { state: "missing", deferral: null } },
      }),
    }).client,
    USER,
  ) as Record<string, unknown>;
  assertEquals(undo.cleared, true);
});

Deno.test("#3355 P2: the not-now confirmation card names the item in owner words", () => {
  const card = buildProposalPresentation("defer_readiness_item", {
    brand_id: BRAND,
    item_key: "money.can_be_paid_out",
    reason: "Bank next month",
  });
  assertEquals(card.verb, "Not now for this brand");
  assertEquals(card.fields, [
    { label: "Checklist item", value: "Payouts to your bank" },
    { label: "Reason", value: "Bank next month" },
  ]);
  assert(!JSON.stringify(card).includes("money."));
});

Deno.test("#3355 P2: edge item labels equal the migration catalogue (one home)", async () => {
  // #4389 adds the brand_setup action and its two action-scoped rows in its
  // own migration; the catalogue's home is the union of both files.
  const sql = await Deno.readTextFile(
    new URL(
      "supabase/migrations/20280307003355_issue_3355_brand_readiness.sql",
      ROOT,
    ),
  ) + await Deno.readTextFile(
    new URL(
      "supabase/migrations/20280621004389_issue_4389_brand_setup.sql",
      ROOT,
    ),
  );
  const rows = [
    ...sql.matchAll(
      /\n  \('([a-z_.]+)','[a-z]+','([^']+)',\d+,'(brand|action)'/g,
    ),
  ];
  const brand = Object.fromEntries(
    rows.filter((r) => r[3] === "brand").map((r) => [r[1], r[2]]),
  );
  const action = Object.fromEntries(
    rows.filter((r) => r[3] === "action").map((r) => [r[1], r[2]]),
  );
  assertEquals(brand, { ...BRAND_READINESS_ITEM_LABELS });
  assertEquals(action, { ...ACTION_READINESS_ITEM_LABELS });
  for (const verb of READINESS_ACTIONS) {
    assert(
      sql.includes(`'${verb}'`),
      `action ${verb} is in the SQL vocabulary`,
    );
  }
});

Deno.test("#3355 P2: no Ari module keeps a hand-made missing-items list", async () => {
  const dir = new URL("supabase/functions/_shared/", ROOT);
  const offenders: string[] = [];
  for await (const entry of Deno.readDir(dir)) {
    if (!entry.isFile || !entry.name.endsWith(".ts")) continue;
    const text = await Deno.readTextFile(new URL(entry.name, dir));
    if (/genuinely_missing/.test(text)) offenders.push(entry.name);
  }
  const chat = await Deno.readTextFile(
    new URL("supabase/functions/agent-chat/index.ts", ROOT),
  );
  if (/genuinely_missing/.test(chat)) offenders.push("agent-chat/index.ts");
  assertEquals(offenders, []);
});
