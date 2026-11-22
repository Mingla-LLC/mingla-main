/**
 * WEB SHIM for pushRegistrationHealth (#4549 S1). Host web has no push SDK, so
 * every export is a no-op. Keep the export names in step with the native twin
 * (i-1378 web-shim export parity). No imports: nothing reaches the web bundle.
 */

export type PushHealthReason = "launch" | "sign_in" | "foreground";

export async function ensurePushRegistration(
  _userId: string,
  _reason: PushHealthReason,
): Promise<void> {}

export async function ensurePushRegistrationOnForeground(): Promise<void> {}

export function __resetPushRegistrationHealthForTests(): void {}
