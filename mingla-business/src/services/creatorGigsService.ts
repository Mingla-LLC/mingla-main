import { supabase } from "./supabase";
import { postHogService } from "./postHogService";

// #3872 — Host side of creator gigs. The creator side lives in Explorer.

export type FollowerBand = {
  platform: string;
  band: string | null;
  verified: boolean;
};

export type GigApplicant = {
  interest_id: string;
  creator_id: string;
  display_name: string;
  niches: string[];
  follower_bands: FollowerBand[];
  rating: number | null;
  completed: number;
  reliability: number | null;
  quote_minor: number;
  currency: string;
  package_id: string | null;
  note: string | null;
  status: string;
};

export type HostGig = Record<string, unknown> & {
  id: string;
  brand_id: string;
  listing_kind: "event" | "venue";
  listing_id: string;
  title_public: string;
  brief_public: string;
  brief_private: string | null;
  format_key: string;
  deliverables: { platform: string; kind: string; count: number }[];
  city_id: string;
  shoot_window_start: string;
  shoot_window_end: string;
  post_by: string;
  usage_days: number;
  /** The most each creator can be paid, in minor units (null on old gigs). */
  pay_up_to_minor: number | null;
  currency: string;
  sales_share_bps: number | null;
  slots: number;
  status: string;
  interest_count: number;
  hired_count: number;
};

export type HostContractSummary = {
  id: string;
  gig_id: string;
  state: string;
  deadline_at: string | null;
  due_at: string | null;
  needs_host: boolean;
  title: string;
  creator: string;
  /** Offer created but the host's payment never completed. */
  payment_pending: boolean;
  fee_minor: number | null;
  currency: string | null;
};

export type HostHome = { gigs: HostGig[]; contracts: HostContractSummary[] };

export type GigDisputeOffer = {
  id: string;
  offered_by: "host" | "creator";
  refund_bps: number;
  note: string | null;
  status: "open" | "accepted" | "declined" | "expired";
  created_at: string;
};

export type GigDispute = {
  id: string;
  status: string;
  opened_by: "host" | "creator";
  reason: string;
  statement: string;
  decided_outcome: string | null;
  decided_refund_bps: number | null;
  decided_note: string | null;
  offers: GigDisputeOffer[];
};

export type GigProposal = {
  id: string;
  from_version: number;
  proposed_by: "host" | "creator";
  changes: Record<string, unknown>;
  reason: string;
  note: string | null;
  status: string;
  expires_at: string;
};

export type GigScriptSection = Record<string, unknown> & {
  label?: string;
  title?: string;
  start_s?: number;
  end_s?: number;
  on_screen?: string;
  voiceover?: string;
  shot_notes?: string;
  text?: string;
};

export type GigScript = {
  version: number;
  body: {
    sections?: GigScriptSection[];
    disclosure?: string;
    estimated_seconds?: number;
  } & Record<string, unknown>;
  sent_at: string | null;
  locked_at: string | null;
  locked_by: string | null;
};

export type GigDelivery = Record<string, unknown> & {
  id: string;
  round: number;
  media_job_id: string;
  decision: string | null;
  fix_categories?: string[];
  fix_note?: string | null;
  submitted_at?: string;
};

export type GigPost = {
  id: string;
  platform: string;
  url: string;
  check_status: string;
  submitted_at: string;
};

export type GigShootPlan = {
  shoot_at: string;
  arrival_note: string | null;
  proposed_by: "host" | "creator";
  proposal_count: number;
  confirmed_at: string | null;
  confirmed_by: string | null;
};

export type GigTerms = Record<string, unknown> & {
  version: number;
  fee_minor: number;
  booking_fee_minor: number;
  currency: string;
  created_at?: string;
};

