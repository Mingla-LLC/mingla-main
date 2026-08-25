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
  manage_trip_days: "trip",
  manage_trip_inclusions: "trip",
  manage_trip_tiers: "trip",
  manage_trip_traveler_intake: "trip",
  publish_trip: "trip",
  delete_trip: "trip",
  get_trip_order_money: "trip",
  cancel_trip_booking: "trip",
  update_rsvp: "rsvp",
  publish_rsvp: "rsvp",
  update_rsvp_contribution_settings: "rsvp",
  set_rsvp_guest_status: "rsvp",
  refund_rsvp_contribution: "rsvp",
  list_guest_roster: "rsvp",
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
  set_pricing_switches: role("finance_manager", "event"),
  set_brand_pricing_defaults: role("finance_manager", "brand"),
  publish_experience: role("event_manager", "event"),
  update_experience: role("event_manager", "event"),
  manage_experience_stops: role("event_manager", "event"),
  unpublish_experience: role("event_manager", "event"),
  delete_experience: role("event_manager", "event"),
  create_trip: role("event_manager", "brand"),
  update_trip: role("event_manager", "event"),
  // #1971 — the trip graph groups. The database floor is event_manager on the
  // owning brand (biz_trip_require_manager), so the proposal-time gate matches
  // it exactly; the executor reauthorizes the final edited arguments again.
  manage_trip_days: role("event_manager", "event"),
  manage_trip_inclusions: role("event_manager", "event"),
  manage_trip_tiers: role("event_manager", "event"),
  manage_trip_traveler_intake: role("event_manager", "event"),
  publish_trip: role("event_manager", "event"),
  delete_trip: role("event_manager", "event"),
  // #1971 — the aggregate money read is finance-gated in SQL
  // (biz_trip_require_finance); the coarse gate here agrees.
  get_trip_order_money: role("finance_manager", "event"),
  create_rsvp: role("event_manager", "brand"),
  update_rsvp: role("event_manager", "event"),
  publish_rsvp: role("event_manager", "event"),
  update_rsvp_contribution_settings: role("event_manager", "event"),
  set_rsvp_guest_status: role("event_manager", "event"),
  refund_rsvp_contribution: role("finance_manager", "event"),
  quote_stay: role("scanner", "brand"),
  create_stay_reservation: role("scanner", "brand"),
  transition_stay: role("event_manager", "stay_reservation"),
  // #1975 — a free manual operator booking; the database requires effective
  // rank event_manager or higher, so the proposal-time gate matches.
  create_venue_reservation: role("event_manager", "brand"),
  transition_venue_reservation: role("event_manager", "venue_reservation"),
  // #1975 — Stay authoring. The coarse proposal-time gate is event_manager;
  // manage-stay-inventory + owning SQL enforce the exact read/inventory/finance
  // capability split per action (issue_1387_has_brand_capability).
  manage_stay_inventory: role("event_manager", "brand"),
  publish_stay: role("event_manager", "brand"),
  manage_stay_policy_price_media: role("event_manager", "brand"),
  // #1978 — venue create/adopt matches biz_create_venue_listing (event_manager+).
  // Feedback toggle and claim resubmit are brand-owner-only. Reads are
  // member-scoped (owner-only for raw feedback notes).
  create_venue_listing: role("event_manager", "brand"),
  submit_venue_claim: role("brand_owner", "venue"),
  mark_claim_feedback_fixed: role("brand_owner", "venue_feedback"),
  list_venue_listings: role("scanner", "brand"),
  get_venue_listing_status: role("scanner", "venue"),
  list_venue_claim_feedback: role("brand_owner", "venue"),
  venue_ops_action: role("event_manager", "brand"),
  send_venue_sms: role("event_manager", "brand"),
  manage_venue_availability: role("event_manager", "brand"),
  manage_venue_menu: role("event_manager", "brand"),
  manage_venue_waitlist: role("event_manager", "brand"),
  draft_campaign: role("marketing_manager", "brand"),
  schedule_campaign: role("marketing_manager", "campaign"),
  send_campaign_now: role("marketing_manager", "campaign"),
  cancel_campaign: role("marketing_manager", "campaign"),
  run_growth_tool: role("marketing_manager", "brand"),
  get_payout_status: role("finance_manager", "brand"),
  get_partner_status: role("finance_manager", "brand"),
  disconnect_partner: role("finance_manager", "brand"),
  get_tax_status: role("finance_manager", "brand"),
  // #1976 — balances/ledger read is finance-gated like Host payments surfaces.
  get_brand_balances_reports: role("finance_manager", "brand"),
  // #1976 — partner self-reads; RLS binds partner_account_id / partner splits.
  list_partner_brand_links: role("business_user", "none"),
  list_partner_splits: role("business_user", "optional_brand"),
  refund_order: role("finance_manager", "brand"),
  cancel_order: role("finance_manager", "brand"),
  cancel_trip_booking: role("finance_manager", "brand"),
  retry_installment: role("finance_manager", "brand"),
  // #1981 — Trip Money manual charge + reminder; same finance floor as Host.
  charge_installment_now: role("finance_manager", "brand"),
  send_installment_reminder: role("finance_manager", "brand"),
  get_brand_analytics: role("scanner", "brand"),
  invite_brand_member: role("brand_admin", "brand"),
  invite_scanner: role("event_manager", "brand"),
  revoke_brand_member: role("brand_admin", "brand"),
  // #1982 — team list + scanner revoke + Brand People book.
  list_brand_team: role("brand_admin", "brand"),
  revoke_scanner_invitation: role("event_manager", "brand"),
  manage_brand_people: role("marketing_manager", "brand"),
  // #1972 reopen — event group chat / door / orders / waitlist / scanners.
  manage_event_group_chat: role("event_manager", "event"),
  manage_event_door_sale: role("event_manager", "event"),
  list_event_orders: role("finance_manager", "event"),
  manage_event_waitlist: role("event_manager", "event"),
  manage_event_scanners: role("event_manager", "event"),
  list_guest_roster: role("event_manager", "event"),
  export_brand_people: role("marketing_manager", "brand"),
  update_ari_prefs: role("self", "none"),
  update_notification_prefs: role("self", "none"),
  create_support_ticket: role("self", "optional_brand"),
  request_account_deletion: role("self", "none"),
  get_operator_snapshot: role("scanner", "optional_brand"),
  // #1984 — same finance floor as brand analytics refunds; event-scoped.
  get_event_order_reconciliation: role("finance_manager", "event"),
});

