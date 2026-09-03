import React from "react";

jest.mock("../../ui/Button", () => ({
  Button: ({ label }: { label: string }) =>
    require("react").createElement("mock-button", null, label),
}));
jest.mock("../../ui/GlassCard", () => ({
  // forward testID: PanelCard identifies each panel through it, so a mock that
  // swallows it makes every panel assertion silently unfindable.
  GlassCard: ({
    children,
    testID,
  }: {
    children: React.ReactNode;
    testID?: string;
  }) => require("react").createElement("mock-card", { testID }, children),
}));
jest.mock("../../ui/Icon", () => ({ Icon: () => null }));

import { BrandWebsiteView } from "../BrandWebsiteView";
import type { BrandSiteOverview } from "../../../sites/contracts";

const { act, create } = require("react-test-renderer") as {
  act: (run: () => void) => void;
  create: (node: React.ReactElement) => { toJSON: () => unknown };
};

/** Collect every testID in the rendered tree. `toJSON` nests them under `props`. */
function testIds(node: React.ReactElement): string[] {
  let tree: { toJSON: () => unknown } | null = null;
  act(() => {
    tree = create(node);
  });
  const found: string[] = [];
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (!value || typeof value !== "object") return;
    const record = value as {
      props?: Record<string, unknown>;
      children?: unknown;
    };
    const id = record.props?.testID;
    if (typeof id === "string") found.push(id);
    if (record.children !== undefined) walk(record.children);
  };
  walk((tree as unknown as { toJSON: () => unknown }).toJSON());
  return found;
}

const site: BrandSiteOverview = {
  id: "11111111-2222-4333-8444-555555555555",
  brand_id: "22222222-3333-4444-8555-666666666666",
  renderer_key: "restaurant-website-v1",
  renderer_version: 1,
  status: "published",
  active_publication_id: "33333333-4444-4555-8666-777777777777",
  last_successful_publication_id: "33333333-4444-4555-8666-777777777777",
  provisioning_error_code: null,
  created_at: new Date("2026-08-30T09:00:00Z").toISOString(),
  updated_at: new Date("2026-09-01T11:22:14Z").toISOString(),
  brand_site_hosts: [
    {
      hostname: "gogi.sites.usemingla.com",
      status: "active",
      is_primary: true,
    },
  ],
  latest_provision_operation: null,
};

const base = {
  brandName: "Gogi Lagos",
  site,
  rank: 60,
  journeyState: 15 as const,
  panel: "overview" as const,
  notice: null,
  isLoading: false,
  isError: false,
  isProvisioning: false,
  isOpeningStudio: false,
  isPreviewing: false,
  isPublishing: false,
  isRollingBack: false,
  isValidating: false,
  versions: [],
  analytics: null,
  validation: null,
  validationFailure: null,
  selectedVersion: null,
  provisionOperationId: null,
  provisionOperation: null,
  provisionPollingTimedOut: false,
  publicationOperationId: null,
  publicationOperation: null,
  publicationPollingTimedOut: false,
  isReconciling: false,
  onRetry: jest.fn(),
  onSetPanel: jest.fn(),
  onProvision: jest.fn(),
  onReconcileProvision: jest.fn(),
  onOpenStudio: jest.fn(),
  onPreview: jest.fn(),
  onViewLive: jest.fn(),
  onOpenAri: jest.fn(),
  onValidatePublish: jest.fn(),
  onPublish: jest.fn(),
  onSelectRollback: jest.fn(),
  onRollback: jest.fn(),
  onReconcilePublication: jest.fn(),
  onResetFailedPublication: jest.fn(),
};

describe("#2830 Website workspace desktop layout", () => {
  it("wide desktop renders the SHARED suite shell, not a third layout", () => {
    expect(testIds(<BrandWebsiteView {...base} isWideDesktop />)).toContain(
      "website-desktop-shell",
    );
  });

  it("wide desktop puts the draft beside the controls", () => {
    const ids = testIds(<BrandWebsiteView {...base} isWideDesktop />);
    expect(ids).toContain("website-preview-pane");
    expect(ids).toContain("website-overview");
  });

  it("every rail entry is reachable", () => {
    const ids = testIds(<BrandWebsiteView {...base} isWideDesktop />);
    for (const key of [
      "overview",
      "publish",
      "versions",
      "analytics",
      "address",
    ]) {
      expect(ids).toContain(`website-rail-${key}`);
    }
  });

  it("MOBILE IS UNCHANGED -- no shell, no pane, same overview card", () => {
    const ids = testIds(<BrandWebsiteView {...base} isWideDesktop={false} />);
    expect(ids).not.toContain("website-desktop-shell");
    expect(ids).not.toContain("website-preview-pane");
    expect(ids).toContain("website-overview");
  });
});
