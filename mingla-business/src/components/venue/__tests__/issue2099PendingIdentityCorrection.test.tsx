/**
 * #2099 — CHECK P, the placement + resolution seal (Amendment 7 §G3, rebuilt by
 * Amendment 8 §H4, sealed by Amendment 9 §J4, Amendment 10 §K3 and
 * Amendment 11 §L3/§L6).
 *
 * Check P reads SOURCE AS TEXT — the established in-repo pattern
 * (`app/(tabs)/hub/__tests__/venueTab.contract.test.ts:20-31`) — and runs in its
 * own jest process under the STOCK `jest.config.cjs`, which the #2099 render
 * config cannot reach. That separation is the point: P-8b…P-8f and P-10 judge
 * the render config and the launcher's bytes from OUTSIDE the process the
 * render config configures.
 *
 * WHAT IT CATCHES ALONE, with Check H deleted: a second slot anywhere in
 * `app/**` or `src/**`; a viewport-split pair of slots that renders correctly
 * at every width; an explicit `.web` import that breaks the native boundary; a
 * repository-local transformer; a custom resolver; a `moduleNameMapper` entry —
 * ADDED **or** OVERRIDDEN — pointing at a first-party file; a `setupFiles`
 * substitution; and a second slot re-added after #2111 deletes
 * `VenueListingContent.tsx`. None of those is visible to a mounted tree.
 *
 * COMMENT POSTURE — declared, because the two halves are deliberately opposite:
 *   · P-1 … P-6 are comment-BLIND. Comment bodies are blanked with spaces of
 *     the same length, so offsets in the stripped text equal offsets in the raw
 *     text and ordering is preserved; string and template literals are skipped
 *     so a `//` inside a URL is not read as a comment start. Without this, a
 *     commented-out slot satisfies every ordering assertion.
 *   · P-7 is comment-INCLUSIVE on RAW source, because the issue-1424 gate it
 *     protects reads raw source.
 *   · SC-3's token scan is likewise comment-INCLUSIVE.
 */

import fs from "fs";
import path from "path";

import { describe, expect, test } from "@jest/globals";

const BUSINESS_ROOT = path.resolve(__dirname, "../../../..");
const HOST_REL = path.join("app", "venue", "[venueId]", "index.tsx");
const HOST_PATH = path.join(BUSINESS_ROOT, HOST_REL);
const WEB_LAUNCHER = path.join(
  BUSINESS_ROOT,
  "src/components/venue/PendingVenueIdentityCorrectionLauncher.web.tsx",
);
const NATIVE_LAUNCHER = path.join(
  BUSINESS_ROOT,
  "src/components/venue/PendingVenueIdentityCorrectionLauncher.native.tsx",
);
const LISTING_CONTENT = path.join(
  BUSINESS_ROOT,
  "src/components/venue/VenueListingContent.tsx",
);
const RENDER_CONFIG = path.join(BUSINESS_ROOT, "jest.issue2099.web.render.cjs");
const STOCK_CONFIG = path.join(BUSINESS_ROOT, "jest.config.cjs");
const BEHAVIOUR_SUITE = path.join(
  BUSINESS_ROOT,
  "src/components/venue/__tests__/issue2099PendingIdentityCorrection.behavior.render.test.tsx",
);
const WORKFLOW = path.resolve(
  BUSINESS_ROOT,
  "../.github/workflows/issue-2099-pending-venue-identity-correction-tests.yml",
);

const SLOT_TOKEN = "<PendingVenueIdentityCorrectionLauncher";
const CONTROL_TEST_ID = "venue-page-correct-identity-web";
const CONTROL_LABEL = "Correct venue identity";
const GATE_PREDICATE = 'venue.claimStatus === "pending_review"';

/**
 * ONE tokenizer pass. Returns the comment-blanked text (same length, so every
 * offset is shared with the raw source) AND, for every offset, the `{` nesting
 * depth counted outside strings, template literals and comments.
 */
interface Scan {
  text: string;
  depthAt: readonly number[];
}

