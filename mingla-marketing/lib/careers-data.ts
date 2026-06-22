// META-ORCH-1222 [Careers site] — server-only data layer for the careers pages.
//
// The marketing app carries NO @supabase/supabase-js client; it reads PostgREST
// directly with a raw fetch + the PUBLIC anon key (mirrors lib/explorer-app-
// submit.ts transport posture). RLS is the real fence: the public anon key can
// SELECT only status='open' rows of job_postings (policy
// I-PROPOSED-1222-POSTINGS-PUBLIC-OPEN-ONLY); job_applications is fully denied.
// The `status=eq.open` filter below is belt-and-suspenders on top of RLS.
//
// Requires NEXT_PUBLIC_SUPABASE_URL (the PostgREST base, e.g.
// https://gqnoajqerqhnvulmnyvv.supabase.co) — added to the marketing Vercel env
// at deploy (SPEC §10 Q3). NEXT_PUBLIC_SUPABASE_ANON_KEY already exists.

const REST_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''

export interface JobPosting {
  slug: string
  title: string
  department: string
  location: string
  employment_type: string
  salary_display: string
  summary: string
  body?: string
  sort_order: number
  created_at: string
}

const INDEX_SELECT =
  'slug,title,department,location,employment_type,salary_display,summary,sort_order,created_at'

function restHeaders(): HeadersInit {
  return {
    apikey: ANON_KEY,
    Authorization: `Bearer ${ANON_KEY}`,
    Accept: 'application/json',
  }
}

function configured(): boolean {
  if (!REST_URL || !ANON_KEY) {
    console.error(
      '[careers-data] Missing NEXT_PUBLIC_SUPABASE_URL or ' +
        'NEXT_PUBLIC_SUPABASE_ANON_KEY — careers pages cannot read job_postings.',
    )
    return false
  }
  return true
}

/**
 * List all OPEN roles for the index, ordered sort_order asc, created_at desc.
 * Never selects `body` (lighter payload). Throws on a transport/HTTP error so
 * the page can render its error state (DESIGN §2.4) rather than a false empty.
 */
export async function listOpenRoles(): Promise<JobPosting[]> {
  if (!configured()) throw new Error('careers_data_unconfigured')
  const url =
    `${REST_URL.replace(/\/$/, '')}/rest/v1/job_postings` +
    `?status=eq.open&select=${INDEX_SELECT}&order=sort_order.asc,created_at.desc`
  const res = await fetch(url, {
    headers: restHeaders(),
    // Revalidate periodically so a status flip via SQL shows up without a deploy.
    next: { revalidate: 60 },
  })
  if (!res.ok) {
    throw new Error(`careers_data_list_failed:${res.status}`)
  }
  return (await res.json()) as JobPosting[]
}

/**
 * Fetch one OPEN role by slug for the JD + apply pages. Returns null when the
 * slug does not resolve to a status='open' row (RLS hides draft/closed → the JD
 * never renders publicly; DESIGN §3.3 "not open" panel). Throws on transport
 * error so the page can show its error state vs a misleading "not found".
 */
export async function getOpenRoleBySlug(slug: string): Promise<JobPosting | null> {
  if (!configured()) throw new Error('careers_data_unconfigured')
  const safeSlug = encodeURIComponent(slug)
  const url =
    `${REST_URL.replace(/\/$/, '')}/rest/v1/job_postings` +
    `?slug=eq.${safeSlug}&status=eq.open&select=*&limit=1`
  const res = await fetch(url, {
    headers: restHeaders(),
    next: { revalidate: 60 },
  })
  if (!res.ok) {
    throw new Error(`careers_data_role_failed:${res.status}`)
  }
  const rows = (await res.json()) as JobPosting[]
  return rows.length > 0 ? rows[0] : null
}

// Stored employment_type → human label.
export function employmentLabel(value: string): string {
  switch (value) {
    case 'full_time':
      return 'Full-time'
    case 'part_time':
      return 'Part-time'
    case 'contract':
      return 'Contract'
    case 'internship':
      return 'Internship'
    default:
      return value
  }
}
