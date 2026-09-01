import type { PayloadRequest } from "payload";
import {
  sessionFromHeaders,
  type StudioSession,
} from "./session";

type StudioRequestUser = {
  id?: unknown;
  collection?: unknown;
  siteId?: unknown;
  brandId?: unknown;
  tenantId?: unknown;
  rank?: unknown;
};

export function studioUserMatchesSession(
  user: unknown,
  session: StudioSession,
): boolean {
  if (!user || typeof user !== "object" || Array.isArray(user)) return false;
  const current = user as StudioRequestUser;
  return current.collection === "studio-users" &&
    current.id === session.user_id &&
    current.siteId === session.site_id &&
    current.brandId === session.brand_id &&
    current.tenantId === session.tenant_id &&
    current.rank === session.rank;
}

/**
 * Accepts Studio cookies only after Payload's Core-backed custom auth strategy
 * has authenticated the same actor. The returned scope deliberately strips
 * the signed-Core bypass so collection write hooks authorize Core again.
 */
export async function requireAuthenticatedStudioRequest(
  req: PayloadRequest,
): Promise<{ session: StudioSession; request: PayloadRequest }> {
  const session = await sessionFromHeaders(req.headers);
  if (!session || !req.user) throw new Error("SESSION_EXPIRED");
  if (!studioUserMatchesSession(req.user, session)) {
    throw new Error("FORBIDDEN");
  }
  const context = { ...req.context };
  delete context.minglaSignedCore;
  return {
    session,
    request: Object.assign(Object.create(req) as PayloadRequest, {
      context,
      user: req.user,
    }),
  };
}

export function studioMediaGrantRequest(
  req: PayloadRequest,
): PayloadRequest {
  const context: PayloadRequest["context"] = {
    ...req.context,
    minglaMediaGrant: true,
  };
  delete context.minglaSignedCore;
  return Object.assign(Object.create(req) as PayloadRequest, { context });
}

/**
 * Loads the page through ordinary Studio authority so its later mutation must
 * reauthorize against Core, while exposing protected processing fields only on
 * the tenant-scoped Media read.
 */
export async function loadStudioMediaAttachRecords(
  request: PayloadRequest,
  pageId: string,
  mediaId: string,
) {
  const [page, media] = await Promise.all([
    request.payload.findByID({
      collection: "pages",
      id: pageId,
      overrideAccess: false,
      req: request,
      draft: true,
      depth: 0,
    }),
    request.payload.findByID({
      collection: "media",
      id: mediaId,
      overrideAccess: false,
      req: studioMediaGrantRequest(request),
      depth: 0,
    }),
  ]);
  return { page, media };
}
