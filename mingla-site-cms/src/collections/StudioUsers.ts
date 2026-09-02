import type { Access, CollectionConfig } from "payload";
import { noAccess } from "../lib/access";
import { callCore } from "../lib/gateway";
import { payloadUser, sessionFromHeaders } from "../lib/session";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const readExactStudioUser: Access = ({ req }) => {
  const user = req.user as Record<string, unknown> | null;
  const id = user?.id;
  if (
    user?.collection !== "studio-users" ||
    typeof id !== "string" ||
    !UUID.test(id)
  ) return false;
  return {
    id: { equals: id },
    core_user_id: { equals: id },
  };
};

type StudioMeHook = NonNullable<
  NonNullable<CollectionConfig["hooks"]>["me"]
>[number];

export const preserveLiveStudioUser: StudioMeHook = async ({ args, user }) => {
  const session = await sessionFromHeaders(args.req.headers);
  const live = args.req.user as Record<string, unknown> | null;
  const stored = user as Record<string, unknown> | null;
  const assignedTenants = live?.tenants;
  if (
    !session ||
    !stored ||
    stored.id !== session.user_id ||
    stored.core_user_id !== session.user_id ||
    !Array.isArray(stored.tenants) ||
    stored.tenants.length !== 0 ||
    live?.collection !== "studio-users" ||
    live.id !== session.user_id ||
    live.siteId !== session.site_id ||
    live.brandId !== session.brand_id ||
    live.tenantId !== session.tenant_id ||
    live.rank !== session.rank ||
    !Array.isArray(assignedTenants) ||
    assignedTenants.length !== 1 ||
    (assignedTenants[0] as Record<string, unknown> | undefined)?.tenant !==
      session.tenant_id
  ) throw new Error("FORBIDDEN");
  return {
    user: args.req.user as NonNullable<typeof args.req.user>,
    exp: Math.min(session.absolute_expires_at, session.idle_expires_at),
  };
};

// This is the single admin-shell admission decision for the custom session
// strategy. CRUD access to the hidden auth collection remains denied below.
export const canAccessStudioAdmin: NonNullable<CollectionConfig["access"]>["admin"] =
  ({ req }) => Boolean(req.user);

export const StudioUsers: CollectionConfig = {
  slug: "studio-users",
  auth: {
    disableLocalStrategy: true,
    useAPIKey: false,
    useSessions: false,
    removeTokenFromResponses: true,
    strategies: [
      {
        name: "mingla-studio",
        authenticate: async ({ headers }) => {
          const session = await sessionFromHeaders(headers);
          if (!session) return { user: null };
          try {
            await callCore(
              `/internal/v1/sites/${session.site_id}/authorize`,
              session.site_id,
              crypto.randomUUID(),
              { user_id: session.user_id, min_rank: 20 },
            );
            return { user: payloadUser(session) };
          } catch {
            return { user: null };
          }
        },
      },
    ],
  },
  admin: { hidden: true },
  hooks: { me: [preserveLiveStudioUser] },
  access: {
    admin: canAccessStudioAdmin,
    create: noAccess,
    read: readExactStudioUser,
    update: noAccess,
    delete: noAccess,
    readVersions: noAccess,
    unlock: noAccess,
  },
  fields: [
    { name: "core_user_id", type: "text", unique: true },
    {
      name: "tenants",
      type: "array",
      fields: [{ name: "tenant", type: "relationship", relationTo: "tenants" }],
    },
  ],
};
