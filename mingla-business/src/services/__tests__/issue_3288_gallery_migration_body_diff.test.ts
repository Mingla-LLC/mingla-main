/**
 * Issue #3288 — the server half of the additional-photos fix must change ONLY
 * the gallery lines of the six functions it re-publishes.
 *
 * The migration re-publishes six whole functions with `CREATE OR REPLACE`,
 * copied from their latest definitions. Two of them (the event publish and the
 * live-event atomic owner) sit next to ticketing and pricing code. A copy taken
 * from a stale definition, or a stray edit, would silently roll back someone
 * else's fix on a money-adjacent path, and a behaviour-only SQL test could not
 * see it. This guard extracts every function body from the #3288 migration and
 * from the newest EARLIER migration that defines the same function, diffs them
 * line by line, and requires the difference to be exactly the gallery lines.
 *
 * Because the predecessor is found dynamically, a migration that lands BEFORE
 * #3288 in sort order and redefines one of these functions turns this red: the
 * #3288 copy would be erasing that change.
 *
 * It also pins that the file contains nothing but those six functions and the
 * transaction / schema-reload wrapper — no other DDL, and no other function.
 *
 * FAILS-ON-REVERT: remove any #3288 gallery line from the migration, or change
 * any non-gallery line, and the matching case fails.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "@jest/globals";

const REPO_ROOT = join(__dirname, "..", "..", "..", "..");
const MIGRATIONS_DIR = join(REPO_ROOT, "supabase", "migrations");
const MIGRATION = "20270629003288_issue_3288_gallery_absent_key_preserves.sql";

const migrationFiles = readdirSync(MIGRATIONS_DIR)
  .filter((name) => name.endsWith(".sql"))
  .sort();

const read = (name: string): string =>
  readFileSync(join(MIGRATIONS_DIR, name), "utf8");

const definitionPattern = (fn: string): RegExp =>
  new RegExp(`CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${fn}\\s*\\(`, "gi");

/** The LAST `CREATE OR REPLACE FUNCTION public.<fn>(` in a file, through its body delimiter. */
const extractDefinition = (source: string, fn: string): string | null => {
  const starts = [...source.matchAll(definitionPattern(fn))];
  const last = starts.at(-1);
  if (last === undefined || last.index === undefined) return null;
  const tail = source.slice(last.index);
  const as = /\bAS\s+(\$[A-Za-z_]*\$)/i.exec(tail);
  if (as === null) return null;
  const bodyStart = as.index + as[0].length;
  const bodyEnd = tail.indexOf(as[1], bodyStart);
  if (bodyEnd < 0) return null;
  return tail.slice(0, bodyEnd + as[1].length);
};

/** Trimmed, non-blank, non-comment lines. */
const codeLines = (definition: string): string[] =>
  definition
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("--"));

/** Multiset line diff via LCS: what the new body removed and added. */
const lineDiff = (
  before: string[],
  after: string[],
): { removed: string[]; added: string[] } => {
  const n = before.length;
  const m = after.length;
  const table: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i][j] =
        before[i] === after[j]
          ? table[i + 1][j + 1] + 1
          : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const removed: string[] = [];
  const added: string[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (before[i] === after[j]) {
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      removed.push(before[i]);
      i += 1;
    } else {
      added.push(after[j]);
      j += 1;
    }
  }
  while (i < n) removed.push(before[i++]);
  while (j < m) added.push(after[j++]);
  return { removed: removed.sort(), added: added.sort() };
};

const PUBLISH_GALLERY_REMOVED = [
  "v_cover_media_gallery := COALESCE(p_draft_payload->'cover_media_gallery', '[]'::jsonb);",
];
const PUBLISH_GALLERY_ADDED = [
  "v_cover_media_gallery := CASE WHEN p_draft_payload ? 'cover_media_gallery'",
  "THEN COALESCE(p_draft_payload->'cover_media_gallery', '[]'::jsonb)",
  "ELSE COALESCE(v_event.cover_media_gallery, '[]'::jsonb) END;",
];

