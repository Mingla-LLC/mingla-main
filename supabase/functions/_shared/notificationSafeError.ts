export const NOTIFICATION_SAFE_CODES = [
  "invalid_recipient",
  "provider_config_missing",
  "provider_kill_switch_off",
  "recipient_opted_out",
  "provider_rejected",
  "provider_rate_limited",
  "provider_unavailable",
  "provider_timeout",
  "provider_protocol_error",
  "can_send_denied",
  "no_contact",
  "dispatch_rejected",
  "dispatch_unavailable",
  "dispatch_timeout",
  "unknown_failure",
  "source_dispatch_failed",
  "delivery_in_progress",
  "delivery_retry_scheduled",
  "delivery_ambiguous",
  "delivery_attempts_exhausted",
  "idempotency_conflict",
  "dispatch_protocol_error",
] as const;

export type NotificationSafeCode = typeof NOTIFICATION_SAFE_CODES[number];
const SAFE = new Set<string>(NOTIFICATION_SAFE_CODES);

export function notificationSafeError(value: unknown): NotificationSafeCode {
  return typeof value === "string" && SAFE.has(value)
    ? value as NotificationSafeCode
    : "unknown_failure";
}

export function notificationHttpSafeCode(input: {
  status?: number;
  timedOut?: boolean;
  network?: boolean;
}): NotificationSafeCode {
  if (input.timedOut) return "provider_timeout";
  if (input.network) return "provider_unavailable";
  if (input.status === 429) return "provider_rate_limited";
  if (input.status !== undefined && input.status >= 500) {
    return "provider_unavailable";
  }
  if (input.status !== undefined && input.status >= 400) {
    return "provider_rejected";
  }
  return "unknown_failure";
}
