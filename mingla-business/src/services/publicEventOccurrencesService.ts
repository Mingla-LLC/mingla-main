/**
 * publicEventOccurrencesService — issue #2135, CORRECTED by issue #2161 / #2160.
 *
 * ══ THIS MODULE EXPORTS A TYPE AND NOTHING ELSE. THAT IS DELIBERATE. ════════
 *
 * It used to carry `fetchPublicEventOccurrences`, which selected straight from
 * the occurrences table by event id — a table read gated by the anon RLS policy
 * "Public can read event dates for
 * PUBLISHED events". The event itself, meanwhile, arrives through the SECURITY
 * DEFINER reader `pg_direct_event_checkout_bundle`, which deliberately serves
 * UNLISTED events to anyone holding the link. Two access paths for one page,
 * and they disagreed: the event rendered, its days did not, and no error
 * surfaced — it looked exactly like a single-date event (#2161).
 *
 * THE FIX IS STRUCTURAL, NOT A WIDENED POLICY. Widening the anon `event_dates`
 * policy to admit hidden events would leak the existence AND the schedule of
 * every unlisted offering to enumeration. That is the wrong fix and is
 * forbidden here. Instead the occurrences now travel ON the bundle, arriving as
 * `PublicEventDetail.occurrences`, so ONE authority decides who may see this
 * event and its days and the two cannot drift.
 *
 * I-PROPOSED-2160-D OCCURRENCES-TRAVEL-WITH-THE-EVENT — a guest-facing surface
 * obtains occurrences from the same SECURITY DEFINER reader that served the
 * event. No guest-surface client may read `public.event_dates` directly.
 *
 * DO NOT RE-ADD A READER HERE.
 */

/**
 * One materialised `event_dates` row for a published event.
 *
 * Declared here rather than aliased to the experience service's
 * `PublicExperienceDate`. That alias was the first thing written, and it closed
 * a REQUIRE CYCLE (I-PROPOSED-K): an *event* service importing from the
 * *experience* service completed
 * `usePublicEvents → publicEventOccurrencesService → publicExperienceService →
 * publicEventsService → … → usePublicEvents`. A public-event reader has no
 * business depending on the experience reader, so the dependency is gone rather
 * than baselined. The two shapes stay compatible BY COMPILATION — TypeScript is
 * structural, so no alias is needed for that guarantee, only for the cycle.
 */
export interface PublicEventOccurrence {
  /** `event_dates.id` — the value that rides through to the chosen day set. */
  id: string;
  startAt: string;
  endAt: string;
  timezone: string;
  isMaster: boolean;
  /**
   * ALWAYS null. `event_dates` carries NO per-occurrence capacity column and
   * ticket capacity is authored EVENT-level on `ticket_types.quantity_total`,
   * so there is no honest per-day remaining to publish: stamping the
   * event-level number onto each day would claim per-day availability that does
   * not exist (Constitution #9). True per-day sell-out needs a per-occurrence
   * cap AND a per-occurrence sold count, and is explicitly out of scope for
   * #2160 in BOTH pricing modes.
   */
  ticketsRemaining: number | null;
}
