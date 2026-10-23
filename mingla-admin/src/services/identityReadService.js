/**
 * ORCH-1272 [Admin Identity console — READ-ONLY] — identity read service.
 *
 * The SINGLE data authority for the People + Brands consoles. READ-ONLY by
 * contract: it exposes zero .update / .insert / .delete / admin_write_audit —
 * every mutation is deferred to Wave-2 via the ORCH-1271 audited-write primitive
 * (adminWriteService). Enforced by I-PROPOSED-1272-IDENTITY-ADMIN-READ + the
 * read-only-held grep (AC-5.2).
 *
 * Read paths (per ORCH-1271 §3 read-authz rule):
 *   - Whole-row single-table reads (creator_accounts / brands / brand_team_members
 *     / brand_invitations / partner_brand_links) → direct supabase.from(...) under
 *     the is_admin_user() SELECT RLS policies.
 *   - Unified Person bundle (joins + crosses sensitive subscriptions /
 *     admin_subscription_overrides) → the guard-first admin_get_person RPC.
 *
 * Contract per the EntityListView / EntityDetailView shells:
 *   - list fns return { rows, total } and THROW on error (EntityListView catches
 *     and renders the error+retry state).
 *   - getBrandDetail returns the composed detail object and THROWS on error.
 *   - getPerson returns the raw { data, error } (the page inspects error to tell
 *     not_authorized / not_found / network apart).
 */

import { supabase } from "../lib/supabase";
import { escapeLike } from "../lib/formatters";

export function followerNumber(value) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

export function mergeFollowerSortedBrandRows(brandRows, orderedStats) {
  const brandById = Object.fromEntries(brandRows.map((row) => [row.id, row]));
  return orderedStats.flatMap((stats) => {
    const brand = brandById[stats.brandId];
    if (!brand) return [];
    return [
      {
        ...brand,
        follower_count: followerNumber(stats.followerCount),
        new_this_week: followerNumber(stats.newThisWeek),
      },
    ];
  });
}

export function parseFollowerSortPage(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !Array.isArray(value.rows) ||
    followerNumber(value.total) === null
  ) {
    throw new Error("Follower sort response was malformed.");
  }
  const seen = new Set();
  const rows = value.rows.map((row) => {
    const followerCount = followerNumber(row?.followerCount);
    const newThisWeek = followerNumber(row?.newThisWeek);
    if (
      !row ||
      typeof row !== "object" ||
      Array.isArray(row) ||
      Object.keys(row).sort().join("|") !== "brandId|followerCount|newThisWeek" ||
      typeof row.brandId !== "string" ||
      row.brandId.length === 0 ||
      seen.has(row.brandId) ||
      (row.followerCount != null && followerCount === null) ||
      (row.newThisWeek != null && newThisWeek === null)
    ) {
      throw new Error("Follower sort response was malformed.");
    }
    seen.add(row.brandId);
    return {
      brandId: row.brandId,
      followerCount,
      newThisWeek,
    };
  });
  return { rows, total: followerNumber(value.total) };
}

export function parseFollowerStatsRows(value, expectedBrandIds) {
  if (!Array.isArray(value)) {
    throw new Error("Follower stats response was malformed.");
  }
  const expected = new Set(expectedBrandIds);
  const seen = new Set();
  const rows = value.map((row) => {
    const followerCount = followerNumber(row?.follower_count);
    const newThisWeek = followerNumber(row?.new_this_week);
    if (
      !row ||
      typeof row !== "object" ||
      Array.isArray(row) ||
      Object.keys(row).sort().join("|") !== "brand_id|follower_count|new_this_week" ||
      typeof row.brand_id !== "string" ||
      !expected.has(row.brand_id) ||
      seen.has(row.brand_id) ||
      followerCount === null ||
      newThisWeek === null
    ) {
      throw new Error("Follower stats response was malformed.");
    }
    seen.add(row.brand_id);
    return {
      brand_id: row.brand_id,
      follower_count: followerCount,
      new_this_week: newThisWeek,
    };
  });
  if (seen.size !== expected.size) {
    throw new Error("Follower stats response was malformed.");
  }
  return rows;
}

// ── Unified Person (RPC) ──────────────────────────────────────────────────────

