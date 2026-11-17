/**
 * #4238 W6a — the Promote builder's words. English lives in
 * src/i18n/locales/en/hostAds.json; the 28 other Host languages carry the
 * same keys in locales/<lang>/hostAds.json (machine-translated, no human
 * review: standing rule, Hosts report problems). Never a payment provider's
 * name; every amount is what the Host pays.
 */
import english from "../../../i18n/locales/en/hostAds.json";
import { businessT, registerBusinessEnglish } from "../../../i18n";

registerBusinessEnglish(english);

export type HostAdCopyVars = Record<string, string | number>;

/** One builder string in the current language (falls back to English). */
export function hb(key: string, variables?: HostAdCopyVars): string {
  return businessT(`hostAds.builder.${key}`, variables);
}

/** The step names, in order. */
export function hostAdStepName(step: string): string {
  return hb(`steps.${step}`);
}

/** The goal the Host sees for a page ("Sell tickets", "Get sign-ups"). */
export function hostAdGoalName(goal: "sales" | "signups" | "visits"): string {
  return hb(`goal.${goal}`);
}

/** "ticket sales" / "sign-ups" / "page visits". */
export function hostAdGoalUnit(goal: "sales" | "signups" | "visits"): string {
  return hb(`unit.${goal}`);
}
