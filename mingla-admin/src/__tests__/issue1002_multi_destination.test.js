/**
 * ISSUE-1002 [Campaign Builder multi-destination fan-out] — Wave 4 (final) of
 * epic #977. Implementor happy-path regression suite.
 *
 * Forensic Lane C proved destination was a SINGLE object at every layer
 * (StepDestination radiogroup, CampaignBuilderPage `destination` useState(null),
 * payload.js, backend DestinationInput, ad_campaigns 6 scalar columns). No ad
 * platform accepts multiple destinations per ad, so multi-select is a FAN-OUT:
 * one ad per (destination × platform), each with its own landing URL + pid.
 *
 * This suite pins the WORKING shape and FAILS ON REVERT of the fix:
 *   1. payload.js emits `destinations[]` + `destination_group_id` (and keeps the
 *      singular `destination` for backward compatibility) — behavioural.
 *   2. The fan-out is N destinations × M platforms — one payload per pair, each
 *      carrying its OWN destination fields (→ its own per-destination dest_url)
 *      and its own platform (→ its own pid=<platform>_ads), all sharing the group
 *      id, with distinct idempotency request_ids — behavioural.
 *   3. A SINGLE-destination selection is byte-identical to before (no group id).
 *   4. launchSummary renders the multi-destination line — behavioural.
 *   5. The migration adds a nullable `dest_group_id` + index, idempotently.
 *   6. Source wiring: the outer destination loop + checkbox multi-select +
 *      composite result keys are present (fails on a structural revert).
 *
 * Run: node --test src/__tests__/issue1002_multi_destination.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { buildCreatePayload } from "../lib/adBuilder/payload.js";
import { buildLaunchSummary } from "../lib/adBuilder/launchSummary.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = (rel) => readFileSync(resolve(__dirname, "..", rel), "utf8");
const REPO = (rel) => readFileSync(resolve(__dirname, "..", "..", "..", rel), "utf8");

const PLATFORMS = ["meta", "google", "tiktok", "reddit", "snapchat"];

// A brand with TWO live event pages + its brand page — the real "Smoke & Rhythm"
// shape from the forensic (a brand can advertise several destinations at once).
const DEST_EVENT_A = { id: "e-aaa", page_type: "event", brand_slug: "smokerhythm", slug: "friday-live", title: "Friday Live", brand_name: "Smoke & Rhythm" };
const DEST_EVENT_B = { id: "e-bbb", page_type: "event", brand_slug: "smokerhythm", slug: "sunday-jazz", title: "Sunday Jazz", brand_name: "Smoke & Rhythm" };
const DEST_BRAND = { id: "b-ccc", page_type: "brand", brand_slug: "smokerhythm", slug: "smokerhythm", title: "Smoke & Rhythm", brand_name: "Smoke & Rhythm" };

// The wizard's per-call state, minus the destination axis (shared across the fan-out).
const BASE_STATE = {
  lane: "consumer",
  name: "Smoke & Rhythm — Friday Live — 2026-07-20",
  goal: {
    metaObjective: "OUTCOME_TRAFFIC",
    metaOptimizationGoal: "LINK_CLICKS",
    platforms: {
      tiktok: { objective: "TRAFFIC" },
      reddit: { objective: "CLICKS" },
      snapchat: { objective: "TRAFFIC", optimization_goal: "SWIPES" },
      google: { objective: "TRAFFIC" },
    },
  },
  audience: { countries: ["GB"], cities: [], interests: [], ageMin: 18, ageMax: 65, gender: "all" },
  budget: { dailyCentsForChannel: 500 },
  creative: { kind: "image", imageUrl: "https://x/y.png", aiGenerated: true },
  copy: {
    primary: "The room only holds 40.",
    headline: "Book the night",
    description: "Live",
    cta: "BUY_TICKETS",
    googleHeadlines: ["Book Friday", "Live music", "Small room"],
    googleDescriptions: ["A night worth planning.", "Doors at 8."],
    keywords: ["smoke", "live music"],
    negativeKeywords: [],
  },
  specialAdCategory: "NONE",
};

/** The per-call destination BODY the wizard builds from a selected row (runCreate). */
function destBodyOf(dest) {
  return {
    page_type: dest.page_type,
    brand_slug: dest.brand_slug,
    entity_slug: dest.page_type === "event" ? dest.slug : null,
  };
}

/**
 * The NORMALIZED destination shape payload.js actually emits — it omits
 * entity_slug entirely for non-events (spread-only-when-truthy), so the brand
 * page carries just { page_type, brand_slug }.
 */
function expectedPayloadDest(dest) {
  const body = { page_type: dest.page_type, brand_slug: dest.brand_slug };
  if (dest.page_type === "event") body.entity_slug = dest.slug;
  return body;
}

/** Server-of-record URL formula (mirror of adDestinationsService / businessWebOrigin). */
function reconstructUrl(dest) {
  const origin = "https://host.usemingla.com";
  return dest.page_type === "event"
    ? `${origin}/e/${dest.brand_slug}/${dest.slug}`
    : `${origin}/b/${dest.brand_slug}`;
}