export type GigWorkspace = {
  contract: Record<string, unknown> & {
    id: string;
    state: string;
    state_deadline_at: string | null;
    fix_rounds_used: number;
    current_terms_version?: number;
    creator_account_id?: string;
    gig_id?: string;
  };
  party: "host" | "creator" | "admin";
  revealed: boolean;
  gig: Record<string, unknown> & {
    title_public: string;
    brief_public: string;
    brief_private?: string | null;
    format_key: string;
    post_by: string;
  };
  terms: GigTerms[];
  proposals: GigProposal[];
  events: {
    id: string;
    at: string;
    actor: string;
    kind: string;
    data: Record<string, unknown>;
  }[];
  hold: Record<string, unknown> | null;
  shoot_plan: GigShootPlan | null;
  scripts: GigScript[];
  deliveries: GigDelivery[];
  posts: GigPost[];
  dispute: GigDispute | null;
  ratings: (Record<string, unknown> & { rated_by: string; stars: number })[];
  counters?: unknown;
  next_action?: string | null;
  pending_topup?: unknown;
  rights?: GigRights | null;
};

export type GigRights = {
  model: "legacy_timed" | "creator_v1_perpetual";
  status: "legacy" | "pending" | "active" | "not_granted";
  label: string;
  usage_days?: number | null;
  agreement_version?: string | null;
  agreement_url?: string | null;
  whitelisting_requires_platform_authorization?: boolean;
};

export type GigResult = {
  contract_id: string;
  gig_id: string;
  gig_title: string;
  creator_id: string;
  creator_display_name: string;
  fee_minor: number;
  currency: string;
  orders: number;
  tickets: number;
  sold_minor: number;
  clicks: number;
};

export type PrehireProfile = {
  id: string;
  display_name: string;
  niches: string[];
  languages: string[];
  follower_bands: FollowerBand[];
  showcase: { media_id: string; thumb: string | null }[];
  rating: number | null;
  rating_count: number;
  completed: number;
  reliability: number | null;
  packages: {
    id: string;
    format_key: string;
    price_minor: number;
    currency: string;
    turnaround_days: number;
    includes_usage_days: number;
  }[];
};

export type CounterRespondResult = {
  ok: boolean;
  error?: string;
  accepted?: boolean;
  terms_version?: number;
  requires_topup?: boolean;
  topup_minor?: number;
  refund_minor?: number;
};

export type WriteResult = {
  ok: boolean;
  error?: string;
  field?: string;
  reasons?: string[];
  id?: string;
};

async function rpc<T>(
  name: string,
  input: Record<string, unknown> = {},
): Promise<T> {
  const { data, error } = await supabase.rpc(name, input);
  if (error) throw error;
  return data as T;
}

/** A write RPC that may answer `{ok:false,error}`: that is a failure, never success. */
async function writeRpc<T extends { ok?: boolean; error?: string }>(
  name: string,
  input: Record<string, unknown>,
): Promise<T & { ok: boolean }> {
  const data = await rpc<T | null>(name, input);
  if (!data || typeof data !== "object")
    return { ok: true } as T & { ok: boolean };
  if (data.ok === false) return data as T & { ok: boolean };
  return { ...data, ok: true };
}

const str = (value: unknown): string =>
  typeof value === "string" ? value : "";
const num = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value)
    ? value
    : Number(value) || 0;

/**
 * gig_applicants LEFT JOINs interest, so a gig with no interest returns one
 * row of nulls. Drop rows without an interest and creator so the screen never
 * renders (or crashes on) a phantom applicant.
 */
export function normalizeApplicants(raw: unknown): GigApplicant[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (row): row is Record<string, unknown> =>
        Boolean(row) && typeof row === "object",
    )
    .filter(
      (row) =>
        typeof row.interest_id === "string" &&
        typeof row.creator_id === "string",
    )
    .map((row) => ({
      interest_id: row.interest_id as string,
      creator_id: row.creator_id as string,
      display_name: str(row.display_name) || "Creator",
      niches: Array.isArray(row.niches)
        ? row.niches.filter((x): x is string => typeof x === "string")
        : [],
      follower_bands: Array.isArray(row.follower_bands)
        ? (row.follower_bands as FollowerBand[]).filter(
            (x) => x && typeof x.platform === "string",
          )
        : [],
      rating:
        typeof row.rating === "number"
          ? row.rating
          : row.rating == null
            ? null
            : Number(row.rating),
      completed: num(row.completed),
      reliability: typeof row.reliability === "number" ? row.reliability : null,
      quote_minor: num(row.quote_minor),
      currency: str(row.currency) || "USD",
      package_id: typeof row.package_id === "string" ? row.package_id : null,
      note:
        typeof row.note === "string" && row.note.trim().length > 0
          ? row.note
          : null,
      status: str(row.status) || "sent",
    }));
}

