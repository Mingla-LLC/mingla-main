import {
  assert,
  assertEquals,
  assertFalse,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { DOMAIN_TOOLS } from "../agentDomainTools.ts";
import { applyTierPatch, normalizeDraftTier } from "../agentTicketPricing.ts";
import { ToolError } from "../agentToolHelpers.ts";

const OPERATION_ID = "00000000-0000-4000-8000-000000001974";
const EVENT_ID = "00000000-0000-4000-8000-000000001975";
const BRAND_ID = "00000000-0000-4000-8000-000000001976";

const completeTier = normalizeDraftTier({
  id: "draft-tier-1",
  name: "Early bird",
  isFree: false,
  isUnlimited: false,
  priceGbp: 25,
  capacity: 40,
  visibility: "hidden",
  displayOrder: 3,
  approvalRequired: true,
  passwordProtected: true,
  passwordConfigured: true,
  waitlistEnabled: true,
  minPurchaseQty: 2,
  maxPurchaseQty: 6,
  allowTransfers: false,
  description: "All modifiers survive.",
  saleStartAt: "2027-01-01T10:00:00.000Z",
  saleEndAt: "2027-02-01T10:00:00.000Z",
  availableAt: "door",
});

Deno.test("#1974 sparse tier patch preserves complete modifiers and password configuration", () => {
  const next = applyTierPatch(
    completeTier,
    { name: "Early bird plus" },
    OPERATION_ID,
    4,
  );
  assertEquals(next, { ...completeTier, name: "Early bird plus" });
  assertFalse("password" in (next as unknown as Record<string, unknown>));
});

Deno.test("#1974 create defaults match the shared ticket editor", () => {
  const next = applyTierPatch(
    null,
    { name: "GA", is_free: true, is_unlimited: true },
    OPERATION_ID,
    4,
  );
  assertEquals(next, {
    id: OPERATION_ID,
    name: "GA",
    isFree: true,
    isUnlimited: true,
    priceGbp: null,
    capacity: null,
    visibility: "public",
    displayOrder: 4,
    approvalRequired: false,
    passwordProtected: false,
    passwordConfigured: false,
    waitlistEnabled: false,
    minPurchaseQty: 1,
    maxPurchaseQty: null,
    allowTransfers: true,
    description: null,
    saleStartAt: null,
    saleEndAt: null,
    availableAt: "both",
  });
});

for (
  const [name, args, message] of [
    ["limited zero capacity", {
      name: "GA",
      is_free: true,
      is_unlimited: false,
      capacity: 0,
    }, "capacity"],
    ["paid zero price", {
      name: "GA",
      is_free: false,
      is_unlimited: true,
      price_cents: 0,
    }, "price_cents"],
    ["unlimited waitlist", {
      name: "GA",
      is_free: true,
      is_unlimited: true,
      waitlist_enabled: true,
    }, "waitlist"],
    ["bad limits", {
      name: "GA",
      is_free: true,
      is_unlimited: true,
      min_purchase_qty: 3,
      max_purchase_qty: 2,
    }, "max_purchase_qty"],
    ["long description", {
      name: "GA",
      is_free: true,
      is_unlimited: true,
      description: "x".repeat(281),
    }, "280"],
    ["bad sale window", {
      name: "GA",
      is_free: true,
      is_unlimited: true,
      sale_start_at: "2027-02-01T00:00:00Z",
      sale_end_at: "2027-01-01T00:00:00Z",
    }, "sale_end_at"],
  ] as const
) {
  Deno.test(`#1974 validation rejects ${name}`, () => {
    assertRejects(
      async () => {
        applyTierPatch(null, args, OPERATION_ID, 0);
      },
      ToolError,
      message,
    );
  });
}

function query(data: unknown) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is", "order", "limit", "gt"]) {
    chain[method] = () => chain;
  }
  chain.maybeSingle = () => Promise.resolve({ data, error: null });
  chain.then = (resolve: (value: unknown) => unknown) =>
    resolve({ data, error: null });
  return chain;
}

Deno.test("#1974 confirmed draft create uses theme graph command, derived currency, and immutable pending identity", async () => {
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const event = {
    id: EVENT_ID,
    brand_id: BRAND_ID,
    event_type: "event",
    status: "draft",
    currency: "NGN",
    theme: { business_draft: { clientRevision: 7, tickets: [] } },
    updated_at: "2027-01-01T00:00:00.000Z",
    pricing_locked_at: null,
    deleted_at: null,
  };
  const client = {
    from: (table: string) => query(table === "events" ? event : []),
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      if (name === "pg_brand_can_collect") return { data: true, error: null };
      return {
        data: {
          event_id: EVENT_ID,
          representation: "draft",
          effective_currency: "NGN",
          tiers: [{ id: OPERATION_ID, name: "Lagos early bird" }],
          tier: { id: OPERATION_ID, name: "Lagos early bird" },
          operation_id: args.p_operation_id,
        },
        error: null,
      };
    },
  };
  const tool = DOMAIN_TOOLS.find((candidate) =>
    candidate.name === "upsert_ticket_tier"
  );
  assert(tool);
  const result = await tool.executor(
    {
      event_id: EVENT_ID,
      name: "Lagos early bird",
      is_free: false,
      is_unlimited: false,
      price_cents: 250000,
      capacity: 100,
    },
    client as never,
    "00000000-0000-4000-8000-000000001977",
    { operationId: OPERATION_ID },
  ) as Record<string, unknown>;
  const mutation = rpcCalls.find((call) =>
    call.name === "ari_execute_ticket_pricing_operation"
  );
  assert(mutation);
  assertEquals(mutation.args.p_operation_id, OPERATION_ID);
  assertEquals(mutation.args.p_tool_name, "upsert_ticket_tier");
  assertFalse("currency" in (mutation.args.p_args as Record<string, unknown>));
  assertEquals(result.effective_currency, "NGN");
  assertEquals(
    (mutation.args.p_args as Record<string, unknown>).price_cents,
    250000,
  );
});

Deno.test("#1974 model schemas expose lifecycle-neutral ids and never expose currency or passwords", () => {
  const tier = DOMAIN_TOOLS.find((candidate) =>
    candidate.name === "upsert_ticket_tier"
  );
  const brand = DOMAIN_TOOLS.find((candidate) =>
    candidate.name === "set_brand_pricing_defaults"
  );
  assert(tier && brand);
  const properties =
    (tier.parameters as { properties: Record<string, unknown> }).properties;
  assert("tier_id" in properties);
  assertFalse("ticket_type_id" in properties);
  assertFalse("currency" in properties);
  assertFalse("password" in properties);
  assertFalse("password_hash" in properties);
});
