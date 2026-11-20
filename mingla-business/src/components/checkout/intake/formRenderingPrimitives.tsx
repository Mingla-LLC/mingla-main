/**
 * #4514 C11 — the business app's own visual primitives, injected into
 * `@mingla/form-rendering`. Nothing is copied into the package: the renderers
 * draw with these exact components and tokens, so any change to them (theme,
 * context-driven colours) reaches every question.
 *
 * This module is also the ONE lazy owner of the question renderers on Host
 * web. The trip checkout questions screen and the brand form preview both
 * reach the package through `import()` of THIS module, so the package, these
 * primitives and the file upload question land in one async chunk. A static
 * import from two lazy chunks would make Metro hoist the renderers (~13 KB raw)
 * into the eager `__common` chunk every Host web visitor downloads first.
 * Never import this module statically (`import type` is fine).
 */

import React from "react";
import {
  IntakeFormRenderer,
  BrandFormRenderer,
  type BrandFormRendererProps,
  BrandHeader,
  type BrandHeaderProps,
  type FormBrandCoverProps,
  type FormRenderingPrimitives,
  type IntakeFormRendererProps,
} from "@mingla/form-rendering";

import { radius, space, type } from "../../../constants/designSystem";
import { activeSurfaceTokens, themed } from "../../../theme/surfaceTokens";
import { EventCoverMedia } from "../../ui/EventCoverMedia";
import { Icon } from "../../ui/Icon";
import { WebDateTimeInput } from "../../ui/WebDateTimeInput";
import {
  IntakeQuestionFileUpload,
  type IntakeQuestionFileUploadProps,
} from "./IntakeQuestionFileUpload";

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

/** #4514 wave 3: the header fields of a server read, mapped for BrandHeader (link page). */
export { brandHeaderFromServer } from "@mingla/form-rendering";

/** #4514 wave 3: the brand form (show only if, the door line) with the business primitives. */
export const BusinessBrandForm: React.FC<Omit<BrandFormRendererProps, "primitives">> = (props) => (
  <BrandFormRenderer {...props} primitives={businessFormPrimitives} />
);

/** #4514 wave 3: the brand header (full or the 60 px strip) with the business primitives. */
export const BusinessBrandHeader: React.FC<Omit<BrandHeaderProps, "primitives">> = (props) => (
  <BrandHeader {...props} primitives={businessFormPrimitives} />
);

export interface BusinessIntakeFormProps
  extends Omit<IntakeFormRendererProps, "primitives" | "renderFileUpload"> {
  /**
   * File upload callbacks (trip checkout). Without them a file question is
   * skipped, exactly as the package does when no `renderFileUpload` is given
   * (the brand form preview).
   */
  fileUpload?: Pick<IntakeQuestionFileUploadProps, "onUpload" | "onRemove">;
}

/** The package renderer with the business primitives and file upload injected. */
export const BusinessIntakeForm: React.FC<BusinessIntakeFormProps> = ({
  fileUpload,
  ...rendererProps
}) => (
  <IntakeFormRenderer
    {...rendererProps}
    primitives={businessFormPrimitives}
    renderFileUpload={
      fileUpload === undefined
        ? undefined
        : (fileProps) => (
            <IntakeQuestionFileUpload
              question={fileProps.question}
              value={fileProps.value}
              onChange={fileProps.onChange}
              error={fileProps.error}
              disabled={fileProps.disabled}
              primitives={businessFormPrimitives}
              onUpload={fileUpload.onUpload}
              onRemove={fileUpload.onRemove}
            />
          )
    }
  />
);
