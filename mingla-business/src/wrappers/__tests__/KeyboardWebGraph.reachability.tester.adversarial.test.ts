/**
 * #1627 [keyboard-guard-vacuity] — TESTER adversarial regression.
 *
 * Attacks a DIFFERENT ANGLE from the implementor's TA-1 in
 * `KeyboardRoot.adversarial.test.tsx`, which this file deliberately does not
 * duplicate.
 *
 *   TA-1 asks: "does any file in a LIST OF DIRECTORIES contain the substring
 *              `from "react-native-keyboard-controller"`?"
 *   This asks: "starting from the REAL WEB ENTRY POINTS and following every
 *              import edge with WEB platform resolution order, is the library
 *              REACHABLE — by any import form a bundler honours?"
 *
 * Three concrete gaps that the flat-scan shape cannot see, and this walk can:
 *
 *  1. IMPORT FORM. TA-1's detector is a single `from ["']…["']` regex. Metro
 *     bundles a module for four other spellings that regex never matches:
 *         require("react-native-keyboard-controller")
 *         await import("react-native-keyboard-controller")
 *         import "react-native-keyboard-controller"          (side-effect only)
 *         export * from "react-native-keyboard-controller"   (matched, but only
 *                                                             because `from` is
 *                                                             incidentally present)
 *     Each of those puts the whole 12-primitive barrel back into `__common`.
 *     This suite proves the detector here flags all five forms (§FORMS).
 *
 *  2. PLATFORM-SHADOWED FILES ARE SKIPPED, NOT FOLLOWED. TA-1 excludes every
 *     `X.native.*` and every `X.tsx` that has an `X.web.tsx` sibling — correct
 *     for a flat census, but it means a web-reachable file that imports a
 *     `.native` module BY EXPLICIT PATH
 *         import { KeyboardAvoidingView } from "../../wrappers/SmartKeyboardAvoidingView.native";
 *     is invisible: the importer carries no library specifier, and the file that
 *     does is filtered out of the scan. Metro honours the explicit path and
 *     bundles the library. A reachability walk FOLLOWS that edge instead of
 *     skipping the node, so it sees the leak (§FORMS, `explicit-native-path`).
 *
 *  3. RESOLUTION ORDER IS ASSERTED, NOT ASSUMED. The whole #1627 fix rests on
 *     Metro picking `keyboardPrimitives.web.tsx` over `keyboardPrimitives.tsx`
 *     on web, and `SmartKeyboardAvoidingView.tsx` over `.native.tsx`. TA-1
 *     encodes that as a FILENAME HEURISTIC in `isShadowedOnWeb` and then trusts
 *     it. Here the walk actually performs web resolution and the waypoint
 *     assertions require that the `.web` half was the one reached and the native
 *     half was NOT — so if the convention is ever inverted, this goes red.
 *
 * DESIGN CONSTRAINTS this file honours, all of them lessons from #1627 itself:
 *
 *  - NO RE-DECLARED SPECIFIER. `I-PROPOSED-1841-A` exists because three
 *    hand-copied regexes drifted (68 hits vs 8 on the same chunk). The library
 *    name here is READ FROM `mingla-business/package.json` dependencies, and the
 *    suite fails if it is not a declared dependency. There is no fourth copy of
 *    the string to drift, and renaming the package cannot silently green this.
 *
 *  - NO GITIGNORED-ARTEFACT BRANCH. This suite reads source only. It has no
 *    `dist/`, no `expo export`, no prerequisite that can be absent, and — pinned
 *    by an assertion on its own text in §NO-SKIP — no early `return` that could
 *    turn it into the very vacuity #1627 exists to remove.
 *
 *  - EMPTY SCAN IS A FAILURE, NEVER A PASS (§VACUITY). A walk that resolves
 *    nothing would report "library unreachable" and pass. Three independent
 *    guards stop that: a visited-module floor, per-entry-point resolution, and
 *    named waypoints on BOTH sides of the workspace-package boundary.
 *
 *  - ZERO WORKING-TREE MUTATION. #1627's own `TA-1-MUTATION` planted a real
 *    library import at `packages/phone-input/__ta1MutationProbe.<pid>.tsx` while
 *    `TA-V3-6` walked the same tree from another jest worker, and CI went red
 *    (PR #1889). Its fix moves the leak probe outside the repo. This suite goes
 *    further and writes NOTHING, anywhere, ever: falsification runs against an
 *    INJECTED IN-MEMORY FILE MAP (§FORMS). A test that never touches the shared
 *    working tree cannot race a concurrent walker by construction — no temp
 *    directory, no hazard guard, nothing to reintroduce.
 *
 * Invariant: I-PROPOSED-1627-NO-NATIVE-KEYBOARD-LIBRARY-IN-THE-WEB-GRAPH.
 */

