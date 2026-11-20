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
  type IntakeFormRendererProps,
} from "@mingla/form-rendering";

import {
  IntakeQuestionFileUpload,
  type IntakeQuestionFileUploadProps,
} from "./IntakeQuestionFileUpload";

export { businessFormPrimitives } from "./businessFormPrimitives";
import { businessFormPrimitives } from "./businessFormPrimitives";

/** #4514 wave 6: "See all answers" on the ticket scan result (read-only renderer). */
export { DoorAnswersSheet } from "../../scanner/DoorAnswersSheet";

/** #4514 wave 5: the checkout Questions step and the after-purchase hand-off. */
export { CheckoutQuestionsStep, PurchaseFormHandoff } from "./CheckoutQuestionsStep";

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
