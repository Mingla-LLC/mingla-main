// #4636 — the Website pages CMS editor's rules, pure so they run under node:test.
//
// The block registry is the site's own file (mingla-marketing/lib/site-blocks/registry.json,
// I-4636-ONE-BLOCK-REGISTRY): every function here takes it as an argument, and
// siteBlocksRegistry.js passes the real one. Nothing here talks to the network.
//
// Paths into block content use the site's format: "heading", "items[1].title"
// (the editor protocol's `field`, and the server's invalid_block messages).

export const SITE_SETTINGS_KEY = "site-settings";
export const DEVICES = Object.freeze({ desktop: 1440, tablet: 834, phone: 390 });
export const DEVICE_LABELS = Object.freeze({ desktop: "Desktop", tablet: "Tablet", phone: "Phone" });
export const AUTOSAVE_MS = 800;
export const TOKEN_REMINT_MS = 50 * 60 * 1000;
export const MAX_SECTIONS = 40;
/** Legal pages stay locked in the editor (decision D4): a check guards their exact wording. */
export const LEGAL_KEYS = Object.freeze(["privacy-policy", "terms-of-service", "organiser-terms", "creator-agreement", "local-agreement", "sms-terms"]);
/** The 14 pages whose sections are registry blocks (site_converted_page_keys()). */
export const CONVERTED_KEYS = Object.freeze(["home", "host", "creators", "locals", "about", "going-out", "download", "events", "trips", "experiences", "restaurants", "hotels", "art", "play"]);
export const CATEGORY_LABELS = Object.freeze({ hero: "Heroes", story: "Story", media: "Media", action: "Actions", live: "Live from Mingla (fills itself)" });
export const CATEGORY_ORDER = Object.freeze(["hero", "story", "media", "action", "live"]);
export const COLOUR_SWATCH = Object.freeze({ paper: "#f5f4f0", cream: "#f0e8db", sand: "#d9cbb4", moss: "#2f3a2e", night: "#15171c", clay: "#8c5a3c" });

/** New-page formats (R8) and the page whose sections each one starts from. */
export const FORMATS = Object.freeze([
  { key: "landing", name: "Landing page", hint: "Same build as Home and For hosts", from: "home" },
  { key: "host-type", name: "Host-type page", hint: "Same build as the seven host pages", from: "events" },
  { key: "programme", name: "Programme page", hint: "Same build as Creators and Locals", from: "creators" },
  { key: "story", name: "Story page", hint: "Same build as About", from: "about" },
  { key: "blank", name: "Blank page", hint: "Start empty and add sections", from: null },
]);

export const COPY = Object.freeze({
  viewOnly: "You can view this page. Ask a website editor to change it.",
  noAccess: "You don't have access to Website pages. Ask an admin for the Website editor role.",
  conflict: "Someone else changed this page. Reload to see their version.",
  locked: "Legal pages are locked in this editor. Changing legal wording needs Seth's sign-off, so the page is shown read-only.",
  layoutLocked: "Layout is locked. This is the same section the website uses today. You change the words, the pictures and videos, and the colour.",
  liveBlock: "This section fills itself from Mingla. You choose the heading and settings it has.",
  fixToSave: "Fix the highlighted fields to save.",
  offline: "Couldn't save: you're offline. Your edits are kept here; Retry when you're back online.",
  previewFailed: "Preview couldn't load.",
  reserved: "That address is already used.",
});

// ------------------------------------------------------------------ paths

/** "items[1].title" → ["items", 1, "title"]. */
export function parsePath(path) {
  const out = [];
  for (const part of String(path || "").split(".")) {
    const m = /^([^[\]]*)((?:\[\d+\])*)$/.exec(part);
    if (!m) return [];
    if (m[1]) out.push(m[1]);
    for (const n of m[2].matchAll(/\[(\d+)\]/g)) out.push(Number(n[1]));
  }
  return out;
}

export function getAt(obj, path) {
  return parsePath(path).reduce((v, k) => (v == null ? undefined : v[k]), obj);
}

/** An immutable set: a copy of `obj` with `value` at `path` (undefined removes an object key). */
export function setAt(obj, path, value) {
  const keys = typeof path === "string" ? parsePath(path) : path;
  if (!keys.length) return value;
  const [k, ...rest] = keys;
  const base = obj ?? (typeof k === "number" ? [] : {});
  const copy = Array.isArray(base) ? base.slice() : { ...base };
  const next = setAt(base[k], rest, value);
  if (next === undefined && !Array.isArray(copy)) delete copy[k];
  else copy[k] = next;
  return copy;
}

