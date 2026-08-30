import React from "react";

jest.mock("../../ui/Button", () => ({
  Button: ({ label }: { label: string }) =>
    require("react").createElement("mock-button", null, label),
}));
jest.mock("../../ui/GlassCard", () => ({
  GlassCard: ({ children }: { children: React.ReactNode }) =>
    require("react").createElement("mock-card", null, children),
}));
jest.mock("../../ui/Icon", () => ({ Icon: () => null }));

import { BrandWebsiteView } from "../BrandWebsiteView";

const { act, create } = require("react-test-renderer") as {
  act: (run: () => void) => void;
  create: (node: React.ReactElement) => { toJSON: () => unknown };
};

const site = {
  id: "00000000-0000-4000-8000-000000000001",
  brand_id: "00000000-0000-4000-8000-000000000002",
  renderer_key: "restaurant-website-v1" as const,
  renderer_version: 1,
  status: "provisioning" as const,
  active_publication_id: null,
  last_successful_publication_id: null,
  provisioning_error_code: null,
  created_at: "2026-08-30T12:00:00Z",
  updated_at: "2026-08-30T12:00:00Z",
  brand_site_hosts: [],
  latest_provision_operation: null,
};

describe("#2830 Website state 4", () => {
  it("shows receipt progress and no editing, preview, publish or insight action", () => {
    let tree!: { toJSON: () => unknown };
    act(() => {
      tree = create(
        <BrandWebsiteView
          brandName="Gogi"
          site={site}
          rank={50}
          isLoading={false}
          isError={false}
          isProvisioning={false}
          isOpeningStudio={false}
          isPreviewing={false}
          isPublishing={false}
          isRollingBack={false}
          versions={[]}
          analytics={null}
          provisionOperationId="00000000-0000-4000-8000-000000000003"
          provisionOperation={null}
          provisionPollingTimedOut={false}
          isReconciling={false}
          onRetry={jest.fn()}
          onProvision={jest.fn()}
          onReconcileProvision={jest.fn()}
          onOpenStudio={jest.fn()}
          onPreview={jest.fn()}
          onViewLive={jest.fn()}
          onOpenAri={jest.fn()}
          onPublish={jest.fn()}
          onRollback={jest.fn()}
        />,
      );
    });
    const content = JSON.stringify(tree.toJSON());
    expect(content).toContain("Setting up your Website");
    for (const forbidden of [
      "Open Mingla Studio",
      "Preview draft",
      "Publish Website",
      "Edit with Ari",
      "Analytics",
      "Versions",
    ]) {
      expect(content).not.toContain(forbidden);
    }
  });

  it("shows reconcile only after timeout and only at rank 50+", () => {
    const renderAt = (rank: number) => {
      let tree!: { toJSON: () => unknown };
      act(() => {
        tree = create(
          <BrandWebsiteView
            brandName="Gogi" site={site} rank={rank} isLoading={false}
            isError={false} isProvisioning={false} isOpeningStudio={false}
            isPreviewing={false} isPublishing={false} isRollingBack={false}
            versions={[]} analytics={null}
            provisionOperationId="00000000-0000-4000-8000-000000000003"
            provisionOperation={null} provisionPollingTimedOut
            isReconciling={false} onRetry={jest.fn()} onProvision={jest.fn()}
            onReconcileProvision={jest.fn()} onOpenStudio={jest.fn()}
            onPreview={jest.fn()} onViewLive={jest.fn()}
            onOpenAri={jest.fn()} onPublish={jest.fn()}
            onRollback={jest.fn()}
          />,
        );
      });
      return JSON.stringify(tree.toJSON());
    };
    expect(renderAt(50)).toContain("Check setup status");
    expect(renderAt(40)).not.toContain("Check setup status");
    expect(renderAt(40)).toContain("A brand admin can check");
  });
});
