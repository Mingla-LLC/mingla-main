// Issue #4255 — shared email drafts.
//
// Drafts live on the server (public.admin_email_drafts) so the whole team can
// read them. This browser keeps one thing only: a crash-recovery copy of the
// draft that is open and not yet saved, cleared on save, send and sign-out.
// A draft saved by the old browser-only composer is moved to the server once.
//
// Pure module: no React, no Supabase. Storage is passed in so tests can use a
// plain object.

import {
  EMAIL_DRAFT_KEY,
  EMAIL_DRAFT_VERSION,
  LEGACY_EMAIL_DRAFT_KEYS,
  restoreDraftAudience,
} from "./emailDraftAudience.js";

export const EMAIL_DRAFT_RECOVERY_KEY = "mingla_admin_email_draft_recovery_v3";
export const EMAIL_DRAFT_RECOVERY_VERSION = 3;
// Set once this browser's old local draft has been moved to the server.
export const EMAIL_DRAFT_MIGRATED_KEY = "mingla_admin_email_draft_migrated_v1";

export const DRAFT_STATUSES = Object.freeze(["draft", "ready_for_review"]);
export const DRAFT_STATUS_LABELS = Object.freeze({
  draft: "Draft",
  ready_for_review: "Ready for review",
});

const DEFAULT_BODY = "<p>Hi {first_name},</p><p>Write your update here.</p>";

function safeGet(storage, key) {
  try {
    return storage?.getItem?.(key) ?? null;
  } catch {
    return null;
  }
}

function safeSet(storage, key, value) {
  try {
    storage?.setItem?.(key, value);
    return true;
  } catch {
    return false;
  }
}

function safeRemove(storage, key) {
  try {
    storage?.removeItem?.(key);
  } catch {
    // Storage can be unavailable (private window); nothing to remove then.
  }
}