import fs from "node:fs";
import path from "node:path";

const businessRoot = path.resolve(__dirname, "..", "..", "..");
const repoRoot = path.resolve(businessRoot, "..");

// ---------------------------------------------------------------------------
// The specifier under test — DERIVED, never re-declared.
// ---------------------------------------------------------------------------

/**
 * Read the library name out of the app's own dependency manifest rather than
 * hard-coding a fourth copy of it. `I-PROPOSED-1841-A` was pre-staged because
 * three hand-copied keyboard regexes had already drifted apart; a constant that
 * is DERIVED cannot drift, and if the package is ever renamed this suite says
 * so out loud instead of quietly matching nothing.
 */
function readLibrarySpecifier(): string {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(businessRoot, "package.json"), "utf8"),
  ) as { dependencies?: Record<string, string> };
  const deps = manifest.dependencies ?? {};
  const found = Object.keys(deps).filter((name) =>
    /keyboard-controller$/.test(name),
  );
  if (found.length !== 1) {
    throw new Error(
      `[REACH-SETUP FAIL] expected exactly ONE *keyboard-controller dependency in ` +
        `mingla-business/package.json, found ${found.length}: ${JSON.stringify(found)}.\n` +
        `This suite derives the specifier instead of re-declaring it. If the package ` +
        `was renamed or removed, update nothing here — the derivation is the point; ` +
        `confirm the rename is intended and the wrapper pair still hides it from web.`,
    );
  }
  return found[0];
}

const LIBRARY = readLibrarySpecifier();

// ---------------------------------------------------------------------------
// Import-form detection. Deliberately broader than TA-1's single `from` regex.
// ---------------------------------------------------------------------------

/** Strip line and block comments without eating string contents. */
function stripComments(source: string): string {
  let out = "";
  let index = 0;
  let mode: "code" | "line" | "block" | "string" = "code";
  let quote = "";
  while (index < source.length) {
    const c = source[index];
    const d = source[index + 1];
    if (mode === "code") {
      if (c === "/" && d === "/") {
        mode = "line";
        index += 2;
        continue;
      }
      if (c === "/" && d === "*") {
        mode = "block";
        index += 2;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") {
        mode = "string";
        quote = c;
        out += c;
        index += 1;
        continue;
      }
      out += c;
      index += 1;
      continue;
    }
    if (mode === "line") {
      if (c === "\n") {
        mode = "code";
        out += c;
      }
      index += 1;
      continue;
    }
    if (mode === "block") {
      if (c === "*" && d === "/") {
        mode = "code";
        index += 2;
        continue;
      }
      index += 1;
      continue;
    }
    if (c === "\\") {
      out += c + (d ?? "");
      index += 2;
      continue;
    }
    out += c;
    if (c === quote) mode = "code";
    index += 1;
  }
  return out;
}

/**
 * Every spelling Metro treats as a module edge. `import … from` and
 * `export … from` are the two TA-1's regex can see; the other three are the
 * gap this suite exists to cover.
 */
const IMPORT_FORMS: readonly { form: string; pattern: RegExp }[] = [
  { form: "import-from", pattern: /\bimport\b[^;]*?\bfrom\s*["']([^"']+)["']/g },
  { form: "export-from", pattern: /\bexport\b[^;]*?\bfrom\s*["']([^"']+)["']/g },
  { form: "bare-import", pattern: /\bimport\s*["']([^"']+)["']/g },
  { form: "require", pattern: /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g },
  { form: "dynamic-import", pattern: /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g },
];

