import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";

import { describe, expect, test } from "@jest/globals";

import {
  ATTENDANCE_CLAIM_FRAGMENT_BOOTSTRAP,
  ATTENDANCE_CLAIM_FRAGMENT_HANDOFF_KEY,
  consumeAttendanceClaimFragment,
} from "../attendanceClaimDeepLink";

type BootstrapWindow = {
  location: { pathname: string; search: string; hash: string };
  history: {
    state: unknown;
    replaceState: (state: unknown, unused: string, url?: string | URL | null) => void;
  };
  [ATTENDANCE_CLAIM_FRAGMENT_HANDOFF_KEY]?: unknown;
};

const executeBootstrap = (
  pathname: string,
  search: string,
  hash: string,
  routerState: unknown,
): { browserWindow: BootstrapWindow; replacements: [unknown, string][] } => {
  const replacements: [unknown, string][] = [];
  const browserWindow: BootstrapWindow = {
    location: { pathname, search, hash },
    history: {
      state: routerState,
      replaceState: (state, _unused, url) => {
        replacements.push([state, String(url)]);
        browserWindow.location.hash = "";
      },
    },
  };
  runInNewContext(ATTENDANCE_CLAIM_FRAGMENT_BOOTSTRAP, {
    window: browserWindow,
  });
  return { browserWindow, replacements };
};

describe("issue #2979 pre-Router attendance fragment bootstrap", () => {
  test("captures only the exact claim route and scrubs before body execution", () => {
    const routerState = { key: "synthetic-router-state" };
    const { browserWindow, replacements } = executeBootstrap(
      "/attendance/claim",
      "?source=email%20recovery&channel=sms",
      "#synthetic-claim-fragment",
      routerState,
    );

    expect(replacements).toHaveLength(1);
    expect(replacements[0]?.[0]).toBe(routerState);
    expect(replacements[0]?.[1]).toBe(
      "/attendance/claim?source=email%20recovery&channel=sms",
    );
    const descriptor = Object.getOwnPropertyDescriptor(
      browserWindow,
      ATTENDANCE_CLAIM_FRAGMENT_HANDOFF_KEY,
    );
    expect(descriptor).toMatchObject({
      value: {
        fragment: "synthetic-claim-fragment",
        cleanUrl: "/attendance/claim?source=email%20recovery&channel=sms",
        historyState: routerState,
      },
      writable: false,
      enumerable: false,
      configurable: true,
    });
    expect(Object.keys(browserWindow)).not.toContain(
      ATTENDANCE_CLAIM_FRAGMENT_HANDOFF_KEY,
    );

    const html = readFileSync(resolve(process.cwd(), "app/+html.tsx"), "utf8");
    const headIndex = html.indexOf("<head>");
    const scriptIndex = html.indexOf("<script", headIndex);
    const bodyIndex = html.indexOf("<body>", headIndex);
    expect(headIndex).toBeGreaterThanOrEqual(0);
    expect(scriptIndex).toBeGreaterThan(headIndex);
    expect(scriptIndex).toBeLessThan(bodyIndex);
    expect(html.slice(scriptIndex, bodyIndex)).toContain(
      "ATTENDANCE_CLAIM_FRAGMENT_BOOTSTRAP",
    );
  });

  test("does nothing for lookalike routes or an empty fragment", () => {
    const cases = [
      ["/attendance/claim/", "#fragment"],
      ["/Attendance/claim", "#fragment"],
      ["/attendance/claims", "#fragment"],
      ["/attendance/claim", ""],
    ] as const;

    cases.forEach(([pathname, hash]) => {
      const { browserWindow, replacements } = executeBootstrap(
        pathname,
        "?source=must-stay",
        hash,
        { key: pathname },
      );
      expect(replacements).toHaveLength(0);
      expect(Object.prototype.hasOwnProperty.call(
        browserWindow,
        ATTENDANCE_CLAIM_FRAGMENT_HANDOFF_KEY,
      )).toBe(false);
    });
  });

  test("consumes and deletes the handoff once, then uses direct-hash fallback", () => {
    const bootstrapState = { key: "bootstrap-state" };
    const directState = { key: "direct-state" };
    const browserWindow = {
      location: {
        pathname: "/attendance/claim",
        search: "?source=direct",
        hash: "#direct-fallback-fragment",
      } as Location,
      history: { state: directState } as History,
    };
    Object.defineProperty(
      browserWindow,
      ATTENDANCE_CLAIM_FRAGMENT_HANDOFF_KEY,
      {
        value: {
          fragment: "bootstrap-fragment",
          cleanUrl: "/attendance/claim?source=bootstrap",
          historyState: bootstrapState,
        },
        enumerable: false,
        configurable: true,
      },
    );

    expect(consumeAttendanceClaimFragment(browserWindow)).toEqual({
      fragment: "bootstrap-fragment",
      cleanUrl: "/attendance/claim?source=bootstrap",
      historyState: bootstrapState,
    });
    expect(Object.prototype.hasOwnProperty.call(
      browserWindow,
      ATTENDANCE_CLAIM_FRAGMENT_HANDOFF_KEY,
    )).toBe(false);
    expect(consumeAttendanceClaimFragment(browserWindow)).toEqual({
      fragment: "direct-fallback-fragment",
      cleanUrl: "/attendance/claim?source=direct",
      historyState: directState,
    });

    const route = readFileSync(
      resolve(process.cwd(), "app/attendance/claim.tsx"),
      "utf8",
    );
    const consumeIndex = route.indexOf(
      "consumeAttendanceClaimFragment(window, raw)",
    );
    const scrubIndex = route.indexOf("scrubAttendanceClaimFragment(");
    expect(consumeIndex).toBeGreaterThanOrEqual(0);
    expect(consumeIndex).toBeLessThan(scrubIndex);
  });

  test("has no persistent, DOM, logging, analytics, error, or network sink", () => {
    const forbiddenSinks = [
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
    ];
    forbiddenSinks.forEach((sink) => {
      expect(ATTENDANCE_CLAIM_FRAGMENT_BOOTSTRAP).not.toContain(sink);
    });
  });
});
