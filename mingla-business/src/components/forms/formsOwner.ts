/**
 * #4514 — the ONE lazy owner of the host forms code.
 *
 * Metro hoists a module that two or more separate async chunks share into the
 * eager `__common` chunk every Host web visitor downloads first. The forms
 * screens, the "Guest questions" row and tile, the attach sheet, the service
 * and the hooks share a lot, so each entry point loads THIS module through its
 * own `import()`: they all resolve to the same module, so the whole forms
 * graph lands in one async chunk and nothing is hoisted. (Same pattern as
 * `programs/creatorProgramOwner`.) Never import this file statically.
 */

export { BrandFormsListScreen } from "./BrandFormsListScreen";
export { BrandFormBuilderScreen } from "./BrandFormBuilderScreen";
export { BrandFormResponsesScreen } from "./BrandFormResponsesScreen";
export { GuestQuestionsRow } from "./GuestQuestionsRow";
export { GuestQuestionsTile } from "./GuestQuestionsTile";
export { GuestAnswersChip, GuestAnswersPanel } from "./GuestAnswers";
