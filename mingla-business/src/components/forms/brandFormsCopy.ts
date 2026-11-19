/**
 * #4514 — the host-side words for brand forms, in one place (English source).
 *
 * Neighbouring Promote, trip-builder and event-edit screens keep their English
 * words next to the screen, so this does the same: one plain module, no new
 * translation pipeline. When these screens move to the locale files, this is
 * the single file to lift. Copy in quotes is exact from the approved design
 * (Design v2 to v8 on #4514).
 */

import type { BrandFormMode } from "../../services/brandFormsService";

export const FORMS_COPY = {
  // Forms list
  listTitle: "Forms",
  createForm: "Create a form",
  emptyTitle: "No forms yet",
  emptyBody:
    "Build one form, then add it to any RSVP, event, experience or trip. Guests answer once; you see answers next to each guest.",
  notOnAnyPage: "Not on any page yet",
  publishToAdd: "Publish it to add it to a page",
  continueEditing: "Continue editing",
  edit: "Edit",
  responses: "Responses",
  reopen: "Reopen",
  listLoadFailedTitle: "Couldn't load your forms",
  listLoadFailedBody: "Check your connection and try again.",
  tryAgain: "Try again",
  statusDraft: "Draft",
  statusLive: "Live",
  statusClosed: "Closed",
  nameSheetTitle: "Name your form",
  nameSheetHint: "Only your team sees the name. Guests see the questions.",
  nameFieldLabel: "Form name",
  nameFieldPlaceholder: "e.g. Open mic sign-up",
  cancel: "Cancel",
  create: "Create",
  creating: "Creating…",

  // Builder
  untitledForm: "Untitled form",
  formNameLabel: "Form name",
  saveDraft: "Save draft",
  publish: "Publish",
  publishChanges: "Publish changes",
  closeForm: "Close form",
  saving: "Saving…",
  publishing: "Publishing…",
  tabEdit: "Edit",
  tabPreview: "Preview",
  staleBanner: "Someone else changed this form. Reload.",
  reload: "Reload",
  closedBanner: "This form is closed. Guests can’t answer; answers are kept.",
  questionsLabel: "Questions",
  noQuestionsTitle: "No questions yet",
  noQuestionsBody: "Add the first one. Most forms need three or four.",
  questionCount: (n: number): string => `${n} of 20 questions`,
  maxQuestions: "20 questions is the most a form can have.",
  previewTitle: "What guests see",
  previewEmpty: "Questions appear here as you add them.",
  previewLoading: "Loading the preview…",
  previewNote: "Preview only. Nothing is saved.",
  previewNeedsAnswers: "Answer the required questions",
  previewSend: "Send answers",
  unpublishedChanges: "unpublished changes",
  live: "live",
  doorFullTitle: "Door staff can open full answers",
  doorFullLine: "Turn off for private questions. Door staff will then see only the answers you marked.",
  doorFullScope: "For the whole form · managers can always open answers",
  loadFailedTitle: "Couldn't load this form",
  savedToast: "Draft saved.",
  publishedToast: "Published. Guests now see this version.",
  closedToast: "Form closed. Answers are kept.",
  reopenedToast: "Form reopened.",
  closeConfirmTitle: "Close this form?",
  closeConfirmBody:
    "Guests won’t be able to answer or change answers. Links and the sign-up step will say “This form is closed”. Answers are kept and you can reopen it any time.",
  keepOpen: "Keep open",

  // Question editor additions
  helpLabel: "Help text (optional)",
  helpPlaceholder: "A short hint under the question",
  doorTitle: "Show at the door",
  doorLabelField: "Label at the door (optional)",
  doorLabelPlaceholder: "e.g. Performing",
  doorFirstUseTitle: "Door staff will see this answer when they scan.",
  doorFirstUseBody:
    "The marked answers show automatically on the scan result. Guests see “Shown to door staff” under this question.",
  gotIt: "Got it",
  turnOff: "Turn off",
  doorTag: "DOOR",
  showOnlyIfTitle: "Show only if",
  showOnlyIfFirst: "The first question is always shown.",
  showOnlyIfNoSource: "Add a single-choice question above this one to use a condition.",
  showOnlyIfHint: "Show this question only after a certain answer.",
  whenThisQuestion: "When this question…",
  isAnswered: "…is answered",
  hiddenNote: "While hidden, this question is never required and any answer is dropped.",
  fileLater: "Coming later",
  onlyIfTag: (n: number, option: string): string => `ONLY IF Q${n} IS ${option.toUpperCase()}`,
  dependsOn: (nums: number[]): string =>
    `Q${nums.join(", Q")} ${nums.length === 1 ? "depends" : "depend"} on this question.`,
  conditionCleared: (nums: number[]): string =>
    `Removed the "Show only if" on Q${nums.join(", Q")} because the question or option it used changed.`,

  // Responses
  responsesTitle: "Responses",
  tabSummary: "Summary",
  tabResponses: (n: number): string => `Responses (${n})`,
  tabNotAnswered: (n: number): string => `Not answered (${n})`,
  changeOrRemove: "Change or remove",
  exportCsv: "Export guests and answers",
  exporting: "Preparing…",
  exportPreparing: "Preparing the guest export with answers…",
  exportStillPreparing: "The export is still being prepared. Tap Export again shortly to check it.",
  exportedToast: "Guest export with answers ready.",
  exportFailed: "Couldn't prepare the export. Try again.",
  answeredEarlier: "Answered an earlier version",
  noAnswersYet: "No answers yet",
  noAnswersBody: "Answers appear here as guests respond.",
  allPages: "All pages",
  answeredCount: (n: number): string => `${n} answered`,
  toAnswerCount: (n: number): string => `${n} to answer`,
  answersCount: (n: number): string => `${n} answers`,
  notAnsweredChip: "Not answered",
  addedByYou: "Added by you",
  viaLink: "via link",
  allAnsweredTitle: "Everyone has answered",
  allAnsweredBody: "Nobody going is waiting on this form.",
  notAnsweredNeedsPage: "Pick a page to see who hasn’t answered.",
  notAnsweredHeadline: (n: number): string =>
    `${n} ${n === 1 ? "person" : "people"} going ${n === 1 ? "hasn’t" : "haven’t"} answered.`,
  version: (n: number): string => `v${n}`,
  moreAnswers: "Showing the latest answers.",
} as const;

