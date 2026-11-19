/**
 * #4514 — which extras the ONE question builder shows. The trip questions step
 * passes nothing (TRIP_INTAKE_FEATURES, every extra off) and keeps today's
 * behaviour; the brand form builder passes BRAND_FORM_FEATURES. There is no
 * second builder: IntakeSchemaBuilder, IntakeQuestionEditor, IntakeTypePickerSheet
 * and IntakeRequiredToggle gain these props in place.
 */

import type { ComponentType } from "react";

import type {
  addOptionTo,
  conditionSources,
  dependentNumbers,
  doorQuestionCount,
  dropBlankOptions,
  isDoorType,
  moveOptionIn,
  moveQuestion,
  newOptionId,
  removeOptionFrom,
  sanitizeShowIf,
  withOptionIds,
} from "../../utils/brandFormDefinition";
import type {
  IntakeBrandFormFieldsProps,
  IntakeHelpTextFieldProps,
} from "./IntakeBrandFormFields";
import type { IntakeQuestionBrandTagsProps } from "./IntakeQuestionBrandTags";

/**
 * #4514 — everything brand forms add to the ONE builder, passed in as a kit so
 * the trip builder (and the eager Host web bundle it sits in) never imports
 * any of it. Only the brand form builder screen, which loads on demand,
 * creates the kit (`forms/brandFormBuilderKit.ts`). Types only here.
 */
export interface IntakeBrandFormKit {
  HelpTextField: ComponentType<IntakeHelpTextFieldProps>;
  BrandFormFields: ComponentType<IntakeBrandFormFieldsProps>;
  QuestionTags: ComponentType<IntakeQuestionBrandTagsProps>;
  sanitizeShowIf: typeof sanitizeShowIf;
  moveQuestion: typeof moveQuestion;
  conditionSources: typeof conditionSources;
  dependentNumbers: typeof dependentNumbers;
  doorQuestionCount: typeof doorQuestionCount;
  isDoorType: typeof isDoorType;
  addOptionTo: typeof addOptionTo;
  removeOptionFrom: typeof removeOptionFrom;
  moveOptionIn: typeof moveOptionIn;
  dropBlankOptions: typeof dropBlankOptions;
  withOptionIds: typeof withOptionIds;
  newOptionId: typeof newOptionId;
  /** Builder words. */
  questionCount: (n: number) => string;
  noQuestionsTitle: string;
  noQuestionsBody: string;
  conditionCleared: (numbers: number[]) => string;
}

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
  /** The brand form additions; absent for trips. */
  kit?: IntakeBrandFormKit;
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