export function normalizeHostHome(raw: unknown): HostHome {
  const value =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const gigs = Array.isArray(value.gigs) ? value.gigs : [];
  const contracts = Array.isArray(value.contracts) ? value.contracts : [];
  return {
    gigs: gigs
      .filter(
        (row): row is Record<string, unknown> =>
          Boolean(row) &&
          typeof row === "object" &&
          typeof (row as Record<string, unknown>).id === "string",
      )
      .map(
        (row) =>
          ({
            ...row,
            interest_count: num(row.interest_count),
            hired_count: num(row.hired_count),
          }) as HostGig,
      ),
    contracts: contracts
      .filter(
        (row): row is Record<string, unknown> =>
          Boolean(row) &&
          typeof row === "object" &&
          typeof (row as Record<string, unknown>).id === "string",
      )
      .map((row) => ({
        id: row.id as string,
        gig_id: str(row.gig_id),
        state: str(row.state),
        deadline_at:
          typeof row.deadline_at === "string" ? row.deadline_at : null,
        due_at:
          typeof row.due_at === "string"
            ? row.due_at
            : typeof row.deadline_at === "string"
              ? row.deadline_at
              : null,
        needs_host: row.needs_host === true,
        title: str(row.title),
        creator: str(row.creator) || "Creator",
        payment_pending: row.payment_pending === true,
        fee_minor: typeof row.fee_minor === "number" ? row.fee_minor : null,
        currency: typeof row.currency === "string" ? row.currency : null,
      })),
  };
}

export type GigCounter = {
  id: string;
  fee_minor: number;
  note: string | null;
  expires_at: string | null;
};

/**
 * The open creator counter-offer on a contract, if any. The server records a
 * counter as a proposal by the creator carrying `fee_minor` (in `proposals`,
 * or in a `counters` list when the workspace returns one); the host answers it
 * with gig_counter_respond(proposal_id).
 */
export function openCounter(
  workspace: Pick<GigWorkspace, "proposals"> & { counters?: unknown },
): GigCounter | null {
  const fromCounters = Array.isArray(workspace.counters)
    ? (workspace.counters as Record<string, unknown>[]).find(
        (row) =>
          row &&
          typeof row.id === "string" &&
          (row.status === undefined || row.status === "open") &&
          typeof row.fee_minor === "number",
      )
    : undefined;
  if (fromCounters) {
    return {
      id: fromCounters.id as string,
      fee_minor: fromCounters.fee_minor as number,
      note: typeof fromCounters.note === "string" ? fromCounters.note : null,
      expires_at:
        typeof fromCounters.expires_at === "string"
          ? fromCounters.expires_at
          : null,
    };
  }
  const proposal = (workspace.proposals ?? []).find(
    (row) =>
      row.status === "open" &&
      row.proposed_by === "creator" &&
      typeof row.changes?.fee_minor === "number",
  );
  return proposal
    ? {
        id: proposal.id,
        fee_minor: proposal.changes.fee_minor as number,
        note: proposal.note,
        expires_at: proposal.expires_at ?? null,
      }
    : null;
}

/** One-hour playback link for a verified creator's public showcase video. */
export async function showcasePlayback(jobId: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke<{
    playback?: { url?: string };
  }>("creator-media-public", { body: { jobId } });
  if (error || typeof data?.playback?.url !== "string") {
    throw new Error("video_unavailable");
  }
  return data.playback.url;
}

/**
 * One-hour playback link for a delivered gig video. The host team of the
 * contract may play it (creator-media-status shares deliveries with the
 * contract's parties). Returns null while the video is still processing.
 */