/** Specifier -> the first form it was seen in. */
function moduleEdges(source: string): Map<string, string> {
  const code = stripComments(source);
  const edges = new Map<string, string>();
  for (const { form, pattern } of IMPORT_FORMS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(code)) !== null) {
      if (!edges.has(match[1])) edges.set(match[1], form);
    }
  }
  return edges;
}

// ---------------------------------------------------------------------------
// WEB resolution. `.web.*` wins; a bare `X` prefers `X.web.tsx` over `X.tsx`.
// ---------------------------------------------------------------------------

const WEB_EXTENSION_ORDER = [
  ".web.tsx",
  ".web.ts",
  ".web.jsx",
  ".web.js",
  ".tsx",
  ".ts",
  ".jsx",
  ".js",
];

type FileSystemView = {
  exists: (absolutePath: string) => boolean;
  isDirectory: (absolutePath: string) => boolean;
  read: (absolutePath: string) => Promise<string>;
};

const realFs: FileSystemView = {
  exists: (p) => fs.existsSync(p),
  isDirectory: (p) => fs.existsSync(p) && fs.statSync(p).isDirectory(),
  read: (p) => fs.promises.readFile(p, "utf8"),
};

function resolveWithExtensions(
  base: string,
  view: FileSystemView,
): string | null {
  for (const extension of WEB_EXTENSION_ORDER) {
    const candidate = base + extension;
    if (view.exists(candidate) && !view.isDirectory(candidate)) return candidate;
  }
  if (view.isDirectory(base)) {
    for (const extension of WEB_EXTENSION_ORDER) {
      const candidate = path.join(base, "index" + extension);
      if (view.exists(candidate)) return candidate;
    }
  }
  if (view.exists(base) && !view.isDirectory(base)) return base;
  return null;
}

/**
 * The workspace aliases, read from the app's own tsconfig rather than restated.
 * `@mingla/phone-input` -> `../packages/phone-input` is the edge that carried
 * the largest single contributor to the leak, and it is the edge every previous
 * census stopped at.
 */
function readTsconfigPaths(): Record<string, string[]> {
  const raw = fs.readFileSync(path.join(businessRoot, "tsconfig.json"), "utf8");
  const withoutLineComments = raw.replace(/^\s*\/\/.*$/gm, "");
  const config = JSON.parse(withoutLineComments) as {
    compilerOptions?: { paths?: Record<string, string[]> };
  };
  return config.compilerOptions?.paths ?? {};
}

const TSCONFIG_PATHS = readTsconfigPaths();

function resolveWeb(
  fromFile: string,
  specifier: string,
  view: FileSystemView,
): string | null {
  if (specifier.startsWith(".")) {
    return resolveWithExtensions(
      path.resolve(path.dirname(fromFile), specifier),
      view,
    );
  }
  for (const [pattern, targets] of Object.entries(TSCONFIG_PATHS)) {
    const target = targets[0];
    if (pattern.endsWith("/*")) {
      const prefix = pattern.slice(0, -1);
      if (!specifier.startsWith(prefix)) continue;
      const base = path.resolve(
        businessRoot,
        target.slice(0, -1) + specifier.slice(prefix.length),
      );
      if (base.includes("node_modules")) return null;
      const resolved = resolveWithExtensions(base, view);
      if (resolved !== null) return resolved;
      continue;
    }
    if (specifier !== pattern) continue;
    const base = path.resolve(businessRoot, target);
    if (base.includes("node_modules")) return null;
    const packageManifest = path.join(base, "package.json");
    if (view.exists(packageManifest) && fs.existsSync(packageManifest)) {
      const main = (
        (JSON.parse(fs.readFileSync(packageManifest, "utf8")) as { main?: string })
          .main ?? "index"
      ).replace(/\.(tsx?|jsx?)$/, "");
      const resolved = resolveWithExtensions(path.join(base, main), view);
      if (resolved !== null) return resolved;
    }
    const resolved =
      resolveWithExtensions(base, view) ??
      resolveWithExtensions(path.join(base, "index"), view);
    if (resolved !== null) return resolved;
  }
  return null; // node_modules / unknown — a terminal node, not an error.
}

