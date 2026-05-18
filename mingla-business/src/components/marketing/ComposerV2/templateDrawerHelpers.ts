/**
 * ORCH-0864 [Marketing Composer V2] Stage E — pure helpers for
 * TemplatePreviewDrawer. Lives separately so jest can exercise the
 * sorting + substitution logic without loading react-native (which is
 * ESM and incompatible with our ts-jest node testEnvironment).
 */

import type { PreviewVariables } from "../../../services/marketing/marketingRenderingService";
import type { MarketingTemplateRow } from "../../../types/marketing";

/**
 * Sort templates starter-first, then alphabetical by name. Stable so the
 * drawer's swiper index is meaningful across renders.
 */
export function sortTemplatesStarterFirst(
  templates: readonly MarketingTemplateRow[],
): MarketingTemplateRow[] {
  return [...templates].sort((a, b) => {
    if (a.is_starter_pack !== b.is_starter_pack) {
      return a.is_starter_pack ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });
}

/**
 * Substitute the 11 personalization tokens once in a subject/preview string.
 * Unknown tokens stay as-is (operator sees `{thing}` literal — Constitution
 * #9 no-fabricated-data). Null/undefined values render as the original
 * `{token}` so the operator sees what the recipient WON'T see filled in.
 */
const TOKEN_RE =
  /\{(first_name|event_name|event_date|event_time|doors_open|brand_name|event_url|spots_left|previous_event_name|next_event_name|event_id)\}/g;

export function substituteOnce(
  input: string,
  vars: PreviewVariables,
): string {
  return input.replace(TOKEN_RE, (match, key: keyof PreviewVariables) => {
    const v = vars[key];
    if (v === null || v === undefined) return match;
    return String(v);
  });
}
