import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { runInNewContext } from "node:vm";

import { afterEach, describe, expect, test } from "@jest/globals";

import {
  ATTENDANCE_CLAIM_FRAGMENT_BOOTSTRAP,
  ATTENDANCE_CLAIM_FRAGMENT_HANDOFF_KEY,
  consumeAttendanceClaimFragment,
  createAttendanceClaimFragmentScrubber,
} from "../attendanceClaimDeepLink";

const BUSINESS_ROOT = resolve(process.cwd());
const INJECTOR_PATH = resolve(
  BUSINESS_ROOT,
  "scripts/inject-attendance-claim-bootstrap.mjs",
);
const MARKER = "mingla-attendance-claim-pre-router";
const EXPORTED_SHELL = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"></head><body><div id="root"></div><script src="/_expo/static/js/web/runtime-a1.js" defer></script><script src="/_expo/static/js/web/common-b2.js" defer></script><script src="/_expo/static/js/web/index-c3.js" defer></script></body></html>`;
const tempDirectories: string[] = [];

const fixturePath = (html = EXPORTED_SHELL): string => {
  const directory = mkdtempSync(join(tmpdir(), "mingla-2979-a12-"));
  tempDirectories.push(directory);
  const path = join(directory, "index.html");
  writeFileSync(path, html, "utf8");
  return path;
};

const runInjector = (path: string) => spawnSync(
  process.execPath,
  [INJECTOR_PATH, path],
  { cwd: BUSINESS_ROOT, encoding: "utf8" },
);

afterEach(() => {
  tempDirectories.splice(0).forEach((directory) => {
    rmSync(directory, { recursive: true, force: true });
  });
});

