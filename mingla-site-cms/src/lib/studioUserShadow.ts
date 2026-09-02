import { ValidationError, type PayloadRequest } from "payload";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type StudioUserShadow = {
  id?: unknown;
  core_user_id?: unknown;
  tenants?: unknown;
};

function isExactShadow(
  docs: StudioUserShadow[],
  coreUserId: string,
): boolean {
  return (
    docs.length === 1 &&
    docs[0]?.id === coreUserId &&
    docs[0]?.core_user_id === coreUserId &&
    Array.isArray(docs[0]?.tenants) &&
    docs[0].tenants.length === 0
  );
}

function isUniqueConflict(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const direct = error as { code?: unknown; cause?: unknown };
  const cause =
    direct.cause && typeof direct.cause === "object"
      ? (direct.cause as { code?: unknown })
      : null;
  if (direct.code === "23505" || cause?.code === "23505") return true;
  if (!(error instanceof ValidationError)) return false;
  return (
    error.data.collection === "studio-users" &&
    error.data.errors.length > 0 &&
    error.data.errors.every(
      ({ message, path }) =>
        message === "Value must be unique" &&
        (path === "id" || path === "core_user_id" || path == null),
    )
  );
}

async function readIdentityRows(
  req: PayloadRequest,
  coreUserId: string,
): Promise<StudioUserShadow[]> {
  const result = await req.payload.find({
    collection: "studio-users",
    overrideAccess: true,
    depth: 0,
    limit: 3,
    where: {
      or: [
        { id: { equals: coreUserId } },
        { core_user_id: { equals: coreUserId } },
      ],
    },
  });
  return result.docs as StudioUserShadow[];
}

/** Ensures the credential-free Payload metadata row for a verified Core user. */
export async function ensureStudioUserShadow(
  req: PayloadRequest,
  coreUserId: string,
): Promise<void> {
  if (!UUID.test(coreUserId)) throw new Error("STUDIO_USER_SHADOW_MISMATCH");

  const existing = await readIdentityRows(req, coreUserId);
  if (isExactShadow(existing, coreUserId)) return;
  if (existing.length > 0) throw new Error("STUDIO_USER_SHADOW_MISMATCH");

  try {
    await req.payload.db.create({
      collection: "studio-users",
      customID: coreUserId,
      data: { core_user_id: coreUserId, tenants: [] },
      req,
    });
  } catch (error) {
    if (!isUniqueConflict(error)) throw error;
  }

  const postcondition = await readIdentityRows(req, coreUserId);
  if (!isExactShadow(postcondition, coreUserId)) {
    throw new Error("STUDIO_USER_SHADOW_MISMATCH");
  }
}
