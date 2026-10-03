/**
 * #3655 Story 1 — shared leave-guard contract for venue suite modules.
 *
 * Each editable module registers a handle the shell consults before switching
 * sections or leaving the venue page. Clean modules never prompt.
 */

export interface VenueModuleLeaveHandle {
  /** True when the open section holds unsaved work. */
  isDirty: () => boolean;
  /** Human field labels for the leave body / dirty caption (e.g. "Phone"). */
  changedLabels: () => readonly string[];
  /** False when Save would be refused (incomplete fields, etc.). */
  isValid: () => boolean;
  /** Persist the draft. Rejects to keep the leave prompt open. */
  save: () => Promise<void>;
  /** Drop the draft without writing. */
  discard: () => void;
}

export function formatLeaveChangedBody(labels: readonly string[]): string {
  if (labels.length === 0) {
    return "If you leave without saving, those changes are gone.";
  }
  if (labels.length === 1) {
    return `You changed ${labels[0]}. If you leave without saving, those changes are gone.`;
  }
  if (labels.length === 2) {
    return `You changed ${labels[0]} and ${labels[1]}. If you leave without saving, those changes are gone.`;
  }
  const rest = labels.length - 2;
  return `You changed ${labels[0]}, ${labels[1]} and ${rest} more. If you leave without saving, those changes are gone.`;
}

export function formatUnsavedCaption(labels: readonly string[]): string {
  if (labels.length === 0) return "No changes yet";
  if (labels.length === 1) return `1 unsaved change · ${labels[0]}`;
  if (labels.length === 2) {
    return `2 unsaved changes · ${labels[0]}, ${labels[1]}`;
  }
  const shown = labels.slice(0, 2);
  const more = labels.length - 2;
  return `${labels.length} unsaved changes · ${shown[0]}, ${shown[1]} +${more} more`;
}

export function sectionLabelForModule(moduleId: string): string {
  switch (moduleId) {
    case "overview":
      return "Overview";
    case "tables":
      return "Tables";
    case "availability":
      return "Availability";
    case "reservations":
      return "Reservations";
    case "waitlist":
      return "Waitlist";
    case "menu":
      return "Menu";
    case "insights":
      return "Insights";
    case "orders":
      return "Orders";
    case "settings":
      return "Settings";
    default:
      return "venue";
  }
}