describe("issue #2979 exported attendance bootstrap injection", () => {
  test("injects exact bytes before all application JS and is idempotent", () => {
    const path = fixturePath();
    const first = runInjector(path);
    expect(first.status).toBe(0);
    const injected = readFileSync(path, "utf8");
    const expectedTag =
      `<script id="${MARKER}">${ATTENDANCE_CLAIM_FRAGMENT_BOOTSTRAP}</script>`;
    expect(injected.split(MARKER)).toHaveLength(2);
    expect(injected).toContain(expectedTag);
    const bootstrapIndex = injected.indexOf(expectedTag);
    const applicationScriptIndices = [
      ...injected.matchAll(/<script\b[^>]*\bsrc=/gi),
    ].map((match) => match.index);
    expect(applicationScriptIndices).toHaveLength(3);
    applicationScriptIndices.forEach((index) => {
      expect(index).toBeGreaterThan(bootstrapIndex);
    });

    const second = runInjector(path);
    expect(second.status).toBe(0);
    expect(readFileSync(path, "utf8")).toBe(injected);

    const vercel = JSON.parse(
      readFileSync(resolve(BUSINESS_ROOT, "vercel.json"), "utf8"),
    ) as { buildCommand: string };
    const exportIndex = vercel.buildCommand.indexOf("npx expo export -p web");
    const attendanceIndex = vercel.buildCommand.indexOf(
      "node scripts/inject-attendance-claim-bootstrap.mjs",
    );
    const blurIndex = vercel.buildCommand.indexOf(
      "node scripts/inject-mobile-blur-css.mjs",
    );
    expect(exportIndex).toBeGreaterThanOrEqual(0);
    expect(attendanceIndex).toBeGreaterThan(exportIndex);
    expect(blurIndex).toBeGreaterThan(attendanceIndex);

    const htmlOwner = readFileSync(
      resolve(BUSINESS_ROOT, "app/+html.tsx"),
      "utf8",
    );
    expect(htmlOwner).not.toContain("ATTENDANCE_CLAIM_FRAGMENT_BOOTSTRAP");
  });

  test("fails closed for missing, malformed, anchorless, and conflicting shells", () => {
    const missingDirectory = mkdtempSync(join(tmpdir(), "mingla-2979-a12-"));
    tempDirectories.push(missingDirectory);
    expect(runInjector(join(missingDirectory, "missing.html")).status).not.toBe(0);

    const malformed = fixturePath(
      `<html><head><body><script src="/_expo/static/js/web/index.js"></script></body></html>`,
    );
    expect(runInjector(malformed).status).not.toBe(0);

    const anchorless = fixturePath(
      `<!DOCTYPE html><html><head></head><body><div id="root"></div></body></html>`,
    );
    expect(runInjector(anchorless).status).not.toBe(0);

    const conflicting = fixturePath(
      EXPORTED_SHELL.replace(
        "</head>",
        `<script id="${MARKER}">conflicting</script></head>`,
      ),
    );
    expect(runInjector(conflicting).status).not.toBe(0);

    const duplicate = fixturePath();
    expect(runInjector(duplicate).status).toBe(0);
    const once = readFileSync(duplicate, "utf8");
    writeFileSync(
      duplicate,
      once.replace("</head>", once.match(new RegExp(
        `<script id="${MARKER}">[\\s\\S]*?</script>`,
      ))?.[0] + "</head>"),
      "utf8",
    );
    expect(runInjector(duplicate).status).not.toBe(0);

    const injectorSource = readFileSync(INJECTOR_PATH, "utf8");
    expect(injectorSource).toMatch(
      /const written = readFileSync\(htmlPath, "utf8"\);\s*verifyInjectedShell\(written\);/,
    );
  });

  test("restores the exported launch query/state after Router loss", () => {
    const path = fixturePath();
    expect(runInjector(path).status).toBe(0);
    const injected = readFileSync(path, "utf8");
    const bootstrapSource = injected.match(new RegExp(
      `<script id="${MARKER}">([\\s\\S]*?)</script>`,
    ))?.[1];
    expect(bootstrapSource).toBe(ATTENDANCE_CLAIM_FRAGMENT_BOOTSTRAP);

    const cleanUrl =
      "/attendance/claim?source=email%20recovery&channel=sms";
    const launchState = { key: "export-launch-state" };
    const laterState = { key: "router-later-state" };
    let visibleUrl = `${cleanUrl}#synthetic-claim-fragment`;
    const replacements: [unknown, string][] = [];
    const scheduledCallbacks: FrameRequestCallback[] = [];
    const browserWindow = {
      location: {
        pathname: "/attendance/claim",
        search: "?source=email%20recovery&channel=sms",
        hash: "#synthetic-claim-fragment",
      },
      history: {
        state: launchState as unknown,
        replaceState: (state: unknown, _unused: string, url?: string | URL | null) => {
          replacements.push([state, String(url)]);
          visibleUrl = String(url);
          browserWindow.location.hash = "";
        },
      },
    };

    runInNewContext(bootstrapSource as string, { window: browserWindow });
    browserWindow.location.search = "";
    browserWindow.history.state = laterState;
    visibleUrl = "/attendance/claim";

    const handoff = consumeAttendanceClaimFragment(
      browserWindow as unknown as Window,
      "",
    );
    expect(Object.prototype.hasOwnProperty.call(
      browserWindow,
      ATTENDANCE_CLAIM_FRAGMENT_HANDOFF_KEY,
    )).toBe(false);
    const scrubAttendanceClaimFragment =
      createAttendanceClaimFragmentScrubber(handoff);
    const scheduleFinalRestore = scrubAttendanceClaimFragment(
      browserWindow.location,
      browserWindow.history,
      (callback) => {
        scheduledCallbacks.push(callback);
        return scheduledCallbacks.length;
      },
    );
    scheduledCallbacks.shift()?.(0);
    scheduledCallbacks.shift()?.(16);
    visibleUrl = "/attendance/claim";
    scheduleFinalRestore();
    scheduledCallbacks.shift()?.(32);

    expect(visibleUrl).toBe(cleanUrl);
    expect(handoff.historyState).toBe(launchState);
    expect(replacements).toHaveLength(5);
    replacements.forEach(([state, url]) => {
      expect(state).toBe(launchState);
      expect(url).toBe(cleanUrl);
    });
  });

  test("is a no-op for lookalike routes and ships no credential sink", () => {
    const path = fixturePath();
    expect(runInjector(path).status).toBe(0);
    const injected = readFileSync(path, "utf8");
    const bootstrapSource = injected.match(new RegExp(
      `<script id="${MARKER}">([\\s\\S]*?)</script>`,
    ))?.[1] as string;
    const cases = [
      ["/attendance/claim/", "#synthetic-fragment"],
      ["/Attendance/claim", "#synthetic-fragment"],
      ["/attendance/claims", "#synthetic-fragment"],
      ["/attendance/claim", ""],
    ] as const;
    cases.forEach(([pathname, hash]) => {
      const replacements: unknown[] = [];
      const browserWindow = {
        location: { pathname, search: "?source=stay", hash },
        history: {
          state: { key: pathname },
          replaceState: (...args: unknown[]) => replacements.push(args),
        },
      };
      runInNewContext(bootstrapSource, { window: browserWindow });
      expect(replacements).toHaveLength(0);
      expect(Object.prototype.hasOwnProperty.call(
        browserWindow,
        ATTENDANCE_CLAIM_FRAGMENT_HANDOFF_KEY,
      )).toBe(false);
    });

    for (const sink of [
      "localStorage",
      "sessionStorage",
      "cookie",
      "document",
      "console",
      "analytics",
      "throw",
      "Error",
      "fetch",
      "XMLHttpRequest",
      "sendBeacon",
      "WebSocket",
      "postMessage",
    ]) expect(bootstrapSource).not.toContain(sink);
  });
});
