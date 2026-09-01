import { describe, expect, it, vi } from "vitest";
import type { PayloadRequest } from "payload";

vi.mock("./config", () => ({
  cmsConfig: () => ({
    previewSecret: "QUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUE=",
  }),
}));

import {
  requireAuthenticatedStudioRequest,
  studioMediaGrantRequest,
} from "./studioRequestAuth";
import {
  encodeSession,
  payloadUser,
  STUDIO_COOKIE,
} from "./session";

const session = {
  version: 1 as const,
  site_id: "00000000-0000-4000-8000-000000000011",
  brand_id: "00000000-0000-4000-8000-000000000012",
  user_id: "00000000-0000-4000-8000-000000000013",
  rank: 60,
  tenant_id: "00000000-0000-4000-8000-000000000014",
  issued_at: Math.floor(Date.now() / 1000),
  absolute_expires_at: Math.floor(Date.now() / 1000) + 3600,
  idle_expires_at: Math.floor(Date.now() / 1000) + 1800,
  nonce: "00000000-0000-4000-8000-000000000015",
  return_surface: "web" as const,
};

describe("#2931 Studio Payload request state", () => {
  it("preserves non-enumerable HTTP state while stripping signed-Core authority", async () => {
    const headers = new Headers({
      cookie: `${STUDIO_COOKIE}=${encodeURIComponent(await encodeSession(session))}`,
      origin: "https://studio.invalid",
    });
    const original = {
      user: payloadUser(session),
      context: { minglaSignedCore: true },
    } as unknown as PayloadRequest;
    Object.defineProperty(original, "headers", {
      configurable: true,
      enumerable: false,
      value: headers,
    });
    const opaquePayloadState = Symbol("opaque-payload-request-state");
    Object.defineProperty(original, opaquePayloadState, {
      enumerable: false,
      value: "preserved",
    });

    const authorized = await requireAuthenticatedStudioRequest(original);
    const mediaRead = studioMediaGrantRequest(authorized.request);

    expect(authorized.request).not.toBe(original);
    expect(authorized.request.headers).toBe(headers);
    expect(
      (authorized.request as PayloadRequest & { [opaquePayloadState]: string })[
        opaquePayloadState
      ],
    ).toBe("preserved");
    expect(authorized.request.context).not.toHaveProperty("minglaSignedCore");
    expect(mediaRead.headers).toBe(headers);
    expect(mediaRead.context).toMatchObject({ minglaMediaGrant: true });
    expect(mediaRead.context).not.toHaveProperty("minglaSignedCore");
  });
});
