import { useState, useEffect, useRef } from "react";
import {
  Globe, Layers, Camera, RefreshCw, BarChart3, AlertTriangle,
  CheckCircle, TrendingUp,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import { SectionCard, StatCard } from "../components/ui/Card";
import { DataTable } from "../components/ui/Table";
import { Badge } from "../components/ui/Badge";
import { Tabs } from "../components/ui/Tabs";
import { Button } from "../components/ui/Button";

// ── Constants ────────────────────────────────────────────────────────────────

const CATEGORY_LABELS = {
  nature_views: "Nature & Views", first_meet: "First Meet", picnic_park: "Picnic Park",
  drink: "Drink", casual_eats: "Casual Eats", fine_dining: "Fine Dining",
  watch: "Watch", live_performance: "Live Performance", creative_arts: "Creative & Arts",
  play: "Play", wellness: "Wellness", flowers: "Flowers", groceries: "Groceries",
};

const CATEGORY_COLORS = {
  nature_views: "#22c55e", first_meet: "#f97316", picnic_park: "#84cc16",
  drink: "#a855f7", casual_eats: "#ef4444", fine_dining: "#dc2626",
  watch: "#3b82f6", live_performance: "#8b5cf6", creative_arts: "#ec4899",
  play: "#f59e0b", wellness: "#14b8a6", flowers: "#f472b6", groceries: "#6b7280",
};

const TABS = [
  { id: "cities", label: "Cross-City Overview" },
  { id: "categories", label: "Category Health" },
  { id: "quality", label: "Data Quality" },
];

function healthBadge(health) {
  const map = { green: "success", yellow: "warning", red: "error" };
  const label = { green: "Healthy", yellow: "Needs Work", red: "Critical" };
  return <Badge variant={map[health] || "default"}>{label[health] || health}</Badge>;
}

function pctBadge(pct) {
  const variant = pct >= 80 ? "success" : pct >= 50 ? "warning" : "error";
  return <Badge variant={variant}>{pct}%</Badge>;
}

// ── Cross-City Overview Tab ──────────────────────────────────────────────────

function CitiesTab() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    setLoading(true);
    setError(null);
    supabase.rpc("admin_pool_intelligence_overview")
      .then(({ data, error: err }) => {
        if (!mountedRef.current) return;
        if (err) { setError(err.message); } else { setRows(data || []); }
        setLoading(false);
      });
    return () => { mountedRef.current = false; };
  }, []);

  const columns = [
    { key: "city_name", label: "City", sortable: true, render: (_, r) => `${r.city_name}, ${r.country}` },
    { key: "status", label: "Status", render: (_, r) => {
      const v = { draft: "default", seeding: "warning", seeded: "info", launched: "success" };
      return <Badge variant={v[r.status] || "default"}>{r.status}</Badge>;
    }},
    { key: "active_places", label: "Places", sortable: true },
    { key: "photo_pct", label: "Photos", sortable: true, render: (_, r) => pctBadge(r.photo_pct) },
    { key: "category_coverage", label: "Categories", sortable: true, render: (_, r) => {
      const pct = Math.round((r.category_coverage / 13) * 100);
      return <span>{r.category_coverage}/13 {pctBadge(pct)}</span>;
    }},
    { key: "total_cards", label: "Cards", sortable: true },
    { key: "freshness_pct", label: "Freshness", sortable: true, render: (_, r) => pctBadge(r.freshness_pct) },
    { key: "seeding_spend", label: "Spend", sortable: true, render: (_, r) => {
      const over = r.seeding_spend > 70;
      return <span className={over ? "text-[var(--color-error-700)] font-medium" : ""}>${r.seeding_spend.toFixed(2)}</span>;
    }},
    { key: "readiness_pct", label: "Readiness", sortable: true, render: (_, r) => {
      const variant = r.readiness_pct >= 80 ? "success" : r.readiness_pct >= 50 ? "warning" : "error";
      return <Badge variant={variant}>{r.readiness_pct}%</Badge>;
    }},
  ];

  // Summary stats
  const totalPlaces = rows.reduce((s, r) => s + (r.active_places || 0), 0);
  const totalCards = rows.reduce((s, r) => s + (r.total_cards || 0), 0);
  const avgReadiness = rows.length > 0 ? Math.round(rows.reduce((s, r) => s + (r.readiness_pct || 0), 0) / rows.length) : 0;
  const avgPhotos = rows.length > 0 ? Math.round(rows.reduce((s, r) => s + (r.photo_pct || 0), 0) / rows.length) : 0;

  return (
    <div className="space-y-6">
      {error && <div className="text-sm text-[var(--color-error-700)] bg-[var(--color-error-50)] p-3 rounded-lg">Failed to load city data: {error}</div>}
      <div className="grid grid-cols-4 gap-4">
        <StatCard icon={Globe} label="Cities" value={rows.length} />
        <StatCard icon={Layers} label="Total Places" value={totalPlaces} />
        <StatCard icon={Camera} label="Avg Photo Coverage" value={`${avgPhotos}%`}
          trend={avgPhotos >= 80 ? "Good" : "Low"} trendUp={avgPhotos >= 80} />
        <StatCard icon={TrendingUp} label="Avg Readiness" value={`${avgReadiness}%`}
          trend={avgReadiness >= 80 ? "Launch Ready" : avgReadiness >= 50 ? "In Progress" : "Early"}
          trendUp={avgReadiness >= 80} />
      </div>

      <SectionCard title="All Cities" subtitle={`${rows.length} cities · ${totalPlaces} places · ${totalCards} cards`}>
        <DataTable columns={columns} rows={rows} loading={loading}
          emptyMessage="No cities found" emptyIcon={Globe} />
      </SectionCard>
    </div>
  );
}

