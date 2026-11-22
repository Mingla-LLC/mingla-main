/**
 * #4514 — the host-side words for brand forms, in one place (English source).
 *
 * Neighbouring Promote, trip-builder and event-edit screens keep their English
 * words next to the screen, so this does the same: one plain module, no new
 * translation pipeline. When these screens move to the locale files, this is
 * the single file to lift. Copy in quotes is exact from the approved design
 * (Design v2 to v8 on #4514).
 */

export const FORMS_COPY = {
  // Forms list
  listTitle: "Forms",
  createForm: "Create a form",
  emptyTitle: "No forms yet",
  // #4541 R6.1: the shared tab action is the only "Create a form" button.
  emptyBody: "No forms yet. Make one with Create a form, then add it to any page.",
  createFormCompact: "New",
  formsHeading: (n: number): string => `${n} ${n === 1 ? "form" : "forms"}`,
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
  // #4541 R8.3: invited scan-only staff are off unless the host turns this on.
  doorInvitedTitle: "Invited door staff can too",
  doorInvitedLine: "Off: people you invited only to scan see the marked answers only.",
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
  // #4541 R6.2: under All pages while the counts load or failed (never "(0)").
  tabNotAnsweredPlain: "Not answered",
  pageToAnswer: (title: string, n: number): string => `${title} · ${n} to answer`,
  untitledPage: "Untitled page",
  view: "View",
  // #4541 R1.2: guests who were never asked (booked on an app that couldn't show the questions).
  notAskedBanner: (m: number): string =>
    `${m} ${m === 1 ? "guest hasn't" : "guests haven't"} been asked yet.`,
  askThem: "Ask them",
  // #4541 R8.3: who opened full answers at the door (event managers and up).
  tabDoor: "Door",
  changeOrRemove: "Change or remove",
  exportCsv: "Export CSV",
  exporting: "Preparing…",
  exportedToast: "Answers export ready.",
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
  /** #4541 R4.7 / R4.8: Unknown Blast replies in Responses (replaces the old "Unverified" chip). */
  ownerAll: "All",
  ownerKnown: "Known",
  ownerUnknown: "Unknown",
  unknownName: "Unknown",
  fromCampaignOn: (campaign: string, date: string): string => `From ${campaign} · ${date}`,
  fromCampaign: (campaign: string): string => `From ${campaign}`,
  aBlast: "a Blast",
  showHidden: (n: number): string => `Show hidden (${n})`,
  hideReply: "Hide reply",
  showReply: "Show reply",
  replyHidden: "Reply hidden",
  replyShown: "Reply back in the list",
  undo: "Undo",
  hiddenChip: "Hidden",
  noUnknownReplies: "No Unknown replies.",
  /** #4541 R4.9: the Forms list card. */
  blastReplies: (n: number): string => `${n} Blast ${n === 1 ? "reply" : "replies"}`,
  allAnsweredTitle: "Everyone has answered",
  allAnsweredBody: "Nobody going is waiting on this form.",
  notAnsweredNeedsPage: "Pick a page to see who hasn’t answered.",
  notAnsweredHeadline: (n: number): string =>
    `${n} ${n === 1 ? "person" : "people"} going ${n === 1 ? "hasn’t" : "haven’t"} answered.`,
  version: (n: number): string => `v${n}`,
  moreAnswers: "Showing the latest answers.",
} as const;

/**
 * #4541 R1.2: the timing choices and their lines have ONE home,
 * utils/guestQuestionModes.ts (re-exported by utils/guestQuestionsModel.ts).
 * Re-exported here so screens keep one import; never repeated.
 */
export {
  GUEST_QUESTION_MODES,
  modeLabel,
  modeLine,
  notAskedLine,
  type ModeCopy,
} from "../../utils/guestQuestionModes";

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

/**
 * #4541 R6.2: the Not answered tab's label. Under All pages it adds up each
 * page's "to answer" from the counts read; while that read loads or failed it
 * has no number (never a wrong "(0)"). Pure; exported for tests.
 */
export function notAnsweredTabLabel(input: {
  allPages: boolean;
  pageNotAnswered: number;
  pageCounts: ReadonlyArray<{ toAnswer: number }> | null;
}): string {
  if (!input.allPages) return FORMS_COPY.tabNotAnswered(input.pageNotAnswered);
  if (input.pageCounts === null) return FORMS_COPY.tabNotAnsweredPlain;
  return FORMS_COPY.tabNotAnswered(input.pageCounts.reduce((sum, p) => sum + p.toAnswer, 0));
}