/**
 * Unified Person bundle for a user (consumer profile + business account + brands
 * owned/member + subscription + tickets). Served by the guard-first, READ-ONLY
 * admin_get_person RPC. Returns the raw { data, error } so the page can branch on
 * error.message ('not_authorized' | 'not_found' | network).
 */
export async function getPerson(userId) {
  return supabase.rpc("admin_get_person", { p_user_id: userId });
}

// ── Accounts (People) list ────────────────────────────────────────────────────

const ACCOUNT_LIST_COLS =
  "id,business_name,display_name,email,phone_e164,partner_enabled,partner_country,default_brand_id,deleted_at,created_at";

/**
 * creator_accounts list for the People console. Server search / sort / filter /
 * pagination. Resolves default_brand_id → brand name via one in()-read. Returns
 * { rows, total }; throws on error.
 */
export async function listAccounts({ search, sortKey, sortDir, filters = {}, page = 0, pageSize = 25 }) {
  let query = supabase
    .from("creator_accounts")
    .select(ACCOUNT_LIST_COLS, { count: "exact" });

  if (search) {
    const s = escapeLike(search.trim());
    if (s) {
      query = query.or(
        `business_name.ilike.%${s}%,display_name.ilike.%${s}%,email.ilike.%${s}%,phone_e164.ilike.%${s}%`,
      );
    }
  }

  if (filters.partner === "enabled") query = query.eq("partner_enabled", true);
  else if (filters.partner === "disabled") query = query.eq("partner_enabled", false);

  if (filters.status === "active") query = query.is("deleted_at", null);
  else if (filters.status === "deleted") query = query.not("deleted_at", "is", null);

  query = query
    .order(sortKey || "created_at", { ascending: sortDir === "asc" })
    .range(page * pageSize, (page + 1) * pageSize - 1);

  const { data, count, error } = await query;
  if (error) throw new Error(error.message || "Failed to load accounts.");

  const rows = data || [];
  const brandNameById = await resolveBrandNames(
    rows.map((r) => r.default_brand_id).filter(Boolean),
  );
  return {
    rows: rows.map((r) => ({
      ...r,
      default_brand_name: r.default_brand_id ? brandNameById[r.default_brand_id] || null : null,
    })),
    total: count ?? 0,
  };
}

// ── Brands list ───────────────────────────────────────────────────────────────

// NB: the brand "kind" column is intentionally NOT selected — the admin console
// displays no brand kind anywhere (META-ORCH-0972 decommission, honored in spirit).
const BRAND_LIST_COLS =
  "id,name,slug,claim_status,city,country_code,pricing_currency,default_currency,take_rate_bps_override,payment_provider,stripe_charges_enabled,account_id,deleted_at,created_at";

/**
 * brands list for the Brands console (reuses the existing "brands admin can read"
 * RLS — exposes soft-deleted brands too). Resolves owner account_id →
 * business_name via one in()-read. Returns { rows, total }; throws on error.
 */
