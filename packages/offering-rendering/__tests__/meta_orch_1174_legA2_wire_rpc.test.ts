// META-ORCH-1174 Leg A.2 [wire-rpc] — implementor-owned single-source-read
// regression (the established offering-rendering deno-readfile style). These
// assertions FAIL-ON-REVERT of the read-path swap:
//   §1 — BOTH the business/web hook (usePublicTripBySlug) AND the consumer hook
//        (useConsumerTripDetail) read the ONE canonical anon RPC
//        `pg_public_trip_by_slug` (Seth single-source decision).
//   §2 — NEITHER hook reads `brands` / `tickets` directly anymore (the anon-safe
//        single-source path; the prior brands-theme / view detour is retired on
//        the trip path — closing the #507 column-grant surface).
//   §3 — the CONSUMER gap is closed: useConsumerTripDetail now carries
//        destinationLat/Lng (so the §11 map renders) + per-tier ticketsRemaining,
//        and the consumer adapter (useConsumerTripOfferingData) maps them through
//        to the shared TripOfferingData (no longer hardcoded null).
//   §4 — the RPC migration exists and emits destination lat/lng + per-tier
//        remaining (the payload that makes §3 possible on every surface).

import {
  assert,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

const read = async (rel: string): Promise<string> =>
  await Deno.readTextFile(new URL(rel, import.meta.url));

const bizHook = await read(
  "../../../mingla-business/src/hooks/usePublicTripBySlug.ts",
);
const consumerHook = await read(
  "../../../app-mobile/src/hooks/useConsumerTripDetail.ts",
);
const consumerAdapter = await read(
  "../../../app-mobile/src/hooks/useConsumerTripOfferingData.ts",
);
const migration = await read(
  "../../../supabase/migrations/20261017000000_meta_orch_1174_pg_public_trip_by_slug.sql",
);

// strip JSDoc + line comments so prose mentioning a retired pattern (e.g. a
// comment saying "NEVER .from('brands')") never false-positives an ACTIVE-code
// assertion below.
const activeCode = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const bizCode = activeCode(bizHook);
const consumerCode = activeCode(consumerHook);

// ── §1 — both hooks read the ONE canonical RPC ──
Deno.test("§1 BOTH trip read hooks call pg_public_trip_by_slug (single source)", () => {
  assert(
    /supabase\.rpc\(\s*["']pg_public_trip_by_slug["']/.test(bizCode),
    "business/web usePublicTripBySlug must read the canonical RPC",
  );
  assert(
    /supabase\.rpc\(\s*["']pg_public_trip_by_slug["']/.test(consumerCode),
    "consumer useConsumerTripDetail must read the canonical RPC",
  );
});

// ── §2 — neither hook reads brands/tickets directly (anon-safe single source) ──
Deno.test("§2 neither trip hook reads brands/tickets directly (single-source, #507 surface closed)", () => {
  for (const [name, code] of [
    ["usePublicTripBySlug", bizCode],
    ["useConsumerTripDetail", consumerCode],
  ] as const) {
    assert(
      !/\.from\(\s*["']brands["']\s*\)/.test(code),
      `${name} must make ZERO direct brands read (theme rides the definer RPC)`,
    );
    assert(
      !/\.from\(\s*["']tickets["']\s*\)/.test(code),
      `${name} must make ZERO direct tickets read`,
    );
  }
  // the prior business_public_events_view theme detour is retired on this path.
  assert(
    !bizCode.includes("business_public_events_view"),
    "the trip hook no longer needs the business_public_events_view theme detour",
  );
});

// ── §3 — the CONSUMER gap is closed (destination lat/lng + per-tier remaining) ──
Deno.test("§3 the consumer read now carries destination lat/lng + per-tier remaining", () => {
  // the ConsumerTripDetail type gained destinationLat/Lng + per-tier ticketsRemaining.
  assertStringIncludes(consumerHook, "destinationLat: number | null");
  assertStringIncludes(consumerHook, "destinationLng: number | null");
  assertStringIncludes(consumerHook, "ticketsRemaining: number | null");
  // the consumer hook MAPS the RPC lat/lng (no longer absent).
  assert(
    /destinationLat:\s*numOrNull\(p\.destinationLat\)/.test(consumerCode),
    "consumer hook must map the RPC destinationLat",
  );
  assert(
    /destinationLng:\s*numOrNull\(p\.destinationLng\)/.test(consumerCode),
    "consumer hook must map the RPC destinationLng",
  );
});

Deno.test("§3 the consumer adapter passes lat/lng + per-tier remaining to the shared body (no hardcoded null)", () => {
  const adapterCode = activeCode(consumerAdapter);
  // the §11 map coords are threaded from the detail (was `destinationLat: null`).
  assert(
    /destinationLat:\s*detail\.destinationLat/.test(adapterCode),
    "the consumer adapter must pass detail.destinationLat to TripOfferingData (§11 map gap closed)",
  );
  assert(
    /destinationLng:\s*detail\.destinationLng/.test(adapterCode),
    "the consumer adapter must pass detail.destinationLng to TripOfferingData",
  );
  // per-tier remaining is threaded (was `ticketsRemaining: null`).
  assert(
    /ticketsRemaining:\s*t\.isUnlimited\s*\?\s*null\s*:\s*t\.ticketsRemaining/.test(
      adapterCode,
    ),
    "the consumer adapter must pass real per-tier ticketsRemaining (no fabricated sold-out)",
  );
});

// ── §4 — the RPC payload makes §3 possible on every surface ──
Deno.test("§4 the RPC migration emits destination lat/lng + per-tier remaining", () => {
  assertStringIncludes(migration, "pg_public_trip_by_slug");
  assertStringIncludes(migration, "'destinationLat'");
  assertStringIncludes(migration, "'destinationLng'");
  assertStringIncludes(migration, "'ticketsRemaining'");
  // restricted to published trips only (no draft leakage).
  assert(
    /e\.event_type\s*=\s*'trip'/.test(migration),
    "the RPC must restrict to event_type='trip'",
  );
});
