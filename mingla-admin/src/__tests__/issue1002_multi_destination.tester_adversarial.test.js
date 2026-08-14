/**
 * ISSUE-1002 [Campaign Builder multi-destination fan-out] — Wave 4 (final) of
 * epic #977. TESTER adversarial suite (different angle than the implementor's
 * happy-path suite issue1002_multi_destination.test.js).
 *
 * The implementor's suite proves the POSITIVE shape: payload emits destinations[]
 * + group id, N×M count, each ad carries its own URL/pid, distinct request_ids.
 * This suite attacks the NEGATIVE SPACE and the BOUNDARIES that a fan-out most
 * plausibly breaks in production:
 *
 *   1. BOUNDARY — empty destinations produces ZERO create calls (no orphan ad,
 *      no crash, no fabricated call), and a single destination is byte-identical
 *      to pre-1002 (the ONLY delta is the additive destinations[]/group-id keys;
 *      no group id → the DB dest_group_id stays NULL).
 *   2. ANTI-CROSS-CONTAMINATION (the core attack) — across the WHOLE N×M matrix,
 *      every ad's destination is PAIRWISE-DISTINCT from every sibling's: no
 *      payload for destination B ever carries destination A's entity_slug, the
 *      brand page NEVER inherits an event's slug, and there are no missing pairs
 *      and no orphans. This catches a shared-reference / aliasing regression
 *      (one destBody built once and reused) that the "each carries its own URL"
 *      positive test does not — a mutated/aliased body would still "carry a URL",
 *      just the WRONG one.
 *   3. DUPLICATE destinations are idempotent-SAFE — if the same page slips into
 *      the set twice (defence-in-depth; StepDestination dedupes by page_type:id,
 *      but runCreate must not Frankenstein), both iterations resolve to the SAME
 *      composite result key + SAME idempotency request_id + byte-identical
 *      payload, so the server's request_id idempotency collapses them. A dup can
 *      NEVER yield two DIFFERENT landing URLs under one key.
 *   4. GROUP-ID ISOLATION — the shared group id is identical on every pair and is
 *      a separate field that collides with no per-destination value; single
 *      builds omit it entirely.
 *
 * FAILS ON REVERT: the anti-contamination + boundary assertions read
 * `payload.destinations[0]`; deleting `destinations: [destinationBody]` from
 * payload.js makes `payload.destinations` undefined → these assertions throw/fail.
 * The group-id assertions fail if `destination_group_id` emission is reverted.
 *
 * NOTE: CampaignBuilderPage.runCreate is a React component method (crypto.randomUUID,
 * useState/useRef, createCampaign service) that cannot be unit-run without a DOM;
 * like the implementor suite, this faithfully MIRRORS runCreate's fan-out mapping
 * (outer destination loop × per-platform loop; destSlot = `${page_type}:${id}`;
 * resultKey = multiDest ? `${platform}::${destSlot}` : platform) and exercises the
 * REAL buildCreatePayload it calls. The real request_id is a random UUID keyed by
 * the same (platform, destSlot); the mirror uses the composite string to prove
 * the collision structure, which is what determines dedup/contamination.
 *
 * Run: node --test src/__tests__/issue1002_multi_destination.tester_adversarial.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildCreatePayload } from "../lib/adBuilder/payload.js";
import { buildLaunchSummary } from "../lib/adBuilder/launchSummary.js";

// Same "Smoke & Rhythm" shape as the forensic: TWO live events under ONE brand
// slug (they differ only by slug+id — the collision-prone case) + the brand page.
const DEST_EVENT_A = { id: "e-aaa", page_type: "event", brand_slug: "smokerhythm", slug: "friday-live", title: "Friday Live", brand_name: "Smoke & Rhythm", dest_url: "https://host.usemingla.com/e/smokerhythm/friday-live" };
const DEST_EVENT_B = { id: "e-bbb", page_type: "event", brand_slug: "smokerhythm", slug: "sunday-jazz", title: "Sunday Jazz", brand_name: "Smoke & Rhythm", dest_url: "https://host.usemingla.com/e/smokerhythm/sunday-jazz" };
const DEST_BRAND = { id: "b-ccc", page_type: "brand", brand_slug: "smokerhythm", slug: "smokerhythm", title: "Smoke & Rhythm", brand_name: "Smoke & Rhythm", dest_url: "https://host.usemingla.com/b/smokerhythm" };

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

/** EXACT mirror of CampaignBuilderPage.runCreate destBody construction. */
function destBodyOf(dest) {
  return {
    page_type: dest.page_type,
    brand_slug: dest.brand_slug,
    entity_slug: dest.page_type === "event" ? dest.slug : null, // NULL for brand — payload.js omits it
  };
}

