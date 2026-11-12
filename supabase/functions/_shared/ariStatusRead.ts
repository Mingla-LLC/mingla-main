// #3355 rework 5b (Seth 2026-11-11 "check all"): the fresh, brand-scoped
// status read for every object Ari can create or change the status of,
// beyond discount codes, notes and tickets (ariClaimCheck.ts
// recentRecordEvidence covers those):
//   events, RSVPs, trips and experiences (one `events` read), stays
//   (`stay_settings`), venues (`venue_listings`), blasts
//   (`marketing_campaigns`), the brand website (`brand_sites`), ticket tiers
//   (`ticket_types`, with the public remaining-inventory reader for "sold
//   out"), refunds (`refunds`) and payout readiness (`pg_brand_can_payout`).
//
// It runs as the CALLER (their JWT), so RLS decides what is seen, and only
// for the active brand. It is one batched read per turn: every kind the
// reply speaks about is read in parallel, and each kind fails on its own (a
// failed venue read never hides an event row). The caller cuts the whole
// read at ARI_CLAIM_RECORDS_TIMEOUT_MS beside the judge call.
//
// Rows come back as fresh `read` claim evidence with the object's current
// state, so a status claim in the reply ("Your event is published", "The
// blast went out") is decided by them before any older receipt or card.

import {
  type AriClaimKind,
  type ClaimEvidence,
  identityKey,
  type ReadState,
  STATUS_READ_KINDS,
  statusKindOfTool,
  statusKindsInText,
  type StatusReadPlan,
  type StatusReadResult,
} from "./ariClaimCheck.ts";

export { STATUS_READ_KINDS, statusKindOfTool, statusKindsInText };
export type { StatusReadResult };

/** A card the chat holds (a WriteState is one). */
export interface StatusCard {
  toolName: string;
  args: Record<string, unknown>;
  object: string | null;
}

/** The narrow client surface the read uses (the caller's client). */
export interface StatusClient {
  // deno-lint-ignore no-explicit-any
  from(table: string): any;
  // deno-lint-ignore no-explicit-any
  rpc(fn: string, args?: Record<string, unknown>): any;
}

const UUID_SHAPE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── Which kinds a turn mentions ─────────────────────────────────────────────

