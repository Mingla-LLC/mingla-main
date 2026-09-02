import type {
  Access,
  CollectionBeforeOperationHook,
  FieldAccess,
} from "payload";
import { cmsConfig } from "./config";
import { callCore } from "./gateway";
import { assertMutationRequest } from "./session";

type StudioUser = {
  tenantId?: string;
  siteId?: string;
  brandId?: string;
  rank?: number;
};
function user(req: { user?: unknown }): StudioUser | null {
  return req.user && typeof req.user === "object"
    ? (req.user as StudioUser)
    : null;
}
export const noAccess: Access = () => false;
export const tenantRead: Access = ({ req }) => {
  const current = user(req);
  return current?.rank && current.rank >= 20 && current.tenantId
    ? { tenant: { equals: current.tenantId } }
    : false;
};
export const tenantVersionRead: Access = ({ req }) => {
  const current = user(req);
  return typeof current?.rank === "number" &&
    current.rank >= 20 &&
    typeof current.tenantId === "string" &&
    current.tenantId.length > 0
    ? { "version.tenant": { equals: current.tenantId } }
    : false;
};
export const tenantWrite: Access = tenantRead;
export const tenantMediaCreate: Access = ({ req }) => {
  if (req.context?.minglaMediaGrant !== true) return false;
  return tenantRead({ req } as Parameters<Access>[0]);
};
export const tenantFieldAccess: FieldAccess = ({ req }) =>
  Boolean(user(req)?.rank && user(req)!.rank! >= 20);
export function sessionTenant(req: { user?: unknown }): string | null {
  return user(req)?.tenantId || null;
}

export const enforceLiveStudioWrite: CollectionBeforeOperationHook = async ({
  operation,
  overrideAccess,
  req,
}) => {
  if (
    overrideAccess ||
    !["create", "update", "delete", "restoreVersion"].includes(operation)
  )
    return;
  const current = user(req);
  if (
    !current?.siteId ||
    !current.brandId ||
    !current.rank ||
    current.rank < 20 ||
    (req.context?.minglaSignedCore !== true &&
      req.headers.get("origin") !== cmsConfig().cmsOrigin)
  )
    throw new Error("FORBIDDEN");
  if (req.context?.minglaSignedCore !== true) {
    assertMutationRequest(req.headers);
  }
  await callCore(
    `/internal/v1/sites/${current.siteId}/authorize`,
    current.siteId,
    crypto.randomUUID(),
    { user_id: req.user?.id, min_rank: 20 },
  );
};
