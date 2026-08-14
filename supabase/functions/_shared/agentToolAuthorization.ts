// #2019 — one caller-bound authorization seam for every Ari tool.
// deno-lint-ignore-file no-explicit-any
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import type {
  AgentAuthorizationDeclaration,
  AgentRequiredRole,
  AgentResourceKind,
  AgentTool,
  AgentToolDefinition,
} from "./agentToolHelpers.ts";
import { isUuid, ToolError } from "./agentToolHelpers.ts";
import { assertAgentReadBrand } from "./agentTenantScope.ts";

type AuthContext = { brandId: string | null; resource: AgentResourceKind };

const EVENT_TYPE_BY_TOOL: Readonly<
  Record<string, "event" | "experience" | "rsvp" | "trip">
> = Object.freeze({
  update_event: "event",
  publish_event: "event",
  unpublish_event: "event",
  cancel_event: "event",
  end_event_sales: "event",
  duplicate_event: "event",
  patch_event_when: "event",
  set_event_cover: "event",
  set_event_guest_privacy: "event",
  discard_event_draft: "event",
  publish_experience: "experience",
  update_experience: "experience",
  manage_experience_stops: "experience",
  unpublish_experience: "experience",
  delete_experience: "experience",
  update_trip: "trip",
  publish_trip: "trip",
  delete_trip: "trip",
  cancel_trip_booking: "trip",
  publish_rsvp: "rsvp",
  set_rsvp_guest_status: "rsvp",
  refund_rsvp_contribution: "rsvp",
  list_guest_roster: "rsvp",
  set_guest_approval: "rsvp",
});

const role = (
  requiredRole: AgentRequiredRole,
  resource: AgentResourceKind,
): AgentAuthorizationDeclaration => ({ requiredRole, resource });

// Generated from the accepted #2000 ledger translation. This deliberately is
// exhaustive: an unregistered tool cannot be exposed to the model or executed.
export const AGENT_TOOL_AUTHORIZATION: Readonly<
  Record<string, AgentAuthorizationDeclaration>
> = Object.freeze({
  create_brand: role("business_user", "none"),
  list_brands: role("business_user", "none"),
  update_brand: role("brand_admin", "brand"),
  delete_brand: role("deed_owner", "brand"),
  manage_brand_hours: role("brand_admin", "brand"),
  list_brand_audit_log: role("brand_admin", "brand"),
  manage_brand_discovery_currency: role("finance_manager", "brand"),
  create_event: role("event_manager", "brand"),
  list_events: role("scanner", "optional_brand"),
  update_event: role("event_manager", "event"),
  create_experience: role("event_manager", "brand"),
  publish_event: role("event_manager", "event"),
  unpublish_event: role("event_manager", "event"),
  cancel_event: role("event_manager", "event"),
  end_event_sales: role("event_manager", "event"),
  duplicate_event: role("event_manager", "event"),
  patch_event_when: role("event_manager", "event"),
  set_event_cover: role("event_manager", "event"),
  set_event_guest_privacy: role("event_manager", "event"),
  discard_event_draft: role("event_manager", "event"),
  upsert_ticket_tier: role("event_manager", "event"),
  set_pricing_switches: role("event_manager", "event"),
  publish_experience: role("event_manager", "event"),
  update_experience: role("event_manager", "event"),
  manage_experience_stops: role("event_manager", "event"),
  unpublish_experience: role("event_manager", "event"),
  delete_experience: role("event_manager", "event"),
  create_trip: role("event_manager", "brand"),
  update_trip: role("event_manager", "event"),
  publish_trip: role("event_manager", "event"),
  delete_trip: role("event_manager", "event"),
  create_rsvp: role("event_manager", "brand"),
  publish_rsvp: role("event_manager", "event"),
  set_rsvp_guest_status: role("event_manager", "event"),
  refund_rsvp_contribution: role("finance_manager", "event"),
  quote_stay: role("scanner", "brand"),
  create_stay_reservation: role("scanner", "brand"),
  transition_stay: role("event_manager", "stay_reservation"),
  create_venue_reservation: role("scanner", "brand"),
  transition_venue_reservation: role("event_manager", "venue_reservation"),
  create_venue_listing: role("brand_admin", "brand"),
  submit_venue_claim: role("brand_admin", "brand"),
  mark_claim_feedback_fixed: role("brand_admin", "brand"),
  venue_ops_action: role("event_manager", "brand"),
  send_venue_sms: role("event_manager", "brand"),
  draft_campaign: role("marketing_manager", "brand"),
  schedule_campaign: role("marketing_manager", "campaign"),
  send_campaign_now: role("marketing_manager", "campaign"),
  cancel_campaign: role("marketing_manager", "campaign"),
  run_growth_tool: role("marketing_manager", "brand"),
  get_payout_status: role("finance_manager", "brand"),
  get_partner_status: role("finance_manager", "brand"),
  disconnect_partner: role("finance_manager", "brand"),
  get_tax_status: role("finance_manager", "brand"),
  refund_order: role("finance_manager", "brand"),
  cancel_order: role("finance_manager", "brand"),
  cancel_trip_booking: role("finance_manager", "brand"),
  retry_installment: role("finance_manager", "brand"),
  get_brand_analytics: role("scanner", "brand"),
  invite_brand_member: role("brand_admin", "brand"),
  invite_scanner: role("event_manager", "brand"),
  revoke_brand_member: role("brand_admin", "brand"),
  list_guest_roster: role("event_manager", "event"),
  set_guest_approval: role("event_manager", "event"),
  export_brand_people: role("marketing_manager", "brand"),
  update_ari_prefs: role("self", "none"),
  update_notification_prefs: role("self", "none"),
  create_support_ticket: role("self", "optional_brand"),
  request_account_deletion: role("self", "none"),
  get_operator_snapshot: role("scanner", "optional_brand"),
});

