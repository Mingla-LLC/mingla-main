/**
 * #4453 website workspace (build contract A) — the owner's section actions,
 * and the same typed steps Ari applies (contract B, lib/siteWorkspace.ts).
 *
 * A "section" is one block of a page, named in the owner's words. Everything
 * here writes the DRAFT only, as the member (overrideAccess false, the real
 * Pages hooks), against a stated revision, and records an undo entry
 * (lib/draftHistory.ts). What a section may hold comes from the same sources
 * as everywhere else: the block catalogue (which text fields exist and how
 * long they may be), the site's design (which layouts it draws) and the
 * Studio block configs (where a section holds a photo or a video).
 *
 * An owner's own edit to a Draft section reviews it (a person changed it); a
 * step applied for Ari stamps the section Draft, by Ari (lib/reviewStamp.ts).
 */
import type { PayloadRequest } from "payload";
import { siteBlocks } from "../blocks/siteBlocks";
import { BLOCK_CATALOG, isBlockType, type BlockType, type FieldSpec } from "../contracts/generated/blocks.ts";
import { ARI_BLOCK_TYPES } from "../contracts/generated/blocks.ts";
import { ariCopyFields, ARI_RICH_TEXT_MAX } from "../contracts/generated/ariToolSchemas.ts";
import { assertDesignOptions, compositionVariant, DESIGN_KEYS, DESIGNS, isAriDesignKey, type DesignKey } from "../contracts/generated/designs.ts";
import { BUTTON_SHAPES, MOTION_PRESETS, RADIUS_PRESETS, type OwnerTokenOverrides } from "../contracts/generated/tokens.ts";
import { MAX_BLOCKS_PER_PAGE, MAX_NAV_ITEMS, MAX_NAV_LABEL_LENGTH } from "../contracts/generated/limits.ts";
import { MAX_HERO_VIDEO_MS } from "../contracts/generated/video.ts";
import { findAllTenantPages } from "./tenantPages";
import { relationId, tenantPagePaths } from "./pageTree";
import { ownerFontsOf, ownerTokensOf } from "./siteLook";
import { findCatalogFont } from "../contracts/generated/fontCatalog.ts";
import { AriRefusal, currentSettings, mergeTokens, plainTextToLexical, readyMedia, siteDesign, tokensView } from "./ariSiteActions";
import { buttonUrl, safeActionUrl } from "./validation";
import {
  LOOK_KEYS, MENU_KEYS, pageSnapshot, pickSnapshot, recordChanges,
  type ChangeGroup, type ChangeRow, type HistoryActor, type HistoryContext,
} from "./draftHistory";

type AnyDoc = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export type SectionActor = "user" | "ari";

export type SectionContext = HistoryContext & {
  actor: SectionActor;
  /** The change set this write joins (each write is its own when absent). */
  group: ChangeGroup;
  /** SITES_BOOKING_BLOCKS as Core signed it (the content route does not sign it: off). */
  bookingBlocks?: boolean;
  /** Ari's step id (Core's operation id), kept on the history rows so a repeat is recognised. */
  operationId?: string | null;
};

function refuse(code: string, extra: Record<string, unknown> = {}): never {
  throw new AriRefusal(code, extra);
}

const MARKUP = /<\s*\/?\s*[a-z!]/i;
const SECTION_ID = /^[A-Za-z0-9_-]{1,64}$/;

// ---------------------------------------------------------------------------
// Names: a section and a layout in the owner's words.
// ---------------------------------------------------------------------------

/** Each section type in plain words (never the catalogue's internal name). */
export const SECTION_WORDS: Readonly<Record<BlockType, string>> = {
  hero: "Big picture",
  rich_text: "Words",
  media_feature: "Photo with words",
  cta: "Line with a button",
  offering_grid: "What you can book",
  venue_reservation: "Book a table",
  menu_link: "Link to your menu",
  menu_board: "Your menu",
  menu_preview: "A taste of the menu",
  gallery: "Photos",
  video_feature: "Video",
  team: "Your team",
  hours_location: "Hours and address",
  testimonials: "Reviews",
  faq: "Questions and answers",
  contact_handoff: "Get in touch",
  divider: "Line",
  spacer: "Space",
  marquee: "Scrolling words",
  pull_quote: "Quote",
  stats: "Numbers",
  map_embed: "Map",
  destination_grid: "Destinations",
  story_grid: "Stories",
  offering_history: "Trips you have run",
  contact_form: "Contact form",
  newsletter_signup: "Newsletter sign-up",
  page_header: "Page title",
  feature_cards: "Highlights",
  availability: "Pick a time",
  ticket_tiers: "Tickets",
  process_steps: "How it works",
  page_links: "More pages",
  facts_table: "Good to know",
  contact_details: "Contact details",
};

const GRID_WORDS: Readonly<Record<string, string>> = { trip: "Your trips", event: "Your events", experience: "Your experiences", stay: "Your stays" };

function baseLabel(block: AnyDoc, index: number): string {
  const type = String(block.blockType ?? "");
  // Whatever opens the page is "Top of the page", whichever kind of opening it is.
  if (index === 0 && (type === "hero" || type === "page_header")) return "Top of the page";
  if (type === "offering_grid" && typeof block.kind === "string" && GRID_WORDS[block.kind]) return GRID_WORDS[block.kind]!;
  return isBlockType(type) ? SECTION_WORDS[type] : "Section";
}