function parse(raw) {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

/** The audience a draft stores: only what restoreDraftAudience can read back. */
export function draftAudienceSnapshot({ audienceMode, filters, selectedRecipient }) {
  return {
    audienceMode: audienceMode === "person" ? "person" : "segment",
    filters: filters && typeof filters === "object" ? { ...filters } : {},
    selectedRecipient: audienceMode === "person" && selectedRecipient ? selectedRecipient : null,
  };
}

/** What a save sends: the composer's state as the table stores it. */
export function draftPayload({ subject, documentValue, audienceMode, filters, selectedRecipient, status }) {
  return {
    subject: typeof subject === "string" ? subject.slice(0, 300) : "",
    document: Array.isArray(documentValue) ? documentValue : [],
    audience: draftAudienceSnapshot({ audienceMode, filters, selectedRecipient }),
    status: DRAFT_STATUSES.includes(status) ? status : "draft",
  };
}

/** A stable fingerprint of a payload, to tell saved from unsaved. */
export function draftFingerprint(payload) {
  return JSON.stringify([payload.subject, payload.document, payload.audience]);
}

/**
 * The composer state a stored draft opens to. The audience goes through
 * restoreDraftAudience, so a draft never pre-selects an Explorer-reaching
 * audience: that always needs a fresh choice and a count review.
 */
export function composerStateFromDraft(draft, defaultFilters) {
  const audience = draft?.audience && typeof draft.audience === "object" ? draft.audience : {};
  const restored = restoreDraftAudience(audience, defaultFilters);
  return {
    subject: typeof draft?.subject === "string" ? draft.subject : "",
    document: Array.isArray(draft?.document) && draft.document.length ? draft.document : null,
    audienceMode: restored.audienceMode,
    filters: restored.filters,
    selectedRecipient: restored.audienceMode === "person" ? audience.selectedRecipient || null : null,
  };
}

/** Does a saved composer copy hold anything worth keeping? */
export function hasDraftContent(saved) {
  if (!saved || typeof saved !== "object") return false;
  if (typeof saved.subject === "string" && saved.subject.trim()) return true;
  const blocks = Array.isArray(saved.document) ? saved.document : [];
  return blocks.some((block) => {
    if (!block || typeof block !== "object") return false;
    if (block.type === "rich_text") {
      const html = String(block.html || "");
      return html !== DEFAULT_BODY && html.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim() !== "";
    }
    return block.type === "image" || block.type === "blog_post";
  });
}

/**
 * The old browser-only draft to move to the server, or null. Read once per
 * browser: after a successful move the caller calls markLegacyDraftMigrated.
 */
export function legacyDraftToMigrate(storage) {
  if (safeGet(storage, EMAIL_DRAFT_MIGRATED_KEY)) return null;
  let saved = parse(safeGet(storage, EMAIL_DRAFT_KEY));
  for (const key of LEGACY_EMAIL_DRAFT_KEYS) {
    if (!saved) saved = parse(safeGet(storage, key));
  }
  if (!saved || ![1, EMAIL_DRAFT_VERSION].includes(saved.version)) return null;
  return hasDraftContent(saved) ? saved : null;
}

/** The old local draft is on the server now: forget it in this browser. */
export function markLegacyDraftMigrated(storage) {
  safeSet(storage, EMAIL_DRAFT_MIGRATED_KEY, "1");
  safeRemove(storage, EMAIL_DRAFT_KEY);
  for (const key of LEGACY_EMAIL_DRAFT_KEYS) safeRemove(storage, key);
}

/** The payload a legacy local draft is saved as. */
export function legacyDraftPayload(saved) {
  return draftPayload({
    subject: saved.subject,
    documentValue: saved.document,
    audienceMode: saved.audienceMode,
    filters: saved.filters,
    selectedRecipient: saved.selectedRecipient,
    status: "draft",
  });
}

export function readRecoveryCopy(storage) {
  const saved = parse(safeGet(storage, EMAIL_DRAFT_RECOVERY_KEY));
  if (!saved || saved.version !== EMAIL_DRAFT_RECOVERY_VERSION) return null;
  return hasDraftContent(saved) ? saved : null;
}

export function writeRecoveryCopy(storage, state) {
  return safeSet(storage, EMAIL_DRAFT_RECOVERY_KEY, JSON.stringify({
    version: EMAIL_DRAFT_RECOVERY_VERSION,
    draftId: state.draftId || null,
    revision: Number.isInteger(state.revision) ? state.revision : null,
    subject: state.subject,
    document: state.documentValue,
    audienceMode: state.audienceMode,
    filters: state.filters,
    selectedRecipient: state.selectedRecipient,
  }));
}

export function clearRecoveryCopy(storage) {
  safeRemove(storage, EMAIL_DRAFT_RECOVERY_KEY);
}

/**
 * Sign-out: the unsaved recovery copy goes. An old local draft that has not
 * been moved to the server yet is kept on purpose: it moves (and is removed)
 * the next time its owner opens Email, so signing out never loses it.
 */
export function clearEmailDraftStorage(storage) {
  safeRemove(storage, EMAIL_DRAFT_RECOVERY_KEY);
}

/**
 * May this person save or delete the draft? The author, or an active full
 * admin (owner, admin, Founding partner). The server decides the same way.
 */
export function canEditDraft(draft, { userId, isAdmin }) {
  if (!draft) return true;
  return Boolean(isAdmin) || (Boolean(userId) && draft.author_id === userId);
}

/** "You" or the author's name from their address. */
export function draftAuthorLabel(draft, myEmail) {
  const email = String(draft?.author_email || "").toLowerCase();
  if (!email) return "Someone on the team";
  if (myEmail && email === String(myEmail).toLowerCase()) return "You";
  const local = email.split("@")[0] || email;
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || email;
}

/** Plain-English message for a failed draft save or delete. */
export function draftErrorMessage(error) {
  const text = `${error?.code || ""} ${error?.message || ""}`;
  if (/PT409|draft_changed/.test(text)) {
    return "Someone saved this draft after you opened it. Load their version, or save yours as a copy.";
  }
  if (/42501|forbidden/.test(text)) {
    return "Only the person who wrote this draft, or an admin, can change it. Save yours as a copy instead.";
  }
  if (/P0002|not_found/.test(text)) return "This draft was deleted. Save yours as a new draft.";
  return error?.message || "The draft could not be saved. Check your connection and try again.";
}

export function isDraftConflict(error) {
  return /PT409|draft_changed/.test(`${error?.code || ""} ${error?.message || ""}`);
}
