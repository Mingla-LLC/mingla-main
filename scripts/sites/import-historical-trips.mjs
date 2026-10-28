#!/usr/bin/env node
/**
 * #2829 W5 (amendment A1.3) — import a brand's pre-Mingla trips as ENDED Mingla
 * trips (real past dates, never bookable), then its reviews into the site's
 * Testimonials (see mingla-site-cms/scripts/import-testimonials.ts).
 *
 * This script does the Mingla (Core) half: one call per trip to the
 * service-role-only RPC `brand_site_import_historical_trip`, which refuses
 * anything that has not ended in the trip's own timezone and never touches
 * normal trip creation. Re-running is safe: a record already imported (same
 * `import_key`) returns the trip created the first time.
 *
 * Usage:
 *   node scripts/sites/import-historical-trips.mjs --file <records.json> --target local [--apply] [--out <mapping.json>]
 *   node scripts/sites/import-historical-trips.mjs --file <records.json> --target production \
 *        --apply --confirm-production-import <brand_id>      (Seth-owned step, after merge)
 *
 * Without --apply it only checks the file and prints what it would do.
 * Environment: MINGLA_CORE_URL, MINGLA_CORE_SERVICE_ROLE_KEY (never printed).
 * The records file holds a brand's real history and is NEVER committed: keep it
 * private (for example ~/.mingla-private/<issue>/). The committed example
 * (scripts/sites/local/fixtures/historical-import.neutral.json) is invented.
 *
 * File shape:
 *   { "brand_id": "<uuid>",
 *     "trips":   [{ "import_key", "title", "start_date": "YYYY-MM-DD", "end_date"?, "timezone",
 *                   "location"?, "description"?, "series"?, "source_note" }],
 *     "reviews": [{ "quote", "reviewer", "review_date": "YYYY-MM-DD", "trip_name"?, "trip_import_key"?,
 *                   "source_note", "confirmed_real": true|false }] }
 */
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export const PRODUCTION_CORE_URL = "https://gqnoajqerqhnvulmnyvv.supabase.co";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEY_RE = /^[a-z0-9][a-z0-9._:-]{0,79}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function isDay(value) {
  if (typeof value !== "string" || !DAY_RE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isZone(value) {
  if (typeof value !== "string" || value.length > 60) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function localToday(zone, now) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

const text = (value, max, required = false) =>
  value === undefined || value === null ? !required : typeof value === "string" && value.trim().length > 0 && value.trim().length <= max;

/** Every problem in the records file, in plain words (empty = importable). */
export function recordProblems(records, now = new Date()) {
  const problems = [];
  if (!records || typeof records !== "object" || Array.isArray(records)) return ["The file is not a JSON object."];
  if (typeof records.brand_id !== "string" || !UUID_RE.test(records.brand_id)) problems.push("brand_id must be the brand's Mingla id.");
  const trips = Array.isArray(records.trips) ? records.trips : null;
  const reviews = records.reviews === undefined ? [] : Array.isArray(records.reviews) ? records.reviews : null;
  if (!trips) problems.push("trips must be a list.");
  if (!reviews) problems.push("reviews must be a list when present.");
  const keys = new Set();
  (trips ?? []).forEach((trip, index) => {
    const at = `trips[${index}]`;
    if (!trip || typeof trip !== "object") return problems.push(`${at} is not an object.`);
    const key = typeof trip.import_key === "string" ? trip.import_key.trim().toLowerCase() : "";
    if (!KEY_RE.test(key)) problems.push(`${at}.import_key must be a short lowercase key.`);
    else if (keys.has(key)) problems.push(`${at}.import_key "${key}" is used twice.`);
    keys.add(key);
    if (!text(trip.title, 200, true)) problems.push(`${at}.title is required (up to 200 characters).`);
    if (!isDay(trip.start_date)) problems.push(`${at}.start_date must be a real day, YYYY-MM-DD.`);
    if (trip.end_date !== undefined && trip.end_date !== null && (!isDay(trip.end_date) || trip.end_date < trip.start_date)) {
      problems.push(`${at}.end_date must be a real day on or after start_date.`);
    }
    if (!isZone(trip.timezone)) problems.push(`${at}.timezone must be a time zone name, for example America/New_York.`);
    else if (isDay(trip.start_date) && (trip.end_date ?? trip.start_date) >= localToday(trip.timezone, now)) {
      problems.push(`${at} has not ended yet in ${trip.timezone}; only finished trips are history.`);
    }
    if (!text(trip.location, 200)) problems.push(`${at}.location is too long.`);
    if (!text(trip.description, 4000)) problems.push(`${at}.description is too long.`);
    if (!text(trip.series, 80)) problems.push(`${at}.series is too long.`);
    if (!text(trip.source_note, 500, true)) problems.push(`${at}.source_note is required: say where this record comes from.`);
  });
  (reviews ?? []).forEach((review, index) => {
    const at = `reviews[${index}]`;
    if (!review || typeof review !== "object") return problems.push(`${at} is not an object.`);
    if (!text(review.quote, 1200, true)) problems.push(`${at}.quote is required (up to 1200 characters), word for word.`);
    if (!text(review.reviewer, 80, true)) problems.push(`${at}.reviewer is required.`);
    if (!isDay(review.review_date)) problems.push(`${at}.review_date must be a real day, YYYY-MM-DD.`);
    if (!text(review.trip_name, 120)) problems.push(`${at}.trip_name is too long.`);
    if (review.trip_import_key !== undefined && !keys.has(String(review.trip_import_key).trim().toLowerCase())) {
      problems.push(`${at}.trip_import_key does not name a trip in this file.`);
    }
    if (!text(review.source_note, 500, true)) problems.push(`${at}.source_note is required.`);
    if (typeof review.confirmed_real !== "boolean") problems.push(`${at}.confirmed_real must be true or false (only true is ever published).`);
  });
  return problems;
}

/** Where the import may write, and what it must be told before it does. */
export function targetProblems({ target, apply, confirm, coreUrl, brandId }) {
  if (target !== "local" && target !== "production") return ["--target must be local or production."];
  let url;
  try {
    url = new URL(coreUrl ?? "");
  } catch {
    return ["MINGLA_CORE_URL is not a URL."];
  }
  if (target === "local") {
    const loopback = url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost");
    return loopback ? [] : ["--target local needs a loopback MINGLA_CORE_URL (the local stack)."];
  }
  if (url.origin !== PRODUCTION_CORE_URL) return ["--target production needs the production Core URL."];
  if (apply && confirm !== brandId) return ["A production import needs --confirm-production-import <brand_id> (Seth-approved, after merge)."];
  return [];
}

/** Trips sharing a `series` name → the Mingla trip ids for the "Trips we've run" block. */
export function seriesGroups(trips, mapping) {
  const groups = new Map();
  for (const trip of trips) {
    const label = typeof trip.series === "string" ? trip.series.trim() : "";
    const id = mapping[String(trip.import_key).trim().toLowerCase()]?.event_id;
    if (!label || !id) continue;
    groups.set(label, [...(groups.get(label) ?? []), id]);
  }
  return [...groups.entries()].filter(([, ids]) => ids.length >= 2).map(([label, ids]) => ({ label, offering_ids: ids }));
}

function args(argv) {
  const out = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--apply") out.apply = true;
    else if (flag.startsWith("--")) out[flag.slice(2)] = argv[(index += 1)];
  }
  return out;
}

async function importTrip(coreUrl, serviceKey, brandId, trip) {
  const response = await fetch(`${coreUrl}/rest/v1/rpc/brand_site_import_historical_trip`, {
    method: "POST",
    headers: { "content-type": "application/json", apikey: serviceKey, authorization: `Bearer ${serviceKey}` },
    body: JSON.stringify({
      p_brand_id: brandId,
      p_import_key: String(trip.import_key).trim().toLowerCase(),
      p_title: trip.title,
      p_start_date: trip.start_date,
      p_end_date: trip.end_date ?? null,
      p_timezone: trip.timezone,
      p_location: trip.location ?? null,
      p_description: trip.description ?? null,
      p_source_note: trip.source_note,
    }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.event_id) {
    throw new Error(`Mingla refused "${trip.import_key}": ${body?.message ?? response.status}`);
  }
  return body;
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const options = args(argv);
  if (!options.file) throw new Error("Pass --file <records.json>.");
  const records = JSON.parse(await readFile(options.file, "utf8"));
  const problems = [
    ...recordProblems(records),
    ...targetProblems({ target: options.target, apply: options.apply === true, confirm: options["confirm-production-import"], coreUrl: env.MINGLA_CORE_URL, brandId: records?.brand_id }),
  ];
  if (problems.length) {
    console.error(problems.map((problem) => `- ${problem}`).join("\n"));
    return 1;
  }
  console.log(`${records.trips.length} trip(s) and ${records.reviews?.length ?? 0} review(s) check out for brand ${records.brand_id} (${options.target}).`);
  if (!options.apply) {
    console.log("Dry run: nothing written. Add --apply to import.");
    return 0;
  }
  const serviceKey = env.MINGLA_CORE_SERVICE_ROLE_KEY;
  if (!serviceKey) throw new Error("MINGLA_CORE_SERVICE_ROLE_KEY is not set.");
  const mapping = {};
  for (const trip of records.trips) {
    const result = await importTrip(env.MINGLA_CORE_URL.replace(/\/$/, ""), serviceKey, records.brand_id, trip);
    mapping[String(trip.import_key).trim().toLowerCase()] = { event_id: result.event_id, status: result.status, slug: result.slug ?? null };
    console.log(`  ${result.status.padEnd(8)} ${trip.import_key} -> ${result.event_id}`);
  }
  const output = { brand_id: records.brand_id, trips: mapping, series: seriesGroups(records.trips, mapping) };
  if (options.out) {
    await writeFile(options.out, `${JSON.stringify(output, null, 2)}\n`, { mode: 0o600 });
    console.log(`Mapping written to ${options.out} (for the reviews import and the "Trips we've run" runs).`);
  }
  if (output.series.length) {
    console.log("Runs to set on the \"Trips we've run\" block:");
    for (const group of output.series) console.log(`  ${group.label}: ${group.offering_ids.join(", ")}`);
  }
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().then((code) => process.exit(code), (error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
