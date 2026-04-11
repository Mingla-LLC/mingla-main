import { requestPushPermission } from './oneSignalService';

/**
 * Deferred permission requests — called AFTER coach mark tour completes.
 * Not called on app boot.
 *
 * Centralises all post-tour permission prompts so the coach mark provider
 * has a single function to call when the user finishes (or skips) the tour.
 */
export async function requestPostTourPermissions(): Promise<void> {
  await requestPushPermission();
}
