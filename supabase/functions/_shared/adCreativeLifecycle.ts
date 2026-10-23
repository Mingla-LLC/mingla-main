// Issue #3697 — the Creative Library lifecycle shared by `ad-plan` and
// `admin-ad-creative-prepare`:
//   - the library view (filters, cursor, in-flight uploads, per-platform fit);
//   - the selection rule (archived and purged creatives);
//   - the server fit gate (FG-1 before funding, FG-2 before provider prepare);
//   - archive / restore and the guarded permanent delete.
//
// Fit is judged by the one channel matrix (adCreativeMatrix.ts, through
// adCreativeFit.ts). It is advice on library cards and never stops reuse; it
// blocks only inside the Campaign Builder and at FG-1 / FG-2.
// Invariant I-ADS-FIT-BEFORE-FUNDING (declared in supabase/functions/ad-plan/__tests__/issue_3697_fit_gate.test.ts)
// Invariant I-CREATIVE-ARCHIVE-NOT-DELETE (declared in supabase/migrations/__tests__/issue_3697_creative_library_lifecycle.implementor.pg17.test.sql)
// Invariant I-ADS-FIT-ONE-MATRIX (declared in supabase/functions/_shared/__tests__/adCreativeFit.issue3040.test.ts)
import type { Platform } from "./adChannelCore.ts";
import {
  creativeFitFacts,
  type CreativeFitRow,
  summarizeCreativeFit,
} from "./adCreativeFit.ts";
import {
  type ChannelValidationResult,
  validateCreativeForChannels,
} from "./adCreativeMatrix.ts";

// deno-lint-ignore no-explicit-any
type Db = any;
type Row = Record<string, unknown>;

/** Library fit tiles, in the fixed order the Admin cards show them. */
export const LIBRARY_FIT_PLATFORMS: readonly Platform[] = [
  "meta",
  "tiktok",
  "google",
  "snapchat",
  "reddit",
];
export const LIBRARY_PAGE_SIZE = 60;
/** Ad-video jobs still on their way into the library. */
export const IN_FLIGHT_AD_JOB_STATUSES = [
  "source_uploading",
  "source_uploaded",
  "processing_queued",
  "processing",
  "ready",
] as const;

/** The creative columns the library, the fit and the gates read. */
export const LIBRARY_CREATIVE_COLUMNS =
  "id,name,kind,status,source_url,poster_url,duration_seconds,aspect_ratio,width,height,has_audio,mime_type,byte_size,ai_generated,variants,brand_id,source,source_brand_id,source_job_id,source_job_ref,rendition_height,stage_tags,concept_tag,hook_tag,event_id,licence_reference,date_locked_until,created_by,archived_at,archived_by,purged_at,created_at,updated_at";
export const FIT_CREATIVE_COLUMNS =
  "id,kind,status,purged_at,mime_type,width,height,aspect_ratio,duration_seconds,has_audio,byte_size,poster_url,variants";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type LibraryFilters = {
  status: "active" | "archived";
  kind: "image" | "video" | null;
  /** "house" = Mingla uploads; "host" = everything a host or Ari made. */
  source: "house" | "host" | null;
  q: string | null;
  brandId: string | null;
  before: { created_at: string; id: string } | null;
};

export function parseLibraryFilters(
  body: Row,
): { ok: true; filters: LibraryFilters } | { ok: false; detail: string } {
  const status = body.status ?? "active";
  if (status !== "active" && status !== "archived") {
    return { ok: false, detail: "status_invalid" };
  }
  const kind = body.kind ?? null;
  if (kind !== null && kind !== "image" && kind !== "video") {
    return { ok: false, detail: "kind_invalid" };
  }
  const source = body.source ?? null;
  if (source !== null && source !== "house" && source !== "host") {
    return { ok: false, detail: "source_invalid" };
  }
  let q: string | null = null;
  if (body.q !== undefined && body.q !== null) {
    if (typeof body.q !== "string" || body.q.length > 120) {
      return { ok: false, detail: "q_invalid" };
    }
    q = body.q.trim() || null;
  }
  let before: LibraryFilters["before"] = null;
  if (body.before !== undefined && body.before !== null) {
    const cursor = body.before as Row;
    const createdAt = typeof cursor?.created_at === "string"
      ? cursor.created_at
      : "";
    const id = typeof cursor?.id === "string" ? cursor.id : "";
    if (!Number.isFinite(Date.parse(createdAt)) || !UUID_RE.test(id)) {
      return { ok: false, detail: "cursor_invalid" };
    }
    before = { created_at: new Date(createdAt).toISOString(), id };
  }
  const brandId = body.brand_id === undefined || body.brand_id === null ||
      body.brand_id === ""
    ? null
    : typeof body.brand_id === "string" && UUID_RE.test(body.brand_id)
    ? body.brand_id
    : undefined;
  if (brandId === undefined) {
    return { ok: false, detail: "brand_id_invalid" };
  }
  return {
    ok: true,
    filters: {
      status,
      kind,
      source,
      q,
      brandId,
      before,
    } as LibraryFilters,
  };
}

