/**
 * #4273 wave A — the creation-wizard Invite step's selection model.
 *
 * Everyone in Your Book, Followers, Friends of followers and each saved group
 * are independent ticks that COMBINE in one selection; people chosen by hand
 * add on top (and people unticked by hand are kept out). The server resolves
 * all of it into one de-duplicated set. "How to reach them" holds the methods
 * the host ticked; at least one always stays on.
 *
 * Pure functions only: this module is shared by the plan service and the step,
 * both of which load in the lazy invite chunk (#1780 bundle budget).
 */

export type WizardInviteChannel = "email" | "push" | "sms";

/** Display order of the "How to reach them" chips. */
export const WIZARD_INVITE_CHANNEL_ORDER: readonly WizardInviteChannel[] = ["push", "email", "sms"];

export const WIZARD_INVITE_CHANNEL_LABEL: Record<WizardInviteChannel, string> = {
  push: "Push · free",
  email: "Email",
  sms: "SMS",
};

/** A new plan starts with Push and Email ticked. */
export const DEFAULT_WIZARD_INVITE_CHANNELS: readonly WizardInviteChannel[] = ["email", "push"];

/** Today's automatic behaviour: Mingla may use every live method. */
const AUTOMATIC_WIZARD_INVITE_CHANNELS: readonly WizardInviteChannel[] = ["email", "push", "sms"];

export interface WizardInviteSources {
  includeEveryone: boolean;
  includeFollowers: boolean;
  includeFriendsOfFollowers: boolean;
  manualGroupIds: string[];
  /** People added by hand in "Choose people". */
  personIds: string[];
  /** People removed by hand while a wider source still includes them. */
  excludedPersonIds: string[];
}

export const EMPTY_WIZARD_INVITE_SOURCES: WizardInviteSources = {
  includeEveryone: false,
  includeFollowers: false,
  includeFriendsOfFollowers: false,
  manualGroupIds: [],
  personIds: [],
  excludedPersonIds: [],
};

export interface WizardInviteSelectionInput extends WizardInviteSources {
  deliveryChannels: WizardInviteChannel[];
}

const sortedUnique = (values: readonly string[]): string[] => [...new Set(values)].sort();

const isChannel = (value: unknown): value is WizardInviteChannel =>
  value === "email" || value === "push" || value === "sms";

/**
 * A plan saved before #4273 has no stored sources: the people it holds become
 * hand-picked people, and Followers counts as ticked when it reaches followers
 * through Mingla. (Friends of followers cannot be told apart client-side, so a
 * legacy plan shows it unticked; the server derives it exactly.)
 */
export function legacyWizardInviteSources(
  brandPersonIds: readonly string[],
  accountRecipientCount: number | undefined,
): WizardInviteSources {
  return {
    ...EMPTY_WIZARD_INVITE_SOURCES,
    includeFollowers: (accountRecipientCount ?? 0) > 0,
    personIds: sortedUnique(brandPersonIds),
  };
}

export function wizardInviteSourcesForPlan(plan: {
  sources?: WizardInviteSources | null;
  brandPersonIds: readonly string[];
  accountRecipientCount?: number;
}): WizardInviteSources {
  return plan.sources ?? legacyWizardInviteSources(plan.brandPersonIds, plan.accountRecipientCount);
}

/**
 * The ticked methods to show. Stored methods win. A plan with people but no
 * stored methods is a legacy plan that still sends automatically, so all three
 * show ticked; an untouched plan shows the Push + Email default.
 */
export function effectiveWizardInviteChannels(plan: {
  deliveryChannels?: readonly WizardInviteChannel[] | null;
  selectedCount: number;
}): WizardInviteChannel[] {
  if (plan.deliveryChannels && plan.deliveryChannels.length > 0) {
    return sortChannels(plan.deliveryChannels);
  }
  return sortChannels(plan.selectedCount > 0
    ? AUTOMATIC_WIZARD_INVITE_CHANNELS
    : DEFAULT_WIZARD_INVITE_CHANNELS);
}

export function sortChannels(channels: readonly WizardInviteChannel[]): WizardInviteChannel[] {
  return [...new Set(channels.filter(isChannel))].sort();
}

/** Toggles one method. Returns null when that would leave none ticked. */
export function toggleWizardInviteChannel(
  channels: readonly WizardInviteChannel[],
  channel: WizardInviteChannel,
): WizardInviteChannel[] | null {
  const next = channels.includes(channel)
    ? channels.filter((value) => value !== channel)
    : [...channels, channel];
  return next.length === 0 ? null : sortChannels(next);
}

export type WizardInviteSourceKey = "everyone" | "followers" | "friendsOfFollowers";

