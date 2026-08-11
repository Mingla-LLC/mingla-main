// ===========================================================================
// Issue #1793 — the WIRE CONTRACT, with one owner.
//
// SET-B (SPEC #1788 P-61): may sell, may never touch money. This module builds
// the request body and normalises the responses. It performs no arithmetic on a
// price whatsoever — every number it reads out of a response was computed by
// `venue-order-create` and is copied across unchanged.
//
// It also, deliberately, knows NOTHING about any payment provider. The create
// response's provider-shaped arm (a client secret, a hosted redirect) is parsed
// by each host, in host-owned files the gate is never pointed at, because a
// shared renderer package has no business holding a provider's field names.
//
// WHY IT IS SHARED. The consumer app and buyer web must send the SAME body and
// read the SAME answer. Two copies of a wire contract is how one surface starts
// sending `tipBps` while the other sends `tip_bps`, and how one starts showing a
// guest a machine code where the other shows the sentence P-29 wrote for them.
// ===========================================================================

import type {
  VenueOrderBuyerDraft,
  VenueOrderCartLine,
  VenueOrderingConfig,
  VenueOrderLiveStatus,
  VenueOrderModifierGroup,
  VenueOrderPreview,
} from "./venueOrderingTypes";
import { venueOrderCartWireLines } from "./venueOrderingRules";

/** The three anon-capable functions this surface may call, and no others. */
export const VENUE_ORDER_FUNCTIONS = {
  create: "venue-order-create",
  status: "venue-order-status",
  guestAction: "venue-order-guest-action",
} as const;

export interface VenueOrderFailure {
  /** The machine code — for branching, never for reading aloud. */
  code: string;
  /** The exact words a guest should read. P-29 owns this copy, server-side. */
  message: string;
}

/**
 * The failure a surface shows when it has nothing better. It states that
 * nothing was charged, because every 4xx/5xx on this rail either charged
 * nothing or says otherwise — and silence about money is what makes a guest pay
 * twice.
 */
export const VENUE_ORDER_GENERIC_FAILURE: VenueOrderFailure = {
  code: "internal_error",
  message: "Something went wrong. Nothing has been charged.",
};

/**
 * Read a typed failure body.
 *
 * The rail answers `{ error: <code>, message: <guest copy> }`, and MESSAGE WINS.
 * Both apps' generic edge-error helpers prefer `error`, which is right for rails
 * whose `error` is prose and catastrophic here: it would put the literal string
 * `buyer_phone_required` in front of a diner instead of "We need a phone number
 * to text you when it's ready."
 */
export function parseVenueOrderFailureBody(raw: string): VenueOrderFailure {
  try {
    const body = JSON.parse(raw) as Record<string, unknown>;
    const message = typeof body.message === "string" && body.message.trim() !== ""
      ? body.message.trim()
      : null;
    const code = typeof body.error === "string" ? body.error : "internal_error";
    return message === null
      ? { code, message: VENUE_ORDER_GENERIC_FAILURE.message }
      : { code, message };
  } catch {
    return VENUE_ORDER_GENERIC_FAILURE;
  }
}

export interface VenueOrderRequest {
  spotCode: string | null;
  venueId: string | null;
  sessionId: string | null;
  lines: VenueOrderCartLine[];
  buyer: VenueOrderBuyerDraft;
  partySizeClaimed: number | null;
  tipBps: number | null;
  tipFlatCents: number | null;
  entrySource: string | null;
}

/**
 * The request body, for both modes.
 *
 * P-20 — item ids, counts, option ids, notes and the buyer. NOTHING WITH A
 * PRICE IN IT, and that is enforced on the far side too: `venue-order-create`
 * rejects a body carrying any of eight price-shaped keys outright, as a
 * validation error rather than a hint. So a tampered client cannot even express
 * a price, let alone be believed about one.
 */
