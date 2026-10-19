import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { SectionCard } from "../ui/Card";
import { Button } from "../ui/Button";
import { Badge } from "../ui/Badge";
import { Toggle } from "../ui/Input";
import { Spinner } from "../ui/Spinner";
import { useToast } from "../../context/ToastContext";
import { useAuth } from "../../context/AuthContext";
import {
  fetchSupportIsOnline,
  listSupportStaffRoster,
  setSupportAvailable,
} from "../../services/communityService";

export function AvailabilityPanel() {
  const { addToast } = useToast();
  const { session } = useAuth();
  const [loading, setLoading] = useState(true);
  const [online, setOnline] = useState(false);
  const [roster, setRoster] = useState([]);
  const [busy, setBusy] = useState(false);

  const myRow = roster.find((r) => r.user_id === session?.user?.id);
  const myAvailable = Boolean(myRow?.available);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [isOnline, staff] = await Promise.all([
        fetchSupportIsOnline(),
        listSupportStaffRoster(),
      ]);
      setOnline(isOnline);
      setRoster(staff);
    } catch (err) {
      addToast({
        variant: "error",
        title: "Could not load availability",
        description: err?.message,
      });
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onToggle(next) {
    setBusy(true);
    try {
      await setSupportAvailable(next);
      addToast({
        variant: "success",
        title: next ? "You are available" : "You are off shift",
      });
      await load();
    } catch (err) {
      addToast({
        variant: "error",
        title: "Could not update availability",
        description: err?.message,
      });
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button variant="secondary" size="sm" icon={RefreshCw} onClick={() => void load()}>
          Refresh
        </Button>
      </div>

      <SectionCard title="Desk presence">
        <p className="text-sm text-[var(--color-text-secondary)] mb-3">
          Hosts see Online or Away when anyone on the support team marks themselves
          available.
        </p>
        <div className="flex items-center gap-3 mb-4">
          <span className="text-sm text-[var(--color-text-primary)]">Hosts currently see:</span>
          <Badge variant={online ? "success" : "default"}>
            {online ? "Online" : "Away"}
          </Badge>
        </div>
        {myRow ? (
          <Toggle
            label={myAvailable ? "I am available for tickets" : "I am off shift"}
            checked={myAvailable}
            disabled={busy || !myRow.enabled}
            onChange={(checked) => void onToggle(checked)}
          />
        ) : (
          <p className="text-sm text-[var(--color-text-secondary)]">
            Your account is not on the support staff roster. Grant access from the
            Support tab&apos;s Agents panel first.
          </p>
        )}
      </SectionCard>

      <SectionCard title="Support staff roster">
        {roster.length === 0 ? (
          <p className="text-sm text-[var(--color-text-secondary)]">No support staff yet.</p>
        ) : (
          <ul className="divide-y divide-[var(--color-border-primary)]">
            {roster.map((row) => (
              <li
                key={row.user_id}
                className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
              >
                <span className="font-mono text-xs text-[var(--color-text-secondary)]">
                  {row.display_name || row.user_id}
                </span>
                <div className="flex gap-2">
                  <Badge variant="outline">{row.role || "staff"}</Badge>
                  <Badge variant={row.enabled ? "info" : "default"}>
                    {row.enabled ? "enabled" : "disabled"}
                  </Badge>
                  <Badge variant={row.available ? "success" : "default"}>
                    {row.available ? "available" : "off shift"}
                  </Badge>
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
