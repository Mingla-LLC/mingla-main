/**
 * #4490 W5 fix 2 (W5-D1) — the Explorer app's own source reads no undeclared
 * name.
 *
 * W5 called `expandVenueProps(...)` three times in SwipeableCards.tsx without
 * importing it. TypeScript reports that (TS2304), but app-mobile has no
 * typecheck gate and its full `tsc` carries thousands of unrelated errors, so
 * nothing read the line, and every deck card's Details, card tap, right-swipe
 * save and shared-deck advance threw on the device.
 *
 * This is the #3321 scoped check (consumerDetailScreens.issue3321.namesExist),
 * widened to every product file of the app (src/ and app/, tests excluded) and
 * every shared `@mingla/*` package file they import, and narrowed to the
 * "that name does not exist" diagnostics (TS2304 / TS2552). Every npm import is
 * left unresolved (typed `any`), so the result is the same with or without
 * app-mobile/node_modules. `__DEV__` is React Native's global and is declared.
 *
 * Fails closed: an empty file list, a missing SwipeableCards, or a canary that
 * cannot be planted is a failure.
 *
 * Runs under app-mobile/jest.issue2774.render.cjs (the #1486 render step).
 */
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const APP = path.resolve(__dirname, "..", "..", "..");
const REPO = path.resolve(APP, "..");
const PACKAGES = path.join(REPO, "packages");
const SWIPEABLE = path.join(APP, "src", "components", "SwipeableCards.tsx");
const AMBIENT = path.join(APP, "__issue_4490_ambient__.d.ts");
const AMBIENT_TEXT = "declare const __DEV__: boolean;\n";

const MISSING_NAME_CODES = new Set([2304, 2552]);

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

const isTestOrDeclaration = (file) =>
  file.split(path.sep).includes("__tests__") ||
  /\.test\.[cm]?[jt]sx?$/.test(file) ||
  file.endsWith(".d.ts");

const listProductFiles = () => {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name) && !isTestOrDeclaration(full)) out.push(full);
    }
  };
  walk(path.join(APP, "src"));
  walk(path.join(APP, "app"));
  return out.sort();
};

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
const inspect = (files, overrides = {}) => {
  const host = ts.createCompilerHost(OPTIONS);
  const readSourceFile = host.getSourceFile.bind(host);
  const texts = { [AMBIENT]: AMBIENT_TEXT, ...overrides };
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreate) =>
    Object.prototype.hasOwnProperty.call(texts, fileName)
      ? ts.createSourceFile(fileName, texts[fileName], languageVersion, true)
      : readSourceFile(fileName, languageVersion, onError, shouldCreate);
  const fileExists = host.fileExists.bind(host);
  host.fileExists = (fileName) => fileName === AMBIENT || fileExists(fileName);
  host.resolveModuleNameLiterals = (literals, containingFile) =>
    literals.map((literal) => ({
      resolvedModule: resolveSourceOnly(literal.text, containingFile),
    }));

  const program = ts.createProgram([AMBIENT, ...files], OPTIONS, host);
  const findings = [];
  for (const sourceFile of program.getSourceFiles()) {
    const fileName = path.resolve(sourceFile.fileName);
    if (fileName === AMBIENT) continue;
    if (!fileName.startsWith(APP + path.sep) && !fileName.startsWith(PACKAGES + path.sep)) continue;
    if (fileName.split(path.sep).includes("node_modules") || isTestOrDeclaration(fileName)) continue;
    for (const diagnostic of program.getSemanticDiagnostics(sourceFile)) {
      if (!MISSING_NAME_CODES.has(diagnostic.code)) continue;
      const { line, character } = sourceFile.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
      findings.push(
        `${path.relative(REPO, fileName)}:${line + 1}:${character + 1} TS${diagnostic.code} ` +
          ts.flattenDiagnosticMessageText(diagnostic.messageText, " "),
      );
    }
  }
  return { program, findings };
};

const plant = (file, from, to) => {
  const text = ts.sys.readFile(file);
  if (typeof text !== "string" || !text.includes(from)) {
    throw new Error(`canary anchor "${from}" is gone from ${path.relative(REPO, file)}`);
  }
  return { [file]: text.replace(from, to) };
};

jest.setTimeout(180_000);

describe("#4490 W5-D1 the Explorer app reads only names that exist", () => {
  const files = listProductFiles();
  let live;
  beforeAll(() => {
    live = inspect(files);
  });

  it("N-0 covers the app's product files, SwipeableCards and the deck analytics among them", () => {
    expect(files.length).toBeGreaterThan(500);
    expect(files).toContain(SWIPEABLE);
    const loaded = new Set(live.program.getSourceFiles().map((sf) => path.resolve(sf.fileName)));
    expect(loaded.has(SWIPEABLE)).toBe(true);
    expect(loaded.has(path.join(APP, "src", "components", "deckCard", "deckCardAnalytics.ts"))).toBe(true);
    expect(loaded.has(path.join(PACKAGES, "brand-rendering", "PublicVenueScreen.tsx"))).toBe(true);
  });

  it("N-1 finds no undeclared name in any product file", () => {
    expect(live.findings).toEqual([]);
  });

  it("N-2 canary: the W5-D1 shape (expandVenueProps used, never imported) is caught", () => {
    const { findings } = inspect(
      files,
      plant(
        SWIPEABLE,
        "export default function SwipeableCards(",
        "const issue4490Canary = expandVenueProps;\nexport default function SwipeableCards(",
      ),
    );
    expect(findings).toEqual([
      expect.stringMatching(/SwipeableCards\.tsx:\d+:\d+ TS2304 Cannot find name 'expandVenueProps'\./),
    ]);
  });

  it("N-3 canary: dropping an import the deck uses is caught", () => {
    const { findings } = inspect(
      files,
      plant(SWIPEABLE, 'import { captureVenueTappedToBook } from "./venueOffers/venueBookAnalytics";\n', ""),
    );
    expect(findings).toEqual([
      expect.stringMatching(/SwipeableCards\.tsx:\d+:\d+ TS2304 Cannot find name 'captureVenueTappedToBook'\./),
    ]);
  });
});
