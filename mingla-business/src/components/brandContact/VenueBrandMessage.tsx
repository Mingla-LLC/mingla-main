/**
 * #4111 D6 — "Message {Brand}" on the public venue page, with this venue
 * picked ("At the venue" topics). The venue route chain never calls useAuth
 * (anon-buyer rule), so the venue page messages as a signed-out web guest
 * (name + email in the sheet), like the cancel page. This lazily-loaded
 * component owns the sheet and hands the route an opener once the brand is
 * known to take enquiries (null until then, so no dead Message button renders).
 */
import React, { useEffect, useMemo } from "react";
// DEEP specifier: the barrel is partially mocked by many venue suites, and a
// missing resolveTheme there must never take the venue page down.
import { resolveTheme } from "@mingla/offering-rendering/themeResolver";
import type { PublicVenueThemeInput } from "@mingla/brand-rendering/PublicVenueScreen";

import { useBrandMessage } from "./useBrandMessage";

export interface VenueMessageOpener {
  open: () => void;
}

export interface VenueBrandMessageProps {
  brandId: string;
  brandName: string;
  brandSlug: string;
  venueId: string;
  venueName: string;
  venueSlug: string;
  theme: PublicVenueThemeInput;
  countryIso: string | null;
  onOpener: (opener: VenueMessageOpener | null) => void;
}

export default function VenueBrandMessage({
  brandId,
  brandName,
  brandSlug,
  venueId,
  venueName,
  venueSlug,
  theme,
  countryIso,
  onOpener,
}: VenueBrandMessageProps): React.ReactElement {
  const resolved = useMemo(() => resolveTheme(theme, null), [theme]);
  const target = useMemo(
    () => ({ id: brandId, name: brandName, slug: brandSlug, theme: resolved, countryIso }),
    [brandId, brandName, brandSlug, countryIso, resolved],
  );
  const venue = useMemo(
    () => ({ id: venueId, name: venueName, orderingEnabled: false, reservationsOnline: false }),
    [venueId, venueName],
  );
  const message = useBrandMessage({
    brand: target,
    viewer: { userId: null, name: null },
    entry: "offering",
    venue,
    resumePath: `/b/${brandSlug}/v/${venueSlug}`,
  });
  const { available, open } = message;
  useEffect(() => {
    onOpener(available ? { open: () => open({ contextKind: "venue", contextId: venueId }) } : null);
  }, [available, onOpener, open, venueId]);
  useEffect(() => () => onOpener(null), [onOpener]);
  return <>{message.overlays}</>;
}
