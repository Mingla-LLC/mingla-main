import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { postgresAdapter } from "@payloadcms/db-postgres";
import { multiTenantPlugin } from "@payloadcms/plugin-multi-tenant";
import { lexicalEditor } from "@payloadcms/richtext-lexical";
import { s3Storage } from "@payloadcms/storage-s3";
import { buildConfig } from "payload";
import sharp from "sharp";

import { FontAssets } from "./collections/FontAssets";
import { Footer } from "./collections/Footer";
import { GatewayNonces } from "./collections/GatewayNonces";
import { Media } from "./collections/Media";
import { Navigation } from "./collections/Navigation";
import { Pages } from "./collections/Pages";
import { PublicationJobs } from "./collections/PublicationJobs";
import { SiteSettings } from "./collections/SiteSettings";
import { Categories, Destinations, Stories, Testimonials } from "./collections/SiteContent";
import { StudioUsers } from "./collections/StudioUsers";
import { Tenants } from "./collections/Tenants";
import { WorkLog } from "./collections/WorkLog";
import { DesignCheckRuns } from "./collections/DesignCheckRuns";
import { fontEndpoints } from "./endpoints/fontEndpoints";
import { sitesEndpoints } from "./endpoints/sitesEndpoints";
import { composeEndpoints } from "./endpoints/composeEndpoint";
import { contentEndpoints } from "./endpoints/contentEndpoint";
import { cmsConfig } from "./lib/config";

const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);
const config = cmsConfig();
const databaseConnectionUrl = new URL(config.databaseUrl);
databaseConnectionUrl.searchParams.delete("sslmode");
const supabaseRootCa = readFileSync(
  path.resolve(dirname, "certs", "supabase-prod-ca-2021.crt"),
  "utf8",
);

export default buildConfig({
  serverURL: config.cmsOrigin,
  secret: config.payloadSecret,
  db: postgresAdapter({
    pool: {
      connectionString: databaseConnectionUrl.toString(),
      max: config.databasePoolMax,
      // #2829 — production keeps the pinned CA with full verification. Local
      // mode (config.ts has already proven the database host is loopback)
      // talks to the local Sites CMS stack, which has no TLS.
      ssl: config.mode === "local"
        ? false
        : {
          ca: supabaseRootCa,
          rejectUnauthorized: true,
        },
    },
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
    // #2829 A8: Payload's default "gravatar" makes every Studio page request
    // www.gravatar.com with a hash of the signed-in owner's email. No
    // third-party request on an admin page: use Payload's built-in avatar.
    avatar: "default",
    meta: {
      titleSuffix: "— Mingla Studio",
      description: "Edit your website",
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
  // #2829 W9f — the configured Business origin (local Business web locally).
  cors: [config.cmsOrigin, config.businessOrigin],
  csrf: [config.cmsOrigin],
  collections: [
    StudioUsers,
    Tenants,
    Pages,
    Media,
    Navigation,
    Footer,
    SiteSettings,
    Destinations,
    Categories,
    Stories,
    Testimonials,
    PublicationJobs,
    GatewayNonces,
    FontAssets,
    // #2829 W9b — "Why it looks like this" and the design checks' results.
    WorkLog,
    DesignCheckRuns,
  ],
  endpoints: [...sitesEndpoints, ...fontEndpoints, ...composeEndpoints, ...contentEndpoints],
  plugins: [
    multiTenantPlugin({
      collections: {
        pages: {},
        media: {},
        navigation: {},
        footer: {},
        "site-settings": {},
        // #2829 W5 — the site's content collections, scoped like pages.
        destinations: {},
        categories: {},
        stories: {},
        testimonials: {},
        "publication-jobs": {},
        "work-log": {},
        "design-check-runs": {},
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
