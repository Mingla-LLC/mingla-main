import { afterEach, describe, expect, it, vi } from "vitest";
import type { PayloadRequest } from "payload";
import { observeUploadGrantFailure } from "./uploadGrantObservability";

const SITE_ID = "90f19f28-42e2-4eb9-b88b-02829bfcb045";
const REQUEST_ID = "0fa35d7e-9a65-4a83-8419-1efa098a52d6";

function request(): PayloadRequest {
  return {
    headers: new Headers({ "x-request-id": REQUEST_ID }),
    user: { siteId: SITE_ID },
  } as unknown as PayloadRequest;
}

describe("#2931 upload-grant failure observability", () => {
  afterEach(() => vi.restoreAllMocks());

  it("records the exact safe stage and allowlisted rejection code", () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);

    observeUploadGrantFailure(
      request(),
      "grant_media_update",
      new Error("FORBIDDEN"),
    );

    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({
      metric: "cms.media.upload_grant_failure",
      request_id: REQUEST_ID,
      site_id: SITE_ID,
      state_transition: "upload_grant_grant_media_update->request_rejected",
      safe_error_code: "FORBIDDEN",
      status_code: 403,
    });
  });

  it("never writes an unexpected exception message to the observation", () => {
    const log = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const sensitiveMessage = "postgresql://operator:secret@private.example";

    observeUploadGrantFailure(
      request(),
      "body_parsing",
      new Error(sensitiveMessage),
    );

    const serialized = String(log.mock.calls[0]?.[0]);
    expect(serialized).not.toContain(sensitiveMessage);
    expect(JSON.parse(serialized)).toMatchObject({
      state_transition: "upload_grant_body_parsing->request_rejected",
      safe_error_code: "SERVICE_TEMPORARILY_UNAVAILABLE",
      status_code: 503,
    });
  });
});