// ---------------------------------------------------------------------------
// The entry points. Every one is a route or component a GUEST can reach.
// ---------------------------------------------------------------------------

/**
 * The three buyer-checkout routes plus the two public surfaces that mount
 * `PhoneInput`, plus the two `mingla-business` screens whose import line #1627
 * moved. These are the actual reasons the library was in `__common`: not "some
 * file under mingla-business", but "these pages, on the money path".
 */
const WEB_ENTRY_POINTS = [
  "mingla-business/app/checkout/[eventId]/buyer.tsx",
  "mingla-business/app/checkout-trip/[tripEventId]/buyer.tsx",
  "mingla-business/app/checkout-experience/[experienceEventId]/buyer.tsx",
  "mingla-business/src/components/event/PublicEventPage.tsx",
  "mingla-business/src/components/venue/GuestVenueReservation.tsx",
  "mingla-business/src/components/brand/BrandPaystackOnboardView.tsx",
  "mingla-business/src/components/groupChat/GroupChatPanel.tsx",
];

/**
 * Modules the walk MUST have resolved for its "unreachable" verdict to mean
 * anything. Two of the four are the `.web` halves of the platform split — if
 * resolution ever picks the native sibling instead, the fix is silently undone
 * and these go missing. The other two prove the walk crossed the
 * workspace-package boundary that `orch-0892`, `orch-1296` and the first draft
 * of TA-V3-6 all stopped at.
 */
const REQUIRED_WAYPOINTS = [
  "packages/phone-input/PhoneInput.tsx",
  "packages/phone-input/CountryPickerModal.tsx",
  "packages/phone-input/keyboardPrimitives.web.tsx",
  "mingla-business/src/wrappers/SmartKeyboardAvoidingView.tsx",
];

/**
 * The NATIVE halves. Reaching either of these from a web entry point means web
 * resolution picked the wrong file and the library is back in the bundle, even
 * though no source file's text changed.
 */
const FORBIDDEN_WAYPOINTS = [
  "packages/phone-input/keyboardPrimitives.tsx",
  "mingla-business/src/wrappers/SmartKeyboardAvoidingView.native.tsx",
];

/**
 * Measured 259 on the fixed tree at HEAD 5c5d373c4. 150 is ~42% under that:
 * loose enough for ordinary refactors, tight enough that losing the
 * `@mingla/*` alias resolution (which alone contributes the whole phone-input
 * subgraph) collapses it well below the floor.
 */
const VISITED_FLOOR = 150;

const relative = (absolutePath: string): string =>
  path.relative(repoRoot, absolutePath).split(path.sep).join("/");

type WalkResult = {
  visited: Map<string, string | null>;
  hits: Array<{ file: string; specifier: string; form: string }>;
  unresolvedEntries: string[];
};

async function walkWebGraph(
  entryPoints: string[] = WEB_ENTRY_POINTS,
  view: FileSystemView = realFs,
  rootForRelative: string = repoRoot,
): Promise<WalkResult> {
  const visited = new Map<string, string | null>();
  const queue: string[] = [];
  const hits: WalkResult["hits"] = [];
  const unresolvedEntries: string[] = [];

  for (const entry of entryPoints) {
    const absolute = path.join(rootForRelative, entry);
    if (!view.exists(absolute)) {
      unresolvedEntries.push(entry);
      continue;
    }
    visited.set(absolute, null);
    queue.push(absolute);
  }

  while (queue.length > 0) {
    const current = queue.shift() as string;
    let source: string;
    try {
      source = await view.read(current);
    } catch {
      continue;
    }
    for (const [specifier, form] of moduleEdges(source)) {
      if (specifier === LIBRARY || specifier.startsWith(`${LIBRARY}/`)) {
        hits.push({ file: current, specifier, form });
        continue;
      }
      const next = resolveWeb(current, specifier, view);
      if (next !== null && !visited.has(next)) {
        visited.set(next, current);
        queue.push(next);
      }
    }
  }

  return { visited, hits, unresolvedEntries };
}

function importChain(
  visited: Map<string, string | null>,
  leaf: string,
): string[] {
  const chain: string[] = [];
  let cursor: string | null = leaf;
  while (cursor != null) {
    chain.push(relative(cursor));
    cursor = visited.get(cursor) ?? null;
  }
  return chain.reverse();
}

