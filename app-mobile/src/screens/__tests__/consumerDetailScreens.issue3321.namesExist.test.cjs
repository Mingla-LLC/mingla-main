/**
 * Issue #3321 — the consumer detail screens only read names that exist.
 *
 * #2774 shipped `detail.title` into ConsumerExperienceDetailScreen, a file with
 * no `detail` in scope, and `fnd.name` / `fnd.coverMediaAlt` into
 * ConsumerEventDetailScreen, whose model has neither field. The first threw on
 * every experience open in the live app; the second silently left the event
 * hero unnamed. TypeScript reports both (TS2304 / TS2339 / TS2551), but
 * app-mobile has no typecheck gate and its full `tsc` carries ~2,000 unrelated
 * errors, so nothing read those lines.
 *
 * This is that check, scoped to the three screens #2774 wired, and to exactly
 * the "that name / that property does not exist" diagnostics:
 *
 *   - Only the app's own source and the shared `@mingla/*` packages resolve.
 *     Every npm import is left unresolved (typed `any`), so the result is the
 *     same with or without app-mobile/node_modules — CI runs this step without
 *     installing them.
 *   - It fails closed: a screen that moves, a model that stops resolving, or a
 *     canary that can no longer be planted is a failure, not a silent pass.
 *
 * Runs under app-mobile/jest.issue2774.render.cjs (the #1486 render step).
 */
const path = require("node:path");
const ts = require("typescript");

const REPO = path.resolve(__dirname, "..", "..", "..", "..");
const PACKAGES = path.join(REPO, "packages");
const at = (rel) => path.join(REPO, rel);

const EXPERIENCE = at("app-mobile/src/screens/Experience/ConsumerExperienceDetailScreen.tsx");
const EVENT = at("app-mobile/src/screens/Event/ConsumerEventDetailScreen.tsx");
const TRIP = at("app-mobile/src/screens/Trip/ConsumerTripDetailScreen.tsx");
const SCREENS = [EXPERIENCE, EVENT, TRIP];

// The models these screens read. If they stop resolving, property checks on
// them go quiet, so their presence in the program is asserted.
const MODELS = [
  at("app-mobile/src/hooks/useConsumerEventFoundation.ts"),
  at("app-mobile/src/hooks/useConsumerExperienceDetail.ts"),
  at("app-mobile/src/hooks/useConsumerTripDetail.ts"),
  at("app-mobile/src/types/mergedDiscover.ts"),
];

// Cannot find name (2304, 2552 "did you mean") and property does not exist on
// type (2339, 2551 "did you mean").
const MISSING_NAME_CODES = new Set([2304, 2552, 2339, 2551]);

// Mirrors the parts of app-mobile's tsconfig (expo base) that decide these
// diagnostics: strict, DOM + ESNext globals, React Native JSX.
const OPTIONS = {
  noEmit: true,
  strict: true,
  esModuleInterop: true,
  jsx: ts.JsxEmit.ReactNative,
  lib: ["lib.dom.d.ts", "lib.esnext.d.ts"],
  module: ts.ModuleKind.Preserve,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  resolveJsonModule: true,
  skipLibCheck: true,
  target: ts.ScriptTarget.ESNext,
  types: [],
};

const SOURCE_EXTENSIONS = [
  [".ts", ts.Extension.Ts],
  [".tsx", ts.Extension.Tsx],
  [".d.ts", ts.Extension.Dts],
  ["/index.ts", ts.Extension.Ts],
  ["/index.tsx", ts.Extension.Tsx],
];

const resolveSourceOnly = (specifier, containingFile) => {
  let base;
  if (specifier.startsWith(".")) {
    base = path.resolve(path.dirname(containingFile), specifier);
  } else if (specifier.startsWith("@mingla/")) {
    base = path.join(PACKAGES, specifier.slice("@mingla/".length));
  } else {
    return undefined;
  }
  if (base.split(path.sep).includes("node_modules")) return undefined;
  for (const [suffix, extension] of SOURCE_EXTENSIONS) {
    const candidate = base + suffix;
    if (ts.sys.fileExists(candidate)) {
      return { resolvedFileName: candidate, extension, isExternalLibraryImport: false };
    }
  }
  return undefined;
};

/** @param {Record<string, string>} overrides in-memory file text by path */
const inspect = (overrides = {}) => {
  const host = ts.createCompilerHost(OPTIONS);
  const readSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreate) =>
    Object.prototype.hasOwnProperty.call(overrides, fileName)
      ? ts.createSourceFile(fileName, overrides[fileName], languageVersion, true)
      : readSourceFile(fileName, languageVersion, onError, shouldCreate);
  host.resolveModuleNameLiterals = (literals, containingFile) =>
    literals.map((literal) => ({
      resolvedModule: resolveSourceOnly(literal.text, containingFile),
    }));

  const program = ts.createProgram(SCREENS, OPTIONS, host);
  const findings = [];
  for (const screen of SCREENS) {
    const sourceFile = program.getSourceFile(screen);
    if (sourceFile === undefined) {
      findings.push(`${path.relative(REPO, screen)}: not in the program`);
      continue;
    }
    for (const diagnostic of program.getSemanticDiagnostics(sourceFile)) {
      if (!MISSING_NAME_CODES.has(diagnostic.code)) continue;
      const { line, character } = sourceFile.getLineAndCharacterOfPosition(
        diagnostic.start ?? 0,
      );
      findings.push(
        `${path.relative(REPO, screen)}:${line + 1}:${character + 1} TS${diagnostic.code} ` +
          ts.flattenDiagnosticMessageText(diagnostic.messageText, " "),
      );
    }
  }
  return { program, findings };
};

const plant = (file, from, to) => {
  const text = ts.sys.readFile(file);
  if (typeof text !== "string" || !text.includes(from)) {
    throw new Error(
      `canary anchor "${from}" is gone from ${path.relative(REPO, file)} — ` +
        "move the canary to the line that now builds the hero label",
    );
  }
  return { [file]: text.replace(from, to) };
};

jest.setTimeout(120_000);

describe("#3321 consumer detail screens read only names that exist", () => {
  let live;
  beforeAll(() => {
    live = inspect();
  });

  it("loads all three screens and the models they read", () => {
    const loaded = new Set(
      live.program.getSourceFiles().map((sourceFile) => path.resolve(sourceFile.fileName)),
    );
    for (const file of [...SCREENS, ...MODELS]) {
      expect({ file: path.relative(REPO, file), loaded: loaded.has(file) }).toEqual({
        file: path.relative(REPO, file),
        loaded: true,
      });
    }
  });

  it("finds no undeclared name and no missing property in any of them", () => {
    expect(live.findings).toEqual([]);
  });

  it("canary: an undeclared `detail` in the experience hero label is caught", () => {
    const { findings } = inspect(
      plant(EXPERIENCE, "subject: heroSubject,", "subject: detail.title,"),
    );
    expect(findings).toEqual([
      expect.stringMatching(
        /ConsumerExperienceDetailScreen\.tsx:\d+:\d+ TS2304 Cannot find name 'detail'\./,
      ),
    ]);
  });

  it("canary: a field the event foundation model does not have is caught", () => {
    const { findings } = inspect(
      plant(EVENT, "subject: fnd.title,", "subject: fnd.name,"),
    );
    expect(findings).toEqual([
      expect.stringMatching(
        /ConsumerEventDetailScreen\.tsx:\d+:\d+ TS2339 Property 'name' does not exist on type 'ConsumerEventFoundationModel'\./,
      ),
    ]);
  });
});