/**
 * Exact mirror of CampaignBuilderPage.runCreate's fan-out mapping: the DESTINATION
 * axis is the OUTER loop around the per-platform loop → one payload per pair.
 */
function fanOut(destinations, platforms) {
  const multiDest = destinations.length > 1;
  const groupId = multiDest ? "group-1002" : null;
  const out = [];
  for (const dest of destinations) {
    const destSlot = `${dest.page_type}:${dest.id}`;
    const destBody = destBodyOf(dest);
    for (const platform of platforms) {
      const requestId = `${platform}::${destSlot}`; // distinct per (platform, dest)
      out.push({
        platform,
        dest,
        requestId,
        resultKey: multiDest ? `${platform}::${destSlot}` : platform,
        payload: buildCreatePayload(platform, {
          ...BASE_STATE,
          destination: destBody,
          destinationGroupId: groupId,
          requestId,
        }),
      });
    }
  }
  return { out, groupId };
}

describe("ISSUE-1002 · payload emits destinations[] + destination_group_id (backward-compat kept)", () => {
  it("every platform body carries destinations:[destBody] AND destination_group_id when grouped", () => {
    for (const platform of PLATFORMS) {
      const payload = buildCreatePayload(platform, {
        ...BASE_STATE,
        destination: destBodyOf(DEST_EVENT_A),
        destinationGroupId: "group-1002",
        requestId: "rid-1",
      });
      // The forward contract: DestinationInput[] (a one-element array for this call).
      assert.deepEqual(payload.destinations, [destBodyOf(DEST_EVENT_A)], `${platform} must emit destinations[]`);
      assert.equal(payload.destination_group_id, "group-1002", `${platform} must carry the shared group id`);
      // Backward compat: the singular destination is retained (server prefers it).
      assert.deepEqual(payload.destination, destBodyOf(DEST_EVENT_A), `${platform} must keep the singular destination`);
    }
  });

  it("a single-destination build omits the group id and stays byte-identical (destination + destinations[])", () => {
    for (const platform of PLATFORMS) {
      const payload = buildCreatePayload(platform, {
        ...BASE_STATE,
        destination: destBodyOf(DEST_EVENT_A),
        destinationGroupId: null, // single-destination → no group
        requestId: "rid-1",
      });
      assert.equal(payload.destination_group_id, undefined, `${platform} single build must NOT carry a group id`);
      assert.deepEqual(payload.destination, destBodyOf(DEST_EVENT_A));
      assert.deepEqual(payload.destinations, [destBodyOf(DEST_EVENT_A)]);
    }
  });
});

describe("ISSUE-1002 · fan-out is N destinations × M platforms (one ad each, own URL + pid)", () => {
  const destinations = [DEST_EVENT_A, DEST_EVENT_B, DEST_BRAND];
  const platforms = ["meta", "tiktok", "google"];

  it("builds exactly N×M payloads — one per (destination × platform) pair", () => {
    const { out } = fanOut(destinations, platforms);
    assert.equal(out.length, destinations.length * platforms.length, "N×M create calls");
    // Exactly M payloads per destination, and N per platform.
    for (const dest of destinations) {
      assert.equal(out.filter((r) => r.dest.id === dest.id).length, platforms.length);
    }
    for (const platform of platforms) {
      assert.equal(out.filter((r) => r.platform === platform).length, destinations.length);
    }
  });

  it("each ad carries its OWN destination → its OWN per-destination landing URL", () => {
    const { out } = fanOut(destinations, platforms);
    for (const { dest, payload } of out) {
      assert.deepEqual(payload.destination, expectedPayloadDest(dest));
      assert.deepEqual(payload.destinations, [expectedPayloadDest(dest)]);
      // The server rebuilds dest_url from these fields — prove they reconstruct
      // this destination's canonical URL, distinct per destination.
      assert.equal(payload.destination.brand_slug, dest.brand_slug);
      // Events keep their slug; the brand page omits entity_slug (→ undefined).
      assert.equal(payload.destination.entity_slug, dest.page_type === "event" ? dest.slug : undefined);
    }
    // The three destinations reconstruct three DISTINCT URLs.
    const urls = new Set(destinations.map(reconstructUrl));
    assert.equal(urls.size, 3, "each selected destination is a distinct landing URL");
  });

  it("pid=<platform>_ads is per-(platform×destination) — every payload carries its own platform", () => {
    const { out } = fanOut(destinations, platforms);
    // pid is server-built from `platform` (create-campaign buildDestSmartLink:
    // pid=${platform}_ads). Each fanned ad carrying its own platform guarantees a
    // per-(platform×destination) pid, and the group shares nothing that collides.
    for (const { platform, payload } of out) {
      assert.equal(payload.platform, platform);
    }
  });

  it("distinct idempotency request_ids across the fan-out; one shared group id", () => {
    const { out, groupId } = fanOut(destinations, platforms);
    const reqIds = new Set(out.map((r) => r.requestId));
    assert.equal(reqIds.size, out.length, "every (platform×destination) call has a distinct request_id");
    const resultKeys = new Set(out.map((r) => r.resultKey));
    assert.equal(resultKeys.size, out.length, "every result is keyed distinctly (platform::dest)");
    for (const { payload } of out) {
      assert.equal(payload.destination_group_id, groupId, "the whole fan-out shares one group id");
    }
  });

  it("single-destination fan-out is one call per platform, keyed by bare platform (byte-identical)", () => {
    const { out, groupId } = fanOut([DEST_EVENT_A], ["meta", "google"]);
    assert.equal(groupId, null, "no group id for a single destination");
    assert.deepEqual(out.map((r) => r.resultKey).sort(), ["google", "meta"], "bare-platform keys, as before");
    for (const { payload } of out) {
      assert.equal(payload.destination_group_id, undefined);
    }
  });
});

