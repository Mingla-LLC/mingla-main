import { useCallback, useEffect, useMemo, useState } from "react";
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
  listAdAudiences,
  parseEdgeError,
  refreshAdAudiences,
} from "../../services/adEngineService";

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
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}

export function AdAudiencesPanel() {
  const [rows, setRows] = useState(null);
  const [buyerListEnabled, setBuyerListEnabled] = useState(false);
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
      setError(String(parsed?.message ?? "Audiences could not be loaded."));
      setRows([]);
    } else {
      setRows(data?.audiences ?? []);
      setBuyerListEnabled(data?.buyer_list_sync_enabled === true);
    }
    setLoading(false);
  }, [filters]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const options = useMemo(() => ({
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
  }), [rows]);

  const refresh = async () => {
    setRefreshing(true);
    setError(null);
    const { error: refreshError } = await refreshAdAudiences(filters);
    if (refreshError) {
      const parsed = await parseEdgeError(refreshError);
      setError(String(parsed?.message ?? "The audience refresh failed."));
    } else {
      await load();
    }
    setRefreshing(false);
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
          onChange={(platform) => setFilters((current) => ({ ...current, platform }))}
          options={PAID_SOCIAL_PLATFORMS.map((value) => ({
            value,
            label: value[0].toUpperCase() + value.slice(1),
          }))}
        />
        <SelectFilter
          label="Market"
          value={filters.market}
          onChange={(market) => setFilters((current) => ({ ...current, market }))}
          options={options.markets}
        />
        <SelectFilter
          label="Brand"
          value={filters.brand_id}
          onChange={(brand_id) => setFilters((current) => ({ ...current, brand_id }))}
          options={options.brands}
        />
        <SelectFilter
          label="Event"
          value={filters.event_id}
          onChange={(event_id) => setFilters((current) => ({ ...current, event_id }))}
          options={options.events}
        />
      </div>

      {!buyerListEnabled && (
        <AlertCard variant="info" title="Buyer-list audiences are off">
          M8, S5 and T5 need privacy approval before customer-list sync can run.
        </AlertCard>
      )}
      {error && <AlertCard variant="error" title="Audiences need attention">{error}</AlertCard>}
      {loading ? (
        <div className="flex items-center gap-2 py-8 text-sm text-[var(--color-text-secondary)]">
          <Spinner size="sm" /> Loading audiences…
        </div>
      ) : (rows ?? []).length === 0 ? (
        <p className="py-8 text-sm text-[var(--color-text-secondary)]">
          No audiences match these filters. The daily sync creates event audiences for scheduled public events with ads.
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
                  <tr key={row.id} className="border-b border-[var(--gray-100)] align-top">
                    <td className="px-3 py-3">
                      <div className="font-semibold">{row.code} · {row.name}</div>
                      <div className="mt-1 text-xs text-[var(--color-text-secondary)]">
                        {row.platform}
                      </div>
                      {fix && <div className="mt-1 text-xs text-[var(--color-error-700)]">{fix}</div>}
                    </td>
                    <td className="px-3 py-3">{row.scope} · {row.event_name ?? row.brand_name ?? row.market ?? "—"}</td>
                    <td className="px-3 py-3 tabular-nums">{formatAudienceSize(row.approx_size)}</td>
                    <td className="px-3 py-3"><Badge variant={status.variant}>{status.label}</Badge></td>
                    <td className="px-3 py-3">{row.window_days} days</td>
                    <td className="px-3 py-3">{row.last_synced_at ? new Date(row.last_synced_at).toLocaleString() : "Never"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}
