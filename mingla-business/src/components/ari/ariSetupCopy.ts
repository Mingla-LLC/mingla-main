/**
 * #4389 (screens A1–A5) — host copy for Ari's brand setup cards. Never
 * "business", never a provider name. The cards render from tool results and
 * the server checklist, not from Ari's words (AR-2).
 * [TRANSITIONAL] English only — exit: moved into the locale files with the
 * rest of the #4389 copy (i18n remainder in the build log).
 */
import { STRIPE_SUPPORTED_COUNTRIES } from "../../constants/stripeSupportedCountries";

export const ARI_SETUP_ITEMS = ["Brand name", "Bank country", "Organiser Terms", "Payment details"] as const;

export const ARI_SETUP_COPY = {
  a1: {
    headline: (first: string | null): string =>
      `${first ? `Hi ${first}.` : "Hi."} Let's get your account ready to take bookings.`,
    body: "It takes about 3 minutes: your brand name, your bank country, then payments. I'll guide you.",
    cardTitle: "Set up your brand",
    minutes: "About 3 minutes",
    setUp: "Set up my brand",
    withAri: "Do it with Ari",
    withAriMessage: "Help me set up my brand",
    offline: "Ari is unavailable right now. Use Set up my brand.",
  },
  a2: {
    lead: (brand: string, done: number, next: string): string =>
      `Let's finish setting up ${brand}. ${done} of 4 done. Next: ${next}.`,
    count: (done: number): string => `${done} of 4 done`,
    waiting: (client: string): string => `Waiting for ${client}`,
    cta: "Continue",
    allSet: "All set",
    error: "We couldn't load your setup.",
    retry: "Try again",
  },
  a3: {
    question: (name: string, country: string, cur: string): string =>
      `Create ${name} collecting funds in ${country} (${cur})?`,
    fundsLabel: "Collecting funds in",
    expired: "This expired. Ask again.",
  },
  a4: {
    secureTitle: "Secure setup",
    secureBody: "Bank and ID details are entered on a secure screen, not in chat.",
    open: "Open secure setup",
    termsTitle: "Organiser Terms",
    termsBody: "Accept the Organiser Terms first.",
    termsCta: "Review and accept",
    countryTitle: "Bank country",
    countryBody: "Pick the country your bank account is in first.",
    countryCta: "Pick bank country",
    owner: "Only the owner can set up payments. We've added it to their Home.",
    doorTitle: "Door sale",
    doorBody: "You pick how they pay on the next screen. Cards are never handled in chat.",
    doorCta: "Open door sale",
  },
  a5: {
    notice: "Please don't share that here. I've hidden it. Use the secure screen.",
    open: "Open secure setup",
  },
  brandMismatch: "This card belongs to another brand. Switch back to it to confirm.",
} as const;

/** "Canada (CAD)" for a bank country code, or null when unknown. */
export function payoutCountryLabel(code: unknown): { name: string; currency: string } | null {
  if (typeof code !== "string") return null;
  const cc = code.trim().toUpperCase();
  if (cc === "NG") return { name: "Nigeria", currency: "NGN" };
  const hit = STRIPE_SUPPORTED_COUNTRIES.find((c) => c.country === cc);
  return hit ? { name: hit.displayName, currency: hit.defaultCurrency } : null;
}
