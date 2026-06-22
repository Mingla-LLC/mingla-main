/**
 * META-ORCH-1222 [Careers site] — admin careers data + actions.
 *
 * Applications are read via the SECURITY DEFINER `admin_job_applications_list`
 * RPC and mutated via `admin_set_job_application_status` — both internally gated
 * by is_admin_user() (the table denies anon/authenticated SELECT directly; reads
 * MUST go through the RPC, never `supabase.from('job_applications')`).
 *
 * Postings (ADDENDUM D-1 — full CRUD in v1) are read via
 * `admin_careers_list_postings` (ALL statuses) and written via
 * `admin_careers_upsert_posting` / `admin_careers_set_posting_status` — gated
 * RPCs only, NO broad RLS write path.
 *
 * The CV is private (career-cvs bucket, no client policy) — the only fetch path
 * is the admin-gated `careers-cv-signed-url` edge fn (invokeWithRefresh).
 */

import { supabase, invokeWithRefresh } from "../lib/supabase";

// ── Applications ──────────────────────────────────────────────────────────────
export async function listApplications({ status = null, jobPostingId = null } = {}) {
  const { data, error } = await supabase.rpc("admin_job_applications_list", {
    p_status: status,
    p_job_posting_id: jobPostingId,
  });
  if (error) throw error;
  return data ?? [];
}

export async function setApplicationStatus(applicationId, status) {
  const { data, error } = await supabase.rpc("admin_set_job_application_status", {
    p_application_id: applicationId,
    p_status: status,
  });
  if (error) throw error;
  return data;
}

/** Fetch a 60s signed URL for an application's CV via the admin-gated edge fn. */
export async function getCvSignedUrl(applicationId) {
  const { data, error } = await invokeWithRefresh("careers-cv-signed-url", {
    body: { application_id: applicationId },
  });
  if (error) throw error;
  if (!data?.url) throw new Error("No signed URL returned");
  return data.url;
}

// ── Postings (ADDENDUM D-1) ──────────────────────────────────────────────────
export async function listPostings() {
  const { data, error } = await supabase.rpc("admin_careers_list_postings");
  if (error) throw error;
  return data ?? [];
}

/**
 * Insert (id=null) or update a posting. Maps the form shape to the RPC params.
 * Surfaces the RPC's 'slug_taken' as a clean Error for the UI.
 */
export async function upsertPosting(form) {
  const { data, error } = await supabase.rpc("admin_careers_upsert_posting", {
    p_id: form.id ?? null,
    p_slug: form.slug,
    p_title: form.title,
    p_department: form.department,
    p_location: form.location,
    p_employment_type: form.employment_type,
    p_salary_min: form.salary_min === "" || form.salary_min == null ? null : Number(form.salary_min),
    p_salary_max: form.salary_max === "" || form.salary_max == null ? null : Number(form.salary_max),
    p_salary_currency: form.salary_currency,
    p_salary_period: form.salary_period,
    p_salary_display: form.salary_display,
    p_summary: form.summary,
    p_body: form.body,
    p_status: form.status,
    p_sort_order: form.sort_order === "" || form.sort_order == null ? 0 : Number(form.sort_order),
  });
  if (error) {
    if (/slug_taken/.test(error.message)) {
      throw new Error("That slug is already taken — pick a different one.");
    }
    throw error;
  }
  return data;
}

export async function setPostingStatus(id, status) {
  const { data, error } = await supabase.rpc("admin_careers_set_posting_status", {
    p_id: id,
    p_status: status,
  });
  if (error) throw error;
  return data;
}

// Slug helper — lowercase, hyphenate, strip unsafe chars (mirrors the DB CHECK).
export function slugify(title) {
  return (title || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}
