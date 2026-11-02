/**
 * #4226 — the ONE footer line every Mingla email carries (Seth, 2026-11-02).
 *
 * Canonical text. Read by the shared email shell (copy.ts FOOTER_DISCLAIMER ->
 * shell.ts), so every transactional email, every admin send and every host
 * brand blast prints it. It lives inside supabase/functions because edge
 * deploys bundle only this tree. The host composer preview reads the mirror in
 * packages/brand-rendering/emailFooter.ts, and
 * issue_4226_one_email_footer_line.implementor.test.ts fails if the two differ.
 * Curly apostrophes and no trailing period are deliberate.
 */
export const EMAIL_FOOTER_LINE =
  "You’re receiving this email because you’ve connected with Mingla";
