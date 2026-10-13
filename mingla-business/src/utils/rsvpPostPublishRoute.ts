/**
 * RETIRED by issue #3237 — no route calls this any more. Every RSVP visibility
 * now lands on the RSVP's manage screen (/rsvp/{id}) with a "Published" banner;
 * see app/rsvp/[id]/edit.tsx. The function and its test are left in place
 * because the test suite is append-only; removing both needs an approved test
 * change. What follows describes the behaviour before #3237.
 *
 * Where the host lands straight after publishing an RSVP.
 *
 * The RSVP wizard used to send EVERY publish to the public page. For an Unlisted
 * RSVP that page is the invite link, and it now opens (pg_public_rsvp_by_slug
 * admits unlisted). A PRIVATE RSVP has no page anyone can open without an invite
 * — private access grants are not live (#2144), exactly as for ticketed events —
 * so sending the host there after a successful publish showed "This event isn't
 * live" by design. A private RSVP now lands on its RSVP dashboard (/rsvp/{id}),
 * where the host manages guests.
 *
 *   public   -> /e/{brandSlug}/{eventSlug}
 *   unlisted -> /e/{brandSlug}/{eventSlug}   (the invite link)
 *   private  -> /rsvp/{eventId}
 *   no route -> null (the caller keeps its safe Events fallback)
 */
import type { DraftEventVisibility } from "../store/draftEventStore";

export interface RsvpPostPublishInput {
  visibility: DraftEventVisibility | null;
  eventId: string | null;
  slug: { brandSlug: string; eventSlug: string } | null;
}

export const rsvpPostPublishRoute = ({
  visibility,
  eventId,
  slug,
}: RsvpPostPublishInput): string | null => {
  if (visibility === "private") {
    return eventId !== null && eventId.length > 0
      ? `/rsvp/${encodeURIComponent(eventId)}`
      : null;
  }
  if (slug === null || slug.brandSlug.length === 0 || slug.eventSlug.length === 0) {
    return null;
  }
  return `/e/${slug.brandSlug}/${slug.eventSlug}`;
};
