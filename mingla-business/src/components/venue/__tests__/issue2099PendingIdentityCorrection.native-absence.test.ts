/**
 * #2099 — Business NATIVE exclusion proof (Amendment 4 §D2/§D6).
 *
 * The independent tester rejected a `Platform.OS === "web"` render check as the
 * native exclusion, because the shared module still statically imported the
 * dialog, `Input`, `Modal` and both RPC owners — so iOS and Android shipped the
 * code regardless of what rendered.
 *
 * This probe therefore walks the REAL import graph the way Metro resolves it
 * for `ios` and `android`: it starts at the shared component, resolves every
 * relative specifier using the platform extension order
 * (`.ios|.android` → `.native` → bare), and follows it transitively. It then
 * asserts the closure contains no correction dialog, no correction service, and
 * no correction RPC name.
 *
 * A source-only assertion cannot detect a static import that re-enters the
 * graph through a sibling; a graph walk can.
 */

import fs from "node:fs";
import path from "node:path";

const BUSINESS_ROOT = path.resolve(__dirname, "../../../..");
const ENTRY = path.join(BUSINESS_ROOT, "src/components/venue/VenueListingContent.tsx");

const EXTENSIONS = ["ts", "tsx", "js", "jsx"] as const;

/** Metro's platform resolution order for a bare relative specifier. */
function candidatesFor(base: string, platform: string): string[] {
  const suffixes = [`.${platform}`, ".native", ""];
  const out: string[] = [];
  for (const suffix of suffixes) {
    for (const ext of EXTENSIONS) out.push(`${base}${suffix}.${ext}`);
  }
  for (const suffix of suffixes) {
    for (const ext of EXTENSIONS) out.push(path.join(base, `index${suffix}.${ext}`));
  }
  return out;
}

function resolveRelative(fromFile: string, specifier: string, platform: string): string | null {
  const base = path.resolve(path.dirname(fromFile), specifier);
  for (const candidate of candidatesFor(base, platform)) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** Every static AND dynamic specifier in a module. */
function specifiersOf(source: string): string[] {
  const out: string[] = [];
  const patterns = [
    /\bfrom\s+["']([^"']+)["']/g,
    /\bimport\s+["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) out.push(m[1]!);
  }
  return out;
}

function nativeClosure(platform: string): Map<string, string> {
  const seen = new Map<string, string>();
  const queue: string[] = [ENTRY];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    const source = fs.readFileSync(file, "utf8");
    seen.set(file, source);
    for (const specifier of specifiersOf(source)) {
      // Only walk first-party relative modules; node_modules is out of scope
      // (the correction code is all first-party).
      if (!specifier.startsWith(".")) continue;
      const resolved = resolveRelative(file, specifier, platform);
      if (resolved !== null && !seen.has(resolved)) queue.push(resolved);
    }
  }
  return seen;
}

const FORBIDDEN_IN_NATIVE_GRAPH = [
  // module identities
  "PendingVenueIdentityCorrectionDialog",
  "pendingVenueIdentityCorrectionService",
  // RPC names
  "preview_pending_venue_identity_correction",
  "correct_pending_venue_identity",
  // correction copy
  "Correct venue identity",
  "Correct pending venue",
  "Couldn't load the correction tool. Retry.",
] as const;

describe.each(["ios", "android"])(
  "#2099 — the correction feature is absent from the %s import graph",
  (platform) => {
    const closure = nativeClosure(platform);

    it("resolves the launcher to the no-op native implementation", () => {
      const launcher = resolveRelative(
        ENTRY,
        "./PendingVenueIdentityCorrectionLauncher",
        platform,
      );
      expect(launcher).not.toBeNull();
      expect(path.basename(launcher!)).toBe(
        "PendingVenueIdentityCorrectionLauncher.native.tsx",
      );
      expect(closure.has(launcher!)).toBe(true);
    });

    it("never reaches the web dialog or the web correction service module", () => {
      const reached = [...closure.keys()].map((f) => path.basename(f));
      expect(reached).not.toContain("PendingVenueIdentityCorrectionDialog.web.tsx");
      expect(reached).not.toContain("PendingVenueIdentityCorrectionLauncher.web.tsx");
      expect(reached).not.toContain("pendingVenueIdentityCorrectionService.web.ts");
    });

    it("contains no correction module, RPC name or correction copy anywhere in the closure", () => {
      const offenders: string[] = [];
      for (const [file, source] of closure) {
        for (const token of FORBIDDEN_IN_NATIVE_GRAPH) {
          // The native launcher's own header comment names these tokens to
          // explain WHY they are absent; comments ship no behaviour, so read
          // the file with comments stripped before judging it.
          if (stripComments(source).includes(token)) {
            offenders.push(`${path.relative(BUSINESS_ROOT, file)} :: ${token}`);
          }
        }
      }
      expect(offenders).toEqual([]);
    });

    it("walked a real graph (guards against a vacuously empty closure)", () => {
      expect(closure.size).toBeGreaterThan(5);
      expect(closure.has(ENTRY)).toBe(true);
    });
  },
);

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}
