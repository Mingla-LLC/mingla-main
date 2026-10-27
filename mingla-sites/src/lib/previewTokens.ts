import { TOKEN_CSS_VARS } from "../contracts/generated/tokens.ts";
import { MINGLA_BUSINESS_ORIGIN, MINGLA_STUDIO_ORIGIN } from "./origins";

/*
 * #2829 W9r (DESIGN_SPEC §1.5) — the Business app's "Website design" shows
 * colour, shape and motion changes in the private preview BEFORE they are
 * saved: the parent window posts the would-be token declarations and the
 * preview applies them to :root. Accepted only on the private preview, only
 * from the same parents that may frame it (frame-ancestors), and only for the
 * token variables the design system defines with values of their own shapes
 * (hex, rgb triple, numbers, px, the two enums) — nothing else can be styled
 * and no markup or script can travel this way. Nothing is stored.
 */
export const PREVIEW_TOKENS_MESSAGE = "mingla:preview-tokens";

const ALLOWED_VARS = new Set(TOKEN_CSS_VARS);
const SAFE_VALUE = /^(#[0-9a-f]{6}|\d{1,3} \d{1,3} \d{1,3}|-?\d{1,3}(\.\d{1,4})?|\d{1,3}px|var\(--design-button-radius\)|uppercase|none)$/i;
const VERCEL_PREVIEW = /^https:\/\/mingla-business-[a-z0-9-]+\.vercel\.app$/;
const LOOPBACK = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/;

export type PreviewParentPolicy = { localMode: boolean };

/** May this origin restyle the preview? Mirrors frameAncestorsFor('/preview'). */
export function previewParentAllowed(origin: string, policy: PreviewParentPolicy): boolean {
  if (origin === MINGLA_BUSINESS_ORIGIN || origin === MINGLA_STUDIO_ORIGIN) return true;
  if (VERCEL_PREVIEW.test(origin)) return true;
  return policy.localMode && LOOPBACK.test(origin);
}

/** The declarations to apply, filtered to token variables with safe values ([] when not a token message). */
export function previewTokenDeclarations(data: unknown): Array<[name: string, value: string]> {
  if (!data || typeof data !== "object") return [];
  const message = data as { type?: unknown; declarations?: unknown };
  if (message.type !== PREVIEW_TOKENS_MESSAGE || !Array.isArray(message.declarations)) return [];
  const out: Array<[string, string]> = [];
  for (const entry of message.declarations.slice(0, 200)) {
    if (typeof entry !== "string") continue;
    const split = entry.indexOf(":");
    if (split < 1) continue;
    const name = entry.slice(0, split).trim();
    const value = entry.slice(split + 1).trim();
    if (ALLOWED_VARS.has(name) && SAFE_VALUE.test(value)) out.push([name, value]);
  }
  return out;
}
