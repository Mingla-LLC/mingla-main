/**
 * #4514 — the business app's visual primitives for `@mingla/form-rendering`
 * (C11), in their own module so the checkout Questions step and this owner both
 * use them without an import cycle. Reached only through the forms lazy owner
 * (`./formRenderingPrimitives`); never import it from an eager module.
 */

import React from "react";
import type {
  FormBrandCoverProps,
  FormRenderingPrimitives,
  FormWebDateInputProps,
} from "@mingla/form-rendering";

import { radius, space, type } from "../../../constants/designSystem";
import { activeSurfaceTokens, themed } from "../../../theme/surfaceTokens";
import { EventCoverMedia } from "../../ui/EventCoverMedia";
import { Icon } from "../../ui/Icon";
import { DateField } from "../../ui/DateField";

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
 * #4523: a date question is picked from the Host's Mingla calendar (sheet on
 * phones, popover on wide web) on every platform. The question shell draws the
 * label, so the field's own visible label is empty and the question's label is
 * spoken. The answer is the picked `YYYY-MM-DD`, as before.
 */
const BusinessFormDateInput: React.FC<FormWebDateInputProps> = ({
  value,
  onChangeValue,
  ariaLabel,
  disabled = false,
  hasError = false,
  testID,
}) => (
  <DateField
    label=""
    accessibilityLabel={ariaLabel}
    value={value}
    onChangeValue={onChangeValue}
    disabled={disabled}
    hasError={hasError}
    testID={testID}
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
  WebDateTimeInput: BusinessFormDateInput,
  BrandCover: BusinessBrandCover,
};

