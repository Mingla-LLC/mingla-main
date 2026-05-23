export type CollabChatHeaderActionId = "matches" | "swipe" | "plans";

export type CollabChatHeaderAction = {
  id: CollabChatHeaderActionId;
  label: string;
  icon: string;
};

type CollabChatHeaderActionArgs = {
  matchesCount: number;
  scheduledCount: number;
  matchesLoading?: boolean;
  scheduledLoading?: boolean;
};

export function getCollabChatHeaderActions({
  matchesCount,
  scheduledCount,
  matchesLoading = false,
  scheduledLoading = false,
}: CollabChatHeaderActionArgs): CollabChatHeaderAction[] {
  const actions: CollabChatHeaderAction[] = [];

  if (matchesLoading || matchesCount > 0) {
    actions.push({
      id: "matches",
      label: "Matches",
      icon: "heart-circle-outline",
    });
  }

  actions.push({
    id: "swipe",
    label: "Swipe",
    icon: "albums-outline",
  });

  if (scheduledLoading || scheduledCount > 0) {
    actions.push({
      id: "plans",
      label: "Plans",
      icon: "calendar-outline",
    });
  }

  return actions;
}
