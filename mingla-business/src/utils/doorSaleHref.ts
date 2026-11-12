/**
 * #4389 Door mode — the door sale route for an event. Its own tiny module so a
 * route can build the link without loading openDoorSale (and the event list
 * it reads) up front.
 */
/** The door sale route for an event (query values are encoded). */
export const doorSaleHref = (
  eventId: string,
  options: { pick?: boolean; source?: string | null; draft?: string | null } = {},
): string => {
  const query: string[] = [];
  if (options.pick === true) query.push("pick=1");
  if (options.source) query.push(`source=${encodeURIComponent(options.source)}`);
  if (options.draft) query.push(`draft=${encodeURIComponent(options.draft)}`);
  return `/event/${eventId}/door/sell${query.length > 0 ? `?${query.join("&")}` : ""}`;
};
