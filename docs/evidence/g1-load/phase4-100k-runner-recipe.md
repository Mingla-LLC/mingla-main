# G1 Phase 4 — 100k VU runner recipe (#426)

**Status:** Engineering recipe (required before the headline run).  
**Why this file exists:** [`scripts/load/run-distributed.sh`](../../../scripts/load/run-distributed.sh) uses local k6 execution segments. One laptop cannot sustain 100k VUs.

## Preconditions

1. Public offering harness green at Phase 2–3 (1k / 10k) against staging.
2. `LOAD_HOST_WEB_ORIGIN` points at a Host deploy that includes:
   - `/api/event-checkout-bundle` (#2879)
   - `/api/trip-checkout-bundle` (#426)
   - `/api/experience-checkout-bundle` (#426)
3. Staging fixtures set in `scripts/load/fixtures/.env.load` (see [`docs/load-test-fixtures.md`](../../load-test-fixtures.md)).
4. Prefer **native k6** (not Docker) on each worker host.

## Option A — Multi-host execution segments (preferred, no k6 Cloud)

Total VUs = `WORKERS × VUS_PER_WORKER`. For 100k:

| Hosts | Workers/host | VUs/worker | Total |
|-------|--------------|------------|-------|
| 10 | 1 | 10_000 | 100_000 |
| 20 | 1 | 5_000 | 100_000 |
| 4 | 1 | 25_000 | 100_000 (needs large machines) |

On each host `i` of `N` (0-indexed):

```bash
source scripts/load/fixtures/.env.load
export LOAD_VUS=10000
export LOAD_DURATION=5m
export LOAD_RAMP_DURATION=2m

k6 run \
  --execution-segment "${i}/${N}:$((i+1))/${N}" \
  --summary-export "docs/evidence/g1-load/reports/$(date -u +%Y%m%dT%H%M%SZ)-public-offering-fanout-seg${i}of${N}-vus${LOAD_VUS}.json" \
  scripts/load/public-offering-fanout.js
```

Coordinate clock skew (±5s) so ramps overlap. Aggregate: every segment must meet addendum SLOs (avail ≥99%, p95 &lt; 5s at 10k-equivalent; at 100k origin RPS must stay flat vs a warm 1k baseline).

## Option B — k6 Cloud

```bash
k6 cloud run scripts/load/public-offering-fanout.js \
  -e LOAD_HOST_WEB_ORIGIN=... \
  -e SUPABASE_ANON_KEY=... \
  -e LOAD_BASE_URL=... \
  -e LOAD_TEST_BRAND_SLUG=... \
  -e LOAD_TEST_EVENT_SLUG=... \
  -e LOAD_TEST_TRIP_SLUG=... \
  -e LOAD_TEST_EXPERIENCE_SLUG=...
```

Configure cloud project VUs = 100000, same thresholds as the script.

## Pass criteria (public path — closes G1 under 1A)

- Cache hit-rate ≥90% on repeat-slug Host bundle traffic (`x-vercel-cache: HIT` dominant).
- Origin (Supabase RPC) request volume stays flat as VUs scale from 1k → 100k.
- Discover-merged-events remains **platform-limited** (see existing Phase 2/3 reports); not a G1 close blocker once this public path is green.

## Static CDN verification (do before Phase 4)

```bash
# Immutable hashed assets
curl -sI "https://host.usemingla.com/_expo/static/js/web/<chunk>.js" | tr -d '\r' | grep -i cache-control
# Expect: public, max-age=31536000, immutable  (see mingla-business/vercel.json)

# Event data bundle
curl -sI "https://host.usemingla.com/api/event-checkout-bundle?brandSlug=<slug>&eventSlug=<slug>" \
  | tr -d '\r' | grep -iE 'cache-control|x-vercel-cache'
# Expect: s-maxage=5 ; second request ideally x-vercel-cache: HIT
```

Do **not** expect CDN caching on `/api/public-event` SEO HTML (#2986 `no-store`).
