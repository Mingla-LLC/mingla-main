import type { CollectionConfig } from "payload";
import { noAccess } from "../lib/access";
import { callCore } from "../lib/gateway";
import { payloadUser, sessionFromHeaders } from "../lib/session";

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
  access: {
    admin: canAccessStudioAdmin,
    create: noAccess,
    read: noAccess,
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
