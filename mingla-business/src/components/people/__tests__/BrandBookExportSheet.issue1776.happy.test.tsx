import React from "react";
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import { AppState, Linking, View } from "react-native";
import { readFileSync } from "node:fs";
import path from "node:path";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const requestBrandBookExport = jest.fn<(...args: any[]) => Promise<any>>();
const getBrandBookExport = jest.fn<(...args: any[]) => Promise<any>>();
let requestId = 0;

jest.mock("../../../services/brandBookExportService", () => ({
  BrandBookExportError: class BrandBookExportError extends Error {
    public constructor(public readonly code: string) { super(code); }
  },
  createBrandBookExportRequestId: () => `17760000-0000-4000-8000-${String(++requestId).padStart(12, "0")}`,
  requestBrandBookExport,
  getBrandBookExport,
}));
jest.mock("../../ui/Sheet", () => ({
  Sheet: ({ visible, children, onClose }: any) => visible
    ? React.createElement("MockSheet", { onClose }, children)
    : null,
}));
jest.mock("../../ui/Button", () => ({
  Button: React.forwardRef(function MockButton(_props: any, _ref) {
    return React.createElement("MockButton", _props);
  }),
}));
jest.mock("../../ui/Icon", () => ({ Icon: () => null }));
jest.mock("../../ui/Spinner", () => ({ Spinner: () => React.createElement(View) }));

import { BrandBookExportSheet } from "../BrandBookExportSheet";
import { BrandBookExportError } from "../../../services/brandBookExportService";

const TR = require("react-test-renderer") as {
  create: (node: React.ReactElement) => any;
  act: (callback: () => void | Promise<void>) => void | Promise<void>;
};

const queued = {
  jobId: "job-1776",
  status: "queued",
  exportableCount: 0,
  result: null,
  safeErrorCode: null,
  signedUrl: null,
};
const ready = {
  ...queued,
  status: "ready",
  exportableCount: 3,
  result: { fileName: "brand-book.csv", expiresAt: "2026-09-03T12:00:00Z" },
  signedUrl: "https://signed.example/brand-book.csv",
};

let tree: any;
let onClose: jest.Mock;
let onDownloaded: jest.Mock;
let onAuthRequired: jest.Mock;
let onPermissionDenied: jest.Mock;
const defaultProps = {
  visible: true,
  onClose: () => undefined,
  brandId: "d33e9214-bfb5-4cd8-8f15-0ce50f623bb9",
  contactCount: 3,
  online: true,
  authorized: true,
  permissionCaption: "Your role doesn't include this action. Ask a brand admin or above.",
  onDownloaded: () => undefined,
  onAuthRequired: () => undefined,
  onPermissionDenied: () => undefined,
};
const render = (overrides: Partial<typeof defaultProps> = {}): void => {
  TR.act(() => {
    tree = TR.create(
      <BrandBookExportSheet
        {...defaultProps}
        onClose={onClose}
        onDownloaded={onDownloaded}
        onAuthRequired={onAuthRequired}
        onPermissionDenied={onPermissionDenied}
        {...overrides}
      />,
    );
  });
};
const button = (label: string): any =>
  tree.root.findAllByType("MockButton").find((node: any) => node.props.label === label);
const textOf = (value: any): string => typeof value === "string"
  ? value
  : Array.isArray(value)
    ? value.map(textOf).join(" ")
    : value && typeof value === "object"
      ? textOf(value.children ?? [])
      : "";

beforeEach(() => {
  requestId = 0;
  requestBrandBookExport.mockReset();
  getBrandBookExport.mockReset();
  onClose = jest.fn();
  onDownloaded = jest.fn();
  onAuthRequired = jest.fn();
  onPermissionDenied = jest.fn();
  jest.spyOn(Linking, "openURL").mockResolvedValue(undefined);
});

