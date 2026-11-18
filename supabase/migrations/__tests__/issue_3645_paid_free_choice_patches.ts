/**
 * issue #3645 bundle 2C — the ONLY changes 20280806003645 makes to existing
 * functions, each a one-line patch of the LIVE body (the #4420 / 2A pattern:
 * exact-count, re-apply safe). The `old` lines are the live text after
 * #4420 and bundle 2A, so they are anchored on the live bodies, not on a
 * CREATE file. issue_3645_paid_free_choice.implementor.test.ts proves the
 * declarations and the migration agree and that no `new` contains its `old`
 * (so a re-apply is a no-op); the PG17 suite proves each one applies to the
 * real chain, once.
 */

export const TARGET =
  "supabase/migrations/20280806003645_issue_3645_paid_free_choice.sql";

export interface LivePatch {
  fn: string;
  signature: string;
  name: string;
  old: string;
  new: string;
}

export const PAID_FREE_CHOICE_PATCHES: LivePatch[] = [
  {
    fn: "biz_create_experience",
    signature: "public.biz_create_experience(uuid,jsonb,boolean)",
    name: "a new experience stores the host's paid/free choice",
    // Anchored across two lines so the new text does not contain the old
    // one (a re-apply then finds 0 old matches and is a no-op).
    old: "'tier_name', 'Standard',\n        'when_draft', v_when_draft",
    new:
      "'tier_name', 'Standard',\n        'is_free', v_is_free,\n        'when_draft', v_when_draft",
  },
  {
    fn: "biz_publish_experience",
    signature: "public.biz_publish_experience(uuid,jsonb,boolean)",
    name: "a draft save or publish stores the host's paid/free choice",
    old:
      "COALESCE(theme, '{}'::jsonb),\n                            '{experience_meta,venue_text}',",
    new:
      "public.issue_3645_theme_with_is_free(theme, v_is_free),\n                            '{experience_meta,venue_text}',",
  },
  {
    fn: "biz_update_live_experience",
    signature: "public.biz_update_live_experience(uuid,jsonb,text)",
    name: "a live edit stores the host's paid/free choice",
    old:
      "COALESCE(theme, '{}'::jsonb),\n                          '{experience_meta,venue_text}',",
    new:
      "public.issue_3645_theme_with_is_free(theme, v_is_free),\n                          '{experience_meta,venue_text}',",
  },
  {
    fn: "biz_update_live_experience",
    signature: "public.biz_update_live_experience(uuid,jsonb,text)",
    name:
      "the sold-price lock compares a paid experience whose first option is free against its price, not 0",
    old:
      "    v_old_resolved := COALESCE(v_old_resolved, 0);\n\n    IF v_resolved_total IS DISTINCT FROM v_old_resolved THEN",
    new:
      "    v_old_resolved := COALESCE(v_old_resolved, 0);\n    -- issue #3645 bundle 2C: a paid experience whose first option is free\n    -- (say, Kids 0 beside Adult) was sold at its whole price, not at 0; only\n    -- that case changes, so a re-priced ticket still locks its real price.\n    IF v_old_resolved = 0 AND NOT public.issue_3645_experience_is_free(p_event_id) THEN\n      SELECT COALESCE(e.whole_price_cents, 0) INTO v_old_resolved\n        FROM public.events e WHERE e.id = p_event_id;\n    END IF;\n\n    IF v_resolved_total IS DISTINCT FROM v_old_resolved THEN",
  },
  {
    fn: "issue_1973_current_experience_payload",
    signature: "public.issue_1973_current_experience_payload(uuid)",
    name: "the read-back says free from the one rule, not the first ticket",
    old: "'is_free',COALESCE(v_ticket.is_free,v_event.whole_price_cents=0),",
    new: "'is_free',public.issue_3645_experience_is_free(p_event_id),",
  },
];

/** The SQL dollar-quoted literal the migration passes for `s`. */
export function dollarQuoted(tag: string, s: string): string {
  if (s.includes(`$${tag}$`)) throw new Error(`text contains $${tag}$`);
  return `$${tag}$${s}$${tag}$`;
}
