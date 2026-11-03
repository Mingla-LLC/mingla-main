/**
 * #4238 media-buyer — staff edit where each ad app works, by country, and
 * switch Host reach estimates on or off per app. Writes go through the
 * admin-only RPCs (admin_set_ad_platform_country, admin_set_ad_reach_estimates).
 */
import { useCallback, useEffect, useState } from "react";
import { SectionCard, AlertCard } from "../ui/Card";
import { Button } from "../ui/Button";
import { Badge } from "../ui/Badge";
import { useToast } from "../../context/ToastContext";
import {
  getConnections,
  listAdPlatformCountries,
  setAdPlatformCountry,
  setAdReachEstimates,
} from "../../services/adEngineService";
import {
  AVAILABILITY_APPS,
  appName,
  availabilityCountries,
  availabilityEditError,
  availabilityGrid,
  reachSwitchStates,
} from "../../lib/adBuilder/adAvailability";

const STATUS_BADGE = { works: "success", not_available: "error", not_checked: "default" };
const STATUS_WORDS = { works: "Works", not_available: "Not available", not_checked: "Not checked" };

export function AdAvailabilityPanel() {
  const { addToast } = useToast();
  const [rows, setRows] = useState([]);
  const [connections, setConnections] = useState([]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ platform: "tiktok", country: "", status: "not_available", reason: "" });

  const load = useCallback(async () => {
    setError(null);
    const [{ data, error: listError }, { data: conns, error: connError }] = await Promise.all([
      listAdPlatformCountries(),
      getConnections("consumer"),
    ]);
    if (listError || connError) {
      setError("Couldn't load where the apps work. Try again.");
      return;
    }
    setRows(data ?? []);
    setConnections(conns ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    const problem = availabilityEditError(form);
    if (problem) {
      addToast({ variant: "error", title: problem });
      return;
    }
    setBusy(true);
    const { error: saveError } = await setAdPlatformCountry(form);
    setBusy(false);
    if (saveError) {
      addToast({ variant: "error", title: "Couldn't save that. Only admins can change this." });
      return;
    }
    addToast({ variant: "success", title: `${appName(form.platform)} in ${form.country.toUpperCase()} saved.` });
    setForm((current) => ({ ...current, country: "", reason: "" }));
    await load();
  };

  const toggleReach = async (platform, enabled) => {
    setBusy(true);
    const { error: switchError } = await setAdReachEstimates({ platform, enabled });
    setBusy(false);
    if (switchError) {
      addToast({ variant: "error", title: "Couldn't change the reach switch." });
      return;
    }
    addToast({ variant: "success", title: `${appName(platform)} reach ${enabled ? "on" : "off"} for Hosts.` });
    await load();
  };

  const grid = availabilityGrid(rows, availabilityCountries(rows, ["NG", "GH", "GB", "US", "KE"]));
  return (
    <SectionCard title="Where Host ads run" subtitle="Unknown means it works until you mark it otherwise. Hosts see the reason when an app is greyed out.">
      {error ? <AlertCard variant="error" title={error} /> : null}
      <div className="overflow-x-auto">
        <table className="w-full text-xs" aria-label="Where each ad app works">
          <thead>
            <tr>
              <th className="text-left p-2">Country</th>
              {AVAILABILITY_APPS.map((platform) => (
                <th key={platform} className="text-left p-2">{appName(platform)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.map((row) => (
              <tr key={row.country} className="border-t border-[var(--gray-200)]">
                <td className="p-2 font-medium">{row.country}</td>
                {row.cells.map((cell) => (
                  <td key={cell.platform} className="p-2" title={cell.reason ?? ""}>
                    <Badge variant={STATUS_BADGE[cell.status]}>{STATUS_WORDS[cell.status]}</Badge>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-end gap-2 pt-3">
        <label className="text-xs">App
          <select className="block border rounded px-2 py-1" value={form.platform}
            onChange={(e) => setForm({ ...form, platform: e.target.value })}>
            {AVAILABILITY_APPS.map((platform) => <option key={platform} value={platform}>{appName(platform)}</option>)}
          </select>
        </label>
        <label className="text-xs">Country
          <input className="block border rounded px-2 py-1 w-16 uppercase" maxLength={2} value={form.country}
            onChange={(e) => setForm({ ...form, country: e.target.value })} aria-label="Country code" />
        </label>
        <label className="text-xs">Status
          <select className="block border rounded px-2 py-1" value={form.status}
            onChange={(e) => setForm({ ...form, status: e.target.value })}>
            <option value="works">Works</option>
            <option value="not_available">Not available</option>
            <option value="not_checked">Not checked</option>
          </select>
        </label>
        <label className="text-xs flex-1 min-w-[200px]">Reason Hosts see
          <input className="block border rounded px-2 py-1 w-full" value={form.reason}
            onChange={(e) => setForm({ ...form, reason: e.target.value })} aria-label="Reason Hosts see" />
        </label>
        <Button onClick={() => void save()} disabled={busy}>Save</Button>
      </div>
      <div className="pt-4">
        <h4 className="text-sm font-medium">Reach numbers for Hosts</h4>
        <p className="text-xs text-[var(--color-text-tertiary)]">
          Read-only calls to each app. Off by default; switch on per app after checking it in production. Google needs its reach planner allowlisted first.
        </p>
        <div className="flex flex-wrap gap-2 pt-2">
          {reachSwitchStates(connections).map((row) => (
            <Button key={row.platform} variant={row.enabled ? "primary" : "secondary"}
              disabled={busy || !row.connected}
              onClick={() => void toggleReach(row.platform, !row.enabled)}
              aria-pressed={row.enabled}>
              {appName(row.platform)}: {row.enabled ? "On" : "Off"}
            </Button>
          ))}
        </div>
      </div>
    </SectionCard>
  );
}