/** `ILIKE` pattern for a name search, with the wildcards escaped. */
export function namePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

/**
 * Applies the library filters to a Supabase `ad_creatives` query. A purged
 * creative (tombstone) is excluded from EVERY view, Archived included.
 */
// deno-lint-ignore no-explicit-any
export function applyLibraryFilters(query: any, filters: LibraryFilters): any {
  let next = query.is("purged_at", null).eq("status", filters.status);
  if (filters.kind) next = next.eq("kind", filters.kind);
  if (filters.source === "house") next = next.eq("source", "admin_upload");
  if (filters.source === "host") next = next.neq("source", "admin_upload");
  if (filters.q) next = next.ilike("name", namePattern(filters.q));
  if (filters.brandId) next = next.eq("brand_id", filters.brandId);
  if (filters.before) {
    const { created_at, id } = filters.before;
    next = next.or(
      `created_at.lt.${created_at},and(created_at.eq.${created_at},id.lt.${id})`,
    );
  }
  return next.order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(LIBRARY_PAGE_SIZE + 1);
}

export type LibraryFitTile = {
  platform: Platform;
  fits: boolean;
  /** Short phrases from the matrix, e.g. "1080×1920", "at least 5 seconds". */
  needs: string[];
  /** Fits, with a softer recommendation (vertical works better). */
  warn: boolean;
};

/** Per-platform fit for a library card. Advice only: it never blocks reuse. */
export function libraryFit(
  row: CreativeFitRow,
  platforms: readonly Platform[] = LIBRARY_FIT_PLATFORMS,
): LibraryFitTile[] {
  const facts = creativeFitFacts(row);
  const checks = validateCreativeForChannels(platforms, facts);
  return summarizeCreativeFit(platforms, row).map((fit) => {
    const result = checks.find((c) => c.platform === fit.platform);
    const warn = fit.fits && Boolean(
      result?.checks.some((check) =>
        check.level === "warn" && /ratio/.test(check.rule)
      ),
    );
    return { ...fit, warn };
  });
}

/**
 * FG-1 / FG-2 — the first allocated platform a video creative does not fit.
 * The same blocking rule as the Builder: reject, needs_transcode, or a
 * fail-safe not_evaluable. Images keep the Builder's proceed-with-passing
 * behaviour and are not gated here.
 */
export function creativeFitGateFailure(
  creative: CreativeFitRow & { kind?: unknown },
  platforms: readonly Platform[],
): { platform: Platform; reasons: string[]; misfits: LibraryFitTile[] } | null {
  if (creative.kind !== "video") return null;
  const misfits = libraryFit(creative, platforms).filter((fit) => !fit.fits);
  if (misfits.length === 0) return null;
  return { platform: misfits[0].platform, reasons: misfits[0].needs, misfits };
}

/**
 * Whether a creative may be chosen. A NEW selection refuses an archived
 * creative; a plan version that already carries it (`frozen`) keeps working.
 * A purged creative has no media and is refused everywhere.
 */
export function creativeSelectionError(
  creative: { status?: unknown; purged_at?: unknown } | null,
  options: { frozen: boolean },
): { status: number; error: string } | null {
  if (!creative) return { status: 409, error: "creative_not_reusable" };
  if (creative.purged_at) {
    return { status: options.frozen ? 409 : 410, error: "creative_purged" };
  }
  if (creative.status === "archived") {
    return options.frozen ? null : { status: 409, error: "creative_archived" };
  }
  if (creative.status !== "active") {
    return { status: 409, error: "creative_not_reusable" };
  }
  return null;
}

/**
 * #3697 (C-13) — true only when an existing plan version, matched by id AND
 * hash, was frozen with this creative. Paths that act on an already-frozen
 * plan use it to keep an archived creative working; anything else (a new
 * selection, a draft, a malformed or unknown version) gets false.
 */
