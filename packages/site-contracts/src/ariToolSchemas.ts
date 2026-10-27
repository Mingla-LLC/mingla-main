/**
 * #2829 AD-11 / W9b — JSON Schemas for Ari's Sites tools, GENERATED from the
 * block catalogue and the token model so Ari can never offer a block, field,
 * layout or colour role the runtime would refuse (the drift that left Ari's
 * tools describing 8 blocks, a nav_order maximum of 4 and a two-value
 * typography enum).
 *
 * Ari's tools write data only. Nothing here accepts HTML, CSS or script:
 * text fields are plain strings (the validator refuses markup), links are
 * checked links, colours are #rrggbb, and layouts are closed enums.
 *
 * The schemas use only the keywords the model provider consumes (type,
 * enum, anyOf, properties, required, items, min/max…; never `const` or
 * `oneOf`, which would fail every Ari turn closed).
 *
 * ARI FIELD POLICY (what Ari writes differs from what a site renders in
 * exactly these declared ways; `ari-tool-schemas` tests pin it):
 *   - a picture or film the artifact carries as a URL is written as the id of
 *     the brand's approved media (`media_url` → `media_id`, `video_url` →
 *     `video_media_id`, `poster_url` → `poster_media_id`; a gallery's
 *     pictures as `{ media_id, alt }`);
 *   - rich text is written as plain text, one paragraph per blank line;
 *   - fields whose content comes from Mingla, or that point at another
 *     record by an address Studio stores as a relation, are not Ari's to
 *     write (ARI_EXCLUDED_FIELDS, each with its reason).
 */
import { BLOCK_CATALOG, BLOCK_TYPES, type BlockType, type FieldSpec } from "./blocks.ts";
import { DESIGN_KEYS, DESIGNS, type DesignKey } from "./designs.ts";
import { FONT_SLOT_KEYS } from "./fontSlots.ts";
import { FORBIDDEN_TEXT, isSafeHref, UUID_RE } from "./safety.ts";
import {
  BUTTON_SHAPES,
  HEADING_CASES,
  MOTION_PRESETS,
  RADIUS_PRESETS,
  RAMP_ROLE_STEPS,
  RAMP_ROLES,
  SINGLE_COLOR_ROLES,
} from "./tokens.ts";

export type JsonSchema = Record<string, unknown>;

const HEX_SCHEMA: JsonSchema = { type: "string", pattern: "^#[0-9a-f]{6}$", description: "Six-digit lowercase colour, e.g. #1a2b3c" };
const MEDIA_ID: JsonSchema = { type: "string", format: "uuid", description: "Id of one of the brand's approved (READY) website photos or videos" };
export const ARI_RICH_TEXT_MAX = 5000;

/** Catalogue keys Ari writes under another name (the value is a media id, not a URL). */
export const ARI_FIELD_RENAMES: Readonly<Record<string, string>> = {
  media_url: "media_id",
  video_url: "video_media_id",
  poster_url: "poster_media_id",
};

/**
 * Catalogue fields Ari never writes, with the reason. `block.field` for a
 * top-level field, `block.list.field` for a field inside a list item.
 */
export const ARI_EXCLUDED_FIELDS: Readonly<Record<string, string>> = {
  "offering_grid.offerings": "Mingla fills a grid's offerings from the live feed at publish",
  "venue_reservation.url": "the reservation link is Mingla's own booking page",
  "menu_board.venue_id": "the menu comes from the venue in Mingla",
  "menu_board.sections": "the menu comes from the venue in Mingla",
  "menu_preview.sections": "the menu comes from the venue in Mingla",
  "testimonials.testimonial_ids": "reviews are picked in Studio or the Website screen (a stored relation)",
  "destination_grid.destinations": "destinations are picked in Studio or the Website screen (a stored relation)",
  "story_grid.category": "a category is picked in Studio or the Website screen (a stored relation)",
  "team.members.media_url": "portraits are attached in Studio (a stored relation)",
};

function ariKey(key: string): string {
  return ARI_FIELD_RENAMES[key] ?? key;
}