/**
 * The delivery's processing status and, once ready, a playback URL. A ready
 * video with no URL is "can't play right now", not "still processing".
 */
export async function deliveryPlaybackStatus(jobId: string): Promise<{
  status: string | null;
  url: string | null;
  availableUntil: string | null;
}> {
  const { data, error } = await supabase.functions.invoke<{
    status?: string;
    playback?: { url?: string } | null;
    availableUntil?: string | null;
  }>("creator-media-status", { body: { jobId } });
  if (error) throw new Error("video_unavailable");
  return {
    status: typeof data?.status === "string" ? data.status : null,
    url: typeof data?.playback?.url === "string" ? data.playback.url : null,
    availableUntil:
      typeof data?.availableUntil === "string" ? data.availableUntil : null,
  };
}

export async function deliveryPlayback(jobId: string): Promise<string | null> {
  return (await deliveryPlaybackStatus(jobId)).url;
}

export type ApprovedDeliveryDownload = {
  url: string;
  filename: string;
  grantExpiresAt: string | null;
  availableUntil: string | null;
};

/**
 * A Host-only, short-lived download grant for the exact delivery version the
 * Host approved. Calling this never changes payout state.
 */
export async function approvedDeliveryDownload(
  jobId: string,
): Promise<ApprovedDeliveryDownload> {
  const { data, error } = await supabase.functions.invoke<{
    download?: { url?: string; filename?: string; expiresAt?: string } | null;
    availableUntil?: string | null;
  }>("creator-media-status", { body: { jobId } });
  if (
    error ||
    typeof data?.download?.url !== "string" ||
    typeof data.download.filename !== "string"
  ) {
    throw new Error("approved_video_download_unavailable");
  }
  return {
    url: data.download.url,
    filename: data.download.filename,
    grantExpiresAt: data.download.expiresAt ?? null,
    availableUntil: data.availableUntil ?? null,
  };
}

/** A top-up the host still owes after accepting a higher counter-offer. */
export function pendingTopup(
  workspace: Pick<GigWorkspace, "pending_topup">,
): { termsVersion: number; topupMinor: number } | null {
  const raw = workspace.pending_topup;
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const termsVersion = Number(row.terms_version);
  const topupMinor = Number(row.topup_minor ?? row.amount_minor);
  if (!Number.isInteger(termsVersion) || !(topupMinor > 0)) return null;
  return { termsVersion, topupMinor };
}

export async function fetchCreatorGigsAccess(
  brandId: string,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("brand_creator_gigs_access", {
    p_brand_id: brandId,
  });
  if (error) throw error;
  return data === true;
}