export interface ModeCopy {
  value: BrandFormMode;
  label: string;
  line: string;
}

/** The three timing choices, in the order they are shown. Exact copy. */
export const GUEST_QUESTION_MODES: readonly ModeCopy[] = [
  { value: "optional_on_page", label: "On the page, optional", line: "Guests can answer if they want." },
  { value: "required_step", label: "On the page, required", line: "Guests must answer before they finish." },
  { value: "after_purchase", label: "After they purchase", line: "Guests are taken to the form right after." },
];

/** The label for a mode; "After they RSVP" on RSVP pages. */
export function modeLabel(mode: BrandFormMode, isRsvp: boolean): string {
  if (mode === "after_purchase" && isRsvp) return "After they RSVP";
  const found = GUEST_QUESTION_MODES.find((m) => m.value === mode);
  return found?.label ?? "On the page, required";
}

export const ATTACH_COPY = {
  rowTitle: "Guest questions",
  rowNone: "Not set up",
  rowNotPublished: "Draft, publish it to start asking",
  rowLoading: "Loading…",
  rowFailed: "Unable to load",
  sheetTitle: "Guest questions",
  formSection: "Form",
  createNew: "Create a new form",
  whenSection: "When guests answer",
  pickFirst: "Pick a form first.",
  draftHint: "Draft · publish it first",
  closedHint: "Closed · reopen it in Forms",
  questionsHint: (n: number): string => `${n} ${n === 1 ? "question" : "questions"}`,
  save: "Save",
  saving: "Saving…",
  cancel: "Cancel",
  remove: "Remove",
  removing: "Removing…",
  savedToast: "Guest questions saved.",
  removedToast: "Form removed from this page.",
  tripNote: "Trips keep their own questions step for now.",
  noFormsTitle: "No forms yet",
  noFormsBody: "Create one here, or build it in Promote › Forms.",
  loadFailed: "Couldn't load your forms.",
  needsEventManager: "Only an event manager or above can change guest questions.",
} as const;

export const TILE_COPY = {
  label: "Guest questions",
  none: "Not set up",
  closed: "Closed",
  draft: "Not published",
  loading: "Loading…",
  failed: "Unable to load",
  toAnswer: (n: number): string => `${n} to answer`,
  answered: (n: number): string => `${n} answered`,
  answeredOf: (n: number, total: number): string => `${n} of ${total}`,
} as const;

/** Wave 3: "{n} answered · {m} to answer" on a published form's card; null while loading or failed. */
export function formCountsLine(c: { answered: number; toAnswer: number } | undefined): string | null {
  if (c === undefined) return null;
  return c.toAnswer > 0
    ? `${FORMS_COPY.answeredCount(c.answered)} · ${FORMS_COPY.toAnswerCount(c.toAnswer)}`
    : FORMS_COPY.answeredCount(c.answered);
}
