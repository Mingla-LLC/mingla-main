import type {
  CollectionBeforeChangeHook,
  CollectionSlug,
  PayloadRequest,
} from "payload";

function relationshipId(value: unknown): string | null {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (value && typeof value === "object" && "id" in value) {
    return String((value as { id: unknown }).id);
  }
  return null;
}

export function requestTenant(req: PayloadRequest): string {
  const sessionTenant = (req.user as { tenantId?: string } | null)?.tenantId;
  const internalTenant = req.context?.minglaSignedCore === true
    ? req.context?.minglaInternalTenantId
    : null;
  const tenantId = typeof sessionTenant === "string"
    ? sessionTenant
    : typeof internalTenant === "string"
      ? internalTenant
      : null;
  if (!tenantId || !/^[0-9a-f-]{36}$/i.test(tenantId)) {
    throw new Error("FORBIDDEN");
  }
  return tenantId;
}

function isSignedCore(req: PayloadRequest): boolean {
  return req.context?.minglaSignedCore === true;
}

export function singletonPerTenant(
  collection: CollectionSlug,
): CollectionBeforeChangeHook {
  return async ({ operation, originalDoc, req }) => {
    if (operation !== "create") return;
    const tenantId = requestTenant(req);
    const existing = await req.payload.find({
      collection,
      overrideAccess: isSignedCore(req),
      req,
      depth: 0,
      limit: 1,
      where: {
        and: [
          { tenant: { equals: tenantId } },
          ...(originalDoc?.id ? [{ id: { not_equals: originalDoc.id } }] : []),
        ],
      },
    });
    if (existing.totalDocs > 0) throw new Error("VALIDATION_FAILED");
  };
}

export async function assertReadyTenantMedia(
  req: PayloadRequest,
  values: unknown[],
): Promise<void> {
  const ids = [...new Set(values.map(relationshipId).filter((id): id is string => Boolean(id)))];
  if (!ids.length) return;
  const result = await req.payload.find({
    collection: "media",
    overrideAccess: isSignedCore(req),
    req,
    depth: 0,
    limit: ids.length,
    where: {
      and: [
        { tenant: { equals: requestTenant(req) } },
        { id: { in: ids } },
        { state: { equals: "READY" } },
      ],
    },
  });
  if (result.totalDocs !== ids.length) throw new Error("MEDIA_REJECTED");
}

export async function assertTenantPages(
  req: PayloadRequest,
  values: unknown[],
): Promise<void> {
  const ids = [...new Set(values.map(relationshipId).filter((id): id is string => Boolean(id)))];
  if (!ids.length) return;
  const result = await req.payload.find({
    collection: "pages",
    overrideAccess: isSignedCore(req),
    req,
    depth: 0,
    limit: ids.length,
    where: {
      and: [
        { tenant: { equals: requestTenant(req) } },
        { id: { in: ids } },
      ],
    },
  });
  if (result.totalDocs !== ids.length) throw new Error("VALIDATION_FAILED");
}
