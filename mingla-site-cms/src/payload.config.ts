import path from "node:path";
import { fileURLToPath } from "node:url";
import { postgresAdapter } from "@payloadcms/db-postgres";
import { multiTenantPlugin } from "@payloadcms/plugin-multi-tenant";
import { lexicalEditor } from "@payloadcms/richtext-lexical";
import { s3Storage } from "@payloadcms/storage-s3";
import { buildConfig } from "payload";
import sharp from "sharp";

import { Footer } from "./collections/Footer";
import { GatewayNonces } from "./collections/GatewayNonces";
import { Media } from "./collections/Media";
import { Navigation } from "./collections/Navigation";
import { Pages } from "./collections/Pages";
import { PublicationJobs } from "./collections/PublicationJobs";
import { SiteSettings } from "./collections/SiteSettings";
import { StudioUsers } from "./collections/StudioUsers";
import { Tenants } from "./collections/Tenants";
import { sitesEndpoints } from "./endpoints/sitesEndpoints";
import { cmsConfig } from "./lib/config";

const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);
const config = cmsConfig();

export default buildConfig({
  serverURL: config.cmsOrigin,
  secret: config.payloadSecret,
  db: postgresAdapter({
    pool: { connectionString: config.databaseUrl, max: 10 },
    schemaName: "sites_cms",
    idType: "uuid",
    migrationDir: path.resolve(dirname, "migrations"),
    push:
      process.env.NODE_ENV !== "production" &&
      process.env.PAYLOAD_LOCAL_SCHEMA_PUSH === "true",
    disableCreateDatabase: true,
  }),
  sharp,
  editor: lexicalEditor(),
  graphQL: { disable: true },
  admin: {
    user: "studio-users",
    meta: {
      titleSuffix: "— Mingla Studio",
      description: "Edit your Restaurant Website v1",
    },
    components: {
      Nav: "@/components/StudioNav#default",
      graphics: {
        Logo: "@/components/StudioLogo#default",
        Icon: "@/components/StudioLogo#default",
      },
    },
  },
  routes: {
    admin: "/admin",
    api: "/api",
    graphQL: "/disabled-graphql",
    graphQLPlayground: "/disabled-graphql-playground",
  },
  cors: [config.cmsOrigin, "https://business.usemingla.com"],
  csrf: [config.cmsOrigin],
  collections: [
    StudioUsers,
    Tenants,
    Pages,
    Media,
    Navigation,
    Footer,
    SiteSettings,
    PublicationJobs,
    GatewayNonces,
  ],
  endpoints: sitesEndpoints,
  plugins: [
    multiTenantPlugin({
      collections: {
        pages: {},
        media: {},
        navigation: {},
        footer: {},
        "site-settings": {},
        "publication-jobs": {},
      },
      tenantsSlug: "tenants",
      tenantsArrayField: { includeDefaultField: false },
      debug: false,
      userHasAccessToAllTenants: () => false,
      cleanupAfterTenantDelete: false,
    }),
    s3Storage({
      enabled: true,
      bucket: config.approvedBucket,
      acl: "private",
      disableLocalStorage: true,
      collections: {
        media: {
          prefix: "payload-approved",
          signedDownloads: { shouldUseSignedURL: () => false },
        },
      },
      config: {
        endpoint: config.storageEndpoint,
        region: config.storageRegion,
        forcePathStyle: true,
        credentials: {
          accessKeyId: config.storageAccessKeyId,
          secretAccessKey: config.storageSecretAccessKey,
        },
      },
    }),
  ],
  typescript: { outputFile: path.resolve(dirname, "payload-types.ts") },
});
