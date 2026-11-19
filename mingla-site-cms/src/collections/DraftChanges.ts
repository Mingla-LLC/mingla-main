import type { CollectionConfig } from "payload";
import { noAccess } from "../lib/access";

/*
 * #4453 website workspace (build contract C) — undo and redo for the draft.
 *
 * One row per thing a change touched (a page, the look, the menu), with what
 * it was before and what it became. Rows that belong to one change share a
 * `group_id` (an owner's single edit, or every step of one Ari request), and
 * are undone and redone together. Undo writes `before` back only while the
 * target still equals `after`; redo writes `after` back only while it still
 * equals `before` (lib/draftHistory.ts).
 *
 * Written and read only by Studio's signed endpoints (overrideAccess with the
 * tenant named explicitly); not a Studio screen, never published, and it holds
 * drafts only, so nothing here can reach a visitor. The latest 200 rows per
 * site are kept.
 */
export const DRAFT_CHANGE_ACTORS = ["user", "ari", "team"] as const;
export const DRAFT_CHANGE_TARGETS = ["page", "look", "menu"] as const;
export const DRAFT_CHANGE_STATES = ["applied", "undone", "superseded"] as const;

export const DraftChanges: CollectionConfig = {
  slug: "draft-changes",
  admin: { hidden: true },
  access: {
    admin: () => false,
    create: noAccess,
    read: noAccess,
    update: noAccess,
    delete: noAccess,
    readVersions: noAccess,
    unlock: noAccess,
  },
  fields: [
    { name: "group_id", type: "text", required: true, index: true, maxLength: 36 },
    // Order within the site: every row gets the next number.
    { name: "seq", type: "number", required: true, index: true },
    { name: "label", type: "text", required: true, maxLength: 160 },
    // The name of the whole change set when the caller gave one (an Ari request).
    { name: "group_label", type: "text", maxLength: 120 },
    { name: "actor", type: "select", required: true, options: [...DRAFT_CHANGE_ACTORS] },
    { name: "actor_user_id", type: "text", maxLength: 64 },
    { name: "target", type: "select", required: true, options: [...DRAFT_CHANGE_TARGETS] },
    { name: "target_id", type: "text", maxLength: 64 },
    { name: "before", type: "json" },
    { name: "after", type: "json" },
    { name: "state", type: "select", required: true, defaultValue: "applied", options: [...DRAFT_CHANGE_STATES], index: true },
    // Typing merges into the row it continues (same person, section and field, within 30 s).
    { name: "merge_key", type: "text", maxLength: 200 },
    // The action that made the change (e.g. the design pass), so a later rule can find it.
    { name: "tool", type: "text", maxLength: 64 },
  ],
};
