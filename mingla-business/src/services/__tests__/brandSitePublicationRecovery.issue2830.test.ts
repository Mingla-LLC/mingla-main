import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  canResetFailedPublicationOperation,
  clearPublicationOperation,
  failedRollbackReviewVersion,
  loadPublicationOperation,
  persistPublicationOperation,
  publishBrandSite,
  rollbackBrandSite,
  type PersistedPublicationOperation,
} from "../brandSitesService";
import type { BrandSiteOperation, BrandSiteVersion } from "../../sites/contracts";
import { supabase } from "../supabase";

jest.mock("../supabase", () => ({
  supabase: { functions: { invoke: jest.fn() } },
}));

const operation: PersistedPublicationOperation = {
  accountId: "00000000-0000-4000-8000-000000000001",
  brandId: "00000000-0000-4000-8000-000000000002",
  siteId: "00000000-0000-4000-8000-000000000003",
  operationId: "00000000-0000-4000-8000-000000000004",
  kind: "publish",
  startedAt: 1_788_086_400_000,
  expectedRevision: "42",
  sourceDigest: "a".repeat(64),
  rollbackSourcePublicationId: null,
};

describe("#2830 durable publication recovery", () => {
  afterEach(() => jest.restoreAllMocks());

  it("persists and clears the exact operation under account + brand + site scope", async () => {
    const set = jest.spyOn(AsyncStorage, "setItem").mockResolvedValue();
    const remove = jest.spyOn(AsyncStorage, "removeItem").mockResolvedValue();
    await persistPublicationOperation(operation);
    expect(set).toHaveBeenCalledWith(
      `mingla:brand-site-publication:v1:${operation.accountId}:${operation.brandId}:${operation.siteId}`,
      JSON.stringify(operation),
    );
    await clearPublicationOperation(operation);
    expect(remove).toHaveBeenCalledWith(
      `mingla:brand-site-publication:v1:${operation.accountId}:${operation.brandId}:${operation.siteId}`,
    );
  });

  it("restores only a shape that matches all three scope keys", async () => {
    jest.spyOn(AsyncStorage, "getItem").mockResolvedValue(JSON.stringify(operation));
    await expect(loadPublicationOperation(operation)).resolves.toEqual(operation);
    await expect(
      loadPublicationOperation({ ...operation, brandId: "00000000-0000-4000-8000-000000000009" }),
    ).resolves.toBeNull();
  });

  it("fails open when local persistence is blocked because Core remains authoritative", async () => {
    jest.spyOn(AsyncStorage, "getItem").mockRejectedValue(new Error("blocked"));
    jest.spyOn(AsyncStorage, "setItem").mockRejectedValue(new Error("blocked"));
    jest.spyOn(AsyncStorage, "removeItem").mockRejectedValue(new Error("blocked"));
    await expect(loadPublicationOperation(operation)).resolves.toBeNull();
    await expect(persistPublicationOperation(operation)).resolves.toBeUndefined();
    await expect(clearPublicationOperation(operation)).resolves.toBeUndefined();
  });

  it("passes the same client operation ID through publish and rollback", async () => {
    const invoke = supabase.functions.invoke as jest.Mock;
    invoke.mockResolvedValue({
      data: { ok: true, data: { status: "executing" } },
      error: null,
    });
    await publishBrandSite({
      siteId: operation.siteId,
      operationId: operation.operationId,
      expectedRevision: operation.expectedRevision,
      sourceDigest: operation.sourceDigest,
    });
    await rollbackBrandSite({
      siteId: operation.siteId,
      operationId: operation.operationId,
      sourceRevision: operation.expectedRevision,
      sourceDigest: operation.sourceDigest,
    });
    expect(invoke).toHaveBeenNthCalledWith(
      1,
      "brand-site-control",
      expect.objectContaining({
        body: expect.objectContaining({ operation_id: operation.operationId }),
      }),
    );
    expect(invoke).toHaveBeenNthCalledWith(
      2,
      "brand-site-control",
      expect.objectContaining({
        body: expect.objectContaining({ operation_id: operation.operationId }),
      }),
    );
  });

  it("allows explicit reset only for the matching authoritative failed receipt", () => {
    const receipt: BrandSiteOperation = {
      operation_id: operation.operationId,
      site_id: operation.siteId,
      kind: "publish",
      status: "failed",
      error_code: "PROBE_FAILED",
      authorized_at: "2026-08-30T12:00:00Z",
      updated_at: "2026-08-30T12:01:00Z",
      result_summary: { retryable: true },
    };
    expect(canResetFailedPublicationOperation(operation, receipt)).toBe(true);
    expect(canResetFailedPublicationOperation(operation, {
      ...receipt,
      status: "executing",
    })).toBe(false);
    expect(canResetFailedPublicationOperation(operation, {
      ...receipt,
      status: "ambiguous",
    })).toBe(false);
    expect(canResetFailedPublicationOperation(operation, {
      ...receipt,
      operation_id: "00000000-0000-4000-8000-000000000009",
    })).toBe(false);
    expect(canResetFailedPublicationOperation(operation, {
      ...receipt,
      site_id: "00000000-0000-4000-8000-000000000009",
    })).toBe(false);
  });

  it("recovers a failed rollback into the exact immutable version review", () => {
    const rollbackOperation: PersistedPublicationOperation = {
      ...operation,
      kind: "rollback",
      rollbackSourcePublicationId: "00000000-0000-4000-8000-000000000005",
    };
    const version: BrandSiteVersion = {
      id: rollbackOperation.rollbackSourcePublicationId!,
      site_id: operation.siteId,
      source_revision_id: operation.expectedRevision,
      source_digest: operation.sourceDigest,
      artifact_digest: null,
      renderer_version: 1,
      status: "published",
      previous_publication_id: null,
      rollback_source_publication_id: null,
      requested_at: "2026-08-30T12:00:00Z",
      completed_at: "2026-08-30T12:01:00Z",
      failure_code: null,
    };
    expect(failedRollbackReviewVersion(rollbackOperation, [version])).toEqual(
      version,
    );
    expect(failedRollbackReviewVersion(operation, [version])).toBeNull();
  });
});
