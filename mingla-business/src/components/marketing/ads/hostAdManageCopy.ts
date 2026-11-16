/**
 * #4238 W6b — the words for the ad detail screen, Promote home, their sheets
 * and the Ari ad cards. English lives in src/i18n/locales/en/hostAds.json
 * under `hostAds.manage`; the 28 other Host languages carry the same keys
 * (machine-translated, no human review: standing rule). Never a payment
 * provider's name; every amount is what the Host pays.
 */
import english from "../../../i18n/locales/en/hostAds.json";
import { businessT, registerBusinessEnglish } from "../../../i18n";
import { hostAdPayFromCredit, type HostAdGoal } from "./hostAdBuilderModel";
import type { HostAdStopReason } from "./hostAdManageModel";
import { formatHostAdMoneyCents } from "./hostAdMoney";

registerBusinessEnglish(english);

export type HostAdManageVars = Record<string, string | number>;

/** One W6b string in the current language (falls back to English). */
export function hm(key: string, variables?: HostAdManageVars): string {
  return businessT(`hostAds.manage.${key}`, variables);
}

/**
 * #4238 rework 5 (native P2-1): the ONE "Pause this ad?" confirm, shared by
 * the ad detail page and the Home ad tile, so both state the same money: what
 * stays held (the plan total minus what was spent, in what the Host pays).
 */
export function hostAdPauseConfirmWords(input: {
  capCredit: number | null;
  spentCredit: number | null;
  currency: string | null;
}): { title: string; description: string; confirmLabel: string; cancelLabel: string } {
  const heldCredit = Math.max(0, Math.trunc(input.capCredit ?? 0) - Math.max(0, Math.trunc(input.spentCredit ?? 0)));
  const amount =
    input.currency !== null && /^[A-Z]{3}$/.test(input.currency)
      ? formatHostAdMoneyCents(hostAdPayFromCredit(heldCredit), input.currency) ?? ""
      : "";
  return {
    title: hm("confirm.pauseTitle"),
    description: hm("confirm.pauseBody", { amount }),
    confirmLabel: hm("confirm.pause"),
    cancelLabel: hm("confirm.keepRunning"),
  };
}

/** "tickets" / "sign-ups" / "page visits" (or the singular). */
export function hostAdUnit(goal: HostAdGoal, one = false): string {
  return hm(`unit.${goal}${one ? "One" : ""}`);
}

/** The short true reason for a status chip ("Sold out", "Credit ran out"). */
export function hostAdReasonShort(reason: HostAdStopReason): string {
  return hm(`reason.${reason}`);
}

/** The full sentence for the detail screen. Sold out reads differently paused vs ended. */
export function hostAdReasonLine(reason: HostAdStopReason, ended: boolean): string {
  if (reason === "soldOut") return hm(ended ? "why.soldOutEnded" : "why.soldOutPaused");
  return hm(`why.${reason}`);
}

/** Who the apps are finding while an ad learns, by goal (never "buyers" on sign-ups). */
export function hostAdLearningWho(goal: HostAdGoal): string {
  return hm(goal === "sales" ? "detail.whoSales" : goal === "signups" ? "detail.whoSignups" : "detail.whoVisits");
}

/** How the count is made, by goal: the 7-day tap window, one order once. */
export function hostAdCountingLine(goal: HostAdGoal): string {
  return hm(goal === "sales" ? "detail.countSales" : goal === "signups" ? "detail.countSignups" : "detail.countVisits");
}

const ARI_REFUSALS: Record<string, string> = {
  ad_suggestion_stale: "ari.stale",
  ad_suggestion_over_cap: "ari.overCap",
  ad_suggestion_learning: "ari.learningRefusal",
  host_ad_live_edit_once_a_day: "ari.onceADay",
  ari_creative_ai_generated: "ari.aiMade",
};

/**
 * Ari's refusal codes in the Host's words. `ari_copy_unverified_name:<name>`
 * names the word Ari couldn't check. Unknown codes return null (the caller
 * keeps its own message).
 */
export function hostAdAriRefusal(code: string | null | undefined): string | null {
  const value = (code ?? "").trim();
  if (!value) return null;
  const named = /^ari_copy_unverified_name:(.+)$/.exec(value);
  if (named) return hm("ari.unverifiedName", { name: named[1].trim().slice(0, 60) });
  const key = ARI_REFUSALS[value];
  return key ? hm(key) : null;
}

/** Finds a known refusal code inside an error message or code string. */
export function hostAdAriRefusalIn(text: string | null | undefined): string | null {
  const value = text ?? "";
  const match = /(ad_suggestion_(?:stale|over_cap|learning)|host_ad_live_edit_once_a_day|ari_creative_ai_generated|ari_copy_unverified_name:[^\s,.;]+)/.exec(value);
  return match ? hostAdAriRefusal(match[1]) : null;
}