export async function frozenPlanCarriesCreative(
  db: Db,
  input: { planVersionId: unknown; planHash: unknown; creativeId: string },
): Promise<boolean> {
  const versionId = typeof input.planVersionId === "string"
    ? input.planVersionId.trim()
    : "";
  const hash = typeof input.planHash === "string"
    ? input.planHash.trim().toLowerCase()
    : "";
  if (!UUID_RE.test(versionId) || !/^[0-9a-f]{64}$/.test(hash)) return false;
  const { data, error } = await db.from("ad_plan_versions")
    .select("id,plan_hash,canonical_plan")
    .eq("id", versionId)
    .eq("plan_hash", hash)
    .maybeSingle();
  if (error || !data) return false;
  const canonical = data.canonical_plan as Row | null;
  return data.plan_hash === hash &&
    typeof canonical?.creative_library_id === "string" &&
    canonical.creative_library_id === input.creativeId;
}

/** The validation shape the Builder renders, computed from stored probe facts. */
export function storedCreativeValidation(
  row: CreativeFitRow & { kind?: unknown },
  platforms: readonly Platform[],
): { probe: Row; channels: ChannelValidationResult[] } {
  const facts = creativeFitFacts(row);
  return {
    probe: {
      kind: facts.kind,
      mime_type: facts.mimeType,
      width: facts.width,
      height: facts.height,
      aspect_ratio: facts.aspectRatio,
      duration_seconds: facts.durationSeconds,
      has_audio: facts.hasAudio,
      byte_size: facts.byteSize,
      overall_bitrate_kbps: facts.overallBitrateKbps,
    },
    channels: validateCreativeForChannels(platforms, facts),
  };
}

function stageLabel(status: string): string {
  switch (status) {
    case "source_uploading":
      return "Uploading";
    case "ready":
      return "Saving to the library";
    default:
      return "Preparing video";
  }
}

/** An in-flight ad-video upload, shown as a library card before its row exists. */
export function pendingLibraryItems(
  jobs: readonly Row[],
  materializedJobIds: ReadonlySet<string>,
): Row[] {
  return jobs
    .filter((job) =>
      typeof job.id === "string" && !materializedJobIds.has(job.id) &&
      (IN_FLIGHT_AD_JOB_STATUSES as readonly string[]).includes(
        String(job.status),
      )
    )
    .map((job) => ({
      jobId: job.id,
      status: job.status,
      stageLabel: stageLabel(String(job.status)),
      createdAt: job.created_at ?? null,
      sourceUploadedAt: job.source_uploaded_at ?? null,
      fileName: typeof job.source_file_name === "string"
        ? job.source_file_name
        : null,
      sourceBytes: typeof job.source_bytes === "number"
        ? job.source_bytes
        : null,
      sourceDurationMs: typeof job.source_duration_ms === "number"
        ? job.source_duration_ms
        : null,
      clientOperationId: job.client_operation_id ?? null,
    }));
}

function displayName(profile: Row | undefined): string | null {
  if (!profile) return null;
  for (const key of ["first_name", "display_name"]) {
    const value = profile[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim().split(/\s+/)[0];
    }
  }
  return null;
}

/**
 * Adds the lifecycle fields the Admin cards need to the library projection.
 * Storage ids and provider ids stay off the wire (the projection already
 * drops them; nothing here re-adds them).
 */