export async function listBrands({ search, sortKey, sortDir, filters = {}, page = 0, pageSize = 25 }) {
  if (sortKey === "follower_count") {
    const { data: followerPage, error: followerError } = await supabase.rpc(
      "admin_list_brands_by_followers",
      {
        p_search: search?.trim() || null,
        p_claim_status: filters.claim_status || null,
        p_status: filters.status || null,
        p_payment_provider: filters.payment_provider || null,
        p_ascending: sortDir === "asc",
        p_offset: page * pageSize,
        p_limit: pageSize,
      },
    );
    if (followerError) {
      throw new Error(followerError.message || "Failed to sort brands by followers.");
    }

    const parsedFollowerPage = parseFollowerSortPage(followerPage);
    const orderedStats = parsedFollowerPage.rows;
    const orderedIds = orderedStats
      .map((row) => row?.brandId)
      .filter((id) => typeof id === "string");
    let brandRows = [];
    if (orderedIds.length > 0) {
      const { data, error } = await supabase
        .from("brands")
        .select(BRAND_LIST_COLS)
        .in("id", orderedIds);
      if (error) throw new Error(error.message || "Failed to load brands.");
      brandRows = data || [];
    }
    const rows = mergeFollowerSortedBrandRows(brandRows, orderedStats);
    const ownerNameById = await resolveAccountNames(
      rows.map((row) => row.account_id).filter(Boolean),
    );
    return {
      rows: rows.map((row) => ({
        ...row,
        owner_business_name: row.account_id
          ? ownerNameById[row.account_id] || null
          : null,
      })),
      total: parsedFollowerPage.total,
    };
  }

  let query = supabase.from("brands").select(BRAND_LIST_COLS, { count: "exact" });

  if (search) {
    const s = escapeLike(search.trim());
    if (s) {
      query = query.or(`name.ilike.%${s}%,slug.ilike.%${s}%,city.ilike.%${s}%`);
    }
  }

  if (filters.claim_status) query = query.eq("claim_status", filters.claim_status);
  if (filters.status === "live") query = query.is("deleted_at", null);
  else if (filters.status === "deleted") query = query.not("deleted_at", "is", null);
  if (filters.payment_provider) query = query.eq("payment_provider", filters.payment_provider);

  query = query
    .order(sortKey || "created_at", { ascending: sortDir === "asc" })
    .range(page * pageSize, (page + 1) * pageSize - 1);

  const { data, count, error } = await query;
  if (error) throw new Error(error.message || "Failed to load brands.");

  const rows = data || [];
  const liveIds = rows.filter((row) => !row.deleted_at).map((row) => row.id);
  let followerStatsById = {};
  let followerStatsFailed = false;
  if (liveIds.length > 0) {
    const { data: followerStats, error: followerError } = await supabase.rpc(
      "admin_brand_follower_stats",
      { p_brand_ids: liveIds },
    );
    if (followerError) {
      followerStatsFailed = true;
      logDegrade("admin_brand_follower_stats", followerError);
    } else {
      try {
        followerStatsById = Object.fromEntries(
          parseFollowerStatsRows(followerStats, liveIds).map((stats) => [stats.brand_id, stats]),
        );
      } catch (parseError) {
        followerStatsFailed = true;
        logDegrade("admin_brand_follower_stats", parseError);
      }
    }
  }
  const ownerNameById = await resolveAccountNames(
    rows.map((r) => r.account_id).filter(Boolean),
  );
  return {
    rows: rows.map((r) => ({
      ...r,
      owner_business_name: r.account_id ? ownerNameById[r.account_id] || null : null,
      follower_count: r.deleted_at
        ? null
        : followerStatsFailed
          ? undefined
          : followerStatsById[r.id].follower_count,
      new_this_week: r.deleted_at
        ? null
        : followerStatsFailed
          ? undefined
          : followerStatsById[r.id].new_this_week,
    })),
    total: count ?? 0,
  };
}

// ── Brand detail (composed sub-reads) ─────────────────────────────────────────

// NB: the brand "kind" column is intentionally NOT selected (META-ORCH-0972 — no admin kind display).
const BRAND_DETAIL_COLS =
  "id,account_id,name,slug,description,venue_category,claim_status,verified_at,verified_by," +
  "rejection_reason,marked_called_at,duplicate_of_brand_id,city,country_code,latitude,longitude," +
  "cover_media_url,profile_media_url,theme_color,theme_font,theme_animation,social_links,custom_links," +
  "pricing_currency,default_currency,pricing_region,take_rate_bps_override,payment_provider,payment_country," +
  "stripe_connect_id,stripe_charges_enabled,stripe_payouts_enabled,paystack_subaccount_code," +
  "deleted_at,created_at";

/**
 * Composes the Brand detail: brand row + owner + team + invites + partner links +
 * brand support tickets. All sub-reads filtered by brand_id under admin RLS. NO
 * live Stripe call (that is ORCH-1274). Returns the composed object; throws on the
 * primary brand-read error. Sub-read failures degrade to empty lists (logged),
 * never fabricated rows.
 */
