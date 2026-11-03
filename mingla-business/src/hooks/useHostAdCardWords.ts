/**
 * #4238 — the Host ad money format and app names for Ari's proposal card,
 * loaded on intent from the Host Ads chunk.
 *
 * Both live with the Host Ads screens (`hostAdMoney`, `hostAdCopy`). If Ari's
 * card imported them directly, Metro would hoist them into the boot chunk
 * every visitor downloads (two lazy chunks sharing a module). The card asks
 * for them only when it shows money or ad apps, renders a placeholder until
 * they arrive, and reuses them for every later card.
 */
import { useEffect, useState } from "react";

import { loadHostAdPlanService } from "../services/lazyHostAdPlanService";

export type HostAdCardWords = {
  formatMoney: (cents: number, currency: unknown) => string | null;
  platformName: (platform: string) => string;
};

/** Shown in a field while the words load: same row, same line height. */
export const HOST_AD_CARD_WORDS_PENDING = "Loading…";

/**
 * Used only if the Host Ads chunk cannot load (offline, failed deploy): the
 * amount and the app key still show, so a Host never approves an unseen
 * budget.
 */
const FALLBACK_WORDS: HostAdCardWords = {
  formatMoney: (cents, currency) => {
    const code =
      typeof currency === "string" && /^[A-Za-z]{3}$/.test(currency.trim())
        ? currency.trim().toUpperCase()
        : "";
    const amount = (cents / 100).toFixed(2);
    return code ? `${code} ${amount}` : amount;
  },
  platformName: (platform) => platform,
};

let loaded: HostAdCardWords | null = null;

export function useHostAdCardWords(needed: boolean): HostAdCardWords | null {
  const [words, setWords] = useState<HostAdCardWords | null>(loaded);
  useEffect(() => {
    if (!needed || words) return undefined;
    let alive = true;
    void loadHostAdPlanService()
      .then((kit) => {
        if (typeof kit.formatHostAdMoneyCents !== "function" || typeof kit.platformName !== "function") {
          throw new Error("host_ad_card_words_missing");
        }
        loaded = {
          formatMoney: kit.formatHostAdMoneyCents,
          platformName: kit.platformName,
        };
        if (alive) setWords(loaded);
      })
      .catch((error: unknown) => {
        if (alive) setWords(FALLBACK_WORDS);
        void import("../diagnostics/reportNonFatal").then(
          ({ reportNonFatal }) => reportNonFatal("ari.hostAdCardWords", error, {}),
          () => console.warn("[ari.hostAdCardWords]", error instanceof Error ? error.message : String(error)),
        );
      });
    return () => {
      alive = false;
    };
  }, [needed, words]);
  return words;
}