afterEach(() => {
  if (tree !== undefined) TR.act(() => tree.unmount());
  tree = undefined;
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("#1776 brand-book export happy path", () => {
  test("shows the approved privacy boundary and exact brand-owned count", () => {
    render();
    const copy = textOf(tree.toJSON());
    expect(copy).toContain("This CSV includes only contact details people gave this brand.");
    expect(copy).toContain("Mingla profile data and circle-only contacts stay private.");
    expect(copy).toMatch(/3\s+contacts/);
    expect(copy).toContain("Communication opt-out status");
    expect(copy).toContain("Mingla-only profile details and circle connections");
  });

  test("keeps the privacy boundary readable offline and disables preparation", () => {
    render({ online: false });
    const copy = textOf(tree.toJSON());
    expect(copy).toContain("This CSV includes only contact details people gave this brand.");
    expect(copy).toContain("You're offline. Reconnect to prepare or download the export.");
    expect(button("Prepare CSV").props.disabled).toBe(true);
  });

  test("submits the exact scoped contract once, polls, and refreshes the signed URL on download", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-09-02T12:00:00Z"));
    requestBrandBookExport.mockResolvedValue(queued);
    getBrandBookExport
      .mockResolvedValueOnce(queued)
      .mockResolvedValueOnce(ready)
      .mockResolvedValueOnce(ready);
    render();

    await TR.act(async () => {
      const submit = button("Prepare CSV").props.onPress;
      await Promise.all([submit(), submit()]);
    });
    expect(requestBrandBookExport).toHaveBeenCalledTimes(1);
    expect(requestBrandBookExport).toHaveBeenCalledWith({
      brandId: "d33e9214-bfb5-4cd8-8f15-0ce50f623bb9",
      clientRequestId: "17760000-0000-4000-8000-000000000001",
    });

    await TR.act(async () => {
      jest.advanceTimersByTime(2_000);
      await Promise.resolve();
    });
    expect(getBrandBookExport).toHaveBeenCalledWith("job-1776");
    expect(button("Preparing your CSV…")).toBeDefined();
    await TR.act(async () => {
      jest.advanceTimersByTime(2_000);
      await Promise.resolve();
    });
    expect(button("Download CSV")).toBeDefined();
    expect(textOf(tree.toJSON())).toMatch(/3\s+contacts — available for 24 hours/);

    await TR.act(async () => {
      await button("Download CSV").props.onPress();
    });
    expect(getBrandBookExport).toHaveBeenCalledTimes(3);
    expect(Linking.openURL).toHaveBeenCalledWith("https://signed.example/brand-book.csv");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onDownloaded).toHaveBeenCalledTimes(1);
  });

  test("keeps preparing after the sheet closes and resumes with the same job", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-09-02T12:00:00Z"));
    requestBrandBookExport.mockResolvedValue(queued);
    getBrandBookExport.mockResolvedValue(ready);
    render();
    await TR.act(async () => button("Prepare CSV").props.onPress());
    TR.act(() => tree.update(
      <BrandBookExportSheet
        visible={false}
        onClose={onClose}
        brandId="d33e9214-bfb5-4cd8-8f15-0ce50f623bb9"
        contactCount={3}
        online
        authorized
        permissionCaption="Your role doesn't include this action. Ask a brand admin or above."
        onDownloaded={onDownloaded}
        onAuthRequired={jest.fn()}
        onPermissionDenied={jest.fn()}
      />,
    ));
    await TR.act(async () => {
      jest.advanceTimersByTime(2_000);
      await Promise.resolve();
    });
    expect(getBrandBookExport).toHaveBeenCalledWith("job-1776");
  });

  test("uses the slow cadence after 30 seconds", async () => {
    const start = new Date("2026-09-02T12:00:00Z");
    jest.useFakeTimers().setSystemTime(start);
    requestBrandBookExport.mockResolvedValue(queued);
    getBrandBookExport.mockResolvedValue(queued);
    render();
    await TR.act(async () => button("Prepare CSV").props.onPress());

    jest.setSystemTime(new Date(start.getTime() + 30_000));
    await TR.act(async () => {
      jest.advanceTimersByTime(2_000);
      await Promise.resolve();
    });
    expect(getBrandBookExport).toHaveBeenCalledTimes(1);
    await TR.act(async () => {
      jest.advanceTimersByTime(4_999);
      await Promise.resolve();
    });
    expect(getBrandBookExport).toHaveBeenCalledTimes(1);
    await TR.act(async () => {
      jest.advanceTimersByTime(1);
      await Promise.resolve();
    });
    expect(getBrandBookExport).toHaveBeenCalledTimes(2);
  });

  test("pauses in the background and checks immediately after foreground resume", async () => {
    let appStateChanged: ((state: string) => void) | null = null;
    jest.spyOn(AppState, "addEventListener").mockImplementation((event, listener: any) => {
      if (event === "change") appStateChanged = listener;
      return { remove: jest.fn() } as any;
    });
    jest.useFakeTimers().setSystemTime(new Date("2026-09-02T12:00:00Z"));
    requestBrandBookExport.mockResolvedValue(queued);
    getBrandBookExport.mockResolvedValue(queued);
    render();
    await TR.act(async () => button("Prepare CSV").props.onPress());

    TR.act(() => appStateChanged?.("background"));
    await TR.act(async () => {
      jest.advanceTimersByTime(10_000);
      await Promise.resolve();
    });
    expect(getBrandBookExport).not.toHaveBeenCalled();

    await TR.act(async () => {
      appStateChanged?.("active");
      await Promise.resolve();
    });
    expect(getBrandBookExport).toHaveBeenCalledTimes(1);
  });

  test("routes auth and permission failures without leaking edge detail", async () => {
    requestBrandBookExport.mockRejectedValueOnce(new BrandBookExportError("unauthorized"));
    render();
    await TR.act(async () => button("Prepare CSV").props.onPress());
    expect(onAuthRequired).toHaveBeenCalledTimes(1);
    expect(textOf(tree.toJSON())).not.toContain("unauthorized");

    requestBrandBookExport.mockRejectedValueOnce(new BrandBookExportError("forbidden"));
    await TR.act(async () => button("Prepare CSV").props.onPress());
    expect(onPermissionDenied).toHaveBeenCalledTimes(1);
    expect(textOf(tree.toJSON())).toContain(
      "Your role doesn't include this action. Ask a brand admin or above.",
    );
  });

  test("turns terminal expiry into a new-export action", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-09-02T12:00:00Z"));
    requestBrandBookExport.mockResolvedValue(queued);
    getBrandBookExport.mockResolvedValue({ ...queued, status: "expired" });
    render();
    await TR.act(async () => button("Prepare CSV").props.onPress());
    await TR.act(async () => {
      jest.advanceTimersByTime(2_000);
      await Promise.resolve();
    });
    expect(textOf(tree.toJSON())).toContain("This export expired.");
    expect(button("Prepare new CSV")).toBeDefined();
  });

  test("shows only the safe generic failure and retry action", async () => {
    requestBrandBookExport.mockRejectedValue(new Error("database storage detail"));
    render();
    await TR.act(async () => button("Prepare CSV").props.onPress());
    const copy = textOf(tree.toJSON());
    expect(copy).toContain("We couldn't prepare the export. Try again.");
    expect(copy).not.toContain("database storage detail");
    expect(button("Try again")).toBeDefined();
  });

  test("ignores a late export response after unmount", async () => {
    let resolveRequest: (job: typeof ready) => void = () => undefined;
    requestBrandBookExport.mockImplementation(() => new Promise((resolve) => {
      resolveRequest = resolve;
    }));
    render();
    let pending: Promise<void>;
    TR.act(() => {
      pending = button("Prepare CSV").props.onPress();
    });
    TR.act(() => tree.unmount());
    await TR.act(async () => {
      resolveRequest(ready);
      await pending!;
    });
    expect(getBrandBookExport).not.toHaveBeenCalled();
    expect(onDownloaded).not.toHaveBeenCalled();
  });

  test("locks the approved cadence, resume check, focus trap, and static reduced-motion state", () => {
    const source = readFileSync(path.resolve(__dirname, "../BrandBookExportSheet.tsx"), "utf8");
    expect(source).toContain("const POLL_FAST_MS = 2_000");
    expect(source).toContain("const FAST_WINDOW_MS = 30_000");
    expect(source).toContain("const POLL_SLOW_MS = 5_000");
    expect(source).toContain("const LONG_RUNNING_MS = 120_000");
    expect(source).toContain("const resumed = available && !availableRef.current");
    expect(source).toContain('event.key === "Escape"');
    expect(source).toContain("documentValue.activeElement");
    expect(source).toMatch(/reduceMotion\s*\?\s*\([\s\S]*?<Icon name="clock"/);
    expect(source).toContain('panelBackground={Platform.OS === "android" ? "#16181b" : undefined}');
  });
});
