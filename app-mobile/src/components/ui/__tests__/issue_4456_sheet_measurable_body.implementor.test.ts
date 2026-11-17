// @ts-nocheck — Deno-runtime suite; app-mobile's tsc sweep has no Deno globals.
//
// MINGLA-INVARIANT: I-4456-SHEET-MEASURABLE-BODY | issue #4456 | no BaseBottomSheet pairs enableDynamicSizing with scrollMode="view": gorhom cannot measure a plain View, so the sheet never opens while its modal window swallows every touch; and a modal-wrapped dynamically sized sheet that never reports an open index is closed by the primitive's watchdog
//
// Found by the #4456 device pass (the Unsend confirm) and on Seth's phone
// (Profile → Edit bio). FAILS-ON-REVERT: put scrollMode="view" back on any
// dynamically sized sheet, or drop the BaseBottomSheet watchdog, and this fails.

const appRoot = new URL("../../../../", import.meta.url);
const repoRoot = new URL("../", appRoot);

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}
function strip(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
}

async function* walk(dir: URL): AsyncGenerator<URL> {
  for await (const entry of Deno.readDir(dir)) {
    if (entry.name === "node_modules" || entry.name === "__tests__" || entry.name.startsWith(".")) continue;
    const next = new URL(entry.name + (entry.isDirectory ? "/" : ""), dir);
    if (entry.isDirectory) yield* walk(next);
    else if (/\.(tsx|ts)$/.test(entry.name)) yield next;
  }
}

/** Every `<BaseBottomSheet …>` opening tag's props, as text. */
function openingTags(source: string): string[] {
  const tags: string[] = [];
  let at = source.indexOf("<BaseBottomSheet");
  while (at >= 0) {
    let depth = 0;
    let end = at;
    for (let i = at; i < source.length; i += 1) {
      const c = source[i];
      if (c === "{") depth += 1;
      else if (c === "}") depth -= 1;
      else if (c === ">" && depth === 0 && source[i - 1] !== "=") { end = i; break; }
    }
    tags.push(source.slice(at, end + 1));
    at = source.indexOf("<BaseBottomSheet", end);
  }
  return tags;
}

Deno.test("#4456 no sheet pairs dynamic sizing with an unmeasurable view body", async () => {
  const offenders: string[] = [];
  let scanned = 0;
  for (const dir of ["app-mobile/src/", "app-mobile/app/", "mingla-business/src/", "mingla-business/app/"]) {
    const base = new URL(dir, repoRoot);
    try { await Deno.stat(base); } catch { continue; }
    for await (const file of walk(base)) {
      if (file.pathname.endsWith("components/ui/BaseBottomSheet.tsx")) continue;
      const source = strip(await Deno.readTextFile(file));
      for (const tag of openingTags(source)) {
        scanned += 1;
        const dynamic = /\benableDynamicSizing(?!\s*=\s*\{\s*false\s*\})/.test(tag);
        const viewBody = /scrollMode=["{]\s*["']?view["']?/.test(tag);
        if (dynamic && viewBody) offenders.push(file.pathname.slice(repoRoot.pathname.length));
      }
    }
  }
  assert(scanned > 40, `the scan found the sheets (${scanned})`);
  assert(offenders.length === 0, `dynamic sizing with scrollMode="view": ${offenders.join(", ")}`);
});

Deno.test("#4456 the primitive closes a modal-wrapped dynamic sheet that never opens", async () => {
  const primitive = strip(await Deno.readTextFile(new URL("src/components/ui/BaseBottomSheet.tsx", appRoot)));
  assert(/export const SHEET_OPEN_WATCHDOG_MS = 2000;/.test(primitive), "watchdog window");
  assert(/if \(!wrapInRNModal \|\| !enableDynamicSizing\) return undefined;/.test(primitive), "scoped to modal-wrapped dynamic sheets");
  assert(/if \(openedRef\.current\) return;[\s\S]{0,200}onCloseRef\.current\(\);/.test(primitive), "an unopened sheet is closed");
  assert(/if \(index >= 0\) openedRef\.current = true;/.test(primitive), "an open index disarms it");
});

Deno.test("#4456 the two sheets that froze now open like the menu", async () => {
  for (const path of ["src/components/profile/EditBioSheet.tsx", "src/components/chat/UnsendConfirmSheet.tsx"]) {
    const source = strip(await Deno.readTextFile(new URL(path, appRoot)));
    assert(/scrollMode="scroll"/.test(source), `${path} has a measurable body`);
    assert(/snapPoints=\{[A-Z_]+_SNAP_POINTS/.test(source), `${path} has a snap cap`);
  }
});