function fieldSchema(spec: FieldSpec, path: string): JsonSchema | null {
  if (ARI_EXCLUDED_FIELDS[path]) return null;
  switch (spec.kind) {
    case "text":
      return { type: "string", maxLength: spec.max, description: `${spec.label} (plain text)` };
    case "href":
      return { type: "string", maxLength: 2048, description: `${spec.label}: an https link, mailto:, tel:, or a /path on this website` };
    case "mingla_href":
      return { type: "string", maxLength: 2048, description: `${spec.label}: a usemingla.com page` };
    case "media_url":
    case "video_url":
      return { ...MEDIA_ID, description: `${spec.label}: ${String(MEDIA_ID.description)}` };
    case "uuid":
      return { type: "string", format: "uuid", description: spec.label };
    case "slug":
      return { type: "string", pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$", maxLength: 60, description: spec.label };
    case "email":
      return { type: "string", maxLength: 254, description: `${spec.label} (an email address)` };
    case "integer":
      return { type: "integer", minimum: spec.min, maximum: spec.max, description: spec.label };
    case "number":
      return { type: "number", minimum: spec.min, maximum: spec.max, description: spec.label };
    case "boolean":
      return { type: "boolean", description: spec.label };
    case "enum":
    case "icon":
      return { type: "string", enum: [...spec.values], description: spec.label };
    case "timezone":
      return { type: "string", maxLength: 60, description: `${spec.label} (IANA zone, e.g. Europe/London)` };
    case "currency":
      return { type: "string", pattern: "^[A-Z]{3}$", description: spec.label };
    case "rich_text":
      return { type: "string", maxLength: ARI_RICH_TEXT_MAX, description: `${spec.label} (plain text; a blank line starts a new paragraph)` };
    case "media_list":
      return {
        type: "array",
        minItems: spec.min,
        maxItems: spec.max,
        description: `${spec.label} (approved photos with a description each)`,
        items: {
          type: "object",
          additionalProperties: false,
          properties: { media_id: MEDIA_ID, alt: { type: "string", maxLength: 240, description: "What the photo shows" } },
          required: ["media_id"],
        },
      };
    case "list": {
      const properties: Record<string, JsonSchema> = {};
      const required: string[] = [];
      for (const [key, child] of Object.entries(spec.item) as Array<[string, FieldSpec]>) {
        const schema = fieldSchema(child, `${path}.${key}`);
        if (!schema) continue;
        properties[ariKey(key)] = schema;
        if ("required" in child && child.required) required.push(ariKey(key));
      }
      return {
        type: "array",
        minItems: spec.min,
        maxItems: spec.max,
        description: spec.label,
        items: { type: "object", additionalProperties: false, properties, required },
      };
    }
  }
}

/** Every layout any design draws for a block type (the site's own design narrows it on save). */
export function ariVariants(type: BlockType): string[] {
  return [...new Set(DESIGN_KEYS.flatMap((key) => DESIGNS[key].variants[type]))];
}

/**
 * The schema of one block as Ari writes it. With `design`, the variant is
 * limited to what that design draws; without, to what any design draws.
 */
export function blockSchema(type: BlockType, design?: DesignKey): JsonSchema {
  const spec = BLOCK_CATALOG[type];
  const properties: Record<string, JsonSchema> = {
    type: { type: "string", enum: [type] },
    variant: { type: "string", enum: design ? [...DESIGNS[design].variants[type]] : ariVariants(type), description: "Layout" },
  };
  const required = ["type", "variant"];
  for (const [key, field] of Object.entries(spec.fields) as Array<[string, FieldSpec]>) {
    const schema = fieldSchema(field, `${type}.${key}`);
    if (!schema) continue;
    properties[ariKey(key)] = schema;
    if ("required" in field && field.required) required.push(ariKey(key));
  }
  return { type: "object", title: spec.label, description: spec.description, additionalProperties: false, properties, required };
}

/** Every block a page may carry (under one design, or any). */
export function blocksSchema(design?: DesignKey): JsonSchema {
  return { anyOf: BLOCK_TYPES.map((type) => blockSchema(type, design)) };
}

/** The catalogue as Ari reads it (get_block_catalog): label, purpose, layouts, fields. */
export function ariBlockCatalog(design?: DesignKey): Array<{ type: BlockType; label: string; description: string; variants: string[]; fields: string[] }> {
  return BLOCK_TYPES.map((type) => {
    const schema = blockSchema(type, design);
    return {
      type,
      label: BLOCK_CATALOG[type].label,
      description: BLOCK_CATALOG[type].description,
      variants: (schema.properties as Record<string, JsonSchema>).variant!.enum as string[],
      fields: Object.keys(schema.properties as Record<string, unknown>).filter((key) => key !== "type" && key !== "variant"),
    };
  });
}

/** The plain-text fields of a block Ari may rewrite with propose_site_copy (top level and in lists). */
export function ariCopyFields(type: BlockType): { fields: string[]; listFields: Record<string, string[]> } {
  const fields: string[] = [];
  const listFields: Record<string, string[]> = {};
  for (const [key, field] of Object.entries(BLOCK_CATALOG[type].fields) as Array<[string, FieldSpec]>) {
    if (ARI_EXCLUDED_FIELDS[`${type}.${key}`]) continue;
    if (field.kind === "text" || field.kind === "rich_text") fields.push(key);
    if (field.kind === "list") {
      const inner = (Object.entries(field.item) as Array<[string, FieldSpec]>)
        .filter(([child, spec]) => spec.kind === "text" && !ARI_EXCLUDED_FIELDS[`${type}.${key}.${child}`])
        .map(([child]) => child);
      if (inner.length) listFields[key] = inner;
    }
  }
  return { fields, listFields };
}

/** What Ari may propose for a site's look (owner token overrides). */
export function tokenOverridesSchema(): JsonSchema {
  const colors: Record<string, JsonSchema> = {};
  for (const role of SINGLE_COLOR_ROLES) colors[role] = HEX_SCHEMA;
  for (const role of RAMP_ROLES) {
    const steps = Object.fromEntries((RAMP_ROLE_STEPS[role] as readonly number[]).map((step) => [String(step), HEX_SCHEMA]));
    colors[role] = {
      type: "object",
      additionalProperties: false,
      properties: { seed: HEX_SCHEMA, steps: { type: "object", additionalProperties: false, properties: steps } },
    };
  }
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      colors: { type: "object", additionalProperties: false, properties: colors },
      radius: { type: "string", enum: [...RADIUS_PRESETS] },
      button_shape: { type: "string", enum: [...BUTTON_SHAPES] },
      motion: { type: "string", enum: [...MOTION_PRESETS] },
      heading_case: { type: "string", enum: [...HEADING_CASES] },
    },
  };
}

