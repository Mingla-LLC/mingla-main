import { describe, expect, it } from "vitest";
import { assertReadyTenantMedia } from "./tenantIntegrity";

const TENANT_ID = "00000000-0000-4000-8000-000000000401";
const MEDIA_ID = "00000000-0000-4000-8000-000000000402";

describe("#2936 ready media relationship validation", () => {
  it("grants only the tenant-scoped Studio media query access to protected state", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const request = {
      context: {},
      user: { id: "user-1", tenantId: TENANT_ID },
      payload: {
        find: async (input: Record<string, unknown>) => {
          calls.push(input);
          const scoped = input.req as { context?: Record<string, unknown> };
          if (scoped.context?.minglaMediaGrant !== true) {
            throw new Error("STATE_FIELD_FORBIDDEN");
          }
          return { totalDocs: 1, docs: [{ id: MEDIA_ID }] };
        },
      },
    };

    await expect(
      assertReadyTenantMedia(request as never, [MEDIA_ID, MEDIA_ID]),
    ).resolves.toBeUndefined();

    expect(request.context).toEqual({});
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      collection: "media",
      overrideAccess: false,
      limit: 1,
      where: {
        and: [
          { tenant: { equals: TENANT_ID } },
          { id: { in: [MEDIA_ID] } },
          { state: { equals: "READY" } },
        ],
      },
    });
    expect(calls[0].req).not.toBe(request);
    expect(calls[0].req).toMatchObject({
      context: { minglaMediaGrant: true },
      user: request.user,
    });
  });

  it("preserves the existing signed-Core authority without converting it to Studio authority", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const request = {
      context: {
        minglaSignedCore: true,
        minglaInternalTenantId: TENANT_ID,
      },
      user: null,
      payload: {
        find: async (input: Record<string, unknown>) => {
          calls.push(input);
          return { totalDocs: 1, docs: [{ id: MEDIA_ID }] };
        },
      },
    };

    await expect(
      assertReadyTenantMedia(request as never, [MEDIA_ID]),
    ).resolves.toBeUndefined();

    expect(calls[0]).toMatchObject({
      overrideAccess: true,
      req: request,
    });
    expect(
      (calls[0].req as { context: Record<string, unknown> }).context,
    ).not.toHaveProperty("minglaMediaGrant");
  });
});