/** #4514 wave 4 — Ask guests to answer, Remind, the earlier-guests prompt (§4.6, §4.7). */
export const FORM_REQUEST_COPY = {
  askTitle: "Ask guests to answer",
  remindTitle: "Remind",
  earlierTitle: "Ask earlier guests?",
  earlierLine: (n: number): string =>
    `${n} ${n === 1 ? "person" : "people"} signed up before this form existed. Ask them to answer?`,
  askOne: "Ask to answer",
  remindOne: "Remind",
  remindAll: "Remind all",
  rowLine: "Send the form to people who signed up before it existed, or skipped it.",
  audienceLabel: "Who",
  audienceUnanswered: "Hasn't answered",
  audienceEveryone: "Everyone going",
  channelsLabel: "How",
  sms: "Text",
  channelsNote: "Texts go to guests with a phone on file; everyone else gets the email.",
  email: "Email (free)",
  /** #4541 R3 / R7.3: the Push channel follows the server's switch. */
  push: "Push (free)",
  pushLine: "Push (free) · app users on the latest version",
  pushUnavailable: "Push: not available yet",
  /** #4541 R5.5: the shared text allowance (Blast's own words). */
  monthlyLeft: (left: number, cap: number): string => `${left} of ${cap} texts left this month`,
  sharedWithBlasts: "Shared with your Blasts.",
  sendUses: (n: number): string => `This send uses ${n} ${n === 1 ? "text" : "texts"}`,
  textsOffMonthly: "Not enough texts left this month, so this send goes by email and push only.",
  textsOffDaily: "Today's text limit is reached, so this send goes by email and push only.",
  sentNoTextsToast: (n: number): string => `Sent to ${n} ${n === 1 ? "guest" : "guests"} by email and push.`,
  messageLabel: "Message",
  message: (brand: string, event: string): string =>
    `${brand} has a few questions about ${event}. Answer here: [their own link]`,
  messageBrandFallback: "Your brand",
  messageEventFallback: "this event",
  linkNote: "Each guest gets their own link. It opens only this form.",
  loading: "Checking who can be reached…",
  previewFailed: "Couldn't check who can be reached.",
  retry: "Try again",
  pickChannel: "Pick at least one way to reach them.",
  reachLine: (reachable: number, optedOut: number, unreachable: number): string =>
    `${reachable} reachable · ${optedOut} opted out of texts · ${unreachable} can't be reached`,
  throttledLine: (n: number): string =>
    `${n} ${n === 1 ? "was" : "were"} asked in the last 24 hours and won't get another yet.`,
  costLine: (amount: string): string => `Estimated cost: up to ${amount}`,
  costUnpriced: (texts: number): string =>
    `Estimated cost: ${texts} ${texts === 1 ? "text" : "texts"}; a price isn't available for every country yet.`,
  segmentsLine: (parts: number): string => `Each text is ${parts} parts (emoji and some letters make a text longer).`,
  unpricedConfirm: "Send these texts even though a price isn't available yet",
  capLine: (today: number, cap: number): string => `${today} of ${cap} form texts used in the last 24 hours.`,
  waitLine: (time: string): string => `Texts wait until ${time}: no texts before 9am or after 9pm where the event is.`,
  noCost: "No paid channel cost",
  askNow: "Ask them now",
  sendReminder: "Send reminder",
  notNow: "Not now",
  confirmLine: (n: number): string => `Send to ${n} ${n === 1 ? "guest" : "guests"}?`,
  confirm: "Send",
  back: "Back",
  sending: "Sending…",
  nobody: "No one can be reached by the channels you picked.",
  sentToast: (n: number): string => `Sent to ${n} ${n === 1 ? "guest" : "guests"}.`,
  queuedToast: (queued: number, sent: number): string =>
    `Sending to ${queued} ${queued === 1 ? "guest" : "guests"}. ${sent} sent so far; the rest go out shortly.`,
  waitingToast: (n: number): string => `${n} ${n === 1 ? "text goes" : "texts go"} out after 9am where the event is.`,
  unreachableToast: (n: number): string => `${n} can't be reached: no phone or email on file.`,
  partialToast: (sent: number, failed: number): string =>
    `Sent to ${sent}. ${failed} couldn't be reached; try them again later.`,
  noneSentToast: "Nothing was sent. Try again later.",
  sendFailed: "Couldn't send. Try again.",
  // #4541 R1.8: the off switch also stops sending.
  formsPaused: "Forms are paused right now. Try again later.",
  autoRemindTitle: "Remind people who haven't answered",
  autoRemindLine: (event: string, day: string | null): string =>
    `One reminder 2 days before each guest's date for ${event}${day !== null ? ` (next: ${day})` : ""}, by the channels ticked above.`,
  autoRemindChannels: (channels: string): string => `Stored channels: ${channels}.`,
  autoRemindCost: (cost: string): string => `Reminder texts: ${cost} at today's count.`,
  autoRemindFree: "Reminder by email only: no text cost.",
  autoRemindOnToast: "We'll remind people who haven't answered.",
  autoRemindOffToast: "Automatic reminder off.",
  autoRemindFailed: "Couldn't change the reminder. Try again.",
} as const;

