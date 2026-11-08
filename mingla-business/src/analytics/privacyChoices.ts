/**
 * #2331 — the one way to reopen the privacy bar, already expanded. Since #4318
 * the only caller is the bar's own folded "Privacy settings" button (there is
 * no separate privacy link on any page); the server-rendered public documents
 * listen for the same window event.
 */
export const PRIVACY_CHOICES_EVENT = "mingla:privacy-choices";

/** Ask the privacy bar to open, expanded, showing the saved switches. */
export function openPrivacyChoices(): void {
  if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") {
    return;
  }
  window.dispatchEvent(new Event(PRIVACY_CHOICES_EVENT));
}