function scanSource(raw: string): Scan {
  const out = raw.split("");
  const depth: number[] = new Array<number>(raw.length).fill(0);
  let i = 0;
  let level = 0;
  const blank = (from: number, to: number): void => {
    for (let k = from; k < to; k += 1) if (out[k] !== "\n") out[k] = " ";
  };
  while (i < raw.length) {
    depth[i] = level;
    const two = raw.slice(i, i + 2);
    const ch = raw[i]!;
    if (two === "//") {
      let end = raw.indexOf("\n", i);
      if (end === -1) end = raw.length;
      blank(i, end);
      for (let k = i; k < end; k += 1) depth[k] = level;
      i = end;
      continue;
    }
    if (two === "/*") {
      let end = raw.indexOf("*/", i + 2);
      end = end === -1 ? raw.length : end + 2;
      blank(i, end);
      for (let k = i; k < end; k += 1) depth[k] = level;
      i = end;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      let k = i + 1;
      while (k < raw.length) {
        if (raw[k] === "\\") {
          k += 2;
          continue;
        }
        if (raw[k] === quote) {
          k += 1;
          break;
        }
        k += 1;
      }
      for (let m = i; m < k; m += 1) depth[m] = level;
      i = k;
      continue;
    }
    if (ch === "{") level += 1;
    else if (ch === "}") level -= 1;
    depth[i] = ch === "{" ? level - 1 : level;
    i += 1;
  }
  return { text: out.join(""), depthAt: depth };
}

const norm = (value: string): string => value.replace(/\s+/g, " ").trim();

const hostRaw = fs.readFileSync(HOST_PATH, "utf8");
const host = scanSource(hostRaw);

/** Walk every non-test source file under `app/**` and `src/**`. */
function walkSources(): string[] {
  const roots = [path.join(BUSINESS_ROOT, "app"), path.join(BUSINESS_ROOT, "src")];
  const files: string[] = [];
  const visit = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "__tests__" || entry.name === "node_modules") continue;
        visit(full);
        continue;
      }
      if (!/\.(ts|tsx|js|jsx)$/.test(entry.name)) continue;
      if (/\.test\./.test(entry.name)) continue;
      files.push(full);
    }
  };
  for (const root of roots) if (fs.existsSync(root)) visit(root);
  return files;
}

