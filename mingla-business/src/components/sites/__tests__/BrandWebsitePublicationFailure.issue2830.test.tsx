import React from "react";

jest.mock("../../ui/Button", () => ({
  Button: ({ label, onPress }: { label: string; onPress: () => void }) =>
    require("react").createElement("mock-button", { onPress }, label),
}));
jest.mock("../../ui/GlassCard", () => ({
  GlassCard: ({ children }: { children: React.ReactNode }) =>
    require("react").createElement("mock-card", null, children),
}));
jest.mock("../../ui/Icon", () => ({ Icon: () => null }));

import { BrandWebsiteView } from "../BrandWebsiteView";
import type { BrandSiteOperation, BrandSiteOverview } from "../../../sites/contracts";

const { act, create } = require("react-test-renderer") as {
  act: (run: () => void) => void;
  create: (node: React.ReactElement) => {
    root: {
      findAllByType: (type: string) => Array<{
        props: { onPress: () => void };
        children: string[];
      }>;
    };
    toJSON: () => unknown;
  };
};

const site: BrandSiteOverview = {
  id: "00000000-0000-4000-8000-000000000001",
  brand_id: "00000000-0000-4000-8000-000000000002",
  renderer_key: "restaurant-website-v1",
  renderer_version: 1,
  status: "published",
  active_publication_id: "00000000-0000-4000-8000-000000000003",
  last_successful_publication_id: "00000000-0000-4000-8000-000000000003",
  provisioning_error_code: null,
  created_at: "2026-08-30T12:00:00Z",
  updated_at: "2026-08-30T12:00:00Z",
  brand_site_hosts: [{
    hostname: "gogi.sites.usemingla.com",
    status: "active",
    is_primary: true,
  }],
};

const operation: BrandSiteOperation = {
  operation_id: "00000000-0000-4000-8000-000000000004",
  site_id: site.id,
  kind: "publish",
  status: "failed",
  error_code: "PROBE_FAILED",
  authorized_at: "2026-08-30T12:00:00Z",
  updated_at: "2026-08-30T12:01:00Z",
  result_summary: { retryable: true },
};

function renderFailure(
  receipt: BrandSiteOperation,
  reset = jest.fn(),
) {
  let tree!: ReturnType<typeof create>;
  act(() => {
    tree = create(
      <BrandWebsiteView
        brandName="Gogi" site={site} rank={50} journeyState={
          receipt.status === "failed" ? 28 : 14
        }
        panel="overview" notice={null} isLoading={false} isError={false}
        isProvisioning={false} isOpeningStudio={false} isPreviewing={false}
        isPublishing={false} isRollingBack={false} isValidating={false}
        versions={[]} analytics={null} validation={null}
        validationFailure={null} selectedVersion={null}
        provisionOperationId={null} provisionOperation={null}
        provisionPollingTimedOut={false}
        publicationOperationId={receipt.operation_id}
        publicationOperation={receipt} publicationPollingTimedOut={false}
        isReconciling={false} onRetry={jest.fn()} onSetPanel={jest.fn()}
        onProvision={jest.fn()} onReconcileProvision={jest.fn()}
        onOpenStudio={jest.fn()} onPreview={jest.fn()} onViewLive={jest.fn()}
        onOpenAri={jest.fn()} onValidatePublish={jest.fn()}
        onPublish={jest.fn()} onSelectRollback={jest.fn()}
        onRollback={jest.fn()} onReconcilePublication={jest.fn()}
        onResetFailedPublication={reset}
      />,
    );
  });
  return tree;
}

describe("#2830 terminal publication recovery UI", () => {
  it("preserves failure evidence and requires an explicit retry reset", () => {
    const reset = jest.fn();
    const tree = renderFailure(operation, reset);
    const content = JSON.stringify(tree.toJSON());
    expect(content).toContain("Last good preserved");
    expect(content).toContain("Try again");
    expect(content).toContain("View live website");
    expect(content).toContain("View operation details");
    const button = tree.root.findAllByType("mock-button").find(
      (candidate) => candidate.children.includes("Try again"),
    );
    act(() => button?.props.onPress());
    expect(reset).toHaveBeenCalledTimes(1);
    const details = tree.root.findAllByType("mock-button").find(
      (candidate) => candidate.children.includes("View operation details"),
    );
    act(() => details?.props.onPress());
    expect(JSON.stringify(tree.toJSON())).toContain(operation.operation_id);
  });

  it("routes a non-retryable verified failure to review before any new operation", () => {
    const content = JSON.stringify(renderFailure({
      ...operation,
      result_summary: { retryable: false },
    }).toJSON());
    expect(content).toContain("Review fixes");
    expect(content).not.toContain("Try again");
  });

  it("never exposes the failed-reset action for an ambiguous durable outcome", () => {
    const tree = renderFailure({ ...operation, status: "ambiguous" });
    const content = JSON.stringify(tree.toJSON());
    expect(content).toContain("Check the same operation");
    expect(content).not.toContain("Review fixes");
    expect(content).not.toContain("Try again");
  });
});
