/**
 * #4238 P1-5 (I-4238-NO-PRIVATE-TOKEN-TO-PIXELS) — buyer return pages carry
 * private credentials in the address: the buyer status token (`bst`, which
 * reads the buyer's order), the checkout session ids (`csi`, `rcs`) and the
 * provider return ids (`cs`, Paystack `trxref` / `reference`). Ad pixels and
 * analytics vendors read the full page address, so these keys are removed from
 * the visible URL (history.replaceState, history state and hash kept) before
 * any vendor script boots or fires, and the page reads the original query
 * from memory through `readPageSearch`.
 *
 * Only public buyer routes are touched. Pure and RN-import-free (the browser
 * objects are passed in), so it is unit-testable and never throws.
 */
import { isPublicBuyerRoute } from "./coldLoadAuthGates";

export const PRIVATE_URL_QUERY_KEYS: readonly string[] = [
  "bst",
  "csi",
  "cs",
  "rcs",
  "trxref",
  "reference",
];

type ScrubLocation = Readonly<{
  pathname: string;
  search: string;
  hash?: string;
}>;
type ScrubHistory = {
  readonly state?: unknown;
  replaceState(state: unknown, unused: string, url: string): void;
};
export type ScrubWindow = {
  readonly location?: ScrubLocation;
  readonly history?: ScrubHistory;
};

let captured: { pathname: string; search: string } | null = null;

/** True when `search` carries at least one private key. */
export function hasPrivateUrlToken(search: string | null | undefined): boolean {
  if (typeof search !== "string" || search.length < 2) return false;
  try {
    const params = new URLSearchParams(search);
    return PRIVATE_URL_QUERY_KEYS.some((key) => params.has(key));
  } catch {
    return false;
  }
}

/**
 * Remove the private keys from the visible address of a public buyer route.
 * Returns true when the address was rewritten. The original query is kept in
 * memory for this pathname (the first capture wins, so a later re-scrub never
 * loses it).
 */
export function scrubPrivateUrlTokens(win: ScrubWindow | null | undefined): boolean {
  try {
    const location = win?.location;
    const history = win?.history;
    if (!location || !history || typeof history.replaceState !== "function") return false;
    if (!isPublicBuyerRoute(location.pathname)) return false;
    const search = location.search ?? "";
    if (!hasPrivateUrlToken(search)) return false;
    if (captured === null || captured.pathname !== location.pathname) {
      captured = { pathname: location.pathname, search };
    }
    const params = new URLSearchParams(search);
    for (const key of PRIVATE_URL_QUERY_KEYS) params.delete(key);
    const rest = params.toString();
    history.replaceState(
      history.state ?? null,
      "",
      `${location.pathname}${rest ? `?${rest}` : ""}${location.hash ?? ""}`,
    );
    return true;
  } catch (err) {
    console.warn("[privateUrlTokens] scrub failed:", err);
    return false;
  }
}

/**
 * The page's own query string: the original (with its tokens) when this
 * pathname was scrubbed, otherwise the live address.
 */
export function readPageSearch(location: { pathname?: string; search?: string } | null | undefined): string {
  const live = location?.search ?? "";
  if (captured !== null && location?.pathname === captured.pathname) {
    return captured.search;
  }
  return live;
}

/** Test seam: forget the captured query. */
export function resetPrivateUrlTokensForTest(): void {
  captured = null;
}