/** Wave 4 review: the host's delivery log (Responses and the guest answers drawer). */
export const FORM_REQUEST_LOG_COPY = {
  open: "Delivery log",
  title: "Who got the form",
  loading: "Loading the delivery log…",
  failed: "Couldn't load the delivery log.",
  retry: "Try again",
  empty: "No requests sent yet.",
  counts: (sent: number, queued: number, failed: number, unreachable: number): string =>
    `${sent} sent · ${queued} on the way · ${failed} failed · ${unreachable} can't be reached`,
  kind: { ask: "Ask", remind: "Remind", auto: "Automatic reminder" },
  channel: { sms: "Text", email: "Email", push: "Push" },
  status: {
    queued: "On the way",
    claimed: "Sending",
    sent: "Sent",
    failed: "Failed",
    skipped: "Not sent",
    unreachable: "Can't be reached",
  },
  reason: {
    no_contact: "no phone or email on file",
    sms_opted_out: "opted out of texts",
    answered: "already answered",
    /** #4541 R1.4: the server's name since the current-holder rule; `not_a_guest` stays for older rows. */
    not_current: "no longer going",
    not_a_guest: "no longer going",
    form_closed: "the form closed",
    expired: "not delivered within a day",
    claim_expired: "not delivered after 3 tries",
    text_cap: "the day's text limit was reached",
    event_started: "their date had already started",
    /** #4541 R3.4: the push went with its email. */
    push_and_email: "push and email",
    /** #4541 R3.2: push was the only way, and their app can't open forms yet. */
    push_not_ready: "their app can't open forms yet",
  } as Record<string, string>,
  /** #4541 R5.5: a guest who was not texted because texts were off for that send. */
  notTexted: {
    no_texts_left: "Not texted: no texts left this month",
    text_cap: "Not texted: daily limit",
  } as Record<string, string>,
  run: (date: string, outcome: "sending" | "sent" | "failed" | "held_form_closed"): string =>
    `Automatic reminder for ${date}: ${
      outcome === "sent" ? "sent" : outcome === "failed" ? "failed" : outcome === "held_form_closed" ? "held, the form was closed" : "sending"
    }`,
} as const;

/** #4541 R8.3: the host's door-read log ("Door" tab on Responses). */
export const DOOR_READS_COPY = {
  title: "Who opened answers at the door",
  loading: "Loading…",
  failed: "Couldn't load who opened answers.",
  retry: "Try again",
  empty: "No one has opened answers at the door yet.",
  row: (staff: string, guest: string, time: string): string => `${staff} opened ${guest}'s answers · ${time}`,
  someone: "Someone",
  aGuest: "a guest",
} as const;

/** #4541 R1.9: the answers on guest detail and order detail. */
export const GUEST_ANSWERS_CARD_COPY = {
  title: (form: string): string => `Answers to ${form}`,
  loading: "Loading answers…",
  failed: "Couldn't load answers. Try again",
  retry: "Try again",
  notAnswered: "Not answered",
  earlierVersion: "Answered an earlier version",
} as const;

/** #4541 R4.2 / R4.3: "+ Form" in the Blast composer (picker and block). */
export const BLAST_FORM_COPY = {
  pickerTitle: "Add a form",
  pickerLine: "Only live forms of this brand can be sent.",
  liveRow: (n: number): string => `Live · ${n} ${n === 1 ? "question" : "questions"}`,
  closedRow: "Closed. Reopen it in Forms to send it again.",
  draftRow: "Draft. Publish it in Forms before you can send it.",
  empty: "No forms yet. Make one in Promote › Forms.",
  loading: "Loading your forms…",
  failed: "Couldn't load your forms.",
  retry: "Try again",
  cancel: "Cancel",
  blockLabel: "FORM",
  emailButton: (name: string): string => `Answer: ${name}`,
  smsLine: "Text adds: Answer: [their own link]",
  pushLine: "Opens the form in the Mingla app",
  ownLink: "Each person gets their own link.",
  hint: "Each person gets their own link. Replies from people we can't identify show as Unknown. Add a name question if you need to know who answered.",
  remove: "Remove the form",
  notLive: "This form isn't live. Publish or reopen it in Forms.",
  scheduledNote: "If the form closes before the send time, this Blast isn't sent.",
  aForm: "Your form",
} as const;
