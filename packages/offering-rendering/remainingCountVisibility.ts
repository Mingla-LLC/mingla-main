/**
 * remainingCountVisibility — issue #3314.
 *
 * THE ONE rule for whether a public ticketed-event surface may show a remaining
 * ticket count ("60 tickets left", "60 available", "3 left").
 *
 * The organiser's "Hide remaining count" setting lives in
 * `theme.business_event.settings.hideRemainingCount`. The public event bundle
 * that serves buyer web, the Business in-app page and the Explorer event screen
 * does NOT carry it, so those pages used to fall back to "show" and printed the
 * count the organiser had hidden. The only guest-readable source of the setting
 * is `pg_public_social_proof`, which every event page already fetches — but it
 * only answers for PUBLIC events and only once it has loaded.
 *
 * So the rule is fail-closed: a count is shown ONLY when something authoritative
 * says the organiser allows it. Unknown means hidden. Hiding an optional number
 * can never break the organiser's promise; showing one can.
 *
 * Follow-up (migration 20270704003314): the bundle now carries the setting as
 * `hideRemainingCount`, for public AND unlisted events. Pages read that first
 * (`readBundleHideRemainingCount`) and keep social proof as the fallback for a
 * payload from before the migration.
 *
 * DISPLAY ONLY (the sealed ORCH-1339 D2 posture): capacity still travels in the
 * payload because the quantity stepper clamp and the sold-out gate need it.
 * "Sold out" and "Unlimited" are states, not counts, and stay visible.
 *
 * Dep-free (no react / react-native imports) so the Business jest suite can run
 * it directly and every host can import it by deep specifier without touching
 * the barrel (whose jest mocks are partial).
 */

export interface RemainingCountVisibilityInput {
  /**
   * The organiser's own setting when the HOST'S read actually carries it
   * (the organiser's draft preview does). `null`/`undefined` = this read does
   * not carry the setting, which is every bundle-served public page.
   */
  organiserSetting: boolean | null | undefined;
  /**
   * The bundle's own `hideRemainingCount` key (`readBundleHideRemainingCount`).
   * `null`/`undefined` = the payload does not carry it: a server or cached
   * payload from before migration 20270704003314, or a host with no bundle.
   */
  bundleSetting?: boolean | null | undefined;
  /**
   * The `pg_public_social_proof` payload. `undefined` = still loading or the
   * read failed; `null` = the server holds no summary for this viewer (an
   * unlisted event, for example).
   */
  socialProof:
    | { hideRemainingCount: boolean }
    | null
    | undefined;
}

/** True when a remaining ticket count must NOT be shown. */
export const resolveHideRemainingCount = ({
  organiserSetting,
  bundleSetting,
  socialProof,
}: RemainingCountVisibilityInput): boolean => {
  // Any authority saying "hide" wins.
  if (organiserSetting === true) return true;
  if (bundleSetting === true) return true;
  if (socialProof?.hideRemainingCount === true) return true;
  // An authority positively allowing the count is the only way to show it. The
  // bundle's answer needs no second read, so an unlisted event (which social
  // proof never answers for) can show its count.
  if (organiserSetting === false) return false;
  if (bundleSetting === false) return false;
  if (socialProof?.hideRemainingCount === false) return false;
  // Unknown → hidden.
  return true;
};

/**
 * The public event bundle's `hideRemainingCount` key: the boolean when present,
 * `null` when the payload does not carry a boolean (a server or a cached payload
 * from before migration 20270704003314). `null` is "unknown", never "allowed".
 */
export const readBundleHideRemainingCount = (payload: unknown): boolean | null => {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const value = (payload as { hideRemainingCount?: unknown }).hideRemainingCount;
  return typeof value === "boolean" ? value : null;
};

/**
 * The pills-row summary ("N tickets left" / "Sold out") for a set of tiers'
 * remaining capacities. `null` = omit the pill. Tiers with no finite capacity
 * contribute nothing (never fabricate a count).
 *
 * Any unlimited tier omits the pill (#3431). The pill speaks for the whole
 * event, and an event with an unlimited tier never runs out: a hybrid event
 * with 60 in-person places and an unlimited stream pass read "60 tickets
 * left", and "Sold out" once the room filled while stream passes were still on
 * sale. Each tier's own caption ("60 available", "Unlimited") still shows.
 */
export const ticketsLeftSummaryLabel = (
  tickets: ReadonlyArray<{ isUnlimited: boolean; capacity: number | null }>,
  hideRemainingCount: boolean,
): string | null => {
  if (tickets.some((t) => t.isUnlimited)) return null;
  let total = 0;
  let anyFinite = false;
  for (const t of tickets) {
    if (t.capacity !== null) {
      total += t.capacity;
      anyFinite = true;
    }
  }
  if (!anyFinite) return null;
  if (total <= 0) return "Sold out";
  return hideRemainingCount ? null : `${total} tickets left`;
};

/**
 * The per-tier caption in the ticket box ("60 available"). With the count
 * hidden a finite tier with places reads "Available" and an empty one reads
 * "Sold out". `soldOutWhenEmpty: false` keeps a caller's pre-#3314 "0 available"
 * wording when the count is allowed (the legacy cancelled/password page).
 */
export const ticketAvailabilityCaption = (
  ticket: { isUnlimited: boolean; capacity: number | null },
  hideRemainingCount: boolean,
  soldOutWhenEmpty = true,
): string => {
  if (ticket.isUnlimited) return "Unlimited";
  if (ticket.capacity === null) return "Available";
  if (ticket.capacity <= 0 && (soldOutWhenEmpty || hideRemainingCount)) {
    return "Sold out";
  }
  return hideRemainingCount ? "Available" : `${ticket.capacity} available`;
};
