import { useState, useCallback, useRef, useEffect } from "react";
import { motion } from "framer-motion";
import {
  UserPlus, Trash2, RefreshCw, Eraser, Play,
  CheckCircle, AlertCircle, AlertTriangle,
  Globe, Users, MapPin, Loader2,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import { SEED_SCRIPTS } from "../lib/constants";
import { Button } from "../components/ui/Button";
import { AlertCard } from "../components/ui/Card";
import { Modal, ModalBody, ModalFooter } from "../components/ui/Modal";
import { useToast } from "../context/ToastContext";
import { useAuth } from "../context/AuthContext";
import { logAdminAction } from "../lib/auditLog";

const ICON_MAP = { UserPlus, Trash2, RefreshCw, Eraser };

export function SeedPage() {
  const { addToast } = useToast();
  const { session } = useAuth();
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const [results, setResults] = useState({});
  const [running, setRunning] = useState(null);
  const [confirmModal, setConfirmModal] = useState(null);

  // ── Map Strangers state ─────────────────────────────────────────────────
  const [strangerAction, setStrangerAction] = useState(null);
  const [strangerResult, setStrangerResult] = useState(null);
  const [strangerProgress, setStrangerProgress] = useState(null);

  // Per-city state
  const [cityStats, setCityStats] = useState([]);
  const [statsLoading, setStatsLoading] = useState(true);
  const [globalSeeds, setGlobalSeeds] = useState(0);
  const [densities, setDensities] = useState({});
  const [cityAction, setCityAction] = useState(null); // { cityId, action }

  const LAT_BANDS = [
    { latMin: -60, latMax: -40, label: "Far South (-60 to -40)" },
    { latMin: -40, latMax: -20, label: "South (-40 to -20)" },
    { latMin: -20, latMax: -5, label: "Equatorial S (-20 to -5)" },
    { latMin: -5, latMax: 10, label: "Equatorial N (-5 to 10)" },
    { latMin: 10, latMax: 20, label: "Tropics S (10 to 20)" },
    { latMin: 20, latMax: 30, label: "Tropics N (20 to 30)" },
    { latMin: 30, latMax: 35, label: "Temperate 1 (30 to 35)" },
    { latMin: 35, latMax: 40, label: "Temperate 2 (35 to 40)" },
    { latMin: 40, latMax: 45, label: "Temperate 3 (40 to 45)" },
    { latMin: 45, latMax: 50, label: "Temperate 4 (45 to 50)" },
    { latMin: 50, latMax: 55, label: "Northern 1 (50 to 55)" },
    { latMin: 55, latMax: 60, label: "Northern 2 (55 to 60)" },
    { latMin: 60, latMax: 65, label: "Far North 1 (60 to 65)" },
    { latMin: 65, latMax: 70, label: "Far North 2 (65 to 70)" },
  ];

  // ── Load per-city stats ─────────────────────────────────────────────────
  const loadStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-seed-map-strangers", {
        body: { action: "get_seed_stats" },
      });
      if (error) throw error;
      setCityStats(data.cities || []);
      setGlobalSeeds(data.globalSeeds || 0);
      const defaults = {};
      for (const c of data.cities || []) {
        defaults[c.city_id] = Math.max(3, Math.min(50, Math.ceil(c.place_count / 100)));
      }
      setDensities(prev => ({ ...defaults, ...prev }));
    } catch (e) {
      addToast({ variant: "error", title: "Failed to load seed stats", description: e?.message });
    }
    if (mountedRef.current) setStatsLoading(false);
  }, [addToast]);

  useEffect(() => { loadStats(); }, [loadStats]);

  // ── Per-city actions ────────────────────────────────────────────────────
  const seedSingleCity = useCallback(async (cityId) => {
    const count = densities[cityId] || 10;
    setCityAction({ cityId, action: "seed" });
    try {
      const { data, error } = await supabase.functions.invoke("admin-seed-map-strangers", {
        body: { action: "seed_single_city", cityId, count },
      });
      if (error) throw error;
      addToast({ variant: "success", title: `Seeded ${data.created} strangers in ${data.cityName}` });
      logAdminAction("seed.stranger_single_city", "map_strangers", "seed_single_city", data);
      await loadStats();
    } catch (e) {
      addToast({ variant: "error", title: "Seed failed", description: e?.message });
    }
    if (mountedRef.current) setCityAction(null);
  }, [densities, addToast, loadStats]);

  const clearSingleCity = useCallback(async (cityId) => {
    setCityAction({ cityId, action: "clear" });
    try {
      const { data, error } = await supabase.functions.invoke("admin-seed-map-strangers", {
        body: { action: "clear_single_city", cityId },
      });
      if (error) throw error;
      addToast({ variant: "success", title: `Cleared ${data.deleted} seeds` });
      logAdminAction("seed.stranger_clear_city", "map_strangers", "clear_single_city", data);
      await loadStats();
    } catch (e) {
      addToast({ variant: "error", title: "Clear failed", description: e?.message });
    }
    if (mountedRef.current) setCityAction(null);
  }, [addToast, loadStats]);

  // ── Bulk stranger actions ───────────────────────────────────────────────
  const runStrangerAction = useCallback(async (action) => {
    setStrangerAction(action);
    setStrangerResult(null);
    setStrangerProgress(null);

    try {
      if (action === "seed_all_cities") {
        const cities = cityStats.filter(c => c.place_count > 0);
        setStrangerProgress({ currentBand: 0, totalBands: cities.length, totalCreated: 0, status: "Seeding cities..." });
        let totalCreated = 0;
        for (let i = 0; i < cities.length; i++) {
          const c = cities[i];
          const count = densities[c.city_id] || 10;
          setStrangerProgress({ currentBand: i + 1, totalBands: cities.length, totalCreated, status: `Seeding ${c.city_name}...` });
          try {
            const { data, error } = await supabase.functions.invoke("admin-seed-map-strangers", {
              body: { action: "seed_single_city", cityId: c.city_id, count },
            });
            if (error) throw error;
            totalCreated += data?.created ?? 0;
          } catch (e) {
            console.error(`[SeedPage] City ${c.city_name} failed:`, e?.message);
          }
        }
        setStrangerProgress(null);
        setStrangerResult({ ok: true, message: `Created ${totalCreated} strangers across ${cities.length} cities` });
        addToast({ variant: "success", title: `Seeded ${totalCreated} strangers in ${cities.length} cities` });
        logAdminAction("seed.stranger_all_cities", "map_strangers", "seed_all_cities", { totalCreated });
        await loadStats();
      } else if (action === "cleanup") {
        const { data, error } = await supabase.functions.invoke("admin-seed-map-strangers", {
          body: { action: "cleanup" },
        });
        if (error) throw error;
        setStrangerResult({ ok: true, message: `Cleaned up ${data?.deleted ?? 0} seed profiles` });
        addToast({ variant: "success", title: `Cleaned up ${data?.deleted ?? 0} seed profiles` });
        logAdminAction("seed.stranger_cleanup", "map_strangers", "cleanup", data);
        await loadStats();
      } else if (action === "seed_global") {
        setStrangerProgress({ currentBand: 0, totalBands: LAT_BANDS.length, totalCreated: 0, status: "Cleaning up..." });
        const { data: cleanupData, error: cleanupErr } = await supabase.functions.invoke("admin-seed-map-strangers", {
          body: { action: "cleanup" },
        });
        if (cleanupErr) throw cleanupErr;

        let totalCreated = 0;
        for (let i = 0; i < LAT_BANDS.length; i++) {
          const band = LAT_BANDS[i];
          setStrangerProgress({ currentBand: i + 1, totalBands: LAT_BANDS.length, totalCreated, status: `Seeding ${band.label}...` });
          const { data, error } = await supabase.functions.invoke("admin-seed-map-strangers", {
            body: { action: "seed_global_grid", latRange: { latMin: band.latMin, latMax: band.latMax }, skipCleanup: true },
          });
          if (error) {
            console.error(`[SeedPage] Band ${band.label} failed:`, error?.message);
            continue;
          }
          totalCreated += data?.totalCreated ?? 0;
        }
        setStrangerProgress(null);
        setStrangerResult({ ok: true, message: `Created ${totalCreated.toLocaleString()} strangers across ${LAT_BANDS.length} bands (cleaned ${cleanupData?.deleted ?? 0} old)` });
        addToast({ variant: "success", title: `Seeded ${totalCreated.toLocaleString()} map strangers globally` });
        logAdminAction("seed.stranger_global", "map_strangers", "seed_global_grid", { totalCreated });
        await loadStats();
      }
    } catch (e) {
      const msg = e?.message || "Failed";
      setStrangerResult({ error: msg });
      addToast({ variant: "error", title: "Stranger seeding failed", description: msg });
    }
    if (mountedRef.current) setStrangerAction(null);
  }, [addToast, cityStats, densities, loadStats]);

  // ── Seed script runner (unchanged) ──────────────────────────────────────
  const runScript = useCallback(async (idx) => {
    const script = SEED_SCRIPTS[idx];
    setRunning(idx);
    setResults((r) => { const next = { ...r }; delete next[idx]; return next; });
    try {
      const { error } = await supabase.rpc(script.rpc);
      if (!mountedRef.current) return;
      if (error) {
        const msg = error.code === "PGRST202"
          ? `RPC "${script.rpc}" not found. Run the admin dashboard migration first.`
          : error.message;
        setResults((r) => ({ ...r, [idx]: { error: msg } }));
        addToast({ variant: "error", title: "Script failed", description: msg });
      } else {
        setResults((r) => ({ ...r, [idx]: { ok: true } }));
        addToast({ variant: "success", title: "Script executed successfully" });
        logAdminAction("seed.run", "script", script.rpc, { script_label: script.label });
      }
    } catch (e) {
      if (!mountedRef.current) return;
      const message = e?.message || "Unexpected error";
      setResults((r) => ({ ...r, [idx]: { error: message } }));
      addToast({ variant: "error", title: "Script failed", description: message });
    }
    if (mountedRef.current) setRunning(null);
  }, [addToast]);

  const totalCitySeeds = cityStats.reduce((s, c) => s + Number(c.seed_count), 0);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">Database Tools</h1>
      </div>

      {/* Warning Banner */}
      <div className="flex items-start gap-3 p-4 rounded-xl bg-[var(--color-warning-50)] border border-[rgba(245,158,11,0.3)]">
        <AlertTriangle className="w-5 h-5 text-[#d97706] shrink-0 mt-0.5" />
        <p className="text-sm text-[#b45309]">
          These scripts modify live data. Changes cannot be undone. Proceed with care.
        </p>
      </div>

      {/* Seed Script Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {SEED_SCRIPTS.map((script, i) => {
          const Icon = ICON_MAP[script.icon] || Play;
          const result = results[i];
          const isRunning = running === i;

          return (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06, duration: 0.3, ease: "easeOut" }}
              className={[
                "bg-[var(--color-background-primary)] rounded-xl p-5",
                "border transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[var(--shadow-md)]",
                result?.error ? "border-[rgba(239,68,68,0.4)]"
                  : result?.ok ? "border-[rgba(34,197,94,0.4)]"
                  : "border-[var(--gray-200)]",
              ].join(" ")}
            >
              <div className="flex items-start gap-3 mb-3">
                <div className="w-10 h-10 rounded-full bg-[var(--color-brand-50)] text-[var(--color-brand-500)] flex items-center justify-center shrink-0">
                  <Icon className="w-5 h-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">{script.label}</h3>
                  <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5">{script.description}</p>
                </div>
              </div>

              {result && (
                <div className="mb-3">
                  {result.error ? (
                    <div className="flex items-start gap-2 text-xs text-[var(--color-error-700)] bg-[var(--color-error-50)] rounded-lg p-2">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      <span className="line-clamp-2">{result.error}</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-xs text-[var(--color-success-700)] bg-[var(--color-success-50)] rounded-lg p-2">
                      <CheckCircle className="w-3.5 h-3.5 shrink-0" />
                      <span>Completed successfully</span>
                    </div>
                  )}
                </div>
              )}

              <Button
                variant="secondary"
                size="sm"
                loading={isRunning}
                icon={Play}
                onClick={() => setConfirmModal({ type: "script", idx: i, label: script.label })}
                className="w-full"
              >
                Run Script
              </Button>
            </motion.div>
          );
        })}
      </div>

      {/* ── Map Strangers Section ─────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Globe className="w-5 h-5 text-[var(--color-brand-500)]" />
            <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">Map Strangers</h2>
          </div>
          <button
            onClick={loadStats}
            disabled={statsLoading}
            className="p-2 rounded-lg hover:bg-[var(--gray-100)] transition-colors"
            title="Refresh stats"
          >
            <RefreshCw className={`w-4 h-4 text-[var(--color-text-tertiary)] ${statsLoading ? "animate-spin" : ""}`} />
          </button>
        </div>
        <p className="text-sm text-[var(--color-text-tertiary)] mb-4">
          Seed fake profiles per city so the map feels populated. Each city gets strangers proportional to its place pool.
        </p>

        {/* Progress bar */}
        {strangerProgress && (
          <div className="mb-4 p-4 rounded-xl bg-[var(--color-brand-50)] border border-[rgba(235,120,37,0.3)]">
            <div className="flex items-center gap-2 mb-2">
              <Loader2 className="w-4 h-4 text-[var(--color-brand-500)] animate-spin" />
              <span className="text-sm font-medium text-[var(--color-brand-700)]">{strangerProgress.status}</span>
            </div>
            <div className="w-full bg-[rgba(235,120,37,0.15)] rounded-full h-2 mb-1">
              <div
                className="bg-[var(--color-brand-500)] h-2 rounded-full transition-all duration-300"
                style={{ width: `${(strangerProgress.currentBand / strangerProgress.totalBands) * 100}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-[var(--color-text-tertiary)]">
              <span>{strangerProgress.currentBand} / {strangerProgress.totalBands}</span>
              <span>{strangerProgress.totalCreated.toLocaleString()} created</span>
            </div>
          </div>
        )}

        {/* Result */}
        {strangerResult && !strangerProgress && (
          <div className={`mb-4 flex items-start gap-2 text-sm rounded-xl p-3 ${
            strangerResult.error
              ? "text-[var(--color-error-700)] bg-[var(--color-error-50)]"
              : "text-[var(--color-success-700)] bg-[var(--color-success-50)]"
          }`}>
            {strangerResult.error
              ? <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              : <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" />
            }
            <span>{strangerResult.error || strangerResult.message}</span>
          </div>
        )}

        {/* Per-City Table */}
        <div className="bg-[var(--color-background-primary)] rounded-xl border border-[var(--gray-200)] overflow-hidden mb-4">
          {statsLoading ? (
            <div className="flex items-center justify-center p-8">
              <Loader2 className="w-5 h-5 text-[var(--color-brand-500)] animate-spin" />
              <span className="ml-2 text-sm text-[var(--color-text-tertiary)]">Loading city stats...</span>
            </div>
          ) : cityStats.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-8 text-center">
              <MapPin className="w-8 h-8 text-[var(--gray-300)] mb-2" />
              <p className="text-sm text-[var(--color-text-tertiary)]">No seeded or launched cities found.</p>
              <p className="text-xs text-[var(--color-text-tertiary)] mt-1">Seed cities from the Place Pool page first.</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--gray-200)] bg-[var(--gray-50)]">
                  <th className="text-left px-4 py-2.5 font-medium text-[var(--color-text-tertiary)]">City</th>
                  <th className="text-left px-3 py-2.5 font-medium text-[var(--color-text-tertiary)]">Country</th>
                  <th className="text-right px-3 py-2.5 font-medium text-[var(--color-text-tertiary)]">Places</th>
                  <th className="text-right px-3 py-2.5 font-medium text-[var(--color-text-tertiary)]">Seeds</th>
                  <th className="text-center px-3 py-2.5 font-medium text-[var(--color-text-tertiary)]">Density</th>
                  <th className="text-right px-4 py-2.5 font-medium text-[var(--color-text-tertiary)]">Actions</th>
                </tr>
              </thead>
              <tbody>
                {cityStats.map((city) => {
                  const isSeeding = cityAction?.cityId === city.city_id && cityAction.action === "seed";
                  const isClearing = cityAction?.cityId === city.city_id && cityAction.action === "clear";
                  const isBusy = isSeeding || isClearing;

                  return (
                    <tr key={city.city_id} className="border-b border-[var(--gray-100)] last:border-0 hover:bg-[var(--gray-50)] transition-colors">
                      <td className="px-4 py-2.5 font-semibold text-[var(--color-text-primary)]">{city.city_name}</td>
                      <td className="px-3 py-2.5 text-[var(--color-text-tertiary)]">{city.country}</td>
                      <td className="px-3 py-2.5 text-right text-[var(--color-text-secondary)]">{Number(city.place_count).toLocaleString()}</td>
                      <td className="px-3 py-2.5 text-right">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          Number(city.seed_count) > 0
                            ? "bg-[var(--color-success-50)] text-[var(--color-success-700)]"
                            : "bg-[var(--gray-100)] text-[var(--color-text-tertiary)]"
                        }`}>
                          {Number(city.seed_count)}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <input
                          type="number"
                          min={1}
                          max={100}
                          value={densities[city.city_id] ?? 10}
                          onChange={(e) => setDensities(prev => ({ ...prev, [city.city_id]: Math.max(1, Math.min(100, Number(e.target.value) || 1)) }))}
                          className="w-16 px-2 py-1 text-center text-sm rounded-lg border border-[var(--gray-200)] bg-[var(--color-background-primary)] text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-500)] focus:border-transparent"
                        />
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => seedSingleCity(city.city_id)}
                            disabled={isBusy || !!strangerAction}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg bg-[var(--color-brand-500)] text-white hover:bg-[var(--color-brand-600)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                          >
                            {isSeeding ? <Loader2 className="w-3 h-3 animate-spin" /> : <Users className="w-3 h-3" />}
                            Seed
                          </button>
                          {Number(city.seed_count) > 0 && (
                            <button
                              onClick={() => clearSingleCity(city.city_id)}
                              disabled={isBusy || !!strangerAction}
                              className="inline-flex items-center p-1 text-xs rounded-lg text-[var(--color-error-600)] hover:bg-[var(--color-error-50)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                              title="Clear seeds for this city"
                            >
                              {isClearing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Stats Summary */}
        {!statsLoading && cityStats.length > 0 && (
          <p className="text-xs text-[var(--color-text-tertiary)] mb-4">
            Total: {totalCitySeeds.toLocaleString()} city seeds · {globalSeeds.toLocaleString()} global grid seeds
          </p>
        )}

        {/* Bulk Actions */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Button
            variant="primary"
            icon={MapPin}
            loading={strangerAction === "seed_all_cities"}
            disabled={!!strangerAction || !!cityAction}
            onClick={() => setConfirmModal({ type: "stranger", action: "seed_all_cities", label: "Seed All Cities (per-city density)" })}
            className="w-full"
          >
            Seed All Cities
          </Button>
          <Button
            variant="secondary"
            icon={Globe}
            loading={strangerAction === "seed_global"}
            disabled={!!strangerAction || !!cityAction}
            onClick={() => setConfirmModal({ type: "stranger", action: "seed_global", label: "Seed Global Grid (~1.2M strangers)" })}
            className="w-full"
          >
            Seed Global Grid
          </Button>
          <Button
            variant="danger"
            icon={Trash2}
            loading={strangerAction === "cleanup"}
            disabled={!!strangerAction || !!cityAction}
            onClick={() => setConfirmModal({ type: "stranger", action: "cleanup", label: "Cleanup All Seed Strangers" })}
            className="w-full"
          >
            Cleanup All Seeds
          </Button>
        </div>
      </div>

      {/* Confirmation Modal */}
      <Modal
        open={!!confirmModal}
        onClose={() => setConfirmModal(null)}
        title={`Run "${confirmModal?.label}"?`}
        destructive
      >
        <ModalBody>
          <p className="text-sm text-[var(--color-text-secondary)]">
            This script will modify live data. This cannot be undone.
          </p>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setConfirmModal(null)}>Cancel</Button>
          <Button
            variant="danger"
            onClick={() => {
              const m = confirmModal;
              setConfirmModal(null);
              if (m.type === "stranger") {
                runStrangerAction(m.action);
              } else {
                runScript(m.idx);
              }
            }}
          >
            Run
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
