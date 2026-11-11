#!/usr/bin/env node
// Issue #3355 Wave B (B2) — the Ari App Map.
//
// Walks the Host app's Expo Router tree (mingla-business/app/**) and writes
// supabase/functions/_shared/generated/ariAppMap.json: every screen's route
// pattern, its params, a human screen title, and the Feature Guide entries
// whose how_to names that screen (read from the guide seeds checked in under
// supabase/migrations — never from production).
//
// Ari may hand a host only to a route that matches this map
// (I-ARI-HANDOFF-FIXABLE). The output is deterministic (sorted, no
// timestamps) so a CI drift check can regenerate it and diff:
//   supabase/functions/_shared/__tests__/issue_3355_wave_b_app_map.implementor.test.ts
//
// Usage: node scripts/ari/build-app-map.mjs           (write the file)
//        node scripts/ari/build-app-map.mjs --check   (exit 1 when stale)

import fs from "node:fs";
import path from "node:path";

export const APP_DIR = "mingla-business/app";
export const MIGRATIONS_DIR = "supabase/migrations";
export const OUTPUT_PATH = "supabase/functions/_shared/generated/ariAppMap.json";

const SCREEN_EXT = /\.(tsx|jsx)$/;
const PLATFORM_SUFFIX = /\.(web|native|ios|android)$/;

/** Words too generic to tie a guide entry to a screen on their own. */
const GENERIC_TITLES = new Set([
  "brand",
  "buyer",
  "callback",
  "cancel",
  "confirm",
  "create",
  "edit",
  "home",
  "index",
  "intake",
  "manage",
  "new",
  "not found",
  "pass",
  "payment",
  "preview",
  "queue",
  "results",
  "setup",
  "success",
]);

/** Admin-only or staff-only guide entries never link to a Host screen. */
const STAFF_SURFACE =
  /(mingla admin|admin web|github|my agent|team agents|claude|codex|careers)/i;

function walk(root, relative, out) {
  const absolute = path.join(root, relative);
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    const rel = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (entry.name === "__tests__" || entry.name.startsWith(".")) continue;
      walk(root, rel, out);
    } else if (entry.isFile() && SCREEN_EXT.test(entry.name)) {
      out.push(rel);
    }
  }
  return out;
}

/** "brand/[id]/edit.tsx" → { pattern, params, segments } or null (not a screen). */
export function routeFromFile(rel) {
  const withoutExt = rel.replace(SCREEN_EXT, "").replace(PLATFORM_SUFFIX, "");
  const parts = withoutExt.split("/");
  const leaf = parts[parts.length - 1];
  // Layouts, +html / +not-found / +native-intent, and _private files are
  // not screens a host can be sent to.
  if (leaf === "_layout" || leaf.startsWith("+") || leaf.startsWith("_")) {
    return null;
  }
  if (parts.some((part) => part.startsWith("_") && part !== leaf)) return null;
  const segments = parts
    .filter((part) => !/^\(.+\)$/.test(part)) // groups: (tabs)
    .filter((part, index, all) => !(part === "index" && index === all.length - 1));
  const params = [];
  for (const segment of segments) {
    const catchAll = segment.match(/^\[\.\.\.([A-Za-z0-9_]+)\]$/);
    const dynamic = segment.match(/^\[([A-Za-z0-9_]+)\]$/);
    if (catchAll) params.push(catchAll[1]);
    else if (dynamic) params.push(dynamic[1]);
  }
  return {
    pattern: `/${segments.join("/")}`,
    params,
    segments,
  };
}

/** One-letter public link prefixes read as what they open. */
const PREFIX_TITLES = Object.freeze({
  b: "Brand page",
  e: "Event page",
  exp: "Experience page",
  g: "Group invite",
  m: "Message link",
  o: "Order",
  t: "Trip page",
});

function humanize(segment) {
  const words = segment.replace(/[-_]+/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : words;
}

/** Stack.Screen title, then a header/top bar/gate `title="…"`, else the path. */
export function screenTitle(source, segments) {
  const stack = source.match(
    /<Stack\.Screen[\s\S]{0,300}?\btitle:\s*"([^"\\]{2,80})"/,
  );
  if (stack) return { title: stack[1], title_source: "stack_screen" };
  const tag = /<([A-Z][A-Za-z]*(?:TopBar|Header|Gate))\b([^<>]*?)\btitle="([^"{}<>]{2,80})"/
    .exec(source);
  if (tag) return { title: tag[3], title_source: "header" };
  const fixed = segments.filter((segment) => !segment.startsWith("["));
  if (fixed.length > 0 && fixed.length <= 2 && PREFIX_TITLES[fixed[0]] &&
    (fixed.length === 1 || fixed[1] === "venue")) {
    return {
      title: fixed[1] === "venue" ? "Venue order" : PREFIX_TITLES[fixed[0]],
      title_source: "path",
    };
  }
  const last = fixed[fixed.length - 1] ?? "home";
  const lastTitle = humanize(last);
  const title = fixed.length > 1 && GENERIC_TITLES.has(last.toLowerCase())
    ? `${humanize(fixed[fixed.length - 2])} ${last.replace(/[-_]+/g, " ")}`
    : lastTitle;
  return { title, title_source: "path" };
}

/**
 * The Feature Guide as the checked-in migrations leave it: JSON seed arrays
 * inside dollar quotes (later files win), plus a literal
 * `capability_key='…' … how_to='…'` update. Other edits (appends, replace())
 * do not change which screen an entry names.
 */