export function decorateLibraryRows(
  projected: readonly Row[],
  raw: readonly Row[],
  names: {
    profiles: ReadonlyMap<string, Row>;
    brands: ReadonlyMap<string, string>;
  },
): Row[] {
  const rawById = new Map(raw.map((row) => [String(row.id), row]));
  return projected.map((row) => {
    const source = rawById.get(String(row.id)) ?? {};
    const archived = source.status === "archived";
    const brandId = typeof source.brand_id === "string"
      ? source.brand_id
      : null;
    return {
      ...row,
      width: typeof source.width === "number" ? source.width : null,
      height: typeof source.height === "number" ? source.height : null,
      has_audio: typeof source.has_audio === "boolean"
        ? source.has_audio
        : null,
      stage_tags: Array.isArray(source.stage_tags)
        ? source.stage_tags.filter((value): value is string =>
          typeof value === "string"
        )
        : [],
      concept_tag: typeof source.concept_tag === "string"
        ? source.concept_tag
        : null,
      hook_tag: typeof source.hook_tag === "string" ? source.hook_tag : null,
      event_id: typeof source.event_id === "string" ? source.event_id : null,
      licence_reference: typeof source.licence_reference === "string"
        ? source.licence_reference
        : null,
      date_locked_until: typeof source.date_locked_until === "string"
        ? source.date_locked_until
        : null,
      // The processed MP4 the card preview plays (muted, with controls).
      playback_url:
        source.kind === "video" && typeof source.source_url === "string"
          ? source.source_url
          : null,
      brand_name: brandId ? names.brands.get(brandId) ?? null : null,
      created_by_name: typeof source.created_by === "string"
        ? displayName(names.profiles.get(source.created_by))
        : null,
      archived_at: source.archived_at ?? null,
      archived_by_name: typeof source.archived_by === "string"
        ? displayName(names.profiles.get(source.archived_by))
        : null,
      // Fit is advice: a misfit never makes a library item unusable.
      fit: libraryFit(source as CreativeFitRow),
      reusable: !archived && row.house_reuse_allowed === true,
    };
  });
}

export type LifecycleResult = { status: number; body: Row };

export type LifecycleContext = {
  db: Db;
  actor: { id: string; email?: string | null };
  isActiveAdmin: () => Promise<boolean>;
  canBrandPlan: (brandId: string) => Promise<boolean>;
  /**
   * The one guarded provider delete (coverVideoReap.destroyIfUnreferenced):
   * it re-reads every live reference to the file and stamps the source job.
   */
  destroyMedia: (row: {
    id: string;
    provider: string;
    source_asset_id: string;
    target_kind: string;
  }) => Promise<{ outcome: string; reason?: string; kinds?: string[] }>;
  now?: () => Date;
};

export const LIFECYCLE_ACTIONS = [
  "creative_archive",
  "creative_unarchive",
  "creative_purge_check",
  "creative_purge",
] as const;

function missingRpc(error: { code?: string } | null): boolean {
  return error?.code === "PGRST202";
}

function lifecycleRpcFailure(
  error: { code?: string; message?: string },
): LifecycleResult {
  if (missingRpc(error)) {
    console.error("[ad-plan] creative lifecycle", {
      stage: "migration_not_applied",
    });
    return { status: 503, body: { error: "migration_not_applied" } };
  }
  const message = error.message ?? "";
  if (error.code === "P0002" || message.includes("ad_creative_not_found")) {
    return { status: 404, body: { error: "creative_not_found" } };
  }
  if (message.includes("ad_creative_purged")) {
    return { status: 410, body: { error: "creative_purged" } };
  }
  if (message.includes("ad_creative_not_archived")) {
    return { status: 409, body: { error: "creative_not_archived" } };
  }
  return {
    status: 502,
    body: { error: "creative_lifecycle_failed", detail: message || null },
  };
}

/**
 * creative_archive / creative_unarchive / creative_purge_check /
 * creative_purge. House media is managed by an active Admin; brand media by
 * whoever may plan ads for that brand. A permanent delete is Admin-only.
 */