/** Ticks or unticks one audience source, keeping every other source. */
export function toggleWizardInviteSource(
  sources: WizardInviteSources,
  key: WizardInviteSourceKey,
): WizardInviteSources {
  switch (key) {
    case "everyone":
      // Ticking Everyone means everyone: earlier hand removals no longer apply.
      return sources.includeEveryone
        ? { ...sources, includeEveryone: false }
        : { ...sources, includeEveryone: true, excludedPersonIds: [] };
    case "followers":
      return { ...sources, includeFollowers: !sources.includeFollowers };
    case "friendsOfFollowers":
      return { ...sources, includeFriendsOfFollowers: !sources.includeFriendsOfFollowers };
    default: {
      const unreachable: never = key;
      return unreachable;
    }
  }
}

export function toggleWizardInviteGroup(
  sources: WizardInviteSources,
  groupId: string,
): WizardInviteSources {
  const groups = sources.manualGroupIds.includes(groupId)
    ? sources.manualGroupIds.filter((id) => id !== groupId)
    : [...sources.manualGroupIds, groupId];
  return { ...sources, manualGroupIds: sortedUnique(groups) };
}

const hasWiderSource = (sources: WizardInviteSources): boolean =>
  sources.includeEveryone || sources.includeFollowers || sources.includeFriendsOfFollowers ||
  sources.manualGroupIds.length > 0;

/**
 * Folds the "Choose people" edits into the sources: people ticked by hand are
 * added; people unticked by hand are removed, and kept out while a wider source
 * (Everyone, Followers, a group) would otherwise bring them back.
 */
export function applyWizardInvitePeopleEdits(
  sources: WizardInviteSources,
  persistedIds: readonly string[],
  desiredIds: readonly string[],
): WizardInviteSources {
  const persisted = new Set(persistedIds);
  const desired = new Set(desiredIds);
  const added = [...desired].filter((id) => !persisted.has(id));
  const removed = new Set([...persisted].filter((id) => !desired.has(id)));
  const personIds = sortedUnique([...sources.personIds, ...added]).filter((id) => !removed.has(id));
  const addedSet = new Set(added);
  const excluded = sources.excludedPersonIds.filter((id) => !addedSet.has(id));
  return {
    ...sources,
    personIds,
    excludedPersonIds: sortedUnique(hasWiderSource(sources) ? [...excluded, ...removed] : excluded),
  };
}

/** The exact selection payload the plan RPC accepts (7-key shape). */
export function wizardInviteSelection(
  sources: WizardInviteSources,
  channels: readonly WizardInviteChannel[],
): WizardInviteSelectionInput {
  return {
    includeEveryone: sources.includeEveryone,
    includeFollowers: sources.includeFollowers,
    includeFriendsOfFollowers: sources.includeFriendsOfFollowers,
    manualGroupIds: sortedUnique(sources.manualGroupIds),
    personIds: sortedUnique(sources.personIds),
    excludedPersonIds: sortedUnique(sources.excludedPersonIds),
    deliveryChannels: sortChannels(channels),
  };
}

/**
 * The Invite delivery card's method line, following the ticked methods:
 * "Email 3 · Text 0 · Mingla 3" lists only what the host picked.
 */
export function wizardInviteChannelLine(
  perChannel: { email: number; sms: number; push: number },
  channels: readonly WizardInviteChannel[] | null,
): string {
  const parts: Array<[WizardInviteChannel, string, number]> = [
    ["email", "Email", perChannel.email],
    ["sms", "Text", perChannel.sms],
    ["push", "Mingla", perChannel.push],
  ];
  return parts
    .filter(([channel]) => channels === null || channels.includes(channel))
    .map(([, label, value]) => `${label} ${value}`)
    .join(" · ");
}

/** Parses the stored sources from the plan response; undefined when absent. */
export function parseWizardInviteSources(value: unknown): WizardInviteSources | null | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const ids = (entry: unknown): entry is string[] =>
    Array.isArray(entry) && entry.every((id) => typeof id === "string");
  if (typeof record.includeEveryone !== "boolean" || typeof record.includeFollowers !== "boolean" ||
      typeof record.includeFriendsOfFollowers !== "boolean" || !ids(record.manualGroupIds) ||
      !ids(record.personIds) || !ids(record.excludedPersonIds)) return null;
  return {
    includeEveryone: record.includeEveryone,
    includeFollowers: record.includeFollowers,
    includeFriendsOfFollowers: record.includeFriendsOfFollowers,
    manualGroupIds: sortedUnique(record.manualGroupIds),
    personIds: sortedUnique(record.personIds),
    excludedPersonIds: sortedUnique(record.excludedPersonIds),
  };
}

/** Parses stored methods: undefined/null = none stored; null result = malformed. */
export function parseWizardInviteChannels(value: unknown): WizardInviteChannel[] | null | "malformed" {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value) || value.length < 1 || value.length > 3 ||
      !value.every(isChannel) || new Set(value).size !== value.length) return "malformed";
  return sortChannels(value);
}
