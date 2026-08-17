/**
 * #2099 — import-graph probes (Amendment 4 §D2/§D6, Amendment 7 §G9).
 *
 * Two closures, walked from the REAL host route `app/venue/[venueId]/index.tsx`:
 *
 *   NATIVE (iOS, Android) — every specifier, static and dynamic, resolved in
 *   Metro's platform order (`.ios|.android` → `.native` → bare). The closure
 *   must contain no correction dialog, no correction service, no correction RPC
 *   name and no correction copy. A `Platform.OS === "web"` render check does not
 *   satisfy this and was rejected by independent testing: the shared module
 *   still statically imported the dialog, so iOS and Android shipped the code
 *   regardless of what rendered.
 *
 *   WEB (SC-4's binding fails-on-revert) — STATIC specifiers only, resolved
 *   `.web` → bare, never traversing a dynamic `import()` edge. The closure must
 *   contain the host page and the `.web` launcher (the vacuity guard, so the
 *   probe can never pass by measuring nothing) and must NOT contain the dialog
 *   or the correction service. Converting the launcher's on-intent `import()`
 *   into a static import puts the dialog inside this closure and reds here —
 *   which is the red SC-4 rests on, because the byte gate is not proven to be
 *   breached by that mutation.
 */

import fs from "node:fs";
import path from "node:path";

const BUSINESS_ROOT = path.resolve(__dirname, "../../../..");
const ENTRY = path.join(BUSINESS_ROOT, "app/venue/[venueId]/index.tsx");
const WEB_LAUNCHER = path.join(
  BUSINESS_ROOT,
  "src/components/venue/PendingVenueIdentityCorrectionLauncher.web.tsx",
);

const EXTENSIONS = ["ts", "tsx", "js", "jsx"] as const;

/** Metro's resolution order for a bare relative specifier on `platform`. */
function candidatesFor(base: string, platform: string): string[] {
  const suffixes =
    platform === "web" ? [".web", ""] : [`.${platform}`, ".native", ""];
  const out: string[] = [];
  for (const suffix of suffixes) {
    for (const ext of EXTENSIONS) out.push(`${base}${suffix}.${ext}`);
  }
  for (const suffix of suffixes) {
    for (const ext of EXTENSIONS) out.push(path.join(base, `index${suffix}.${ext}`));
  }
  return out;
}

function resolveRelative(
  fromFile: string,
  specifier: string,
  platform: string,
): string | null {
  const base = path.resolve(path.dirname(fromFile), specifier);
  for (const candidate of candidatesFor(base, platform)) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

const STATIC_PATTERNS = [
  /\bfrom\s+["']([^"']+)["']/g,
  /\bimport\s+["']([^"']+)["']/g,
  /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
];
const DYNAMIC_PATTERN = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;

function specifiersOf(source: string, includeDynamic: boolean): string[] {
  const out: string[] = [];
  const patterns = includeDynamic
    ? [...STATIC_PATTERNS, DYNAMIC_PATTERN]
    : STATIC_PATTERNS;
  for (const re of patterns) {
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(source)) !== null) out.push(match[1]!);
  }
  return out;
}

function closureFrom(
  entry: string,
  platform: string,
  includeDynamic: boolean,
): Map<string, string> {
  const seen = new Map<string, string>();
  const queue: string[] = [entry];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    const source = fs.readFileSync(file, "utf8");
    seen.set(file, source);
    for (const specifier of specifiersOf(source, includeDynamic)) {
      // First-party relative modules only; the correction code is all
      // first-party, and node_modules cannot reach it.
      if (!specifier.startsWith(".")) continue;
      const resolved = resolveRelative(file, specifier, platform);
      if (resolved !== null && !seen.has(resolved)) queue.push(resolved);
    }
  }
  return seen;
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const FORBIDDEN_IN_NATIVE_GRAPH = [
  "PendingVenueIdentityCorrectionDialog",
  "pendingVenueIdentityCorrectionService",
  "preview_pending_venue_identity_correction",
  "correct_pending_venue_identity",
  "Correct venue identity",
  "Correct pending venue",
  "Couldn't load the correction tool. Retry.",
] as const;

describe.each(["ios", "android"])(
  "#2099 — the correction feature is absent from the %s import graph",
  (platform) => {
    const closure = closureFrom(ENTRY, platform, true);

    it("resolves the host page's launcher import to the no-op native implementation", () => {
      const launcher = resolveRelative(
        ENTRY,
        "../../../src/components/venue/PendingVenueIdentityCorrectionLauncher",
        platform,
      );
      expect(launcher).not.toBeNull();
      expect(path.basename(launcher!)).toBe(
        "PendingVenueIdentityCorrectionLauncher.native.tsx",
      );
      expect(closure.has(launcher!)).toBe(true);
    });

    it("never reaches the web launcher, the web dialog or the web correction service", () => {
      const reached = [...closure.keys()].map((file) => path.basename(file));
      expect(reached).not.toContain("PendingVenueIdentityCorrectionLauncher.web.tsx");
      expect(reached).not.toContain("PendingVenueIdentityCorrectionDialog.web.tsx");
      expect(reached).not.toContain("pendingVenueIdentityCorrectionService.web.ts");
    });

    it("contains no correction module, RPC name or correction copy anywhere in the closure", () => {
      const offenders: string[] = [];
      for (const [file, source] of closure) {
        for (const token of FORBIDDEN_IN_NATIVE_GRAPH) {
          // The native launcher's own header names these tokens to explain WHY
          // they are absent. Comments ship no behaviour, so judge stripped
          // source — the same posture Amendment 6 §F3 takes on remnants.
          if (stripComments(source).includes(token)) {
            offenders.push(`${path.relative(BUSINESS_ROOT, file)} :: ${token}`);
          }
        }
      }
      expect(offenders).toEqual([]);
    });

    it("walked a real graph (guards against a vacuously empty closure)", () => {
      expect(closure.size).toBeGreaterThan(20);
      expect(closure.has(ENTRY)).toBe(true);
    });
  },
);

describe("#2099 SC-4 — the correction dialog is NOT in the static web closure", () => {
  const closure = closureFrom(ENTRY, "web", false);

  it("VACUITY GUARD: the closure really contains the host page and the .web launcher", () => {
    // Without this, an empty or truncated closure would satisfy the absence
    // assertion below by measuring nothing.
    expect(closure.has(ENTRY)).toBe(true);
    expect(closure.has(WEB_LAUNCHER)).toBe(true);
    expect(closure.size).toBeGreaterThan(20);
  });

  it("the dialog and the correction service arrive only through a dynamic import", () => {
    const reached = [...closure.keys()].map((file) => path.basename(file));
    expect(reached).not.toContain("PendingVenueIdentityCorrectionDialog.web.tsx");
    expect(reached).not.toContain("pendingVenueIdentityCorrectionService.web.ts");
  });

  it("the launcher reaches the dialog ONLY through `import(`, never a static edge", () => {
    const source = fs.readFileSync(WEB_LAUNCHER, "utf8");
    const stripped = stripComments(source);
    for (const re of STATIC_PATTERNS) {
      re.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = re.exec(stripped)) !== null) {
        expect(match[1]).not.toContain("PendingVenueIdentityCorrectionDialog");
        expect(match[1]).not.toContain("pendingVenueIdentityCorrectionService");
      }
    }
    expect(stripped).toContain('import("./PendingVenueIdentityCorrectionDialog.web")');
  });
});
