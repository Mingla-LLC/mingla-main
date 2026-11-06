// #2830 — shared fixture for the multi-tenant recovery suites: one pilot with a
// live publication, one draft-only brand and one brand with no documents yet.
import { createHash } from "node:crypto";

export const PROJECT_REF = "a1b2c3d4e5f6g7h8i9j0";
export const PILOT = {
  tenant_id: "10000000-0000-4000-8000-000000002830",
  site_id: "20000000-0000-4000-8000-000000002830",
};
export const DRAFT = {
  tenant_id: "10000000-0000-4000-8000-000000002831",
  site_id: "20000000-0000-4000-8000-000000002831",
};
export const EMPTY = {
  tenant_id: "10000000-0000-4000-8000-000000002832",
  site_id: "20000000-0000-4000-8000-000000002832",
};
export const PILOT_MEDIA = "30000000-0000-4000-8000-000000002830";
export const DRAFT_MEDIA = "30000000-0000-4000-8000-000000002831";
export const DRAFT_STREAM = "30000000-0000-4000-8000-000000002832";
export const PUBLICATION = "40000000-0000-4000-8000-000000002830";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const HASH = "a".repeat(64);

export function fixtureObjects() {
  const pilotMaster = `approved/${PILOT.site_id}/${PILOT_MEDIA}/${HASH}/master.webp`;
  const draftMaster = `approved/${DRAFT.site_id}/${DRAFT_MEDIA}/${HASH}/master.webp`;
  const pilotBytes = Buffer.from("pilot-master");
  const draftBytes = Buffer.from("draft-master");
  const artifact = Buffer.from(JSON.stringify({
    site_id: PILOT.site_id,
    media: [{ id: PILOT_MEDIA, object_key: pilotMaster }],
  }));
  const artifactKey = `publications/${PILOT.site_id}/${PUBLICATION}/${sha256(artifact)}.json`;
  return {
    artifactKey,
    artifactDigest: sha256(artifact),
    pilotMaster,
    draftMaster,
    pilotManifest: {
      version: 1,
      master: { key: pilotMaster, digest: sha256(pilotBytes), bytes: pilotBytes.byteLength },
      renditions: [],
    },
    draftManifest: {
      version: 1,
      master: { key: draftMaster, digest: sha256(draftBytes), bytes: draftBytes.byteLength },
      renditions: [],
    },
    buckets: {
      "sites-media-quarantine": new Map(),
      "sites-media-approved": new Map([[pilotMaster, pilotBytes], [draftMaster, draftBytes]]),
      "sites-publication-artifacts": new Map([[artifactKey, artifact]]),
      "sites-media-recovery": new Map(),
    },
  };
}

export function fixtureEnv({ output, resultPath, encryptionKey }) {
  return {
    SITES_CMS_DATABASE_URL:
      `postgresql://sites_cms_migrator:${"p".repeat(40)}@db.${PROJECT_REF}.supabase.co:5432/postgres?sslmode=require`,
    SITES_CMS_PROJECT_REF: PROJECT_REF,
    SUPABASE_MANAGEMENT_TOKEN: "management-fixture",
    SITES_PILOT_SITE_ID: PILOT.site_id,
    SUPABASE_S3_ENDPOINT: `https://${PROJECT_REF}.storage.supabase.co/storage/v1/s3`,
    SUPABASE_S3_REGION: "us-east-2",
    SUPABASE_S3_ACCESS_KEY_ID: "access-fixture",
    SUPABASE_S3_SECRET_ACCESS_KEY: "secret-fixture",
    SITES_BACKUP_ENCRYPTION_KEY_B64: encryptionKey,
    SITES_CORE_BASE_URL: "https://core.example.test",
    MINGLA_CMS_TO_CORE_CURRENT_KID: "cms-key-v1",
    MINGLA_CMS_TO_CORE_CURRENT_KEY_B64: Buffer.alloc(32, 32).toString("base64"),
    SITES_BACKUP_OUTPUT_DIR: output,
    SITES_BACKUP_RESULT_PATH: resultPath,
  };
}

/**
 * Supabase Management, Supabase S3 and Core. `protection` maps a site id to the
 * artifact keys Core protects for it; a site absent from it is unknown to Core.
 * `calls.protection` records which sites were asked about.
 */
export function fixtureFetch({ now, buckets, protection, calls = { protection: [] } }) {
  return async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.hostname === "api.supabase.com") {
      if (url.pathname.endsWith("/database/backups")) {
        return Response.json({
          region: "us-east-2",
          walg_enabled: true,
          pitr_enabled: false,
          backups: [{
            id: 1,
            is_physical_backup: true,
            status: "COMPLETED",
            inserted_at: now.toISOString(),
          }],
          physical_backup_data: null,
        });
      }
      return Response.json({
        ref: PROJECT_REF,
        organization_slug: "mrcqqkovdchaltvquggd",
        name: "mingla-sites-cms-prod",
        region: "us-east-2",
        created_at: new Date(now.getTime() - 24 * 60 * 60_000).toISOString(),
        status: "ACTIVE_HEALTHY",
        database: {
          host: `db.${PROJECT_REF}.supabase.co`,
          version: "17.10.0",
          postgres_engine: "17",
          release_channel: "ga",
        },
      });
    }
    if (url.hostname === "core.example.test") {
      const retention = url.pathname.match(/sites\/([^/]+)\/retention-protection$/);
      if (retention) {
        calls.protection.push(retention[1]);
        const keys = protection[retention[1]];
        return keys
          ? Response.json({ ok: true, data: { protected_artifact_keys: keys } })
          : Response.json({ ok: false }, { status: 404 });
      }
      const evidence = JSON.parse(String(init.body));
      return Response.json({
        ok: true,
        data: {
          site_id: url.pathname.match(/sites\/([^/]+)\//)[1],
          evidence_kind: evidence.evidence_kind,
          accepted_at: now.toISOString(),
          readiness: {
            backup_retention_days: 7,
            database_backup_verified_at: now.toISOString(),
            object_manifest_verified_at: now.toISOString(),
            restore_drill_verified_at: evidence.restore_drill_verified_at ?? null,
            restore_drill_evidence_digest: evidence.restore_drill_evidence_digest ?? null,
          },
        },
      });
    }
    if (url.hostname === `${PROJECT_REF}.storage.supabase.co`) {
      const parts = url.pathname.split("/storage/v1/s3/")[1].split("/");
      const objects = buckets[parts[0]];
      if (url.searchParams.get("list-type") === "2") {
        const contents = [...objects.entries()].map(([key, bytes]) =>
          `<Contents><Key>${key}</Key><LastModified>${now.toISOString()}</LastModified>` +
          `<ETag>&quot;fixture&quot;</ETag><Size>${bytes.byteLength}</Size></Contents>`).join("");
        return new Response(
          `<ListBucketResult><IsTruncated>false</IsTruncated>${contents}</ListBucketResult>`,
        );
      }
      const bytes = objects.get(parts.slice(1).join("/"));
      if (bytes) return new Response(bytes);
    }
    return new Response("not found", { status: 404 });
  };
}
