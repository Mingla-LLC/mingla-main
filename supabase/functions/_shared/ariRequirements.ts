/** Issue #4637: money-affecting proposals may not widen stated scope. */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

export type AriStatedScopeKind =
  | "ticket_type"
  | "event"
  | "listing_kind"
  | "brand";

export interface AriStatedScope {
  kind: AriStatedScopeKind;
  name?: string;
  /** Canonical ids resolved from the owner's named scope. A name alone is not identity proof. */
  targetIds?: readonly string[];
  /** Exclusions cannot be represented by today's positive discount targets. */
  mode?: "include" | "exclude";
}

export interface AriScopeIssue {
  code: "SCOPE_BROADER_THAN_STATED";
  message: string;
}

export interface AriScopeHistoryLine {
  role: "user" | "assistant" | string;
  text: string;
}

const SCOPE_CLARIFICATION = /^(?:Which ticket type|Which event or listing)\b/i;

/** Carry a generated scope clarification for exactly the following owner turn. */
export function ariScopeTextForTurn(
  history: readonly AriScopeHistoryLine[],
  currentText: string,
): string {
  if (deterministicStatedScope(currentText)) return currentText;
  const prior = [...history];
  const last = prior.at(-1);
  if (last?.role === "user" && last.text.trim() === currentText.trim()) {
    prior.pop();
  }
  const clarification = prior.at(-1);
  if (
    clarification?.role !== "assistant" ||
    !SCOPE_CLARIFICATION.test(clarification.text.trim())
  ) return currentText;
  const owner = [...prior].reverse().find((line) => line.role === "user");
  return owner ? `${owner.text}\n${currentText}` : currentText;
}

