/**
 * Where step — the address-privacy copy.
 *
 * CreatorStep3Where is shared by the ticketed event wizard, the RSVP wizard and
 * the published-event editor. An RSVP has no tickets and no checkout, so the
 * ticket wording ("until ticket purchase", "ticketed guests", "checks out") was
 * wrong on every RSVP. The info card also ignored the toggle: with "Hide
 * address" OFF it still said the address stays off the public page, directly
 * under a subtitle saying it is visible there.
 *
 * Pure, so the four states are testable without rendering.
 */

export interface WhereStepAddressCopy {
  toggleTitle: string;
  toggleSubtitle: string;
  infoCard: string;
  onlineLinkHint: string;
}

export const whereStepAddressCopy = (
  isRsvp: boolean,
  hideAddress: boolean,
): WhereStepAddressCopy => {
  if (isRsvp) {
    return {
      toggleTitle: "Hide address until guests RSVP",
      toggleSubtitle: hideAddress
        ? "Address only revealed to guests who RSVP."
        : "Address visible on the public event page.",
      infoCard: hideAddress
        ? "Address appears in RSVP confirmations — not on the public page until the guest RSVPs."
        : "Address shows on the public event page and in RSVP confirmations.",
      onlineLinkHint:
        "Link is shared with guests who RSVP only — never posted publicly.",
    };
  }
  return {
    toggleTitle: "Hide address until ticket purchase",
    toggleSubtitle: hideAddress
      ? "Address only revealed to ticketed guests."
      : "Address visible on the public event page.",
    infoCard: hideAddress
      ? "Address appears in tickets and confirmation emails — not on the public page until the guest checks out."
      : "Address shows on the public event page and in tickets and confirmation emails.",
    onlineLinkHint:
      "Link is shared with ticketed guests only — never posted publicly.",
  };
};
