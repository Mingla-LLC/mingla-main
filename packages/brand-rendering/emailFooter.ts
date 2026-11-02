/**
 * #4226 — the ONE footer line every Mingla email carries (Seth, 2026-11-02).
 *
 * Mirror for the host composer preview (mingla-business EmailPreviewPane,
 * through @mingla/brand-rendering/emailFooter). The canonical text is
 * supabase/functions/_shared/email/footerLine.ts, which edge deploys can
 * bundle; issue_4226_one_email_footer_line.implementor.test.ts fails if this
 * copy ever differs. Curly apostrophes and no trailing period are deliberate.
 */
export const EMAIL_FOOTER_LINE =
  "You’re receiving this email because you’ve connected with Mingla";
