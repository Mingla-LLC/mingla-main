/**
 * ORCH-1118 [trip from/destination fields must be Mapbox-validated addresses]
 *
 * ONE-TIME, OPERATOR-GATED backfill of the existing dirty trip rows: trips whose
 * `theme.business_trip.{destination,departure}LocationText` is populated but whose
 * matching `*PlaceId`/`*Lat`/`*Lng` are null (free-typed before this ORCH gated
 * the picker). It confidence-gated forward-geocodes each dirty text value via
 * Mapbox Search Box and writes coords ONLY for an unambiguous, high-confidence
 * single/top match. Ambiguous / low-confidence / no-match rows are LEFT NULL and
 * listed in `Mingla_Artifacts/reports/ORCH-1118_BACKFILL_FLAGGED.md` for manual
 * review. It is idempotent — rows that already have coords are skipped, so a
 * second run writes nothing new.
 *
 * SAFETY: DRY-RUN by default — it prints WOULD-WRITE vs FLAGGED and refreshes the
 * flagged report, but performs NO database write. The LIVE write run is Seth's
 * call (it mutates production); pass `--live` to execute it. The implementor only
 * dry-runs this. Do NOT run --live without operator approval (SPEC §4.5).
 *
 * Env required:
 *   SUPABASE_URL                  e.g. https://gqnoajqerqhnvulmnyvv.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY     service-role key (REST read + write)
 *   MAPBOX_ACCESS_TOKEN           Mapbox Search Box token (forward geocode)
 *
 * Run (dry-run):  npx tsx scripts/orch-1118-backfill-trip-coords.ts
 * Run (live):     npx tsx scripts/orch-1118-backfill-trip-coords.ts --live   (operator only)
 *
 * NOT a migration (a SQL migration cannot call Mapbox); NOT part of deploy/CI.
 */

import { writeFileSync } from "fs";
import path from "path";

const LIVE = process.argv.includes("--live");
const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const MAPBOX_TOKEN = process.env.MAPBOX_ACCESS_TOKEN ?? "";

const FLAGGED_REPORT = path.join(
  process.cwd(),
  "Mingla_Artifacts/reports/ORCH-1118_BACKFILL_FLAGGED.md",
);

type Side = "destination" | "departure";

interface TripRow {
  id: string;
  status: string;
  theme: { business_trip?: Record<string, unknown> } | null;
}

interface MapboxFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: {
    mapbox_id?: string;
    full_address?: string;
    name?: string;
    feature_type?: string;
    coordinates?: { latitude?: number; longitude?: number };
    context?: { place?: { name?: string } };
    match_code?: { confidence?: string };
  };
}

interface Confident {
  ok: true;
  placeId: string;
  lat: number;
  lng: number;
  formattedAddress: string;
}
interface Rejected {
  ok: false;
  reason: string;
}

export const SETTLEMENT_TYPES = new Set([
  "place",
  "region",
  "locality",
  "country",
  "district",
  "city",
]);

function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function featureLatLng(f: MapboxFeature): { lat: number; lng: number } | null {
  const c = f.geometry?.coordinates;
  if (Array.isArray(c) && c.length === 2) return { lat: c[1], lng: c[0] };
  const p = f.properties?.coordinates;
  if (typeof p?.latitude === "number" && typeof p?.longitude === "number") {
    return { lat: p.latitude, lng: p.longitude };
  }
  return null;
}

/**
 * Confidence gate (CRITICAL SAFETY — do NOT guess). Accept ONLY when:
 *  - top feature is a settlement/area (feature_type in SETTLEMENT_TYPES), AND
 *  - top result match_code.confidence is "exact" or "high", AND
 *  - the second result (if any) is a clearly different place (>25km away) — no near-tie.
 * Anything else → ambiguous, REJECT (leave null + flag).
 */
