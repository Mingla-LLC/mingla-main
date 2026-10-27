export type GigScriptSection = {
  on_screen: string;
  voiceover: string;
  shot_notes: string;
};
export type GigScript = {
  sections: GigScriptSection[];
  disclosure: string;
  estimated_seconds: number;
};
export function validateGigScript(
  input: {
    script: GigScript;
    lengthMin: number;
    lengthMax: number;
    displayPrice: string;
    listingFacts: string[];
  },
): { ok: true; script: GigScript } | { ok: false; reasons: string[] } {
  const reasons: string[] = [];
  const body = JSON.stringify(input.script).toLowerCase();
  if (
    !Array.isArray(input.script.sections) ||
    input.script.sections.length === 0 ||
    input.script.sections.some((s) =>
      !s.on_screen?.trim() && !s.voiceover?.trim()
    )
  ) reasons.push("sections_required");
  if (!body.includes("#ad") && !body.includes("paid partnership")) {
    reasons.push("disclosure_required");
  }
  if (
    !Number.isFinite(input.script.estimated_seconds) ||
    input.script.estimated_seconds < input.lengthMin ||
    input.script.estimated_seconds > input.lengthMax
  ) reasons.push("length_out_of_format");
  const moneyClaims =
    body.match(/(?:[$£€₦]|ngn|usd|gbp|eur)\s?[0-9][0-9,.]*/gi) ?? [];
  if (
    moneyClaims.some((claim) =>
      !input.displayPrice.toLowerCase().includes(
        claim.toLowerCase().replace(/\s+/g, ""),
      ) &&
      !claim.toLowerCase().replace(/\s+/g, "").includes(
        input.displayPrice.toLowerCase().replace(/\s+/g, ""),
      )
    )
  ) reasons.push("price_not_server_fact");
  const facts = input.listingFacts.map((f) => f.toLowerCase());
  if (
    body.includes("guaranteed") && !facts.some((f) => f.includes("guaranteed"))
  ) reasons.push("unsupported_claim");
  return reasons.length
    ? { ok: false, reasons: [...new Set(reasons)] }
    : { ok: true, script: input.script };
}