/** One plain name per section, in page order; a second one of a kind is numbered ("Words 2"). */
export function sectionLabels(blocks: readonly AnyDoc[]): string[] {
  const seen = new Map<string, number>();
  return blocks.map((block, index) => {
    const base = baseLabel(block, index);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base} ${n}`;
  });
}

const LAYOUT_WORDS: Readonly<Record<string, string>> = {
  fullbleed: "Full picture",
  editorial: "Words beside the picture",
  arch: "Arched picture",
  "cover-bottom-search": "Picture with search",
  "cover-center": "Centred picture",
  poster: "Posters",
  list: "List",
  cards: "Cards",
  card: "Card",
  "photo-card": "Photo cards",
  columns: "Columns",
  tiles: "Tiles",
  "tile-bar": "Tiles",
  "badge-tile": "Tiles",
  numbered: "Numbered",
  statement: "Big statement",
  manifesto: "Big statement",
  prose: "Reading text",
  pinned: "Pinned",
  mosaic: "Mosaic",
  stagger: "Staggered",
  ledger: "Timeline",
  "ledger-count": "Timeline with a count",
  split: "Side by side",
  "split-panel": "Side by side",
  "panel-caption": "Picture with a caption",
  "dark-panel-glow": "Dark panel",
  panel: "Panel",
  rail: "Sliding row",
  wall: "Wall",
  "quote-wall": "Wall",
  switcher: "One at a time",
  ticker: "Ticker",
  photo: "With a photo",
  strip: "Strip",
  band: "Band",
  "accordion-columns": "Two columns",
  "brand-film": "Film",
  neutral: "Standard",
};

export function layoutLabel(design: DesignKey, key: string): string {
  if (LAYOUT_WORDS[key]) return LAYOUT_WORDS[key]!;
  if ((DESIGN_KEYS as readonly string[]).includes(key)) return "Standard";
  if (key.startsWith(`${design}-`) || DESIGN_KEYS.some((name) => key.startsWith(`${name}-`))) return "Signature";
  return key.replace(/[-_]+/g, " ").replace(/^./, (letter) => letter.toUpperCase());
}

/** The layouts this design draws for a section type (the first is its default). */
export function layoutsFor(design: DesignKey, type: string): { key: string; label: string }[] {
  if (!isBlockType(type)) return [];
  const seen = new Set<string>();
  return DESIGNS[design].variants[type].map((key) => {
    let label = layoutLabel(design, key);
    // Two layouts never share a name on one picker.
    if (seen.has(label)) label = `${label} (${key.replace(/[-_]+/g, " ")})`;
    seen.add(label);
    return { key, label };
  });
}

// ---------------------------------------------------------------------------
// Fields: the editable words of a section, from the block catalogue.
// ---------------------------------------------------------------------------

type TextSpec = { label: string; max: number; rich: boolean; required: boolean };
type LinkSpec = {
  label: string;
  max: 2048;
  rich: false;
  required: boolean;
  link: true;
  booking: boolean;
  labelField: string;
};
type EditableSpec = TextSpec | LinkSpec;

/** Photo words the catalogue keeps on the gallery's photo rows (Studio stores them on each row). */
const GALLERY_ROW_FIELDS: Readonly<Record<string, TextSpec>> = {
  caption: { label: "Caption", max: 120, rich: false, required: false },
  alt: { label: "Photo description", max: 240, rich: false, required: false },
};

function textSpec(spec: FieldSpec): TextSpec | null {
  if (spec.kind === "text") return { label: spec.label, max: spec.max, rich: false, required: spec.required === true };
  if (spec.kind === "rich_text") return { label: spec.label, max: ARI_RICH_TEXT_MAX, rich: true, required: spec.required === true };
  return null;
}

function linkSpec(spec: FieldSpec): LinkSpec | null {
  if (spec.kind !== "action_href") return null;
  return {
    label: spec.label,
    max: 2048,
    rich: false,
    required: spec.required === true,
    link: true,
    booking: spec.booking === true,
    labelField: spec.labelField ?? "label",
  };
}

/** The text fields of a section type: top-level ones, and those of each list's rows. */
export function sectionTextFields(type: BlockType, actor: SectionActor): { fields: Map<string, EditableSpec>; lists: Map<string, Map<string, EditableSpec>> } {
  const fields = new Map<string, EditableSpec>();
  const lists = new Map<string, Map<string, EditableSpec>>();
  // Ari writes only the fields its copy tool already may (the same list as propose_site_copy).
  const ari = actor === "ari" ? ariCopyFields(type) : null;
  for (const [key, spec] of Object.entries(BLOCK_CATALOG[type].fields) as Array<[string, FieldSpec]>) {
    const top = textSpec(spec);
    if (top && (!ari || ari.fields.includes(key))) fields.set(key, top);
    const action = linkSpec(spec);
    if (action && (!ari || ari.fields.includes(key))) fields.set(key, action);
    if (spec.kind === "list") {
      const inner = new Map<string, EditableSpec>();
      for (const [child, childSpec] of Object.entries(spec.item) as Array<[string, FieldSpec]>) {
        const row = textSpec(childSpec) ?? linkSpec(childSpec);
        if (row && (!ari || ari.listFields[key]?.includes(child))) inner.set(child, row);
      }
      if (inner.size) lists.set(key, inner);
    }
  }
  if (type === "gallery" && actor === "user") lists.set("images", new Map<string, EditableSpec>(Object.entries(GALLERY_ROW_FIELDS)));
  return { fields, lists };
}

/** Where Studio stores a field's value (rich text lives in `content`). */
const storedKey = (key: string, spec: EditableSpec) => (spec.rich ? "content" : key);

/** Stored rich text as plain paragraphs (the reverse of the conversion Ari's copy uses on the way in). */
function plainRichText(value: unknown): string {
  const text = (node: unknown): string => {
    if (!node || typeof node !== "object") return "";
    const item = node as AnyDoc;
    if (typeof item.text === "string") return item.text;
    if (item.type === "linebreak") return "\n";
    return Array.isArray(item.children) ? item.children.map(text).join("") : "";
  };
  const root = (value as AnyDoc | null)?.root ?? value;
  const blocks = Array.isArray((root as AnyDoc | null)?.children) ? (root as AnyDoc).children as unknown[] : [];
  return blocks.map((block) => text(block).trim()).filter(Boolean).join("\n\n");
}

export type SectionField = { key: string; label: string; kind: "text" | "multiline" | "richtext" | "mingla_link"; value: string; max: number | null };

const fieldKind = (spec: EditableSpec): SectionField["kind"] =>
  "link" in spec
    ? "mingla_link"
    : spec.rich
      ? "richtext"
      : spec.max > 160
        ? "multiline"
        : "text";

export function sectionFields(block: AnyDoc, actor: SectionActor): SectionField[] {
  const type = String(block.blockType ?? "");
  if (!isBlockType(type)) return [];
  const { fields, lists } = sectionTextFields(type, actor);
  const out: SectionField[] = [];
  for (const [key, spec] of fields) {
    const stored = block[storedKey(key, spec)];
    out.push({ key, label: spec.label, kind: fieldKind(spec), value: spec.rich ? plainRichText(stored) : typeof stored === "string" ? stored : "", max: spec.max });
  }
  for (const [list, inner] of lists) {
    const rows = Array.isArray(block[list]) ? block[list] as AnyDoc[] : [];
    rows.forEach((row, index) => {
      for (const [child, spec] of inner) {
        out.push({
          key: `${list}.${index}.${child}`,
          label: `${spec.label} ${index + 1}`,
          kind: fieldKind(spec),
          value: typeof row?.[child] === "string" ? row[child] : "",
          max: spec.max,
        });
      }
    });
  }
  return out;
}

export type SectionEdit = { key: string; value: string };

function parseEdits(value: unknown): SectionEdit[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 40) refuse("VALIDATION_FAILED", { problems: ["edits must be a list of at most 40 changes"] });
  return value.map((raw, index) => {
    const edit = raw as AnyDoc | null;
    if (!edit || typeof edit !== "object" || typeof edit.key !== "string" || typeof edit.value !== "string") {
      refuse("VALIDATION_FAILED", { problems: [`edits[${index}] needs a key and a value`] });
    }
    return { key: edit.key, value: edit.value.replace(/\u0000/g, "") };
  });
}

/** Applies text edits to a copy of the section. Returns the new section and the words written. */
export function applyEdits(block: AnyDoc, edits: readonly SectionEdit[], actor: SectionActor): { block: AnyDoc; texts: string[] } {
  const type = String(block.blockType ?? "");
  if (!isBlockType(type)) refuse("FIELD_NOT_EDITABLE", { key: edits[0]?.key ?? null });
  const { fields, lists } = sectionTextFields(type, actor);
  const next = structuredClone(block) as AnyDoc;
  const texts: string[] = [];
  for (const edit of edits) {
    const parts = edit.key.split(".");
    let spec: EditableSpec | undefined;
    let write: (value: unknown) => void;
    let siblingData: AnyDoc;
    if (parts.length === 1) {
      spec = fields.get(edit.key);
      if (!spec) refuse("FIELD_NOT_EDITABLE", { key: edit.key });
      const rich = spec.rich;
      const target = storedKey(edit.key, spec);
      write = (value) => { next[target] = rich && typeof value === "string" ? plainTextToLexical(value) : value; };
      siblingData = next;
    } else if (parts.length === 3 && /^\d{1,3}$/.test(parts[1]!)) {
      const [list, at, child] = parts as [string, string, string];
      spec = lists.get(list)?.get(child);
      const rows = Array.isArray(next[list]) ? next[list] as AnyDoc[] : [];
      const row = rows[Number(at)];
      if (!spec || !row || typeof row !== "object") refuse("FIELD_NOT_EDITABLE", { key: edit.key });
      write = (value) => { row[child] = value; };
      siblingData = row;
    } else {
      refuse("FIELD_NOT_EDITABLE", { key: edit.key });
    }
    if (MARKUP.test(edit.value)) refuse("VALIDATION_FAILED", { key: edit.key, problems: [`${edit.key} must be plain text`] });
    if (edit.value.length > spec.max) refuse("VALUE_TOO_LONG", { key: edit.key, max: spec.max });
    const empty = edit.value.trim() === "";
    if (empty && spec.required) refuse("FIELD_REQUIRED", { key: edit.key });
    if ("link" in spec && !empty) {
      const verdict = spec.booking
        ? safeActionUrl(edit.value.trim())
        : buttonUrl(spec.labelField)(edit.value.trim(), { siblingData });
      if (verdict !== true) {
        refuse("VALIDATION_FAILED", {
          key: edit.key,
          problems: [verdict],
        });
      }
    }
    write(
      empty
        ? spec.rich
          ? plainTextToLexical("")
          : null
        : "link" in spec
          ? edit.value.trim()
          : edit.value,
    );
    if (!empty && !("link" in spec)) texts.push(edit.value);
  }
  return { block: next, texts };
}

// ---------------------------------------------------------------------------
// Lists: rows the owner may add, remove and reorder (questions, cards, steps).
// ---------------------------------------------------------------------------

/** Lists Mingla, the menu or the photo slots fill: their rows are never added or removed by hand. */
const LISTS_NOT_BY_HAND: ReadonlySet<string> = new Set([
  "offering_grid.offerings", "menu_board.sections", "menu_preview.sections", "page_links.items", "gallery.images",
]);
const ITEM_WORDS: Readonly<Record<string, string>> = {
  "faq.items": "Question", "feature_cards.cards": "Card", "marquee.phrases": "Phrase", "team.members": "Person",
  "facts_table.items": "Fact", "process_steps.items": "Step", "stats.items": "Number", "hours_location.hours": "Day",
  "hero.heading_lines": "Line", "hero.fact_badges": "Fact", "testimonials.items": "Review",
};

export type SectionList = {
  name: string;
  label: string;
  item_label: string;
  min: number;
  max: number;
  count: number;
  fields: { key: string; label: string; kind: SectionField["kind"]; max: number | null }[];
};

type ListRule = { name: string; label: string; min: number; max: number; inner: Map<string, EditableSpec> };

/** The lists of this section whose rows may be added, removed and moved by this actor. */
function editableLists(block: AnyDoc, actor: SectionActor): ListRule[] {
  const type = String(block.blockType ?? "");
  if (!isBlockType(type)) return [];
  const { lists } = sectionTextFields(type, actor);
  const out: ListRule[] = [];
  for (const [name, inner] of lists) {
    const spec = (BLOCK_CATALOG[type].fields as Record<string, FieldSpec>)[name];
    if (!spec || spec.kind !== "list" || LISTS_NOT_BY_HAND.has(`${type}.${name}`)) continue;
    // Reviews picked from the reviews list are not typed rows.
    if (type === "testimonials" && block.from_collection === true) continue;
    // A row needs something only words can't give (a link, a Mingla record): it is not added by hand.
    const needsMore = (Object.values(spec.item) as FieldSpec[]).some((child) => child.kind !== "text" && (child as { required?: boolean }).required === true);
    if (needsMore) continue;
    // A list the section can do without may be emptied; one it must have keeps its minimum.
    out.push({ name, label: spec.label, min: spec.required ? spec.min : 0, max: spec.max, inner });
  }
  return out;
}

export function sectionLists(block: AnyDoc, actor: SectionActor): SectionList[] {
  const type = String(block.blockType ?? "");
  return editableLists(block, actor).map((rule) => ({
    name: rule.name,
    label: rule.label,
    item_label: ITEM_WORDS[`${type}.${rule.name}`] ?? "Item",
    min: rule.min,
    max: rule.max,
    count: Array.isArray(block[rule.name]) ? block[rule.name].length : 0,
    fields: [...rule.inner].map(([key, spec]) => ({ key, label: spec.label, kind: fieldKind(spec), max: spec.max })),
  }));
}

function parseListOps(value: unknown): AnyDoc[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 20 || value.some((op) => !op || typeof op !== "object" || Array.isArray(op))) {
    refuse("VALIDATION_FAILED", { problems: ["list_ops must be a list of at most 20 changes"] });
  }
  return value as AnyDoc[];
}

/**
 * Adds, removes and moves rows of a section's lists, on a copy. A new row gets
 * the words it was given; a field it must have and was not given gets starter
 * words (reported in `starters`, so Ari's step can refuse to leave them).
 */
export function applyListOps(block: AnyDoc, ops: readonly AnyDoc[], actor: SectionActor): { block: AnyDoc; texts: string[]; starters: string[] } {
  const type = String(block.blockType ?? "");
  const rules = new Map(editableLists(block, actor).map((rule) => [rule.name, rule]));
  const next = structuredClone(block) as AnyDoc;
  const texts: string[] = [];
  const starters: string[] = [];
  ops.forEach((op, n) => {
    const rule = typeof op.list === "string" ? rules.get(op.list) : undefined;
    if (!rule) refuse("LIST_NOT_EDITABLE", { list: typeof op.list === "string" ? op.list.slice(0, 60) : null });
    const rows = Array.isArray(next[rule.name]) ? [...next[rule.name] as AnyDoc[]] : [];
    const at = (value: unknown, upTo: number) => (Number.isInteger(value) && (value as number) >= 0 && (value as number) < upTo ? value as number : refuse("VALIDATION_FAILED", { problems: [`list_ops[${n}] names a row that is not in ${rule.name}`] }));
    if (op.op === "add") {
      if (rows.length >= rule.max) refuse("LIST_LIMIT_REACHED", { list: rule.name, max: rule.max });
      const place = op.after_index === null || op.after_index === undefined ? 0 : at(op.after_index, rows.length) + 1;
      const values = op.values === undefined || op.values === null ? {} : op.values;
      if (typeof values !== "object" || Array.isArray(values)) refuse("VALIDATION_FAILED", { problems: [`list_ops[${n}].values`] });
      const row: AnyDoc = { id: newRowId() };
      for (const [field, raw] of Object.entries(values as AnyDoc)) {
        const spec = rule.inner.get(field);
        const key = `${rule.name}.${place}.${field}`;
        if (!spec) refuse("FIELD_NOT_EDITABLE", { key });
        if (typeof raw !== "string" || MARKUP.test(raw)) refuse("VALIDATION_FAILED", { key, problems: [`${key} must be plain text`] });
        if (raw.length > spec.max) refuse("VALUE_TOO_LONG", { key, max: spec.max });
        if (raw.trim()) {
          row[field] = raw.replace(/\u0000/g, "");
          texts.push(row[field]);
        }
      }
      for (const [field, spec] of rule.inner) {
        if (!spec.required || typeof row[field] === "string") continue;
        row[field] = starterWords(type, `${rule.name}.${field}`);
        starters.push(`${rule.name}.${place}.${field}`);
      }
      rows.splice(place, 0, row);
    } else if (op.op === "remove") {
      const index = at(op.index, rows.length);
      if (rows.length - 1 < rule.min) refuse("LIST_ROW_REQUIRED", { list: rule.name, min: rule.min });
      rows.splice(index, 1);
    } else if (op.op === "move") {
      const index = at(op.index, rows.length);
      const to = at(op.to_index, rows.length);
      const [moved] = rows.splice(index, 1);
      rows.splice(to, 0, moved!);
    } else {
      refuse("VALIDATION_FAILED", { problems: [`list_ops[${n}].op must be add, remove or move`] });
    }
    next[rule.name] = rows;
  });
  return { block: next, texts, starters };
}

// ---------------------------------------------------------------------------
// Photos and videos: where a section holds one, from the Studio block configs.
// ---------------------------------------------------------------------------

type MediaLayout = { top: string[]; lists: Array<{ list: string; field: string }> };

const pointsAtMedia = (field: AnyDoc) => (field.type === "relationship" || field.type === "upload") && field.relationTo === "media";

const MEDIA_LAYOUT: ReadonlyMap<string, MediaLayout> = new Map(siteBlocks.map((config) => {
  const top: string[] = [];
  const lists: MediaLayout["lists"] = [];
  for (const raw of config.fields as AnyDoc[]) {
    if (typeof raw.name !== "string") continue;
    if (pointsAtMedia(raw)) top.push(raw.name);
    if (raw.type === "array") {
      const inner = (raw.fields as AnyDoc[]).find((child) => typeof child.name === "string" && pointsAtMedia(child));
      if (inner) lists.push({ list: raw.name, field: inner.name });
    }
  }
  return [config.slug, { top, lists }] as const;
}));

/** Studio's media field → the catalogue field that says whether it is required. */
const CATALOG_MEDIA_KEY: Readonly<Record<string, string>> = { media: "media_url", video: "video_url", poster: "poster_url", images: "images" };
const SLOT_WORDS: Readonly<Record<string, string>> = { media: "Photo", video: "Video", poster: "Video cover photo" };
const LIST_SLOT_WORDS: Readonly<Record<string, string>> = { images: "Photo", members: "Portrait" };

function catalogMedia(type: string, key: string): FieldSpec | undefined {
  if (!isBlockType(type)) return undefined;
  return (BLOCK_CATALOG[type].fields as Record<string, FieldSpec>)[CATALOG_MEDIA_KEY[key] ?? key];
}

export type SectionMediaSlot = { slot: string; label: string; media_id: string | null; thumb_url: string | null };

export function sectionMedia(block: AnyDoc, thumbs: ReadonlyMap<string, string> = new Map()): SectionMediaSlot[] {
  const type = String(block.blockType ?? "");
  const layout = MEDIA_LAYOUT.get(type);
  if (!layout) return [];
  const out: SectionMediaSlot[] = [];
  const slot = (name: string, label: string, value: unknown) => {
    const id = relationId(value);
    out.push({ slot: name, label, media_id: id, thumb_url: id ? thumbs.get(id) ?? null : null });
  };
  for (const name of layout.top) slot(name, SLOT_WORDS[name] ?? "Photo", block[name]);
  for (const { list, field } of layout.lists) {
    const rows = Array.isArray(block[list]) ? block[list] as AnyDoc[] : [];
    const words = LIST_SLOT_WORDS[list] ?? "Photo";
    rows.forEach((row, index) => slot(`${list}.${index}`, `${words} ${index + 1}`, row?.[field]));
    // A photo list takes one more photo until it is full ("Add a photo").
    const spec = catalogMedia(type, list);
    if (spec?.kind === "media_list" && rows.length < spec.max) slot(`${list}.${rows.length}`, "Add a photo", null);
  }
  return out;
}

/** Sets (or clears) one photo or video of a section, on a copy. */
async function applyMedia(ctx: SectionContext, block: AnyDoc, slot: unknown, mediaId: unknown): Promise<AnyDoc> {
  const type = String(block.blockType ?? "");
  const layout = MEDIA_LAYOUT.get(type);
  if (typeof slot !== "string" || !layout) refuse("VALIDATION_FAILED", { problems: ["that section has no photo or video to change"] });
  const id = mediaId === null || mediaId === "" ? null : typeof mediaId === "string" ? mediaId : refuse("VALIDATION_FAILED", { problems: ["media_id"] });
  const next = structuredClone(block) as AnyDoc;
  const [name, at, extra] = slot.split(".");
  if (extra !== undefined || !name) refuse("VALIDATION_FAILED", { problems: ["slot"] });

  if (at === undefined) {
    if (!layout.top.includes(name)) refuse("VALIDATION_FAILED", { problems: ["that section has no such photo or video"] });
    if (id === null) {
      if ((catalogMedia(type, name) as { required?: boolean } | undefined)?.required) refuse("VALIDATION_FAILED", { problems: ["this section always needs that picture; choose another one instead"] });
      next[name] = null;
      return next;
    }
    const video = name === "video";
    const found = await readyMedia(ctx, [id], video ? "video" : "image");
    if (video && type === "hero") {
      // The film behind the top of a page is a short loop.
      const duration = found.get(id)?.duration_ms;
      if (typeof duration !== "number" || duration > MAX_HERO_VIDEO_MS) refuse("VIDEO_TOO_LONG");
    }
    next[name] = id;
    return next;
  }

  const target = layout.lists.find((entry) => entry.list === name);
  if (!target || !/^\d{1,3}$/.test(at)) refuse("VALIDATION_FAILED", { problems: ["that section has no such photo"] });
  const rows = Array.isArray(next[name]) ? [...next[name] as AnyDoc[]] : [];
  const index = Number(at);
  const spec = catalogMedia(type, name);
  const photoList = spec?.kind === "media_list" ? spec : null;
  if (id === null) {
    if (!rows[index]) refuse("VALIDATION_FAILED", { problems: ["that photo is not in this section"] });
    if (photoList) {
      if (rows.length - 1 < photoList.min) refuse("VALIDATION_FAILED", { problems: [`this section needs at least ${photoList.min} photo`] });
      rows.splice(index, 1);
    } else {
      rows[index] = { ...rows[index], [target.field]: null };
    }
  } else {
    await readyMedia(ctx, [id], "image");
    if (rows[index]) rows[index] = { ...rows[index], [target.field]: id };
    else if (photoList && index === rows.length && rows.length < photoList.max) rows.push({ [target.field]: id });
    else refuse("VALIDATION_FAILED", { problems: ["that photo is not in this section"] });
  }
  next[name] = rows;
  return next;
}

// ---------------------------------------------------------------------------
// The section list of one page.
// ---------------------------------------------------------------------------

/** Sections that fill themselves from Mingla listings or the site's own collections. */
const FEED_TYPES: ReadonlySet<string> = new Set([
  "offering_grid", "offering_history", "availability", "ticket_tiers", "menu_board", "menu_preview",
  "venue_reservation", "destination_grid", "story_grid", "page_links",
]);

export function sectionReadsFeed(block: AnyDoc): boolean {
  const type = String(block.blockType ?? "");
  if (type === "testimonials") return block.from_collection === true;
  return FEED_TYPES.has(type);
}

export const sectionIdOf = (block: AnyDoc, index: number): string => (typeof block.id === "string" && block.id ? block.id : `at-${index}`);

function findSection(blocks: readonly AnyDoc[], sectionId: unknown): number {
  if (typeof sectionId !== "string" || !SECTION_ID.test(sectionId)) refuse("SECTION_NOT_FOUND");
  const index = blocks.findIndex((block, at) => sectionIdOf(block, at) === sectionId);
  if (index < 0) refuse("SECTION_NOT_FOUND");
  return index;
}

const isHome = (page: AnyDoc) => !page.parent && (page.slug ?? "") === "";

export type Section = {
  id: string;
  index: number;
  type: string;
  label: string;
  layout: string | null;
  layouts: { key: string; label: string }[];
  review: { state: "draft" | "reviewed"; source: "ari" | "composer" | "person" | "team" } | null;
  feed: boolean;
  fields: SectionField[];
  /** Lists whose rows can be added, removed and reordered (`list_ops` on edit_section). */
  lists: SectionList[];
  media: SectionMediaSlot[];
  can_remove: boolean;
};

export function describeSections(page: AnyDoc, design: DesignKey, actor: SectionActor, thumbs: ReadonlyMap<string, string> = new Map()): Section[] {
  const blocks = Array.isArray(page.blocks) ? page.blocks as AnyDoc[] : [];
  const labels = sectionLabels(blocks);
  const firstHero = blocks.findIndex((block) => block.blockType === "hero");
  return blocks.map((block, index) => {
    const type = String(block.blockType ?? "");
    const review = block.review && typeof block.review === "object" && (block.review.state === "draft" || block.review.state === "reviewed")
      ? { state: block.review.state, source: block.review.source }
      : null;
    return {
      id: sectionIdOf(block, index),
      index,
      type,
      label: labels[index]!,
      layout: typeof block.variant === "string" && block.variant ? block.variant : null,
      layouts: layoutsFor(design, type),
      review,
      feed: sectionReadsFeed(block),
      fields: sectionFields(block, actor),
      lists: sectionLists(block, actor),
      media: sectionMedia(block, thumbs),
      // The home page's cover is its first big picture: it stays (the cover screen changes it).
      can_remove: !(isHome(page) && index === firstHero),
    };
  });
}

// ---------------------------------------------------------------------------
// Sections an owner may add, and what a new one starts with.
// ---------------------------------------------------------------------------

const STARTER_WORDS: Readonly<Record<string, string>> = {
  heading: "Add a heading",
  "pull_quote.quote": "Add the quote here",
  "faq.items.question": "Add a question",
  "faq.items.answer": "Add the answer",
  "feature_cards.cards.title": "Add a title",
  "feature_cards.cards.body": "Add a sentence",
  "marquee.phrases.text": "Add a short phrase",
  "team.members.name": "Add a name",
  "facts_table.items.label": "Add a fact",
  "facts_table.items.value": "Add the detail",
  "cta.label": "Find out more",
  "contact_form.submit_label": "Send",
  "newsletter_signup.button_label": "Sign up",
  "media_feature.alt": "Describe this photo",
};
const STARTER_BODY = "Write a few sentences here.";
const STARTER_ROWS: Readonly<Record<string, number>> = { "faq.items": 2, "feature_cards.cards": 3, "marquee.phrases": 3, "facts_table.items": 2 };

/** Section types an owner may add from the workspace, in the order they are offered. */
export const ADDABLE_SECTION_TYPES: readonly BlockType[] = [
  "hero", "rich_text", "media_feature", "gallery", "feature_cards", "faq", "pull_quote", "testimonials", "offering_grid",
  "cta", "team", "facts_table", "marquee", "contact_form", "newsletter_signup", "destination_grid", "story_grid",
  "page_links", "divider", "spacer",
];
/** These start from one of the owner's own photos (`media_id` on add_section). */
export const SECTION_TYPES_NEEDING_PHOTO: ReadonlySet<string> = new Set(["media_feature", "gallery", "hero"]);

const ADD_DESCRIPTIONS: Readonly<Partial<Record<BlockType, string>>> = {
  hero: "The cover: one of your photos across the top of the page, with a headline, a line under it and up to three short facts. It replaces the page title.",
  rich_text: "A heading and a few paragraphs.",
  media_feature: "One of your photos beside a heading and a few words.",
  gallery: "A set of your photos.",
  feature_cards: "A few short cards, each a title and a sentence.",
  faq: "Questions and answers that open and close.",
  pull_quote: "One line lifted out, with who said it.",
  testimonials: "The reviews you have confirmed, picked up from your reviews list.",
  offering_grid: "What people can book with you on Mingla, kept up to date for you.",
  cta: "A heading, a sentence and one button.",
  team: "The people behind the brand, with their roles.",
  facts_table: "A short table of useful facts about your place.",
  marquee: "A strip of short phrases that scrolls across the page.",
  contact_form: "Visitors send you a message; it arrives in Mingla.",
  newsletter_signup: "Visitors join your list; Mingla confirms their email first.",
  destination_grid: "Your destinations, each opening its own page.",
  story_grid: "Your stories, newest first.",
  page_links: "Links to your other pages, picked from your menu.",
  divider: "A thin line between two sections.",
  spacer: "Breathing room between two sections.",
};

export type AddableSection = { type: string; label: string; description: string; needs_photo: boolean };

export function sectionCatalog(design: DesignKey, actor: SectionActor): AddableSection[] {
  return ADDABLE_SECTION_TYPES
    .filter((type) => DESIGNS[design].variants[type].length > 0)
    // Ari adds only the kinds its own tools may write.
    .filter((type) => actor === "user" || ARI_BLOCK_TYPES.includes(type))
    // #4575: the cover is the owner's to add; Ari's addable list is unchanged.
    .filter((type) => actor === "user" || type !== "hero")
    .map((type) => ({
      type,
      label: SECTION_WORDS[type],
      description: ADD_DESCRIPTIONS[type] ?? BLOCK_CATALOG[type].description,
      needs_photo: SECTION_TYPES_NEEDING_PHOTO.has(type),
    }));
}

function starterWords(type: string, path: string): string {
  return STARTER_WORDS[`${type}.${path}`] ?? STARTER_WORDS[path.split(".").pop()!] ?? "Write this";
}

/** A new section of this type as Studio stores it, with starter words in every field it must have. */
export function starterSection(type: BlockType, design: DesignKey, mediaId: string | null): { block: AnyDoc; starters: Map<string, string> } {
  const block: AnyDoc = { id: newRowId(), blockType: type, variant: compositionVariant(DESIGNS[design], type) };
  const starters = new Map<string, string>();
  for (const [key, spec] of Object.entries(BLOCK_CATALOG[type].fields) as Array<[string, FieldSpec]>) {
    if (spec.kind === "text" && spec.required) {
      block[key] = starterWords(type, key);
      starters.set(key, block[key]);
    } else if (spec.kind === "rich_text" && spec.required) {
      block.content = plainTextToLexical(STARTER_BODY);
      starters.set(key, STARTER_BODY);
    } else if (spec.kind === "enum" && spec.required) {
      block[key] = spec.values[0];
    } else if (type === "hero" && key === "ctas") {
      // #4575: a button row needs a link, which an owner cannot set here: the cover starts with no buttons.
      continue;
    } else if (spec.kind === "list" && (spec.required || STARTER_ROWS[`${type}.${key}`])) {
      const texts = (Object.entries(spec.item) as Array<[string, FieldSpec]>).filter(([, child]) => child.kind === "text" && child.required);
      // A list of Mingla records (offerings, reviews) starts empty: Mingla fills it.
      if (!texts.length) continue;
      const count = Math.max(spec.min, STARTER_ROWS[`${type}.${key}`] ?? 1);
      block[key] = Array.from({ length: count }, (_, index) => {
        const row: AnyDoc = { id: newRowId() };
        for (const [child] of texts) {
          row[child] = starterWords(type, `${key}.${child}`);
          starters.set(`${key}.${index}.${child}`, row[child]);
        }
        return row;
      });
    }
  }
  // What a type needs beyond its words.
  if (type === "rich_text") { block.heading = starterWords(type, "heading"); starters.set("heading", block.heading); block.width = "narrow"; }
  // #4572: a targetless CTA is text, not a home-link placeholder. Every
  // renderer hides its button until the owner supplies a real target.
  // Lists Mingla or the site's own collections fill: they start empty.
  const fills = (list: string) => {
    delete block[list];
    for (const key of [...starters.keys()]) if (key.startsWith(`${list}.`)) starters.delete(key);
  };
  if (type === "testimonials") { block.from_collection = true; fills("items"); }
  if (type === "offering_grid") { block.mode = "upcoming"; block.kind = "all"; fills("offerings"); }
  if (type === "page_links") { block.mode = "teaser"; fills("items"); }
  if (type === "media_feature") { block.media = mediaId; block.alignment = "left"; }
  if (type === "hero") { block.media = mediaId; block.ctas = []; }
  if (type === "gallery") block.images = [{ id: newRowId(), media: mediaId }];
  return { block, starters };
}

function newRowId(): string {
  return [...crypto.getRandomValues(new Uint8Array(12))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------------------
// Reading and writing a page.
// ---------------------------------------------------------------------------

async function loadPage(ctx: SectionContext, pageId: unknown): Promise<{ page: AnyDoc; pages: AnyDoc[] }> {
  if ((typeof pageId !== "string" && typeof pageId !== "number") || !/^[A-Za-z0-9-]{1,64}$/.test(String(pageId))) refuse("VALIDATION_FAILED", { problems: ["page_id"] });
  const pages = (await findAllTenantPages(ctx.scoped, ctx.tenantId)) as AnyDoc[];
  const page = pages.find((candidate) => String(candidate.id) === String(pageId));
  if (!page) refuse(ctx.actor === "ari" ? "PAGE_NOT_FOUND" : "NOT_FOUND");
  return { page, pages };
}

/** A stale revision is refused with the latest one; Ari's steps read the current page themselves. */
function checkPageRevision(page: AnyDoc, expected: unknown): void {
  if (expected === undefined) return;
  if (typeof expected !== "string" || String(page.revision ?? "") !== expected) {
    refuse("REVISION_CONFLICT", {
      latest: { revision: String(page.revision ?? ""), updated_by: null, updated_at: String(page.updatedAt ?? "") },
      latest_revision: String(page.revision ?? ""),
    });
  }
}

function writeRequest(ctx: SectionContext): PayloadRequest {
  const extra = ctx.actor === "ari"
    // Whatever Core's Draft flag says, a section Ari changes in the workspace is the owner's to read.
    ? { minglaReviewSource: "ari", ...(ctx.bookingBlocks ? { minglaBookingBlocks: true } : {}) }
    : { minglaOwnerEdit: true };
  return { ...ctx.scoped, context: { ...ctx.scoped.context, ...extra } } as PayloadRequest;
}

async function savePage(ctx: SectionContext, page: AnyDoc, data: AnyDoc): Promise<AnyDoc> {
  try {
    return (await ctx.req.payload.update({
      collection: "pages",
      id: page.id,
      req: writeRequest(ctx),
      overrideAccess: false,
      draft: true,
      depth: 0,
      data: { ...data, revision: page.revision } as never,
    })) as AnyDoc;
  } catch (error) {
    if (error instanceof Error && error.message === "MEDIA_REJECTED") refuse("MEDIA_PROCESSING");
    // #4572 item 10 — say what really happened (never "Your design doesn't have that kind of section").
    if (error instanceof Error && error.message === "BOOKING_BLOCKS_OFF") {
      refuse("VALIDATION_FAILED", { problems: [BOOKING_OFF_PROBLEM] });
    }
    throw error;
  }
}

/** #4572 item 10 — the one sentence an owner sees when a change really adds a booking feature. */
export const BOOKING_OFF_PROBLEM = "Booking features aren't switched on for this website yet, so that change wasn't saved.";

const historyActor = (ctx: SectionContext): HistoryActor => (ctx.actor === "ari" ? "ari" : "user");

async function recordPage(ctx: SectionContext, before: AnyDoc, after: AnyDoc, label: string, mergeKey: string | null = null, more: ChangeRow[] = []): Promise<void> {
  await recordChanges(ctx, historyActor(ctx), [
    { target: "page", targetId: String(after.id ?? before.id), label, before: pageSnapshot(before), after: pageSnapshot(after), mergeKey },
    ...more,
  ], ctx.group, null, ctx.operationId ?? null);
}

export const pageAudit = (page: AnyDoc) => ({ action: "content.updated", collection: "pages", entry: String(page.id) });

// ---------------------------------------------------------------------------
// The writes (the owner's content actions and Ari's typed steps share them).
// ---------------------------------------------------------------------------

export type SectionWrite = { page: AnyDoc; pageRevision: string; sectionId: string | null; texts: string[] };

const done = (page: AnyDoc, sectionId: string | null, texts: string[] = []): SectionWrite => ({ page, pageRevision: String(page.revision ?? ""), sectionId, texts });

export async function editSection(ctx: SectionContext, args: AnyDoc, check?: (block: AnyDoc, texts: string[]) => void): Promise<SectionWrite> {
  const { page } = await loadPage(ctx, args.page_id);
  checkPageRevision(page, args.expected_revision);
  const blocks = Array.isArray(page.blocks) ? [...page.blocks as AnyDoc[]] : [];
  const index = findSection(blocks, args.section_id);
  const edits = parseEdits(args.edits);
  const listOps = parseListOps(args.list_ops);
  const layout = args.layout;
  if (!edits.length && !listOps.length && (layout === undefined || layout === null)) refuse("VALIDATION_FAILED", { problems: ["nothing to change"] });
  // Rows first, then words: an edit may address a row the same call just added.
  const listed = applyListOps(blocks[index]!, listOps, ctx.actor);
  const edited = applyEdits(listed.block, edits, ctx.actor);
  const block = edited.block;
  const texts = [...listed.texts, ...edited.texts];
  if (ctx.actor === "ari") {
    // Ari never leaves starter words behind: it writes every word a new row must have.
    const written = new Set(edits.map((edit) => edit.key));
    const missing = listed.starters.filter((key) => !written.has(key));
    if (missing.length) refuse("VALIDATION_FAILED", { problems: missing.slice(0, 20).map((key) => `the new row needs words for ${key}`) });
  }
  if (layout !== undefined && layout !== null) {
    const design = siteDesign(await currentSettings(ctx));
    const offered = layoutsFor(design, String(block.blockType)).map((entry) => entry.key);
    if (typeof layout !== "string" || !offered.includes(layout)) refuse("LAYOUT_NOT_IN_DESIGN", { layouts: offered, variants: offered });
    block.variant = layout;
  }
  check?.(block, texts);
  blocks[index] = block;
  const label = sectionLabels(page.blocks as AnyDoc[])[index]!;
  const updated = await savePage(ctx, page, { blocks });
  const typingOnly = edits.length > 0 && !listOps.length && (layout === undefined || layout === null) && ctx.actor === "user";
  const mergeKey = typingOnly ? `edit:${page.id}:${args.section_id}:${edits.map((edit) => edit.key).sort().join(",")}`.slice(0, 200) : null;
  await recordPage(ctx, page, updated, edits.length || listOps.length ? `Edit ${label}` : `Change the layout of ${label}`, mergeKey);
  return done(updated, String(args.section_id), texts);
}

export async function moveSection(ctx: SectionContext, args: AnyDoc): Promise<SectionWrite> {
  const { page } = await loadPage(ctx, args.page_id);
  checkPageRevision(page, args.expected_revision);
  const blocks = Array.isArray(page.blocks) ? [...page.blocks as AnyDoc[]] : [];
  const index = findSection(blocks, args.section_id);
  const to = args.to_index;
  if (!Number.isInteger(to) || to < 0 || to >= blocks.length) refuse("VALIDATION_FAILED", { problems: ["to_index is not a place on that page"] });
  const label = sectionLabels(blocks)[index]!;
  const [moved] = blocks.splice(index, 1);
  blocks.splice(to as number, 0, moved!);
  const updated = to === index ? page : await savePage(ctx, page, { blocks });
  await recordPage(ctx, page, updated, `Move ${label}`);
  return done(updated, String(args.section_id));
}

export async function removeSection(ctx: SectionContext, args: AnyDoc): Promise<SectionWrite> {
  const { page } = await loadPage(ctx, args.page_id);
  checkPageRevision(page, args.expected_revision);
  const blocks = Array.isArray(page.blocks) ? [...page.blocks as AnyDoc[]] : [];
  const index = findSection(blocks, args.section_id);
  if (isHome(page) && index === blocks.findIndex((block) => block.blockType === "hero")) {
    refuse("SECTION_CANNOT_BE_REMOVED", { problems: ["the home page keeps its top picture"] });
  }
  const label = sectionLabels(blocks)[index]!;
  blocks.splice(index, 1);
  const updated = await savePage(ctx, page, { blocks });
  await recordPage(ctx, page, updated, `Remove ${label}`);
  return done(updated, null);
}

/**
 * #4572 item 8, following #4575: a page can take a cover (the "Big picture")
 * when it has none yet. One rule behind both addSection's refusal and the
 * page's Add section list, so the list never offers one the server would refuse.
 */
export const PAGE_HAS_COVER = "This page already has a big picture.";

export function coverUnavailableReason(blocks: readonly AnyDoc[]): string | null {
  return blocks.some((block) => block.blockType === "hero") ? PAGE_HAS_COVER : null;
}

/** The Add section list for one page: the cover only when that page can take one, plus the one-line reason when it can't. */
export function pageSectionCatalog(catalog: readonly AddableSection[], page: AnyDoc): { types: AddableSection[]; cover_note: string | null } {
  const blocks = Array.isArray(page.blocks) ? page.blocks as AnyDoc[] : [];
  const reason = catalog.some((entry) => entry.type === "hero") ? coverUnavailableReason(blocks) : null;
  const types = reason ? catalog.filter((entry) => entry.type !== "hero") : [...catalog];
  return { types, cover_note: reason };
}

export async function readPageSectionCatalog(ctx: SectionContext, design: DesignKey, pageId: unknown): Promise<{ types: AddableSection[]; cover_note: string | null }> {
  const catalog = sectionCatalog(design, ctx.actor);
  if (pageId === undefined || pageId === null) return { types: catalog, cover_note: null };
  const { page } = await loadPage(ctx, pageId);
  return pageSectionCatalog(catalog, page);
}

export async function addSection(ctx: SectionContext, args: AnyDoc, check?: (block: AnyDoc, texts: string[]) => void): Promise<SectionWrite> {
  const { page } = await loadPage(ctx, args.page_id);
  checkPageRevision(page, args.expected_revision);
  const blocks = Array.isArray(page.blocks) ? [...page.blocks as AnyDoc[]] : [];
  const design = siteDesign(await currentSettings(ctx));
  const type = args.type;
  if (typeof type !== "string" || !sectionCatalog(design, ctx.actor).some((entry) => entry.type === type) || !isBlockType(type)) {
    refuse("SECTION_TYPE_NOT_AVAILABLE");
  }
  const isCover = type === "hero";
  // #4575: the cover is the top of the page, once.
  const coverReason = isCover ? coverUnavailableReason(blocks) : null;
  if (coverReason) refuse("VALIDATION_FAILED", { problems: [coverReason] });
  // Replacing a page title does not add a section, so it needs no room.
  const replacesTitle = isCover && blocks[0]?.blockType === "page_header";
  if (blocks.length >= MAX_BLOCKS_PER_PAGE && !replacesTitle) refuse("SECTION_LIMIT_REACHED", { max: MAX_BLOCKS_PER_PAGE });
  const after = args.after_section_id;
  const at = isCover || after === null || after === undefined ? 0 : findSection(blocks, after) + 1;
  let mediaId: string | null = null;
  if (SECTION_TYPES_NEEDING_PHOTO.has(type)) {
    if (typeof args.media_id !== "string" || !args.media_id) refuse("MEDIA_REQUIRED");
    await readyMedia(ctx, [args.media_id], "image");
    mediaId = args.media_id;
  }
  const starter = starterSection(type, design, mediaId);
  if (replacesTitle) {
    // #4575: the page title's own words carry over (the owner wrote them, they are not starter text).
    const title = blocks[0]!;
    const heading = typeof title.heading === "string" ? title.heading.trim() : "";
    if (heading) { starter.block.heading = heading; starter.starters.delete("heading"); }
    const lines = typeof title.subheading === "string" ? title.subheading.split("\n").map((line) => line.trim()).filter(Boolean) : [];
    if (lines.length) starter.block.subheading = lines.join(" · ").slice(0, 300);
  }
  const edits = parseEdits(args.edits);
  const { block, texts } = applyEdits(starter.block, edits, ctx.actor);
  if (ctx.actor === "ari") {
    // Ari never leaves starter words behind: it writes every field the section must have, or the step is refused.
    const written = new Set(edits.map((edit) => edit.key));
    const missing = [...starter.starters.keys()].filter((key) => !written.has(key));
    if (missing.length) refuse("VALIDATION_FAILED", { problems: missing.slice(0, 20).map((key) => `add_section needs words for ${key}`) });
  }
  check?.(block, texts);
  if (replacesTitle) blocks.splice(0, 1);
  blocks.splice(at, 0, block);
  const updated = await savePage(ctx, page, { blocks });
  const stored = (Array.isArray(updated.blocks) ? updated.blocks as AnyDoc[] : [])[at];
  const sectionId = stored ? sectionIdOf(stored, at) : String(block.id);
  await recordPage(ctx, page, updated, `Add ${SECTION_WORDS[type]}`);
  return done(updated, sectionId, texts);
}

export async function setSectionMedia(ctx: SectionContext, args: AnyDoc): Promise<SectionWrite> {
  const { page } = await loadPage(ctx, args.page_id);
  checkPageRevision(page, args.expected_revision);
  const blocks = Array.isArray(page.blocks) ? [...page.blocks as AnyDoc[]] : [];
  const index = findSection(blocks, args.section_id);
  const label = sectionLabels(blocks)[index]!;
  blocks[index] = await applyMedia(ctx, blocks[index]!, args.slot, args.media_id);
  const updated = await savePage(ctx, page, { blocks });
  await recordPage(ctx, page, updated, `Change a photo in ${label}`);
  return done(updated, String(args.section_id));
}

async function navigationOf(ctx: SectionContext): Promise<AnyDoc | null> {
  return ((await ctx.req.payload.find({
    collection: "navigation", req: ctx.scoped, overrideAccess: false, draft: true, depth: 0, limit: 1, where: { tenant: { equals: ctx.tenantId } },
  })).docs[0] as AnyDoc | undefined) ?? null;
}

const stripIds = (rows: readonly AnyDoc[]): AnyDoc[] => rows.map(({ id: _id, children, ...rest }) => ({
  ...rest,
  ...(Array.isArray(children) ? { children: children.map(({ id: _child, ...child }: AnyDoc) => child) } : {}),
}));

async function saveMenu(ctx: SectionContext, navigation: AnyDoc, items: AnyDoc[]): Promise<AnyDoc> {
  return (await ctx.req.payload.update({
    collection: "navigation", id: navigation.id, req: ctx.scoped, overrideAccess: false, draft: true, depth: 0, data: { items } as never,
  })) as AnyDoc;
}

export const menuRow = (before: AnyDoc, after: AnyDoc, label: string): ChangeRow => ({
  target: "menu", targetId: null, label, before: pickSnapshot(before, MENU_KEYS), after: pickSnapshot(after, MENU_KEYS),
});

export async function setPageEnabled(ctx: SectionContext, args: AnyDoc): Promise<SectionWrite & { menuChanged: boolean }> {
  const { page } = await loadPage(ctx, args.page_id);
  checkPageRevision(page, args.expected_revision);
  if (typeof args.enabled !== "boolean") refuse("VALIDATION_FAILED", { problems: ["enabled"] });
  if (isHome(page) && args.enabled === false) refuse("HOME_ALWAYS_ON");
  // A Draft page from Ari is switched on by "Publish this page", which reviews it first.
  if (page.ari_draft === true) refuse("VALIDATION_FAILED", { problems: ["that page is a Draft from Ari: publish or remove it from the Pages screen"] });
  const title = String(page.title ?? "Page");
  const updated = (page.enabled !== false) === args.enabled ? page : await savePage(ctx, page, { enabled: args.enabled });
  const more: ChangeRow[] = [];
  if (args.enabled === false) {
    // A page that is off is not in the menu either.
    const navigation = await navigationOf(ctx);
    const items = (Array.isArray(navigation?.items) ? navigation!.items : []) as AnyDoc[];
    const id = String(page.id);
    const kept = items
      .filter((item) => item.target_type === "url" || relationId(item.page) !== id)
      .map((item) => (Array.isArray(item.children) ? { ...item, children: (item.children as AnyDoc[]).filter((child) => relationId(child.page) !== id) } : item));
    if (navigation && JSON.stringify(kept) !== JSON.stringify(items)) {
      const saved = await saveMenu(ctx, navigation, stripIds(kept));
      more.push(menuRow(navigation, saved, `Take ${title} out of the menu`));
    }
  }
  await recordPage(ctx, page, updated, args.enabled ? `Turn on ${title}` : `Turn off ${title}`, null, more);
  return { ...done(updated, null), menuChanged: more.length > 0 };
}

/** Ari's menu step: these pages, with these labels, in this order (links elsewhere and groups stay). */
export async function setMenuItems(ctx: SectionContext, args: AnyDoc): Promise<{ menu_revision: string; texts: string[] }> {
  const navigation = await navigationOf(ctx);
  if (!navigation) refuse("NOT_FOUND");
  const pages = (await findAllTenantPages(ctx.scoped, ctx.tenantId)) as AnyDoc[];
  const byId = new Map(pages.map((page) => [String(page.id), page]));
  if (!Array.isArray(args.items) || args.items.length > MAX_NAV_ITEMS) refuse("VALIDATION_FAILED", { problems: [`the menu holds at most ${MAX_NAV_ITEMS} pages`] });
  const wanted = (args.items as AnyDoc[]).map((item, index) => {
    const id = String(item?.page_id ?? "");
    const page = byId.get(id);
    const label = typeof item?.label === "string" ? item.label.trim() : "";
    if (!page) refuse("PAGE_NOT_FOUND", { problems: [`items[${index}].page_id is not a page of this website`] });
    if (isHome(page)) refuse("VALIDATION_FAILED", { problems: [`items[${index}]: Home is the logo, not a menu item`] });
    if (page.enabled === false) refuse("VALIDATION_FAILED", { problems: [`items[${index}]: that page is turned off`] });
    if (!label || label.length > MAX_NAV_LABEL_LENGTH || MARKUP.test(label)) refuse("VALIDATION_FAILED", { problems: [`items[${index}].label must be plain text up to ${MAX_NAV_LABEL_LENGTH} characters`] });
    return { id, label };
  });
  if (new Set(wanted.map((item) => item.id)).size !== wanted.length) refuse("VALIDATION_FAILED", { problems: ["a page can be in the menu once"] });
  const items = (Array.isArray(navigation.items) ? navigation.items : []) as AnyDoc[];
  const keep = stripIds(items.filter((item) => item.target_type === "url" || (Array.isArray(item.children) && item.children.length > 0)));
  const next = [...wanted.map((item) => ({ label: item.label, target_type: "page", page: item.id })), ...keep];
  if (next.length > MAX_NAV_ITEMS) refuse("VALIDATION_FAILED", { problems: [`the menu would hold more than ${MAX_NAV_ITEMS} items`] });
  const saved = await saveMenu(ctx, navigation, next);
  await recordChanges(ctx, historyActor(ctx), [menuRow(navigation, saved, "Change the menu")], ctx.group, null, ctx.operationId ?? null);
  return { menu_revision: String(saved.updatedAt ?? ""), texts: wanted.map((item) => item.label) };
}

// ---------------------------------------------------------------------------
// #4572 item 17 — the header button and the logo, each its own undoable thing.
// The menu (`set_menu`) never touches the header button, and the header
// button never touches a menu item.
// ---------------------------------------------------------------------------

/** History keys: the header button is a "menu" row of its own; the logo a "look" row of its own. */
export const HEADER_BUTTON_KEYS = ["header_cta"] as const;
export const LOGO_KEYS = ["logo"] as const;

/** The header button as the workspace shows it: its words and the page it opens (null for an outside link or none). */
export function headerButtonView(navigation: AnyDoc | null): { label: string | null; page_id: string | null; links_outside: boolean } {
  const cta = (navigation?.header_cta ?? null) as AnyDoc | null;
  const label = typeof cta?.label === "string" && cta.label.trim() ? cta.label : null;
  return { label, page_id: cta?.target_type === "url" ? null : relationId(cta?.page), links_outside: cta?.target_type === "url" && Boolean(cta?.url) };
}

/** The header button's words and, optionally, the page it opens. An outside link keeps its address when only the words change. */
export async function setHeaderButton(ctx: SectionContext, args: AnyDoc): Promise<{ menu_revision: string; texts: string[] }> {
  const navigation = await navigationOf(ctx);
  if (!navigation) refuse("NOT_FOUND");
  const label = typeof args.label === "string" ? args.label.trim() : "";
  if (!label || label.length > MAX_NAV_LABEL_LENGTH || MARKUP.test(label)) {
    refuse("VALIDATION_FAILED", { problems: [`label must be plain text up to ${MAX_NAV_LABEL_LENGTH} characters`] });
  }
  const current = (navigation.header_cta ?? {}) as AnyDoc;
  let target: AnyDoc;
  if (args.page_id !== undefined && args.page_id !== null) {
    const pages = (await findAllTenantPages(ctx.scoped, ctx.tenantId)) as AnyDoc[];
    const page = pages.find((candidate) => String(candidate.id) === String(args.page_id));
    if (!page) refuse("PAGE_NOT_FOUND", { problems: ["page_id is not a page of this website"] });
    if (page.enabled === false) refuse("VALIDATION_FAILED", { problems: ["that page is turned off"] });
    target = { target_type: "page", page: String(page.id), url: null };
  } else if (current.target_type === "url" ? current.url : relationId(current.page)) {
    target = { target_type: current.target_type ?? "page", page: relationId(current.page), url: current.url ?? null };
  } else {
    refuse("VALIDATION_FAILED", { problems: ["page_id is required: the header button has no page yet"] });
  }
  const saved = (await ctx.req.payload.update({
    collection: "navigation", id: navigation.id, req: ctx.scoped, overrideAccess: false, draft: true, depth: 0,
    data: { header_cta: { ...target, label } } as never,
  })) as AnyDoc;
  await recordChanges(ctx, historyActor(ctx), [{
    target: "menu", targetId: "header_button", label: "Change the header button",
    before: pickSnapshot(navigation, HEADER_BUTTON_KEYS), after: pickSnapshot(saved, HEADER_BUTTON_KEYS),
  }], ctx.group, null, ctx.operationId ?? null);
  return { menu_revision: String(saved.updatedAt ?? ""), texts: [label] };
}

/** The site's logo: one of the site's READY photos, or null to show the name instead. */
export async function setSiteLogo(ctx: SectionContext, args: AnyDoc): Promise<{ look_revision: string }> {
  const settings = await currentSettings(ctx);
  let logo: string | null = null;
  if (args.media_id !== null) {
    if (typeof args.media_id !== "string" || !args.media_id) refuse("VALIDATION_FAILED", { problems: ["media_id must be a photo id or null"] });
    await readyMedia(ctx, [args.media_id], "image");
    logo = args.media_id;
  }
  const updated = (await ctx.req.payload.update({
    collection: "site-settings", id: settings.id, req: ctx.scoped, overrideAccess: false, draft: true, depth: 0, data: { logo } as never,
  })) as AnyDoc;
  await recordChanges(ctx, historyActor(ctx), [{
    target: "look", targetId: "logo", label: logo ? "Change the logo" : "Remove the logo",
    before: pickSnapshot(settings, LOGO_KEYS), after: pickSnapshot(updated, LOGO_KEYS),
  }], ctx.group, null, ctx.operationId ?? null);
  return { look_revision: String(updated.updatedAt ?? "") };
}

// ---------------------------------------------------------------------------
// The look.
// ---------------------------------------------------------------------------

export type LookWarning = ReturnType<typeof tokensView>["readability_warnings"][number];

/** One pairing of words on a background (e.g. body text on the page background). */
const warningKey = (warning: LookWarning) => warning.pair;

/**
 * The design, colours, fonts, corners, button shape and motion. The owner's
 * `tokens` replace the stored colours whole (as today's look save does); Ari
 * sends only the colours it changes, and is refused when the change would
 * leave words unreadable (the reply names the nearest readable colour).
 */
export async function setLook(ctx: SectionContext, args: AnyDoc): Promise<{ look_revision: string; warnings: LookWarning[]; design: DesignKey }> {
  const settings = await currentSettings(ctx);
  if (args.expected_revision !== undefined && (typeof args.expected_revision !== "string" || String(settings.updatedAt ?? "") !== args.expected_revision)) {
    refuse("REVISION_CONFLICT", {
      latest: { revision: String(settings.updatedAt ?? ""), updated_by: typeof settings.updated_by === "string" ? settings.updated_by : null, updated_at: String(settings.updatedAt ?? "") },
      latest_revision: String(settings.updatedAt ?? ""),
    });
  }
  const changes: AnyDoc = {};
  if (args.design !== undefined) {
    if (typeof args.design !== "string" || !(DESIGN_KEYS as readonly string[]).includes(args.design)) refuse("VALIDATION_FAILED", { problems: ["design is not one of the designs"] });
    // Ari names only the designs its own tools may (the design pass picks among the styles, with the fit check).
    if (ctx.actor === "ari" && args.design !== siteDesign(settings) && !isAriDesignKey(args.design)) {
      refuse("VALIDATION_FAILED", { problems: ["Ari changes the whole style through the design pass; the owner can pick any style in Design"] });
    }
    changes.design = args.design;
  }
  if (args.tokens !== undefined) {
    if (!args.tokens || typeof args.tokens !== "object" || Array.isArray(args.tokens)) refuse("VALIDATION_FAILED", { problems: ["tokens"] });
    if (ctx.actor === "ari") {
      const { radius, button_shape, motion, ...tokens } = mergeTokens(ownerTokensOf(settings), args.tokens as OwnerTokenOverrides);
      changes.tokens = tokens;
      if (radius) changes.radius = radius;
      if (button_shape) changes.button_shape = button_shape;
      if (motion) changes.motion = motion;
    } else {
      changes.tokens = args.tokens;
    }
  }
  if (args.fonts !== undefined) {
    if (ctx.actor === "ari") {
      // Ari names a family per slot (its tool takes nothing else): each is a Google Fonts family from the
      // catalogue, added to the fonts the owner already chose (as propose_site_tokens does). Stored without
      // a source the choice is refused by the fonts check, or dropped when the look is read back.
      if (!args.fonts || typeof args.fonts !== "object" || Array.isArray(args.fonts)) refuse("VALIDATION_FAILED", { problems: ["fonts"] });
      const fonts: AnyDoc = { ...ownerFontsOf(settings) };
      for (const [slot, choice] of Object.entries(args.fonts as AnyDoc)) {
        const family = String((choice as AnyDoc | null)?.family ?? "");
        if (!findCatalogFont(family)) refuse("VALIDATION_FAILED", { problems: [`${family || "that font"} is not in the Google Fonts list`] });
        fonts[slot] = { family, source: "google" };
      }
      changes.fonts = fonts;
    } else {
      changes.fonts = args.fonts;
    }
  }
  for (const [key, allowed] of [["radius", RADIUS_PRESETS], ["button_shape", BUTTON_SHAPES], ["motion", MOTION_PRESETS]] as const) {
    if (args[key] === undefined) continue;
    if (!(allowed as readonly unknown[]).includes(args[key])) refuse("VALIDATION_FAILED", { problems: [key] });
    changes[key] = args[key];
  }
  // #4575 — Grid's cover and photos options are the owner's choice; Ari never sets them.
  if (args.design_options !== undefined) {
    if (ctx.actor === "ari") refuse("VALIDATION_FAILED", { problems: ["Design options are the owner's choice"] });
    try {
      assertDesignOptions(args.design_options);
    } catch {
      refuse("VALIDATION_FAILED", { problems: ["design_options"] });
    }
    changes.design_options = args.design_options;
  }
  if (!Object.keys(changes).length) refuse("VALIDATION_FAILED", { problems: ["nothing to change"] });

  if (ctx.actor === "ari") {
    const before = new Set(tokensView(settings).readability_warnings.map(warningKey));
    let fresh: LookWarning[];
    try {
      fresh = tokensView({ ...settings, ...changes }).readability_warnings.filter((warning) => !before.has(warningKey(warning)));
    } catch {
      fresh = [];
    }
    if (fresh.length) {
      refuse("UNREADABLE_COLOURS", {
        problems: fresh.slice(0, 8).map((warning) => warning.sentence),
        suggestions: fresh.slice(0, 8).map((warning) => ({ sentence: warning.sentence, foreground: warning.foreground, background: warning.background, nearest_readable: warning.suggestion })),
      });
    }
  }

  let updated: AnyDoc;
  try {
    updated = (await ctx.req.payload.update({
      collection: "site-settings", id: settings.id, req: ctx.scoped, overrideAccess: false, draft: true, depth: 0, data: changes as never,
    })) as AnyDoc;
  } catch (error) {
    if (error instanceof Error && error.name === "ValidationError") {
      const rows = ((error as AnyDoc).data?.errors ?? []) as Array<{ message?: unknown }>;
      refuse("VALIDATION_FAILED", { problems: rows.map((row) => String(row.message ?? "")).filter(Boolean).slice(0, 8) });
    }
    throw error;
  }
  await recordChanges(ctx, historyActor(ctx), [
    { target: "look", targetId: null, label: changes.design !== undefined && changes.design !== settings.design ? "Change the style" : "Change the look", before: pickSnapshot(settings, LOOK_KEYS), after: pickSnapshot(updated, LOOK_KEYS) },
  ], ctx.group, null, ctx.operationId ?? null);
  const view = tokensView(updated);
  return { look_revision: view.revision, warnings: view.readability_warnings, design: view.design };
}

// ---------------------------------------------------------------------------
// Reads.
// ---------------------------------------------------------------------------

export type WorkspacePage = { id: string; title: string; path: string | null; enabled: boolean; in_menu: boolean; revision: string; ari_draft: boolean; unreviewed: number };

/** The site's pages, Home first, then in menu order, then by name. */
export function workspacePages(pages: readonly AnyDoc[], navigation: AnyDoc | null): WorkspacePage[] {
  let paths = new Map<string, string>();
  try {
    paths = tenantPagePaths(pages as never);
  } catch {
    // An unresolvable tree still lists its pages (publish names the problem).
  }
  const order = new Map<string, number>();
  ((Array.isArray(navigation?.items) ? navigation!.items : []) as AnyDoc[]).forEach((item, index) => {
    const id = relationId(item.page);
    if (item.target_type !== "url" && id && !order.has(id)) order.set(id, index);
    for (const child of Array.isArray(item.children) ? item.children as AnyDoc[] : []) {
      const childId = relationId(child.page);
      if (childId && !order.has(childId)) order.set(childId, index + 0.5);
    }
  });
  const rows = pages.map((page) => ({
    id: String(page.id),
    title: String(page.title ?? "Page"),
    path: paths.get(String(page.id)) ?? null,
    enabled: page.enabled !== false,
    in_menu: order.has(String(page.id)),
    revision: String(page.revision ?? ""),
    ari_draft: page.ari_draft === true,
    unreviewed: (Array.isArray(page.blocks) ? page.blocks as AnyDoc[] : []).filter((block) => block?.review?.state === "draft").length,
  }));
  const rank = (row: WorkspacePage) => (row.path === "" ? -1 : order.get(row.id) ?? Number.POSITIVE_INFINITY);
  return rows.sort((a, b) => (rank(a) === rank(b) ? a.title.localeCompare(b.title) : rank(a) - rank(b)));
}

export async function readPageSections(ctx: SectionContext, pageId: unknown, thumbsFor: (ids: string[]) => Promise<Map<string, string>>): Promise<{ page: { id: string; title: string; path: string | null; revision: string }; sections: Section[] }> {
  const { page, pages } = await loadPage(ctx, pageId);
  const design = siteDesign(await currentSettings(ctx));
  const plain = describeSections(page, design, ctx.actor);
  const thumbs = await thumbsFor(plain.flatMap((section) => section.media.map((slot) => slot.media_id)).filter((id): id is string => Boolean(id)));
  let path: string | null = null;
  try {
    path = tenantPagePaths(pages as never).get(String(page.id)) ?? null;
  } catch {
    path = null;
  }
  return {
    page: { id: String(page.id), title: String(page.title ?? "Page"), path, revision: String(page.revision ?? "") },
    sections: describeSections(page, design, ctx.actor, thumbs),
  };
}

export { navigationOf as workspaceNavigation };
