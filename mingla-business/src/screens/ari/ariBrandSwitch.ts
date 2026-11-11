/**
 * #4389 (screen AB) — pure rules for switching brand on Ari.
 *
 * AR-14: the unsent message is kept per brand (it used to be cleared on every
 * brand change). R-16: a switch while Ari is answering asks first.
 */
export type AriDraftsByBrand = Readonly<Record<string, string>>;

/** The key a draft is kept under; "none" is the no-brand (first run) composer. */
export function ariDraftKey(brandId: string | null): string {
  return brandId ?? "none";
}

/** Keep `text` for `brandId`; an empty draft removes the entry. */
export function stashAriDraft(
  drafts: AriDraftsByBrand,
  brandId: string | null,
  text: string,
): AriDraftsByBrand {
  const key = ariDraftKey(brandId);
  const next: Record<string, string> = { ...drafts };
  if (text.trim().length === 0) delete next[key];
  else next[key] = text;
  return next;
}

/** The draft kept for `brandId`, or "". */
export function ariDraftFor(drafts: AriDraftsByBrand, brandId: string | null): string {
  return drafts[ariDraftKey(brandId)] ?? "";
}

export type AriBrandSwitchDecision = "noop" | "apply" | "confirm";

export function decideAriBrandSwitch(input: {
  currentBrandId: string | null;
  nextBrandId: string;
  answering: boolean;
}): AriBrandSwitchDecision {
  if (input.currentBrandId === input.nextBrandId) return "noop";
  return input.answering ? "confirm" : "apply";
}
