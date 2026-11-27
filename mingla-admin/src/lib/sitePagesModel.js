// #4452 §7.6 — the spot rules of the Website pages editor, pure so they are
// tested without a browser: blocks in a coded page's spots and their limits
// (the same ones site_validate_content enforces), free spots, the hero words,
// and the change list. #4636 moved the page list, the canvas messages and the
// conflict handling to siteEditorModel.js (the CMS editor).

export const HOST_TEMPLATE_KEY = "host-template";
export const BRAND_STYLE_NOTE = "Blocks come in the Mingla brand style. You choose the words and where buttons go; the look is fixed.";
export const ADDED_TOAST = "Added as a draft. Visitors see nothing until you publish.";
export const REMOVED_TOAST = "Removed. That spot shows the page as designed again.";
export const NO_FREE_SPOT = "No free spot that way.";
export const ARCHIVED_BLOCK = "This form is archived. Visitors don't see this block.";
export const HERO_LIMITS_NOTE = "Limits keep the headline on its designed lines at every screen size";

/** The limits (site_validate_content, design maxlength). */
export const LIMITS = Object.freeze({
  formHead: 32, formEm: 24, formSub: 90,
  buttonText: 28,
  bannerText: 60, bannerBtn: 24,
  heroH1: 48, heroEm: 24, heroLead: 200, heroButton: 28,
});

/** The designed hero words of the two editable heroes (app/creators and app/locals page.tsx). */
export const CODED_HEROES = Object.freeze({
  creators: {
    h1: "Get hired to show people what a city",
    em: "feels like.",
    lead: "Mingla Creators make the videos and photos that help people choose. Become a Creator and complete paid gigs for places and events on Mingla.",
    buttons: [{ text: "Get Mingla to join", to: { kind: "app" } }, { text: "Book a call", to: { kind: "schedule_creators" } }],
  },
  locals: {
    h1: "One honest review,",
    em: "every month.",
    lead: "Mingla chooses up to three Locals in each open city. Complete one useful, independent place review each month and earn $150 after approval.",
    buttons: [{ text: "Get Mingla to apply", to: { kind: "app" } }, { text: "Book a call", to: { kind: "schedule_locals" } }],
  },
});

export const POPUP_DEFAULTS = Object.freeze({ trigger: "scroll_half", freq: "weekly", devices: "all", style: "centre" });
export const POPUP_CHOICES = Object.freeze({
  trigger: [["scroll_half", "Halfway down the page"], ["after_20s", "After 20 seconds"], ["exit_intent", "When they go to leave (desktop)"], ["button_only", "Only from a button"]],
  freq: [["weekly", "At most once a week"], ["visit", "Once per visit"], ["every_view", "Every page view"]],
  devices: [["all", "Phones and desktops"], ["phone", "Phones only"], ["desktop", "Desktops only"]],
  style: [["centre", "Big centre pop-up"], ["side", "Full-height side panel"]],
});
export const POPUP_ALWAYS = "Always: never after they've sent it (180 days), never on /apply, /schedule or a report, and never over the privacy strip.";

export const DEST_KINDS = Object.freeze([
  ["app", "Get the app"],
  ["popup", "Pop-up form"],
  ["schedule", "Book a call (/schedule)"],
  ["schedule_creators", "Book a call (/schedule/creators)"],
  ["schedule_locals", "Book a call (/schedule/locals)"],
  ["form_page", "Form page"],
  ["url", "Any link"],
]);

export function uuid() {
  return globalThis.crypto.randomUUID();
}


export function emptyContent() {
  return { blocks: [] };
}

/** A new block for a spot (the pop-up spot only takes a Form). */
export function newBlock(type, spot, { formId = null, allHostPages = false } = {}) {
  const base = { id: uuid(), type, spot };
  if (allHostPages) base.all_host_pages = true;
  if (spot === "popup") return { ...base, type: "popup", form_id: formId, popup: { ...POPUP_DEFAULTS } };
  if (type === "form") return { ...base, form_id: formId };
  if (type === "buttons") return { ...base, buttons: [{ text: "Book a call", to: { kind: "schedule" } }] };
  if (type === "banner") return { ...base, text: "Applications are open", btn: "Apply", to: { kind: "popup" }, show_until: null };
  throw new Error(`unknown block ${type}`);
}

