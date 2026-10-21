export interface ForegroundNotificationData {
  type?: unknown;
  conversation_id?: unknown;
}

export function shouldDisplayForegroundBusinessNotification(
  data: ForegroundNotificationData,
  pathname: string | null | undefined,
): boolean {
  if (data.type !== "business.brand_group_message") return true;
  if (typeof data.conversation_id !== "string" || data.conversation_id === "") {
    return true;
  }
  const normalizedPath = pathname && pathname.length > 1
    ? pathname.replace(/\/+$/, "")
    : pathname;
  return normalizedPath !== `/messages/${data.conversation_id}`;
}
