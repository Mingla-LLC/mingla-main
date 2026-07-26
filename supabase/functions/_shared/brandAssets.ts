// ISSUE-1001 [brand logo consolidation] — the ONE place backend code resolves
// the Mingla logo URL.
//
// HISTORY (why this module exists — read before "simplifying"):
// Before #1001, FOUR call sites (marketingEmailRender, careers-apply x2,
// brandInviteEmail) silently fell back to a DEAD 404 URL (the retired
// email-assets logo path) whenever the MINGLA_LOGO_URL
// secret was missing — every marketing/careers/invite email shipped a broken
// logo image. Two more (ticket-confirmation-dispatch, ticket-pdf-fetch)
// degraded to a text-only PDF wordmark. The transactional shell fail-louded
// in prod instead.
//
// THE RULE: the default below MUST stay (a) on the BARE host
// (usemingla.com — the canonical host standard, no www), and (b) LIVE
// (mingla-marketing/public/brand/email/ serves it, Vercel-deploy-gated;
// parity-checked byte-identical to packages/brand-assets/
// mingla-wordmark-email.png by issue-1001-brand-asset-parity.mjs). The env
// secret stays the authoritative override; with a live default the secret is
// OPTIONAL, so no code path can ever resolve a dead logo URL again
// (I-PROPOSED-1001-BRAND-ASSET-CANON, enforced by
// .github/scripts/strict-grep/issue-1001-dead-logo-urls.mjs).
import { resolveRuntimeString } from "./runtimeConfig.ts";

export const DEFAULT_MINGLA_LOGO_URL =
  "https://usemingla.com/brand/email/mingla-wordmark-email.png";

export function minglaLogoUrl(): string {
  const v = resolveRuntimeString("mingla_logo_url", "MINGLA_LOGO_URL");
  return v && v.trim().length > 0 ? v.trim() : DEFAULT_MINGLA_LOGO_URL;
}