const EXPECTED: Record<string, { removed: string[]; added: string[] }> = {
  business_publish_event_draft: {
    removed: PUBLISH_GALLERY_REMOVED,
    added: PUBLISH_GALLERY_ADDED,
  },
  business_update_event_draft: {
    removed: [
      "cover_media_alt=NULLIF(p_payload->>'cover_media_alt',''), cover_media_gallery=COALESCE(p_payload->'cover_media_gallery','[]'::jsonb),",
    ],
    added: [
      "cover_media_alt=NULLIF(p_payload->>'cover_media_alt',''), cover_media_gallery=CASE WHEN p_payload?'cover_media_gallery' THEN COALESCE(p_payload->'cover_media_gallery','[]'::jsonb) ELSE v_event.cover_media_gallery END,",
    ],
  },
  business_publish_rsvp_draft: {
    removed: PUBLISH_GALLERY_REMOVED,
    added: PUBLISH_GALLERY_ADDED,
  },
  business_update_rsvp_graph: {
    removed: [
      "city=CASE WHEN p_payload?'city' THEN NULLIF(p_payload->>'city','') ELSE city END",
    ],
    added: [
      "city=CASE WHEN p_payload?'city' THEN NULLIF(p_payload->>'city','') ELSE city END,",
      "cover_media_gallery=CASE WHEN p_payload?'cover_media_gallery' THEN p_payload->'cover_media_gallery' ELSE cover_media_gallery END",
    ],
  },
  business_update_live_event_atomic: {
    removed: [],
    added: [
      "IF p_patch ? 'gallery' THEN",
      "UPDATE public.events SET",
      "cover_media_gallery=COALESCE(p_patch->'gallery','[]'::jsonb),",
      "updated_at=now()",
      "WHERE id=p_event_id;",
      "END IF;",
    ],
  },
  business_clear_event_cover_media: {
    removed: [
      "cover_media_credit_url=NULL,cover_media_alt=NULL,cover_media_gallery='[]'::jsonb,",
    ],
    added: ["cover_media_credit_url=NULL,cover_media_alt=NULL,"],
  },
};

const sorted = (lines: string[]): string[] => [...lines].sort();

describe("issue #3288 — the gallery migration changes only the gallery lines", () => {
  const migration = read(MIGRATION);

  test("the migration sorts after every definition it copies", () => {
    expect(migrationFiles).toContain(MIGRATION);
  });

  test.each(Object.keys(EXPECTED))(
    "%s differs from its newest earlier definition by exactly the gallery lines",
    (fn) => {
      const predecessor = migrationFiles
        .filter((name) => name < MIGRATION)
        .filter((name) => definitionPattern(fn).test(read(name)))
        .at(-1);
      expect(predecessor).toBeDefined();
      const before = extractDefinition(read(predecessor as string), fn);
      const after = extractDefinition(migration, fn);
      expect(before).not.toBeNull();
      expect(after).not.toBeNull();

      const diff = lineDiff(codeLines(before as string), codeLines(after as string));
      expect({ fn, predecessor, ...diff }).toEqual({
        fn,
        predecessor,
        removed: sorted(EXPECTED[fn].removed),
        added: sorted(EXPECTED[fn].added),
      });
    },
  );

  test("the file holds only those six functions plus its transaction wrapper", () => {
    let rest = migration;
    for (const fn of Object.keys(EXPECTED)) {
      const definition = extractDefinition(rest, fn);
      expect(definition).not.toBeNull();
      expect([...rest.matchAll(definitionPattern(fn))]).toHaveLength(1);
      rest = rest.replace(definition as string, "");
    }
    const statements = rest
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("--"));
    expect(statements).toEqual([
      "BEGIN;",
      ";",
      ";",
      ";",
      ";",
      ";",
      ";",
      "COMMIT;",
      "NOTIFY pgrst, 'reload schema';",
    ]);
  });
});