describe("#2099 Check P — placement", () => {
  test("P-1: exactly one EXTENSIONLESS launcher import in the host file", () => {
    const imports = [
      ...host.text.matchAll(/^\s*import[^\n;]*?from\s+["']([^"']+)["'];?$/gm),
    ].filter((match) => (match[0] ?? "").includes("PendingVenueIdentityCorrectionLauncher"));
    expect(imports).toHaveLength(1);
    const specifier = imports[0]![1]!;
    expect(specifier.endsWith("PendingVenueIdentityCorrectionLauncher")).toBe(true);
    // An explicit `.web` import still renders on web and is invisible to a
    // mounted tree — it reds HERE, and the native-absence probe owns the
    // consequence.
    expect(specifier).not.toMatch(/\.(web|native)$/);
  });

  test("P-2: exactly one slot in the whole tree, and it is in the host file", () => {
    const hits: string[] = [];
    for (const file of walkSources()) {
      const stripped = scanSource(fs.readFileSync(file, "utf8")).text;
      let index = stripped.indexOf(SLOT_TOKEN);
      while (index !== -1) {
        hits.push(path.relative(BUSINESS_ROOT, file));
        index = stripped.indexOf(SLOT_TOKEN, index + 1);
      }
    }
    expect(hits).toEqual([HOST_REL]);
  });

  const slotIndex = (): number => host.text.indexOf(SLOT_TOKEN);

  test("P-3: the slot is AFTER the identity band", () => {
    const band = host.text.indexOf("<VenueIdentityBand");
    expect(band).toBeGreaterThan(-1);
    expect(slotIndex()).toBeGreaterThan(band);
  });

  test("P-4: the slot is BEFORE the module pill row", () => {
    const pills = host.text.indexOf("{!isWideDesktop &&");
    expect(pills).toBeGreaterThan(-1);
    expect(slotIndex()).toBeLessThan(pills);
  });

  test("P-5: the slot is OUTSIDE both suite branches", () => {
    const ternary = host.text.indexOf("{isStayVenue && brandId !== null ?");
    expect(ternary).toBeGreaterThan(-1);
    expect(slotIndex()).toBeLessThan(ternary);
  });

  test("P-6a: DEPTH — the slot is a sibling of the band, in exactly one container", () => {
    const band = host.text.indexOf("<VenueIdentityBand");
    expect(host.depthAt[slotIndex()]).toBe((host.depthAt[band] ?? 0) + 1);
  });

  // The container's boundaries, computed ONCE and close-first, so the element
  // scan can never latch onto a later element's terminator.
  const container = (): {
    open: number;
    close: number;
    question: number;
    depth: number;
  } => {
    const slot = slotIndex();
    const depth = host.depthAt[slot]!;
    let open = -1;
    for (let i = slot; i >= 0; i -= 1) {
      if (host.text[i] === "{" && host.depthAt[i] === depth - 1) {
        open = i;
        break;
      }
    }
    let close = -1;
    for (let i = open + 1; i < host.text.length; i += 1) {
      if (host.text[i] === "}" && host.depthAt[i] === depth - 1) {
        close = i;
        break;
      }
    }
    let question = -1;
    for (let i = open + 1; i < close; i += 1) {
      if (host.text[i] === "?" && host.depthAt[i] === depth) {
        question = i;
        break;
      }
    }
    return { open, close, question, depth };
  };

  test("P-6b: CONDITION — exactly the pending predicate, inline or via one const", () => {
    const { open, question } = container();
    expect(open).toBeGreaterThan(-1);
    expect(question).toBeGreaterThan(-1);
    const condition = norm(host.text.slice(open + 1, question));
    if (condition === GATE_PREDICATE) {
      expect(condition).toBe(GATE_PREDICATE);
      return;
    }
    // The ONLY other authorized form: a bare identifier bound exactly once, in
    // this file, to that predicate and never re-assigned. Matched on the
    // comment-stripped, WHITESPACE-NORMALISED text, so an 80-column wrap of the
    // binding — which no committed formatter produces but an editor will — is
    // immaterial. No third form is authorized.
    expect(condition).toMatch(/^[A-Za-z_$][\w$]*$/);
    const flat = norm(host.text);
    const escaped = GATE_PREDICATE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const ident = condition.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // `\s*` around every separator, NOT a literal space: whitespace
    // normalisation collapses runs of whitespace but does not INSERT one, so a
    // binding wrapped at 80 columns normalises to `… "pending_review";` with no
    // space before the semicolon. Requiring one reds a behaviour-identical,
    // explicitly authorized refactor — the cannot-pass class this series has
    // been bitten by five times, and it bit this recogniser too.
    const bindings = flat.match(
      new RegExp(`const\\s+${ident}\\s*=\\s*${escaped}\\s*;`, "g"),
    );
    expect(bindings).toHaveLength(1);
    const assignments = flat.match(new RegExp(`${ident} =(?!=)`, "g"));
    expect(assignments).toHaveLength(1);
  });

  test("P-6c: CONSEQUENT — nothing between the `?` and the element but one paren", () => {
    const { question } = container();
    const between = host.text.slice(question + 1, slotIndex());
    expect(between.replace(/\s+/g, "")).toMatch(/^\(?$/);
  });

  test("P-6d: ALTERNATE — the element is self-closing and the alternate is `null`", () => {
    const { close, depth } = container();
    const slot = slotIndex();
    let selfClose = -1;
    for (let i = slot; i < close - 1; i += 1) {
      if (host.text.slice(i, i + 2) === "/>" && host.depthAt[i] === depth) {
        selfClose = i;
        break;
      }
    }
    // An explicit closing tag is NOT an authorized form; say so legibly.
    expect(selfClose).toBeGreaterThan(-1);
    let colon = -1;
    for (let i = selfClose + 2; i < close; i += 1) {
      if (host.text[i] === ":" && host.depthAt[i] === depth) {
        colon = i;
        break;
      }
    }
    expect(colon).toBeGreaterThan(-1);
    expect(host.text.slice(selfClose + 2, colon).replace(/\s+/g, "")).toMatch(/^\)?$/);
    expect(norm(host.text.slice(colon + 1, close))).toBe("null");
  });

  test("P-6e: FORM — the gate is a ternary, not an `&&`", () => {
    expect(container().question).toBeGreaterThan(-1);
  });

  test("P-7: the stay comparison appears exactly once in RAW source and comments", () => {
    const matches = hostRaw.match(/venue\.venueCategory === "stay"/g) ?? [];
    expect(matches).toHaveLength(1);
  });
});

