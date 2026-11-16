// #4452 §7.6 — the Website pages editor's rules, pure so they are tested
// without a browser: the page list from the site's manifest, blocks and their
// limits (the same ones site_validate_content enforces), free spots, the
// conflict rebase ("Keep both"), the change list, and the editor messages.

export const NEW_DAYS = 14;
export const GROUP_ORDER = Object.freeze(["Explore", "Company", "Host", "Host landing pages", "Form pages"]);
export const HOST_TEMPLATE_KEY = "host-template";
export const LIST_INTRO = "Every public page on usemingla.com is listed here automatically when it ships. New ones get a New tag.";
export const MANIFEST_FAILED = "Couldn't load the page list from usemingla.com.";
export const NO_SPOTS_COPY = "Every page gets the pop-up form straight away. Inline spots appear here once an engineer marks them on the page, which is one line per spot.";
export const TEMPLATE_NOTE = "Changes apply to this host page only. Choose 'All host pages' when adding a block to use it on every one.";
export const BRAND_STYLE_NOTE = "Blocks come in the Mingla brand style. You choose the words and where buttons go; the look is fixed.";
export const ADDED_TOAST = "Added as a draft. Visitors see nothing until you publish.";
export const REMOVED_TOAST = "Removed. That spot shows the page as designed again.";
export const NO_FREE_SPOT = "No free spot that way.";
export const ARCHIVED_BLOCK = "This form is archived. Visitors don't see this block.";
export const HERO_LIMITS_NOTE = "Limits keep the headline on its designed lines at every screen size";
export const AUTOSAVE_MS = 800;
export const TOKEN_REMINT_MS = 50 * 60 * 1000;

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

/** The left list: the manifest's pages by group, each with New, a dirty dot and pop-up only. */
export function pageList(manifest, state, now = Date.now()) {
  const byKey = new Map((state || []).map((s) => [s.page_key, s]));
  const groups = new Map(GROUP_ORDER.map((g) => [g, []]));
  for (const p of manifest?.pages || []) {
    const st = byKey.get(p.key);
    const since = Date.parse(p.since || "");
    const item = {
      key: p.key, path: p.path, title: p.title || p.path, group: p.group,
      spots: p.spots || [], hero: p.hero || null, template: p.template || null, pattern: Boolean(p.pattern),
      isNew: Number.isFinite(since) && now - since <= NEW_DAYS * 86400000,
      changes: st?.draft?.changes ?? 0,
      live: st?.live || null,
      popupOnly: !(p.spots || []).length && !p.hero,
    };
    if (!groups.has(p.group)) groups.set(p.group, []);
    groups.get(p.group).push(item);
  }
  return [...groups].filter(([, items]) => items.length).map(([label, items]) => ({ label, items }));
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

/**
 * Keep both (§7.6): my draft rebased on their live version. My blocks go in
 * spots that are still free; a spot they filled keeps THEIR block, and mine
 * for it is listed in `bumped` ("That spot now has their block") and left
 * out. My hero edit wins only when I changed it from the base I started on.
 */
export function rebaseKeepBoth(mine, theirs, base) {
  const out = { blocks: (theirs?.blocks || []).slice() };
  if (theirs?.hero) out.hero = theirs.hero;
  const bumped = [];
  const baseIds = new Set((base?.blocks || []).map((b) => b.id));
  for (const b of mine?.blocks || []) {
    const sameAsBase = baseIds.has(b.id) && JSON.stringify((base.blocks || []).find((x) => x.id === b.id)) === JSON.stringify(b);
    if (sameAsBase) continue; // unchanged since I started: theirs is the truth
    const taken = out.blocks.find((x) => x.spot === b.spot && x.id !== b.id);
    if (taken) bumped.push({ spot: b.spot, block: b });
    else out.blocks = [...out.blocks.filter((x) => x.id !== b.id), b];
  }
  // A block I removed that they kept is removed again.
  for (const b of base?.blocks || []) {
    if (!(mine?.blocks || []).some((x) => x.id === b.id)) out.blocks = out.blocks.filter((x) => x.id !== b.id);
  }
  const heroChanged = JSON.stringify(mine?.hero || null) !== JSON.stringify(base?.hero || null);
  if (heroChanged) {
    if (mine?.hero) out.hero = mine.hero;
    else delete out.hero;
  }
  return { content: out, bumped };
}

/** "<Name> published <path> <n> min ago." from the PT409 DETAIL. */
export function conflictLine(detail, path, now = Date.now()) {
  let d = {};
  try { d = typeof detail === "string" ? JSON.parse(detail) : detail || {}; } catch { d = {}; }
  const mins = Math.max(0, Math.round((now - Date.parse(d.published_at || "")) / 60000));
  return { line: `${d.published_by || "Someone"} published ${path} ${Number.isFinite(mins) ? mins : 0} min ago.`, liveVersion: Number(d.live_version || 0) };
}

/** The editor iframe address (the real page, drawn by /site-preview with the editor markers). */
export function editorFrameUrl(site, token, adminOrigin, y = 0) {
  const q = new URLSearchParams({ editor: "1", ao: adminOrigin });
  if (y > 0) q.set("y", String(Math.round(y)));
  return `${site}/site-preview/${encodeURIComponent(token)}?${q.toString()}`;
}

/** A message from the editor iframe is acted on only from the site's origin and in the right shape. */
export function editorMessage(event, siteOrigin) {
  if (!event || event.origin !== siteOrigin) return null;
  const d = event.data;
  if (!d || typeof d !== "object") return null;
  const id = (v) => typeof v === "string" && /^[a-z0-9-]{1,64}$/.test(v);
  switch (d.type) {
    case "editor-ready": case "hero-click": return id(d.page) ? d : null;
    case "spot-click": return id(d.page) && id(d.spot) ? d : null;
    case "block-click": return id(d.page) && id(d.spot) && typeof d.block === "string" && /^[0-9a-f-]{36}$/.test(d.block) ? d : null;
    case "editor-scroll": return id(d.page) && typeof d.y === "number" && d.y >= 0 ? d : null;
    default: return null;
  }
}

/** The content key a block lives under: "all host pages" blocks live on the host template. */
export function contentKeyFor(pageKey, block) {
  return block?.all_host_pages ? HOST_TEMPLATE_KEY : pageKey;
}
