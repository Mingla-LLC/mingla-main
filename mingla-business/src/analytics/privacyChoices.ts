/**
 * #2331 → #4318 — the one way to open the privacy choices sheet. The
 * "Privacy & ad choices" strip calls it; the server-rendered public documents
 * listen for the same window event. There is no separate privacy link on any
 * page.
 */
export const PRIVACY_CHOICES_EVENT = "mingla:privacy-choices";

/** Ask the privacy bar to open, expanded, showing the saved switches. */
export function openPrivacyChoices(): void {
  if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") {
    return;
  }
  window.dispatchEvent(new Event(PRIVACY_CHOICES_EVENT));
}
