// #4636 — the site's own block registry, page defaults and reserved address
// segments, read from mingla-marketing at build time (one owner:
// I-4636-ONE-BLOCK-REGISTRY). Admin never keeps a copy; Vite bundles these
// JSON files, and the dev server may read them (vite.config.js server.fs.allow).
import registry from "../../../mingla-marketing/lib/site-blocks/registry.json" with { type: "json" };
import pageDefaults from "../../../mingla-marketing/lib/site-blocks/page-defaults.json" with { type: "json" };
import reservedPaths from "../../../mingla-marketing/lib/site-pages/reserved-paths.json" with { type: "json" };

export const REGISTRY = registry;
export const PAGE_DEFAULTS = pageDefaults;
export const RESERVED_SEGMENTS = Object.freeze(reservedPaths.segments || []);
