import { Layers, Activity, MapPin } from "lucide-react";
import { StatCard } from "../ui/Card";
import { StatCardSkeleton } from "../ui/Skeleton";
import { DriftStatusCard } from "./DriftStatusCard";
import { VibesReadinessCard } from "./VibesReadinessCard";

const fmt = (n) => {
  if (n === null || n === undefined) return "—";
  if (typeof n !== "number") return String(n);
  return n.toLocaleString();
};

export function RulesHealthRow({ overview, loading, onDriftClick, driftLoading = false }) {
  if (loading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        {[...Array(5)].map((_, i) => <StatCardSkeleton key={i} />)}
      </div>
    );
  }

  const ov = overview || {};

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
      <StatCard
        icon={Layers}
        label="Active Rules"
        value={`${fmt(ov.rules_active)}${ov.rules_total ? ` / ${fmt(ov.rules_total)}` : ""}`}
      />
      <StatCard
        icon={MapPin}
        label="Places Governed"
        value={fmt(ov.places_governed)}
      />
      <StatCard
        icon={Activity}
        label="Rule Fires (7d)"
        value={fmt(ov.fires_7d)}
        trend={ov.fires_24h ? `${fmt(ov.fires_24h)} in 24h` : null}
        trendUp={false}
      />
      <DriftStatusCard
        status={ov.drift_status || "unknown"}
        onClick={onDriftClick}
        loading={driftLoading}
      />
      <VibesReadinessCard
        readyCount={ov.vibes_ready_count}
        totalCount={ov.vibes_total}
      />
    </div>
  );
}
