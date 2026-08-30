import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  Globe,
  RefreshCw,
  Search,
  ShieldAlert,
} from "lucide-react";

import { HighRiskActionModal } from "../components/entity/HighRiskActionModal";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { AlertCard, SectionCard } from "../components/ui/Card";
import { Skeleton } from "../components/ui/Skeleton";
import { formatDateTime } from "../lib/formatters";
import {
  getBrandSiteDetail,
  listBrandSites,
  runBrandSiteAction,
} from "../services/brandSitesAdminService";

const STATUS_VARIANT = {
  published: "success",
  draft: "info",
  publishing: "warning",
  provisioning: "warning",
  suspended: "error",
  error: "error",
};

const ACTIONS = {
  reconcile: {
    title: "Reconcile site state",
    description: "Re-check an ambiguous or failed operation without changing published content.",
    confirmLabel: "Reconcile",
    confirmPhrase: "RECONCILE",
  },
  suspend: {
    title: "Suspend public access",
    description: "Pause public access while preserving the last successful publication and all drafts.",
    confirmLabel: "Suspend site",
    confirmPhrase: "SUSPEND",
    destructive: true,
  },
  resume: {
    title: "Resume public access",
    description: "Restore access to the existing last successful publication. No new content is published.",
    confirmLabel: "Resume site",
    confirmPhrase: "RESUME",
  },
  revoke_editor_sessions: {
    title: "Revoke editing sessions",
    description: "End outstanding one-time editing exchanges. Published content is unchanged.",
    confirmLabel: "Revoke sessions",
    confirmPhrase: "REVOKE",
    destructive: true,
  },
};

function siteIdFromHash() {
  return new URLSearchParams(window.location.hash.split("?")[1] || "").get("siteId");
}

function setSiteId(siteId) {
  window.location.hash = siteId
    ? `#/brand-sites?siteId=${encodeURIComponent(siteId)}`
    : "#/brand-sites";
}

function Value({ children }) {
  return children == null || children === "" ? (
    <span className="text-[var(--color-text-muted)]">Not reported</span>
  ) : (
    <span className="break-all text-[var(--color-text-primary)]">{children}</span>
  );
}

function Field({ label, value }) {
  return (
    <div className="min-w-0 rounded-lg bg-[var(--gray-50)] p-3">
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-tertiary)]">
        {label}
      </div>
      <div className="text-sm"><Value>{value}</Value></div>
    </div>
  );
}

function EmptyRows({ children }) {
  return <p className="py-6 text-center text-sm text-[var(--color-text-tertiary)]">{children}</p>;
}