// --------------------------------------------------------------- registry

export function blockDef(registry, type) {
  return registry?.blocks?.find((b) => b.key === type) || null;
}

/** The colours a block may use in its variant; the first is its default. */
export function allowedColours(def, variant) {
  if (!def) return [];
  return (variant !== undefined ? def.colours[variant] : undefined) ?? def.colours["*"] ?? Object.values(def.colours)[0] ?? [];
}

/** The picker's groups: every registry block, in category order. */
export function pickerGroups(registry) {
  return CATEGORY_ORDER.map((c) => ({ key: c, label: CATEGORY_LABELS[c], blocks: (registry?.blocks || []).filter((b) => b.category === c) })).filter((g) => g.blocks.length);
}

/** Whether another block of `type` may go on a page that has `sections` (maxPerPage). */
export function canAdd(registry, sections, type) {
  const def = blockDef(registry, type);
  if (!def) return false;
  if ((sections || []).length >= MAX_SECTIONS) return false;
  if (def.maxPerPage === undefined) return true;
  return (sections || []).filter((s) => s.type === type).length < def.maxPerPage;
}

export function newBlockId(rand = () => globalThis.crypto.randomUUID()) {
  return `b-${rand().replace(/-/g, "").slice(0, 12)}`;
}

/**
 * Starting content for the blocks no converted page uses (the others start
 * from their first use in page-defaults.json). Each one passes validateBlock.
 */
export const STARTERS = Object.freeze({
  cityHero: { city: "lagos" },
  toolCards: { items: [{ tool: "/tools/pricing", title: "The Undercharging Audit", body: "A free check of your ticket prices against places like yours.", forWho: "For event hosts", cta: "Check my price", media: "v:crowd" }] },
  quickLinks: { heading: "Quick links", items: [{ action: { label: "Help centre", to: "/help" } }, { action: { label: "Book a call", to: "/schedule" } }] },
  stillStuck: { heading: "Still *stuck?*", lead: "Talk to the team that built it.", primary: { label: "Book a call", to: "/schedule" }, secondary: { label: "Email us", to: "mailto:hello@usemingla.com" } },
  form: { formId: "", heading: "Tell us about you" },
  buttons: { items: [{ action: { label: "Book a call", to: "/schedule" } }] },
  banner: { text: "Applications are open", button: "Apply", action: { label: "Apply", to: "/creators" } },
  cityWeekend: { city: "lagos" },
  topPlaces: { city: "lagos" },
  cityPlans: { city: "lagos", heading: "More than *one mode.*" },
  cityHostBand: { city: "lagos" },
  blogStories: { title: "From the *blog*", lede: "Stories, guides and ideas for going out." },
  helpVideos: {},
  openRoles: {},
  scheduler: {},
});

/** The first use of each block type on the converted pages (page-defaults.json). */
export function defaultsByType(pageDefaults) {
  const out = {};
  for (const sections of Object.values(pageDefaults?.pages || {})) {
    for (const s of sections || []) if (!out[s.type]) out[s.type] = s;
  }
  return out;
}

/** A new block of `type` with valid starting content and a fresh id. */
export function starterBlock(registry, pageDefaults, type, { formId = null, rand } = {}) {
  const def = blockDef(registry, type);
  if (!def) throw new Error(`unknown block ${type}`);
  const sample = defaultsByType(pageDefaults)[type];
  const content = structuredClone(sample?.content ?? STARTERS[type] ?? {});
  if (type === "form" && formId) content.formId = formId;
  const block = { id: newBlockId(rand), type, version: def.version, content };
  const colour = sample?.colour ?? allowedColours(def, content.variant)[0];
  if (colour) block.colour = colour;
  return block;
}

/** The sections a converted page starts from when nothing is published (its coded page); ids come from stableIds / withIds. */
export function defaultSections(pageDefaults, pageKey) {
  return (pageDefaults?.pages?.[pageKey] || []).map((s) => structuredClone(s));
}

// -------------------------------------------------------------- sections

