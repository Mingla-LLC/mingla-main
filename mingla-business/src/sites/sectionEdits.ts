/**
 * #4453 Website workspace — what an edit does to the list of sections BEFORE
 * the server answers (optimistic), and the plain label each change carries
 * into history ("Undo: Move Pick a time"). Pure.
 */
import type { SectionEdit, WorkspaceSection } from "./contentApi";

const reindex = (sections: WorkspaceSection[]): WorkspaceSection[] => sections.map((section, index) => (section.index === index ? section : { ...section, index }));

/** A person changed it: the section reads as reviewed from now on. */
const stampedByPerson = (section: WorkspaceSection): WorkspaceSection =>
  section.review && section.review.state === "draft" ? { ...section, review: { state: "reviewed", source: "person" } } : section;

export function applyFieldEdits(sections: readonly WorkspaceSection[], sectionId: string, edits: readonly SectionEdit[]): WorkspaceSection[] {
  return sections.map((section) => {
    if (section.id !== sectionId) return section;
    const byKey = new Map(edits.map((edit) => [edit.key, edit.value]));
    return stampedByPerson({ ...section, fields: section.fields.map((field) => (byKey.has(field.key) ? { ...field, value: byKey.get(field.key)! } : field)) });
  });
}

export function applyLayout(sections: readonly WorkspaceSection[], sectionId: string, layout: string): WorkspaceSection[] {
  return sections.map((section) => (section.id === sectionId ? stampedByPerson({ ...section, layout }) : section));
}

export function applyReviewed(sections: readonly WorkspaceSection[], sectionIds: readonly string[] | "all"): WorkspaceSection[] {
  return sections.map((section) => (sectionIds === "all" || sectionIds.includes(section.id) ? stampedByPerson(section) : section));
}

export function applyMove(sections: readonly WorkspaceSection[], sectionId: string, toIndex: number): WorkspaceSection[] {
  const from = sections.findIndex((section) => section.id === sectionId);
  if (from < 0) return [...sections];
  const target = Math.max(0, Math.min(toIndex, sections.length - 1));
  if (target === from) return [...sections];
  const next = [...sections];
  const [moved] = next.splice(from, 1);
  next.splice(target, 0, moved!);
  return reindex(next);
}

export function applyRemove(sections: readonly WorkspaceSection[], sectionId: string): WorkspaceSection[] {
  return reindex(sections.filter((section) => section.id !== sectionId));
}

export function applyMedia(sections: readonly WorkspaceSection[], sectionId: string, slot: string, media: { id: string; thumbUrl: string | null }): WorkspaceSection[] {
  return sections.map((section) => (section.id === sectionId
    ? stampedByPerson({ ...section, media: section.media.map((entry) => (entry.slot === slot ? { ...entry, media_id: media.id, thumb_url: media.thumbUrl } : entry)) })
    : section));
}

/** Why a section cannot move that way (null: it can). Every disabled control says why. */
export function moveBlocked(sections: readonly WorkspaceSection[], sectionId: string, direction: -1 | 1): string | null {
  const index = sections.findIndex((section) => section.id === sectionId);
  if (index < 0) return "This section is no longer on the page.";
  if (direction === -1 && index === 0) return "Already at the top.";
  if (direction === 1 && index === sections.length - 1) return "Already at the bottom.";
  return null;
}

export function removeBlocked(section: Pick<WorkspaceSection, "can_remove" | "label">): string | null {
  return section.can_remove ? null : `Your website needs “${section.label}”, so it stays.`;
}

/** The plain label a change carries into history and the Undo tooltip. */
export const changeLabel = {
  edit: (label: string) => `Edit ${label}`,
  layout: (label: string) => `Change the layout of ${label}`,
  move: (label: string) => `Move ${label}`,
  remove: (label: string) => `Remove ${label}`,
  add: (label: string) => `Add ${label}`,
  photo: (label: string) => `Change a photo in ${label}`,
  look: (what: string) => `Change ${what}`,
  page: (title: string, enabled: boolean) => `${enabled ? "Turn on" : "Turn off"} ${title}`,
} as const;

export function undoTooltip(kind: "undo" | "redo", label: string | null | undefined, available: boolean): string {
  const word = kind === "undo" ? "Undo" : "Redo";
  if (!available) return kind === "undo" ? "Nothing to undo yet" : "Nothing to redo";
  return label ? `${word}: ${label}` : word;
}

/** A field's help line: what the section does for itself, so nobody edits what cannot stick. */
export function feedNote(section: Pick<WorkspaceSection, "feed" | "label">): string | null {
  return section.feed ? "This section fills itself from your Mingla listings, so prices, dates and times are always right." : null;
}

export function unreadCount(sections: readonly Pick<WorkspaceSection, "review">[]): number {
  return sections.filter((section) => section.review?.state === "draft").length;
}
