// Issue #4383 — the Communications Overview's words for each kind of item.
//
// Pure module: no React, no Supabase, so the plain node tests run it.

/** Every kind the Overview lists (issue_4383_scheduled_communications). */
export const COMMUNICATIONS_KINDS = Object.freeze({
  push: Object.freeze({ label: "Push", tone: "brand", noun: "push" }),
  announcement: Object.freeze({ label: "Announcement", tone: "info", noun: "announcement" }),
  roadmap_card: Object.freeze({ label: "Roadmap card", tone: "success", noun: "roadmap card" }),
  roadmap_notice: Object.freeze({ label: "Roadmap notice", tone: "success", noun: "notice" }),
  email: Object.freeze({ label: "Email", tone: "warning", noun: "email" }),
  blog: Object.freeze({ label: "Blog post", tone: "default", noun: "blog post" }),
});

/** "Cancel this push?" — the noun for a kind. */
export function cancelKindLabel(kind) {
  return COMMUNICATIONS_KINDS[kind]?.noun || "item";
}

/** What a Needs attention row says went wrong. Never a bare code alone. */
export function attentionWords(item) {
  if (item?.problem === "late") return "Its time passed more than five minutes ago and it has not gone out.";
  if (item?.problem === "push_failed") {
    const failed = Number(item?.detail?.push_failed) || 0;
    const delivered = Number(item?.detail?.inapp_delivered) || 0;
    return `${failed} phone${failed === 1 ? "" : "s"} did not accept the push. ${delivered} bell item${delivered === 1 ? "" : "s"} landed.`;
  }
  const reason = typeof item?.detail === "string" && item.detail.trim() ? item.detail.trim() : "no reason was recorded";
  return `It did not go out: ${reason}.`;
}
