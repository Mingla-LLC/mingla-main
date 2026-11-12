// #3355 rework 3b — read answers in the brand's own time.
//
// Live device check (rework 3, screen 03): asked "when does FAVY10 end?",
// Flash read ends_at "2026-12-19T22:59:59Z" off list_discounts and said
// "10:59 PM West Africa Time". The end is 11:59 pm Lagos time. The model was
// given only UTC instants and converted them itself, wrongly.
//
// I-ARI-READS-IN-BRAND-TIME: before tool results, history tool rows and the
// brand snapshot reach the model, every instant gets a brand-local rendering
// beside it ("ends_at_local": "Sat 19 Dec 2026, 11:59 pm Lagos time"). The
// raw ISO stays for machines in tool results; rework 7 (R7-17): the brand
// snapshot, which only the model reads, carries the local rendering alone. The zone is the brand's time zone, then its
// country's single zone, then UTC labelled "UTC".
// Enforced by supabase/functions/_shared/__tests__/issue_3355_rework_3b.implementor.test.ts.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { isValidIanaTimezone } from "./agentRelativeTime.ts";
import { marketDefaultTimezone } from "./payoutCountries.ts";
import { formatInstant } from "./ariPresentation/registry.ts";

/** An ISO instant that names its zone (Z or an offset). */
const ISO_INSTANT =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})$/;
/** The same, inside running text. */
const ISO_INSTANT_IN_TEXT =
  /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})(?![\w:])/g;

const MAX_DEPTH = 8;

/** The brand's zone for display: brand → country's single zone → null (UTC). */
export function ariBrandDisplayZone(
  defaultTimezone: unknown,
  countryCode: unknown,
): string | null {
  if (isValidIanaTimezone(defaultTimezone)) return defaultTimezone;
  const market = marketDefaultTimezone(countryCode);
  return market && isValidIanaTimezone(market) ? market : null;
}

/** Read as the caller (RLS). Null on any failure: UTC, labelled "UTC". */
export async function readAriBrandDisplayZone(
  client: SupabaseClient,
  brandId: string,
): Promise<string | null> {
  try {
    const { data, error } = await client.from("brands")
      .select("default_timezone,country_code")
      .eq("id", brandId)
      .maybeSingle();
    if (error || !data) return null;
    const row = data as Record<string, unknown>;
    return ariBrandDisplayZone(row.default_timezone, row.country_code);
  } catch {
    return null;
  }
}

function isUtcZone(zone: string | null): boolean {
  if (!zone) return true;
  const upper = zone.toUpperCase();
  return upper === "UTC" || upper === "ETC/UTC" || upper === "ETC/GMT" ||
    upper === "GMT";
}

/** "Sat 19 Dec 2026, 11:59 pm Lagos time"; "… UTC" with no zone. */
export function ariLocalInstant(
  iso: string,
  zone: string | null,
): string | null {
  if (!ISO_INSTANT.test(iso)) return null;
  return formatInstant(iso, isUtcZone(zone) ? null : zone);
}

/**
 * A copy of a tool result with `<key>_local` beside every ISO instant field.
 * Arrays and nested objects are walked; existing `_local` keys are kept.
 */
export function withAriLocalTimes(
  value: unknown,
  zone: string | null,
  depth = 0,
): unknown {
  if (depth > MAX_DEPTH || value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => withAriLocalTimes(item, zone, depth + 1));
  }
  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    out[key] = withAriLocalTimes(raw, zone, depth + 1);
    if (typeof raw !== "string") continue;
    const localKey = `${key}_local`;
    if (localKey in (value as Record<string, unknown>)) continue;
    const local = ariLocalInstant(raw, zone);
    if (local) out[localKey] = local;
  }
  return out;
}

/** Running text with "(<local>)" after every ISO instant. */
export function withAriLocalTimesInText(
  text: string,
  zone: string | null,
): string {
  return text.replace(ISO_INSTANT_IN_TEXT, (iso) => {
    const local = ariLocalInstant(iso, zone);
    return local ? `${iso} (${local})` : iso;
  });
}

/**
 * #3355 rework 7 (R7-17): running text with every ISO instant REPLACED by its
 * brand-local rendering. For text only the model reads (the brand
 * snapshot): with "2026-12-05T10:00:00.000Z (Sat 5 Dec 2026, 11:00 am Lagos
 * time)" side by side, a model said "10:00 AM (Lagos time)"; with the local
 * rendering alone there is one hour to repeat.
 */
export function withAriLocalTimesOnlyInText(
  text: string,
  zone: string | null,
): string {
  return text.replace(
    ISO_INSTANT_IN_TEXT,
    (iso) => ariLocalInstant(iso, zone) ?? iso,
  );
}

interface ModelPart {
  functionResponse?: { name: string; response: Record<string, unknown> };
  [key: string]: unknown;
}

/**
 * The model's input with every functionResponse carrying brand-local times.
 * Text and functionCall parts are unchanged (the brand snapshot is rendered
 * where it is built). Generic so each caller keeps its own content type.
 */
export function withAriLocalTimesForModel<
  T extends { role: string; parts: ReadonlyArray<unknown> },
>(contents: readonly T[], zone: string | null): T[] {
  return contents.map((message) => {
    let changed = false;
    const parts = message.parts.map((part) => {
      const typed = part as ModelPart;
      if (!typed || typeof typed !== "object" || !typed.functionResponse) {
        return part;
      }
      changed = true;
      return {
        ...typed,
        functionResponse: {
          ...typed.functionResponse,
          response: withAriLocalTimes(
            typed.functionResponse.response,
            zone,
          ) as Record<string, unknown>,
        },
      };
    });
    return changed ? { ...message, parts } as T : message;
  });
}
