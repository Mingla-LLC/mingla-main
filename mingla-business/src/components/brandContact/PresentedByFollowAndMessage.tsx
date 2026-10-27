/**
 * #4111 D6 — Follow + Message for the organiser row of the public trip and
 * experience pages. Those routes stay free of useAuth (anon-buyer rule) by
 * lazy-loading this component; it reads the viewer here, the same way the
 * #3682 PresentedByFollow it wraps already does.
 */
import React, { useMemo } from "react";
import type { ResolvedTheme, ThemePalette } from "@mingla/offering-rendering";
import type { EnquiryOffering } from "@mingla/brand-rendering/enquiry/enquiryTopics";

import { useAuth } from "../../context/AuthContext";
import { usePresentedByFollow } from "../brand/usePresentedByFollow";
import { PresentedByActions } from "./PresentedByActions";
import { useBrandMessage, viewerNameFromUser } from "./useBrandMessage";

export interface PresentedByFollowAndMessageProps {
  brandId: string;
  brandName: string;
  brandSlug: string;
  palette: ThemePalette;
  theme: ResolvedTheme;
  /** The page's own offering, picked when the sheet opens. */
  offering: EnquiryOffering;
  resumePath: string;
}

export default function PresentedByFollowAndMessage({
  brandId,
  brandName,
  brandSlug,
  palette,
  theme,
  offering,
  resumePath,
}: PresentedByFollowAndMessageProps): React.ReactElement {
  const { user } = useAuth();
  const presentedBy = usePresentedByFollow({ brandId, brandName, palette });
  const target = useMemo(
    () => ({ id: brandId, name: brandName, slug: brandSlug, theme }),
    [brandId, brandName, brandSlug, theme],
  );
  const offerings = useMemo(() => [offering], [offering]);
  const message = useBrandMessage({
    brand: target,
    viewer: { userId: user?.id ?? null, name: viewerNameFromUser(user) },
    entry: "offering",
    offerings,
    resumePath,
  });
  return (
    <>
      <PresentedByActions
        follow={presentedBy.node}
        brandName={brandName}
        palette={palette}
        onMessage={
          message.available
            ? () => message.open({ contextKind: "offering", contextId: offering.id, offering })
            : undefined
        }
      />
      {presentedBy.overlays}
      {message.overlays}
    </>
  );
}