function BrandSitesList({ onSelect }) {
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [state, setState] = useState({ loading: true, error: null, rows: [], total: 0 });

  const load = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: null }));
    try {
      const result = await listBrandSites({ search: query });
      setState({ loading: false, error: null, ...result });
    } catch (error) {
      setState({ loading: false, error: error.message, rows: [], total: 0 });
    }
  }, [query]);

  // Initial server synchronization; loading state must transition before the request.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-1 flex items-center gap-2">
            <Globe className="h-6 w-6 text-[var(--color-brand-500)]" />
            <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">Brand Sites</h1>
          </div>
          <p className="text-sm text-[var(--color-text-secondary)]">
            Operational health, publication state, and safe recovery controls.
          </p>
        </div>
        <Button variant="secondary" icon={RefreshCw} onClick={load} loading={state.loading}>Refresh</Button>
      </div>

      <AlertCard variant="info" title="Customer-facing systems stay provider-neutral">
        This console shows operational signals and immutable publication identifiers. It does not expose credentials or draft content.
      </AlertCard>

      <SectionCard
        title="Sites"
        subtitle={`${state.total} total`}
        action={(
          <form
            className="flex w-full gap-2 sm:w-auto"
            onSubmit={(event) => { event.preventDefault(); setQuery(search.trim()); }}
          >
            <label className="relative min-w-0 flex-1 sm:w-72">
              <span className="sr-only">Search sites</span>
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-[var(--color-text-tertiary)]" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Brand name or exact ID"
                className="h-10 w-full rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] pl-9 pr-3 text-sm outline-none focus:border-[var(--color-brand-500)]"
              />
            </label>
            <Button type="submit" variant="secondary">Search</Button>
          </form>
        )}
        noPadding
      >
        {state.loading ? (
          <div className="space-y-3 p-5"><Skeleton className="h-12" /><Skeleton className="h-12" /><Skeleton className="h-12" /></div>
        ) : state.error ? (
          <div className="p-5"><AlertCard variant="error" title="Sites could not be loaded" action={<Button size="sm" variant="secondary" onClick={load}>Retry</Button>}>{state.error}</AlertCard></div>
        ) : state.rows.length === 0 ? (
          <EmptyRows>No brand sites match this search.</EmptyRows>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[940px] text-left text-sm">
              <thead className="border-b border-[var(--gray-200)] bg-[var(--gray-50)] text-xs uppercase tracking-wide text-[var(--color-text-tertiary)]">
                <tr>
                  <th className="px-5 py-3">Brand</th><th className="px-4 py-3">State</th>
                  <th className="px-4 py-3">Permanent address</th><th className="px-4 py-3">Publication</th>
                  <th className="px-4 py-3">Editor</th><th className="px-4 py-3">Public</th><th className="px-5 py-3">Media</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--gray-200)]">
                {state.rows.map((row) => (
                  <tr key={row.site_id} onClick={() => onSelect(row.site_id)} className="cursor-pointer hover:bg-[var(--gray-50)]" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter") onSelect(row.site_id); }}>
                    <td className="px-5 py-4"><div className="font-semibold text-[var(--color-text-primary)]">{row.brand_name}</div><div className="font-mono text-[11px] text-[var(--color-text-tertiary)]">{row.site_id}</div></td>
                    <td className="px-4 py-4"><Badge dot variant={STATUS_VARIANT[row.status] || "default"}>{row.status}</Badge>{row.pilot_enabled ? <Badge className="ml-1" variant="brand">Pilot</Badge> : null}{row.safe_error_code ? <div className="mt-1 text-xs text-[var(--color-error-700)]">{row.safe_error_code}</div> : null}</td>
                    <td className="px-4 py-4 font-mono text-xs"><Value>{row.permanent_hostname}</Value></td>
                    <td className="px-4 py-4"><Value>{row.active_publication_id}</Value><div className="text-xs text-[var(--color-text-tertiary)]">{row.last_published_at ? formatDateTime(row.last_published_at) : "Never published"}</div></td>
                    <td className="px-4 py-4"><Badge variant={row.editor_health === "ready" ? "success" : row.editor_health === "attention_needed" ? "error" : "default"}>{row.editor_health.replaceAll("_", " ")}</Badge></td>
                    <td className="px-4 py-4"><Badge variant={row.public_health === "verified" ? "success" : row.public_health === "suspended" ? "error" : "default"}>{row.public_health.replaceAll("_", " ")}</Badge></td>
                    <td className="px-5 py-4"><Value>{row.media_backlog}</Value></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}

function BrandSiteDetail({ siteId, onBack }) {
  const [state, setState] = useState({ loading: true, error: null, data: null });
  const [action, setAction] = useState(null);
  const load = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: null }));
    try { setState({ loading: false, error: null, data: await getBrandSiteDetail(siteId) }); }
    catch (error) { setState({ loading: false, error: error.message, data: null }); }
  }, [siteId]);
  // Initial exact-site synchronization; refresh reuses the same bounded loader.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  if (state.loading) return <div className="space-y-4"><Skeleton className="h-12" /><Skeleton className="h-48" /><Skeleton className="h-48" /></div>;
  if (state.error) return <div className="space-y-4"><Button variant="ghost" icon={ArrowLeft} onClick={onBack}>All sites</Button><AlertCard variant="error" title="Site could not be loaded" action={<Button size="sm" variant="secondary" onClick={load}>Retry</Button>}>{state.error}</AlertCard></div>;

  const { site, hosts, publications, receipts, audit, health, readiness } = state.data;
  const config = action ? ACTIONS[action] : null;
  const canReconcile = receipts.some((receipt) => ["failed", "ambiguous"].includes(receipt.status));

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <Button variant="ghost" icon={ArrowLeft} onClick={onBack} aria-label="Back to all sites" />
          <div><div className="flex flex-wrap items-center gap-2"><h1 className="text-2xl font-bold text-[var(--color-text-primary)]">{site.brand_name}</h1><Badge dot variant={STATUS_VARIANT[site.status] || "default"}>{site.status}</Badge>{readiness.pilot_enabled ? <Badge variant="brand">Pilot</Badge> : null}</div><p className="font-mono text-xs text-[var(--color-text-tertiary)]">{site.site_id}</p></div>
        </div>
        <Button variant="secondary" icon={RefreshCw} onClick={load}>Refresh</Button>
      </div>

      {site.safe_error_code ? <AlertCard variant="error" title="Safe error code">{site.safe_error_code}. The last successful publication remains intact.</AlertCard> : null}

      <SectionCard title="Safe operations" subtitle="Every action requires a reason and is audited">
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" disabled={!canReconcile} onClick={() => setAction("reconcile")}>Reconcile</Button>
          {site.status === "suspended" ? <Button variant="secondary" onClick={() => setAction("resume")}>Resume</Button> : <Button variant="danger" onClick={() => setAction("suspend")}>Suspend</Button>}
          <Button variant="secondary" icon={ShieldAlert} onClick={() => setAction("revoke_editor_sessions")}>Revoke editing sessions</Button>
        </div>
        <p className="mt-3 text-xs text-[var(--color-text-tertiary)]">No control on this page can edit content, force a publication pointer, run arbitrary data changes, or delete a site.</p>
      </SectionCard>

      <SectionCard title="Identity and health">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Field label="Brand ID" value={site.brand_id} /><Field label="Renderer" value={`${site.renderer_key} · v${site.renderer_version}`} />
          <Field label="Editor health" value={health.editor} /><Field label="Public health" value={health.public} />
          <Field label="Active publication" value={site.active_publication_id} /><Field label="Prior last-good publication" value={site.last_successful_publication_id} />
          <Field label="Media state" value={health.media} /><Field label="Backup readiness" value={health.backup} />
          <Field label="Backup last verified" value={readiness.backup_last_verified_at} /><Field label="Restore last tested" value={readiness.restore_last_tested_at} />
        </div>
      </SectionCard>

      <SectionCard title="Permanent addresses" subtitle={`${hosts.length} registered`} noPadding>
        {hosts.length ? <div className="divide-y divide-[var(--gray-200)]">{hosts.map((host) => <div key={host.hostname} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3"><span className="font-mono text-sm">{host.hostname}</span><div><Badge variant={host.status === "active" ? "success" : "default"}>{host.status}</Badge>{host.is_primary ? <Badge className="ml-1" variant="outline">Primary</Badge> : null}</div></div>)}</div> : <EmptyRows>No permanent address is registered.</EmptyRows>}
      </SectionCard>

      <SectionCard title="Publication history" subtitle={`${publications.length} recent`} noPadding>
        {publications.length ? <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="border-b border-[var(--gray-200)] bg-[var(--gray-50)] text-xs uppercase text-[var(--color-text-tertiary)]"><tr><th className="px-5 py-3">Publication</th><th className="px-4 py-3">Revision</th><th className="px-4 py-3">State</th><th className="px-4 py-3">Artifact digest</th><th className="px-5 py-3">Completed</th></tr></thead><tbody className="divide-y divide-[var(--gray-200)]">{publications.map((publication) => <tr key={publication.publication_id}><td className="px-5 py-3 font-mono text-xs">{publication.publication_id}</td><td className="px-4 py-3 font-mono text-xs">{publication.source_revision_id}</td><td className="px-4 py-3"><Badge variant={publication.status === "published" ? "success" : publication.status === "failed" ? "error" : "default"}>{publication.status}</Badge></td><td className="max-w-[220px] truncate px-4 py-3 font-mono text-xs" title={publication.artifact_digest || ""}><Value>{publication.artifact_digest}</Value></td><td className="px-5 py-3 text-xs"><Value>{publication.completed_at ? formatDateTime(publication.completed_at) : null}</Value></td></tr>)}</tbody></table></div> : <EmptyRows>No publication attempts yet.</EmptyRows>}
      </SectionCard>

      <SectionCard title="Operation receipts" subtitle={`${receipts.length} recent`} noPadding>
        {receipts.length ? <div className="divide-y divide-[var(--gray-200)]">{receipts.map((receipt) => <div key={receipt.operation_id} className="grid grid-cols-1 gap-1 px-5 py-3 text-sm sm:grid-cols-[1fr_auto_auto]"><div><span className="font-semibold">{receipt.kind}</span><div className="font-mono text-xs text-[var(--color-text-tertiary)]">{receipt.operation_id}</div></div><Badge variant={receipt.status === "succeeded" ? "success" : ["failed", "ambiguous"].includes(receipt.status) ? "error" : "warning"}>{receipt.status}</Badge><div className="text-xs text-[var(--color-text-tertiary)]">{formatDateTime(receipt.updated_at)}</div></div>)}</div> : <EmptyRows>No operation receipts yet.</EmptyRows>}
      </SectionCard>

      <SectionCard title="Audit history" subtitle={`${audit.length} recent`} noPadding>
        {audit.length ? <div className="divide-y divide-[var(--gray-200)]">{audit.map((entry, index) => <div key={`${entry.occurred_at}-${index}`} className="grid grid-cols-1 gap-1 px-5 py-3 text-sm sm:grid-cols-[1fr_auto]"><div><span className="font-semibold">{entry.action}</span><span className="ml-2 text-xs text-[var(--color-text-tertiary)]">{entry.actor_kind}</span><div className="font-mono text-xs text-[var(--color-text-tertiary)]">{entry.resource_kind} · {entry.resource_id}</div></div><div className="text-xs text-[var(--color-text-tertiary)]">{formatDateTime(entry.occurred_at)}</div></div>)}</div> : <EmptyRows>No audit events yet.</EmptyRows>}
      </SectionCard>

      <HighRiskActionModal
        open={Boolean(action)} onClose={() => setAction(null)}
        title={config?.title} description={config?.description}
        confirmLabel={config?.confirmLabel} confirmPhrase={config?.confirmPhrase}
        destructive={config?.destructive}
        onConfirm={async ({ reason }) => { await runBrandSiteAction(siteId, action, reason); await load(); }}
        successMessage="Brand site operation completed."
      />
    </div>
  );
}

export function BrandSitesPage() {
  const [siteId, setSelectedSiteId] = useState(siteIdFromHash);
  useEffect(() => {
    const onHashChange = () => setSelectedSiteId(siteIdFromHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);
  return siteId
    ? <BrandSiteDetail siteId={siteId} onBack={() => setSiteId(null)} />
    : <BrandSitesList onSelect={setSiteId} />;
}
