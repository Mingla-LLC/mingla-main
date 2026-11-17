/**
 * issue #3645 bundle 2A — the ONLY authorised changes 20280801003645 makes.
 *
 * The migration patches each function's LIVE body in place (the same pattern
 * as #4420's pg_temp.issue_4420_patch): it replaces `old` with `new`, refusing
 * unless `old` occurs exactly `1` time, and is a no-op when already applied.
 * Patching the live body keeps every earlier in-place patch (#4420 rewrote a
 * line of all three) instead of rebuilding from a CREATE that predates them.
 *
 * issue_3645_per_stop_price_reemit_hunks.structural.test.ts proves the
 * migration declares exactly these patches, and that each `old` line is in the
 * latest CREATE of its function and in no later in-place patch.
 */

export const TARGET =
  "supabase/migrations/20280801003645_issue_3645_per_stop_paid_price.sql";

export interface LivePatch {
  fn: string;
  /** regprocedure signature the migration patches. */
  signature: string;
  /** The latest migration that CREATEs the function before TARGET. */
  source: string;
  name: string;
  old: string;
  new: string;
}

export const PER_STOP_PRICE_PATCHES: LivePatch[] = [
  {
    fn: "biz_create_experience",
    signature: "public.biz_create_experience(uuid,jsonb,boolean)",
    source:
      "supabase/migrations/20271123003281_issue_3281_r3_spacing_spots.sql",
    name: "creating straight to published refuses a paid per-stop experience at 0 too",
    old:
      "  IF (NOT v_is_free) AND v_pricing_mode = 'whole' AND p_publish AND v_resolved_total <= 0 THEN\n",
    new:
      "  -- issue #3645 bundle 2A: per-stop as well as whole price, the same rule\n  -- as biz_publish_experience. Every known caller creates a draft\n  -- (p_publish = false); this keeps a direct publish from turning free.\n  IF (NOT v_is_free) AND p_publish AND v_resolved_total <= 0 THEN\n",
  },
  {
    fn: "biz_publish_experience",
    signature: "public.biz_publish_experience(uuid,jsonb,boolean)",
    source:
      "supabase/migrations/20280625003281_issue_3281_dates_never_orphan.sql",
    name: "a paid per-stop experience whose stops total 0 is refused, not published free",
    old:
      "  IF (NOT v_is_free) AND v_pricing_mode = 'whole' AND p_publish AND v_resolved_total <= 0 THEN\n",
    new:
      "  -- issue #3645 bundle 2A: any paid experience whose one ticket resolves to\n  -- 0 is refused, per-stop as well as whole price. A per-stop experience\n  -- whose stops total 0 used to publish with a free ticket while not marked\n  -- free. Marking it free is the way to make it free.\n  IF (NOT v_is_free) AND p_publish AND v_resolved_total <= 0 THEN\n",
  },
  {
    fn: "biz_update_live_experience",
    signature: "public.biz_update_live_experience(uuid,jsonb,text)",
    source:
      "supabase/migrations/20280428003645_issue_3645_sell_publish_integrity.sql",
    name: "a live paid per-stop experience can't be saved with stops totalling 0",
    old:
      "  IF (NOT v_is_free) AND v_pricing_mode = 'whole' AND v_resolved_total <= 0 THEN\n",
    new:
      "  -- issue #3645 bundle 2A: per-stop too. Stops totalling 0 on a paid\n  -- experience would rewrite its ticket as free while not marked free.\n  IF (NOT v_is_free) AND v_resolved_total <= 0 THEN\n",
  },
];

/** The SQL dollar-quoted literal the migration passes for `s`. */
export function dollarQuoted(tag: string, s: string): string {
  if (s.includes(`$${tag}$`)) throw new Error(`text contains $${tag}$`);
  return `$${tag}$${s}$${tag}$`;
}
