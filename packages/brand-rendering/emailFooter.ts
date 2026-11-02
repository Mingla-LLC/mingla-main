/**
 * #4226 — the ONE footer line every Mingla email carries (Seth, 2026-11-02).
 *
 * Written here, once, and read by:
 *   - the shared email shell (supabase/functions/_shared/email/copy.ts
 *     FOOTER_DISCLAIMER -> shell.ts), so every transactional email, every
 *     admin send (admin-send-email) and every host brand blast
 *     (marketingEmailRender) prints it;
 *   - the host composer preview (mingla-business EmailPreviewPane), through
 *     @mingla/brand-rendering/emailFooter.
 *
 * Pure TypeScript with no imports so Deno and the business app share it.
 * Curly apostrophes and no trailing period are deliberate.
 */
export const EMAIL_FOOTER_LINE =
  "You’re receiving this email because you’ve connected with Mingla";
