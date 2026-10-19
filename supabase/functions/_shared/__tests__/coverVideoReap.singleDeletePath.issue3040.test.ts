// Issue #3040 (P1-1 rework) — there is exactly ONE way to delete a provider
// video asset: destroyIfUnreferenced, which asks cover_video_guid_live_references
// first and refuses while anything (a live cover on any target, a venue
// listing, a venue draft, trip-day media, an ad creative, a pending job)
// still references the guid.
//
// This suite reads every non-test edge-function source file and fails if a
// provider delete is invoked anywhere else: a direct destroyCoverVideoAsset(...)
// call, a bunnyDeleteVideo(...) call outside the one helper that wraps it, or a
// second Bunny DELETE request.
//
// MINGLA-INVARIANT: I-VIDEO-SINGLE-GUARDED-DELETE | issue #3040 | destroyIfUnreferenced is the only caller of the provider delete
//
// FAILS ON REVERT: put back any direct `deps.destroyCoverVideoAsset(target)`
// (reaper terminal reap, webhook failure paths, intent transport failure),
// the cancel endpoint's `destroyCoverVideoAsset({...})`, or the intent's
// supersede reap `destroyCoverVideoAsset(row)` and the matching case fails,
// naming the file and line.
import { assert } from "./issue3040_fakeSupabase.ts";

const FUNCTIONS_ROOT = new URL("../../", import.meta.url);

const isTestPath = (path: string): boolean =>
  path.includes("/__tests__/") || /\.(test|spec)\.ts$/.test(path) ||
  /_test\.ts$/.test(path) || /\.worker\.ts$/.test(path);

async function* sourceFiles(dir: URL, rel = ""): AsyncGenerator<{ rel: string; url: URL }> {
  for await (const entry of Deno.readDir(dir)) {
    const childRel = `${rel}${entry.name}`;
    if (entry.isDirectory) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      yield* sourceFiles(new URL(`${entry.name}/`, dir), `${childRel}/`);
    } else if (entry.isFile && entry.name.endsWith(".ts") && !isTestPath(`/${childRel}`)) {
      yield { rel: childRel, url: new URL(entry.name, dir) };
    }
  }
}

// Comments are not code: a comment that names the delete must not count, and a
// commented-out call must not hide a live one on another line.
export const stripComments = (source: string): string =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
    .split("\n")
    .map((line) => line.replace(/(^|[^:\\])\/\/.*$/, "$1"))
    .join("\n");

type Hit = { file: string; line: number; text: string };

export const findCalls = (rel: string, source: string, pattern: RegExp): Hit[] => {
  const hits: Hit[] = [];
  stripComments(source).split("\n").forEach((text, index) => {
    if (pattern.test(text)) hits.push({ file: rel, line: index + 1, text: text.trim() });
  });
  return hits;
};

const DESTROY_CALL = /(?<!function\s)\bdestroyCoverVideoAsset\s*\(/;
const BUNNY_DELETE_CALL = /(?<!function\s)\bbunnyDeleteVideo\s*\(/;
const HTTP_DELETE = /method\s*:\s*["']DELETE["']/;

const collect = async () => {
  const destroy: Hit[] = [];
  const bunnyDelete: Hit[] = [];
  const httpDelete: Hit[] = [];
  for await (const file of sourceFiles(FUNCTIONS_ROOT)) {
    const source = await Deno.readTextFile(file.url);
    destroy.push(...findCalls(file.rel, source, DESTROY_CALL));
    bunnyDelete.push(...findCalls(file.rel, source, BUNNY_DELETE_CALL));
    if (/bunnycdn|bunnyStream/.test(source)) {
      httpDelete.push(...findCalls(file.rel, source, HTTP_DELETE));
    }
  }
  return { destroy, bunnyDelete, httpDelete };
};

const describe = (hits: Hit[]): string =>
  hits.map((hit) => `${hit.file}:${hit.line}  ${hit.text}`).join("\n");

Deno.test("#3040 P1-1 destroyCoverVideoAsset is invoked only inside the guarded path", async () => {
  const { destroy } = await collect();
  const outside = destroy.filter((hit) => hit.file !== "_shared/coverVideoReap.ts");
  assert(outside.length === 0, `unguarded provider delete:\n${describe(outside)}`);
  const inside = destroy.filter((hit) => hit.file === "_shared/coverVideoReap.ts");
  assert(inside.length === 1, `the guard must call the delete exactly once:\n${describe(inside)}`);
});

Deno.test("#3040 P1-1 bunnyDeleteVideo is only wrapped by destroyCoverVideoAsset", async () => {
  const { bunnyDelete } = await collect();
  assert(
    bunnyDelete.length === 1 && bunnyDelete[0].file === "_shared/eventCoverVideo.ts",
    `bunnyDeleteVideo called outside its wrapper:\n${describe(bunnyDelete)}`,
  );
});

Deno.test("#3040 P1-1 there is one Bunny DELETE request in the codebase", async () => {
  const { httpDelete } = await collect();
  assert(
    httpDelete.length === 1 && httpDelete[0].file === "_shared/bunnyStream.ts",
    `a second Bunny DELETE path exists:\n${describe(httpDelete)}`,
  );
});

Deno.test("#3040 P1-1 the scanner itself: comments never count, calls always do", () => {
  const sample = [
    "// await deps.destroyCoverVideoAsset(job);",
    "/* destroyCoverVideoAsset(row) */",
    "const url = \"https://x.test/a\"; await deps.destroyCoverVideoAsset(target);",
    "export async function destroyCoverVideoAsset(job) {",
    "await destroyCoverVideoAsset ({ source_asset_id: id });",
  ].join("\n");
  const hits = findCalls("sample.ts", sample, DESTROY_CALL).map((hit) => hit.line);
  assert(JSON.stringify(hits) === JSON.stringify([3, 5]), `scanner hits ${JSON.stringify(hits)}`);
});