// ── Category Health Tab ──────────────────────────────────────────────────────

function CategoriesTab() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    setLoading(true);
    setError(null);
    supabase.rpc("admin_pool_category_health")
      .then(({ data, error: err }) => {
        if (!mountedRef.current) return;
        if (err) { setError(err.message); } else { setRows(data || []); }
        setLoading(false);
      });
    return () => { mountedRef.current = false; };
  }, []);

  const columns = [
    { key: "category", label: "Category", sortable: true, render: (_, r) => (
      <div className="flex items-center gap-2">
        <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: CATEGORY_COLORS[r.category] || "#6b7280" }} />
        {CATEGORY_LABELS[r.category] || r.category}
      </div>
    )},
    { key: "active_places", label: "Places", sortable: true },
    { key: "total_cards", label: "Cards", sortable: true },
    { key: "photo_pct", label: "Photos", sortable: true, render: (_, r) => pctBadge(r.photo_pct) },
    { key: "avg_rating", label: "Avg Rating", sortable: true, render: (_, r) => r.avg_rating ? `★ ${r.avg_rating}` : "—" },
    { key: "places_needing_cards", label: "Need Cards", sortable: true, render: (_, r) => {
      return r.places_needing_cards > 0
        ? <span className="text-[var(--color-warning-600)] font-medium">{r.places_needing_cards}</span>
        : <span className="text-[var(--color-success-700)]">0</span>;
    }},
    { key: "health", label: "Health", render: (_, r) => healthBadge(r.health) },
  ];

  const healthy = rows.filter((r) => r.health === "green").length;
  const critical = rows.filter((r) => r.health === "red").length;

  return (
    <div className="space-y-6">
      {error && <div className="text-sm text-[var(--color-error-700)] bg-[var(--color-error-50)] p-3 rounded-lg">Failed to load category data: {error}</div>}
      <div className="grid grid-cols-4 gap-4">
        <StatCard icon={CheckCircle} label="Healthy Categories" value={`${healthy}/13`}
          trend={healthy >= 10 ? "Strong" : "Gaps"} trendUp={healthy >= 10} />
        <StatCard icon={AlertTriangle} label="Critical" value={critical}
          trend={critical === 0 ? "None" : "Needs Action"} trendUp={critical === 0} />
        <StatCard icon={Layers} label="Total Cards" value={rows.reduce((s, r) => s + (r.total_cards || 0), 0)} />
        <StatCard icon={Camera} label="Avg Photo Coverage"
          value={`${rows.length > 0 ? Math.round(rows.reduce((s, r) => s + (r.photo_pct || 0), 0) / rows.length) : 0}%`} />
      </div>

      <SectionCard title="Category Health Matrix" subtitle="Card coverage relative to active places per category">
        <DataTable columns={columns} rows={rows} loading={loading}
          emptyMessage="No category data" emptyIcon={Layers} />
      </SectionCard>
    </div>
  );
}

// ── Data Quality Tab ─────────────────────────────────────────────────────────