export function moveSection(sections, from, to) {
  if (from === to || from < 0 || to < 0 || from >= sections.length || to >= sections.length) return sections;
  const out = sections.slice();
  const [b] = out.splice(from, 1);
  out.splice(to, 0, b);
  return out;
}
export function duplicateSection(sections, i, rand) {
  const b = sections[i];
  if (!b) return sections;
  const out = sections.slice();
  out.splice(i + 1, 0, { ...structuredClone(b), id: newBlockId(rand) });
  return out;
}
export function toggleHidden(sections, i) {
  return sections.map((b, j) => (j === i ? (b.hidden ? omit(b, "hidden") : { ...b, hidden: true }) : b));
}
export function removeSection(sections, i) {
  return sections.filter((_, j) => j !== i);
}
export function insertSection(sections, at, block) {
  const out = sections.slice();
  out.splice(Math.max(0, Math.min(at, out.length)), 0, block);
  return out;
}
function omit(o, k) {
  const { [k]: _drop, ...rest } = o;
  void _drop;
  return rest;
}

/** Ids for sections that have none, by position, so the published list and the draft built from it match. */
export function stableIds(sections, prefix = "s") {
  return (sections || []).map((s, i) => (s.id ? s : { ...s, id: `${prefix}${i}` }));
}

/** Give every section a stable id (the editor keeps it across moves). */
export function withIds(sections, rand) {
  return (sections || []).map((s) => (s.id ? s : { ...s, id: newBlockId(rand) }));
}

// -------------------------------------------------------------- validation
// A port of validateBlock / validatePage (mingla-marketing/lib/site-blocks/registry.ts),
// so the editor shows problems on the right field before a save; the database
// (site_block_errors) stays the authority.

const MEDIA_RE = /^(v|p):[a-z0-9][a-z0-9-]{0,60}$|^m:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CITY_RE = /^[a-z0-9][a-z0-9-]{0,40}$/;
const isRecord = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

