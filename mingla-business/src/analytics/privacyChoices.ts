/**
 * #2331 — "Your privacy choices" reopens the one privacy bar, already
 * expanded. The link and the bar talk through one window event so any page
 * (including the server-rendered public document) can ask for it.
 */
export const PRIVACY_CHOICES_EVENT = "mingla:privacy-choices";

/** Ask the privacy bar to open, expanded, showing the saved switches. */
export function openPrivacyChoices(): void {
  if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") {
    return;
  }
  window.dispatchEvent(new Event(PRIVACY_CHOICES_EVENT));
}
