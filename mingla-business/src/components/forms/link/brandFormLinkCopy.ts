/**
 * #4514 wave 3 — the guest link page's words (Design v2–v8 "link page"; C2;
 * decision 12). English in one module, as the other forms screens. No vendor
 * names. A form link never dead-ends: there is no "ask for a new link".
 */

export const LINK_COPY = {
  loading: "Loading your questions…",
  answeringAs: (name: string): string => `Answering as ${name}`,
  notYou: "Not you?",
  notYouTitle: "This link is just for one person",
  notYouBody: (name: string): string =>
    `Answers sent from this page are saved as ${name}'s. If you're not ${name}, close this page. The host can send you your own link.`,
  notYouClose: "Got it",
  send: "Send answers",
  saveChanges: "Save changes",
  saving: "Saving…",
  needsAnswers: "Answer the required questions to continue",
  // #4514 wave 5 — opened right after a purchase (§5.5).
  purchaseStrip: "You're in. Your ticket is waiting in the Mingla app.",
  purchaseOneMore: (brand: string): string =>
    brand.length > 0 ? `One more thing from ${brand}` : "One more thing",
  purchaseContinue: "Go to my tickets",
  saveFailed: "Couldn't save your answers. Check your connection and try again.",
  saveRateLimited: "Too many tries from here. Wait a few minutes, then try again.",
  saveStale: "Updated elsewhere. Reload.",
  saveChanged: "The host changed these questions. Reload to see the new ones.",
  saveInvalid: "Some answers need another look.",
  retry: "Try again",
  reload: "Reload",

  savedTitle: (first: string | null): string =>
    first !== null ? `Thanks, ${first}. Your answers are saved.` : "Thanks. Your answers are saved.",
  savedBody: "You can change them until the host closes the form.",
  editAnswers: "Edit answers",
  appTitle: "Keep it all in one place",
  appBody: "Your tickets and answers are in the Mingla app too.",
  openInApp: "Open in the Explorer app",

  codeAnsweredTitle: "You've answered before",
  codeAnsweredBody: "To see or change your answers, we'll send a one-time code to the contact the host has for you.",
  codeClosedTitle: "This form is closed",
  codeClosedBody: "To see your last answers, we'll send a one-time code to the contact the host has for you.",
  codeLapsedTitle: "Confirm it's you",
  codeLapsedBody: "It's been a while since this link was sent. Confirm it's you with a one-time code, then carry on.",
  sendCode: "Send me a code",
  sending: "Sending…",
  enterCode: (to: string): string => `Enter the 6-digit code we sent to ${to}.`,
  codeLabel: "One-time code",
  checkCode: "Continue",
  checking: "Checking…",
  sendNewCode: "Send a new code",
  textInstead: "Text me instead",
  emailInstead: "Email me instead",
  codeBad: (left: number | null): string =>
    left === null ? "That code didn't match." : `That code didn't match. ${left} ${left === 1 ? "try" : "tries"} left.`,
  codeExpired: "That code has expired. Send a new one.",
  codeLocked: "Too many tries. Send a new code.",
  codeRateLimited: "Too many codes asked for. Wait a few minutes, then try again.",
  codeNoContact: "There's no contact on file to send a code to. Reply to the message this link came in.",
  codeSendFailed: "Couldn't send the code. Try again.",
  codeFailed: "Something went wrong checking the code. Try again.",

  closedTitle: "This form is closed",
  closedBody: "The host isn't taking answers any more.",
  closedLast: "This form is closed. Here are your last answers.",
  notAnswered: "Not answered",

  invalidTitle: "This link doesn't work",
  invalidBody: "Check you opened the whole link from your message. Personal links only work for the form they were sent for.",
  pausedTitle: "Questions are paused",
  pausedBody: "The host's questions aren't available right now. Try again a little later.",
  loadFailedTitle: "Couldn't load your questions",
  loadFailedBody: "Check your connection and try again.",

  // #4541 R8.2: an older personal link after a newer one was sent.
  replacedTitle: "This link has been replaced",
  replacedBody: (brand: string): string =>
    brand.length > 0
      ? `${brand} sent you a newer link. Open the latest message from ${brand}.`
      : "The host sent you a newer link. Open the latest message from them.",

  // #4541 R4.4 / R4.5: a Blast form with no personal link (Unknown replies).
  unknownNotice: (brand: string): string =>
    `${brand.length > 0 ? brand : "The host"} won't see who you are, only your answers. Got this by text or email? Use the link in that message.`,
  unknownSavedTitle: "Thanks. Your answers are in.",
  unknownSavedBody: "The host sees your answers, not who you are.",
  unknownLimitTitle: "This form isn't taking more answers right now.",
  unknownLimitBody: "Got this by text or email? Use the link in that message.",
  botCheckFailed: "Something went wrong. Reload and try again.",
  codeUnavailableBody: "We can't send a code for this message. You can still answer without confirming; the host will see your answers as Unknown.",
  answerWithoutConfirming: "Answer without confirming",
  honeypotLabel: "Leave this field empty",
} as const;