export function readGuideSeed(root) {
  const dir = path.join(root, MIGRATIONS_DIR);
  const files = fs.readdirSync(dir).filter((name) => name.endsWith(".sql"))
    .sort();
  const guide = new Map();
  for (const name of files) {
    const sql = fs.readFileSync(path.join(dir, name), "utf8");
    if (!sql.includes("how_to")) continue;
    for (const match of sql.matchAll(/\$([a-z0-9_]*)\$\s*(\[[\s\S]*?\])\s*\$\1\$/g)) {
      let rows;
      try {
        rows = JSON.parse(match[2]);
      } catch {
        continue;
      }
      if (!Array.isArray(rows)) continue;
      for (const row of rows) {
        if (
          !row || typeof row.capability_key !== "string" ||
          typeof row.how_to !== "string"
        ) continue;
        const previous = guide.get(row.capability_key) ?? {};
        guide.set(row.capability_key, {
          capability_key: row.capability_key,
          how_to: row.how_to,
          surfaces: Array.isArray(row.surfaces)
            ? row.surfaces
            : previous.surfaces ?? [],
          claimed_status: typeof row.claimed_status === "string"
            ? row.claimed_status
            : previous.claimed_status ?? null,
        });
      }
    }
    for (
      const match of sql.matchAll(
        /capability_key\s*=\s*'([a-z0-9-]+)'[\s\S]{0,600}?how_to\s*=\s*'((?:[^']|'')+)'/g,
      )
    ) {
      const previous = guide.get(match[1]);
      if (!previous) continue;
      guide.set(match[1], { ...previous, how_to: match[2].replace(/''/g, "'") });
    }
  }
  return guide;
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A guide entry names a screen when its how_to contains the screen's title
 * as words: case-insensitive for a title of two or more words, and as a
 * capitalised word for a single-word title ("then Discounts").
 */
export function howToNamesScreen(howTo, title) {
  const clean = title.trim();
  if (clean.length < 4 || GENERIC_TITLES.has(clean.toLowerCase())) {
    return false;
  }
  const words = clean.split(/\s+/);
  if (words.length > 1) {
    return new RegExp(
      `(^|[^A-Za-z])${escapeRegExp(clean)}($|[^A-Za-z])`,
      "i",
    ).test(howTo);
  }
  // One word must be where the host is sent: "open Discounts", "then
  // Discounts", "Brand > Payments".
  return new RegExp(
    `(?:\\b(?:open|opens|tap|then|go to|choose|select|in)\\s+(?:the\\s+)?|[>→]\\s*)${
      escapeRegExp(clean)
    }($|[^A-Za-z])`,
  ).test(howTo);
}

export function buildAppMap(root) {
  const files = walk(path.join(root, APP_DIR), "", []).sort();
  const byPattern = new Map();
  for (const rel of files) {
    const route = routeFromFile(rel);
    if (!route) continue;
    const source = fs.readFileSync(path.join(root, APP_DIR, rel), "utf8");
    const existing = byPattern.get(route.pattern);
    const title = screenTitle(source, route.segments);
    // A platform variant (connect.web.tsx) is the same route; keep the
    // base file and its title.
    if (existing && !PLATFORM_SUFFIX.test(rel.replace(SCREEN_EXT, ""))) {
      if (PLATFORM_SUFFIX.test(existing.file.replace(SCREEN_EXT, ""))) {
        byPattern.set(route.pattern, { ...route, ...title, file: rel });
      }
      continue;
    }
    if (!existing) byPattern.set(route.pattern, { ...route, ...title, file: rel });
  }

  const guide = [...readGuideSeed(root).values()].filter((entry) =>
    entry.claimed_status !== "retired" &&
    entry.surfaces.some((surface) => !STAFF_SURFACE.test(surface))
  ).sort((a, b) => a.capability_key.localeCompare(b.capability_key));

  const routes = [...byPattern.values()]
    .sort((a, b) => a.pattern.localeCompare(b.pattern))
    .map((route) => ({
      pattern: route.pattern,
      params: route.params,
      title: route.title,
      title_source: route.title_source,
      file: `${APP_DIR}/${route.file}`,
      capability_keys: guide
        .filter((entry) => howToNamesScreen(entry.how_to, route.title))
        .map((entry) => entry.capability_key),
    }));

  const linked = new Set(routes.flatMap((route) => route.capability_keys));
  const guideHowTo = Object.fromEntries(
    guide.filter((entry) => linked.has(entry.capability_key)).map((entry) => [
      entry.capability_key,
      entry.how_to,
    ]),
  );
  return {
    schema_version: 1,
    generated_by: "scripts/ari/build-app-map.mjs",
    source: `${APP_DIR}/** (Expo Router) + ${MIGRATIONS_DIR} Feature Guide seeds`,
    routes,
    guide_how_to: guideHowTo,
  };
}

export function renderAppMap(root) {
  return `${JSON.stringify(buildAppMap(root), null, 2)}\n`;
}

const isMain = typeof process !== "undefined" && process.argv?.[1] &&
  path.resolve(process.argv[1]) ===
    path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
  const target = path.join(root, OUTPUT_PATH);
  const next = renderAppMap(root);
  if (process.argv.includes("--check")) {
    const current = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "";
    if (current !== next) {
      console.error(
        `${OUTPUT_PATH} is stale. Run: node scripts/ari/build-app-map.mjs`,
      );
      process.exit(1);
    }
    console.log(`${OUTPUT_PATH} is current.`);
  } else {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, next);
    console.log(`wrote ${OUTPUT_PATH}`);
  }
}