/** Font choices per slot: a Google Fonts family name from the catalogue (Studio checks it). */
export function fontChoicesSchema(): JsonSchema {
  const choice: JsonSchema = {
    type: "object",
    additionalProperties: false,
    properties: { family: { type: "string", maxLength: 80, description: "A Google Fonts family name, exactly as listed" } },
    required: ["family"],
  };
  return {
    type: "object",
    additionalProperties: false,
    properties: Object.fromEntries(FONT_SLOT_KEYS.map((slot) => [slot, { ...choice, description: `The ${slot} font` }])),
  };
}

/** A work-log citation: the owner's own words, a Mingla record, or the owner's material. */
export const WORK_LOG_CITE_KINDS = ["owner_words", "mingla_record", "owner_material"] as const;
export type WorkLogCiteKind = (typeof WORK_LOG_CITE_KINDS)[number];
export type WorkLogCite = { kind: WorkLogCiteKind; quote?: string; record_id?: string; media_id?: string };
export const MAX_WORK_LOG_DECISION = 300;
export const MAX_WORK_LOG_CITES = 8;
export const MAX_WORK_LOG_QUOTE = 500;

export function workLogCitesSchema(): JsonSchema {
  return {
    type: "array",
    minItems: 1,
    maxItems: MAX_WORK_LOG_CITES,
    description: "Where this change comes from: at least one of the owner's own words (quote), a Mingla record id (record_id), or an approved photo or video of theirs (media_id)",
    items: {
      type: "object",
      additionalProperties: false,
      properties: {
        kind: { type: "string", enum: [...WORK_LOG_CITE_KINDS] },
        quote: { type: "string", maxLength: MAX_WORK_LOG_QUOTE, description: "owner_words: the owner's words, quoted exactly" },
        record_id: { type: "string", format: "uuid", description: "mingla_record: the brand, trip, event or experience id" },
        media_id: { type: "string", format: "uuid", description: "owner_material: an approved photo or video id" },
      },
      required: ["kind"],
    },
  };
}

