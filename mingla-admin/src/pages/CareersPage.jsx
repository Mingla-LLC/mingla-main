/**
 * CAREERS PAGE — META-ORCH-1221 [Careers site at career.usemingla.com]
 *
 * Two sections (ADDENDUM D-1 — admin manages BOTH applications AND postings):
 *   1. Applications — list (filter by role + status) + detail modal (all fields,
 *      signed CV download, portfolio link, status update). Reads via the
 *      is_admin_user()-gated admin_job_applications_list RPC (never a direct
 *      table SELECT — RLS denies it). CV via the careers-cv-signed-url edge fn.
 *   2. Roles — list ALL postings (every status) + a create/edit form with a
 *      markdown body textarea, status (draft|open|closed), sort_order, and a
 *      "generate slug" helper. Writes via the gated admin_careers_upsert_posting
 *      / admin_careers_set_posting_status RPCs (NO broad RLS write).
 *
 * Mirrors ClaimsPage (list+detail+status tabs+modal) + BetaLeadsPage primitives.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Briefcase, Download, ExternalLink, Plus } from "lucide-react";
import { SectionCard, AlertCard } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { Modal, ModalBody, ModalFooter } from "../components/ui/Modal";
import { Spinner } from "../components/ui/Spinner";
import { useToast } from "../context/ToastContext";
import {
  getCvSignedUrl,
  listApplications,
  listPostings,
  setApplicationStatus,
  setPostingStatus,
  slugify,
  upsertPosting,
} from "../services/careersService";

const APP_STATUS_TABS = [
  { id: null, label: "All" },
  { id: "new", label: "New" },
  { id: "reviewing", label: "Reviewing" },
  { id: "shortlisted", label: "Shortlisted" },
  { id: "rejected", label: "Rejected" },
  { id: "hired", label: "Hired" },
];

const APP_STATUSES = ["new", "reviewing", "shortlisted", "rejected", "hired"];
const POSTING_STATUSES = ["draft", "open", "closed"];
const EMPLOYMENT_TYPES = ["full_time", "part_time", "contract", "internship"];
const SALARY_PERIODS = ["hour", "day", "week", "month", "year"];

const STATUS_BADGE = {
  new: "info",
  reviewing: "warning",
  shortlisted: "brand",
  rejected: "error",
  hired: "success",
  draft: "default",
  open: "success",
  closed: "error",
};

function relativeTime(iso) {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "—";
  const min = Math.floor((Date.now() - then) / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return `${Math.floor(day / 30)}mo ago`;
}

const EMPTY_POSTING_FORM = {
  id: null,
  slug: "",
  title: "",
  department: "",
  location: "",
  employment_type: "full_time",
  salary_min: "",
  salary_max: "",
  salary_currency: "NGN",
  salary_period: "month",
  salary_display: "",
  summary: "",
  body: "",
  status: "draft",
  sort_order: 0,
};

export function CareersPage() {
  const { addToast } = useToast();
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const [section, setSection] = useState("applications"); // applications | roles

  // ── Postings (shared: filter dropdown for applications + the Roles tab) ──────
  const [postings, setPostings] = useState([]);
  const loadPostings = useCallback(async () => {
    try {
      const data = await listPostings();
      if (mountedRef.current) setPostings(data);
    } catch (e) {
      if (mountedRef.current) {
        addToast({ variant: "error", title: "Couldn't load roles", description: e?.message });
      }
    }
  }, [addToast]);
  useEffect(() => {
    void loadPostings();
  }, [loadPostings]);

  // ── Applications ─────────────────────────────────────────────────────────────
  const [statusFilter, setStatusFilter] = useState(null);
  const [roleFilter, setRoleFilter] = useState(null); // job_posting_id | null
  const [apps, setApps] = useState([]);
  const [appsLoading, setAppsLoading] = useState(true);
  const [appsError, setAppsError] = useState(null);
  const [detail, setDetail] = useState(null);
  const [acting, setActing] = useState(false);
  const [cvLoading, setCvLoading] = useState(false);

  const loadApps = useCallback(async () => {
    setAppsLoading(true);
    setAppsError(null);
    try {
      const data = await listApplications({ status: statusFilter, jobPostingId: roleFilter });
      if (mountedRef.current) setApps(data);
    } catch (e) {
      if (mountedRef.current) {
        setAppsError(e?.message || "Failed to load applications");
        addToast({ variant: "error", title: "Couldn't load applications", description: e?.message });
      }
    } finally {
      if (mountedRef.current) setAppsLoading(false);
    }
  }, [statusFilter, roleFilter, addToast]);
  useEffect(() => {
    void loadApps();
  }, [loadApps]);

  const handleCopy = useCallback(
    async (text, what) => {
      try {
        await navigator.clipboard.writeText(text);
        addToast({ variant: "success", title: `${what} copied` });
      } catch {
        addToast({ variant: "error", title: `Couldn't copy ${what.toLowerCase()}` });
      }
    },
    [addToast],
  );

  const downloadCv = useCallback(
    async (applicationId) => {
      setCvLoading(true);
      try {
        const url = await getCvSignedUrl(applicationId);
        window.open(url, "_blank", "noopener,noreferrer");
      } catch (e) {
        addToast({ variant: "error", title: "Couldn't fetch CV", description: e?.message });
      } finally {
        if (mountedRef.current) setCvLoading(false);
      }
    },
    [addToast],
  );

  const changeAppStatus = useCallback(
    async (applicationId, status) => {
      setActing(true);
      try {
        await setApplicationStatus(applicationId, status);
        addToast({ variant: "info", title: `Marked ${status}` });
        setDetail((d) => (d ? { ...d, status } : d));
        await loadApps();
      } catch (e) {
        addToast({ variant: "error", title: "Status update failed", description: e?.message });
      } finally {
        if (mountedRef.current) setActing(false);
      }
    },
    [addToast, loadApps],
  );

  // ── Roles editor ─────────────────────────────────────────────────────────────
  const [postingForm, setPostingForm] = useState(null); // null = closed; object = open
  const [savingPosting, setSavingPosting] = useState(false);

  const openNewPosting = () =>
    setPostingForm({ ...EMPTY_POSTING_FORM, sort_order: postings.length });
  const openEditPosting = (p) =>
    setPostingForm({
      id: p.id,
      slug: p.slug,
      title: p.title,
      department: p.department,
      location: p.location,
      employment_type: p.employment_type,
      salary_min: p.salary_min ?? "",
      salary_max: p.salary_max ?? "",
      salary_currency: p.salary_currency,
      salary_period: p.salary_period,
      salary_display: p.salary_display,
      summary: p.summary,
      body: p.body,
      status: p.status,
      sort_order: p.sort_order,
    });

  const savePosting = useCallback(async () => {
    if (!postingForm) return;
    const required = ["slug", "title", "department", "location", "salary_display", "summary", "body"];
    const missing = required.filter((k) => !String(postingForm[k] ?? "").trim());
    if (missing.length > 0) {
      addToast({ variant: "warning", title: "Fill in every required field", description: missing.join(", ") });
      return;
    }
    setSavingPosting(true);
    try {
      await upsertPosting(postingForm);
      addToast({ variant: "success", title: postingForm.id ? "Role updated" : "Role created" });
      setPostingForm(null);
      await loadPostings();
    } catch (e) {
      addToast({ variant: "error", title: "Couldn't save role", description: e?.message });
    } finally {
      if (mountedRef.current) setSavingPosting(false);
    }
  }, [postingForm, addToast, loadPostings]);

  const togglePostingStatus = useCallback(
    async (id, status) => {
      try {
        await setPostingStatus(id, status);
        addToast({ variant: "info", title: `Role ${status}` });
        await loadPostings();
      } catch (e) {
        addToast({ variant: "error", title: "Couldn't change status", description: e?.message });
      }
    },
    [addToast, loadPostings],
  );

  const roleOptions = useMemo(
    () => postings.map((p) => ({ id: p.id, label: p.title })),
    [postings],
  );

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-start gap-3">
        <Briefcase className="h-8 w-8 text-[var(--color-brand-500)]" />
        <div>
          <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">Careers</h1>
          <p className="text-sm text-[var(--color-text-secondary)] mt-1">
            Applications from career.usemingla.com + the open-role manager.
          </p>
        </div>
      </div>

      {/* Section switch */}
      <div className="flex flex-wrap gap-2">
        {[
          { id: "applications", label: "Applications" },
          { id: "roles", label: "Roles" },
        ].map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setSection(s.id)}
            className={`rounded-full border px-4 py-2 text-sm font-medium transition ${
              section === s.id
                ? "border-[var(--color-brand-500)] bg-[var(--color-brand-500)] text-white"
                : "border-[var(--gray-300)] bg-[var(--color-background-primary)] text-[var(--color-text-secondary)] hover:bg-[var(--gray-50)]"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {section === "applications" ? (
        <>
          {/* Filters */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex flex-wrap gap-2">
              {APP_STATUS_TABS.map((tab) => (
                <button
                  key={String(tab.id)}
                  type="button"
                  onClick={() => setStatusFilter(tab.id)}
                  className={`rounded-full border px-3.5 py-1.5 text-xs font-medium transition ${
                    statusFilter === tab.id
                      ? "border-[var(--color-brand-500)] bg-[var(--color-brand-500)] text-white"
                      : "border-[var(--gray-300)] bg-[var(--color-background-primary)] text-[var(--color-text-secondary)] hover:bg-[var(--gray-50)]"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <select
              value={roleFilter ?? ""}
              onChange={(e) => setRoleFilter(e.target.value || null)}
              className="ml-auto rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3 py-2 text-sm text-[var(--color-text-primary)]"
            >
              <option value="">All roles</option>
              {roleOptions.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>

          {appsError && (
            <AlertCard
              variant="error"
              title="Couldn't load applications"
              action={
                <Button variant="secondary" size="sm" onClick={() => void loadApps()}>
                  Retry
                </Button>
              }
            >
              {appsError}
            </AlertCard>
          )}

          <SectionCard title="Applications" subtitle={`${apps.length} total`} noPadding>
            {appsLoading ? (
              <div className="flex justify-center py-12">
                <Spinner />
              </div>
            ) : apps.length === 0 ? (
              <p className="py-10 text-center text-sm text-[var(--color-text-secondary)]">
                No applications match this filter.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--gray-200)] text-left text-[var(--color-text-tertiary)]">
                      <th className="px-4 py-2">Name</th>
                      <th className="px-4 py-2">Role</th>
                      <th className="px-4 py-2">Email</th>
                      <th className="px-4 py-2">Status</th>
                      <th className="px-4 py-2">Received</th>
                    </tr>
                  </thead>
                  <tbody>
                    {apps.map((a) => (
                      <tr
                        key={a.id}
                        onClick={() => setDetail(a)}
                        className="cursor-pointer border-b border-[var(--gray-100)] hover:bg-[var(--gray-50)]"
                      >
                        <td className="px-4 py-3 font-semibold text-[var(--color-text-primary)]">
                          {a.full_name}
                        </td>
                        <td className="px-4 py-3 text-[var(--color-text-secondary)]">{a.job_title}</td>
                        <td className="px-4 py-3 font-mono text-[13px] text-[var(--color-text-secondary)]">
                          {a.email}
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant={STATUS_BADGE[a.status] || "default"}>{a.status}</Badge>
                        </td>
                        <td className="px-4 py-3 tabular-nums text-[var(--color-text-secondary)]">
                          {relativeTime(a.created_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        </>
      ) : (
        /* ── Roles section ─────────────────────────────────────────────────── */
        <SectionCard
          title="Roles"
          subtitle={`${postings.length} total · public site shows only "open"`}
          action={
            <Button variant="primary" size="sm" onClick={openNewPosting}>
              <Plus className="h-4 w-4" /> New role
            </Button>
          }
          noPadding
        >
          {postings.length === 0 ? (
            <p className="py-10 text-center text-sm text-[var(--color-text-secondary)]">
              No roles yet. Create one to populate the careers site.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--gray-200)] text-left text-[var(--color-text-tertiary)]">
                    <th className="px-4 py-2">Title</th>
                    <th className="px-4 py-2">Slug</th>
                    <th className="px-4 py-2">Status</th>
                    <th className="px-4 py-2">Order</th>
                    <th className="px-4 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {postings.map((p) => (
                    <tr key={p.id} className="border-b border-[var(--gray-100)]">
                      <td className="px-4 py-3 font-semibold text-[var(--color-text-primary)]">{p.title}</td>
                      <td className="px-4 py-3 font-mono text-[13px] text-[var(--color-text-secondary)]">
                        {p.slug}
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={STATUS_BADGE[p.status] || "default"}>{p.status}</Badge>
                      </td>
                      <td className="px-4 py-3 tabular-nums text-[var(--color-text-secondary)]">
                        {p.sort_order}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-2">
                          <Button variant="secondary" size="sm" onClick={() => openEditPosting(p)}>
                            Edit
                          </Button>
                          {p.status !== "open" ? (
                            <Button variant="secondary" size="sm" onClick={() => togglePostingStatus(p.id, "open")}>
                              Open
                            </Button>
                          ) : (
                            <Button variant="secondary" size="sm" onClick={() => togglePostingStatus(p.id, "closed")}>
                              Close
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      )}

      {/* ── Application detail modal ─────────────────────────────────────────── */}
      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail?.full_name ?? "Application"} size="lg">
        <ModalBody>
          {!detail ? null : (
            <div className="space-y-4 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={STATUS_BADGE[detail.status] || "default"}>{detail.status}</Badge>
                <span className="text-[var(--color-text-tertiary)]">{detail.job_title}</span>
              </div>
              <div className="grid grid-cols-[140px_1fr] gap-x-4 gap-y-2">
                <div className="text-[var(--color-text-tertiary)]">Role</div>
                <div>{detail.job_title} <span className="text-[var(--color-text-tertiary)]">({detail.job_slug})</span></div>
                <div className="text-[var(--color-text-tertiary)]">Email</div>
                <button
                  type="button"
                  onClick={() => handleCopy(detail.email, "Email")}
                  className="text-left font-mono text-[13px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                >
                  {detail.email}
                </button>
                <div className="text-[var(--color-text-tertiary)]">WhatsApp</div>
                <button
                  type="button"
                  onClick={() => handleCopy(detail.whatsapp_phone, "WhatsApp number")}
                  className="text-left text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                >
                  {detail.whatsapp_phone}
                </button>
                <div className="text-[var(--color-text-tertiary)]">Preferred salary</div>
                <div>{detail.preferred_salary}</div>
                <div className="text-[var(--color-text-tertiary)]">Portfolio</div>
                <div>
                  <a
                    href={detail.portfolio_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[var(--color-brand-500)] underline break-all"
                  >
                    {detail.portfolio_url} <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                  </a>
                </div>
                <div className="text-[var(--color-text-tertiary)]">Received</div>
                <div title={new Date(detail.created_at).toISOString()}>{relativeTime(detail.created_at)}</div>
              </div>

              <div>
                <Button variant="secondary" onClick={() => downloadCv(detail.id)} disabled={cvLoading}>
                  <Download className="h-4 w-4" /> {cvLoading ? "Fetching CV…" : "Download CV"}
                </Button>
              </div>

              <div className="rounded-lg border border-[var(--gray-200)] p-3">
                <div className="mb-2 text-xs uppercase tracking-wide text-[var(--color-text-tertiary)]">
                  Update status
                </div>
                <div className="flex flex-wrap gap-2">
                  {APP_STATUSES.map((s) => (
                    <Button
                      key={s}
                      variant={detail.status === s ? "primary" : "secondary"}
                      size="sm"
                      onClick={() => changeAppStatus(detail.id, s)}
                      disabled={acting || detail.status === s}
                    >
                      {s}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setDetail(null)} disabled={acting}>
            Close
          </Button>
        </ModalFooter>
      </Modal>

      {/* ── Posting create/edit modal (D-1) ─────────────────────────────────── */}
      <Modal
        open={!!postingForm}
        onClose={() => setPostingForm(null)}
        title={postingForm?.id ? "Edit role" : "New role"}
        size="lg"
      >
        <ModalBody>
          {!postingForm ? null : (
            <div className="space-y-3 text-sm">
              <Field label="Title *">
                <input
                  type="text"
                  value={postingForm.title}
                  onChange={(e) =>
                    setPostingForm((f) => {
                      const next = { ...f, title: e.target.value };
                      // Auto-fill slug from title only when slug is empty / not yet hand-edited.
                      if (!f.id && (!f.slug || f.slug === slugify(f.title))) {
                        next.slug = slugify(e.target.value);
                      }
                      return next;
                    })
                  }
                  className={inputCls}
                />
              </Field>
              <Field label="Slug *" hint="lowercase-with-hyphens; must be unique">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={postingForm.slug}
                    onChange={(e) => setPostingForm((f) => ({ ...f, slug: e.target.value }))}
                    className={inputCls}
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setPostingForm((f) => ({ ...f, slug: slugify(f.title) }))}
                  >
                    From title
                  </Button>
                </div>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Department *">
                  <input
                    type="text"
                    value={postingForm.department}
                    onChange={(e) => setPostingForm((f) => ({ ...f, department: e.target.value }))}
                    className={inputCls}
                  />
                </Field>
                <Field label="Location *">
                  <input
                    type="text"
                    value={postingForm.location}
                    onChange={(e) => setPostingForm((f) => ({ ...f, location: e.target.value }))}
                    className={inputCls}
                  />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Employment type">
                  <select
                    value={postingForm.employment_type}
                    onChange={(e) => setPostingForm((f) => ({ ...f, employment_type: e.target.value }))}
                    className={inputCls}
                  >
                    {EMPLOYMENT_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Status">
                  <select
                    value={postingForm.status}
                    onChange={(e) => setPostingForm((f) => ({ ...f, status: e.target.value }))}
                    className={inputCls}
                  >
                    {POSTING_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <Field label="Salary min">
                  <input
                    type="number"
                    value={postingForm.salary_min}
                    onChange={(e) => setPostingForm((f) => ({ ...f, salary_min: e.target.value }))}
                    className={inputCls}
                  />
                </Field>
                <Field label="Salary max">
                  <input
                    type="number"
                    value={postingForm.salary_max}
                    onChange={(e) => setPostingForm((f) => ({ ...f, salary_max: e.target.value }))}
                    className={inputCls}
                  />
                </Field>
                <Field label="Currency">
                  <input
                    type="text"
                    maxLength={3}
                    value={postingForm.salary_currency}
                    onChange={(e) => setPostingForm((f) => ({ ...f, salary_currency: e.target.value.toUpperCase() }))}
                    className={inputCls}
                  />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Salary period">
                  <select
                    value={postingForm.salary_period}
                    onChange={(e) => setPostingForm((f) => ({ ...f, salary_period: e.target.value }))}
                    className={inputCls}
                  >
                    {SALARY_PERIODS.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Sort order">
                  <input
                    type="number"
                    value={postingForm.sort_order}
                    onChange={(e) => setPostingForm((f) => ({ ...f, sort_order: e.target.value }))}
                    className={inputCls}
                  />
                </Field>
              </div>
              <Field label="Salary display *" hint='e.g. ₦150,000–₦250,000/month'>
                <input
                  type="text"
                  value={postingForm.salary_display}
                  onChange={(e) => setPostingForm((f) => ({ ...f, salary_display: e.target.value }))}
                  className={inputCls}
                />
              </Field>
              <Field label="Summary *" hint="card blurb, ≤400 chars">
                <textarea
                  rows={2}
                  value={postingForm.summary}
                  onChange={(e) => setPostingForm((f) => ({ ...f, summary: e.target.value }))}
                  className={inputCls}
                />
              </Field>
              <Field label="Body (markdown) *" hint="## headings, - lists, **bold**, [text](https://…)">
                <textarea
                  rows={12}
                  value={postingForm.body}
                  onChange={(e) => setPostingForm((f) => ({ ...f, body: e.target.value }))}
                  className={`${inputCls} font-mono text-[13px]`}
                />
              </Field>
            </div>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setPostingForm(null)} disabled={savingPosting}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void savePosting()} disabled={savingPosting}>
            {savingPosting ? "Saving…" : postingForm?.id ? "Save changes" : "Create role"}
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}

const inputCls =
  "w-full rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3 py-2 text-sm text-[var(--color-text-primary)]";

function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-[var(--color-text-secondary)]">
        {label}
        {hint ? <span className="ml-2 font-normal text-[var(--color-text-tertiary)]">{hint}</span> : null}
      </span>
      {children}
    </label>
  );
}

export default CareersPage;