export function blockAt(content, spot) {
  return (content?.blocks || []).find((b) => b.spot === spot) || null;
}

export function putBlock(content, block) {
  const blocks = (content?.blocks || []).filter((b) => b.id !== block.id);
  if (blocks.some((b) => b.spot === block.spot)) throw new Error("That spot already has a block. Pick another spot or remove the other block.");
  return { ...content, blocks: [...blocks, block] };
}

export function patchBlock(content, id, patch) {
  return { ...content, blocks: (content?.blocks || []).map((b) => (b.id === id ? { ...b, ...patch, id: b.id, spot: patch.spot ?? b.spot } : b)) };
}

export function removeBlock(content, id) {
  return { ...content, blocks: (content?.blocks || []).filter((b) => b.id !== id) };
}

/**
 * Move a block to the next FREE spot up (-1) or down (+1) in page order; the
 * pop-up and the details step never move. Returns {content} or {error}.
 */
export function moveBlock(content, id, dir, spots) {
  const b = (content?.blocks || []).find((x) => x.id === id);
  const order = (spots || []).filter((s) => s.kind !== "details").map((s) => s.key);
  const i = b ? order.indexOf(b.spot) : -1;
  if (i < 0) return { error: NO_FREE_SPOT };
  for (let j = i + dir; j >= 0 && j < order.length; j += dir) {
    if (!blockAt(content, order[j])) return { content: patchBlock(content, id, { spot: order[j] }) };
  }
  return { error: NO_FREE_SPOT };
}

/** Hero edits stay inside the limits; Reset removes the hero key (the page shows its designed words). */
export function heroOf(content, pageKey) {
  return content?.hero || CODED_HEROES[pageKey] || null;
}
export function resetHero(content) {
  const { hero: _drop, ...rest } = content || {};
  void _drop;
  return { blocks: [], ...rest };
}
export function cp(s) {
  return [...String(s || "")].length;
}
export function heroProblems(hero) {
  const out = [];
  if (!hero) return out;
  if (cp(hero.h1) < 1 || cp(hero.h1) > LIMITS.heroH1) out.push("Headline: 1 to 48 characters.");
  if (cp(hero.em) > LIMITS.heroEm) out.push("Italic ending: 24 characters at most.");
  if (cp(hero.lead) > LIMITS.heroLead) out.push("Lead: 200 characters at most.");
  (hero.buttons || []).forEach((b, i) => { if (cp(b.text) < 1 || cp(b.text) > LIMITS.heroButton) out.push(`Button ${i + 1}: 1 to 28 characters.`); });
  return out;
}

/** What changed from `a` (theirs or live) to `b` (mine): one line per change. */
export function contentChanges(a, b, spotLabel = (s) => s) {
  const out = [];
  const aa = new Map((a?.blocks || []).map((x) => [x.spot, x]));
  const bb = new Map((b?.blocks || []).map((x) => [x.spot, x]));
  for (const [spot, x] of bb) {
    const y = aa.get(spot);
    if (!y) out.push(`Added ${label(x)} at ${spotLabel(spot)}`);
    else if (JSON.stringify(y) !== JSON.stringify(x)) out.push(`Changed the ${label(x)} at ${spotLabel(spot)}`);
  }
  for (const [spot, y] of aa) if (!bb.has(spot)) out.push(`Removed the ${label(y)} at ${spotLabel(spot)}`);
  if (JSON.stringify(a?.hero || null) !== JSON.stringify(b?.hero || null)) out.push(b?.hero ? "Changed the hero words" : "Reset the hero words");
  return out;
}
function label(block) {
  return { form: "form", popup: "pop-up form", buttons: "button row", banner: "banner" }[block.type] || "block";
}





/** The content key a block lives under: "all host pages" blocks live on the host template. */
export function contentKeyFor(pageKey, block) {
  return block?.all_host_pages ? HOST_TEMPLATE_KEY : pageKey;
}
