/**
 * #4453 Website workspace — the ONE status chip and the ONE Publish button.
 * Pure: the chip always says the state in words (never colour alone) and the
 * Publish panel's final button always names the thing in the way.
 */
export type WorkspaceStatusInput = {
  /** A version is live for visitors. */
  live: boolean;
  offline: boolean;
  /** Changes on the draft that visitors do not see yet (null while unknown). */
  unpublished: number | null;
  /** Sections still marked Draft: they must be read before publishing. */
  unread: number;
  publishing: boolean;
  failed: boolean;
};

export type StatusTone = "ok" | "warn" | "err" | "neutral" | "info";
export type WorkspaceStatus = { text: string; tone: StatusTone };

const changes = (count: number): string => `${count} ${count === 1 ? "change" : "changes"}`;

export function workspaceStatus(input: WorkspaceStatusInput): WorkspaceStatus {
  if (input.publishing) return { text: "Publishing…", tone: "info" };
  if (input.failed) return { text: "Didn’t go live", tone: "err" };
  if (input.offline) return { text: "Offline · visitors see a holding page", tone: "err" };
  const waiting = input.unpublished ?? 0;
  if (input.unread > 0) {
    // Nothing is live yet: there is no "published" to compare the draft with.
    if (!input.live) return { text: `${input.unread} to read · not live`, tone: "warn" };
    return { text: waiting > 0 ? `${input.unread} to read · ${waiting} not published` : `${input.unread} to read first`, tone: "warn" };
  }
  if (!input.live) return { text: "Draft · not live", tone: "neutral" };
  if (input.unpublished === null) return { text: "Live", tone: "ok" };
  return waiting > 0 ? { text: `Live · ${waiting} not published yet`, tone: "ok" } : { text: "Live · up to date", tone: "ok" };
}

export type PublishButton = { label: string; primary: boolean; opensPanel: boolean };

/**
 * The top bar's button: it only ever opens the Publish panel. `compact` is
 * the phone's top bar, where the count lives in the status line instead.
 */
export function publishBarButton(input: WorkspaceStatusInput & { canPublish: boolean }, compact = false): PublishButton {
  if (input.publishing) return { label: "Publishing…", primary: false, opensPanel: true };
  if (input.failed) return { label: compact ? "Didn’t go live" : "See what went wrong", primary: true, opensPanel: true };
  if (!input.live) return { label: input.canPublish ? "Go live" : "Review", primary: true, opensPanel: true };
  const waiting = input.unpublished ?? 0;
  if (waiting === 0 && input.unread === 0) return { label: "Published", primary: false, opensPanel: true };
  if (compact) return { label: "Publish", primary: true, opensPanel: true };
  return { label: waiting > 0 ? `Publish ${changes(waiting)}` : "Review and publish", primary: true, opensPanel: true };
}

export type PublishGateInput = {
  canPublish: boolean;
  live: boolean;
  unpublished: number | null;
  unread: number;
  /** Text and background pairs that are hard to read in the design in use. */
  unreadablePairs: number;
  /** Still checking the draft (validation or the first publish's design checks). */
  checking: boolean;
  /** The draft check refused: the plain reason. */
  blocker: string | null;
  /** The draft check could not run at all. */
  checkFailed: boolean;
  publishing: boolean;
  lockedBy: string | null | false;
  offlineDevice: boolean;
};

export type PublishGate = {
  label: string;
  blocked: boolean;
  /** One plain line under the button when it is blocked. */
  reason: string | null;
  /** What the owner can do about it. */
  next: "read" | "design" | "fix" | "retry" | "wait" | "ask" | "none" | null;
};

/**
 * The final button. Order is the order an owner can act on: someone else is
 * editing, no connection, already publishing, sections to read, unreadable
 * text, a failed check, still checking, nothing to publish.
 */
export function publishGate(input: PublishGateInput): PublishGate {
  const waiting = input.unpublished ?? 0;
  const go = !input.live ? "Go live" : waiting > 0 ? `Publish ${changes(waiting)}` : "Publish";
  if (!input.canPublish) {
    return { label: "Ask an admin to publish", blocked: false, reason: "Publishing needs a brand admin or the owner. They get a notification with a link here.", next: "ask" };
  }
  if (input.lockedBy !== false) {
    return { label: `${input.lockedBy ?? "A teammate"} is editing`, blocked: true, reason: "Only one person can change the website at a time. Take over from the banner to publish.", next: "wait" };
  }
  if (input.publishing) return { label: "Publishing…", blocked: true, reason: "Usually under a minute. You can close this; we’ll tell you when it’s live.", next: "wait" };
  if (input.offlineDevice) return { label: "You’re offline", blocked: true, reason: "Publishing needs a connection. Your draft is safe.", next: "retry" };
  if (input.unread > 0) {
    return { label: `Read ${input.unread} more to publish`, blocked: true, reason: "Read each section above and choose Looks good. Nothing goes live unread.", next: "read" };
  }
  if (input.unreadablePairs > 0) {
    return { label: "Fix the hard-to-read text first", blocked: true, reason: "Some text is hard to read on its background. Fix it in Design, then publish.", next: "design" };
  }
  if (input.blocker) return { label: "Fix 1 thing to publish", blocked: true, reason: input.blocker, next: "fix" };
  if (input.checkFailed) return { label: "Check again", blocked: false, reason: "We couldn’t check your draft just now. Nothing was published.", next: "retry" };
  if (input.checking) return { label: "Checking your draft…", blocked: true, reason: null, next: "wait" };
  if (input.live && waiting === 0 && input.unpublished !== null) {
    return { label: "Nothing new to publish", blocked: true, reason: "Your live website already matches your draft.", next: "none" };
  }
  return { label: go, blocked: false, reason: null, next: null };
}

export const PUBLISH_PROMISE = "Your last version stays live if anything goes wrong.";
