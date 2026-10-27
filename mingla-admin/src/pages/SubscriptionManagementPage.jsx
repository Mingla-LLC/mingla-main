// Subscriptions — who has Mingla+, why, and when it ends.
//
// Issue #4130 (Wave 2b):
//   - real tiers (what each person would have with Global Plus off) beside the
//     Global Plus switch; turning it off says how many people lose access and
//     asks to confirm;
//   - "ending in 3 days" through an admin RPC (the browser cannot read the
//     overrides table, so the old banner could never fire);
//   - Give and Remove Mingla+ go through the audited RPCs, with a reason; the
//     server records the signed-in admin, not a client field;
//   - sort, paging and export run over the whole filtered list on the server;
//     the next page follows the server's total (it used to stop at exactly 20);
//   - a profile with no first name shows "No first name".
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle, ChevronLeft, ChevronRight, Crown, Download, Gift, Shield, UserCheck, Users,
} from "lucide-react";
import { StatCard, SectionCard, AlertCard } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Badge } from "../components/ui/Badge";
import { SearchInput } from "../components/ui/SearchInput";
import { DataTable } from "../components/ui/Table";
import { Modal, ModalBody, ModalFooter } from "../components/ui/Modal";
import { Drawer } from "../components/ui/Drawer";
import { Spinner } from "../components/ui/Spinner";
import { StatCardSkeleton } from "../components/ui/Skeleton";
import { LoadError } from "../components/ui/LoadError";
import { PageHeader } from "../components/ui/PageHeader";
import { useToast } from "../context/ToastContext";
import { formatDate, formatDateTime } from "../lib/formatters";
import { exportCsv } from "../lib/exportCsv";
import { EXPORT_ROW_CAP } from "../lib/listAll";
import {
  GRANT_DURATIONS,
  SUBSCRIPTIONS_PAGE_SIZE,
  getsNowLabel,
  globalPlusConfirmCopy,
  internalToggleLabel,
  tilesScopeNote,
  hasNextPage,
  pageRangeLabel,
  personName,
  realTierLabel,
  subscriptionErrorMessage,
} from "../lib/subscriptionsView";
import {
  getGlobalPlus,
  getOverrideHistory,
  getSubscriptionOverview,
  listAllSubscriptions,
  listExpiringOverrides,
  listSubscriptions,
  setGlobalPlus,
} from "../services/subscriptionsService";
import { grantOverrideAudited, revokeOverrideAudited } from "../services/adminMoneyActService";

const SEARCH_DEBOUNCE_MS = 400;

const FILTERS = [
  { id: null, label: "Everyone" },
  { id: "plus", label: "Mingla+ of their own" },
  { id: "free", label: "Free" },
  { id: "admin", label: "Given by an admin" },
];

// DataTable column key → server sort key.
const SORT_KEYS = { name: "name", real_tier: "real_tier", override: "override_expires_at", created_at: "joined" };