export function evaluate(features: MapboxFeature[]): Confident | Rejected {
  const top = features[0];
  if (!top) return { ok: false, reason: "no-match" };

  const ftype = top.properties?.feature_type ?? "";
  if (!SETTLEMENT_TYPES.has(ftype)) {
    return { ok: false, reason: `non-settlement feature_type="${ftype}"` };
  }

  const conf = top.properties?.match_code?.confidence ?? "";
  if (conf !== "exact" && conf !== "high") {
    return { ok: false, reason: `low confidence="${conf || "absent"}"` };
  }

  const topLoc = featureLatLng(top);
  if (!topLoc) return { ok: false, reason: "no-coordinates-on-top-feature" };

  const second = features[1];
  if (second) {
    const secLoc = featureLatLng(second);
    if (secLoc && haversineKm(topLoc, secLoc) <= 25) {
      return {
        ok: false,
        reason: `near-tie: 2nd result ${haversineKm(topLoc, secLoc).toFixed(1)}km from top`,
      };
    }
  }

  const placeId = top.properties?.mapbox_id ?? "";
  if (placeId.length === 0) return { ok: false, reason: "no-mapbox_id" };

  return {
    ok: true,
    placeId,
    lat: topLoc.lat,
    lng: topLoc.lng,
    formattedAddress:
      top.properties?.full_address ?? top.properties?.name ?? "",
  };
}

async function forwardGeocode(query: string): Promise<MapboxFeature[]> {
  const url =
    "https://api.mapbox.com/search/searchbox/v1/forward" +
    `?q=${encodeURIComponent(query)}` +
    `&access_token=${encodeURIComponent(MAPBOX_TOKEN)}` +
    "&limit=5";
  const res = await fetch(url, { method: "GET" });
  if (!res.ok) throw new Error(`mapbox_${res.status}`);
  const data = (await res.json()) as { features?: MapboxFeature[] };
  return data.features ?? [];
}

async function fetchCandidateTrips(): Promise<TripRow[]> {
  // REST select: trip events, not deleted, that carry a business_trip theme.
  const url =
    `${SUPABASE_URL}/rest/v1/events` +
    "?select=id,status,theme&event_type=eq.trip&deleted_at=is.null";
  const res = await fetch(url, {
    headers: {
      apikey: SERVICE_ROLE,
      Authorization: `Bearer ${SERVICE_ROLE}`,
    },
  });
  if (!res.ok) throw new Error(`supabase_select_${res.status}`);
  return (await res.json()) as TripRow[];
}

async function writeCoords(
  id: string,
  bt: Record<string, unknown>,
): Promise<void> {
  // PATCH the whole theme.business_trip (merged client-side already). The
  // ORCH-1016 trigger syncs departure coords → events.departure_text/geo on write.
  const url = `${SUPABASE_URL}/rest/v1/events?id=eq.${id}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      apikey: SERVICE_ROLE,
      Authorization: `Bearer ${SERVICE_ROLE}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({ theme: { business_trip: bt } }),
  });
  if (!res.ok) throw new Error(`supabase_patch_${res.status}`);
}

export function isDirty(bt: Record<string, unknown>, side: Side): boolean {
  const text = bt[`${side}LocationText`];
  const placeId = bt[`${side}PlaceId`];
  const lat = bt[`${side}Lat`];
  const lng = bt[`${side}Lng`];
  const hasText = typeof text === "string" && text.trim().length > 0;
  const hasCoords = placeId != null && lat != null && lng != null;
  return hasText && !hasCoords;
}

interface FlaggedEntry {
  id: string;
  status: string;
  side: Side;
  text: string;
  reason: string;
}

