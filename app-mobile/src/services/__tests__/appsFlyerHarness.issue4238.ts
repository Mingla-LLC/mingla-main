// @ts-nocheck — #4238 test helper (not a suite). app-mobile has no jest; this
// loads a REAL app-mobile source module under Deno by rewriting each import
// specifier to a data: URL fake, and serving lazy require()s from the same
// table. Each load gets a fresh module instance (unique URL).
let loadCounter = 0;

const toB64 = (text: string): string => {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
};

/**
 * @param relFromAppMobile e.g. "src/services/appsFlyerService.ts"
 * @param fakes specifier → module namespace object ({ default, ...named })
 */
export async function loadWithFakes(
  relFromAppMobile: string,
  fakes: Record<string, Record<string, unknown>>,
): Promise<Record<string, any>> {
  const root = new URL("../../../", import.meta.url);
  let src = await Deno.readTextFile(new URL(relFromAppMobile, root));
  const id = ++loadCounter;
  const registry = `__AF4238_FAKES_${id}`;
  (globalThis as Record<string, unknown>)[registry] = fakes;
  (globalThis as Record<string, unknown>).__DEV__ = false;
  (globalThis as Record<string, unknown>).require = (spec: string) => {
    const fake = fakes[spec];
    if (!fake) throw new Error(`harness: no fake for require(${spec})`);
    return fake;
  };
  src = src.replace(
    /from\s+(['"])([^'"]+)\1/g,
    (_m, _q, spec: string) => {
      const fake = fakes[spec];
      if (!fake) throw new Error(`harness: no fake for import ${spec}`);
      const names = Object.keys(fake).filter((k) => k !== "default");
      const body = [
        `const m = globalThis[${JSON.stringify(registry)}][${JSON.stringify(spec)}];`,
        `export default m.default;`,
        ...names.map((n) => `export const ${n} = m[${JSON.stringify(n)}];`),
      ].join("\n");
      return `from "data:application/javascript;base64,${toB64(body)}"`;
    },
  );
  return await import(`data:application/typescript;base64,${toB64(`${src}\n// load ${id}\n`)}`);
}

export const flush = async (n = 6): Promise<void> => {
  for (let i = 0; i < n; i += 1) await Promise.resolve();
};