describe("#2099 Check P — the resolution seal", () => {
  const stock = require(STOCK_CONFIG) as Record<string, unknown>;
  const cfg = require(RENDER_CONFIG) as Record<string, unknown>;
  const FORBIDDEN_TOKENS = [
    "PendingVenueIdentityCorrectionLauncher",
    "PendingVenueIdentityCorrectionDialog",
    "pendingVenueIdentityCorrectionService",
  ];

  test("P-8a: the behavioural suite mocks no #2099 module", () => {
    const source = fs.readFileSync(BEHAVIOUR_SUITE, "utf8");
    const calls = [
      ...source.matchAll(
        /jest\.(?:mock|doMock|setMock|unstable_mockModule)\s*\(\s*(["'])((?:\\.|(?!\1).)*)\1/g,
      ),
    ].map((match) => match[2] ?? "");
    expect(calls.length).toBeGreaterThan(10);
    expect(
      calls.filter((s) => FORBIDDEN_TOKENS.some((token) => s.includes(token))),
    ).toEqual([]);
  });

  test("P-8b: the render config exposes no un-audited resolution surface", () => {
    const allowed = new Set([
      "rootDir",
      "preset",
      "testEnvironment",
      "globals",
      "transform",
      "transformIgnorePatterns",
      "testMatch",
      "moduleFileExtensions",
      "moduleNameMapper",
      "clearMocks",
      "restoreMocks",
      "testTimeout",
      "maxWorkers",
      "injectGlobals",
      "verbose",
    ]);
    const forbidden = new Set([
      "resolver",
      "roots",
      "modulePaths",
      "moduleDirectories",
      "haste",
      "runner",
      "testRunner",
      "snapshotResolver",
      "globalSetup",
      "globalTeardown",
      "testEnvironmentOptions",
      "unmockedModulePathPatterns",
      "automock",
      "moduleLoader",
      "preprocessorIgnorePatterns",
      "setupFiles",
      "setupFilesAfterEnv",
      "setupFilesAfterEach",
    ]);
    const keys = Object.keys(cfg);
    expect(keys.filter((k) => forbidden.has(k))).toEqual([]);
    expect(keys.filter((k) => !allowed.has(k))).toEqual([]);
  });

  test("P-8c: nothing in the render config names a #2099 module", () => {
    const serialised = JSON.stringify(cfg, (_key, value: unknown) => {
      if (value instanceof RegExp) return value.source;
      if (typeof value === "function") return "[function]";
      return value;
    });
    for (const token of FORBIDDEN_TOKENS) expect(serialised).not.toContain(token);
  });

  test("P-8d: preset/transform/transformIgnorePatterns are INHERITED, resolution is web-first", () => {
    expect(cfg.preset).toEqual(stock.preset);
    expect(cfg.transform).toEqual(stock.transform);
    expect(cfg.transformIgnorePatterns).toEqual(stock.transformIgnorePatterns);
    const exts = cfg.moduleFileExtensions as string[];
    expect(exts.indexOf("web.tsx")).toBeGreaterThan(-1);
    expect(exts.indexOf("web.tsx")).toBeLessThan(exts.indexOf("tsx"));
  });

  test("P-8e: every added OR overridden mapper entry resolves inside node_modules", () => {
    const stockMap = (stock.moduleNameMapper ?? {}) as Record<string, string>;
    const map = (cfg.moduleNameMapper ?? {}) as Record<string, string>;
    // No stock key may be removed.
    for (const key of Object.keys(stockMap)) expect(Object.keys(map)).toContain(key);
    const changed = Object.keys(map).filter((key) => map[key] !== stockMap[key]);
    for (const key of changed) {
      expect(key).toMatch(/^\^[^/]+(\/\(\.[*+]\)\$|\$)/);
      expect(key).not.toMatch(/(^|\/)(src|app|packages)\//);
      const value = String(map[key]);
      expect(value).not.toContain("src/");
      expect(value).not.toContain("app/");
      expect(value).not.toContain("packages/");
      // A capture-group reference is never a package.
      expect(value).not.toContain("$1");
      // RESOLVE the value — a textual `node_modules/` test passes
      // `<rootDir>/jest.node_modules/stub.cjs`, which resolves first-party.
      const substituted = value.replace("<rootDir>", BUSINESS_ROOT);
      const real = fs.realpathSync(substituted);
      expect(real.split(path.sep)).toContain("node_modules");
    }
  });

  test("P-8f: no in-repo setup file can substitute a #2099 module", () => {
    const named = [
      ...(((cfg.setupFiles as string[] | undefined) ?? [])),
      ...(((cfg.setupFilesAfterEnv as string[] | undefined) ?? [])),
    ];
    for (const entry of named) {
      const file = entry.replace("<rootDir>", BUSINESS_ROOT);
      if (!fs.existsSync(file)) continue;
      const source = fs.readFileSync(file, "utf8");
      expect(source).not.toMatch(/jest\.(mock|doMock|setMock|unstable_mockModule)\s*\(/);
      for (const token of FORBIDDEN_TOKENS) expect(source).not.toContain(token);
    }
    expect(named).toEqual([]);
  });

  test("P-9: the workflow runs the render config on PR and push, tester guard fail-closed", () => {
    const yaml = fs.readFileSync(WORKFLOW, "utf8");
    expect(yaml).toContain("jest.issue2099.web.render.cjs");
    expect(yaml).toMatch(/on:\s*\n\s*pull_request:/);
    expect(yaml).toMatch(/\n\s*push:/);
    // Split on step boundaries (any `      - ` at six-space indent) so the
    // tester step's block is exactly that step and nothing after it.
    const testerStep = yaml
      .split(/\n(?=\s{6}- )/)
      .find((block) => block.includes("tester guard pending"));
    expect(testerStep).toBeDefined();
    // The fail-closed existence check, in either POSIX spelling, with a
    // non-zero exit. There is no skip path.
    expect(testerStep).toMatch(/(test\s+-f|\[\s*!\s*-f)/);
    expect(testerStep).toContain("exit 1");
    expect(testerStep).toContain("tester_adversarial.test.sh");
    expect(testerStep).not.toContain("continue-on-error");
    expect(testerStep).not.toContain("|| true");
    expect(testerStep).not.toMatch(/\n\s*if:/);
  });

  test("P-10: DISK TRUTH — both literals in .web.tsx, neither in .native.tsx", () => {
    const web = fs.readFileSync(WEB_LAUNCHER, "utf8");
    expect(web).toContain(CONTROL_TEST_ID);
    expect(web).toContain(CONTROL_LABEL);
    const native = fs.readFileSync(NATIVE_LAUNCHER, "utf8");
    expect(native).not.toContain(CONTROL_TEST_ID);
    expect(native).not.toContain(CONTROL_LABEL);
  });
});

describe("#2099 SC-3 — VenueListingContent carries zero correction code", () => {
  test("absent ⇒ PASS (owned by #2111); present ⇒ zero tokens, comments included", () => {
    if (!fs.existsSync(LISTING_CONTENT)) {
      // #2111 owns this file's deletion; absence trivially satisfies "zero
      // #2099 code". Scope-fencing sensitivity is carried by P-2, which is
      // repository-wide and does not depend on this file existing.
      expect(fs.existsSync(LISTING_CONTENT)).toBe(false);
      return;
    }
    const raw = fs.readFileSync(LISTING_CONTENT, "utf8");
    for (const token of [
      "PendingVenueIdentityCorrectionLauncher",
      "PendingVenueIdentityCorrectionDialog",
      "pendingVenueIdentityCorrectionService",
      "correct_pending_venue_identity",
      "preview_pending_venue_identity_correction",
      "Correct venue identity",
      "Correct pending venue",
    ]) {
      expect(raw).not.toContain(token);
    }
  });
});
