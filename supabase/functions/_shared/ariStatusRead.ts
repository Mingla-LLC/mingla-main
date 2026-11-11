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
  statusKindsInText,
  type StatusReadPlan,
  type StatusReadResult,
} from "./ariClaimCheck.ts";

export { STATUS_READ_KINDS, statusKindsInText };
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

// ── Which kinds a reply speaks about ────────────────────────────────────────

/** Status words that make a reply worth this read. */
export const STATUS_HINT =
  /\b(?:live|published|unpublished|draft|active|on\s+sale|sold\s+out|went\s+out|gone\s+out|sent|scheduled|cancell?ed|ended|approved|verified|pending|review|refunded|processed|went\s+through|ready|set\s+up|enabled|provisioned|up\s+and\s+running|good\s+to\s+go|paused|open)\b|[✅✔]/i;

/** Two or more capitalised words in a row, not at a sentence start alone. */
const TITLE_RUN =
  /(?:^|[^.!?]\s)(?:[A-Z][\p{L}\p{N}'’&-]+\s+){1,5}[A-Z][\p{L}\p{N}'’&-]+/u;

/** The status kind a card's tool is about, or null. */
export function statusKindOfTool(toolName: string): AriClaimKind | null {
  const name = toolName.toLowerCase();
  if (/refund/.test(name)) return "refund";
  if (/payout|bank/.test(name)) return "payout";
  if (/campaign|blast/.test(name)) return "message";
  if (/tier|ticket_type|pricing/.test(name)) return "ticket";
  if (/trip/.test(name)) return "trip";
  if (/experience/.test(name)) return "experience";
  if (/stay/.test(name)) return "stay";
  if (/venue/.test(name)) return "venue";
  if (/site/.test(name)) return "website";
  if (/event|rsvp/.test(name)) return "event";
  return null;
}

/**
 * The kinds this turn's read covers: those the reply names (with a status
 * word), plus the kinds of the chat's cards when the reply speaks of a
 * status without naming a kind ("It's live!").
 */
export function statusKindsWanted(args: {
  text: string;
  cards: readonly StatusCard[];
}): Set<AriClaimKind> {
  if (!STATUS_HINT.test(args.text)) return new Set();
  const out = statusKindsInText(args.text);
  const named = out.size;
  for (const card of args.cards) {
    const kind = statusKindOfTool(card.toolName);
    if (!kind) continue;
    const titled = card.object &&
      identityKey(args.text).includes(identityKey(card.object));
    if (titled || named === 0) out.add(kind);
  }
  // "Lagos Night Out is sold out!": a title said with a status and no kind
  // word or card is most likely an offering; read the brand's offerings.
  if (out.size === 0 && TITLE_RUN.test(args.text)) {
    out.add("event");
    out.add("trip");
    out.add("experience");
  }
  return out;
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

function row(
  kind: AriClaimKind,
  tool: string,
  names: string[],
  readState: ReadState,
): ClaimEvidence {
  return {
    status: "read",
    kind,
    toolName: tool,
    objects: names.filter((name) => name.trim().length > 0),
    state: null,
    thisTurn: true,
    readState,
    fresh: true,
    statusRow: true,
  };
}

/**
 * One batched status read for the active brand, as the caller. Each kind
 * reads on its own; a failed kind is reported in `failedKinds` and its
 * status is never asserted. A row the chat's cards name (by id or title)
 * is this turn's object; the brand's other rows of a kind are this turn's
 * objects only when no card of that kind is in the chat (so "your event is
 * published" with one event in the chat is held to that event).
 */
export async function readObjectStatuses(args: {
  client: StatusClient;
  brandId: string | null;
  kinds: ReadonlySet<AriClaimKind>;
  cards: readonly StatusCard[];
  /** The reply mentions "sold out" (reads remaining inventory). */
  soldOut?: boolean;
  now?: Date;
}): Promise<StatusReadResult> {
  const now = args.now ?? new Date();
  const brandId = args.brandId && UUID_SHAPE.test(args.brandId)
    ? args.brandId
    : null;
  const wanted = [...args.kinds].filter((kind) => STATUS_READ_KINDS.has(kind));
  if (!brandId || wanted.length === 0) {
    return {
      records: [],
      okKinds: [],
      failedKinds: brandId ? [] : wanted,
    };
  }
  const has = (kind: AriClaimKind) => wanted.includes(kind);
  const cardKinds = new Set(
    args.cards.flatMap((card) => {
      const kind = statusKindOfTool(card.toolName);
      return kind ? [kind] : [];
    }),
  );
  const named = cardNames(args.cards, args.kinds);
  const offeringIds = idsOf(args.cards, "offering");
  const inChat = (
    kind: AriClaimKind,
    id: unknown,
    names: string[],
    ids: readonly string[],
  ) =>
    !cardKinds.has(kind) || ids.includes(String(id)) ||
    names.some((name) => named.has(identityKey(name)));
  const client = args.client;
  const reads: KindRead[] = [];

  const offeringKinds = (["event", "trip", "experience"] as AriClaimKind[])
    .filter(has);
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
          offeringIds.includes(String(item.id)) ||
          named.has(identityKey(String(item.title ?? "")))
        );
        // Sold out: the public remaining-inventory reader, for the chat's
        // published offerings (at most 3), only when the reply says so.
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
          out.push({
            ...row(kind, "status_read_offering", [title], {
              ...state,
              ...(sold !== undefined ? { soldOut: sold } : {}),
            }),
            thisTurn: inChat(kind, item.id, [title], offeringIds),
          });
        }
        if (tiersWanted) {
          const eventIds =
            (chatOfferings.length > 0 ? chatOfferings : offerings.slice(0, 5))
              .map((item) => String(item.id));
          const tierIds = idsOf(args.cards, "tier");
          if (eventIds.length > 0 || tierIds.length > 0) {
            const query = client.from("ticket_types").select(
              "id,name,event_id,is_disabled,sale_end_at",
            ).is("deleted_at", null).limit(40);
            const tiers = rowsOf(
              await (tierIds.length > 0
                ? query.in("id", tierIds)
                : query.in("event_id", eventIds)),
            );
            for (const tier of tiers) {
              const name = String(tier.name ?? "");
              out.push({
                ...row("ticket", "status_read_tier", [name], {
                  ...tierReadState(tier, now),
                }),
                thisTurn: inChat("ticket", tier.id, [name], tierIds),
              });
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
            out.push({
              ...row("venue", "status_read_venue", [name], {
                ...venueReadState(item),
              }),
              thisTurn: inChat("venue", item.id, [name], venueIds),
            });
          }
        }
        for (const item of rowsOf(stays)) {
          const name = nameOf.get(String(item.venue_id)) ?? "";
          out.push({
            ...row("stay", "status_read_stay", [name], {
              ...stayReadState(item),
            }),
            thisTurn: inChat("stay", item.venue_id, [name], venueIds),
          });
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
          return {
            ...row("message", "status_read_campaign", [name], {
              ...campaignReadState(item),
            }),
            thisTurn: inChat("message", item.id, [name], ids),
          };
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
          row("website", "status_read_site", [
            "your website",
            "website",
            "your site",
          ], siteReadState(site)),
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
          })
        );
      },
    });
  }

  if (has("payout")) {
    reads.push({
      kinds: ["payout"],
      run: async () => {
        // The canonical payout predicate (the same one get_payout_status
        // reads through brand_readiness): never re-derived here.
        const result = await client.rpc("pg_brand_can_payout", {
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
  return { records, okKinds, failedKinds };
}

/**
 * The status read a caller wires into checkReplyClaims: the kinds this reply
 * speaks about (reply words, plus the chat's cards when the reply names no
 * kind), read as the caller for the active brand. Undefined when the reply
 * speaks about no status kind.
 */
export function objectStatusReadPlan(args: {
  client: StatusClient;
  brandId: string | null;
  text: string;
  cards: readonly StatusCard[];
}): StatusReadPlan | undefined {
  const kinds = statusKindsWanted({ text: args.text, cards: args.cards });
  if (kinds.size === 0) return undefined;
  return {
    kinds,
    read: () =>
      readObjectStatuses({
        client: args.client,
        brandId: args.brandId,
        kinds,
        cards: args.cards,
        soldOut: /\bsold\s+out\b/i.test(args.text),
      }),
  };
}