export function venueOrderCreateBody(input: {
  request: VenueOrderRequest;
  mode: "preview" | "create";
  surface: "native" | "web";
  idempotencyKey?: string;
}): Record<string, unknown> {
  const { request } = input;
  return {
    spotCode: request.spotCode,
    venueId: request.venueId,
    sessionId: request.sessionId,
    surface: input.surface,
    mode: input.mode,
    buyer: {
      name: request.buyer.name.trim(),
      email: request.buyer.email.trim(),
      phone: request.buyer.phone.trim(),
    },
    partySizeClaimed: request.partySizeClaimed,
    tipBps: request.tipBps,
    tipFlatCents: request.tipFlatCents,
    src: request.entrySource,
    lines: venueOrderCartWireLines(request.lines),
    ...(input.idempotencyKey === undefined
      ? {}
      : { idempotencyKey: input.idempotencyKey }),
  };
}

/** The state a guest may honestly be told about. Unknown shapes fail to `unavailable`. */
export const VENUE_ORDERING_UNAVAILABLE: VenueOrderingConfig = {
  state: "unavailable",
  venueId: null,
  venueName: "",
  spotState: "none",
  spot: null,
  serviceChargeBps: 0,
  serviceChargeLabel: "Service charge",
  tipsEnabled: false,
  tipPresetsBps: null,
  counterPickupEnabled: false,
  prepTimeMinutes: null,
};

export function parseVenueOrderingConfig(data: unknown): VenueOrderingConfig {
  if (data === null || typeof data !== "object") {
    return VENUE_ORDERING_UNAVAILABLE;
  }
  const row = data as Record<string, unknown>;
  const spot = row.spot !== null && typeof row.spot === "object"
    ? (row.spot as Record<string, unknown>)
    : null;
  const presets = Array.isArray(row.tip_presets_bps)
    ? (row.tip_presets_bps as unknown[]).map(Number).filter((value) =>
      Number.isInteger(value) && value > 0
    )
    : null;
  return {
    state: row.state === "on" || row.state === "paused" || row.state === "off"
      ? row.state
      : "unavailable",
    venueId: typeof row.venue_id === "string" ? row.venue_id : null,
    venueName: typeof row.venue_name === "string" ? row.venue_name : "",
    spotState: row.spot_state === "ok" || row.spot_state === "unknown"
      ? row.spot_state
      : "none",
    spot: spot === null ? null : {
      label: typeof spot.label === "string" ? spot.label : null,
      kind: typeof spot.kind === "string" ? spot.kind : "custom",
      servingMenuId: typeof spot.serving_menu_id === "string"
        ? spot.serving_menu_id
        : null,
    },
    serviceChargeBps: Number(row.service_charge_bps ?? 0),
    serviceChargeLabel: typeof row.service_charge_label === "string"
      ? row.service_charge_label
      : "Service charge",
    tipsEnabled: row.tips_enabled === true,
    tipPresetsBps: presets !== null && presets.length > 0 ? presets : null,
    counterPickupEnabled: row.counter_pickup_enabled === true,
    prepTimeMinutes: row.prep_time_minutes === null ||
        row.prep_time_minutes === undefined
      ? null
      : Number(row.prep_time_minutes),
  };
}

export function parseVenueOrderModifiers(
  data: unknown,
): Record<string, VenueOrderModifierGroup[]> {
  if (data === null || typeof data !== "object") return {};
  const out: Record<string, VenueOrderModifierGroup[]> = {};
  for (const [itemId, groups] of Object.entries(data as Record<string, unknown>)) {
    if (!Array.isArray(groups)) continue;
    out[itemId] = groups.map((raw) => {
      const group = raw as Record<string, unknown>;
      const modifiers = Array.isArray(group.modifiers) ? group.modifiers : [];
      return {
        id: String(group.id),
        name: String(group.name ?? ""),
        selectionMode: String(group.selection_mode ?? "single"),
        minSelect: Number(group.min_select ?? 0),
        maxSelect: group.max_select === null || group.max_select === undefined
          ? null
          : Number(group.max_select),
        modifiers: modifiers.map((rawModifier) => {
          const modifier = rawModifier as Record<string, unknown>;
          return {
            id: String(modifier.id),
            name: String(modifier.name ?? ""),
            priceDeltaCents: Number(modifier.price_delta_cents ?? 0),
            currency: String(modifier.currency ?? ""),
          };
        }),
      };
    });
  }
  return out;
}

