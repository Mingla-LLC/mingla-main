/**
 * #4514 — the business app's visual primitives for `@mingla/form-rendering`
 * (C11), in their own module so the checkout Questions step and this owner both
 * use them without an import cycle. Reached only through the forms lazy owner
 * (`./formRenderingPrimitives`); never import it from an eager module.
 */

import React from "react";
import type { FormBrandCoverProps, FormRenderingPrimitives } from "@mingla/form-rendering";

import { radius, space, type } from "../../../constants/designSystem";
import { activeSurfaceTokens, themed } from "../../../theme/surfaceTokens";
import { EventCoverMedia } from "../../ui/EventCoverMedia";
import { Icon } from "../../ui/Icon";
import { WebDateTimeInput } from "../../ui/WebDateTimeInput";

/** The brand header's cover: the host's cover media, or its hue gradient (§5.1). */
const BusinessBrandCover: React.FC<FormBrandCoverProps> = ({ uri, hue, height }) => (
  <EventCoverMedia
    hue={hue}
    mediaUrl={uri}
    mediaType={uri === null ? null : "image"}
    radius={0}
    label=""
    height={height}
  />
);

/**
 * #4518: text and line colours come from the surface tokens, read at render.
 * `themed` builds one token object per active palette, so the package's
 * per-token style cache rebuilds when a host palette is set and a change of
 * palette never reuses a stale sheet.
 */
const surfaceFormTokens = themed(() => ({
  color: activeSurfaceTokens().color,
  radius,
  space,
  type,
}));

export const businessFormPrimitives: FormRenderingPrimitives = {
  get tokens() {
    return surfaceFormTokens();
  },
  Icon,
  WebDateTimeInput,
  BrandCover: BusinessBrandCover,
};

