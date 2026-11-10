/**
 * issue #3827 — the RSVP screen a ticketed `/event/<id>` screen hands over to
 * once it knows the event is an RSVP: the detail page, the published editor
 * (`edit-published`) or the guest list. Null for anything that is not an RSVP
 * (or no id), so the ticketed screen carries on.
 *
 * Kept apart from routeForEventRow (in the boot payload): only the ticketed
 * /event/[id] routes, each an on-demand chunk, import it.
 */
export function rsvpTwinRoute(
  event: { event_type?: string } | null | undefined,
  id: string | null | undefined,
  screen: "detail" | "edit-published" | "guests",
): string | null {
  if (event?.event_type !== "rsvp" || typeof id !== "string" || id.length === 0) {
    return null;
  }
  if (screen === "edit-published") return `/rsvp/${id}/edit?mode=edit-published`;
  return screen === "guests" ? `/rsvp/${id}/guests` : `/rsvp/${id}`;
}
