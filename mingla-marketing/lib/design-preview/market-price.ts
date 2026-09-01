// ---------------------------------------------------------------
// #2902 — which currency an illustrative figure shows.
//
// Mingla is live in three markets: London, the US and Lagos. The Host page is
// ONE statically rendered page for all three, so a hard-coded figure shows one
// market's money to the other two.
//
// This resolves the market from the visitor's own time zone, in their browser.
// That choice is deliberate and it is about cost: reading Vercel's
// `x-vercel-ip-country` in a server component opts the route into dynamic
// rendering, so every visit becomes a function invocation instead of a CDN
// hit. Intl is already in the browser, costs nothing, adds no request, and
// leaves the page static.
//
// The trade is accuracy: a VPN or a traveller reads as where they are, not
// where they trade. For an illustrative figure on a marketing card that is a
// fine trade. It would NOT be a fine trade for anything transacting — that
// needs the account's real currency, server-side.
// ---------------------------------------------------------------

export type Market = 'NG' | 'GB' | 'US'

/** What renders before the browser has told us anything, and if it never does. */
export const DEFAULT_MARKET: Market = 'US'

/** Illustrative door prices — a plausible figure per market, not a quote. */
export const DOOR_PRICE: Record<Market, string> = {
  NG: '₦12,000',
  GB: '£15',
  US: '$20',
}

/**
 * Only the three live markets resolve. Everything else falls to the default
 * rather than guessing at a currency Mingla does not trade in.
 */
export function marketFromTimeZone(timeZone: string | undefined | null): Market {
  if (!timeZone) return DEFAULT_MARKET
  if (timeZone === 'Africa/Lagos') return 'NG'
  if (timeZone === 'Europe/London') return 'GB'
  if (timeZone.startsWith('America/')) return 'US'
  return DEFAULT_MARKET
}

/** Never throws: Intl is absent or locked down in some embedded browsers. */
export function detectMarket(): Market {
  try {
    return marketFromTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone)
  } catch {
    return DEFAULT_MARKET
  }
}