async function main(): Promise<void> {
  if (!SUPABASE_URL || !SERVICE_ROLE || !MAPBOX_TOKEN) {
    console.error(
      "[orch-1118-backfill] missing env: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / MAPBOX_ACCESS_TOKEN",
    );
    process.exit(1);
  }

  console.log(
    `[orch-1118-backfill] mode=${LIVE ? "LIVE (writing)" : "DRY-RUN (no writes)"}`,
  );

  const trips = await fetchCandidateTrips();
  let scanned = 0;
  let alreadyHadCoords = 0;
  let backfilled = 0;
  const flagged: FlaggedEntry[] = [];

  for (const trip of trips) {
    const btOriginal = trip.theme?.business_trip;
    if (!btOriginal) continue;
    scanned += 1;

    const bt: Record<string, unknown> = { ...btOriginal };
    let mutated = false;

    for (const side of ["destination", "departure"] as Side[]) {
      const text = bt[`${side}LocationText`];
      if (typeof text !== "string" || text.trim().length === 0) continue;
      // Idempotency: a row that already has coords is skipped (no re-geocode).
      if (!isDirty(bt, side)) {
        alreadyHadCoords += 1;
        continue;
      }

      let verdict: Confident | Rejected;
      try {
        const features = await forwardGeocode(text);
        verdict = evaluate(features);
      } catch (e) {
        verdict = {
          ok: false,
          reason: `geocode-error: ${(e as Error).message}`,
        };
      }

      if (verdict.ok) {
        bt[`${side}PlaceId`] = verdict.placeId;
        bt[`${side}Lat`] = verdict.lat;
        bt[`${side}Lng`] = verdict.lng;
        bt[`${side}LocationText`] = verdict.formattedAddress || text;
        mutated = true;
        backfilled += 1;
        console.log(
          `  [WOULD-WRITE${LIVE ? " → WRITING" : ""}] ${trip.id} ${side}="${text}" → ${verdict.placeId} (${verdict.lat},${verdict.lng})`,
        );
      } else {
        flagged.push({
          id: trip.id,
          status: trip.status,
          side,
          text,
          reason: verdict.reason,
        });
        console.log(
          `  [FLAGGED] ${trip.id} ${side}="${text}" — ${verdict.reason}`,
        );
      }
    }

    if (mutated && LIVE) {
      await writeCoords(trip.id, bt);
    }
  }

  // Refresh the flagged report (always — it is the script's manual-review output).
  const reportLines = [
    "# ORCH-1118 — Backfill flagged rows (manual review)",
    "",
    `Generated: ${new Date().toISOString()} · mode=${LIVE ? "LIVE" : "DRY-RUN"}`,
    "",
    "These trip rows had free-typed departure/destination text that did NOT pass",
    "the confidence gate (ambiguous / low-confidence / no-match). Coordinates were",
    "LEFT NULL. They display their text as before (no regression) and will be fixed",
    "when the planner next re-edits the trip (now gated by the Mapbox picker).",
    "",
    "| event id | status | side | text | reason |",
    "|----------|--------|------|------|--------|",
    ...flagged.map(
      (f) =>
        `| ${f.id} | ${f.status} | ${f.side} | ${f.text.replace(/\|/g, "\\|")} | ${f.reason} |`,
    ),
    "",
    flagged.length === 0 ? "_No flagged rows._" : "",
  ];
  writeFileSync(FLAGGED_REPORT, reportLines.join("\n"), "utf8");

  console.log("");
  console.log(
    `[orch-1118-backfill] scanned=${scanned} alreadyHadCoords(skipped)=${alreadyHadCoords} backfilled=${backfilled} flagged=${flagged.length}`,
  );
  console.log(`[orch-1118-backfill] flagged report → ${FLAGGED_REPORT}`);
  if (!LIVE) {
    console.log(
      "[orch-1118-backfill] DRY-RUN complete — NO database writes performed. Re-run with --live (operator-gated) to apply.",
    );
  }
}

// Run only as a CLI (not when imported by the dry-run verification harness).
const invokedDirectly =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  /orch-1118-backfill-trip-coords/.test(process.argv[1] ?? "");
if (invokedDirectly) {
  main().catch((e) => {
    console.error("[orch-1118-backfill] fatal:", e);
    process.exit(1);
  });
}
