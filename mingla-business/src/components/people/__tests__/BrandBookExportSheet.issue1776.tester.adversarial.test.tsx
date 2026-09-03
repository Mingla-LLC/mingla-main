import React from "react";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { View } from "react-native";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const requestBrandBookExport = jest.fn<(...args: any[]) => Promise<any>>();
const getBrandBookExport = jest.fn<(...args: any[]) => Promise<any>>();

jest.mock("../../../services/brandBookExportService", () => ({
  BrandBookExportError: class BrandBookExportError extends Error {
    public constructor(public readonly code: string) { super(code); }
  },
  createBrandBookExportRequestId: () => "17760000-0000-4000-8000-000000000099",
  requestBrandBookExport,
  getBrandBookExport,
}));
jest.mock("../../ui/Sheet", () => ({
  Sheet: ({ visible, children }: any) => visible ? React.createElement("MockSheet", null, children) : null,
}));
jest.mock("../../ui/Button", () => ({
  Button: React.forwardRef(function MockButton(_props: any, _ref) {
    return React.createElement("MockButton", _props);
  }),
}));
jest.mock("../../ui/Icon", () => ({ Icon: () => null }));
jest.mock("../../ui/Spinner", () => ({ Spinner: () => React.createElement(View) }));

import { BrandBookExportSheet } from "../BrandBookExportSheet";

const TR = require("react-test-renderer") as {
  create: (node: React.ReactElement) => any;
  act: (callback: () => void | Promise<void>) => void | Promise<void>;
};

const propsFor = (brandId: string) => ({
  visible: true,
  onClose: jest.fn(),
  brandId,
  contactCount: 2,
  online: true,
  authorized: true,
  permissionCaption: "Your role doesn't include this action. Ask a brand admin or above.",
  onDownloaded: jest.fn(),
  onAuthRequired: jest.fn(),
  onPermissionDenied: jest.fn(),
});

describe("#1776 tester: stale jobs never cross brand boundaries", () => {
  beforeEach(() => {
    requestBrandBookExport.mockReset();
    getBrandBookExport.mockReset();
  });

  test("ignores a completed export request after the operator switches brands", async () => {
    let resolveRequest: (job: any) => void = () => undefined;
    requestBrandBookExport.mockImplementation(() => new Promise((resolve) => {
      resolveRequest = resolve;
    }));

    let tree: any;
    TR.act(() => {
      tree = TR.create(<BrandBookExportSheet {...propsFor("brand-a")} />);
    });
    const prepare = tree.root.findAllByType("MockButton")
      .find((node: any) => node.props.label === "Prepare CSV");
    let pending: Promise<void>;
    TR.act(() => {
      pending = prepare.props.onPress();
    });

    TR.act(() => {
      tree.update(<BrandBookExportSheet {...propsFor("brand-b")} />);
    });
    await TR.act(async () => {
      resolveRequest({
        jobId: "job-for-brand-a",
        status: "ready",
        exportableCount: 2,
        result: { fileName: "brand-a.csv", expiresAt: "2026-09-03T12:00:00Z" },
        safeErrorCode: null,
        signedUrl: "https://signed.example/brand-a.csv",
      });
      await pending!;
    });

    const labels = tree.root.findAllByType("MockButton").map((node: any) => node.props.label);
    expect(labels).toContain("Prepare CSV");
    expect(labels).not.toContain("Download CSV");
  });
});
