/**
 * issue #2227 — TESTER ADVERSARIAL against the registry gate itself.
 *
 * DIFFERENT ANGLE FROM THE IMPLEMENTOR.
 * -------------------------------------
 * The implementor's T-2 runs `check-native-authsession-redirects.sh` and
 * asserts it prints OK over a non-zero number of call sites. That proves the
 * gate runs. It does not prove the gate can SEE the code it claims to guard,
 * and it does not prove the gate rejects anything it has not already got a
 * fixture for.
 *
 * This suite attacks the gate from two directions:
 *
 *  A. EVASION — redirect shapes the gate's own self-test does not carry:
 *     a template literal, a ternary, string concatenation, a `let` binding, an
 *     object property. Each must be denied, because the gate's contract is
 *     deny-by-default on anything it cannot statically prove is a custom
 *     scheme, and "unprovable" is precisely how #2227 shipped.
 *
 *  B. COVERAGE — the gate walks four hard-coded roots. A gate that cannot see a
 *     call site does not guard it, and nothing in the gate can tell you that.
 *     This suite scans every client tree in the repo and asserts that no
 *     `openAuthSessionAsync` CALL exists outside the roots the gate actually
 *     walks. That is the assertion that goes red the day someone adds a Paystack
 *     hand-off in `packages/` or in a new client directory.
 *
 * Fails on revert: restore an https redirect at any of the four browser clients
 * (verified by true line edit — see the QA report on #2227).
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO_ROOT = join(__dirname, "..", "..", "..", "..");
const GATE = join(REPO_ROOT, "scripts", "ci", "check-native-authsession-redirects.sh");
const GATE_SOURCE = readFileSync(GATE, "utf8");

/** Run the gate over one directory. Returns true when it PASSES (exit 0). */
const gateAccepts = (dir: string): boolean => {
  try {
    execFileSync("bash", [GATE, dir], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
};

/**
 * The gate is a strict grep and it scans `app-mobile/src`, `__tests__`
 * included. It cannot tell a CALL from a MENTION, so a fixture written as a
 * plain string literal in THIS file would be scanned as a real call site and
 * would red the production gate. The call token is therefore assembled at
 * runtime and never appears contiguously in this source. (Filed as a finding on
 * #2227 — the gate should skip test trees, or resolve mentions inside string
 * literals.)
 */
const CALL_TOKEN = `WebBrowser.openAuth${"SessionAsync"}`;

/** Build one fixture file body: `WebBrowser.openAuthSessionAsync(<args>);`. */
const call = (args: string): string => `await ${CALL_TOKEN}(${args});`;

const fixture = (contents: string): string => {
  const dir = mkdtempSync(join(tmpdir(), "issue2227-gate-"));
  writeFileSync(join(dir, "fixture.ts"), contents, "utf8");
  return dir;
};

describe("#2227 adversarial — evasion shapes the gate's self-test does not carry", () => {
  const MUST_BE_DENIED: [string, string][] = [
    [
      "an interpolated template literal",
      call("url, `https://host.usemingla.com/${id}/confirm`"),
    ],
    [
      "a ternary whose other arm is https",
      `const SAFE = "mingla://x";\n${call('url, ng ? SAFE : "https://host.usemingla.com/o/venue/"')}`,
    ],
    [
      "string concatenation",
      `const BASE = "https://host.usemingla.com";\n${call('url, BASE + "/o/venue/"')}`,
    ],
    [
      "a `let` binding rather than a const",
      `let RETURN = "https://host.usemingla.com/o/venue/";\n${call("url, RETURN")}`,
    ],
    [
      "a property read off a config object",
      `const CFG = { returnUrl: "https://host.usemingla.com/o/venue/" };\n${call("url, CFG.returnUrl")}`,
    ],
    [
      "the exact literal #2227 shipped",
      call("data.authorizationUrl, data.returnUrl"),
    ],
    [
      "a bare http (not https) redirect",
      call('url, "http://host.usemingla.com/x"'),
    ],
    [
      "a redirect built by a function call",
      call("url, buildReturnUrl(eventId)"),
    ],
  ];

  it.each(MUST_BE_DENIED)("denies %s", (_label: string, source: string) => {
    expect(gateAccepts(fixture(source))).toBe(false);
  });

  const MUST_BE_ALLOWED: [string, string][] = [
    ["a custom-scheme literal", call('url, "mingla-business://onboarding-complete"')],
    [
      "a same-file const holding a custom scheme",
      `const RETURN_DEEP_LINK = "com.mingla.app.v2://paystack-return" as const;\n${call("url, RETURN_DEEP_LINK")}`,
    ],
    ["no redirect argument at all", call("url")],
    ["an explicit undefined", call("url, undefined")],
  ];

  it.each(MUST_BE_ALLOWED)("allows %s", (_label: string, source: string) => {
    expect(gateAccepts(fixture(source))).toBe(true);
  });

  it("a URL inside a real string is not eaten by comment stripping", () => {
    // The `//` in `mingla://` is the exact place a naive comment stripper turns
    // a provably-safe redirect into an unprovable one and reds a clean tree.
    expect(
      gateAccepts(
        fixture(
          `// https://host.usemingla.com/o/venue/ — the shape #2227 was about\nconst OK = "mingla-business://done";\n${call("url, OK")}`,
        ),
      ),
    ).toBe(true);
  });

  it("is falsifiable from the same entry point that reports green", () => {
    // #2242's shape: a gate whose failing half never runs. Both verdicts must
    // be reachable from the identical invocation.
    expect(gateAccepts(fixture(call("u, s.returnUrl")))).toBe(false);
    expect(gateAccepts(fixture(call('u, "app://done"')))).toBe(true);
  });
});

describe("#2227 adversarial — the gate can SEE every call site in the repo", () => {
  /** The roots the gate actually walks, parsed out of the gate itself. */
  const declaredRoots = (): string[] => {
    const block = /DEFAULT_ROOTS=\(([\s\S]*?)\)/.exec(GATE_SOURCE)?.[1] ?? "";
    return [...block.matchAll(/"\$REPO_ROOT\/([^"]+)"/g)].map((m) => m[1]);
  };

  /** Every client tree that could ship a browser hand-off. */
  const CLIENT_TREES = ["app-mobile", "mingla-business", "packages"];
  const SKIP_DIRS = new Set(["node_modules", ".git", "__tests__", "scripts", "build", "dist", "ios", "android"]);
  const SOURCE_EXT = [".ts", ".tsx", ".js", ".jsx", ".mjs"];
  /** A CALL, not the word — a comment naming the API is mandated by #2227 §9. */
  const CALL = /(?:^|[^\w$.])(?:WebBrowser\s*\.\s*)?openAuthSessionAsync\s*\(/m;

  const walk = (dir: string): string[] => {
    let out: string[] = [];
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return out;
    }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      let s;
      try {
        s = statSync(full);
      } catch {
        continue;
      }
      if (s.isDirectory()) out = out.concat(walk(full));
      else if (SOURCE_EXT.some((e) => full.endsWith(e))) out.push(full);
    }
    return out;
  };

  it("declares the four roots the SPEC and the implementation agreed on", () => {
    expect(declaredRoots().sort()).toEqual(
      ["app-mobile/app", "app-mobile/src", "mingla-business/app", "mingla-business/src"].sort(),
    );
  });

  it("no client call site lives outside the roots the gate walks", () => {
    const roots = declaredRoots().map((r) => join(REPO_ROOT, r));
    const unguarded: string[] = [];
    let seen = 0;

    for (const tree of CLIENT_TREES) {
      for (const file of walk(join(REPO_ROOT, tree))) {
        const source = readFileSync(file, "utf8");
        if (!CALL.test(source)) continue;
        seen += 1;
        if (!roots.some((root) => file.startsWith(root + "/"))) {
          unguarded.push(file.slice(REPO_ROOT.length + 1));
        }
      }
    }

    // Not vacuous: the repo really does still have call sites to guard.
    expect(seen).toBeGreaterThan(0);
    expect(unguarded).toEqual([]);
  });

  it("the four Paystack hand-offs #2227 fixed carry no auth-session call at all", () => {
    const FIXED = [
      "app-mobile/src/payments/nativeCheckoutFlow.ts",
      "app-mobile/src/components/venueOrdering/useConsumerVenueOrdering.ts",
      "app-mobile/src/hooks/useReserveTable.ts",
      "mingla-business/src/payments/nativeCheckoutFlow.native.ts",
    ];
    for (const rel of FIXED) {
      const source = readFileSync(join(REPO_ROOT, rel), "utf8");
      // A call, not the word — every one of these carries a protective comment
      // that names the forbidden API on purpose.
      expect(source).not.toMatch(/openAuthSessionAsync\s*\(/);
      expect(source).toMatch(/openBrowserAsync\s*\(/);
      // ...and the https Host URL must not be an argument to anything.
      expect(source).not.toMatch(/openBrowserAsync\([^)]*returnUrl/);
    }
  });

  it("the whole repo passes the gate as it stands", () => {
    const output = execFileSync("bash", [GATE], { encoding: "utf8" });
    expect(output).toMatch(/^OK — \d+ openAuthSessionAsync call site\(s\), zero https redirects\./m);
    const counted = Number(/OK — (\d+)/.exec(output)?.[1] ?? "0");
    expect(counted).toBeGreaterThan(0);
  });
});