export function SubscriptionManagementPage() {
  const { addToast } = useToast();
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // ── list ───────────────────────────────────────────────────────────────
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filter, setFilter] = useState(null);
  const [sort, setSort] = useState({ key: "created_at", dir: "desc" });
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState(null);
  const [exporting, setExporting] = useState(false);

  // ── overview, expiring, Global Plus ────────────────────────────────────
  const [overview, setOverview] = useState(null);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [overviewError, setOverviewError] = useState(null);
  const [expiring, setExpiring] = useState(null);
  const [expiringError, setExpiringError] = useState(null);
  const [globalPlusOn, setGlobalPlusOn] = useState(null);
  const [globalPlusError, setGlobalPlusError] = useState(null);
  const [globalConfirm, setGlobalConfirm] = useState(false);
  const [globalSaving, setGlobalSaving] = useState(false);
  const [globalReason, setGlobalReason] = useState("");
  // #4130: staff and test accounts are hidden unless asked for.
  const [showInternal, setShowInternal] = useState(false);
  const [internalHidden, setInternalHidden] = useState(0);

  // ── person drawer ──────────────────────────────────────────────────────
  const [person, setPerson] = useState(null);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState(null);
  const [grantDays, setGrantDays] = useState(30);
  const [grantReason, setGrantReason] = useState("");
  const [revokeReason, setRevokeReason] = useState("");
  const [pendingWrite, setPendingWrite] = useState(null); // "grant" | "revoke"
  const [writing, setWriting] = useState(false);
  const [writeError, setWriteError] = useState(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(0);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [search]);

  const query = useMemo(() => ({
    search: debouncedSearch,
    filter,
    sort: SORT_KEYS[sort.key] ?? "joined",
    desc: sort.dir !== "asc",
    showInternal,
  }), [debouncedSearch, filter, sort, showInternal]);

  const fetchList = useCallback(async () => {
    setListLoading(true);
    setListError(null);
    try {
      const result = await listSubscriptions({ ...query, page, pageSize: SUBSCRIPTIONS_PAGE_SIZE });
      if (!mountedRef.current) return;
      setRows(result.rows);
      setTotal(result.total);
      setInternalHidden(result.internalHidden);
    } catch (err) {
      if (mountedRef.current) setListError(err.message || "Couldn't load people.");
    } finally {
      if (mountedRef.current) setListLoading(false);
    }
  }, [query, page]);

  const fetchOverview = useCallback(async () => {
    setOverviewLoading(true);
    setOverviewError(null);
    try {
      const data = await getSubscriptionOverview({ showInternal });
      if (mountedRef.current) setOverview(data);
    } catch (err) {
      if (mountedRef.current) {
        setOverview(null);
        setOverviewError(err.message || "Couldn't load the counts.");
      }
    } finally {
      if (mountedRef.current) setOverviewLoading(false);
    }
  }, [showInternal]);

  const fetchExpiring = useCallback(async () => {
    setExpiringError(null);
    try {
      const data = await listExpiringOverrides(3);
      if (mountedRef.current) setExpiring(data);
    } catch (err) {
      if (mountedRef.current) {
        setExpiring(null);
        setExpiringError(err.message || "Couldn't check grants ending soon.");
      }
    }
  }, []);

  const fetchGlobalPlus = useCallback(async () => {
    setGlobalPlusError(null);
    try {
      const on = await getGlobalPlus();
      if (mountedRef.current) setGlobalPlusOn(on);
    } catch (err) {
      if (mountedRef.current) {
        setGlobalPlusOn(null);
        setGlobalPlusError(err.message || "Couldn't read the Global Plus switch.");
      }
    }
  }, []);

  useEffect(() => { void fetchList(); }, [fetchList]);
  useEffect(() => {
    void fetchOverview();
    void fetchExpiring();
    void fetchGlobalPlus();
  }, [fetchOverview, fetchExpiring, fetchGlobalPlus]);

  const refreshAll = useCallback(() => {
    void fetchList();
    void fetchOverview();
    void fetchExpiring();
  }, [fetchList, fetchOverview, fetchExpiring]);

  // ── Global Plus ────────────────────────────────────────────────────────
  const globalCopy = globalPlusConfirmCopy({
    turningOn: globalPlusOn === false,
    realFree: overview ? overview.real_free : null,
    realPlus: overview ? overview.real_plus : null,
  });

  const confirmGlobalPlus = async () => {
    if (globalPlusOn === null || !globalCopy.confirmLabel || !globalReason.trim()) return;
    const next = !globalPlusOn;
    setGlobalSaving(true);
    try {
      await setGlobalPlus(next, globalReason.trim());
      setGlobalPlusOn(next);
      setGlobalConfirm(false);
      setGlobalReason("");
      addToast({
        variant: "success",
        title: next ? "Global Plus is on" : "Global Plus is off",
        description: next
          ? "Everyone has Mingla+ features."
          : "People now have their real tier.",
      });
      // The server wrote admin_audit_log (admin_set_global_plus).
      refreshAll();
    } catch (err) {
      addToast({ variant: "error", title: "Couldn't change Global Plus", description: subscriptionErrorMessage(err) });
      void fetchGlobalPlus();
    } finally {
      if (mountedRef.current) setGlobalSaving(false);
    }
  };

  // ── export over the whole filtered list ────────────────────────────────
  const handleExport = async () => {
    setExporting(true);
    try {
      const { rows: all, total: counted, truncated } = await listAllSubscriptions(query);
      const csvRows = all.map((row) => ({
        user_id: row.user_id,
        name: personName(row),
        phone: row.phone ?? "",
        real_tier: realTierLabel(row).label,
        gets_now: getsNowLabel(row),
        admin_grant: row.override_tier ?? "",
        admin_grant_ends: row.override_expires_at ?? "",
        trial_ends: row.trial_ends_at ?? "",
        paid_until: row.current_period_end ?? "",
        joined: row.created_at,
      }));
      exportCsv([
        { key: "user_id", label: "User ID" },
        { key: "name", label: "Name" },
        { key: "phone", label: "Phone" },
        { key: "real_tier", label: "Real tier" },
        { key: "gets_now", label: "Gets now" },
        { key: "admin_grant", label: "Given by admin" },
        { key: "admin_grant_ends", label: "Admin grant ends" },
        { key: "trial_ends", label: "Trial ends" },
        { key: "paid_until", label: "Paid until" },
        { key: "joined", label: "Joined" },
      ], csvRows, "subscriptions");
      addToast({
        variant: truncated ? "warning" : "success",
        title: truncated
          ? `Exported the first ${csvRows.length.toLocaleString("en-US")} of ${counted.toLocaleString("en-US")} people`
          : `Exported all ${csvRows.length.toLocaleString("en-US")} people`,
        description: truncated ? `One export holds up to ${EXPORT_ROW_CAP.toLocaleString("en-US")} rows. Narrow the search to get the rest.` : undefined,
      });
    } catch (err) {
      addToast({ variant: "error", title: "Couldn't export", description: err.message || "Try again." });
    } finally {
      if (mountedRef.current) setExporting(false);
    }
  };

  // ── person drawer ──────────────────────────────────────────────────────
  const openPerson = async (row) => {
    setPerson(row);
    setGrantDays(30);
    setGrantReason("");
    setRevokeReason("");
    setPendingWrite(null);
    setWriteError(null);
    setHistory([]);
    setHistoryError(null);
    setHistoryLoading(true);
    try {
      const data = await getOverrideHistory(row.user_id);
      if (mountedRef.current) setHistory(data);
    } catch (err) {
      if (mountedRef.current) setHistoryError(err.message || "Couldn't load the history.");
    } finally {
      if (mountedRef.current) setHistoryLoading(false);
    }
  };

  const closePerson = () => {
    if (writing) return;
    setPerson(null);
    setPendingWrite(null);
  };

  const confirmWrite = async () => {
    if (!person || !pendingWrite) return;
    setWriting(true);
    setWriteError(null);
    try {
      const result = pendingWrite === "grant"
        ? await grantOverrideAudited({
          user_id: person.user_id,
          tier: "mingla_plus",
          reason: grantReason.trim(),
          duration_days: grantDays,
        })
        : await revokeOverrideAudited({
          override_id: person.override_id,
          user_id: person.user_id,
          reason: revokeReason.trim(),
        });
      if (result?.error) throw result.error;
      addToast({
        variant: "success",
        title: pendingWrite === "grant" ? "Mingla+ given" : "Admin grant removed",
        description: "Logged on the server with your name and reason.",
      });
      setPerson(null);
      setPendingWrite(null);
      refreshAll();
    } catch (err) {
      setWriteError(subscriptionErrorMessage(err));
    } finally {
      if (mountedRef.current) setWriting(false);
    }
  };

  // ── table ──────────────────────────────────────────────────────────────
  const columns = [
    {
      key: "name",
      label: "Person",
      sortable: true,
      render: (_v, row) => {
        const name = personName(row);
        return (
          <div>
            <p className={name.startsWith("No first name") ? "text-[var(--color-text-tertiary)] italic" : "font-medium text-[var(--color-text-primary)]"}>
              {name}
            </p>
            <p className="text-xs text-[var(--color-text-tertiary)]">{row.phone || "No phone"}</p>
          </div>
        );
      },
    },
    {
      key: "real_tier",
      label: "Real tier",
      sortable: true,
      render: (_v, row) => {
        const tier = realTierLabel(row);
        return <Badge variant={tier.variant}>{tier.label}</Badge>;
      },
    },
    {
      key: "gets_now",
      label: "Gets now",
      render: (_v, row) => <span className="text-sm text-[var(--color-text-secondary)]">{getsNowLabel(row)}</span>,
    },
    {
      key: "override",
      label: "Given by admin",
      sortable: true,
      render: (_v, row) => row.override_id ? (
        <div>
          <Badge variant="info"><Shield className="h-3 w-3 mr-1 inline" />{row.override_tier === "free" ? "Free" : "Mingla+"}</Badge>
          <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5">Ends {formatDate(row.override_expires_at)}</p>
        </div>
      ) : <span className="text-xs text-[var(--color-text-tertiary)]">–</span>,
    },
    {
      key: "created_at",
      label: "Joined",
      sortable: true,
      render: (_v, row) => <span className="text-sm text-[var(--color-text-secondary)]">{formatDate(row.created_at)}</span>,
    },
    {
      key: "actions",
      label: "",
      render: (_v, row) => (
        <Button variant="ghost" size="sm" onClick={() => void openPerson(row)} aria-label={`Open ${personName(row)}`}>
          Open
        </Button>
      ),
    },
  ];

  const nextPage = hasNextPage(total, page);
  const grantReasonOk = grantReason.trim().length > 0;
  const revokeReasonOk = revokeReason.trim().length > 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Subscriptions"
        description="Who has Mingla+, why, and when it ends."
        actions={
          <Button variant="secondary" size="sm" icon={Download} onClick={() => void handleExport()} loading={exporting} disabled={exporting || listLoading}>
            Export all
          </Button>
        }
      />

      {/* Global Plus, with the real tiers beside it */}
      {globalPlusError ? (
        <LoadError title="Couldn't read the Global Plus switch" message={globalPlusError} onRetry={() => void fetchGlobalPlus()} />
      ) : globalPlusOn !== null && (
        <SectionCard>
          <div className="flex flex-wrap items-center gap-4">
            <Crown className={`h-5 w-5 ${globalPlusOn ? "text-[var(--color-brand-500)]" : "text-[var(--color-text-tertiary)]"}`} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-[var(--color-text-primary)]">
                {globalPlusOn ? "Everyone gets Mingla+ right now" : "Global Plus is off"}
              </p>
              <p className="text-sm text-[var(--color-text-secondary)] mt-0.5">
                {globalPlusOn
                  ? overview
                    ? `Global Plus is on, so all ${Number(overview.total).toLocaleString("en-US")} people can use Plus features. ${Number(overview.real_plus).toLocaleString("en-US")} have Mingla+ of their own; ${Number(overview.real_free).toLocaleString("en-US")} would be free without it.`
                    : "Global Plus is on, so everyone can use Plus features."
                  : "People have their real tier: paid, trial, referral, given by an admin, or free."}
              </p>
            </div>
            <Button variant="secondary" onClick={() => setGlobalConfirm(true)}>
              {globalPlusOn ? "Turn off…" : "Turn on…"}
            </Button>
          </div>
        </SectionCard>
      )}

      {/* Grants ending in the next 3 days */}
      {expiringError ? (
        <LoadError title="Couldn't check grants ending soon" message={expiringError} onRetry={() => void fetchExpiring()} />
      ) : expiring && expiring.count > 0 && (
        <AlertCard variant="warning" title={`${expiring.count} admin grant${expiring.count === 1 ? "" : "s"} end in the next 3 days`}>
          {expiring.rows.slice(0, 5).map((r) => `${r.display_name || "No first name"} (${formatDate(r.expires_at)})`).join(", ")}
          {expiring.count > 5 ? ` and ${expiring.count - 5} more` : ""}
        </AlertCard>
      )}

      {/* Real tiers */}
      {overviewError ? (
        <LoadError title="Couldn't load the counts" message={overviewError} onRetry={() => void fetchOverview()} />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {overviewLoading || !overview ? (
            Array.from({ length: 4 }).map((_, i) => <StatCardSkeleton key={i} />)
          ) : (
            <>
              <StatCard label="People" value={Number(overview.total).toLocaleString("en-US")} icon={Users} />
              <StatCard label="Mingla+ of their own (without Global Plus)" value={Number(overview.real_plus).toLocaleString("en-US")} icon={Crown} />
              <StatCard label="Free (without Global Plus)" value={Number(overview.real_free).toLocaleString("en-US")} icon={UserCheck} />
              <StatCard
                label={`Given by an admin · ${Number(overview.expiring_3d).toLocaleString("en-US")} ending in 3 days`}
                value={Number(overview.admin_given).toLocaleString("en-US")}
                icon={Shield}
              />
            </>
          )}
          {overview && tilesScopeNote(overview) ? (
            <p className="text-xs text-[var(--color-text-tertiary)] sm:col-span-2 lg:col-span-4" data-testid="subscriptions-tiles-scope">
              {tilesScopeNote(overview)}
            </p>
          ) : null}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1">
          <SearchInput
            placeholder="Search by name or phone…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onClear={() => setSearch("")}
          />
        </div>
        <div className="flex gap-2 flex-wrap" role="group" aria-label="Filter by real tier">
          {FILTERS.map((f) => (
            <button
              key={f.id ?? "all"}
              type="button"
              aria-pressed={filter === f.id}
              onClick={() => { setFilter(f.id); setPage(0); }}
              className={[
                "px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-150 cursor-pointer",
                filter === f.id
                  ? "bg-[var(--color-brand-500)] text-white"
                  : "bg-[var(--color-background-secondary)] text-[var(--color-text-secondary)] hover:bg-[var(--color-background-tertiary)]",
              ].join(" ")}
            >
              {f.label}
            </button>
          ))}
          <button
            type="button"
            aria-pressed={showInternal}
            onClick={() => { setShowInternal((v) => !v); setPage(0); }}
            className={[
              "px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-150 cursor-pointer",
              showInternal
                ? "bg-[var(--color-brand-500)] text-white"
                : "bg-[var(--color-background-secondary)] text-[var(--color-text-secondary)] hover:bg-[var(--color-background-tertiary)]",
            ].join(" ")}
          >
            {internalToggleLabel(showInternal, internalHidden)}
          </button>
        </div>
      </div>

      {/* Table */}
      {listError ? (
        <LoadError title="Couldn't load people" message={listError} onRetry={() => void fetchList()} />
      ) : (
        <SectionCard noPadding>
          <DataTable
            columns={columns}
            rows={rows}
            getRowId={(row) => row.user_id}
            loading={listLoading}
            sortKey={sort.key}
            sortDirection={sort.dir}
            onSort={(key, dir) => {
              setSort(key && dir ? { key, dir } : { key: "created_at", dir: "desc" });
              setPage(0);
            }}
            emptyMessage={debouncedSearch || filter ? "No one matches this search and filter." : "People appear here once they sign up."}
          />
          {!listLoading && total > 0 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--color-border)]">
              <p className="text-sm text-[var(--color-text-tertiary)]">{pageRangeLabel(total, page, rows.length)}</p>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)} aria-label="Previous page">
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button variant="secondary" size="sm" disabled={!nextPage} onClick={() => setPage((p) => p + 1)} aria-label="Next page">
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </SectionCard>
      )}

      {/* Global Plus confirmation */}
      <Modal open={globalConfirm} onClose={() => (globalSaving ? null : setGlobalConfirm(false))} title={globalCopy.title} size="sm" destructive={globalPlusOn === true}>
        <ModalBody>
          <AlertCard variant={globalPlusOn ? "warning" : "info"}>{globalCopy.body}</AlertCard>
          <div className="mt-3">
            <Input
              label="Reason (saved with your name)"
              value={globalReason}
              onChange={(e) => setGlobalReason(e.target.value)}
              placeholder="Why you are changing it"
              disabled={globalSaving}
            />
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="ghost" disabled={globalSaving} onClick={() => setGlobalConfirm(false)}>
            {globalPlusOn ? "Keep it on" : "Keep it off"}
          </Button>
          {globalCopy.confirmLabel && (
            <Button variant={globalPlusOn ? "danger" : "primary"} loading={globalSaving} disabled={globalSaving || !globalReason.trim()} onClick={() => void confirmGlobalPlus()}>
              {globalCopy.confirmLabel}
            </Button>
          )}
        </ModalFooter>
      </Modal>

      {/* Person drawer: grant, remove, history */}
      <Drawer open={person !== null} onClose={closePerson} title={person ? personName(person) : ""}>
        {person && (
          <div className="space-y-5 text-sm">
            <dl className="grid grid-cols-2 gap-3">
              <div><dt className="text-[var(--color-text-tertiary)]">Real tier</dt><dd>{realTierLabel(person).label}</dd></div>
              <div><dt className="text-[var(--color-text-tertiary)]">Gets now</dt><dd>{getsNowLabel(person)}</dd></div>
              <div><dt className="text-[var(--color-text-tertiary)]">Joined</dt><dd>{formatDate(person.created_at)}</dd></div>
              <div><dt className="text-[var(--color-text-tertiary)]">Phone</dt><dd>{person.phone || "No phone"}</dd></div>
              {person.current_period_end && <div><dt className="text-[var(--color-text-tertiary)]">Paid until</dt><dd>{formatDate(person.current_period_end)}</dd></div>}
              {person.trial_ends_at && <div><dt className="text-[var(--color-text-tertiary)]">Trial ends</dt><dd>{formatDate(person.trial_ends_at)}</dd></div>}
            </dl>

            {writeError && <AlertCard variant="error">{writeError}</AlertCard>}

            {person.override_id ? (
              <section className="space-y-3 rounded-lg border border-[var(--gray-200)] p-3">
                <h3 className="font-semibold text-[var(--color-text-primary)]">Admin grant</h3>
                <p className="text-[var(--color-text-secondary)]">
                  {person.override_tier === "free" ? "Set to Free" : "Mingla+"} until {formatDate(person.override_expires_at)}.
                </p>
                <Input
                  label="Reason for removing it (logged on the server with your name)"
                  value={revokeReason}
                  onChange={(e) => { setRevokeReason(e.target.value); setPendingWrite(null); }}
                  placeholder="e.g. partnership ended"
                />
                {pendingWrite === "revoke" ? (
                  <AlertCard
                    variant="warning"
                    title="Remove this grant?"
                    action={
                      <div className="flex gap-2">
                        <Button variant="ghost" size="sm" disabled={writing} onClick={() => setPendingWrite(null)}>Cancel</Button>
                        <Button variant="danger" size="sm" loading={writing} onClick={() => void confirmWrite()}>Remove grant</Button>
                      </div>
                    }
                  >
                    {personName(person)} goes back to their real tier straight away{globalPlusOn ? " (Global Plus still gives them Mingla+ while it is on)" : ""}.
                  </AlertCard>
                ) : (
                  <Button variant="secondary" disabled={!revokeReasonOk} onClick={() => setPendingWrite("revoke")}>
                    Remove grant…
                  </Button>
                )}
              </section>
            ) : (
              <section className="space-y-3 rounded-lg border border-[var(--gray-200)] p-3">
                <h3 className="font-semibold text-[var(--color-text-primary)]">Give Mingla+</h3>
                <label className="flex flex-col gap-1">
                  <span className="font-medium text-[var(--color-text-primary)]">For how long</span>
                  <select
                    value={grantDays}
                    onChange={(e) => { setGrantDays(Number(e.target.value)); setPendingWrite(null); }}
                    className="h-10 rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3"
                  >
                    {GRANT_DURATIONS.map((d) => <option key={d.days} value={d.days}>{d.label}</option>)}
                  </select>
                </label>
                <Input
                  label="Reason (logged on the server with your name)"
                  value={grantReason}
                  onChange={(e) => { setGrantReason(e.target.value); setPendingWrite(null); }}
                  placeholder="e.g. creator partner"
                />
                {pendingWrite === "grant" ? (
                  <AlertCard
                    variant="info"
                    title="Give Mingla+?"
                    action={
                      <div className="flex gap-2">
                        <Button variant="ghost" size="sm" disabled={writing} onClick={() => setPendingWrite(null)}>Cancel</Button>
                        <Button variant="primary" size="sm" loading={writing} onClick={() => void confirmWrite()}>Give Mingla+</Button>
                      </div>
                    }
                  >
                    {personName(person)} gets Mingla+ for {GRANT_DURATIONS.find((d) => d.days === grantDays)?.label ?? `${grantDays} days`}, even if Global Plus is turned off.
                  </AlertCard>
                ) : (
                  <Button variant="primary" icon={Gift} disabled={!grantReasonOk} onClick={() => setPendingWrite("grant")}>
                    Give Mingla+…
                  </Button>
                )}
              </section>
            )}

            <section className="space-y-2">
              <h3 className="font-semibold text-[var(--color-text-primary)]">History</h3>
              {historyLoading ? (
                <div className="flex justify-center py-6"><Spinner /></div>
              ) : historyError ? (
                <LoadError title="Couldn't load the history" message={historyError} onRetry={() => void openPerson(person)} />
              ) : history.length === 0 ? (
                <p className="text-[var(--color-text-tertiary)]">No admin grants for this person yet.</p>
              ) : (
                history.map((entry) => (
                  <div key={entry.id} className="rounded-lg border border-[var(--gray-200)] p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={entry.tier === "mingla_plus" ? "brand" : "default"}>{entry.tier === "mingla_plus" ? "Mingla+" : "Free"}</Badge>
                      {entry.is_active && <Badge variant="success">Active</Badge>}
                      {entry.revoked_at && <Badge variant="error">Removed</Badge>}
                      {!entry.is_active && !entry.revoked_at && <Badge variant="default">Ended</Badge>}
                    </div>
                    <p className="mt-1 text-[var(--color-text-primary)]">{entry.reason}</p>
                    <p className="mt-1 text-xs text-[var(--color-text-tertiary)]">
                      {formatDate(entry.starts_at)} – {formatDate(entry.expires_at)}
                      {entry.revoked_at ? ` · removed ${formatDateTime(entry.revoked_at)}` : ""}
                    </p>
                  </div>
                ))
              )}
            </section>
          </div>
        )}
      </Drawer>

      {!overviewError && overview && overview.global_plus !== undefined && globalPlusOn !== null && overview.global_plus !== globalPlusOn && (
        <p className="flex items-center gap-2 text-xs text-[var(--color-text-tertiary)]">
          <AlertTriangle className="h-3.5 w-3.5" /> The switch changed while the counts were loading. Refresh to see the latest.
        </p>
      )}
    </div>
  );
}