/** Two or more capitalised words in a row, not at a sentence start alone. */
const TITLE_RUN =
  /(?:^|[^.!?]\s)(?:[A-Z][\p{L}\p{N}'’&-]+\s+){1,5}[A-Z][\p{L}\p{N}'’&-]+/u;

const OFFERINGS: readonly AriClaimKind[] = ["event", "trip", "experience"];

/**
 * #3355 rework 6 (Seth's rule 3): the kinds read BESIDE the judge call —
 * what the turn mentions: the kinds the reply and the host's message name,
 * the kinds of the chat's cards, and the brand's offerings when a title is
 * said with no kind word. It is a prefetch, never a gate: the claims decide,
 * and checkReplyClaims reads any kind a status claim names that is not here
 * (the rework 5b status-word hint list is gone).
 */
export function statusKindsWanted(args: {
  text: string;
  cards: readonly StatusCard[];
  hostMessage?: string;
}): Set<AriClaimKind> {
  const out = new Set<AriClaimKind>([
    ...statusKindsInText(args.text),
    ...statusKindsInText(args.hostMessage ?? ""),
  ]);
  for (const card of args.cards) {
    const kind = statusKindOfTool(card.toolName);
    if (kind) out.add(kind);
  }
  if (
    TITLE_RUN.test(args.text) || TITLE_RUN.test(args.hostMessage ?? "")
  ) {
    for (const kind of OFFERINGS) out.add(kind);
  }
  // One `events` read answers all three offering kinds.
  if (OFFERINGS.some((kind) => out.has(kind))) {
    for (const kind of OFFERINGS) out.add(kind);
  }
  return new Set([...out].filter((kind) => STATUS_READ_KINDS.has(kind)));
}

/**
 * #3355 rework 6 (R6-6 / R6-7 / R6-10): kinds a brand role cannot read. RLS
 * returns NO ROWS (never an error) for these, so an empty answer would read
 * as "not set up" or let an older card speak: they are never read for the
 * role, and the reply says Ari can't check them for this host. From the
 * policies: brand_sites needs marketing manager or above
 * (brand_sites_marketing_read); stay_settings is hidden from scanners and
 * marketing managers; refunds need payment rights
 * (biz_can_manage_payments_for_brand: brand admin and above, or finance
 * manager).
 */
const ROLE_HIDDEN_KINDS: Readonly<Record<string, readonly AriClaimKind[]>> = {
  scanner: ["website", "stay", "refund"],
  marketing_manager: ["stay", "refund"],
  event_manager: ["refund"],
};

export function hiddenKindsForRole(
  role: string | null | undefined,
): Set<AriClaimKind> {
  return new Set(ROLE_HIDDEN_KINDS[String(role ?? "").trim().toLowerCase()]);
}

// ── Row states ──────────────────────────────────────────────────────────────

/** `events.status` for every offering type (event, rsvp, trip, experience). */
export function offeringReadState(row: Record<string, unknown>): ReadState {
  switch (String(row.status ?? "")) {
    case "scheduled":
      // Published and upcoming (the Host app calls it published).
      return { live: true, label: "published" };
    case "live":
      return { live: true, label: "live" };
    case "ended":
      return { live: false, label: "ended" };
    case "cancelled":
      return { live: false, label: "cancelled" };
    case "draft":
      return { live: false, label: "a draft" };
    default:
      return { live: false, label: "not published" };
  }
}

/** Offering type → claim kind (an RSVP page is an event to the host). */
function offeringKind(row: Record<string, unknown>): AriClaimKind {
  const type = String(row.event_type ?? "event");
  return type === "trip" || type === "experience" ? type : "event";
}

/** `marketing_campaigns.status`: "live" for a blast means it was sent. */
export function campaignReadState(row: Record<string, unknown>): ReadState {
  switch (String(row.status ?? "")) {
    case "sent":
      return { live: true, label: "sent" };
    case "scheduled":
      return { live: false, label: "scheduled, not sent yet" };
    case "sending":
      return { live: false, label: "still sending" };
    case "failed":
      return { live: false, label: "failed to send" };
    case "cancelled":
      return { live: false, label: "cancelled" };
    default:
      return { live: false, label: "a draft, not sent" };
  }
}

/** `brand_sites.status`; no row: the brand has no website yet. */
export function siteReadState(row: Record<string, unknown> | null): ReadState {
  switch (row ? String(row.status ?? "") : "") {
    case "published":
      return { live: true, label: "published" };
    case "draft":
      return { live: false, label: "a draft, not published" };
    case "publishing":
      return { live: false, label: "still publishing" };
    case "provisioning":
      return { live: false, label: "still being set up" };
    case "suspended":
      return { live: false, label: "suspended" };
    case "error":
      return { live: false, label: "not set up (setup hit an error)" };
    default:
      return { live: false, label: "not set up yet" };
  }
}

/** `venue_listings.claim_status`. */
export function venueReadState(row: Record<string, unknown>): ReadState {
  switch (String(row.claim_status ?? "")) {
    case "verified":
      return { live: true, label: "approved" };
    case "pending_review":
      return { live: false, label: "pending review" };
    case "rejected":
      return { live: false, label: "not approved" };
    case "suspended":
      return { live: false, label: "suspended" };
    case "revoked":
      return { live: false, label: "revoked" };
    default:
      return { live: false, label: "not submitted for review" };
  }
}

/** `stay_settings.booking_state`. */
export function stayReadState(row: Record<string, unknown>): ReadState {
  switch (String(row.booking_state ?? "")) {
    case "active":
      return { live: true, label: "live" };
    case "review":
      return { live: false, label: "in review" };
    case "paused":
      return { live: false, label: "paused" };
    default:
      return { live: false, label: "a draft" };
  }
}

/** `ticket_types` (one tier). */
export function tierReadState(
  row: Record<string, unknown>,
  now: Date,
): ReadState {
  if (row.is_disabled === true) return { live: false, label: "turned off" };
  const ends = typeof row.sale_end_at === "string"
    ? Date.parse(row.sale_end_at)
    : NaN;
  if (Number.isFinite(ends) && ends <= now.getTime()) {
    return { live: false, label: "no longer on sale" };
  }
  return { live: true, label: "on sale" };
}

/** `refunds.status`. */
export function refundReadState(row: Record<string, unknown>): ReadState {
  switch (String(row.status ?? "")) {
    case "succeeded":
      return { live: true, label: "refunded" };
    case "failed":
      return { live: false, label: "failed" };
    case "cancelled":
      return { live: false, label: "cancelled" };
    default:
      return { live: false, label: "still processing" };
  }
}

/**
 * Sold out: every tier of the offering has a limit and none left. Unknown
 * (undefined) when the remaining-inventory rows are missing.
 */
export function soldOutOf(
  rows: ReadonlyArray<Record<string, unknown>> | null,
): boolean | undefined {
  if (!rows || rows.length === 0) return undefined;
  return rows.every((row) =>
    typeof row.remaining === "number" && row.remaining <= 0
  );
}

// ── The read ────────────────────────────────────────────────────────────────

const ID_KEYS: Readonly<Record<string, readonly string[]>> = {
  offering: ["event_id", "trip_id", "experience_id", "rsvp_id"],
  venue: ["venue_id"],
  campaign: ["campaign_id"],
  tier: ["ticket_type_id", "tier_id"],
  order: ["order_id"],
};

function idsOf(cards: readonly StatusCard[], group: string): string[] {
  const out = new Set<string>();
  for (const card of cards) {
    for (const key of ID_KEYS[group]) {
      const value = card.args[key];
      if (typeof value === "string" && UUID_SHAPE.test(value)) out.add(value);
    }
  }
  return [...out].slice(0, 20);
}

/** Titles the chat's cards give objects of these kinds. */
function cardNames(
  cards: readonly StatusCard[],
  kinds: ReadonlySet<AriClaimKind>,
): Set<string> {
  const out = new Set<string>();
  for (const card of cards) {
    const kind = statusKindOfTool(card.toolName);
    if (!kind || !kinds.has(kind)) continue;
    for (
      const value of [card.object, card.args.title, card.args.name]
    ) {
      if (typeof value === "string" && value.trim()) {
        out.add(identityKey(value));
      }
    }
  }
  return out;
}

function rowsOf(result: { data?: unknown; error?: unknown }): Array<
  Record<string, unknown>
> {
  if (result.error) throw new Error("status read failed");
  return Array.isArray(result.data)
    ? result.data as Array<Record<string, unknown>>
    : [];
}

interface KindRead {
  kinds: AriClaimKind[];
  run: () => Promise<ClaimEvidence[]>;
}

/**
 * One row of this turn's read. Rework 6: `objectId` is the row's own id and
 * `onCard` says a chat card names it (by id or title); a row is never "this
 * turn's object" just because the chat has no card of its kind (R6-1).
 */
function row(
  kind: AriClaimKind,
  tool: string,
  names: string[],
  readState: ReadState,
  identity: { id?: unknown; onCard: boolean },
): ClaimEvidence {
  return {
    status: "read",
    kind,
    toolName: tool,
    objects: names.filter((name) => name.trim().length > 0),
    state: null,
    thisTurn: identity.onCard,
    readState,
    fresh: true,
    statusRow: true,
    ...(typeof identity.id === "string" && identity.id
      ? { objectId: identity.id }
      : {}),
    onCard: identity.onCard,
  };
}

/**
 * One batched status read for the active brand, as the caller. Each kind
 * reads on its own; a failed kind is reported in `failedKinds` and its
 * status is never asserted. Kinds the caller's role cannot read are not
 * read at all and come back in `hiddenKinds`. Every row carries its id and
 * whether a chat card names it; which row a claim is about is decided by
 * ariClaimCheck.ts (resolveStatusTarget), never here.
 */
export async function readObjectStatuses(args: {
  client: StatusClient;
  brandId: string | null;
  kinds: ReadonlySet<AriClaimKind>;
  cards: readonly StatusCard[];
  /** The caller's role on the brand (rework 6: hidden kinds), when known. */
  brandRole?: string | null;
  /** The reply mentions "sold out" (reads remaining inventory). */
  soldOut?: boolean;
  now?: Date;
}): Promise<StatusReadResult> {
  const now = args.now ?? new Date();
  const brandId = args.brandId && UUID_SHAPE.test(args.brandId)
    ? args.brandId
    : null;
  const hidden = hiddenKindsForRole(args.brandRole);
  const asked = [...args.kinds].filter((kind) => STATUS_READ_KINDS.has(kind));
  const hiddenKinds = asked.filter((kind) => hidden.has(kind));
  let wanted = asked.filter((kind) => !hidden.has(kind));
  if (wanted.some((kind) => OFFERINGS.includes(kind))) {
    wanted = [...new Set([...wanted, ...OFFERINGS])];
  }
  if (!brandId || wanted.length === 0) {
    return {
      records: [],
      okKinds: [],
      failedKinds: brandId ? [] : wanted,
      hiddenKinds,
    };
  }
  const has = (kind: AriClaimKind) => wanted.includes(kind);
  const named = cardNames(args.cards, new Set(wanted));
  const offeringIds = idsOf(args.cards, "offering");
  const onCard = (id: unknown, names: string[], ids: readonly string[]) =>
    ids.includes(String(id)) ||
    names.some((name) => name.trim() && named.has(identityKey(name)));
  const client = args.client;
  const reads: KindRead[] = [];

  const offeringKinds = OFFERINGS.filter(has);
  const tiersWanted = has("ticket");
  if (offeringKinds.length > 0 || tiersWanted) {
    reads.push({
      kinds: [...offeringKinds, ...(tiersWanted ? ["ticket" as const] : [])],
      run: async () => {
        const select = "id,title,status,event_type,updated_at";
        const [recent, byId] = await Promise.all([
          client.from("events").select(select).eq("brand_id", brandId)
            .is("deleted_at", null).order("updated_at", { ascending: false })
            .limit(25),
          offeringIds.length > 0
            ? client.from("events").select(select).eq("brand_id", brandId)
              .is("deleted_at", null).in("id", offeringIds)
            : Promise.resolve({ data: [], error: null }),
        ]);
        const seen = new Map<string, Record<string, unknown>>();
        for (const item of [...rowsOf(byId), ...rowsOf(recent)]) {
          if (typeof item.id === "string") seen.set(item.id, item);
        }
        const offerings = [...seen.values()];
        const chatOfferings = offerings.filter((item) =>
          onCard(item.id, [String(item.title ?? "")], offeringIds)
        );
        // Sold out: the public remaining-inventory reader, for published
        // offerings (the chat's first, at most 3), only when the reply says so.
        const soldOut = new Map<string, boolean | undefined>();
        if (args.soldOut) {
          const targets = (chatOfferings.length > 0 ? chatOfferings : offerings)
            .filter((item) => offeringReadState(item).live)
            .slice(0, 3);
          await Promise.all(targets.map(async (item) => {
            const result = await client.rpc(
              "pg_public_ticket_types_remaining",
              { p_event_id: item.id },
            );
            soldOut.set(
              String(item.id),
              result.error ? undefined : soldOutOf(rowsOf(result)),
            );
          }));
        }
        const out: ClaimEvidence[] = [];
        for (const item of offerings) {
          const kind = offeringKind(item);
          if (!offeringKinds.includes(kind)) continue;
          const title = String(item.title ?? "");
          const state = offeringReadState(item);
          const sold = soldOut.get(String(item.id));
          out.push(
            row(kind, "status_read_offering", [title], {
              ...state,
              ...(sold !== undefined ? { soldOut: sold } : {}),
            }, { id: item.id, onCard: onCard(item.id, [title], offeringIds) }),
          );
        }
        if (tiersWanted) {
          // R6-16: tiers only of this brand's offerings, also when read by id.
          const brandEvents = offerings.map((item) => String(item.id));
          const eventIds =
            (chatOfferings.length > 0 ? chatOfferings : offerings.slice(0, 5))
              .map((item) => String(item.id));
          const tierIds = idsOf(args.cards, "tier");
          if (
            brandEvents.length > 0 &&
            (eventIds.length > 0 || tierIds.length > 0)
          ) {
            const query = client.from("ticket_types").select(
              "id,name,event_id,is_disabled,sale_end_at",
            ).is("deleted_at", null).limit(40);
            const tiers = rowsOf(
              await (tierIds.length > 0
                ? query.in("id", tierIds).in("event_id", brandEvents)
                : query.in("event_id", eventIds)),
            );
            for (const tier of tiers) {
              const name = String(tier.name ?? "");
              out.push(
                row("ticket", "status_read_tier", [name], {
                  ...tierReadState(tier, now),
                }, { id: tier.id, onCard: onCard(tier.id, [name], tierIds) }),
              );
            }
          }
        }
        return out;
      },
    });
  }

  if (has("venue") || has("stay")) {
    reads.push({
      kinds: wanted.filter((kind) => kind === "venue" || kind === "stay"),
      run: async () => {
        const venueIds = idsOf(args.cards, "venue");
        const [venues, stays] = await Promise.all([
          client.from("venue_listings").select("id,name,claim_status")
            .eq("brand_id", brandId).limit(25),
          has("stay")
            ? client.from("stay_settings").select("venue_id,booking_state")
              .eq("brand_id", brandId).limit(25)
            : Promise.resolve({ data: [], error: null }),
        ]);
        const venueRows = rowsOf(venues);
        const nameOf = new Map(
          venueRows.map((item) => [String(item.id), String(item.name ?? "")]),
        );
        const out: ClaimEvidence[] = [];
        if (has("venue")) {
          for (const item of venueRows) {
            const name = String(item.name ?? "");
            out.push(
              row("venue", "status_read_venue", [name], {
                ...venueReadState(item),
              }, { id: item.id, onCard: onCard(item.id, [name], venueIds) }),
            );
          }
        }
        for (const item of rowsOf(stays)) {
          const name = nameOf.get(String(item.venue_id)) ?? "";
          out.push(
            row("stay", "status_read_stay", [name], {
              ...stayReadState(item),
            }, {
              id: item.venue_id,
              onCard: onCard(item.venue_id, [name], venueIds),
            }),
          );
        }
        return out;
      },
    });
  }

  if (has("message")) {
    reads.push({
      kinds: ["message"],
      run: async () => {
        const ids = idsOf(args.cards, "campaign");
        const select = "id,name,status,scheduled_for,sent_at";
        const [recent, byId] = await Promise.all([
          client.from("marketing_campaigns").select(select)
            .eq("brand_id", brandId).order("updated_at", { ascending: false })
            .limit(15),
          ids.length > 0
            ? client.from("marketing_campaigns").select(select)
              .eq("brand_id", brandId).in("id", ids)
            : Promise.resolve({ data: [], error: null }),
        ]);
        const seen = new Map<string, Record<string, unknown>>();
        for (const item of [...rowsOf(byId), ...rowsOf(recent)]) {
          if (typeof item.id === "string") seen.set(item.id, item);
        }
        return [...seen.values()].map((item) => {
          const name = String(item.name ?? "");
          return row("message", "status_read_campaign", [name], {
            ...campaignReadState(item),
          }, { id: item.id, onCard: onCard(item.id, [name], ids) });
        });
      },
    });
  }

  if (has("website")) {
    reads.push({
      kinds: ["website"],
      run: async () => {
        const result = await client.from("brand_sites").select("status")
          .eq("brand_id", brandId).limit(1);
        const site = rowsOf(result)[0] ?? null;
        return [
          row(
            "website",
            "status_read_site",
            [
              "your website",
              "website",
              "your site",
            ],
            siteReadState(site),
            { id: `site:${brandId}`, onCard: false },
          ),
        ];
      },
    });
  }

  if (has("refund")) {
    reads.push({
      kinds: ["refund"],
      run: async () => {
        const orders = idsOf(args.cards, "order");
        if (orders.length === 0) return [];
        const result = await client.from("refunds").select(
          "order_id,status,created_at",
        ).in("order_id", orders).order("created_at", { ascending: false })
          .limit(20);
        const latest = new Map<string, Record<string, unknown>>();
        for (const item of rowsOf(result)) {
          const key = String(item.order_id);
          if (!latest.has(key)) latest.set(key, item);
        }
        return [...latest.values()].map((item) =>
          row("refund", "status_read_refund", ["the refund", "refund"], {
            ...refundReadState(item),
          }, { id: item.order_id, onCard: true })
        );
      },
    });
  }

  if (has("payout")) {
    reads.push({
      kinds: ["payout"],
      run: async () => {
        // The canonical payout predicate (the same one get_payout_status
        // reads through brand_readiness), answered only for brand members
        // (rework 6: pg_brand_can_payout_for_caller); never re-derived here.
        const result = await client.rpc("pg_brand_can_payout_for_caller", {
          p_brand_id: brandId,
        });
        if (result.error || typeof result.data !== "boolean") {
          throw new Error("payout read failed");
        }
        return [
          row(
            "payout",
            "status_read_payout",
            [
              "your payouts",
              "payouts",
            ],
            result.data
              ? { live: true, label: "ready" }
              : { live: false, label: "not ready yet" },
            { id: `payout:${brandId}`, onCard: false },
          ),
        ];
      },
    });
  }

  const settled = await Promise.allSettled(reads.map((read) => read.run()));
  const records: ClaimEvidence[] = [];
  const okKinds: AriClaimKind[] = [];
  const failedKinds: AriClaimKind[] = [];
  settled.forEach((outcome, index) => {
    if (outcome.status === "fulfilled") {
      records.push(...outcome.value);
      okKinds.push(...reads[index].kinds);
    } else {
      failedKinds.push(...reads[index].kinds);
    }
  });
  if (failedKinds.length > 0) {
    console.warn(
      "[ari-claim-check] status read failed",
      JSON.stringify({ kinds: failedKinds }),
    );
  }
  return { records, okKinds, failedKinds, hiddenKinds };
}

/**
 * The status read a caller wires into checkReplyClaims. Rework 6: always a
 * plan (never undefined): `kinds` is what the turn mentions (read beside the
 * judge), and `read(kinds)` reads whatever else a status claim names. As the
 * caller, for the active brand; kinds the caller's role cannot read are
 * reported, never read.
 */
export function objectStatusReadPlan(args: {
  client: StatusClient;
  brandId: string | null;
  text: string;
  cards: readonly StatusCard[];
  hostMessage?: string;
  brandRole?: string | null;
}): StatusReadPlan {
  const kinds = statusKindsWanted({
    text: args.text,
    cards: args.cards,
    hostMessage: args.hostMessage,
  });
  return {
    kinds,
    read: (wanted?: ReadonlySet<AriClaimKind>) =>
      readObjectStatuses({
        client: args.client,
        brandId: args.brandId,
        kinds: wanted ?? kinds,
        cards: args.cards,
        brandRole: args.brandRole,
        soldOut: /\bsold\s+out\b/i.test(args.text),
      }),
  };
}