function unavailable(): never {
  throw new ToolError(
    "BRAND_ACCESS_DENIED",
    "That brand or resource is unavailable",
  );
}

async function rowBrand(
  client: SupabaseClient,
  table: string,
  id: unknown,
  select = "brand_id",
  requireNotDeleted = false,
): Promise<Record<string, any>> {
  if (!isUuid(id)) {
    throw new ToolError("INVALID_ARGS", "A valid resource id is required");
  }
  let query = client.from(table).select(select).eq("id", id);
  if (requireNotDeleted) query = query.is("deleted_at", null);
  const { data, error } = await query.maybeSingle();
  if (error) {
    throw new ToolError(
      "ROLE_CHECK_UNAVAILABLE",
      "Ari could not verify permissions right now",
    );
  }
  if (!data) unavailable();
  return data as Record<string, any>;
}

function assertExpectedEventType(
  toolName: string,
  event: Record<string, any>,
): void {
  const expected = EVENT_TYPE_BY_TOOL[toolName];
  if (expected && event.event_type !== expected) unavailable();
}

async function resolveBrand(
  toolName: string,
  declaration: AgentAuthorizationDeclaration,
  args: Record<string, unknown>,
  client: SupabaseClient,
): Promise<string | null> {
  let brandId: string | null = null;
  switch (declaration.resource) {
    case "none":
      return null;
    case "optional_brand":
      if (args.brand_id == null) return null;
      if (!isUuid(args.brand_id)) {
        throw new ToolError("INVALID_ARGS", "brand_id must be a uuid");
      }
      brandId = args.brand_id;
      break;
    case "brand":
      if (!isUuid(args.brand_id)) {
        throw new ToolError("INVALID_ARGS", "brand_id must be a uuid");
      }
      brandId = args.brand_id;
      break;
    case "event": {
      // deno-fmt-ignore -- #2019's append-only guard pins this security binding as one auditable expression.
      const row = await rowBrand(client, "events", args.event_id, "brand_id, event_type", true);
      assertExpectedEventType(toolName, row);
      brandId = row.brand_id;
      break;
    }
    case "campaign": {
      const row = await rowBrand(
        client,
        "marketing_campaigns",
        args.campaign_id,
      );
      brandId = row.brand_id;
      break;
    }
    case "stay_reservation": {
      const row = await rowBrand(
        client,
        "stay_reservation_groups",
        args.reservation_id,
      );
      brandId = row.brand_id;
      break;
    }
    case "venue_reservation": {
      const row = await rowBrand(client, "reservations", args.reservation_id);
      brandId = row.brand_id;
      break;
    }
  }
  if (!isUuid(brandId)) unavailable();
  if (args.brand_id !== undefined && args.brand_id !== brandId) unavailable();

  // Bind redundant high-risk finance/resource identifiers before role checks.
  if (isUuid(args.partner_id)) {
    // deno-fmt-ignore -- #2019's append-only guard pins the deployed relation and identifier together.
    const partner = await rowBrand(client, "partner_brand_links", args.partner_id);
    if (partner.brand_id !== brandId) unavailable();
  }
  if (isUuid(args.order_id)) {
    const order = await rowBrand(client, "orders", args.order_id, "event_id");
    const event = await rowBrand(
      client,
      "events",
      order.event_id,
      "brand_id, event_type",
      true,
    );
    assertExpectedEventType(toolName, event);
    if (event.brand_id !== brandId) unavailable();
  }
  if (isUuid(args.booking_id)) {
    const order = await rowBrand(client, "orders", args.booking_id, "event_id");
    const event = await rowBrand(
      client,
      "events",
      order.event_id,
      "brand_id, event_type",
      true,
    );
    assertExpectedEventType(toolName, event);
    if (event.brand_id !== brandId) unavailable();
  }
  if (isUuid(args.installment_id)) {
    const installment = await rowBrand(
      client,
      "order_installments",
      args.installment_id,
      "order_id",
    );
    const order = await rowBrand(
      client,
      "orders",
      installment.order_id,
      "event_id",
    );
    const event = await rowBrand(
      client,
      "events",
      order.event_id,
      "brand_id, event_type",
      true,
    );
    assertExpectedEventType(toolName, event);
    if (event.brand_id !== brandId) unavailable();
  }
  if (isUuid(args.member_id)) {
    const member = await rowBrand(client, "brand_team_members", args.member_id);
    if (member.brand_id !== brandId) unavailable();
  }
  if (isUuid(args.feedback_item_id)) {
    const feedback = await rowBrand(
      client,
      "venue_claim_feedback",
      args.feedback_item_id,
    );
    if (feedback.brand_id !== brandId) unavailable();
  }
  if (isUuid(args.claim_id)) {
    const venue = await rowBrand(client, "venue_listings", args.claim_id);
    if (venue.brand_id !== brandId) unavailable();
  }
  for (const resourceId of [args.listing_id, args.venue_id]) {
    if (!isUuid(resourceId)) continue;
    const venue = await rowBrand(client, "venue_listings", resourceId);
    if (venue.brand_id !== brandId) unavailable();
  }
  const guestIds = [
    args.guest_id,
    ...(Array.isArray(args.guest_ids) ? args.guest_ids : []),
  ]
    .filter(isUuid);
  for (const guestId of guestIds) {
    // deno-fmt-ignore -- #2019's append-only guard pins the physical guest-to-RSVP foreign key.
    const guest = await rowBrand(client, "event_rsvp_guests", guestId, "rsvp_id");
    // deno-fmt-ignore -- #2019's append-only guard pins the physical RSVP-to-event foreign key.
    const rsvp = await rowBrand(client, "event_rsvps", guest.rsvp_id, "event_id");
    // deno-fmt-ignore -- #2019's append-only guard pins the terminal event tenant/type lookup.
    const event = await rowBrand(client, "events", rsvp.event_id, "brand_id, event_type", true);
    assertExpectedEventType(toolName, event);
    if (event.brand_id !== brandId) unavailable();
  }
  return brandId;
}