function unavailable(): never {
  throw new ToolError(
    "BRAND_ACCESS_DENIED",
    "That brand or resource is unavailable",
  );
}

// #2593 — Postgres returns uuids lowercase, but `isUuid` accepts either case
// (its pattern carries the /i flag) and nothing upstream normalises the
// model-supplied value. A raw `!==` between a caller-supplied uuid and a
// database one therefore reports a MISMATCH for an uppercase id that
// genuinely matches, which on this seam surfaces as a false "you do not have
// permission". Compare case-insensitively. The containment rule is unchanged
// — only the string comparison is — and a non-string on either side is still
// treated as a mismatch, so this stays fail-closed.
//
// No existing normaliser to reuse: the repo's one `canonicalUuid`
// (offeringInviteToken.ts) is an HMAC byte-encoder that rejects rather than
// normalises, and the schema validator only tests `isUuid` without rewriting.
function sameUuid(left: unknown, right: unknown): boolean {
  return typeof left === "string" && typeof right === "string" &&
    left.toLowerCase() === right.toLowerCase();
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
      const row = await rowBrand(
        client,
        "events",
        args.event_id,
        "brand_id, event_type",
        true,
      );
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
      // #1975 — transition_stay identifies the reservation by its canonical
      // group id for every operation (approve/decline/cancel) so tenant/brand
      // is always resolvable before authorization.
      const row = await rowBrand(
        client,
        "stay_reservation_groups",
        args.group_id,
      );
      brandId = row.brand_id;
      break;
    }
    case "venue_reservation": {
      const row = await rowBrand(client, "reservations", args.reservation_id);
      brandId = row.brand_id;
      break;
    }
    // issue #1978 — the venue row owns the tenant identity; the model-supplied
    // brand id (if any) is verified against it below, never trusted alone.
    case "venue": {
      const row = await rowBrand(client, "venue_listings", args.venue_id);
      brandId = row.brand_id;
      break;
    }
    // issue #1978 — load the feedback row, then require its venue exists and
    // carries the SAME brand, so a spliced feedback/venue pair fails closed.
    case "venue_feedback": {
      const feedback = await rowBrand(
        client,
        "venue_claim_feedback",
        args.feedback_id,
        "brand_id, venue_id",
      );
      const venue = await rowBrand(
        client,
        "venue_listings",
        feedback.venue_id,
      );
      if (venue.brand_id !== feedback.brand_id) unavailable();
      brandId = feedback.brand_id;
      break;
    }
  }
  if (!isUuid(brandId)) unavailable();
  if (args.brand_id !== undefined && args.brand_id !== brandId) unavailable();

  // Bind redundant high-risk finance/resource identifiers before role checks.
  if (isUuid(args.partner_id)) {
    const partner = await rowBrand(
      client,
      "partner_brand_links",
      args.partner_id,
    );
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
  if (isUuid(args.contribution_id)) {
    const contribution = await rowBrand(
      client,
      "event_rsvp_contributions",
      args.contribution_id,
      "event_id",
    );
    const event = await rowBrand(
      client,
      "events",
      contribution.event_id,
      "brand_id, event_type",
      true,
    );
    assertExpectedEventType(toolName, event);
    if (event.brand_id !== brandId || contribution.event_id !== args.event_id) {
      unavailable();
    }
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
  if (isUuid(args.invitation_id)) {
    const invitation = await rowBrand(
      client,
      "scanner_invitations",
      args.invitation_id,
    );
    if (invitation.brand_id !== brandId) unavailable();
  }
  for (const resourceId of [args.listing_id, args.venue_id]) {
    if (!isUuid(resourceId)) continue;
    const venue = await rowBrand(client, "venue_listings", resourceId);
    if (venue.brand_id !== brandId) unavailable();
  }
  if (Array.isArray(args.roster_keys)) {
    for (const key of args.roster_keys) {
      if (typeof key !== "string" || !/^rsvp:[0-9a-f-]{36}$/i.test(key)) {
        unavailable();
      }
      const rsvpId = key.slice(5);
      const rosterRsvp = await rowBrand(
        client,
        "event_rsvps",
        rsvpId,
        "event_id",
      );
      const rosterEvent = await rowBrand(
        client,
        "events",
        rosterRsvp.event_id,
        "brand_id, event_type",
        true,
      );
      assertExpectedEventType(toolName, rosterEvent);
      if (rosterEvent.brand_id !== brandId) unavailable();
      if (isUuid(args.event_id) && !sameUuid(rosterRsvp.event_id, args.event_id)) {
        unavailable();
      }
    }
  }
    const guestIds = [
    args.guest_id,
    ...(Array.isArray(args.guest_ids) ? args.guest_ids : []),
  ]
    .filter(isUuid);
  for (const guestId of guestIds) {
    const guest = await rowBrand(
      client,
      "event_rsvp_guests",
      guestId,
      "rsvp_id",
    );
    const rsvp = await rowBrand(
      client,
      "event_rsvps",
      guest.rsvp_id,
      "event_id",
    );
    const event = await rowBrand(
      client,
      "events",
      rsvp.event_id,
      "brand_id, event_type",
      true,
    );
    assertExpectedEventType(toolName, event);
    if (event.brand_id !== brandId) unavailable();
    // #2593 — same containment rule as the bare rsvp_id chain below: when the
    // caller also names the event, the guest's RSVP must belong to THAT event.
    if (isUuid(args.event_id) && !sameUuid(rsvp.event_id, args.event_id)) {
      unavailable();
    }
  }
  // #1984 — bind a bare rsvp_id (host_set_rsvp_status target) to its event's
  // brand. Keep identifiers distinct from the guest two-hop anchors so the
  // #2019 tester proofs stay specific to that chain.
  if (isUuid(args.rsvp_id)) {
    const bareRsvp = await rowBrand(
      client,
      "event_rsvps",
      args.rsvp_id,
      "event_id",
    );
    const bareRsvpEvent = await rowBrand(
      client,
      "events",
      bareRsvp.event_id,
      "brand_id, event_type",
      true,
    );
    assertExpectedEventType(toolName, bareRsvpEvent);
    if (bareRsvpEvent.brand_id !== brandId) unavailable();
    // #2593 — the two identifiers must name the SAME parent record. Brand
    // membership plus event_type is not scope: a tool that takes both
    // `event_id` and `rsvp_id` (set_guest_approval) resolved each of them
    // independently and never asserted they agreed, so an authorized member of
    // a brand could act on an RSVP belonging to a DIFFERENT event of that same
    // brand by naming a mismatched pair. Assert the relationship and fail
    // closed when it does not hold. Intra-tenant containment, not a tenant
    // boundary: brand membership was and remains required.
    if (isUuid(args.event_id) && !sameUuid(bareRsvp.event_id, args.event_id)) {
      unavailable();
    }
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
  tool: Pick<AgentToolDefinition, "name" | "parameters">,
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
  if (
    tool.name === "manage_brand_discovery_currency" &&
    args.action === "set_provisional_currency" &&
    (
      !Number.isInteger(args.expected_state_version) ||
      Number(args.expected_state_version) < 1
    )
  ) {
    throw new ToolError(
      "INVALID_ARGS",
      "Read the current discovery-currency state first, then include its positive expected_state_version.",
    );
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
        await authorizeAgentTool(
          {
            ...declaration,
            name: definition.name,
            parameters: definition.parameters,
          },
          args,
          client,
          userId,
        );
        return await rawExecutor(args, client, userId, context);
      },
    };
  });
}
