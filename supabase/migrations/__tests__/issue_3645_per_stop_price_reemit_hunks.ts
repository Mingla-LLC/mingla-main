/**
 * issue #3645 bundle 2A — the ONLY authorised hunks for every function
 * 20280726003645 re-emits. issue_3645_per_stop_price_reemit_hunks.structural.test.ts
 * proves each body equals its latest earlier definition with exactly these
 * replacements applied, so nothing else in these large functions can move.
 */
import type { Reemit } from "./issue_3645_reemit_hunks.ts";

export const TARGET =
  "supabase/migrations/20280726003645_issue_3645_per_stop_paid_price.sql";

export const PER_STOP_PRICE_REEMITS: Reemit[] = [
  {
    fn: "biz_create_experience",
    source:
      "supabase/migrations/20271123003281_issue_3281_r3_spacing_spots.sql",
    target: TARGET,
    hunks: [
      {
        name: "creating straight to published refuses a paid per-stop experience at 0 too",
        old:
          "  IF (NOT v_is_free) AND v_pricing_mode = 'whole' AND p_publish AND v_resolved_total <= 0 THEN\n",
        new:
          "  -- issue #3645 bundle 2A: per-stop as well as whole price, the same rule\n  -- as biz_publish_experience. Every known caller creates a draft\n  -- (p_publish = false); this keeps a direct publish from turning free.\n  IF (NOT v_is_free) AND p_publish AND v_resolved_total <= 0 THEN\n",
      },
    ],
  },
  {
    fn: "biz_publish_experience",
    source:
      "supabase/migrations/20280625003281_issue_3281_dates_never_orphan.sql",
    target: TARGET,
    hunks: [
      {
        name: "a paid per-stop experience whose stops total 0 is refused, not published free",
        old:
          "  IF (NOT v_is_free) AND v_pricing_mode = 'whole' AND p_publish AND v_resolved_total <= 0 THEN\n",
        new:
          "  -- issue #3645 bundle 2A: any paid experience whose one ticket resolves to\n  -- 0 is refused, per-stop as well as whole price. A per-stop experience\n  -- whose stops total 0 used to publish with a free ticket while not marked\n  -- free. Marking it free is the way to make it free.\n  IF (NOT v_is_free) AND p_publish AND v_resolved_total <= 0 THEN\n",
      },
    ],
  },
  {
    fn: "biz_update_live_experience",
    source:
      "supabase/migrations/20280428003645_issue_3645_sell_publish_integrity.sql",
    target: TARGET,
    hunks: [
      {
        name: "a live paid per-stop experience can't be saved with stops totalling 0",
        old:
          "  IF (NOT v_is_free) AND v_pricing_mode = 'whole' AND v_resolved_total <= 0 THEN\n",
        new:
          "  -- issue #3645 bundle 2A: per-stop too. Stops totalling 0 on a paid\n  -- experience would rewrite its ticket as free while not marked free.\n  IF (NOT v_is_free) AND v_resolved_total <= 0 THEN\n",
      },
    ],
  },
];