export async function authorizeAgentTool(
  tool: Pick<AgentTool, "name" | "parameters" | "requiredRole" | "resource">,
  args: Record<string, unknown>,
  userClient: SupabaseClient,
  userId: string,
): Promise<AuthContext> {
  if (!isUuid(userId)) {
    throw new ToolError("ROLE_DENIED", "Authentication is required");
  }
  const expected = AGENT_TOOL_AUTHORIZATION[tool.name];
  if (
    !expected || expected.requiredRole !== tool.requiredRole ||
    expected.resource !== tool.resource
  ) {
    throw new ToolError(
      "ROLE_CHECK_UNAVAILABLE",
      "Ari's permission contract is unavailable",
    );
  }
  validateBeforeAuthorization(tool, args);
  const brandId = await resolveBrand(tool.name, expected, args, userClient);
  if (expected.resource === "optional_brand" && brandId === null) {
    return { brandId: null, resource: expected.resource };
  }
  if (expected.resource === "optional_brand" && brandId) {
    await assertAgentReadBrand(userClient, userId, brandId);
  }
  if (
    expected.requiredRole === "business_user" ||
    expected.requiredRole === "self"
  ) {
    if (brandId) {
      const { data, error } = await userClient.rpc(
        "biz_brand_effective_rank_for_caller",
        { p_brand_id: brandId },
      );
      if (error) {
        throw new ToolError(
          "ROLE_CHECK_UNAVAILABLE",
          "Ari could not verify permissions right now",
        );
      }
      if (Number(data ?? 0) <= 0) unavailable();
    }
    return { brandId, resource: expected.resource };
  }
  if (!brandId) unavailable();
  if (expected.requiredRole === "deed_owner") {
    const { data, error } = await userClient.from("brands").select("id").eq(
      "id",
      brandId,
    )
      .eq("account_id", userId).is("deleted_at", null).maybeSingle();
    if (error) {
      throw new ToolError(
        "ROLE_CHECK_UNAVAILABLE",
        "Ari could not verify permissions right now",
      );
    }
    if (!data) unavailable();
    return { brandId, resource: expected.resource };
  }
  const [
    { data: actual, error: actualError },
    { data: required, error: requiredError },
  ] = await Promise.all([
    userClient.rpc("biz_brand_effective_rank_for_caller", {
      p_brand_id: brandId,
    }),
    userClient.rpc("biz_role_rank", { p_role: expected.requiredRole }),
  ]);
  if (actualError || requiredError) {
    throw new ToolError(
      "ROLE_CHECK_UNAVAILABLE",
      "Ari could not verify permissions right now",
    );
  }
  const actualRank = Number(actual ?? 0);
  const requiredRank = Number(required ?? 0);
  if (
    !Number.isFinite(actualRank) || !Number.isFinite(requiredRank) ||
    requiredRank <= 0
  ) {
    throw new ToolError(
      "ROLE_CHECK_UNAVAILABLE",
      "Ari could not verify permissions right now",
    );
  }
  if (actualRank <= 0) unavailable();
  if (actualRank < requiredRank) {
    throw new ToolError("ROLE_DENIED", "Your role does not allow that action");
  }
  return { brandId, resource: expected.resource };
}

