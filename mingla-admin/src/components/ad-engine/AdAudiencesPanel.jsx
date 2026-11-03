import { useCallback, useEffect, useMemo, useState } from "react";
import { adsErrorWords } from "../../lib/systemPages";
import { RefreshCw } from "lucide-react";
import { AlertCard, SectionCard } from "../ui/Card";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Spinner } from "../ui/Spinner";
import {
  audienceErrorCopy,
  audienceFilterValues,
  audienceStatus,
  formatAudienceSize,
  PAID_SOCIAL_PLATFORMS,
} from "../../lib/adAudiencesModel";
import {
  checkAudienceTerms,
  confirmAudienceTerms,
  createListAudience,
  listAdAudiences,
  parseEdgeError,
  previewListAudience,
  refreshAdAudiences,
  retireListAudience,
} from "../../services/adEngineService";

// ── #4238 wave 2: customer lists, lookalikes and setup tasks ────────────────

const APP_LABEL = {
  meta: "Meta",
  snapchat: "Snapchat",
  tiktok: "TikTok",
  reddit: "Reddit",
  google: "Google",
};

/** One state pill per app: label + Badge variant. */
// eslint-disable-next-line react-refresh/only-export-components -- pure helper shared with its tests
export function listAudienceStatePill(row) {
  const app = APP_LABEL[row?.platform] ?? row?.platform ?? "App";
  const needed =
    typeof row?.needed_count === "number" && row.needed_count > 0
      ? ` · ${row.needed_count.toLocaleString("en-US")} more needed`
      : "";
  switch (row?.state) {
    case "ready":
      return { label: `${app}: ready`, variant: "success" };
    case "below_minimum":
      return { label: `${app}: not enough people${needed}`, variant: "warning" };
    case "too_small":
      return { label: `${app}: too small`, variant: "warning" };
    case "terms_required":
      return { label: `${app}: terms needed`, variant: "error" };
    case "ineligible":
      return { label: `${app}: not eligible`, variant: "outline" };
    case "unsupported":
      return { label: `${app}: not available yet`, variant: "outline" };
    case "error":
      return { label: `${app}: needs attention`, variant: "error" };
    case "retired":
      return { label: `${app}: removed`, variant: "outline" };
    default:
      return { label: `${app}: getting ready`, variant: "info" };
  }
}

/**
 * Setup tasks shown when a platform's terms are not accepted or unknown, or
 * Google is ineligible or unconfirmed. Mingla never accepts terms itself.
 */
// eslint-disable-next-line react-refresh/only-export-components -- pure helper shared with its tests
export function audienceSetupTasks(terms) {
  const tasks = [];
  for (const row of terms ?? []) {
    if (row.platform === "meta" && row.state !== "accepted") {
      tasks.push({
        key: `meta:${row.connection_id}`,
        connectionId: row.connection_id,
        platform: "meta",
        text: "Meta needs Mingla to accept its Custom Audience terms once. Open Meta Business Manager and accept them, then press Check again.",
        href: `https://business.facebook.com/ads/manage/customaudiences/tos/?act=${encodeURIComponent(String(row.account_id ?? ""))}`,
        action: "check",
      });
    } else if (row.platform === "google" && (row.eligibility !== "eligible" || !row.admin_confirmed_at)) {
      tasks.push({
        key: `google:${row.connection_id}`,
        connectionId: row.connection_id,
        platform: "google",
        text:
          row.eligibility === "eligible"
            ? "Google needs its Customer Match terms accepted in Google Ads before any upload."
            : "Google only lets accounts with more than $50,000 lifetime spend target customer lists. Mingla's account can't yet.",
        action: "confirm",
      });
    } else if (["snapchat", "tiktok", "reddit"].includes(row.platform) && row.state === "not_accepted") {
      tasks.push({
        key: `${row.platform}:${row.connection_id}`,
        connectionId: row.connection_id,
        platform: row.platform,
        text: `${APP_LABEL[row.platform]} asked for its customer-list terms. Accept them in ${APP_LABEL[row.platform]} Ads Manager, then confirm here.`,
        action: "confirm",
      });
    }
  }
  return tasks;
}

