// #4382 Wave 2 — the composer's support-send body, with no React or network.
//
// Invariant I-4382-NOTE-NEVER-WAITS (declared in src/__tests__/issue4382_support_desk.implementor.test.js): An internal note is sent with isInternal true and never carries setWaiting; a reply is isInternal false; every desk send is actorMode "staff"

/**
 * The exact support-send body for the composer. A note never carries
 * setWaiting; "Send and wait" only rides on a reply.
 */
export function buildSendBody({ ticketId, mode, content, attachmentIds = [], waiting = null }) {
  const isInternal = mode === "note";
  const body = {
    ticketId,
    content: String(content || "").trim(),
    attachmentIds: [...attachmentIds],
    isInternal,
    actorMode: "staff",
  };
  if (!isInternal && waiting) {
    body.setWaiting = { nextUpdateAt: waiting.nextUpdateAt, note: String(waiting.note || "").trim() };
  }
  return body;
}

/** Who a reply goes to, in the composer's words. */
export function replyTargetLabel(ticket, { personName = "", brandName = "" } = {}) {
  if (ticket?.visibility === "brand") return brandName ? `${brandName} team` : "brand team";
  if (ticket?.visibility === "internal") return "staff";
  return personName || "customer";
}
