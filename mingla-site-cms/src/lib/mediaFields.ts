import type { Block, Field } from "payload";

/*
 * #2829 — where a document holds media, DERIVED from its schema.
 *
 * The in-use scan that decides whether a picture or video may be tombstoned
 * (and then purged by retention) used to name the media fields by hand: a
 * block's `media`, a gallery's `images[].media`, a page's SEO image. Every
 * field added later — the hero's background video, a film's video and poster,
 * a team member's portrait — was invisible to it, so media used ONLY there
 * looked unused and could be deleted from a live site. The same hand list
 * guarded writes, so those fields were never checked to be the site's own
 * ready media either.
 *
 * This walks the Payload field config itself (arrays, groups, rows,
 * collapsibles, tabs and blocks, to any depth), so a media field added to any
 * block or collection is seen the moment it exists.
 */

type AnyRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is AnyRecord =>
  !!value && typeof value === "object" && !Array.isArray(value);

function pointsAtMedia(relationTo: unknown): boolean {
  return relationTo === "media" || (Array.isArray(relationTo) && relationTo.includes("media"));
}

function mediaIdOf(value: unknown, polymorphic: boolean): string | null {
  if (value == null || value === "") return null;
  if (polymorphic && isRecord(value) && "relationTo" in value) {
    if (value.relationTo !== "media") return null;
    return mediaIdOf(value.value, false);
  }
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (isRecord(value) && (typeof value.id === "string" || typeof value.id === "number")) {
    return String(value.id);
  }
  return null;
}

function blocksOf(field: AnyRecord): Block[] {
  return Array.isArray(field.blocks) ? (field.blocks as Block[]) : [];
}

function walk(fields: readonly Field[], data: unknown, out: Set<string>): void {
  if (!isRecord(data)) return;
  for (const raw of fields) {
    const field = raw as unknown as AnyRecord;
    const name = typeof field.name === "string" ? field.name : null;
    switch (field.type) {
      case "relationship":
      case "upload": {
        if (!name || !pointsAtMedia(field.relationTo)) break;
        const polymorphic = Array.isArray(field.relationTo);
        const value = data[name];
        for (const item of Array.isArray(value) ? value : [value]) {
          const id = mediaIdOf(item, polymorphic);
          if (id) out.add(id);
        }
        break;
      }
      case "array":
        if (!name) break;
        for (const row of Array.isArray(data[name]) ? (data[name] as unknown[]) : []) {
          walk(field.fields as Field[], row, out);
        }
        break;
      case "group":
        walk(field.fields as Field[], name ? data[name] : data, out);
        break;
      case "row":
      case "collapsible":
        walk(field.fields as Field[], data, out);
        break;
      case "tabs":
        for (const tab of (field.tabs as AnyRecord[]) ?? []) {
          const tabName = typeof tab.name === "string" ? tab.name : null;
          walk(tab.fields as Field[], tabName ? data[tabName] : data, out);
        }
        break;
      case "blocks": {
        if (!name) break;
        const blocks = blocksOf(field);
        for (const row of Array.isArray(data[name]) ? (data[name] as unknown[]) : []) {
          if (!isRecord(row)) continue;
          const block = blocks.find((candidate) => candidate.slug === row.blockType);
          if (block) walk(block.fields, row, out);
        }
        break;
      }
      default:
        break;
    }
  }
}

/** Every media id a document holds, in any media field its schema declares. */
export function collectMediaIds(
  fields: readonly Field[],
  doc: unknown,
  out: Set<string> = new Set(),
): Set<string> {
  walk(fields, doc, out);
  return out;
}

/**
 * One step of a path to a media field: a plain key, an array (one row), a
 * block of a given type inside a blocks field, or the media field itself.
 */
export type MediaPathStep =
  | { kind: "key"; name: string }
  | { kind: "array"; name: string }
  | { kind: "block"; name: string; blockType: string }
  | { kind: "media"; name: string; hasMany: boolean; polymorphic: boolean };

/** Every path to a media field in a schema (used to prove each one is scanned). */
export function mediaFieldPaths(fields: readonly Field[], prefix: MediaPathStep[] = []): MediaPathStep[][] {
  const paths: MediaPathStep[][] = [];
  for (const raw of fields) {
    const field = raw as unknown as AnyRecord;
    const name = typeof field.name === "string" ? field.name : null;
    switch (field.type) {
      case "relationship":
      case "upload":
        if (name && pointsAtMedia(field.relationTo)) {
          paths.push([
            ...prefix,
            { kind: "media", name, hasMany: field.hasMany === true, polymorphic: Array.isArray(field.relationTo) },
          ]);
        }
        break;
      case "array":
        if (name) paths.push(...mediaFieldPaths(field.fields as Field[], [...prefix, { kind: "array", name }]));
        break;
      case "group":
        paths.push(...mediaFieldPaths(field.fields as Field[], name ? [...prefix, { kind: "key", name }] : prefix));
        break;
      case "row":
      case "collapsible":
        paths.push(...mediaFieldPaths(field.fields as Field[], prefix));
        break;
      case "tabs":
        for (const tab of (field.tabs as AnyRecord[]) ?? []) {
          const tabName = typeof tab.name === "string" ? tab.name : null;
          paths.push(...mediaFieldPaths(tab.fields as Field[], tabName ? [...prefix, { kind: "key", name: tabName }] : prefix));
        }
        break;
      case "blocks":
        if (!name) break;
        for (const block of blocksOf(field)) {
          paths.push(...mediaFieldPaths(block.fields, [...prefix, { kind: "block", name, blockType: block.slug }]));
        }
        break;
      default:
        break;
    }
  }
  return paths;
}

/** A readable label for a media path, e.g. `blocks[hero].video`. */
export function mediaPathLabel(path: MediaPathStep[]): string {
  return path
    .map((step) =>
      step.kind === "block" ? `${step.name}[${step.blockType}]` : step.kind === "array" ? `${step.name}[]` : step.name
    )
    .join(".");
}