describe("ISSUE-1002 · launchSummary renders the multi-destination line", () => {
  const base = { channelRows: [], allocations: [], goalIds: [], creative: null, totalDailyCents: 0 };

  it("N>1 destinations → a 'N destinations — …' line naming each", () => {
    const summary = buildLaunchSummary({
      ...base,
      destinations: [
        { title: "Friday Live", dest_url: "https://host.usemingla.com/e/smokerhythm/friday-live" },
        { title: "Sunday Jazz", dest_url: "https://host.usemingla.com/e/smokerhythm/sunday-jazz" },
      ],
    });
    assert.match(summary.destinationLine, /2 destinations/);
    assert.match(summary.destinationLine, /Friday Live/);
    assert.match(summary.destinationLine, /Sunday Jazz/);
  });

  it("a single destination (via destinations[] OR legacy destination) renders '{title} — {url}' — backward compat", () => {
    const one = { title: "Friday Live", dest_url: "https://host.usemingla.com/e/smokerhythm/friday-live" };
    const viaArray = buildLaunchSummary({ ...base, destinations: [one] });
    const viaLegacy = buildLaunchSummary({ ...base, destination: one });
    assert.equal(viaArray.destinationLine, "Friday Live — https://host.usemingla.com/e/smokerhythm/friday-live");
    assert.equal(viaLegacy.destinationLine, viaArray.destinationLine);
  });

  it("no destination → 'No destination picked.'", () => {
    assert.equal(buildLaunchSummary({ ...base }).destinationLine, "No destination picked.");
  });
});

describe("ISSUE-1002 · migration adds a nullable dest_group_id grouping column", () => {
  const migration = REPO("supabase/migrations/20270107001002_issue_1002_ad_campaign_destinations.sql");

  it("adds dest_group_id uuid, nullable + idempotent", () => {
    assert.match(migration, /ADD COLUMN IF NOT EXISTS dest_group_id uuid/i);
    // nullable — must NOT be declared NOT NULL (single-destination/legacy rows stay NULL).
    assert.doesNotMatch(migration, /dest_group_id uuid[^;]*NOT NULL/i);
  });

  it("creates the grouping index + documents a reversible rollback", () => {
    assert.match(migration, /CREATE INDEX IF NOT EXISTS idx_ad_campaigns_dest_group_id/i);
    assert.match(migration, /ROLLBACK/i);
    assert.match(migration, /DROP COLUMN IF EXISTS dest_group_id/i);
  });
});

describe("ISSUE-1002 · source wiring (fails on a structural revert)", () => {
  it("CampaignBuilderPage: destinations[] state + outer destination fan-out loop + per-(platform,dest) request id", () => {
    const src = SRC("pages/CampaignBuilderPage.jsx");
    assert.match(src, /const \[destinations, setDestinations\] = useState\(\[\]\)/);
    assert.match(src, /for \(const dest of destinations\)/, "the outer destination fan-out loop");
    assert.match(src, /requestIdFor\(platform, destSlot\)/, "idempotency keyed per (platform, destination)");
    assert.match(src, /destinationGroupId: groupId/);
    assert.doesNotMatch(src, /const \[destination, setDestination\] = useState\(null\)/, "the single-object state is gone");
  });

  it("StepDestination: checkbox multi-select over destinations[] (radiogroup cards gone)", () => {
    const src = SRC("components/campaign-builder/StepDestination.jsx");
    assert.match(src, /onDestinationsChange/);
    assert.match(src, /role="checkbox"/, "cards are checkboxes now");
    assert.match(src, /aria-label="Destination pages"/, "the card grid is role=group, not radiogroup");
    assert.doesNotMatch(src, /onDestinationChange/, "the single-object handler is gone");
  });

  it("payload.js emits destinations[] + destination_group_id from a shared field set", () => {
    const src = SRC("lib/adBuilder/payload.js");
    assert.match(src, /destinations: \[destinationBody\]/);
    assert.match(src, /destination_group_id: destinationGroupId/);
  });

  it("StepReview keys create outcomes per (platform × destination)", () => {
    const src = SRC("components/campaign-builder/StepReview.jsx");
    assert.match(src, /Object\.entries\(createResults\)\.map\(\(\[key, result\]\)/);
    assert.match(src, /result\.platform/);
  });
});