/** Each citation names exactly the one thing its kind needs. Returns the first problem, or null. */
export function workLogCitesProblem(value: unknown): string | null {
  if (!Array.isArray(value) || value.length < 1) return "cites needs at least one citation";
  if (value.length > MAX_WORK_LOG_CITES) return `cites allows at most ${MAX_WORK_LOG_CITES}`;
  for (const [index, raw] of value.entries()) {
    const cite = raw as Record<string, unknown> | null;
    if (!cite || typeof cite !== "object" || Array.isArray(cite)) return `cites[${index}] must be an object`;
    const keys = Object.keys(cite);
    if (cite.kind === "owner_words") {
      if (typeof cite.quote !== "string" || !cite.quote.trim() || cite.quote.length > MAX_WORK_LOG_QUOTE || FORBIDDEN_TEXT.test(cite.quote)) return `cites[${index}].quote is required`;
      if (keys.some((key) => key !== "kind" && key !== "quote")) return `cites[${index}] carries a field its kind does not use`;
    } else if (cite.kind === "mingla_record") {
      if (typeof cite.record_id !== "string" || !UUID_RE.test(cite.record_id)) return `cites[${index}].record_id is required`;
      if (keys.some((key) => key !== "kind" && key !== "record_id")) return `cites[${index}] carries a field its kind does not use`;
    } else if (cite.kind === "owner_material") {
      if (typeof cite.media_id !== "string" || !UUID_RE.test(cite.media_id)) return `cites[${index}].media_id is required`;
      if (keys.some((key) => key !== "kind" && key !== "media_id")) return `cites[${index}] carries a field its kind does not use`;
    } else return `cites[${index}].kind is not one of ${WORK_LOG_CITE_KINDS.join(", ")}`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// The validator: the same subset of JSON Schema the generator emits, applied
// to what Ari sends (the Ari tool layer and Studio both run it).
// ---------------------------------------------------------------------------

export function schemaProblems(value: unknown, schema: JsonSchema, path = "value"): string[] {
  const problems: string[] = [];
  const anyOf = schema.anyOf as JsonSchema[] | undefined;
  if (anyOf) {
    // Blocks discriminate on `type`; pick the branch that names it.
    const typed = value && typeof value === "object" ? (value as Record<string, unknown>).type : undefined;
    const branch = anyOf.find((candidate) => {
      const enumValues = ((candidate.properties as Record<string, JsonSchema> | undefined)?.type?.enum) as unknown[] | undefined;
      return enumValues?.includes(typed);
    });
    return branch ? schemaProblems(value, branch, path) : [`${path}.type is not a known block`];
  }
  if (value === null || value === undefined) return [`${path} is missing`];
  if (Array.isArray(schema.enum) && !(schema.enum as unknown[]).includes(value)) problems.push(`${path} must be one of ${(schema.enum as unknown[]).join(", ")}`);
  switch (schema.type) {
    case "string": {
      if (typeof value !== "string") return [`${path} must be text`];
      if (typeof schema.maxLength === "number" && value.length > schema.maxLength) problems.push(`${path} is longer than ${schema.maxLength} characters`);
      if (typeof schema.minLength === "number" && value.length < schema.minLength) problems.push(`${path} is shorter than ${schema.minLength} characters`);
      if (typeof schema.pattern === "string" && !new RegExp(schema.pattern).test(value)) problems.push(`${path} is not in the expected form`);
      if (schema.format === "uuid" && !UUID_RE.test(value)) problems.push(`${path} must be an id`);
      if (FORBIDDEN_TEXT.test(value) || /<\s*\/?\s*[a-z!]/i.test(value)) problems.push(`${path} must be plain text (no markup)`);
      if (typeof schema.description === "string" && schema.description.includes("an https link") && value && !isSafeHref(value)) {
        problems.push(`${path} must be an https link, mailto:, tel: or a /path on this website`);
      }
      break;
    }
    case "integer":
      if (typeof value !== "number" || !Number.isInteger(value)) return [`${path} must be a whole number`];
      break;
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) return [`${path} must be a number`];
      break;
    case "boolean":
      if (typeof value !== "boolean") return [`${path} must be true or false`];
      break;
    case "array": {
      if (!Array.isArray(value)) return [`${path} must be a list`];
      if (typeof schema.minItems === "number" && value.length < schema.minItems) problems.push(`${path} needs at least ${schema.minItems}`);
      if (typeof schema.maxItems === "number" && value.length > schema.maxItems) problems.push(`${path} allows at most ${schema.maxItems}`);
      if (schema.items) value.forEach((item, index) => problems.push(...schemaProblems(item, schema.items as JsonSchema, `${path}[${index}]`)));
      break;
    }
    case "object": {
      if (typeof value !== "object" || Array.isArray(value)) return [`${path} must be an object`];
      const record = value as Record<string, unknown>;
      const properties = (schema.properties ?? {}) as Record<string, JsonSchema>;
      if (schema.additionalProperties === false) {
        for (const key of Object.keys(record)) if (!(key in properties)) problems.push(`${path}.${key} is not a field here`);
      }
      for (const key of (schema.required ?? []) as string[]) {
        if (record[key] === undefined || record[key] === null || record[key] === "") problems.push(`${path}.${key} is required`);
      }
      for (const [key, child] of Object.entries(properties)) {
        if (record[key] !== undefined && record[key] !== null) problems.push(...schemaProblems(record[key], child, `${path}.${key}`));
      }
      break;
    }
  }
  if (typeof value === "number" && typeof schema.minimum === "number" && value < schema.minimum) problems.push(`${path} must be at least ${schema.minimum}`);
  if (typeof value === "number" && typeof schema.maximum === "number" && value > schema.maximum) problems.push(`${path} must be at most ${schema.maximum}`);
  return problems;
}

/** Problems with one block Ari proposed (empty = acceptable). With `design`, its layout must be one that design draws. */
export function ariBlockProblems(block: unknown, design?: DesignKey, path = "block"): string[] {
  return schemaProblems(block, blocksSchema(design), path);
}