function normalizedName(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

/** Resolve a named owner scope against canonical rows; ambiguity fails closed. */
export async function resolveAriStatedScope(
  client: SupabaseClient,
  brandId: string | null,
  text: string,
): Promise<AriStatedScope | null> {
  const stated = deterministicStatedScope(text);
  if (!stated?.name) return stated;
  if (!brandId) return { ...stated, targetIds: [] };
  const { data: eventRows, error: eventError } = await client.from("events")
    .select("id,title")
    .eq("brand_id", brandId)
    .is("deleted_at", null)
    .limit(200);
  if (eventError) return { ...stated, targetIds: [] };
  const events = (eventRows ?? []).flatMap((row) =>
    typeof row.id === "string" && typeof row.title === "string"
      ? [{ id: row.id, title: row.title }]
      : []
  );
  const name = normalizedName(stated.name);
  if (stated.kind === "event") {
    const matches = events.filter((event) =>
      normalizedName(event.title) === name
    );
    if (matches.length !== 1) return { ...stated, targetIds: [] };
    const { data: tiers, error: tierError } = await client.from("ticket_types")
      .select("id")
      .eq("event_id", matches[0].id)
      .is("deleted_at", null)
      .limit(200);
    if (tierError) return { ...stated, targetIds: [] };
    return {
      ...stated,
      targetIds: [
        matches[0].id,
        ...(tiers ?? []).flatMap((row) =>
          typeof row.id === "string" ? [row.id] : []
        ),
      ],
    };
  }
  if (stated.kind === "ticket_type") {
    const eventIds = events.map((event) => event.id);
    if (eventIds.length === 0) return { ...stated, targetIds: [] };
    const { data: tiers, error: tierError } = await client.from("ticket_types")
      .select("id,name")
      .in("event_id", eventIds)
      .is("deleted_at", null)
      .limit(500);
    if (tierError) return { ...stated, targetIds: [] };
    const matches = (tiers ?? []).flatMap((row) =>
      typeof row.id === "string" && typeof row.name === "string" &&
        normalizedName(row.name) === name
        ? [row.id]
        : []
    );
    return { ...stated, targetIds: matches.length === 1 ? matches : [] };
  }
  return stated;
}

export function deterministicStatedScope(text: string): AriStatedScope | null {
  const restrictive = /\b(?:only|just|except|limited to)\b/i;
  const sentences = String(text ?? "").split(/(?<=[.!?])\s+/);
  const sentence = sentences.find((part) =>
    restrictive.test(part) &&
    /\b(?:tickets?|tiers?|events?|experiences?|trips?|venues?)\b/i.test(part)
  );
  if (!sentence) {
    const direct = sentences.find((part) =>
      /\b(?:tickets?|tiers?|events?|experiences?|trips?|venues?)\b/i.test(
        part,
      )
    );
    if (!direct) return null;
    const directName = (
      noun: "ticket" | "event",
    ): string | undefined => {
      const nouns = noun === "ticket"
        ? "tickets?|tiers?"
        : "events?|experiences?|trips?|venues?";
      // Prefer the nearest explicit preposition. This keeps imperative prose
      // ("Create an offer for Friday Dinner event") out of the entity name.
      const preposition = direct.match(
        new RegExp(
          `\\b(?:for|to|on)\\s+(?:the\\s+)?(.{1,60}?)\\s+(?:${nouns})\\b`,
          "i",
        ),
      )?.[1];
      const imperative = direct.match(
        new RegExp(
          `^\\s*(?:please\\s+)?(?:give|discount|apply(?:\\s+[^.!?]{0,30}?\\s+to)?)\\s+(?:the\\s+)?(.{1,60}?)\\s+(?:${nouns})\\b`,
          "i",
        ),
      )?.[1];
      const name = (preposition ?? imperative)?.trim().replace(
        /^(?:all|every|only|just)\s+/i,
        "",
      );
      return name &&
          !/^(?:a|an|the|this|that|my|our|all|every)$/i.test(name)
        ? name
        : undefined;
    };
    if (/\b(?:tickets?|tiers?)\b/i.test(direct)) {
      const name = directName("ticket");
      return name ? { kind: "ticket_type", name, mode: "include" } : null;
    }
    const name = directName("event");
    return name ? { kind: "event", name, mode: "include" } : null;
  }
  const mode = /\bexcept\b/i.test(sentence) ? "exclude" : "include";
  if (!/\b(?:tickets?|tiers?)\b/i.test(sentence)) {
    const genericKind = sentence.match(
      /(?:only|just|except|limited to)(?:\s+for)?\s+(?:the\s+)?(events?|experiences?|trips?|venues?)\s*[.!?]*$/i,
    )?.[1]?.toLocaleLowerCase().replace(/s$/, "");
    if (genericKind) {
      return { kind: "listing_kind", name: genericKind, mode };
    }
    const eventName = sentence.match(
      /(?:only|just|except|limited to)(?:\s+for)?\s+(?:the\s+)?(.{1,60}?)\s+(?:events?|experiences?|trips?|venues?)\b/i,
    )?.[1]?.trim();
    return {
      kind: "event",
      ...(eventName ? { name: eventName } : {}),
      mode,
    };
  }
  const named = sentence.match(
    /(?:only|just|except|limited to)(?:\s+for)?\s+(?:the\s+)?(.{1,60}?)\s+(?:tickets?|tiers?)\b/i,
  )?.[1]?.trim();
  return {
    kind: "ticket_type",
    ...(named ? { name: named } : {}),
    mode,
  };
}

function discountHonoursScope(
  args: Record<string, unknown>,
  stated: AriStatedScope,
): boolean {
  const targets = Array.isArray(args.targets)
    ? args.targets.filter((target): target is Record<string, unknown> =>
      target !== null && typeof target === "object" && !Array.isArray(target)
    )
    : [];
  if (stated.kind === "brand") return true;
  const namedIds = stated.name && stated.kind !== "listing_kind"
    ? new Set((stated.targetIds ?? []).filter((id) => id.length > 0))
    : null;
  // A model-selected UUID cannot prove it belongs to the entity the owner
  // named. Callers must pass ids from a canonical read or fail closed.
  if (namedIds && namedIds.size === 0) return false;
  if (stated.kind === "ticket_type") {
    return targets.length > 0 &&
      targets.every((target) =>
        target.target_kind === "ticket_type" &&
        typeof target.target_id === "string" &&
        (!namedIds || namedIds.has(target.target_id))
      );
  }
  if (stated.kind === "event") {
    return targets.length > 0 &&
      targets.every((target) =>
        (target.target_kind === "event" ||
          target.target_kind === "ticket_type") &&
        typeof target.target_id === "string" &&
        (!namedIds || namedIds.has(target.target_id))
      );
  }
  return targets.length > 0 &&
    targets.every((target) =>
      target.target_kind === "listing_kind" &&
      target.listing_kind === stated.name
    );
}

function referralHonoursScope(
  args: Record<string, unknown>,
  stated: AriStatedScope,
): boolean {
  if (stated.kind === "brand") return true;
  const listings = Array.isArray(args.listings)
    ? args.listings.filter((listing): listing is Record<string, unknown> =>
      listing !== null && typeof listing === "object" &&
      !Array.isArray(listing)
    )
    : [];
  if (
    stated.kind === "ticket_type" || args.scope_kind !== "listings" ||
    listings.length === 0
  ) {
    return false;
  }
  const namedIds = stated.name && stated.kind !== "listing_kind"
    ? new Set((stated.targetIds ?? []).filter((id) => id.length > 0))
    : null;
  if (namedIds && namedIds.size === 0) return false;
  if (stated.kind === "event") {
    return listings.every((listing) =>
      listing.listing_kind === "event" &&
      typeof listing.listing_id === "string" &&
      (!namedIds || namedIds.has(listing.listing_id))
    );
  }
  const kind = stated.name?.trim().toLowerCase().replace(/s$/, "");
  return Boolean(kind) &&
    listings.every((listing) => listing.listing_kind === kind);
}

export function proposalScopeIssue(input: {
  toolName: string;
  args: Record<string, unknown>;
  hostText?: string;
  statedScope?: AriStatedScope | null;
  scopeReadFailed?: boolean;
}): AriScopeIssue | null {
  if (!["create_discount", "create_referral_offer"].includes(input.toolName)) {
    return null;
  }
  if (input.scopeReadFailed) {
    return {
      code: "SCOPE_BROADER_THAN_STATED",
      message:
        "I couldn't safely verify the scope from the prior turn. Ask which event, listing, or ticket type should receive the change.",
    };
  }
  const stated = input.statedScope ??
    deterministicStatedScope(input.hostText ?? "");
  if (!stated) return null;
  const safe = stated.mode === "exclude"
    ? false
    : input.toolName === "create_discount"
    ? discountHonoursScope(input.args, stated)
    : referralHonoursScope(input.args, stated);
  return safe ? null : {
    code: "SCOPE_BROADER_THAN_STATED",
    message: stated.mode === "exclude"
      ? "The owner excluded part of this scope. Ask which ticket types should receive the change before proposing it."
      : stated.kind === "ticket_type"
      ? "The owner limited this to a ticket type. Target only that ticket type, or ask which ticket type before proposing the change."
      : "The proposed scope is broader than the owner stated. Narrow it to the stated event or listing before proposing the change.",
  };
}
