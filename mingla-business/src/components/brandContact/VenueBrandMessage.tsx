/**
 * #4111 D6 — "Message {Brand}" on the public venue page, with this venue
 * picked ("At the venue" topics). The venue route is anonymous and never calls
 * useAuth itself, so this lazily-loaded component owns the viewer and the
 * sheet, and hands the route an opener once the brand is known to take
 * enquiries (null until then, so no dead Message button ever renders).
 */
import React, { useEffect, useMemo } from "react";
import { resolveTheme } from "@mingla/offering-rendering";
import type { PublicVenueThemeInput } from "@mingla/brand-rendering/PublicVenueScreen";

import { useAuth } from "../../context/AuthContext";
import { useBrandMessage, viewerNameFromUser } from "./useBrandMessage";

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
  const { user } = useAuth();
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
    viewer: { userId: user?.id ?? null, name: viewerNameFromUser(user) },
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
