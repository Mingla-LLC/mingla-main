/**
 * #4490 — the venue code ships as TWO owners: a Host venue owner
 * (host/venueHostScreens.ts, reached only through host/venueHostOwner.ts) and
 * a Guest venue owner (guest/venueGuestScreens.ts, reached only through
 * guest/venueGuestOwner.ts). Web export hoists any module two lazy chunks
 * share into the eager `__common` chunk every visitor downloads, so:
 *
 *  1. nothing imports an owner barrel except its one loader;
 *  2. no module an owner exports is also `import()`ed on its own;
 *  3. the guest's public venue page and the Guest owner never reach Host code
 *     (the Till, Close the day, the offer editors, the Host services);
 *  4. the Host preview takes the shared screen from the public venue route's
 *     chunk instead of bundling a second copy;
 *  5. the Till's Tap to pay takes the Terminal flow from the door chunk, and
 *     the native camera route never puts expo-camera in a web chunk.
 *
 * FAILS-ON-REVERT: a static `import { VenueOffersModule }` (or a separate
 * `import("./features/offers/VenueOffersModule")`) in VenueSuiteShell, a
 * Host import (e.g. venueOffersService) added to a guest pane, a value import
 * of PublicVenueScreen in preview.tsx, or `expo-camera` back in check-in/scan.tsx:
 * the matching case goes red. The measured proof is the web export itself
 * (bundle-baseline-movement / orch-1083), which this file cannot run.
 */
import fs from "fs";
import path from "path";

const BIZ = path.join(__dirname, "../../../..");
const PACKAGES = path.join(BIZ, "..", "packages");
const read = (rel: string): string => fs.readFileSync(path.join(BIZ, rel), "utf8");
const strip = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const EXTS = [".web.tsx", ".web.ts", ".tsx", ".ts", ".js", ".cjs"];
function resolveFile(base: string): string | null {
  if (fs.existsSync(base) && fs.statSync(base).isFile()) return base;
  for (const ext of EXTS) if (fs.existsSync(base + ext)) return base + ext;
  for (const ext of EXTS) if (fs.existsSync(path.join(base, `index${ext}`))) return path.join(base, `index${ext}`);
  return null;
}
function resolveSpec(from: string, spec: string): string | null {
  if (spec.startsWith(".")) return resolveFile(path.resolve(path.dirname(from), spec));
  const m = /^@mingla\/([^/]+)\/(.+)$/.exec(spec);
  return m === null ? null : resolveFile(path.join(PACKAGES, m[1], m[2]));
}
/** Value (not `import type`) static imports and re-exports of a file. */
function staticDeps(file: string): string[] {
  const src = strip(fs.readFileSync(file, "utf8"));
  const out: string[] = [];
  const re = /(?:^|\n)\s*(?:import|export)\s+(type\s+)?(?:[^;"'`]*?\sfrom\s+)?["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    if (m[1] !== undefined) continue;
    const r = resolveSpec(file, m[2]);
    if (r !== null) out.push(r);
  }
  return out;
}
/** Everything a file reaches through value imports (what lands in its chunk). */
function reach(rel: string): Set<string> {
  const start = path.join(BIZ, rel);
  const seen = new Set<string>([start]);
  const queue = [start];
  while (queue.length > 0) {
    const file = queue.shift() as string;
    for (const dep of staticDeps(file)) {
      if (!seen.has(dep)) {
        seen.add(dep);
        queue.push(dep);
      }
    }
  }
  return new Set([...seen].map((f) => path.relative(BIZ, f)));
}
function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "__tests__" || e.name === "node_modules" ? [] : sourceFiles(p);
    return /\.(tsx?|js)$/.test(e.name) ? [p] : [];
  });
}

/** Host-only code a guest must never download. */
const HOST_ONLY = [
  /src\/components\/venue\/host\//,
  /src\/components\/venue\/till\/(?!tillErrorCopy|tillGuestPayModel)/,
  /src\/components\/venue\/close\//,
  /src\/components\/venue\/station\//,
  /src\/components\/venue\/features\/offers\/(EntryEditor|HireEditor|PackageEditor|HourEditor|VenueOffersModule)/,
  /src\/components\/venue\/(VenueSuiteShell|VenueOrdersModule|VenueAvailabilityModule)\.tsx$/,
  /src\/services\/(venueOffersService|venueTillService|venueDayCloseService|venueStationService|venueStockService)\.ts$/,
];

