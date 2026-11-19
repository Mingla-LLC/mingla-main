/**
 * #4514 — the kit the brand form builder screen hands to the ONE question
 * builder (see IntakeBrandFormKit). It lives here, not in the trip builder's
 * own files, so the trip builder and the eager Host web bundle never import
 * the brand form rules, words or extra editor fields. Only the lazily loaded
 * forms owner reaches this file.
 */

import {
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
import { IntakeBrandFormFields, IntakeHelpTextField } from "../trip/IntakeBrandFormFields";
import { IntakeQuestionBrandTags } from "../trip/IntakeQuestionBrandTags";
import type { IntakeBuilderFeatures, IntakeBrandFormKit } from "../trip/intakeBuilderFeatures";
import { FORMS_COPY } from "./brandFormsCopy";

export const BRAND_FORM_KIT: IntakeBrandFormKit = {
  HelpTextField: IntakeHelpTextField,
  BrandFormFields: IntakeBrandFormFields,
  QuestionTags: IntakeQuestionBrandTags,
  sanitizeShowIf,
  moveQuestion,
  conditionSources,
  dependentNumbers,
  doorQuestionCount,
  isDoorType,
  addOptionTo,
  removeOptionFrom,
  moveOptionIn,
  dropBlankOptions,
  withOptionIds,
  newOptionId,
  questionCount: FORMS_COPY.questionCount,
  noQuestionsTitle: FORMS_COPY.noQuestionsTitle,
  noQuestionsBody: FORMS_COPY.noQuestionsBody,
  conditionCleared: FORMS_COPY.conditionCleared,
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
  kit: BRAND_FORM_KIT,
};