/** Copied across, never recomputed. */
export function parseVenueOrderPreview(
  data: Record<string, unknown>,
): VenueOrderPreview {
  return {
    currency: String(data.currency ?? ""),
    subtotalCents: Number(data.subtotalCents ?? 0),
    serviceChargeCents: Number(data.serviceChargeCents ?? 0),
    serviceChargeLabel: typeof data.serviceChargeLabel === "string"
      ? data.serviceChargeLabel
      : "Service charge",
    feesAndTaxCents: Number(data.feesAndTaxCents ?? 0),
    tipCents: Number(data.tipCents ?? 0),
    totalCents: Number(data.totalCents ?? 0),
    tipsEnabled: data.tipsEnabled === true,
    counterPickupEnabled: data.counterPickupEnabled === true,
    lines: Array.isArray(data.lines)
      ? (data.lines as Array<Record<string, unknown>>).map((line) => ({
        lineNo: Number(line.lineNo ?? 0),
        menuItemId: String(line.menuItemId ?? ""),
        itemNameAtOrder: String(line.itemNameAtOrder ?? ""),
        unitPriceCents: Number(line.unitPriceCents ?? 0),
        currency: String(line.currency ?? ""),
        quantity: Number(line.quantity ?? 0),
        modifiersTotalCents: Number(line.modifiersTotalCents ?? 0),
        lineTotalCents: Number(line.lineTotalCents ?? 0),
        notes: typeof line.notes === "string" ? line.notes : null,
      }))
      : [],
  };
}

export function parseVenueOrderStatus(
  data: Record<string, unknown>,
  fallbackOrderId: string,
): VenueOrderLiveStatus {
  const totals = (data.totals ?? {}) as Record<string, unknown>;
  return {
    orderId: String(data.orderId ?? fallbackOrderId),
    paymentStatus: String(data.paymentStatus ?? "pending"),
    fulfillmentStatus: String(
      data.fulfillmentStatus ?? "placed",
    ) as VenueOrderLiveStatus["fulfillmentStatus"],
    acknowledgedAt: typeof data.acknowledgedAt === "string"
      ? data.acknowledgedAt
      : null,
    readyAt: typeof data.readyAt === "string" ? data.readyAt : null,
    refundRequestedAt: typeof data.refundRequestedAt === "string"
      ? data.refundRequestedAt
      : null,
    refundDecision: typeof data.refundDecision === "string"
      ? data.refundDecision
      : null,
    escalationLevel: Number(data.escalationLevel ?? 0),
    // D-3a — non-null EXACTLY when the order had no spot. It is the recorded
    // fact the whole collect-versus-deliver branch reads.
    pickupCode: typeof data.pickupCode === "string" ? data.pickupCode : null,
    spotLabel: typeof data.spotLabel === "string" ? data.spotLabel : null,
    canCancel: data.canCancel === true,
    canRequestRefund: data.canRequestRefund === true,
    totals: {
      currency: String(totals.currency ?? ""),
      subtotalCents: Number(totals.subtotalCents ?? 0),
      serviceChargeCents: Number(totals.serviceChargeCents ?? 0),
      feesAndTaxCents: Number(totals.feesAndTaxCents ?? 0),
      tipCents: Number(totals.tipCents ?? 0),
      totalCents: Number(totals.totalCents ?? 0),
      refundedAmountCents: Number(totals.refundedAmountCents ?? 0),
    },
  };
}
