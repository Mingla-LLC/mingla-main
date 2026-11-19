/**
 * #4514 — which extras the ONE question builder shows. The trip questions step
 * passes nothing (TRIP_INTAKE_FEATURES, every extra off) and keeps today's
 * behaviour; the brand form builder passes BRAND_FORM_FEATURES. There is no
 * second builder: IntakeSchemaBuilder, IntakeQuestionEditor, IntakeTypePickerSheet
 * and IntakeRequiredToggle gain these props in place.
 */

export interface IntakeBuilderFeatures {
  /** "Help text (optional)" under the question label. */
  helpText: boolean;
  /** "Show only if" on a question (an earlier single-choice answer). */
  conditions: boolean;
  /** "Show at the door", its cap, first-use warning and optional door label. */
  door: boolean;
  /** File upload is drawn in the type picker but disabled ("Coming later"). */
  fileUploadLater: boolean;
  /** Who answers: drives the Required switch's helper words. */
  audience: "travelers" | "guests";
  /** The trip builder's "Ask EVERYTHING you need upfront" banner. */
  showUpfrontBanner: boolean;
  /** Brand form copy and chrome (eyebrow, empty state, no clear-all). */
  variant: "trip" | "brand_form";
  /** Longest option label. */
  optionMax: number;
}

export const TRIP_INTAKE_FEATURES: IntakeBuilderFeatures = {
  helpText: false,
  conditions: false,
  door: false,
  fileUploadLater: false,
  audience: "travelers",
  showUpfrontBanner: true,
  variant: "trip",
  optionMax: 100,
};

export const BRAND_FORM_FEATURES: IntakeBuilderFeatures = {
  helpText: true,
  conditions: true,
  door: true,
  fileUploadLater: true,
  audience: "guests",
  showUpfrontBanner: false,
  variant: "brand_form",
  optionMax: 80,
};