export async function handleCreativeLifecycleAction(
  action: (typeof LIFECYCLE_ACTIONS)[number],
  body: Row,
  ctx: LifecycleContext,
): Promise<LifecycleResult> {
  const creativeId = typeof body.creative_id === "string"
    ? body.creative_id
    : "";
  if (!UUID_RE.test(creativeId)) {
    return {
      status: 400,
      body: { error: "validation_error", detail: "creative_id_invalid" },
    };
  }
  const { data: creative, error: loadError } = await ctx.db
    .from("ad_creatives")
    .select(
      "id,name,kind,status,brand_id,source,bunny_video_id,source_job_id,source_job_ref,purged_at",
    )
    .eq("id", creativeId)
    .maybeSingle();
  if (loadError) {
    return {
      status: 502,
      body: { error: "creative_lookup_failed", detail: loadError.message },
    };
  }
  if (!creative) return { status: 404, body: { error: "creative_not_found" } };

  if (action === "creative_archive" || action === "creative_unarchive") {
    const allowed = typeof creative.brand_id === "string"
      ? await ctx.canBrandPlan(creative.brand_id)
      : await ctx.isActiveAdmin();
    if (!allowed) return { status: 403, body: { error: "forbidden" } };
    const { data, error } = await ctx.db.rpc("ad_creative_set_archived", {
      p_creative_id: creativeId,
      p_archived: action === "creative_archive",
      p_actor: ctx.actor.id,
    });
    if (error) return lifecycleRpcFailure(error);
    const row = (Array.isArray(data) ? data[0] : data) as Row | null;
    return {
      status: 200,
      body: {
        ok: true,
        creative: {
          id: creativeId,
          status: row?.status ?? null,
          archived_at: row?.archived_at ?? null,
        },
      },
    };
  }

  // Permanent delete: Admin only, and only with zero blockers.
  if (!(await ctx.isActiveAdmin())) {
    return { status: 403, body: { error: "forbidden" } };
  }
  const checkedAt = (ctx.now ?? (() => new Date()))().toISOString();
  if (action === "creative_purge" && body.confirm_phrase !== "DELETE") {
    return {
      status: 400,
      body: {
        error: "validation_error",
        detail: "confirm_phrase_must_be_DELETE",
      },
    };
  }

  let tombstone: Row | null = creative.purged_at ? creative : null;
  if (!tombstone) {
    const { data: blockerData, error: blockerError } = await ctx.db.rpc(
      "ad_creative_purge_blockers",
      { p_creative_id: creativeId },
    );
    if (blockerError) return lifecycleRpcFailure(blockerError);
    const blockers = Array.isArray(blockerData)
      ? blockerData.filter((value): value is string =>
        typeof value === "string"
      )
      : null;
    if (blockers === null) {
      // An unreadable answer is never treated as "nothing references it".
      return {
        status: 502,
        body: {
          error: "creative_lifecycle_failed",
          detail: "blockers_unreadable",
        },
      };
    }
    if (action === "creative_purge_check") {
      return {
        status: 200,
        body: { ok: true, blockers, checked_at: checkedAt },
      };
    }
    if (blockers.length > 0) {
      return { status: 409, body: { error: "creative_in_use", blockers } };
    }
    // The database re-checks every blocker under the row lock, then records
    // the tombstone and the immutable audit row in one transaction.
    const { data: recorded, error: recordError } = await ctx.db.rpc(
      "ad_creative_record_purge",
      {
        p_creative_id: creativeId,
        p_actor: ctx.actor.id,
        p_admin_email: ctx.actor.email ?? "",
        p_blockers_checked_at: checkedAt,
      },
    );
    if (recordError) {
      const message = recordError.message ?? "";
      if (message.includes("ad_creative_purge_blocked:")) {
        // Something started using it after the menu was opened.
        const raced = message.split("ad_creative_purge_blocked:")[1]?.split(",")
          .map((value: string) => value.trim()).filter(Boolean) ?? [];
        return {
          status: 409,
          body: { error: "creative_in_use", blockers: raced },
        };
      }
      return lifecycleRpcFailure(recordError);
    }
    tombstone = (Array.isArray(recorded) ? recorded[0] : recorded) as
      | Row
      | null;
  } else if (action === "creative_purge_check") {
    return {
      status: 200,
      body: { ok: true, blockers: ["already_purged"], checked_at: checkedAt },
    };
  }

  // Destroy the file through the one guarded provider delete. A tombstoned
  // creative is no longer a reference to its own file, so the guard proceeds
  // unless something else still serves it. A failure is retryable: calling
  // creative_purge again on the tombstone retries only this step.
  const guid = typeof creative.bunny_video_id === "string"
    ? creative.bunny_video_id
    : "";
  const sourceJob = typeof creative.source_job_id === "string"
    ? creative.source_job_id
    : typeof creative.source_job_ref === "string"
    ? creative.source_job_ref
    : "";
  const outcome = guid
    ? await ctx.destroyMedia({
      id: sourceJob,
      provider: "bunny",
      source_asset_id: guid,
      target_kind: "ad_creative",
    })
    : { outcome: "no_asset" };
  const purgedAt = tombstone?.purged_at ?? null;
  if (outcome.outcome === "destroyed" || outcome.outcome === "no_asset") {
    return {
      status: 200,
      body: {
        ok: true,
        creative: { id: creativeId, purged_at: purgedAt },
        media_deleted: true,
      },
    };
  }
  console.error("[ad-plan] creative purge: media not destroyed yet", {
    creativeId,
    outcome: outcome.outcome,
    reason: outcome.reason ?? null,
  });
  return {
    status: 502,
    body: {
      error: "media_delete_failed",
      removed_from_library: true,
      detail: outcome.reason ?? outcome.outcome,
    },
  };
}