export function actionTargetKind(to) {
  if (typeof to !== "string" || to.length > 300) return null;
  if (to === "app:explorer") return "explorer";
  if (to === "app:host") return "host";
  if (/^\/(?!\/)[A-Za-z0-9\-._~/?=&%#]*$/.test(to)) return to.includes("..") ? null : "internal";
  if (/^https:\/\/[A-Za-z0-9.-]+(\/[^\s<>"']*)?$/.test(to)) return "web";
  if (/^mailto:[^\s<>"'@]+@[^\s<>"'@]+$/.test(to)) return "mail";
  return null;
}

function checkText(value, max, em, at, add) {
  if (typeof value !== "string") return add(at, "Must be text.");
  if (value.trim() === "") add(at, "Can't be empty.");
  if (value.length > max) add(at, `At most ${max} characters.`);
  if (/[<>]/.test(value)) add(at, "Remove < and >.");
  const stars = (value.match(/\*/g) || []).length;
  if (!em && stars > 0) add(at, "Italic (*…*) isn't allowed here.");
  if (em && stars % 2 !== 0) add(at, "Close the *italic* words with a second *.");
}

function checkAction(value, at, add, targets) {
  if (!isRecord(value)) return add(at, "Needs a label and where it goes.");
  const kind = actionTargetKind(value.to);
  if (kind === null) add(`${at}.to`, "Use a page on the site (/…), an https:// link or an email.");
  else if (targets && !targets.includes(kind)) add(`${at}.to`, `This button can only go to: ${targets.map(targetLabel).join(", ")}.`);
  if (value.label !== undefined) checkText(value.label, 40, false, `${at}.label`, add);
  if (value.label === undefined && value.to !== "app:explorer" && value.to !== "app:host") add(`${at}.label`, "Needs a label.");
}

export function targetLabel(kind) {
  return { internal: "a page on the site", web: "an https:// link", mail: "an email", explorer: "the Mingla app", host: "the Mingla Host app" }[kind] || kind;
}

function checkField(field, value, at, add) {
  const required = field.kind === "list" ? field.min > 0 : field.required !== false;
  if (value === undefined || value === null) {
    if (required) add(at, "Required.");
    return;
  }
  switch (field.kind) {
    case "text": return checkText(value, field.max, field.em === true, at, add);
    case "media":
      if (typeof value !== "string" || !MEDIA_RE.test(value)) return add(at, "Pick a picture or video.");
      if (value.startsWith("v:") && !field.accept.includes("video")) add(at, "A clip isn't allowed here.");
      if (value.startsWith("p:") && !field.accept.includes("photo")) add(at, "A photo isn't allowed here.");
      return;
    case "action": return checkAction(value, at, add, field.targets);
    case "enum": if (typeof value !== "string" || !field.options.includes(value)) add(at, "Pick one of the options."); return;
    case "city": if (typeof value !== "string" || !CITY_RE.test(value)) add(at, "Pick a city."); return;
    case "list":
      if (!Array.isArray(value)) return add(at, "Must be a list.");
      if (value.length < field.min) add(at, `Needs at least ${field.min}.`);
      if (value.length > field.max) add(at, `At most ${field.max}.`);
      value.forEach((item, i) => {
        if (field.textItem) return checkText(item, field.textItem.max, field.textItem.em === true, `${at}[${i}]`, add);
        if (!isRecord(item)) return add(`${at}[${i}]`, "Must be a set of fields.");
        for (const f of field.item) checkField(f, item[f.key], `${at}[${i}].${f.key}`, add);
      });
      return;
    default: add(at, "Unknown field.");
  }
}

/** { ok, fields: { "<path>": message } } for one block (paths relative to its content). */
export function checkBlock(registry, block) {
  const fields = {};
  const add = (at, msg) => { if (!fields[at]) fields[at] = msg; };
  const def = blockDef(registry, block?.type);
  if (!def) return { ok: false, fields: { "": "This section type isn't known to the site." } };
  if (block.version > def.version) add("", "This section is newer than the site knows.");
  if (!isRecord(block.content)) add("", "Content is missing.");
  else {
    for (const k of Object.keys(block.content)) if (!def.fields.some((f) => f.key === k)) add(k, "Not a field of this section.");
    for (const f of def.fields) checkField(f, block.content[f.key], f.key, add);
    if (def.key === "form" && !block.content.formId) fields.formId = "Pick a form.";
  }
  if (block.colour !== undefined && !allowedColours(def, block.content?.variant).includes(block.colour)) add("colour", "That colour isn't available for this section.");
  return { ok: Object.keys(fields).length === 0, fields };
}

/** Every section's problems plus page-level ones (40 at most, maxPerPage). */
export function checkSections(registry, sections) {
  const blocks = (sections || []).map((b) => checkBlock(registry, b));
  const page = [];
  if ((sections || []).length > MAX_SECTIONS) page.push(`A page has at most ${MAX_SECTIONS} sections.`);
  const counts = new Map();
  for (const s of sections || []) counts.set(s.type, (counts.get(s.type) || 0) + 1);
  for (const [type, n] of counts) {
    const def = blockDef(registry, type);
    if (def?.maxPerPage !== undefined && n > def.maxPerPage) page.push(`${def.name}: at most ${def.maxPerPage} per page.`);
  }
  return { ok: page.length === 0 && blocks.every((b) => b.ok), blocks, page };
}

/**
 * The server's 22023 invalid_content DETAIL ([{path, code, message?}]) on the
 * right block and field: { byIndex: { <i>: { <field>: message } }, page: [..] }.
 * invalid_block messages read "<blockKey>.<field path>: <problem>".
 */
export function serverErrors(detail) {
  const out = { byIndex: {}, page: [] };
  let list = detail;
  if (typeof list === "string") { try { list = JSON.parse(list); } catch { list = []; } }
  for (const e of Array.isArray(list) ? list : []) {
    const m = /^sections\[(\d+)\](?:\.content\.(.+))?$/.exec(e?.path || "");
    if (!m) { out.page.push(plainCode(e)); continue; }
    const i = Number(m[1]);
    let field = m[2] || "";
    let msg = plainCode(e);
    const mm = /^[A-Za-z]+\.?([^:]*):\s*(.+)$/.exec(e?.message || "");
    if (mm && !field) { field = mm[1]; msg = mm[2]; }
    out.byIndex[i] = { ...(out.byIndex[i] || {}), [field]: msg.charAt(0).toUpperCase() + msg.slice(1) };
  }
  return out;
}
function plainCode(e) {
  return ({ bad_form: "Pick a live form.", too_many_blocks: `A page has at most ${MAX_SECTIONS} sections.`, over_page_limit: "One of these sections can only be used once on a page.", sections_not_editable: "This page's sections can't be edited.", bad_settings: "The menu or footer has a problem.", unknown_page: "This page isn't known.", invalid_block: "This section has a problem." })[e?.code] || e?.message || "Something on this page isn't allowed.";
}

// ---------------------------------------------------------- change lists

/** One plain line per change from `live` to `draft` sections (the publish summary). */
export function sectionChanges(registry, live, draft) {
  const name = (s) => blockDef(registry, s?.type)?.name || s?.type || "section";
  const a = live || [];
  const b = draft || [];
  const out = [];
  const aIds = new Map(a.map((s, i) => [s.id ?? `#${i}:${s.type}`, s]));
  const bIds = new Set(b.map((s, i) => s.id ?? `#${i}:${s.type}`));
  b.forEach((s, i) => {
    const prev = aIds.get(s.id ?? `#${i}:${s.type}`);
    if (!prev) out.push(`Added "${name(s)}"`);
    else {
      if (JSON.stringify(prev.content) !== JSON.stringify(s.content)) out.push(`Edited "${name(s)}"`);
      if ((prev.colour || null) !== (s.colour || null)) out.push(`Changed the colour of "${name(s)}"`);
      if (Boolean(prev.hidden) !== Boolean(s.hidden)) out.push(`${s.hidden ? "Hid" : "Showed"} "${name(s)}"`);
    }
  });
  for (const [id, s] of aIds) if (!bIds.has(id)) out.push(`Deleted "${name(s)}"`);
  const order = (l) => l.filter((s) => s.id && bIds.has(s.id) && aIds.has(s.id)).map((s) => s.id).join(",");
  if (order(a) !== order(b)) out.push("Reordered sections");
  return [...new Set(out)];
}

export function settingsChanges(live, draft) {
  const out = [];
  if (JSON.stringify(live?.nav ?? null) !== JSON.stringify(draft?.nav ?? null)) out.push("Changed the menu");
  if (JSON.stringify(live?.footer ?? null) !== JSON.stringify(draft?.footer ?? null)) out.push("Changed the footer");
  return out;
}

// ------------------------------------------------------------ page list

/**
 * What a page is in the editor: blocks (converted or staff-made), settings
 * (nav and footer), spots (coded pages keep their #4452 form / button /
 * banner spots), locked (legal) or pattern (one template for many URLs).
 */
export function pageKind(key, manifestPage) {
  if (key === SITE_SETTINGS_KEY) return "settings";
  if (/^p-[0-9a-f]{12}$/.test(key) || CONVERTED_KEYS.includes(key)) return "blocks";
  if (LEGAL_KEYS.includes(key)) return "locked";
  if (manifestPage?.pattern) return "pattern";
  return "spots";
}

/** A page's status chip: draft (never published), changes (unpublished edits), published, designed (nothing published), locked. */
export function pageStatus(kind, st) {
  if (kind === "locked") return "locked";
  if (st?.custom && !st.custom.ever_published && !st.live) return "draft";
  if (st?.custom?.status === "unpublished") return "deleted";
  if ((st?.draft?.changes ?? 0) > 0) return "changes";
  if (st?.live) return "published";
  return "designed";
}
export const STATUS_LABELS = Object.freeze({ draft: "Draft", changes: "Changes waiting", published: "Published", designed: "As designed", locked: "Locked", deleted: "Deleted" });

/** The left list: staff pages first, then the site's pages by group, with the site settings row. */
export function pageRows(manifest, state, query = "") {
  const byKey = new Map((state || []).map((s) => [s.page_key, s]));
  const rows = [];
  for (const s of state || []) {
    if (!s.custom) continue;
    rows.push({ key: s.page_key, path: s.custom.path, title: s.custom.name, group: "Your pages", kind: "blocks", status: pageStatus("blocks", s), custom: s.custom });
  }
  for (const p of manifest?.pages || []) {
    const kind = pageKind(p.key, p);
    rows.push({ key: p.key, path: p.path, title: p.title || p.path, group: p.group || "Other", kind, status: pageStatus(kind, byKey.get(p.key)), custom: null, pattern: Boolean(p.pattern) });
  }
  rows.push({ key: SITE_SETTINGS_KEY, path: "Every page", title: "Menu and footer", group: "Site", kind: "settings", status: pageStatus("settings", byKey.get(SITE_SETTINGS_KEY)), custom: null });
  const q = query.trim().toLowerCase();
  const list = q ? rows.filter((r) => `${r.title} ${r.path}`.toLowerCase().includes(q)) : rows;
  const groups = [];
  for (const r of list) {
    let g = groups.find((x) => x.label === r.group);
    if (!g) groups.push((g = { label: r.group, items: [] }));
    g.items.push(r);
  }
  return groups;
}

// ------------------------------------------------------------ addresses

export function slugify(name) {
  return "/" + String(name || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").trim().replace(/[^a-z0-9/]+/g, "-").replace(/-*\/-*/g, "/").replace(/^[-/]+|[-/]+$/g, "").replace(/\/+/g, "/").slice(0, 79);
}

/**
 * The problem with a new page's address before the server is asked, or null.
 * The server repeats every check (PT409 path_reserved / path_taken).
 */
export function pathProblem(path, { reserved = [], taken = [] } = {}) {
  if (!path || path === "/") return "Give the page an address.";
  if (path.length > 80 || !/^\/[a-z0-9]+(-[a-z0-9]+)*(\/[a-z0-9]+(-[a-z0-9]+)*)?$/.test(path)) return "Use lowercase letters, numbers and hyphens, at most two parts (like /summer-socials).";
  if (reserved.includes(path.slice(1).split("/")[0]) || taken.includes(path)) return COPY.reserved;
  return null;
}

export function redirectProblem(to, selfPath) {
  if (!/^\/[A-Za-z0-9._~/?=&%#-]*$/.test(to || "") || /^\/\//.test(to) || String(to).includes("..")) return "Send visitors to a page on usemingla.com (starting with /).";
  if (to === selfPath) return "A page can't send visitors to itself.";
  return null;
}

// --------------------------------------------------------------- settings

/** The coded menu and footer (components/site/site-nav.tsx, components/marketing/footer.tsx), the starting point for an edit. */
export const CODED_SETTINGS = Object.freeze({
  nav: {
    top: [{ label: "Going out", to: "/going-out" }, { label: "Cities", to: "/cities" }, { label: "For hosts", to: "/host" }, { label: "Free tools", to: "/tools" }, { label: "Help", to: "/help" }],
    menu: [
      { title: "Explore", links: [{ label: "Home", to: "/" }, { label: "Going out", to: "/going-out" }, { label: "Cities", to: "/cities" }, { label: "Get the app", to: "/download" }] },
      { title: "Host", links: [{ label: "Mingla Host", to: "/host" }, { label: "Events", to: "/host/events" }, { label: "Trips", to: "/host/trips" }, { label: "Experiences", to: "/host/experiences" }, { label: "Restaurants", to: "/host/restaurants" }, { label: "Hotels", to: "/host/hotels" }, { label: "Art & culture", to: "/host/art" }, { label: "Play", to: "/host/play" }, { label: "Free tools", to: "/tools" }] },
      { title: "Company", links: [{ label: "About", to: "/about" }, { label: "Locals", to: "/locals" }, { label: "Creators", to: "/creators" }, { label: "Careers", to: "https://career.usemingla.com" }, { label: "Blog", to: "/blog" }, { label: "Help centre", to: "/help" }, { label: "Support", to: "/support" }, { label: "Book a call", to: "/schedule" }] },
    ],
  },
  footer: {
    columns: [
      { title: "Explore", links: [{ label: "Home", to: "/" }, { label: "Going out", to: "/going-out" }, { label: "Cities", to: "/cities" }, { label: "Blog", to: "/blog" }] },
      { title: "Host", links: [{ label: "For Hosts", to: "/host" }, { label: "Free tools", to: "/tools" }, { label: "Help centre", to: "/help" }, { label: "Support", to: "/support" }] },
      { title: "Company", links: [{ label: "About", to: "/about" }, { label: "Careers", to: "https://career.usemingla.com" }, { label: "Locals", to: "/locals" }, { label: "Creators", to: "/creators" }] },
      { title: "Legal", links: [{ label: "Privacy", to: "/privacy-policy" }, { label: "Terms", to: "/terms-of-service" }, { label: "Organiser Terms", to: "/organiser-terms" }, { label: "Delete account", to: "/delete-account" }] },
    ],
    tagline: "Making real life easier to find.",
  },
});

const plain = (v, max) => typeof v === "string" && v.trim() !== "" && v.length <= max && !/[<>*]/.test(v);
const chromeTarget = (to) => { const k = actionTargetKind(to); return k === "internal" || k === "web" || k === "mail"; };

/** { "<path>": message } for a nav / footer payload (mirror of lib/site-pages/settings.ts). */
export function settingsProblems(s) {
  const out = {};
  const link = (l, at, max) => {
    if (!plain(l?.label, max)) out[`${at}.label`] = `Plain words, at most ${max} characters.`;
    if (!chromeTarget(l?.to)) out[`${at}.to`] = "Use a page on the site (/…), an https:// link or an email.";
  };
  const group = (g, at, maxLinks) => {
    if (!plain(g?.title, 24)) out[`${at}.title`] = "Plain words, at most 24 characters.";
    if (!Array.isArray(g?.links) || g.links.length < 1 || g.links.length > maxLinks) out[`${at}.links`] = `1 to ${maxLinks} links.`;
    (g?.links || []).forEach((l, i) => link(l, `${at}.links[${i}]`, 40));
  };
  if (s?.nav) {
    if (!Array.isArray(s.nav.top) || s.nav.top.length < 1 || s.nav.top.length > 6) out["nav.top"] = "1 to 6 top links.";
    (s.nav.top || []).forEach((l, i) => link(l, `nav.top[${i}]`, 24));
    if (!Array.isArray(s.nav.menu) || s.nav.menu.length < 1 || s.nav.menu.length > 4) out["nav.menu"] = "1 to 4 menu groups.";
    (s.nav.menu || []).forEach((g, i) => group(g, `nav.menu[${i}]`, 12));
  }
  if (s?.footer) {
    if (!Array.isArray(s.footer.columns) || s.footer.columns.length < 1 || s.footer.columns.length > 4) out["footer.columns"] = "1 to 4 columns.";
    (s.footer.columns || []).forEach((g, i) => group(g, `footer.columns[${i}]`, 6));
    if (s.footer.tagline !== undefined && !plain(s.footer.tagline, 80)) out["footer.tagline"] = "Plain words, at most 80 characters.";
  }
  return out;
}

// ------------------------------------------------------------ media

export const STORAGE = Object.freeze({ limit: 5368709120, warn: 0.7, block: 0.9 });

/** The meter: share used, ok / warn / blocked, and whether `addBytes` more would be refused. */
export function meter(usage, addBytes = 0) {
  const limit = Number(usage?.limit_bytes) || STORAGE.limit;
  const bytes = Number(usage?.bytes) || 0;
  const share = bytes / limit;
  const after = (bytes + addBytes) / limit;
  const state = share >= STORAGE.block ? "blocked" : share >= STORAGE.warn ? "warn" : "ok";
  return { bytes, limit, share, state, refuse: after >= STORAGE.block };
}

export function formatBytes(n) {
  const v = Number(n) || 0;
  if (v >= 1073741824) return `${(v / 1073741824).toFixed(2)} GB`;
  if (v >= 1048576) return `${(v / 1048576).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(v / 1024))} KB`;
}

/** Public URL of a library file (a plain storage object URL; never an image-transformation URL, hold #1643). */
export function publicUrl(supabaseUrl, bucket, path) {
  return `${String(supabaseUrl).replace(/\/$/, "")}/storage/v1/object/public/${bucket}/${path}`;
}

/** What to show for a media reference: a library item's still, or a site clip / photo by name. */
export function mediaLabel(ref, mediaMap) {
  if (typeof ref !== "string" || !ref) return { kind: "none", label: "Nothing picked" };
  const m = /^m:(.+)$/.exec(ref);
  if (m) {
    const item = mediaMap?.[m[1]];
    return item ? { kind: item.kind, label: item.alt || "Library item", item } : { kind: "missing", label: "A library item that is no longer available" };
  }
  if (ref.startsWith("v:")) return { kind: "video", label: `Site clip · ${ref.slice(2)}` };
  if (ref.startsWith("p:")) return { kind: "image", label: `Site photo · ${ref.slice(2)}` };
  return { kind: "missing", label: ref };
}

/** Where a library item is used, from the PT409 media_in_use DETAIL. */
export function inUseLine(detail) {
  let d = detail;
  if (typeof d === "string") { try { d = JSON.parse(d); } catch { d = {}; } }
  const pages = Array.isArray(d?.pages) ? d.pages : Array.isArray(d?.used_by) ? d.used_by : [];
  return pages.length ? `Used on: ${pages.join(", ")}.` : "A live page uses this file. Remove it from the page, publish, then archive it.";
}

// --------------------------------------------------------- preview frame

/** The canvas address: the site's preview of the token, in editor mode, talking to this Admin origin. */
export function frameUrl(site, token, adminOrigin, sample = null, y = 0) {
  const q = new URLSearchParams({ editor: "1", ao: adminOrigin });
  if (sample) q.set("sample", sample);
  if (y > 0) q.set("y", String(Math.round(y)));
  return `${String(site).replace(/\/$/, "")}/site-preview/${encodeURIComponent(token)}?${q.toString()}`;
}

/** The scale that fits a `frameW`-wide page into `boxW` (Fit), never above 1. */
export function fitScale(boxW, frameW) {
  if (!(boxW > 0) || !(frameW > 0)) return 1;
  return Math.min(1, Math.floor((boxW / frameW) * 1000) / 1000);
}

const PAGE_RE = /^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/;
const isIndex = (v) => Number.isInteger(v) && v >= 0 && v < 200;
const isNum = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0;
const isBox = (v) => isRecord(v) && isIndex(v.index) && typeof v.type === "string" && v.type.length <= 40 && (v.id === null || typeof v.id === "string") && isNum(v.top) && isNum(v.height);

/**
 * A message from the canvas page, acted on only from the framed site origin and
 * only when well formed (isPageMessage in lib/site-pages/editor-protocol.ts,
 * plus the #4452 spot messages for coded pages).
 */
export function acceptPageMessage(event, siteOrigin) {
  if (!event || event.origin !== siteOrigin) return null;
  const d = event.data;
  if (!isRecord(d) || typeof d.page !== "string" || !PAGE_RE.test(d.page)) return null;
  switch (d.type) {
    case "editor-ready":
      if (d.v === undefined) return d; // #4452 spot-page bridge
      return d.v === 2 && ["blocks", "coded", "settings"].includes(d.mode) && Array.isArray(d.blocks) && d.blocks.every(isBox) && isNum(d.height) ? d : null;
    case "editor-blocks": return Array.isArray(d.blocks) && d.blocks.length <= 60 && d.blocks.every(isBox) && isNum(d.height) ? d : null;
    case "editor-click": return isIndex(d.index) && typeof d.blockType === "string" && (d.field === null || (typeof d.field === "string" && d.field.length <= 120)) && typeof d.text === "string" && d.text.length <= 200 ? d : null;
    case "editor-applied": return isNum(d.seq) && typeof d.ok === "boolean" && Array.isArray(d.errors) && d.errors.every((e) => typeof e === "string") ? d : null;
    case "editor-scroll": return isNum(d.y) ? d : null;
    case "spot-click": return /^[a-z0-9-]{1,64}$/.test(d.spot || "") ? d : null;
    case "hero-click": return d;
    case "block-click": return /^[a-z0-9-]{1,64}$/.test(d.spot || "") && /^[0-9a-f-]{36}$/.test(d.block || "") ? d : null;
    default: return null;
  }
}

/** The field the click landed on, mapped to the top-level field the side panel shows (items[1].title → items). */
export function topField(field) {
  return field ? parsePath(field)[0] ?? null : null;
}

/** The cities a city block can show (mingla-marketing/content/cities/registry.ts). */
export const CITIES = Object.freeze([
  ["lagos", "Lagos"], ["durham-nc", "Durham"], ["cary-nc", "Cary"], ["raleigh-nc", "Raleigh"], ["new-york-city", "New York City"],
  ["brussels", "Brussels"], ["paris", "Paris"], ["london", "London"], ["fort-lauderdale", "Fort Lauderdale"], ["washington-dc", "Washington, DC"],
]);

/** A DOM-safe id for a field of section `index`. */
export function fieldId(index, path) {
  return `sf-${index}-${String(path).replace(/[^A-Za-z0-9]+/g, "_")}`;
}

/** An empty item for a list field (each sub-field blank; the checks then point at what to fill). */
export function emptyItem(field) {
  if (field.textItem) return "";
  const out = {};
  for (const f of field.item) {
    if (f.kind === "text" && f.required !== false) out[f.key] = "";
    if (f.kind === "action" && f.required !== false) out[f.key] = { label: "", to: "/" };
    if (f.kind === "enum" && f.required !== false) out[f.key] = f.options[0];
    if (f.kind === "list") out[f.key] = [];
  }
  return out;
}