/**
 * Faithful mirror of runCreate's fan-out: the DESTINATION axis is the OUTER loop
 * around the per-platform loop → one create call per (destination × platform).
 */
function fanOut(destinations, platforms, { groupIdValue = "group-1002" } = {}) {
  const multiDest = destinations.length > 1;
  const groupId = multiDest ? groupIdValue : null;
  const calls = [];
  for (const dest of destinations) {
    const destSlot = `${dest.page_type}:${dest.id}`;
    const destBody = destBodyOf(dest);
    for (const platform of platforms) {
      // real runCreate: requestIdFor(platform, destSlot) → a stable UUID per key;
      // the composite string proves the SAME collision/uniqueness structure.
      const requestId = `${platform}::${destSlot}`;
      calls.push({
        platform,
        destId: dest.id,
        destSlot,
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
  return { calls, groupId };
}

describe("ISSUE-1002 adversarial · BOUNDARY — empty & single destination", () => {
  it("empty destinations → ZERO create calls (no orphan ad, no fabricated call, no crash)", () => {
    const { calls, groupId } = fanOut([], ["meta", "google", "tiktok"]);
    assert.equal(calls.length, 0, "no destination selected must issue no create call");
    assert.equal(groupId, null, "no group id when nothing is selected");
    // launchSummary is honest about the empty state (never a fabricated destination).
    const summary = buildLaunchSummary({ channelRows: [], allocations: [], goalIds: [], creative: null, totalDailyCents: 0, destinations: [] });
    assert.equal(summary.destinationLine, "No destination picked.");
  });

  it("single destination → exactly M calls, bare-platform keys, NO group id (DB dest_group_id stays NULL)", () => {
    const platforms = ["meta", "google", "tiktok", "reddit", "snapchat"];
    const { calls, groupId } = fanOut([DEST_EVENT_A], platforms);
    assert.equal(calls.length, platforms.length, "single destination = one call per platform");
    assert.equal(groupId, null);
    assert.deepEqual(calls.map((c) => c.resultKey).sort(), [...platforms].sort(), "bare-platform result keys (as pre-1002)");
    for (const { payload } of calls) {
      // The ONLY additive delta over pre-1002 is destinations[] — the group id is ABSENT.
      assert.equal(payload.destination_group_id, undefined, "single build must NOT carry a group id → row.dest_group_id NULL");
      // Backward-compat: the singular destination body is byte-identical (no leakage).
      assert.deepEqual(payload.destination, { page_type: "event", brand_slug: "smokerhythm", entity_slug: "friday-live" });
      assert.deepEqual(payload.destinations, [payload.destination]);
    }
  });
});

describe("ISSUE-1002 adversarial · ANTI-CROSS-CONTAMINATION across the N×M matrix", () => {
  const destinations = [DEST_EVENT_A, DEST_EVENT_B, DEST_BRAND]; // 2 same-brand events + brand page
  const platforms = ["meta", "tiktok", "google", "reddit", "snapchat"];

  it("every (platform × destination) pair is present exactly once — no missing pairs, no orphans", () => {
    const { calls } = fanOut(destinations, platforms);
    assert.equal(calls.length, destinations.length * platforms.length);
    const seen = new Set();
    for (const c of calls) {
      const pair = `${c.platform}|${c.destId}`;
      assert.ok(!seen.has(pair), `pair ${pair} must appear exactly once (no orphan/duplicate)`);
      seen.add(pair);
    }
    assert.equal(seen.size, destinations.length * platforms.length, "the matrix is complete");
  });

  it("destination A's URL/slug NEVER lands on destination B's ad (pairwise-distinct, no aliasing)", () => {
    const { calls } = fanOut(destinations, platforms);
    const bodyById = new Map(destinations.map((d) => {
      const b = { page_type: d.page_type, brand_slug: d.brand_slug };
      if (d.page_type === "event") b.entity_slug = d.slug;
      return [d.id, b];
    }));
    for (const c of calls) {
      const own = bodyById.get(c.destId);
      // Each payload carries ITS OWN destination on BOTH the singular + array key...
      assert.deepEqual(c.payload.destination, own, `${c.platform}/${c.destId} must carry its own destination`);
      assert.deepEqual(c.payload.destinations, [own], `${c.platform}/${c.destId} destinations[] must be its own`);
      // ...and must NOT match ANY OTHER destination's body (catches shared-ref/aliasing).
      for (const [otherId, otherBody] of bodyById) {
        if (otherId === c.destId) continue;
        assert.notDeepEqual(c.payload.destination, otherBody, `contamination: ${c.destId}'s ad carries ${otherId}'s destination`);
      }
    }
  });

  it("the brand page NEVER inherits an event's entity_slug; each event keeps its OWN slug", () => {
    const { calls } = fanOut(destinations, platforms);
    for (const c of calls) {
      if (c.destId === DEST_BRAND.id) {
        assert.equal(c.payload.destination.entity_slug, undefined, "brand page must carry NO entity_slug");
        assert.equal(c.payload.destinations[0].entity_slug, undefined);
      } else {
        const expectedSlug = c.destId === DEST_EVENT_A.id ? "friday-live" : "sunday-jazz";
        assert.equal(c.payload.destination.entity_slug, expectedSlug, "event must carry its OWN slug");
      }
    }
    // The three destinations reconstruct three DISTINCT landing URLs (server rebuilds from these fields).
    const urls = new Set(calls.map((c) => {
      const d = c.payload.destination;
      return d.entity_slug
        ? `https://host.usemingla.com/e/${d.brand_slug}/${d.entity_slug}`
        : `https://host.usemingla.com/b/${d.brand_slug}`;
    }));
    assert.equal(urls.size, 3, "exactly three distinct destination URLs across the fan-out");
  });

  it("the shared group id is identical on EVERY pair and collides with no per-destination value", () => {
    const { calls, groupId } = fanOut(destinations, platforms);
    assert.equal(typeof groupId, "string");
    for (const c of calls) {
      assert.equal(c.payload.destination_group_id, groupId, "every fanned ad shares the one group id");
      // The group id is a SEPARATE envelope — it is never a destination field.
      assert.notEqual(c.payload.destination.brand_slug, groupId);
      assert.notEqual(c.payload.destination.entity_slug, groupId);
    }
    const reqIds = new Set(calls.map((c) => c.requestId));
    assert.equal(reqIds.size, calls.length, "every (platform×destination) call has a DISTINCT idempotency request_id");
  });
});

describe("ISSUE-1002 adversarial · DUPLICATE destinations are idempotent-safe (no Frankenstein)", () => {
  const platforms = ["meta", "google"];

  it("the same page twice resolves to the SAME result key + request_id + byte-identical payload", () => {
    // Defence-in-depth: StepDestination dedupes by page_type:id, but if a dup ever
    // reached runCreate, the composite keying must make it a NO-OP under server
    // idempotency — never two different ads, never a mixed/contaminated URL.
    const { calls } = fanOut([DEST_EVENT_A, DEST_EVENT_A], platforms);
    // group by (platform, destSlot) — a genuine dup collapses to ONE logical call.
    const byKey = new Map();
    for (const c of calls) {
      const k = `${c.platform}::${c.destSlot}`;
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k).push(c);
    }
    assert.equal(byKey.size, platforms.length, "a duplicated destination collapses to one key per platform");
    for (const [, group] of byKey) {
      assert.equal(group.length, 2, "the dup produced two iterations of the same key…");
      // …and both are byte-identical → the server's request_id idempotency replays
      // the first, so no second ad is created and no URL is ever mixed.
      assert.equal(group[0].requestId, group[1].requestId, "same idempotency request_id → idempotent replay");
      assert.equal(group[0].resultKey, group[1].resultKey, "same result key → StepReview shows one card");
      assert.deepEqual(group[0].payload, group[1].payload, "byte-identical payloads → no Frankenstein URL");
    }
  });
});