const SOURCE_OPTIONS = [
  { value: "everyone", label: "Everyone" },
  { value: "users", label: "Explorer users" },
  { value: "buyers", label: "Buyers" },
  { value: "contacts", label: "Host contacts" },
];
const KIND_OPTIONS = [
  { value: "", label: "Any" },
  { value: "event", label: "Events" },
  { value: "rsvp", label: "RSVPs" },
  { value: "trip", label: "Trips" },
  { value: "experience", label: "Experiences" },
  { value: "venue", label: "Venues" },
];

/** Request body for create/preview from the New audience form. */
// eslint-disable-next-line react-refresh/only-export-components -- pure helper shared with its tests
export function newAudienceBody(form) {
  if (form.mode === "lookalike") {
    return { lookalike_of: form.lookalikeOf, country: String(form.country ?? "").toUpperCase() };
  }
  const filter = {};
  if (form.country) filter.country = String(form.country).toUpperCase();
  if (form.city) filter.city = String(form.city).trim().toLowerCase();
  if (form.pageType) filter.page_type = form.pageType;
  return { source: form.source, filter, display_name: String(form.displayName ?? "").trim() };
}

export function CustomerListsTable({ audiences, onRetire }) {
  if (!audiences || audiences.length === 0) {
    return (
      <p className="py-4 text-sm text-[var(--color-text-secondary)]">
        No customer lists yet. Brand lists appear once a Host opens the ad builder; add Mingla-wide lists below.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[780px] text-left text-sm">
        <thead className="border-b border-[var(--gray-200)] text-xs uppercase text-[var(--color-text-tertiary)]">
          <tr>
            <th className="px-3 py-2">Name</th>
            <th className="px-3 py-2">Key</th>
            <th className="px-3 py-2">Kind</th>
            <th className="px-3 py-2">Size</th>
            <th className="px-3 py-2">Apps</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {audiences.map((row) => (
            <tr key={row.audience_key} className="border-b border-[var(--gray-100)] align-top">
              <td className="px-3 py-3">
                <div className="font-semibold">{row.display_name}</div>
                <div className="mt-1 text-xs text-[var(--color-text-secondary)]">
                  {row.owner_kind === "host" ? row.brand_name ?? "Brand" : "Mingla-wide"}
                  {row.host_visible === false ? " · hidden seed" : ""}
                </div>
              </td>
              <td className="px-3 py-3 font-mono text-xs">{row.audience_key}</td>
              <td className="px-3 py-3">{row.kind === "lookalike" ? `Lookalike · ${row.lookalike_country}` : "List"}</td>
              <td className="px-3 py-3 tabular-nums">{formatAudienceSize(row.member_count)}</td>
              <td className="px-3 py-3">
                <div className="flex flex-wrap gap-1">
                  {(row.platforms ?? []).length === 0 ? (
                    <Badge variant="info">Waiting for the daily sync</Badge>
                  ) : (
                    row.platforms.map((item) => {
                      const pill = listAudienceStatePill(item);
                      return (
                        <Badge key={item.platform} variant={pill.variant}>
                          {pill.label}
                        </Badge>
                      );
                    })
                  )}
                </div>
              </td>
              <td className="px-3 py-3 text-right">
                {row.status === "active" && row.owner_kind === "mingla" && onRetire ? (
                  <Button size="sm" variant="ghost" onClick={() => onRetire(row.audience_key)}>
                    Retire
                  </Button>
                ) : row.status === "retired" ? (
                  <Badge variant="outline">Retired</Badge>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AudienceSetupTasks({ terms, busyKey, onCheck, onConfirm }) {
  const tasks = audienceSetupTasks(terms);
  if (tasks.length === 0) return null;
  return (
    <AlertCard variant="warning" title="Setup tasks">
      <ul className="space-y-3">
        {tasks.map((task) => (
          <li key={task.key} className="space-y-2">
            <p>{task.text}</p>
            <div className="flex flex-wrap gap-2">
              {task.href ? (
                <a
                  className="text-sm font-semibold text-[var(--color-brand-700)] underline"
                  href={task.href}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open Meta Business Manager
                </a>
              ) : null}
              {task.action === "check" ? (
                <Button size="sm" variant="secondary" loading={busyKey === task.key} onClick={() => onCheck?.(task)}>
                  Check again
                </Button>
              ) : task.platform === "google" ? (
                <Button size="sm" variant="secondary" loading={busyKey === task.key} onClick={() => onConfirm?.(task)}>
                  I accepted Google&apos;s Customer Match terms
                </Button>
              ) : (
                <Button size="sm" variant="secondary" loading={busyKey === task.key} onClick={() => onConfirm?.(task)}>
                  I accepted the terms
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </AlertCard>
  );
}

function NewAudienceForm({ lists, onCreated }) {
  const [form, setForm] = useState({ mode: "list", source: "everyone", country: "", city: "", pageType: "", displayName: "", lookalikeOf: "" });
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (patch) => {
    setForm((current) => ({ ...current, ...patch }));
    setPreview(null);
  };
  const seeds = (lists ?? []).filter((row) => row.kind === "list" && row.status === "active");
  const run = async (kind) => {
    setBusy(true);
    setError(null);
    const body = newAudienceBody(form);
    const call = kind === "preview" ? previewListAudience : createListAudience;
    const { data, error: callError } = await call(body);
    if (callError) {
      const parsed = await parseEdgeError(callError);
      setError(adsErrorWords(parsed?.message, kind === "preview" ? "The count could not be loaded." : "The audience could not be created."));
    } else if (kind === "preview") {
      setPreview(data);
    } else {
      onCreated?.(data);
      setPreview(null);
    }
    setBusy(false);
  };
  const field = "min-h-10 w-full rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3 text-sm text-[var(--color-text-primary)]";
  return (
    <div className="mt-6 space-y-3 rounded-xl border border-[var(--gray-200)] p-4">
      <h3 className="text-sm font-semibold">New audience</h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <label className="space-y-1 text-xs font-medium text-[var(--color-text-secondary)]">
          <span>Kind</span>
          <select className={field} value={form.mode} onChange={(e) => set({ mode: e.target.value })}>
            <option value="list">Customer list</option>
            <option value="lookalike">Lookalike of a list</option>
          </select>
        </label>
        {form.mode === "lookalike" ? (
          <label className="space-y-1 text-xs font-medium text-[var(--color-text-secondary)]">
            <span>Lookalike of</span>
            <select className={field} value={form.lookalikeOf} onChange={(e) => set({ lookalikeOf: e.target.value })}>
              <option value="">Choose a list</option>
              {seeds.map((row) => (
                <option key={row.audience_key} value={row.audience_key}>
                  {row.brand_name ? `${row.brand_name} · ` : ""}{row.display_name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <>
            <label className="space-y-1 text-xs font-medium text-[var(--color-text-secondary)]">
              <span>Source</span>
              <select className={field} value={form.source} onChange={(e) => set({ source: e.target.value })}>
                {SOURCE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-xs font-medium text-[var(--color-text-secondary)]">
              <span>City (optional)</span>
              <input className={field} value={form.city} onChange={(e) => set({ city: e.target.value })} placeholder="lagos" />
            </label>
            <label className="space-y-1 text-xs font-medium text-[var(--color-text-secondary)]">
              <span>Page kind</span>
              <select className={field} value={form.pageType} onChange={(e) => set({ pageType: e.target.value })}>
                {KIND_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </label>
          </>
        )}
        <label className="space-y-1 text-xs font-medium text-[var(--color-text-secondary)]">
          <span>{form.mode === "lookalike" ? "Country" : "Country (optional)"}</span>
          <input className={field} value={form.country} maxLength={2} onChange={(e) => set({ country: e.target.value.toUpperCase() })} placeholder="NG" />
        </label>
        {form.mode === "list" ? (
          <label className="space-y-1 text-xs font-medium text-[var(--color-text-secondary)]">
            <span>Name</span>
            <input className={field} value={form.displayName} maxLength={100} onChange={(e) => set({ displayName: e.target.value })} placeholder="Everyone in Nigeria" />
          </label>
        ) : null}
      </div>
      {preview ? (
        <p className="text-sm" aria-live="polite">
          About {formatAudienceSize(preview.member_count)} people
          {Object.keys(preview.by_country ?? {}).length > 0
            ? ` (${Object.entries(preview.by_country).map(([cc, n]) => `${cc} ${n}`).join(", ")})`
            : ""}
          . Counts only; no names are shown.
        </p>
      ) : null}
      {error ? <p className="text-sm text-[var(--color-error-700)]">{error}</p> : null}
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" loading={busy} onClick={() => run("preview")}>
          Preview count
        </Button>
        <Button size="sm" loading={busy} onClick={() => run("create")}>
          Create audience
        </Button>
      </div>
    </div>
  );
}

const EMPTY_FILTERS = { platform: "", market: "", brand_id: "", event_id: "" };

function SelectFilter({ label, value, onChange, options }) {
  return (
    <label className="space-y-1 text-xs font-medium text-[var(--color-text-secondary)]">
      <span>{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-10 w-full rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3 text-sm text-[var(--color-text-primary)]"
      >
        <option value="">All</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function AdAudiencesPanel() {
  const [rows, setRows] = useState(null);
  const [listAudiences, setListAudiences] = useState([]);
  const [terms, setTerms] = useState([]);
  const [taskBusy, setTaskBusy] = useState(null);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: loadError } = await listAdAudiences(filters);
    if (loadError) {
      const parsed = await parseEdgeError(loadError);
      setError(adsErrorWords(parsed?.message, "Audiences could not be loaded."));
      setRows([]);
    } else {
      setRows(data?.audiences ?? []);
      setListAudiences(data?.list_audiences ?? []);
      setTerms(data?.terms ?? []);
    }
    setLoading(false);
  }, [filters]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const options = useMemo(
    () => ({
      markets: audienceFilterValues(rows, "market").map((value) => ({
        value,
        label: value,
      })),
      brands: audienceFilterValues(rows, "brand_id").map((value) => ({
        value,
        label: rows.find((row) => row.brand_id === value)?.brand_name ?? value,
      })),
      events: audienceFilterValues(rows, "event_id").map((value) => ({
        value,
        label: rows.find((row) => row.event_id === value)?.event_name ?? value,
      })),
    }),
    [rows],
  );

  const refresh = async () => {
    setRefreshing(true);
    setError(null);
    const { error: refreshError } = await refreshAdAudiences(filters);
    if (refreshError) {
      const parsed = await parseEdgeError(refreshError);
      setError(adsErrorWords(parsed?.message, "The audience refresh failed."));
    } else {
      await load();
    }
    setRefreshing(false);
  };

  const applyInventory = (data) => {
    if (Array.isArray(data?.list_audiences)) setListAudiences(data.list_audiences);
    if (Array.isArray(data?.terms)) setTerms(data.terms);
  };
  const runTask = async (task, call) => {
    setTaskBusy(task.key);
    setError(null);
    const { data, error: taskError } = await call(task.connectionId);
    if (taskError) {
      const parsed = await parseEdgeError(taskError);
      setError(adsErrorWords(parsed?.message, "The terms check failed."));
    } else {
      applyInventory(data);
    }
    setTaskBusy(null);
  };
  const retire = async (audienceKey) => {
    const { data, error: retireError } = await retireListAudience(audienceKey);
    if (retireError) {
      const parsed = await parseEdgeError(retireError);
      setError(adsErrorWords(parsed?.message, "The audience could not be retired."));
    } else {
      applyInventory(data);
    }
  };

  return (
    <SectionCard
      title="Audiences"
      subtitle="Provider-owned pools for prospecting, retargeting and checkout recovery. Buyer exclusions are locked on every event campaign."
      action={
        <Button
          size="sm"
          variant="secondary"
          icon={RefreshCw}
          loading={refreshing}
          onClick={refresh}
        >
          Refresh now
        </Button>
      }
    >
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SelectFilter
          label="Platform"
          value={filters.platform}
          onChange={(platform) =>
            setFilters((current) => ({ ...current, platform }))
          }
          options={PAID_SOCIAL_PLATFORMS.map((value) => ({
            value,
            label: value[0].toUpperCase() + value.slice(1),
          }))}
        />
        <SelectFilter
          label="Market"
          value={filters.market}
          onChange={(market) =>
            setFilters((current) => ({ ...current, market }))
          }
          options={options.markets}
        />
        <SelectFilter
          label="Brand"
          value={filters.brand_id}
          onChange={(brand_id) =>
            setFilters((current) => ({ ...current, brand_id }))
          }
          options={options.brands}
        />
        <SelectFilter
          label="Event"
          value={filters.event_id}
          onChange={(event_id) =>
            setFilters((current) => ({ ...current, event_id }))
          }
          options={options.events}
        />
      </div>

      <AudienceSetupTasks
        terms={terms}
        busyKey={taskBusy}
        onCheck={(task) => runTask(task, checkAudienceTerms)}
        onConfirm={(task) => runTask(task, confirmAudienceTerms)}
      />
      {error && (
        <AlertCard variant="error" title="Audiences need attention">
          {error}
        </AlertCard>
      )}
      {loading ? (
        <div className="flex items-center gap-2 py-8 text-sm text-[var(--color-text-secondary)]">
          <Spinner size="sm" /> Loading audiences…
        </div>
      ) : (rows ?? []).length === 0 ? (
        <p className="py-8 text-sm text-[var(--color-text-secondary)]">
          No audiences match these filters. The daily sync creates event
          audiences for scheduled public events with ads.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[780px] text-left text-sm">
            <thead className="border-b border-[var(--gray-200)] text-xs uppercase text-[var(--color-text-tertiary)]">
              <tr>
                <th className="px-3 py-2">Audience</th>
                <th className="px-3 py-2">Scope</th>
                <th className="px-3 py-2">Approx. size</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Window</th>
                <th className="px-3 py-2">Last refreshed</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const status = audienceStatus(row.status);
                const fix = audienceErrorCopy(row);
                return (
                  <tr
                    key={row.id}
                    className="border-b border-[var(--gray-100)] align-top"
                  >
                    <td className="px-3 py-3">
                      <div className="font-semibold">
                        {row.code} · {row.name}
                      </div>
                      <div className="mt-1 text-xs text-[var(--color-text-secondary)]">
                        {row.platform}
                      </div>
                      {fix && (
                        <div className="mt-1 text-xs text-[var(--color-error-700)]">
                          {fix}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      {row.scope} ·{" "}
                      {row.event_name ?? row.brand_name ?? row.market ?? "—"}
                    </td>
                    <td className="px-3 py-3 tabular-nums">
                      {formatAudienceSize(row.approx_size)}
                    </td>
                    <td className="px-3 py-3">
                      <Badge variant={status.variant}>{status.label}</Badge>
                    </td>
                    <td className="px-3 py-3">{row.window_days} days</td>
                    <td className="px-3 py-3">
                      {row.last_synced_at
                        ? new Date(row.last_synced_at).toLocaleString()
                        : "Never"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-8 space-y-3">
        <div>
          <h3 className="text-base font-semibold">Customer lists</h3>
          <p className="text-sm text-[var(--color-text-secondary)]">
            Hashed lists and lookalikes in Mingla&apos;s ad accounts. Hosts only
            ever use their own brand&apos;s lists; Mingla-wide lists are for
            Mingla&apos;s own ads. Sizes are counts only.
          </p>
        </div>
        <CustomerListsTable audiences={listAudiences} onRetire={retire} />
        <NewAudienceForm lists={listAudiences} onCreated={applyInventory} />
      </div>
    </SectionCard>
  );
}