function QualityTab() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    setLoading(true);
    setError(null);
    supabase.rpc("admin_pool_quality_summary")
      .then(({ data: result, error: err }) => {
        if (!mountedRef.current) return;
        if (err) { setError(err.message); } else { setData(Array.isArray(result) ? result[0] : result); }
        setLoading(false);
      });
    return () => { mountedRef.current = false; };
  }, []);

  if (loading) return <div className="text-center py-12 text-[var(--color-text-secondary)]">Loading quality data...</div>;
  if (error) return <div className="text-sm text-[var(--color-error-700)] bg-[var(--color-error-50)] p-3 rounded-lg">Failed to load quality data: {error}</div>;
  if (!data) return <div className="text-center py-12 text-[var(--color-text-secondary)]">No data available.</div>;

  const qualityDist = [
    { score: "5/5 — Perfect", count: data.quality_5, color: "#22c55e" },
    { score: "4/5 — Good", count: data.quality_4, color: "#84cc16" },
    { score: "3/5 — Fair", count: data.quality_3, color: "#f59e0b" },
    { score: "2/5 — Poor", count: data.quality_2, color: "#f97316" },
    { score: "1/5 — Bad", count: data.quality_1, color: "#ef4444" },
    { score: "0/5 — Empty", count: data.quality_0, color: "#6b7280" },
  ];

  const maxCount = Math.max(...qualityDist.map((d) => d.count), 1);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-4 gap-4">
        <StatCard icon={Layers} label="Active Places" value={data.total_places} />
        <StatCard icon={CheckCircle} label="Categorized" value={`${data.categorized_pct}%`}
          trend={data.categorized_pct >= 90 ? "Good" : "Gaps"} trendUp={data.categorized_pct >= 90} />
        <StatCard icon={Camera} label="With Photos" value={`${data.with_photos_pct}%`}
          trend={data.with_photos_pct >= 80 ? "Good" : "Low"} trendUp={data.with_photos_pct >= 80} />
        <StatCard icon={BarChart3} label="Avg Quality" value={`${data.avg_quality_score}/5`}
          trend={data.avg_quality_score >= 4 ? "Strong" : data.avg_quality_score >= 3 ? "Fair" : "Weak"}
          trendUp={data.avg_quality_score >= 4} />
      </div>

      <SectionCard title="Quality Score Distribution"
        subtitle="Score = has category + has photos + has rating + is fresh (7d) + has reviews">
        <div className="space-y-3">
          {qualityDist.map((d) => (
            <div key={d.score} className="flex items-center gap-3">
              <div className="w-28 text-sm text-[var(--color-text-secondary)] shrink-0">{d.score}</div>
              <div className="flex-1 bg-[var(--gray-100)] rounded-full h-6 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-300 flex items-center justify-end pr-2"
                  style={{
                    width: `${Math.max((d.count / maxCount) * 100, 2)}%`,
                    backgroundColor: d.color,
                  }}
                >
                  {d.count > 0 && <span className="text-xs font-medium text-white">{d.count}</span>}
                </div>
              </div>
              <div className="w-12 text-right text-sm font-medium">{d.count}</div>
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="Individual Metrics">
        <div className="grid grid-cols-3 gap-4 text-sm">
          <div className="p-3 rounded-lg bg-[var(--gray-50)]">
            <div className="text-[var(--color-text-secondary)]">With Rating</div>
            <div className="text-lg font-semibold mt-1">{data.with_rating_count} <span className="text-sm font-normal text-[var(--color-text-tertiary)]">/ {data.total_places}</span></div>
          </div>
          <div className="p-3 rounded-lg bg-[var(--gray-50)]">
            <div className="text-[var(--color-text-secondary)]">Fresh (7d)</div>
            <div className="text-lg font-semibold mt-1">{data.fresh_count} <span className="text-sm font-normal text-[var(--color-text-tertiary)]">/ {data.total_places}</span></div>
          </div>
          <div className="p-3 rounded-lg bg-[var(--gray-50)]">
            <div className="text-[var(--color-text-secondary)]">With Reviews</div>
            <div className="text-lg font-semibold mt-1">{data.with_reviews_count} <span className="text-sm font-normal text-[var(--color-text-tertiary)]">/ {data.total_places}</span></div>
          </div>
        </div>
      </SectionCard>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export function PoolIntelligencePage() {
  const [activeTab, setActiveTab] = useState("cities");

  return (
    <div className="space-y-4 py-6">
      <div className="flex items-center justify-between mb-2">
        <div>
          <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">Pool Intelligence</h2>
          <p className="text-sm text-[var(--color-text-secondary)]">Cross-city metrics, category health, and data quality at a glance.</p>
        </div>
      </div>
      <Tabs tabs={TABS} activeTab={activeTab} onChange={setActiveTab} />
      <div className="mt-4">
        {activeTab === "cities" && <CitiesTab />}
        {activeTab === "categories" && <CategoriesTab />}
        {activeTab === "quality" && <QualityTab />}
      </div>
    </div>
  );
}