describe("#4490 one Host venue owner and one Guest venue owner", () => {
  const all = sourceFiles(path.join(BIZ, "src")).concat(sourceFiles(path.join(BIZ, "app")));

  it("only the loaders import the owner barrels", () => {
    const offenders = all
      .filter((f) => !/venue\/(host|guest)\/venue(Host|Guest)Owner\.ts$/.test(f))
      .filter((f) => /["'][./]*(?:[^"']*\/)?venue(Host|Guest)Screens["']/.test(strip(fs.readFileSync(f, "utf8"))))
      .map((f) => path.relative(BIZ, f));
    expect(offenders).toEqual([]);
    expect(read("src/components/venue/host/venueHostOwner.ts")).toContain('import("./venueHostScreens")');
    expect(read("src/components/venue/guest/venueGuestOwner.ts")).toContain('import("./venueGuestScreens")');
  });

  it("no module an owner exports is also loaded by its own import()", () => {
    const owned = [
      ...strip(read("src/components/venue/host/venueHostScreens.ts")).matchAll(/from "([^"]+)"/g),
      ...strip(read("src/components/venue/guest/venueGuestScreens.ts")).matchAll(/from "([^"]+)"/g),
    ].map((m) => m[1].split("/").pop() as string);
    const offenders: string[] = [];
    for (const f of all) {
      const src = strip(fs.readFileSync(f, "utf8"));
      for (const m of src.matchAll(/import\(\s*"([^"]+)"\s*\)/g)) {
        const name = m[1].split("/").pop() as string;
        if (owned.includes(name)) offenders.push(`${path.relative(BIZ, f)} -> ${m[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the shells reach every #4490 module through the Host owner", () => {
    for (const shell of ["src/components/venue/VenueSuiteShell.tsx", "src/components/stay/StaySuiteShell.tsx"]) {
      const src = read(shell);
      expect(src).toContain("(await loadVenueHostScreens()).VenueOffersModule");
      expect(src).not.toMatch(/import\("[^"]*features\//);
    }
    expect(read("app/venue/[venueId]/index.tsx")).toContain(
      'import { StaySuiteShell, VenueSuiteShell } from "../../../src/components/venue/host/LazyVenueSuites";',
    );
    for (const route of ["till", "close", "till-settings", "station/[station]", "offer/[offerId]"]) {
      const src = strip(read(`app/venue/[venueId]/${route}.tsx`));
      expect(src).toContain("/src/components/venue/host/LazyVenueHostRoutes");
      expect(src).not.toMatch(/components\/venue\/(till|close|station|features)\//);
    }
  });

  it("the public venue page and the Guest owner never reach Host code", () => {
    for (const root of [
      "app/b/[brandSlug]/v/[venueSlug].tsx",
      "src/components/venue/guest/venueGuestScreens.ts",
      "app/b/[brandSlug]/v/[venueSlug]/book/[offerId].tsx",
      "app/visit/[groupId].tsx",
      "app/pay/till/[code].tsx",
    ]) {
      const host = [...reach(root)].filter((f) => HOST_ONLY.some((re) => re.test(f)));
      expect({ root, host }).toEqual({ root, host: [] });
    }
  });

  it("the Host preview takes the shared screen from the public venue route's chunk", () => {
    const preview = strip(read("app/venue/[venueId]/preview.tsx"));
    expect(preview).toContain('(await import("../../b/[brandSlug]/v/[venueSlug]")).PublicVenueScreen');
    expect(preview).not.toMatch(/import\s+\{[^}]*\bPublicVenueScreen\b[^}]*\}\s+from/);
    expect(read("app/b/[brandSlug]/v/[venueSlug].tsx")).toContain("export { PublicVenueScreen };");
  });

  it("Tap to pay and the native camera stay in their own chunks", () => {
    const tap = strip(read("src/components/venue/till/TillTapPanel.tsx"));
    expect(tap).toContain("loadDoorSaleScreens()");
    expect(tap).not.toMatch(/import \{[^}]*TapToPaySaleFlow[^}]*\} from/);
    expect(tap).not.toContain("services/terminal/doorTapEdge");
    expect(strip(read("app/venue/[venueId]/check-in/scan.tsx"))).not.toContain("expo-camera");
    expect(strip(read("src/components/venue/features/checkin/VenueCheckInScanScreen.tsx"))).not.toContain("expo-camera");
  });
});
