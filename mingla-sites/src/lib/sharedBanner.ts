import type { CSSProperties } from "react";

/** #4453 M8 (spec v2 §7) — the share page's 32 px strip: "Private preview · {brand} · expires {date}". */
export function sharedBannerText(brand: string, expiresAt: string | null): string {
  const when = expiresAt ? new Date(expiresAt) : null;
  const date = when && !Number.isNaN(when.getTime())
    ? when.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
    : null;
  return date ? `Private preview · ${brand} · expires ${date}` : `Private preview · ${brand}`;
}

/** Every design draws the strip the same way: the designs' own styles for it differ, and a client must always see it. */
export const SHARED_BANNER_STYLE: CSSProperties = {
  position: "sticky",
  top: 0,
  zIndex: 100,
  margin: 0,
  height: 32,
  lineHeight: "32px",
  padding: "0 16px",
  textAlign: "center",
  fontSize: 13,
  fontWeight: 600,
  color: "#1b1508",
  background: "#dcb877",
  overflow: "hidden",
  whiteSpace: "nowrap",
  textOverflow: "ellipsis",
};

/**
 * The strip sits above every layer a design or the booking chrome fixes to the
 * screen (headers 60, consent and the phone sticky bar 80, menus and the
 * hand-off sheet 90), and the fixed header starts below it, so nothing covers it.
 */
export const SHARED_STRIP_CSS =
  '[data-shared-preview="1"] :is(.mg-hd,.site-header,.v-header){top:32px !important}' +
  '[data-shared-preview="1"] .mg-pmenu{padding-top:116px}';