export async function getBrandDetail(brandId) {
  const { data: brand, error } = await supabase
    .from("brands")
    .select(BRAND_DETAIL_COLS)
    .eq("id", brandId)
    .maybeSingle();
  if (error) throw new Error(error.message || "Failed to load brand.");
  if (!brand) throw new Error("not_found");

  const [ownerRes, teamRes, invitesRes, partnerRes, ticketsRes] = await Promise.all([
    brand.account_id
      ? supabase
          .from("creator_accounts")
          .select("id,business_name,email,phone_e164,partner_enabled,deleted_at")
          .eq("id", brand.account_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabase
      .from("brand_team_members")
      .select("id,user_id,role,invited_at,accepted_at,removed_at,permissions_override")
      .eq("brand_id", brandId)
      .order("accepted_at", { ascending: true }),
    supabase
      .from("brand_invitations")
      .select("id,email,role,status,invitee_name,invited_by,expires_at,accepted_at,revoked_at,declined_at")
      .eq("brand_id", brandId)
      .order("expires_at", { ascending: false }),
    supabase
      .from("partner_brand_links")
      .select("id,partner_account_id,invited_owner_email,personal_note,invited_at,accepted_at,owner_stripe_connected_at,cancelled_at")
      .eq("brand_id", brandId)
      .order("invited_at", { ascending: false }),
    supabase
      .from("support_tickets")
      .select("id,subject,status,priority,created_at,last_message_at")
      .eq("brand_id", brandId)
      .order("last_message_at", { ascending: false }),
  ]);

  const team = pickList(teamRes, "brand_team_members");
  const invites = pickList(invitesRes, "brand_invitations");
  const partnerLinks = pickList(partnerRes, "partner_brand_links");
  const tickets = pickList(ticketsRes, "support_tickets");

  // Resolve member identities (brand_team_members.user_id has NO FK → explicit
  // in()-reads, not a PostgREST embed). Orphan user_ids render as the raw uuid.
  const memberIds = team.map((m) => m.user_id).filter(Boolean);
  const [memberProfiles, memberAccounts] = await Promise.all([
    resolveProfiles(memberIds),
    resolveAccountNames(memberIds),
  ]);
  const teamResolved = team.map((m) => ({
    ...m,
    member_name: memberProfiles[m.user_id]?.display_name || memberAccounts[m.user_id] || null,
    member_email: memberProfiles[m.user_id]?.email || null,
  }));

  // Resolve partner account business names.
  const partnerAccountNames = await resolveAccountNames(
    partnerLinks.map((p) => p.partner_account_id).filter(Boolean),
  );
  const partnerLinksResolved = partnerLinks.map((p) => ({
    ...p,
    partner_business_name: p.partner_account_id ? partnerAccountNames[p.partner_account_id] || null : null,
  }));

  return {
    brand,
    owner: pickOne(ownerRes, "owner"),
    team: teamResolved,
    invites,
    partnerLinks: partnerLinksResolved,
    tickets,
  };
}

// ── Resolve helpers (secondary enrichment; best-effort, logged on failure) ─────

async function resolveBrandNames(ids) {
  const uniq = [...new Set(ids)];
  if (uniq.length === 0) return {};
  const { data, error } = await supabase.from("brands").select("id,name").in("id", uniq);
  if (error) {
    logDegrade("resolveBrandNames", error);
    return {};
  }
  const map = {};
  for (const b of data || []) map[b.id] = b.name;
  return map;
}

async function resolveAccountNames(ids) {
  const uniq = [...new Set(ids)];
  if (uniq.length === 0) return {};
  const { data, error } = await supabase
    .from("creator_accounts")
    .select("id,business_name")
    .in("id", uniq);
  if (error) {
    logDegrade("resolveAccountNames", error);
    return {};
  }
  const map = {};
  for (const a of data || []) map[a.id] = a.business_name;
  return map;
}

async function resolveProfiles(ids) {
  const uniq = [...new Set(ids)];
  if (uniq.length === 0) return {};
  const { data, error } = await supabase
    .from("profiles")
    .select("id,display_name,email")
    .in("id", uniq);
  if (error) {
    logDegrade("resolveProfiles", error);
    return {};
  }
  const map = {};
  for (const p of data || []) map[p.id] = p;
  return map;
}

// ── Sub-read failure handling (never silent; degrade to empty, log a warning) ──

/** List sub-read: on error log + return []; else the rows. */
function pickList(res, label) {
  if (res.error) {
    logDegrade(label, res.error);
    return [];
  }
  return res.data || [];
}

/** Single sub-read: on error log + return null; else the row. */
function pickOne(res, label) {
  if (res.error) {
    logDegrade(label, res.error);
    return null;
  }
  return res.data || null;
}

function logDegrade(label, error) {
  console.warn(`[identityReadService] ${label} read degraded:`, error?.message || error);
}
