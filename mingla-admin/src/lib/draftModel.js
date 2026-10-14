const CHANNELS = {
  email: "Email",
  whatsapp: "WhatsApp",
  instagram_dm: "Instagram DM",
  tiktok_dm: "TikTok DM",
  phone: "Phone",
  in_person: "In person",
};

export const DRAFT_STATES = [
  { value: "waiting", label: "Waiting" },
  { value: "sent", label: "Sent" },
  { value: "discarded", label: "Discarded" },
];

export function channelLabel(id) {
  return CHANNELS[id] || id || "Draft";
}

export function cleanDraftText(value) {
  return typeof value === "string" ? value.normalize("NFC").trim() : "";
}

export function draftValidation(channel, subject, body) {
  const cleanBody = cleanDraftText(body);
  const cleanSubject = cleanDraftText(subject);
  return {
    body: cleanBody.length === 0
      ? "Write a message, or discard this draft."
      : cleanBody.length > 4000 ? "Keep this message to 4,000 characters." : "",
    subject: channel === "email" && cleanSubject.length > 200
      ? "Keep this subject to 200 characters."
      : "",
    cleanBody,
    cleanSubject,
  };
}

export function draftErrorWords(error) {
  if (error?.token === "network") return "You’re offline. Reconnect and try again.";
  if (error?.token === "not_found") return "That draft is no longer available.";
  if (error?.token === "draft_edited") return "This draft was edited by its owner and can’t be changed by the agent.";
  if (error?.token === "undo_expired") return "The Undo window has ended.";
  if (error?.token === "restore_expired") return "The restore window has ended.";
  if (error?.token === "too_many_drafts") return "This record already has 3 drafts waiting. Discard one before restoring this draft.";
  if (error?.message && /\s/.test(error.message)) return error.message;
  return "That didn’t work. Try again.";
}

export function remainingUndoMs(sentAt, now = Date.now()) {
  const at = Date.parse(sentAt || "");
  return Number.isFinite(at) ? Math.max(0, at + 60_000 - now) : 0;
}

export async function copyThenMark({ body, copy, mark }) {
  const copied = await copy(body);
  if (!copied) return { copied: false, marked: false };
  try {
    await mark(body);
    return { copied: true, marked: true };
  } catch (error) {
    return { copied: true, marked: false, error };
  }
}