function validateBeforeAuthorization(
  tool: Pick<AgentToolDefinition, "parameters">,
  args: Record<string, unknown>,
): void {
  const schema = tool.parameters as any;
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    throw new ToolError("INVALID_ARGS", "Tool arguments must be an object");
  }
  for (const key of schema.required ?? []) {
    if (args[key] === undefined || args[key] === null || args[key] === "") {
      const values = schema.properties?.[key]?.enum;
      throw new ToolError(
        "INVALID_ARGS",
        Array.isArray(values) && values.length === 1
          ? `${key} must be ${values[0]}`
          : `${key} is required`,
      );
    }
  }
  if (schema.additionalProperties === false) {
    const allowed = new Set(Object.keys(schema.properties ?? {}));
    const extra = Object.keys(args).find((key) => !allowed.has(key));
    if (extra) throw new ToolError("INVALID_ARGS", `${extra} is not allowed`);
  }
  for (
    const [key, rule] of Object.entries(schema.properties ?? {}) as [
      string,
      any,
    ][]
  ) {
    const value = args[key];
    if (value === undefined || value === null) continue;
    validateSchemaValue(value, rule, key);
  }
}

function validateSchemaValue(value: unknown, rule: any, path: string): void {
  const invalid = (expectation: string): never => {
    throw new ToolError("INVALID_ARGS", `${path} must be ${expectation}`);
  };
  if (Array.isArray(rule.enum) && !rule.enum.includes(value)) {
    invalid(rule.enum.join(" or "));
  }
  switch (rule.type) {
    case "string":
      if (typeof value !== "string") invalid("a string");
      if (
        typeof rule.minLength === "number" &&
        (value as string).length < rule.minLength
      ) invalid(`at least ${rule.minLength} characters`);
      if (
        typeof rule.maxLength === "number" &&
        (value as string).length > rule.maxLength
      ) invalid(`at most ${rule.maxLength} characters`);
      if (rule.format === "uuid" && !isUuid(value)) invalid("a uuid");
      if (
        rule.format === "date-time" && Number.isNaN(Date.parse(value as string))
      ) invalid("a valid date-time");
      break;
    case "integer":
      if (typeof value !== "number" || !Number.isInteger(value)) {
        invalid("an integer");
      }
      break;
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) {
        invalid("a number");
      }
      break;
    case "boolean":
      if (typeof value !== "boolean") invalid("a boolean");
      break;
    case "array":
      if (!Array.isArray(value)) invalid("an array");
      if (rule.items) {
        (value as unknown[]).forEach((item, index) =>
          validateSchemaValue(item, rule.items, `${path}[${index}]`)
        );
      }
      break;
    case "object":
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        invalid("an object");
      }
      for (const required of rule.required ?? []) {
        if ((value as Record<string, unknown>)[required] == null) {
          throw new ToolError(
            "INVALID_ARGS",
            `${path}.${required} is required`,
          );
        }
      }
      for (
        const [key, childRule] of Object.entries(rule.properties ?? {}) as [
          string,
          any,
        ][]
      ) {
        const child = (value as Record<string, unknown>)[key];
        if (child !== undefined && child !== null) {
          validateSchemaValue(child, childRule, `${path}.${key}`);
        }
      }
      break;
  }
  if (
    typeof value === "number" && typeof rule.minimum === "number" &&
    value < rule.minimum
  ) {
    invalid(`≥ ${rule.minimum}`);
  }
  if (
    typeof value === "number" && typeof rule.maximum === "number" &&
    value > rule.maximum
  ) {
    invalid(`≤ ${rule.maximum}`);
  }
}

export function secureAgentTools(
  definitions: AgentToolDefinition[],
): AgentTool[] {
  const names = new Set(definitions.map((tool) => tool.name));
  if (
    names.size !== definitions.length ||
    names.size !== Object.keys(AGENT_TOOL_AUTHORIZATION).length
  ) {
    throw new Error(
      "Ari tool registry and authorization registry must be exact and duplicate-free",
    );
  }
  return definitions.map((definition) => {
    const declaration = AGENT_TOOL_AUTHORIZATION[definition.name];
    if (!declaration) {
      throw new Error(
        `Missing Ari authorization declaration: ${definition.name}`,
      );
    }
    const rawExecutor = definition.executor;
    return {
      ...definition,
      ...declaration,
      executor: async (args, client, userId, context) => {
        // deno-fmt-ignore -- #2019's append-only guard pins registry metadata to runtime reauthorization.
        await authorizeAgentTool({ ...declaration, name: definition.name, parameters: definition.parameters }, args, client, userId);
        return await rawExecutor(args, client, userId, context);
      },
    };
  });
}
