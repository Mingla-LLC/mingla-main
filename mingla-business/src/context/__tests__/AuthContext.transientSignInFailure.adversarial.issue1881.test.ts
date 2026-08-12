/**
 * #1881 tester-owned adversarial guard.
 *
 * This deliberately does not recreate the implementor callback harness. It
 * attacks three independent seams instead: the byte-level product patch, the
 * real key-selection expressions that feed native Alert, and the complete
 * fixed-copy output boundary.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolveAuthFailureCopy } from "../../constants/authFailureCopy";

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const AUTH_CONTEXT_PATH = "mingla-business/src/context/AuthContext.tsx";
const BASELINE_COMMIT = "09212b365";
const BASELINE_SHA256 =
  "6eacc5eac7893c98fcfc05387a580d3e9a346147ecd6d34acee81b50266c59ca";
const APPROVED_PATCH_SHA256 =
  "1ecca6e353863a2e35af52579b6ddc09c05ffe6100c49c9be025430766bf3f50";

const SOURCE = fs.readFileSync(
  path.join(REPO_ROOT, AUTH_CONTEXT_PATH),
  "utf8",
);

const sha256 = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

const git = (...args: string[]): string =>
  execFileSync("git", args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });

const COPY_KEYS = [
  "auth:welcome.sign_in_failed_title",
  "auth:welcome.sign_in_failed_body",
  "auth:welcome.sign_in_failed_ok",
  "auth:welcome.sign_in_offline_title",
  "auth:welcome.sign_in_offline_body",
  "auth:welcome.sign_in_retry_exhausted_title",
  "auth:welcome.sign_in_retry_exhausted_body",
  "auth:welcome.sign_in_permanent_body",
] as const;

const COPY_VALUES = new Set(COPY_KEYS.map((key) => resolveAuthFailureCopy(key)));

const selectionBlocks = (): string[] =>
  SOURCE.match(
    /const titleKey =\n[\s\S]*?const bodyKey =\n[\s\S]*?;(?=\n {6}Alert\.alert)/g,
  ) ?? [];

const compileSelection = (
  block: string,
): ((failure: string, attempts: number) => readonly [string, string]) =>
  new Function(
    "failure",
    "transportRetryAttempts",
    `"use strict"; ${block}; return [titleKey, bodyKey];`,
  ) as (failure: string, attempts: number) => readonly [string, string];

describe("#1881 tester adversarial: byte-level scope differential", () => {
  it("pins the exact pre-port baseline and the complete approved AuthContext patch", () => {
    const baseline = git("show", `${BASELINE_COMMIT}:${AUTH_CONTEXT_PATH}`);
    const patch = git("diff", BASELINE_COMMIT, "--", AUTH_CONTEXT_PATH);

    expect(sha256(baseline)).toBe(BASELINE_SHA256);
    expect(sha256(patch)).toBe(APPROVED_PATCH_SHA256);
    expect(patch.match(/^@@/gm)).toHaveLength(11);
  });

  it("keeps web redirect and existing-user reconciliation inside the byte guard", () => {
    // These load-bearing lines are intentionally outside #1881's behavioral
    // rewrite. Deleting either changes the full patch digest above even though
    // the implementor retry harness does not validate the redirect payload.
    expect(SOURCE.match(/redirectTo: buildWebRedirectTo\(\),/g)).toHaveLength(2);
    expect(SOURCE).toContain(
      "const { data: sessionData } = await supabase.auth.getSession();",
    );
  });
});

describe("#1881 tester adversarial: exhaustive Alert boundary", () => {
  it("executes both real key-selection expressions over every class/counter edge", () => {
    const blocks = selectionBlocks();
    expect(blocks).toHaveLength(2);

    const failures = [
      "permanent",
      "transient-transport-offline",
      "transient-transport-remote",
      "transient-provider",
    ];
    const counters = [-1, 0, 1, 2, Number.MAX_SAFE_INTEGER, Number.NaN];

    for (const block of blocks) {
      const select = compileSelection(block);
      for (const failure of failures) {
        for (const counter of counters) {
          const [titleKey, bodyKey] = select(failure, counter);
          expect(COPY_KEYS).toContain(titleKey as (typeof COPY_KEYS)[number]);
          expect(COPY_KEYS).toContain(bodyKey as (typeof COPY_KEYS)[number]);
          expect(COPY_VALUES).toContain(
            resolveAuthFailureCopy(titleKey as (typeof COPY_KEYS)[number]),
          );
          expect(COPY_VALUES).toContain(
            resolveAuthFailureCopy(bodyKey as (typeof COPY_KEYS)[number]),
          );
        }
      }
    }
  });

  it("admits only registry values and defeats the full raw-error/key leak corpus", () => {
    const hostileCorpus = [
      "https://gqnoajqerqhnvulmnyvv.supabase.co/auth/v1/token",
      "blob:nodedata:5f2d-secret",
      "AuthRetryableFetchError",
      "AuthApiError",
      "DEVELOPER_ERROR",
      "NETWORK_ERROR",
      "INTERNAL_ERROR",
      "TIMEOUT",
      "status=504",
      '"code":"refresh_token_not_found"',
      "Unacceptable audience in id_token",
      "audienceHint",
      "getTokens",
      "12500",
      "undefined",
      "[object Object]",
      "\nstack: secret-stack-frame",
      ...COPY_KEYS,
    ];
    const emitted = [...COPY_VALUES].join("\n");

    expect(COPY_VALUES.size).toBe(8);
    for (const secret of hostileCorpus) {
      expect(emitted).not.toContain(secret);
    }

    const keyedAlerts = SOURCE.match(
      /Alert\.alert\(\n {8}resolveAuthFailureCopy\(titleKey\),\n {8}resolveAuthFailureCopy\(bodyKey\),\n {8}\[\{ text: resolveAuthFailureCopy\("auth:welcome\.sign_in_failed_ok"\) \}\],\n {6}\);/g,
    );
    expect(keyedAlerts).toHaveLength(2);
  });

  it("keeps every failure-copy key single-owned by the frozen registry", () => {
    const registrySource = fs.readFileSync(
      path.join(
        REPO_ROOT,
        "mingla-business/src/constants/authFailureCopy.ts",
      ),
      "utf8",
    );

    for (const key of COPY_KEYS) {
      expect(registrySource.split(`"${key}"`)).toHaveLength(3);
    }
    expect(SOURCE).not.toMatch(/statusCodes\.(?:INTERNAL_ERROR|NETWORK_ERROR|TIMEOUT)/);
  });
});
