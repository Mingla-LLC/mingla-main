/**
 * #3682 closeout — auto-follow on standalone RSVPs and venue bookings.
 * Drives the helpers with a REAL supabase-js client against a stub PostgREST
 * server and asserts the RPC body carries the generic (source_kind, source_id)
 * claim key added by 20280327003682.
 *
 *   deno test --allow-read --allow-env --allow-net --no-check \
 *     supabase/functions/_shared/__tests__/issue_3682_auto_follow_rsvp_booking.happy.test.ts
 */
import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  autoFollowBrandBestEffort,
  autoFollowReservationBestEffort,
  rsvpStatusAutoFollows,
} from "../autoFollowBrand.ts";
import { realClient, withStubPostgrest } from "./_issue3682StubPostgrest.ts";

const read = (p: string) => Deno.readTextFileSync(p);
const rsvpSrc = read("supabase/functions/public-submit-rsvp/index.ts");
const createSrc = read("supabase/functions/venue-reservation-create/index.ts");
const confirmSrc = read("supabase/functions/venue-reservation-confirm/index.ts");
const paystackFinalizeSrc = read(
  "supabase/functions/_shared/reservationPaystackFinalize.ts",
);
const migrationSrc = read(
  "supabase/migrations/20280327003682_issue_3682_auto_follow_generic_claims.sql",
);

Deno.test("#3682 rsvp: signed-in RSVP sends (rsvp, rsvpId) claim key", async () => {
  await withStubPostgrest(200, { followed: true }, async (url, seen) => {
    await autoFollowBrandBestEffort(realClient(url), {
      userId: "user-1",
      brandId: "brand-1",
      source: "rsvp",
      sourceKind: "rsvp",
      sourceId: "rsvp-1",
    });
    assertEquals(seen.length, 1);
    assertEquals(seen[0].path, "/rest/v1/rpc/biz_auto_follow_brand");
    assertEquals(seen[0].body, {
      p_user_id: "user-1",
      p_brand_id: "brand-1",
      p_source: "rsvp",
      p_order_id: null,
      p_source_kind: "rsvp",
      p_source_id: "rsvp-1",
    });
  });
});

Deno.test("#3682 rsvp/booking: no claim key → no RPC (unfollow must stay sticky)", async () => {
  await withStubPostgrest(200, {}, async (url, seen) => {
    const c = realClient(url);
    await autoFollowBrandBestEffort(c, {
      userId: "user-1",
      brandId: "brand-1",
      source: "rsvp",
      sourceKind: "rsvp",
      sourceId: " ",
    });
    await autoFollowBrandBestEffort(c, {
      userId: "user-1",
      brandId: "brand-1",
      source: "booking",
    });
    assertEquals(seen.length, 0);
  });
});

Deno.test("#3682 booking: reservation row drives (reservation, id) claim", async () => {
  await withStubPostgrest(200, { followed: true }, async (url, seen) => {
    const c = realClient(url);
    await autoFollowReservationBestEffort(c, {
      id: "res-1",
      brand_id: "brand-9",
      consumer_user_id: "user-9",
      status: "confirmed",
    });
    // Guest booking (no signed-in consumer) never follows.
    await autoFollowReservationBestEffort(c, {
      id: "res-2",
      brand_id: "brand-9",
      consumer_user_id: null,
    });
    await autoFollowReservationBestEffort(c, null);
    assertEquals(seen.length, 1);
    assertEquals(seen[0].body, {
      p_user_id: "user-9",
      p_brand_id: "brand-9",
      p_source: "booking",
      p_order_id: null,
      p_source_kind: "reservation",
      p_source_id: "res-1",
    });
  });
});

Deno.test("#3682 rsvp: only 'not going' is excluded", () => {
  assert(rsvpStatusAutoFollows("going"));
  assert(rsvpStatusAutoFollows("maybe"));
  assert(rsvpStatusAutoFollows("waitlisted"));
  assert(!rsvpStatusAutoFollows("not_going"));
  assert(!rsvpStatusAutoFollows(undefined));
});

Deno.test("#3682 wiring: RSVP + every reservation mint path calls auto-follow", () => {
  assert(rsvpSrc.includes("autoFollowBrandBestEffort(admin, {"));
  assert(rsvpSrc.includes('sourceKind: "rsvp"'));
  assert(rsvpSrc.includes("sourceId: result.rsvpId"));
  assert(rsvpSrc.includes("userId !== null && typeof result.rsvpId"));
  assert(createSrc.includes("await autoFollowReservationBestEffort(supabase, row);"));
  assert(confirmSrc.includes("await autoFollowReservationBestEffort(supabase, reservationRow);"));
  assert(paystackFinalizeSrc.includes("await autoFollowReservationBestEffort("));
});

Deno.test("#3682 migration: generic replay-safe claim key + function keeps #4111 sources", () => {
  assert(migrationSrc.includes("UNIQUE (source_kind, source_id, user_id, brand_id)"));
  assert(migrationSrc.includes("CHECK (source_kind IN ('order', 'rsvp', 'reservation'))"));
  assert(migrationSrc.includes("'web_subscribe', 'site_subscribe'"));
  assert(migrationSrc.includes("SECURITY DEFINER"));
  assert(migrationSrc.includes("DROP FUNCTION IF EXISTS public.biz_auto_follow_brand(uuid, uuid, text, uuid);"));
  assert(migrationSrc.includes("TO service_role"));
});