describe("#1627 tester adversarial — the native keyboard library is UNREACHABLE from the web graph", () => {
  // -- REACH: the assertion this suite exists for --------------------------
  it("REACH: no web entry point can reach react-native-keyboard-controller by any import form", async () => {
    const { visited, hits, unresolvedEntries } = await walkWebGraph();

    // Stated on stdout so a human reading a GREEN log can see the walk had
    // something to walk. SC-9's standard, applied to this suite.
    // eslint-disable-next-line no-console
    console.log(
      `[REACH] walked ${visited.size} web-resolved modules from ` +
        `${WEB_ENTRY_POINTS.length} entry points — ${hits.length} edge(s) to ${LIBRARY}.`,
    );

    expect(unresolvedEntries).toEqual([]);

    if (hits.length > 0) {
      const detail = hits
        .map(
          (hit) =>
            `  - ${relative(hit.file)}  [${hit.form}]\n` +
            `      chain: ${importChain(visited, hit.file).join(" -> ")}`,
        )
        .join("\n");
      throw new Error(
        `[REACH FAIL] ${hits.length} web-reachable module(s) pull in ${LIBRARY}:\n` +
          `${detail}\n\n` +
          `This is reachability, not a text census: the chain above is the actual\n` +
          `import path Metro follows on web, so every file named on it ships the\n` +
          `library's whole 12-primitive barrel in __common, the eager chunk every\n` +
          `guest downloads before ANY route renders.\n\n` +
          `Fix: route the import through the platform-resolved wrapper for the\n` +
          `package you are in — mingla-business/src/wrappers/SmartKeyboardAvoidingView\n` +
          `(X.tsx web + X.native.tsx native) or packages/phone-input/keyboardPrimitives\n` +
          `(X.tsx native + X.web.tsx web). Do NOT delete the rendered element: the\n` +
          `native lift is load-bearing (#1834 SC-1, measured on glass).\n`,
      );
    }
    expect(hits).toEqual([]);
  });

  // -- VACUITY: an empty scan must FAIL, never pass ------------------------
  it("VACUITY: the walk resolves a real graph — empty or truncated is a FAILURE, not a pass", async () => {
    const { visited } = await walkWebGraph();
    const visitedRelative = new Set([...visited.keys()].map(relative));

    expect(visited.size).toBeGreaterThanOrEqual(VISITED_FLOOR);

    const missing = REQUIRED_WAYPOINTS.filter((w) => !visitedRelative.has(w));
    if (missing.length > 0) {
      throw new Error(
        `[VACUITY FAIL] the walk never reached ${missing.length} required waypoint(s):\n` +
          missing.map((w) => `  - ${w}`).join("\n") +
          `\n\n` +
          `Its "library unreachable" verdict is therefore about a smaller graph than\n` +
          `it claims. The two packages/ waypoints prove the walk crosses the\n` +
          `workspace-package boundary that orch-0892, orch-1296 and TA-V3-6's first\n` +
          `draft all stopped at — the exact blind spot that hid 60,543 B for months.\n` +
          `keyboardPrimitives.web.tsx additionally proves WEB resolution ran: if the\n` +
          `native sibling were being picked, this entry would be absent and the leak\n` +
          `would be back with no source file having changed.\n`,
      );
    }
    expect(missing).toEqual([]);

    // The negative half: web resolution must NOT have landed on a native file.
    const wronglyReached = FORBIDDEN_WAYPOINTS.filter((w) =>
      visitedRelative.has(w),
    );
    expect(wronglyReached).toEqual([]);
  });

  // -- FORMS: the detector bites on every spelling, with ZERO tree writes ---
  //
  // Falsification against an INJECTED in-memory filesystem. Nothing is written
  // to the working tree, so a concurrent jest worker walking the same tree
  // cannot observe a planted leak. That is the defect this branch shipped and
  // had to fix in `TA-1-MUTATION` (PR #1889); the shape below cannot have it.
  const FORM_FIXTURES: readonly { label: string; body: string }[] = [
    { label: "import-from", body: `import { KeyboardProvider } from "${LIBRARY}";` },
    { label: "export-from", body: `export * from "${LIBRARY}";` },
    { label: "bare-import", body: `import "${LIBRARY}";` },
    { label: "require", body: `const kc = require("${LIBRARY}");` },
    {
      label: "dynamic-import",
      body: `export async function load() { return import("${LIBRARY}"); }`,
    },
  ];

  it.each(FORM_FIXTURES.map((f) => [f.label, f.body]))(
    "FORMS: a %s edge to the library is DETECTED (in-memory, nothing written to the tree)",
    async (label, body) => {
      const fakeRoot = path.join(path.sep, "virtual", "1627");
      const entry = path.join(fakeRoot, "entry.tsx");
      const files = new Map<string, string>([
        [entry, `import "./leaf";\n`],
        [path.join(fakeRoot, "leaf.tsx"), `${body}\n`],
      ]);
      const view: FileSystemView = {
        exists: (p) => files.has(p),
        isDirectory: () => false,
        read: async (p) => files.get(p) as string,
      };

      const { hits, visited } = await walkWebGraph(["entry.tsx"], view, fakeRoot);

      expect(visited.size).toBe(2); // the walk actually followed the edge
      expect(hits.map((h) => h.form)).toContain(label);
      expect(hits).toHaveLength(1);
    },
  );

  it("FORMS: an EXPLICIT .native path is followed, not skipped — TA-1's shadow filter drops this node", async () => {
    // The evasion: a web-reachable file names the native module by explicit
    // path. Its own text contains no library specifier, and the file that does
    // is excluded from TA-1's census as `.native.*`. Metro honours the path and
    // bundles the library anyway. A reachability walk follows the edge.
    const fakeRoot = path.join(path.sep, "virtual", "1627-native");
    const files = new Map<string, string>([
      [
        path.join(fakeRoot, "entry.tsx"),
        `import { KeyboardAvoidingView } from "./Wrapper.native";\n`,
      ],
      [
        path.join(fakeRoot, "Wrapper.native.tsx"),
        `export { KeyboardAvoidingView } from "${LIBRARY}";\n`,
      ],
      [path.join(fakeRoot, "Wrapper.tsx"), `export const KeyboardAvoidingView = null;\n`],
    ]);
    const view: FileSystemView = {
      exists: (p) => files.has(p),
      isDirectory: () => false,
      read: async (p) => files.get(p) as string,
    };

    const { hits, visited } = await walkWebGraph(["entry.tsx"], view, fakeRoot);

    expect(visited.size).toBe(2);
    expect(hits).toHaveLength(1);
    expect(hits[0].form).toBe("export-from");
  });

  it("FORMS: a library edge behind a COMMENT is not a leak, and one inside a string literal survives stripping", async () => {
    const fakeRoot = path.join(path.sep, "virtual", "1627-comment");
    const files = new Map<string, string>([
      [
        path.join(fakeRoot, "entry.tsx"),
        `// import { KeyboardProvider } from "${LIBRARY}";\n` +
          `/* require("${LIBRARY}") */\n` +
          `export const doc = "see ${LIBRARY} docs";\n`,
      ],
    ]);
    const view: FileSystemView = {
      exists: (p) => files.has(p),
      isDirectory: () => false,
      read: async (p) => files.get(p) as string,
    };

    const { hits } = await walkWebGraph(["entry.tsx"], view, fakeRoot);
    // Prose mentions are not edges — an unfixable red is as useless as a
    // permanent green — but the stripper must not be blind for the WRONG
    // reason, so the string literal is asserted to survive.
    expect(hits).toEqual([]);
    expect(stripComments(files.get(path.join(fakeRoot, "entry.tsx")) as string)).toContain(
      `"see ${LIBRARY} docs"`,
    );
  });

  // -- NO-SKIP: this suite may never acquire the bug it was written to catch -
  it("NO-SKIP: this suite has no build-artefact prerequisite and no early-return skip branch", () => {
    const own = stripComments(fs.readFileSync(__filename, "utf8"));

    // The needles are ASSEMBLED rather than written out, so that stating them
    // here does not make this assertion match itself. A self-matching guard is
    // its own species of unfalsifiable — it goes red on a clean tree, gets
    // "fixed" by deletion, and the class it protected is unguarded again.
    const exportOutputNeedle = ["_expo", "static", "js", "web"].join("/");
    const gitignoredBuildDirNeedle = new RegExp(`\\b${"di" + "st"}\\b\\s*/`);

    // The original TA-1 read a gitignored `mingla-business/<build dir>/` and
    // returned early when it was absent — which it was on every CI run for its
    // whole life. Nothing in this file may reintroduce that shape.
    expect(own).not.toMatch(/existsSync\([^)]*\)\s*\)?\s*(\{[^}]*)?\breturn\b/);
    expect(own).not.toContain(exportOutputNeedle);
    expect(own).not.toMatch(gitignoredBuildDirNeedle);

    // And it must be reading real source, not an artefact that CI does not build.
    expect(fs.existsSync(path.join(repoRoot, WEB_ENTRY_POINTS[0]))).toBe(true);
  });

  // -- SHIM-RUNTIME: EXECUTE the shipped web shims, don't grep them ---------
  //
  // The implementor's TA-1-WEB-SHIM-FLEX pins the `flex: 1` by matching the
  // shim's SOURCE against /<View\s+style=\{styles\.container\}>\{children\}<\/View>/.
  // That is a source-text pin: it goes green for any file whose text happens to
  // contain that shape and red for a semantically identical refactor (renaming
  // `styles` to `s`, hoisting the style, spreading props). It cannot answer the
  // question that actually matters on the buyer checkout path — "what does this
  // component RETURN?" — which is the only thing the browser sees.
  //
  // These cases call the shipped components and assert on the returned React
  // element. `flex: 1` is read back through StyleSheet.flatten, so a registered
  // style, an inline object and a composed array all satisfy it, and a Fragment
  // or a null return cannot.
  describe("SHIM-RUNTIME: the web shims are executed, and their returned elements are asserted", () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { StyleSheet, View } = require("react-native");
    // Required by EXPLICIT `.web` path: node/jest resolution would otherwise
    // pick `keyboardPrimitives.tsx`, the NATIVE half, and this file must assert
    // on the variant the browser actually gets.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const webPrimitives = require("../../../../packages/phone-input/keyboardPrimitives.web");
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const webKav = require("../SmartKeyboardAvoidingView");

    it("KeyboardProvider returns a real View carrying flex:1 — not a Fragment, not null", () => {
      const element = webPrimitives.KeyboardProvider({ children: "CHILD" });

      expect(element).not.toBeNull();
      expect(element.type).toBe(View);
      expect(StyleSheet.flatten(element.props.style)).toMatchObject({ flex: 1 });
      expect(element.props.children).toBe("CHILD");
    });

    it("KeyboardToolbar renders nothing on web — the bar belongs to a keyboard that never appears", () => {
      expect(webPrimitives.KeyboardToolbar({ showArrows: false })).toBeNull();
    });

    it("SmartKeyboardAvoidingView (web) returns a View, forwards style and children, and swallows the native-only props", () => {
      const style = { flex: 1, backgroundColor: "#000" };
      const element = webKav.KeyboardAvoidingView({
        children: "COMPOSER",
        style,
        behavior: "padding",
        keyboardVerticalOffset: 53,
      });

      expect(element).not.toBeNull();
      expect(element.type).toBe(View);
      expect(StyleSheet.flatten(element.props.style)).toMatchObject(style);
      expect(element.props.children).toBe("COMPOSER");
      // `behavior` / `keyboardVerticalOffset` are native-only. Forwarding them
      // to a DOM node is a React unknown-prop warning on every keystroke.
      expect(element.props).not.toHaveProperty("behavior");
      expect(element.props).not.toHaveProperty("keyboardVerticalOffset");
    });

    it("the web shims are library-free at RUNTIME: their module records resolve without the native package", () => {
      // If either web variant still pulled the library in, requiring it here
      // would have loaded `react-native-keyboard-controller` into this jest
      // module registry. Assert it is absent from the resolved cache.
      const loaded = Object.keys(require.cache ?? {});
      expect(loaded.filter((k) => k.includes(LIBRARY))).toEqual([]);
    });
  });
});
