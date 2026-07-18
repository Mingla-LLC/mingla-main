// ORCH-1384 [partner brand-management verbs] — shared brand-invite email
// builder + sender + token minting.
//
// MOVE-ONLY extraction (SPEC §4.3): `buildInviteEmail`, `sendInviteEmail`,
// `makeToken`, `sha256Hex` and their local helpers/constants relocated
// VERBATIM from `invite-brand-member/index.ts` so partner-reissue-invitation
// (ORCH-1384) and invite-brand-member share ONE email source of truth.
// Byte-identical template output; zero behavior change. The invite fn's
// existing __tests__ (which import from ../index.ts re-exports) are the
// refactor's guard.

// ORCH-1081 — wrap the invite email through the Mingla brand shell
// (header/hero/footer). renderShell handles the outer wrapper; we provide the
// inner bodyHtml. escapeHtml is the canonical escape; reuse it here so any
// caller-provided string (brand name, inviter name, personal note) is
// rendered safely.
import { renderShell } from "./email/shell.ts";
import { escapeHtml as sharedEscapeHtml } from "./email/escape.ts";

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const EMAIL_MAX = 254;

export const TOKEN_BYTES = 32;
export const EXPIRY_DAYS = 7;

// Random URL-safe token. 32 bytes → ~43 base64url chars; ~256 bits of entropy.
export function makeToken(): string {
  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  // base64url
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * ORCH-1081 — Build the invite email, wrapped through the shared Mingla
 * email shell (renderShell). When `partnerSetup=true`, the layout swaps to
 * partner-attribution copy and the brand cover image renders as the email
 * hero banner. Falls back to the standard Mingla logo header when no cover.
 *
 * Inputs added beyond the ORCH-1050 shape:
 *   - brandCoverUrl       — direct URL to the brand's cover (image only, no
 *                            video — shell hero won't render a video tag).
 *   - personalNote        — optional message from the inviter (≤280 chars).
 *   - partnerSetup        — when true, partner-mode body + CTA copy.
 *   - logoUrl/supportEmail/footerAddress — shell config; sourced from
 *                            env in the caller and threaded through here.
 */
export function buildInviteEmail(input: {
  inviteeName: string;
  inviteeEmail: string;
  brandName: string;
  inviterName: string;
  role: string;
  acceptUrl: string;
  from: string;
  brandCoverUrl?: string | null;
  brandCoverMediaType?: string | null;
  personalNote?: string | null;
  partnerSetup?: boolean;
  logoUrl?: string;
  supportEmail?: string;
  footerAddress?: string;
}): { from: string; to: string[]; subject: string; html: string; text: string } {
  const roleLabel = roleDisplay(input.role);
  const partnerSetup = input.partnerSetup === true;

  // Shell config — fall back to defaults that match the rest of the codebase.
  // Production paths inject MINGLA_LOGO_URL / MINGLA_FOOTER_ADDRESS from env;
  // tests can override.
  const logoUrl = input.logoUrl ??
    "https://usemingla.com/email-assets/mingla-logo.png";
  const supportEmail = input.supportEmail ?? "support@usemingla.com";
  const footerAddress = input.footerAddress ?? "Mingla, hello@usemingla.com";

  // Only use the brand cover as the email hero when it's a still image.
  // Skip video covers (and gifs are okay — most mail clients render them).
  const useBrandHero = typeof input.brandCoverUrl === "string" &&
    input.brandCoverUrl.length > 0 &&
    input.brandCoverMediaType !== "video";

  const subject = partnerSetup
    ? `${input.brandName} — your Mingla brand is ready to claim`
    : `${input.inviterName} invited you to join ${input.brandName}'s team on Mingla`;

  const preheader = partnerSetup
    ? `${input.inviterName} built ${input.brandName} for you. Accept, connect your bank, and you're live.`
    : `${input.inviterName} added you to ${input.brandName} as ${roleLabel}. Accept to jump in — and grab the app.`;

  // ORCH-1329 — designer polish (DESIGN_ORCH-1329). Every interpolation of a
  // brand/inviter/note/role/cta string in an HTML-context literal flows through
  // sharedEscapeHtml(...) at the call site so the ORCH-0785-C buyer-string-escape
  // gate sees an already-escaped form. The download URL is a STATIC LITERAL
  // (no interpolation — nothing to escape).
  const FONT_STACK =
    "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

  const ctaLabel = partnerSetup
    ? `Accept & set up ${input.brandName}`
    : "Accept invitation";

  const roleCan = roleCanPhrase(input.role);

  // --- Partner-setup-only blocks ---
  const eyebrowChip = partnerSetup
    ? `<p style="margin:0 0 14px 0;"><span style="display:inline-block;padding:6px 12px;border-radius:999px;background:#FFF6F1;color:#B23E12;font-size:12px;font-weight:700;letter-spacing:0.4px;text-transform:uppercase;">Set up for you by ${sharedEscapeHtml(input.inviterName)}</span></p>`
    : "";

  const leadBlock = partnerSetup
    ? `<p style="margin:0 0 20px 0;font-size:16px;line-height:1.5;color:#0F1115;font-weight:600;">${sharedEscapeHtml(input.inviterName)} built <span style="color:#B23E12;">${sharedEscapeHtml(input.brandName)}</span> for you on Mingla — your page, events and photos are done.</p><p style="margin:0 0 18px 0;font-size:15px;line-height:1.55;color:#5B6172;">Three quick steps and it's yours:</p>`
    : "";

  const stepsBlock = partnerSetup
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px 0;"><tr><td width="40" valign="top" style="padding:0 12px 16px 0;"><div style="width:28px;height:28px;border-radius:14px;background:#FFF6F1;color:#B23E12;font-size:14px;font-weight:700;line-height:28px;text-align:center;">1</div></td><td valign="top" style="padding:0 0 16px 0;"><p style="margin:0 0 2px 0;font-size:15px;font-weight:600;color:#0F1115;line-height:1.35;">Accept &amp; claim ${sharedEscapeHtml(input.brandName)}</p><p style="margin:0;font-size:14px;color:#5B6172;line-height:1.5;">You take over as owner — nothing to rebuild.</p></td></tr><tr><td width="40" valign="top" style="padding:0 12px 16px 0;"><div style="width:28px;height:28px;border-radius:14px;background:#FFF6F1;color:#B23E12;font-size:14px;font-weight:700;line-height:28px;text-align:center;">2</div></td><td valign="top" style="padding:0 0 16px 0;"><p style="margin:0 0 2px 0;font-size:15px;font-weight:600;color:#0F1115;line-height:1.35;">Connect your bank</p><p style="margin:0;font-size:14px;color:#5B6172;line-height:1.5;">A few minutes through Stripe, so customers can pay you.</p></td></tr><tr><td width="40" valign="top" style="padding:0 12px 0 0;"><div style="width:28px;height:28px;border-radius:14px;background:#FFF6F1;color:#B23E12;font-size:14px;font-weight:700;line-height:28px;text-align:center;">3</div></td><td valign="top" style="padding:0;"><p style="margin:0 0 2px 0;font-size:15px;font-weight:600;color:#0F1115;line-height:1.35;">You're live</p><p style="margin:0;font-size:14px;color:#5B6172;line-height:1.5;">Your events open for tickets and the money lands in your account.</p></td></tr></table>`
    : "";

  const trustNote = partnerSetup
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:0 0 26px 0;"><tr><td style="padding:12px 14px;background:#FFF6F1;border-radius:8px;"><p style="margin:0;font-size:13px;line-height:1.5;color:#0F1115;"><span style="font-weight:700;color:#B23E12;">Bank-secure.</span> Your bank details go straight to Stripe. Mingla never sees them.</p></td></tr></table>`
    : "";

  // --- Standard-team-invite-only blocks ---
  const valueLine = partnerSetup
    ? ""
    : `<p style="margin:0 0 8px 0;font-size:16px;line-height:1.5;color:#0F1115;font-weight:600;">${sharedEscapeHtml(input.inviterName)} invited you to join <span style="color:#B23E12;">${sharedEscapeHtml(input.brandName)}</span> on Mingla as <span style="color:#B23E12;">${sharedEscapeHtml(roleLabel)}</span>.</p>`;

  const roleClarity = (!partnerSetup && roleCan.length > 0)
    ? `<p style="margin:0 0 16px 0;font-size:14px;line-height:1.55;color:#5B6172;">As ${roleArticle(input.role)} ${sharedEscapeHtml(roleLabel.toLowerCase())} you can ${roleCan}.</p>`
    : "";

  const contextLine = partnerSetup
    ? ""
    : `<p style="margin:0 0 4px 0;font-size:15px;line-height:1.55;color:#0F1115;">${sharedEscapeHtml(input.brandName)} runs its events, tickets and page on Mingla — you're now part of the team that makes it happen.</p>`;

  // --- Optional personal note (partner-setup) ---
  const personalNoteBlock =
    typeof input.personalNote === "string" && input.personalNote.length > 0
      ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:0 0 22px 0;"><tr><td style="padding:14px 16px;background:#FFF6F1;border-left:3px solid #FF6B2C;border-radius:6px;"><p style="margin:0;font-size:14px;line-height:1.5;color:#0F1115;font-style:italic;">"${sharedEscapeHtml(input.personalNote)}"</p><p style="margin:6px 0 0 0;font-size:12px;color:#5B6172;">— ${sharedEscapeHtml(input.inviterName)}</p></td></tr></table>`
      : "";

  // --- Primary CTA (both variants) ---
  // ORCH-1329 AA button-contrast fix (Seth-approved): the white-on-orange
  // primary CTA fill moves #FF6B2C → #C4471A (white-on-fill 4.93:1, passes
  // WCAG AA; #FF6B2C was 2.84:1). Same value as the shared
  // SHELL_TOKENS.BRAND_ORANGE_BUTTON used by the ticket/trip/generic renderers.
  // Decorative #FF6B2C (borders, chip-handled-as-#B23E12) is left unchanged.
  const primaryCtaMargin = partnerSetup ? "0 0 12px 0" : "24px 0 26px 0";
  const primaryCta = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:${primaryCtaMargin};"><tr><td align="center" style="background:#C4471A;border-radius:10px;"><a href="${sharedEscapeHtml(input.acceptUrl)}" style="display:inline-block;padding:15px 30px;color:#FFFFFF;text-decoration:none;font-weight:700;font-size:16px;line-height:20px;font-family:${FONT_STACK};">${sharedEscapeHtml(ctaLabel)}</a></td></tr></table>`;

  // --- Secondary CTA — "Get the Mingla Business app" (both variants) ---
  // Outlined ghost button inside a quiet card so it never competes with the
  // filled primary (hierarchy rule: exactly ONE filled-orange button). The
  // href is a STATIC LITERAL → the /business/download route renders an explicit
  // choice (Download the app: iPhone → business App Store / Android → business
  // Play; or Use on web). ORCH-1381 retired the old 307 redirect, so this copy no
  // longer promises "everywhere else opens the web" — that became FALSE the moment
  // the business Play listing went live (2026-07-15, COMMS-0101).
  // HARD: the href is BYTE-FROZEN — no query string, no token, no UTM
  // (orch-1329-invite-email.tester.test.ts pins it exactly).
  const secondaryHeading = partnerSetup
    ? `Prefer to run ${sharedEscapeHtml(input.brandName)} from your phone?`
    : "Get the app to manage on the go";
  const secondarySub = partnerSetup
    ? "Get the Mingla Business app on iPhone or Android — or open your dashboard on the web."
    : "The Mingla Business app is where you'll do the work — scan guests in, check sales, run events. Get it on iPhone or Android, or open the web dashboard.";
  const secondaryCta = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:0 0 6px 0;"><tr><td style="padding:18px 20px;background:#FFFFFF;border:1px solid #ECECEE;border-radius:12px;"><p style="margin:0 0 3px 0;font-size:14px;font-weight:600;color:#0F1115;line-height:1.4;">${secondaryHeading}</p><p style="margin:0 0 14px 0;font-size:13px;color:#5B6172;line-height:1.5;">${secondarySub}</p><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="background:#FFFFFF;border:1.5px solid #FF6B2C;border-radius:8px;"><a href="https://usemingla.com/business/download" style="display:inline-block;padding:12px 22px;color:#B23E12;text-decoration:none;font-weight:600;font-size:15px;line-height:20px;font-family:${FONT_STACK};">Get the Mingla Business app</a></td></tr></table></td></tr></table>`;

  // --- Fine print (both, tightened: expiry + paste-URL only) ---
  const finePrint = `<p style="margin:22px 0 0 0;font-size:13px;line-height:1.5;color:#5B6172;">This link expires in ${EXPIRY_DAYS} days. If the button doesn't work, paste this into your browser:</p><p style="margin:5px 0 0 0;word-break:break-all;font-size:12px;color:#5B6172;">${sharedEscapeHtml(input.acceptUrl)}</p>`;

  const greeting = `<p style="margin:0 0 14px 0;font-size:15px;line-height:1.55;color:#0F1115;">Hi ${sharedEscapeHtml(input.inviteeName)},</p>`;

  // Outer assembly is a pure `${var}` concatenation (no literal HTML) so the
  // ORCH-0785-C gate skips it; each fragment above is individually escape-safe.
  const bodyHtml = partnerSetup
    ? `${greeting}${eyebrowChip}${leadBlock}${stepsBlock}${personalNoteBlock}${primaryCta}${trustNote}${secondaryCta}${finePrint}`
    : `${greeting}${valueLine}${roleClarity}${contextLine}${primaryCta}${secondaryCta}${finePrint}`;

  const html = renderShell({
    preheader,
    bodyHtml,
    supportEmail,
    logoUrl,
    footerAddress,
    brandHeaderImageUrl: useBrandHero ? (input.brandCoverUrl ?? null) : null,
  });

  // Plain-text fallback (text/plain — no HTML escaping). ORCH-1329: both
  // variants MUST include the accept URL AND the download URL, plus the
  // step/role copy per DESIGN_ORCH-1329 §5/§6.
  const DOWNLOAD_URL = "https://usemingla.com/business/download";
  let text: string;
  if (partnerSetup) {
    const noteLine =
      typeof input.personalNote === "string" && input.personalNote.length > 0
        ? `${input.inviterName} added a note: "${input.personalNote}"\n\n`
        : "";
    text = `Hi ${input.inviteeName},\n\n` +
      `${input.inviterName} built ${input.brandName} for you on Mingla — your page, events and photos are done.\n\n` +
      `Three quick steps and it's yours:\n` +
      `1. Accept — you take over as owner of ${input.brandName}. Nothing to rebuild.\n` +
      `2. Connect your bank — a few minutes through Stripe, so customers can pay you.\n` +
      `3. You're live — your events open for tickets and you get paid.\n\n` +
      noteLine +
      `Accept & set up ${input.brandName}:\n${input.acceptUrl}\n\n` +
      `Bank-secure: your bank details go straight to Stripe. Mingla never sees them.\n\n` +
      `Prefer to manage on your phone? Get the Mingla Business app:\n${DOWNLOAD_URL}\n\n` +
      `This link expires in ${EXPIRY_DAYS} days.\n` +
      `Need help? ${supportEmail}`;
  } else {
    const roleClarityText = roleCan.length > 0
      ? `As ${roleLabel.toLowerCase()} you can ${roleCan}.\n`
      : "";
    text = `Hi ${input.inviteeName},\n\n` +
      `${input.inviterName} invited you to join ${input.brandName} on Mingla as ${roleLabel}.\n` +
      roleClarityText +
      `\n${input.brandName} runs its events, tickets and page on Mingla — you're now part of the team.\n\n` +
      `Accept your invitation:\n${input.acceptUrl}\n\n` +
      `Get the Mingla Business app to manage ${input.brandName} on the go:\n${DOWNLOAD_URL}\n\n` +
      `This link expires in ${EXPIRY_DAYS} days.\n` +
      `Need help? ${supportEmail}`;
  }

  return {
    from: input.from,
    to: [input.inviteeEmail],
    subject,
    html,
    text,
  };
}

function roleDisplay(role: string): string {
  switch (role) {
    case "brand_owner":
      return "Brand owner";
    case "brand_admin":
      return "Brand admin";
    case "event_manager":
      return "Event manager";
    case "finance_manager":
      return "Finance manager";
    case "marketing_manager":
      return "Marketing manager";
    case "scanner":
      return "Scanner";
    default:
      return role;
  }
}

// ORCH-1329 — role-clarity copy for the standard team-invite variant. Returns
// the "{role_can}" phrase (what the role can DO). Static per-role literals, so
// safe to interpolate into HTML without escaping. Unknown role → "" (the
// role-clarity line is omitted entirely).
function roleCanPhrase(role: string): string {
  switch (role) {
    case "brand_owner":
      return "manage everything — events, payouts, team and settings";
    case "brand_admin":
      return "manage events, the team and most brand settings";
    case "event_manager":
      return "create and run events, and manage tickets and guests";
    case "finance_manager":
      return "see sales, and manage payouts and refunds";
    case "marketing_manager":
      return "run campaigns and manage the page and promotions";
    case "scanner":
      return "scan tickets and check guests in at the door";
    default:
      return "";
  }
}

// Grammatical article for the role-clarity line ("As an event manager …").
function roleArticle(role: string): string {
  return role === "event_manager" ? "an" : "a";
}

export async function sendInviteEmail(
  apiKey: string,
  payload: ReturnType<typeof buildInviteEmail>,
): Promise<{ ok: boolean; error?: string }> {
  try {
    // no-attachment: this is a plain transactional invite. No PDF/file
    // payload → opt-out from ORCH-0785-A's attachment-aware gate.
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (response.ok) return { ok: true };
    let detail = "";
    try {
      const body = await response.json() as { message?: string };
      detail = body?.message ?? "";
    } catch {
      /* ignore */
    }
    return { ok: false, error: `resend_${response.status}:${detail}` };
  } catch (err) {
    return {
      ok: false,
      error: `resend_throw:${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