export const creatorGigsService = {
  hostHome: async (brandId: string): Promise<HostHome> =>
    normalizeHostHome(await rpc("gig_host_home", { p_brand_id: brandId })),
  saveGig: async (payload: Record<string, unknown>): Promise<WriteResult> => {
    const result = await writeRpc<WriteResult>("gig_save", {
      p_payload: payload,
    });
    if (result.ok)
      postHogService.capture("gig_created", {
        format:
          typeof payload.format_key === "string"
            ? payload.format_key
            : "unknown",
      });
    return result;
  },
  applicants: async (gigId: string): Promise<GigApplicant[]> =>
    normalizeApplicants(await rpc("gig_applicants", { p_gig_id: gigId })),
  prehireProfile: (creatorId: string) =>
    rpc<PrehireProfile | null>("prehire_creator_profile", {
      p_creator_account_id: creatorId,
    }),
  decideInterest: (interestId: string, status: "shortlisted" | "passed") =>
    writeRpc<WriteResult>("gig_interest_decide", {
      p_interest_id: interestId,
      p_status: status,
    }),
  workspace: async (contractId: string): Promise<GigWorkspace> => {
    const [workspace, rights] = await Promise.all([
      rpc<GigWorkspace>("gig_contract_workspace", {
        p_contract_id: contractId,
      }),
      rpc<GigRights | null>("gig_rights_status", { p_contract_id: contractId }),
    ]);
    return { ...workspace, rights };
  },
  transition: (
    contractId: string,
    expectedState: string,
    action: string,
    payload: Record<string, unknown> = {},
  ) =>
    rpc("gig_transition", {
      p_contract_id: contractId,
      p_expected_state: expectedState,
      p_action: action,
      p_payload: payload,
    }),
  proposeChange: (
    contractId: string,
    changes: Record<string, unknown>,
    reason: string,
    note?: string,
  ) =>
    rpc("gig_change_proposal_save", {
      p_contract_id: contractId,
      p_changes: changes,
      p_reason: reason,
      p_note: note ?? null,
    }),
  respondToChange: (proposalId: string, accept: boolean) =>
    rpc("gig_change_proposal_respond", {
      p_proposal_id: proposalId,
      p_accept: accept,
    }),
  counterRespond: (proposalId: string, accept: boolean) =>
    writeRpc<CounterRespondResult>("gig_counter_respond", {
      p_proposal_id: proposalId,
      p_accept: accept,
    }),
  planShoot: (
    contractId: string,
    shootAt: string,
    arrivalNote: string,
    confirm: boolean,
  ) =>
    rpc("gig_shoot_plan_save", {
      p_contract_id: contractId,
      p_shoot_at: shootAt,
      p_arrival_note: arrivalNote,
      p_confirm: confirm,
    }),
  decideDelivery: (
    deliveryId: string,
    decision: "approved" | "fix_requested",
    categories: string[] = [],
    note?: string,
  ) =>
    rpc("gig_delivery_decide", {
      p_delivery_id: deliveryId,
      p_decision: decision,
      p_fix_categories: categories,
      p_fix_note: note ?? null,
    }),
  openDispute: (contractId: string, reason: string, statement: string) =>
    rpc("gig_dispute_open", {
      p_contract_id: contractId,
      p_reason: reason,
      p_statement: statement,
      p_evidence_media_ids: [],
    }),
  offerDispute: (disputeId: string, refundBps: number, note?: string) =>
    rpc("gig_dispute_offer", {
      p_dispute_id: disputeId,
      p_refund_bps: refundBps,
      p_note: note ?? null,
    }),
  async respondToDisputeOffer(offerId: string, accept: boolean) {
    const { data, error } = await supabase.functions.invoke(
      "gig-dispute-resolve",
      { body: { offer_id: offerId, accept } },
    );
    if (error) throw error;
    return data;
  },
  rate: (contractId: string, stars: number, tags: string[], note?: string) =>
    writeRpc<WriteResult>("gig_rating_submit", {
      p_contract_id: contractId,
      p_stars: stars,
      p_tags: tags,
      p_note: note ?? null,
    }),
  results: async (
    brandId: string,
    gigId?: string | null,
    since?: string | null,
  ): Promise<GigResult[]> => {
    const rows = await rpc<unknown>("gig_results", {
      p_brand_id: brandId,
      p_gig_id: gigId ?? null,
      // Round 2: results period (7 days / 30 days); null = all time.
      p_since: since ?? null,
    });
    if (!Array.isArray(rows)) return [];
    return rows
      .filter(
        (row): row is Record<string, unknown> =>
          Boolean(row) &&
          typeof row === "object" &&
          typeof (row as Record<string, unknown>).contract_id === "string",
      )
      .map((row) => ({
        contract_id: row.contract_id as string,
        gig_id: str(row.gig_id),
        gig_title: str(row.gig_title),
        creator_id: str(row.creator_id),
        creator_display_name: str(row.creator_display_name) || "Creator",
        fee_minor: num(row.fee_minor),
        currency: str(row.currency) || "USD",
        orders: num(row.orders),
        tickets: num(row.tickets),
        sold_minor: num(row.sold_minor),
        clicks: num(row.clicks),
      }));
  },
  async refund(
    contractId: string,
    branch: "host_before_accept" | "host_after_accept_before_lock",
  ) {
    const { data, error } = await supabase.functions.invoke("gig-refund", {
      body: { contract_id: contractId, branch },
    });
    if (error) throw error;
    return data;
  },
};
