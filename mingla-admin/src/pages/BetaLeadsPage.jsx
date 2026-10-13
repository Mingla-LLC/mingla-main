/**
 * BETA LEADS PAGE (#/beta-leads) — everyone who asked for early access from
 * the business site, for the whole team (issue #3802, Wave 1).
 *
 * The list comes from the role-aware reader crm_beta_leads_list (through
 * hooks/useCrmSummary.js); this file never talks to the database itself. That
 * reader returns the contact name and email and never a phone number, a
 * device, a referrer or a network field.
 *
 * One control per row: "Add to Hosts" turns a lead into a host, once, however
 * many times and by however many people it is pressed; a lead that is already
 * a host shows "Open host" instead.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Inbox, CalendarClock, Sparkles } from "lucide-react";
import { SectionCard, AlertCard } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { DataTable } from "../components/ui/Table";
import { Skeleton } from "../components/ui/Skeleton";
import { useToast } from "../context/ToastContext";
import { useCrmSummary } from "../hooks/useCrmSummary";
import { useHashQuery } from "../hooks/useHashQuery";
import { useOnline } from "../hooks/useCrmPipeline";
import {
  betaConvertMessage,
  betaLeadButton,
  betaSuggestionLine,
  betaTypeLabel,
  errorWords,
  loadErrorWords,
  relativeTime,
} from "../lib/crmModel";
import { buildBetaSearch, buildCrmHash, parseBetaSearch } from "../lib/crmUrl";
import { betaLeadToHost } from "../services/crmService";
import { Segmented } from "../components/crm/fields";
import { LINK_BUTTON_CLASS } from "../components/crm/home/DueList";

const PAGE_ID = "beta-leads";
const OPEN_MS = 8000;
const OFFLINE_WORDS = "You're offline. You can read the list and open hosts, but a lead can't be added to Hosts until you're back.";
const NOT_READY_WORDS = "Beta leads for the whole team aren't switched on yet. Try again in a few minutes, or tell an admin.";
const SHOW_OPTIONS = [
  { value: "all", label: "All" },
  { value: "new", label: "New" },
];
const ACTION_CELL = "!max-w-none !whitespace-normal !overflow-visible";

// Stored source value → short label.
const SOURCE_LABELS = {
  organiser_marketing_hero: "Hero",
  organiser_marketing_nav: "Nav",
  organiser_marketing: "Site",
};

// ─── Summary metric chip (mirror LaunchCitiesPage SummaryChip) ────────────────
function SummaryChip({ icon: Icon, label, value, accent = "muted" }) {
  const bubbleBg = accent === "brand" ? "bg-[var(--color-brand-50)]" : "bg-[var(--gray-100)]";
  const iconColor = accent === "brand" ? "text-[var(--color-brand-500)]" : "text-[var(--gray-500)]";
  return (
    <div className="inline-flex items-center gap-2.5 rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-primary)] px-4 py-3 shadow-[var(--shadow-sm)]">
      <span className={`flex h-9 w-9 items-center justify-center rounded-full ${bubbleBg}`}>
        {Icon && <Icon className={`h-[18px] w-[18px] ${iconColor}`} />}
      </span>
      <div className="leading-tight">
        <p className="text-[20px] font-bold tabular-nums text-[var(--color-text-primary)]">{value}</p>
        <p className="text-xs text-[var(--color-text-secondary)]">{label}</p>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export function BetaLeadsPage() {
  const { addToast } = useToast();
  const online = useOnline();
  const summary = useCrmSummary("betaLeads");
  const { patch, refetch } = summary;
  const data = summary.data;
  const [search, setSearch] = useHashQuery(PAGE_ID);
  const show = useMemo(() => parseBetaSearch(search).show, [search]);
  // An address value that is not "new" is dropped quietly.
  useEffect(() => {
    if (search !== buildBetaSearch({ show })) setSearch(buildBetaSearch({ show }), { replace: true });
  }, [search, show, setSearch]);

  // Leads whose "Add to Hosts" is on its way: a second press sends nothing.
  const [adding, setAdding] = useState(() => new Set());
  const addingRef = useRef(new Set());
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const leads = useMemo(() => (Array.isArray(data?.leads) ? data.leads : []), [data]);
  const rows = useMemo(() => (show === "new" ? leads.filter((l) => betaLeadButton(l) === "add") : leads), [leads, show]);
  const total = data?.total ?? leads.length;
  const newCount = data?.new_count ?? 0;
  const thisWeek = useMemo(() => {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return leads.filter((r) => new Date(r.created_at).getTime() >= cutoff).length;
  }, [leads]);

  const handleCopyEmail = useCallback(
    async (emailValue) => {
      try {
        await navigator.clipboard.writeText(emailValue);
        addToast({ variant: "success", title: "Email copied" });
      } catch (err) {
        console.error("[beta-leads] copy was blocked:", err?.message || err);
        addToast({ variant: "error", title: "Couldn't copy the email", description: "Select it and copy it by hand." });
      }
    },
    [addToast]
  );

  const setBusy = (id, on) => {
    const next = new Set(addingRef.current);
    if (on) next.add(id);
    else next.delete(id);
    addingRef.current = next;
    setAdding(next);
  };

  const addToHosts = useCallback(
    async (lead) => {
      if (addingRef.current.has(lead.id)) return;
      if (!online) {
        addToast({ variant: "warning", title: "You're offline", description: "Nothing was added. Try again once you're back." });
        return;
      }
      setBusy(lead.id, true);
      let res;
      try {
        res = await betaLeadToHost(lead.id);
      } catch (err) {
        if (!mountedRef.current) return;
        setBusy(lead.id, false);
        if (err?.token === "not_found") {
          patch((d) => ({ ...d, leads: (d.leads || []).filter((l) => l.id !== lead.id) }));
          addToast({ variant: "warning", title: "That lead is no longer here.", description: "The list is up to date now." });
          refetch({ quiet: true });
        } else if (err?.token === "lead_name_unusable" || err?.token === "forbidden") {
          addToast({ variant: "error", title: `${lead.brand_name} wasn't added`, description: errorWords(err) });
        } else {
          addToast({ variant: "error", title: "That didn't go through. Try again.", description: errorWords(err) });
        }
        return;
      }
      if (!mountedRef.current) return;
      setBusy(lead.id, false);
      const host = res?.record ? { id: res.record.id, name: res.record.name, stage: res.record.stage, linked: res.status !== "duplicate" } : null;
      if (!host) {
        addToast({ variant: "error", title: "That didn't go through. Try again." });
        return;
      }
      // The row switches to "Open host" for this person straight away, and the
      // list is read again for everyone else's changes.
      patch((d) => ({
        ...d,
        leads: (d.leads || []).map((l) => (l.id === lead.id ? { ...l, host } : l)),
        new_count: Math.max(0, Number(d.new_count || 0) - (betaLeadButton(lead) === "add" ? 1 : 0)),
      }));
      refetch({ quiet: true });
      const words = betaConvertMessage(res, lead.brand_name);
      addToast({
        variant: words.variant,
        title: words.title,
        description: words.description,
        duration: OPEN_MS,
        action: {
          label: "Open host",
          onClick: () => {
            window.location.hash = buildCrmHash("hosts", { card: host.id });
          },
        },
      });
    },
    [online, patch, refetch, addToast]
  );

  const columns = useMemo(
    () => [
      {
        key: "business",
        label: "Business",
        cellClassName: "!whitespace-normal",
        render: (_v, row) => (
          <div className="min-w-[160px]">
            <p className="break-words font-semibold text-[var(--color-text-primary)]">{row.brand_name}</p>
            <div className="mt-1 flex flex-wrap gap-1">
              {(Array.isArray(row.brand_types) ? row.brand_types : []).map((t) => (
                <Badge key={t} variant="default">
                  {betaTypeLabel(t)}
                </Badge>
              ))}
            </div>
          </div>
        ),
      },
      {
        key: "contact_name",
        label: "Contact",
        width: "150px",
        render: (_v, row) => <span className="truncate text-[var(--color-text-secondary)]">{row.contact_name}</span>,
      },
      {
        key: "city",
        label: "City",
        width: "140px",
        render: (_v, row) => <span className="truncate text-[var(--color-text-secondary)]">{row.city}</span>,
      },
      {
        key: "email",
        label: "Email",
        render: (_v, row) => (
          <button
            type="button"
            onClick={() => handleCopyEmail(row.email)}
            aria-label={`Copy ${row.email}`}
            className="inline-flex min-h-10 max-w-full cursor-pointer items-center truncate rounded-md font-mono text-[13px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)]"
          >
            {row.email}
          </button>
        ),
      },
      {
        key: "source",
        label: "Source",
        width: "100px",
        render: (_v, row) => <Badge variant="outline">{SOURCE_LABELS[row.source] || row.source}</Badge>,
      },
      {
        key: "created_at",
        label: "Received",
        width: "120px",
        sortable: true,
        cellClassName: "tabular-nums",
        render: (_v, row) => (
          <span className="tabular-nums text-[var(--color-text-secondary)]" title={new Date(row.created_at).toISOString()}>
            {relativeTime(row.created_at)}
          </span>
        ),
      },
      {
        key: "host",
        label: "In Hosts",
        cellClassName: ACTION_CELL,
        render: (_v, row) =>
          betaLeadButton(row) === "open" ? (
            <div className="flex min-w-[150px] flex-col items-start gap-1">
              <a
                href={buildCrmHash("hosts", { card: row.host.id })}
                aria-label={`Open the host ${row.host.name || row.brand_name}`}
                className={`${LINK_BUTTON_CLASS} h-8 px-3 text-xs max-sm:h-10`}
              >
                Open host
              </a>
              {row.host.linked === false ? (
                <span className="text-xs text-[var(--color-text-tertiary)]">A host with this name already exists.</span>
              ) : null}
            </div>
          ) : (
            <div className="flex min-w-[150px] flex-col items-start gap-1">
              <Button
                size="sm"
                className="max-sm:h-10"
                disabled={!online || adding.has(row.id)}
                title={!online ? "You're offline" : undefined}
                aria-label={`Add ${row.brand_name} to Hosts`}
                onClick={() => addToHosts(row)}
              >
                {adding.has(row.id) ? "Adding…" : "Add to Hosts"}
              </Button>
              <span className="text-xs text-[var(--color-text-tertiary)]">{betaSuggestionLine(row)}</span>
            </div>
          ),
      },
    ],
    [handleCopyEmail, addToHosts, adding, online]
  );

  const error = summary.error;
  const loading = !error && summary.loading;

  return (
    <div className="flex min-w-0 flex-col gap-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">Beta Leads</h1>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
            Everyone who asked for early access from the business site. Add a lead to Hosts to start working it.
          </p>
        </div>
        {loading ? (
          <Skeleton width={72} height={22} rounded="full" className="mt-1 shrink-0" />
        ) : error ? null : (
          <Badge variant={newCount > 0 ? "warning" : "success"} dot className="mt-1 shrink-0">
            {newCount > 0 ? `${newCount} new` : "All in Hosts"}
          </Badge>
        )}
      </div>

      {!online && <AlertCard variant="warning">{OFFLINE_WORDS}</AlertCard>}

      {/* Load error */}
      {error ? (
        error.token === "forbidden" ? (
          <AlertCard
            variant="error"
            title="You can't open Beta leads any more"
            action={
              <Button variant="secondary" size="sm" onClick={() => window.location.reload()}>
                Reload
              </Button>
            }
          >
            {errorWords(error)}
          </AlertCard>
        ) : (
          <AlertCard
            variant="error"
            title="Couldn't load beta leads"
            action={
              <Button variant="secondary" size="sm" onClick={() => refetch()}>
                Retry
              </Button>
            }
          >
            {error.token === "not_ready" ? NOT_READY_WORDS : loadErrorWords(error)}
          </AlertCard>
        )
      ) : (
        <>
          {/* Summary strip */}
          {loading ? (
            <div className="flex flex-wrap items-center gap-3">
              <Skeleton width={160} height={62} style={{ borderRadius: 12 }} />
              <Skeleton width={160} height={62} style={{ borderRadius: 12 }} />
              <Skeleton width={160} height={62} style={{ borderRadius: 12 }} />
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <SummaryChip icon={Inbox} label="Total leads" value={total} accent="brand" />
              <SummaryChip icon={CalendarClock} label="This week" value={thisWeek} accent="muted" />
              <SummaryChip icon={Sparkles} label="New" value={newCount} accent="muted" />
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Segmented
              label="Which leads to show"
              options={SHOW_OPTIONS}
              value={show}
              disabled={loading}
              onChange={(value) => setSearch(buildBetaSearch({ show: value }), { replace: true })}
            />
            {!loading && data?.truncated ? (
              <span className="text-xs text-[var(--color-text-tertiary)]">Showing the newest 1,000.</span>
            ) : null}
          </div>

          {/* List */}
          <SectionCard
            title="Beta leads"
            subtitle={loading ? undefined : show === "new" ? `${rows.length} new of ${total}` : `${total} total`}
            noPadding
          >
            <DataTable
              columns={columns}
              rows={rows}
              loading={loading}
              striped
              emptyIcon={Inbox}
              emptyMessage={
                leads.length === 0
                  ? "No beta leads yet. New ones show here when a business asks for early access; until then, add a host by hand."
                  : "No new leads. Every lead is already in Hosts."
              }
              emptyAction={
                leads.length === 0 ? (
                  <a href={buildCrmHash("hosts", {})} className={LINK_BUTTON_CLASS}>
                    Open Hosts
                  </a>
                ) : (
                  <Button variant="secondary" onClick={() => setSearch("", { replace: true })}>
                    Show all
                  </Button>
                )
              }
              getRowId={(r) => r.id}
            />
          </SectionCard>
        </>
      )}
    </div>
  );
}
