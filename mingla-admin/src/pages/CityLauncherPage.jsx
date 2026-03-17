import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  MapPin, Search, CheckCircle, AlertCircle, Rocket, ChevronRight,
  ChevronLeft, Download, RefreshCw, Globe, Loader2,
} from "lucide-react";
import { supabase, SUPABASE_URL } from "../lib/supabase";
import { SectionCard, AlertCard } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Badge } from "../components/ui/Badge";
import { DataTable } from "../components/ui/Table";
import { Modal, ModalBody, ModalFooter } from "../components/ui/Modal";
import { Spinner } from "../components/ui/Spinner";
import { useToast } from "../context/ToastContext";
import { logAdminAction } from "../lib/auditLog";

const CATEGORIES = [
  "restaurant", "bar", "cafe", "park", "museum", "theater",
  "night_club", "shopping_mall", "gym", "amusement_park", "tourist_attraction", "lodging",
];
const CATEGORY_LABELS = {
  restaurant: "Restaurants", bar: "Bars", cafe: "Cafes", park: "Parks",
  museum: "Museums", theater: "Theaters", night_club: "Nightlife",
  shopping_mall: "Shopping", gym: "Fitness", amusement_park: "Entertainment",
  tourist_attraction: "Landmarks", lodging: "Hotels",
};
const RADIUS_OPTIONS = [1, 2, 5, 10, 25];
const STEPS = ["Define Area", "Search & Select", "Import", "Review", "Launch"];

async function getAuthHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Not authenticated");
  return { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` };
}

export function CityLauncherPage() {
  const { addToast } = useToast();
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const [step, setStep] = useState(0);

  // Step 1 state
  const [city, setCity] = useState("");
  const [zipcode, setZipcode] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [radius, setRadius] = useState(5);
  const [selectedCategories, setSelectedCategories] = useState(new Set(CATEGORIES));

  // Step 2 state
  const [searchResults, setSearchResults] = useState([]);
  const [searchProgress, setSearchProgress] = useState({ done: 0, total: 0, current: "" });
  const [searching, setSearching] = useState(false);
  const [existingIds, setExistingIds] = useState(new Set());
  const [selectedPlaces, setSelectedPlaces] = useState(new Set());

  // Step 3 state
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState({ done: 0, total: 0 });

  // Step 4 state
  const [importedPlaces, setImportedPlaces] = useState([]);

  // Step 5 state
  const [launching, setLaunching] = useState(false);
  const [launched, setLaunched] = useState(false);

  // ─── Step 1: Define Area ───────────────────────────────────────────────────

  const canProceedStep1 = city.trim() && lat && lng && selectedCategories.size > 0;

  const toggleCategory = (cat) => {
    setSelectedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      return next;
    });
  };

  // ─── Step 2: Search ────────────────────────────────────────────────────────

  const startSearch = useCallback(async () => {
    setSearching(true);
    setSearchResults([]);
    const cats = [...selectedCategories];
    setSearchProgress({ done: 0, total: cats.length, current: "" });

    // Fetch existing place IDs for dedup
    const { data: existing } = await supabase.from("place_pool").select("google_place_id");
    const existSet = new Set((existing || []).map((p) => p.google_place_id).filter(Boolean));
    setExistingIds(existSet);

    const allResults = [];
    const headers = await getAuthHeaders();

    for (let i = 0; i < cats.length; i++) {
      const cat = cats[i];
      if (!mountedRef.current) return;
      setSearchProgress({ done: i, total: cats.length, current: CATEGORY_LABELS[cat] || cat });

      try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/admin-place-search`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            action: "search",
            textQuery: CATEGORY_LABELS[cat] || cat,
            city,
            country: "",
            postcode: zipcode,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          const places = (data.places || data.results || []).map((p) => ({
            ...p,
            _category: cat,
            _duplicate: existSet.has(p.google_place_id),
          }));
          allResults.push(...places);
        }
      } catch {
        // Skip failed categories silently
      }
    }

    if (!mountedRef.current) return;
    setSearchProgress({ done: cats.length, total: cats.length, current: "" });
    setSearchResults(allResults);

    // Auto-select non-duplicates
    const newIds = new Set(allResults.filter((p) => !p._duplicate).map((p) => p.google_place_id));
    setSelectedPlaces(newIds);
    setSearching(false);
  }, [city, zipcode, selectedCategories]);

  useEffect(() => {
    if (step === 1 && searchResults.length === 0 && !searching) {
      startSearch();
    }
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  const searchStats = useMemo(() => {
    const total = searchResults.length;
    const dupes = searchResults.filter((p) => p._duplicate).length;
    return { total, new: total - dupes, duplicates: dupes, selected: selectedPlaces.size };
  }, [searchResults, selectedPlaces]);

  const togglePlaceSelect = (gpid) => {
    if (existingIds.has(gpid)) return;
    setSelectedPlaces((prev) => {
      const next = new Set(prev);
      if (next.has(gpid)) next.delete(gpid); else next.add(gpid);
      return next;
    });
  };

  // ─── Step 3: Import ────────────────────────────────────────────────────────

  const startImport = useCallback(async () => {
    setImporting(true);
    const toImport = searchResults.filter((p) => selectedPlaces.has(p.google_place_id));
    setImportProgress({ done: 0, total: toImport.length });

    try {
      const headers = await getAuthHeaders();
      // Batch import in chunks of 20
      const BATCH = 20;
      for (let i = 0; i < toImport.length; i += BATCH) {
        if (!mountedRef.current) return;
        const batch = toImport.slice(i, i + BATCH);
        await fetch(`${SUPABASE_URL}/functions/v1/admin-place-search`, {
          method: "POST",
          headers,
          body: JSON.stringify({ action: "push", places: batch }),
        });
        setImportProgress({ done: Math.min(i + BATCH, toImport.length), total: toImport.length });
      }

      if (!mountedRef.current) return;
      addToast(`Imported ${toImport.length} places`, "success");
      logAdminAction("city.import", "place", city, { count: toImport.length });

      // Fetch imported places for review
      const { data } = await supabase
        .from("place_pool")
        .select("*")
        .in("google_place_id", toImport.map((p) => p.google_place_id))
        .order("name");
      setImportedPlaces(data || []);
    } catch (err) {
      addToast(`Import failed: ${err.message}`, "error");
    }

    if (mountedRef.current) setImporting(false);
  }, [searchResults, selectedPlaces, city, addToast]);

  useEffect(() => {
    if (step === 2 && !importing && importedPlaces.length === 0) {
      startImport();
    }
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Step 5: Launch ────────────────────────────────────────────────────────

  const [launchConfirm, setLaunchConfirm] = useState(false);

  const handleLaunch = async () => {
    setLaunchConfirm(false);
    setLaunching(true);
    try {
      const ids = importedPlaces.map((p) => p.id);
      const { error } = await supabase
        .from("place_pool")
        .update({ is_active: true })
        .in("id", ids);
      if (error) throw error;
      addToast(`${city} is live! ${ids.length} places are now visible to users.`, "success");
      logAdminAction("city.launch", "place", city, { count: ids.length });
      setLaunched(true);
    } catch (err) {
      addToast(`Launch failed: ${err.message}`, "error");
    }
    if (mountedRef.current) setLaunching(false);
  };

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">City Launcher</h1>

      {/* Step indicator */}
      <div className="flex items-center gap-2">
        {STEPS.map((label, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className={[
              "flex items-center justify-center w-8 h-8 rounded-full text-xs font-bold transition-colors",
              i < step ? "bg-green-500 text-white"
                : i === step ? "bg-[#f97316] text-white"
                : "bg-[var(--gray-200)] text-[var(--color-text-tertiary)]",
            ].join(" ")}>
              {i < step ? <CheckCircle className="h-4 w-4" /> : i + 1}
            </div>
            <span className={[
              "text-xs font-medium hidden sm:inline",
              i === step ? "text-[var(--color-text-primary)]" : "text-[var(--color-text-tertiary)]",
            ].join(" ")}>{label}</span>
            {i < STEPS.length - 1 && <ChevronRight className="h-4 w-4 text-[var(--gray-300)]" />}
          </div>
        ))}
      </div>

      {/* Step 1: Define Area */}
      {step === 0 && (
        <SectionCard title="Define your launch area">
          <p className="text-sm text-[var(--color-text-secondary)] mb-4">
            Choose a city and radius. We'll search for venues in that area.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <Input label="City" value={city} onChange={(e) => setCity(e.target.value)} placeholder="San Francisco" />
            <Input label="Zipcode (optional)" value={zipcode} onChange={(e) => setZipcode(e.target.value)} placeholder="94102" />
            <Input label="Latitude" value={lat} onChange={(e) => setLat(e.target.value)} placeholder="37.7749" type="number" />
            <Input label="Longitude" value={lng} onChange={(e) => setLng(e.target.value)} placeholder="-122.4194" type="number" />
          </div>

          <div className="mb-4">
            <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-2">Radius</label>
            <div className="flex gap-2">
              {RADIUS_OPTIONS.map((r) => (
                <Button key={r} variant={radius === r ? "primary" : "secondary"} size="sm" onClick={() => setRadius(r)}>
                  {r} km
                </Button>
              ))}
            </div>
          </div>

          <div className="mb-4">
            <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-2">Categories</label>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
              {CATEGORIES.map((cat) => (
                <label key={cat} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedCategories.has(cat)}
                    onChange={() => toggleCategory(cat)}
                    className="h-4 w-4 rounded border-[var(--gray-300)] text-[#f97316] focus:ring-[#f97316]"
                  />
                  {CATEGORY_LABELS[cat] || cat}
                </label>
              ))}
            </div>
          </div>

          <div className="flex justify-end">
            <Button icon={ChevronRight} iconRight disabled={!canProceedStep1} onClick={() => setStep(1)}>
              Search Places
            </Button>
          </div>
        </SectionCard>
      )}

      {/* Step 2: Search & Select */}
      {step === 1 && (
        <SectionCard title="Review search results">
          <p className="text-sm text-[var(--color-text-secondary)] mb-4">
            Select the places you want to import. Duplicates are excluded automatically.
          </p>

          {searching ? (
            <div className="flex flex-col items-center gap-3 py-12">
              <Spinner />
              <p className="text-sm text-[var(--color-text-secondary)]">
                Searching {searchProgress.current}... ({searchProgress.done}/{searchProgress.total} categories done)
              </p>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-4 mb-4 text-sm text-[var(--color-text-secondary)]">
                <span>{searchStats.total} found</span>
                <span className="text-green-600">{searchStats.new} new</span>
                <span className="text-[var(--color-text-muted)]">{searchStats.duplicates} already imported</span>
                <span className="font-medium text-[var(--color-text-primary)]">{searchStats.selected} selected</span>
                <Button variant="ghost" size="sm" onClick={() => {
                  setSelectedPlaces(new Set(searchResults.filter((p) => !p._duplicate).map((p) => p.google_place_id)));
                }}>Select All New</Button>
              </div>

              <DataTable
                columns={[
                  { key: "name", label: "Name", sortable: true },
                  { key: "_category", label: "Category", render: (v) => CATEGORY_LABELS[v] || v },
                  { key: "rating", label: "Rating", sortable: true, render: (v) => v ? `${v} ★` : "—" },
                  { key: "address", label: "Address" },
                  { key: "_duplicate", label: "", width: "100px", render: (v) => v ? <Badge variant="default">Already imported</Badge> : null },
                ]}
                rows={searchResults}
                selectable
                selectedIds={selectedPlaces}
                onSelect={(id) => togglePlaceSelect(id)}
                onSelectAll={(all) => {
                  if (all) setSelectedPlaces(new Set(searchResults.filter((p) => !p._duplicate).map((p) => p.google_place_id)));
                  else setSelectedPlaces(new Set());
                }}
                getRowId={(r) => r.google_place_id}
                emptyMessage="No results found."
              />
            </>
          )}

          <div className="flex justify-between mt-4">
            <Button variant="secondary" icon={ChevronLeft} onClick={() => setStep(0)}>Back</Button>
            <Button icon={ChevronRight} iconRight disabled={selectedPlaces.size === 0} onClick={() => setStep(2)}>
              Import {selectedPlaces.size} Places
            </Button>
          </div>
        </SectionCard>
      )}

      {/* Step 3: Import */}
      {step === 2 && (
        <SectionCard title="Importing and generating content">
          {importing ? (
            <div className="flex flex-col items-center gap-4 py-12">
              <Spinner />
              <p className="text-sm text-[var(--color-text-secondary)]">
                Importing places... {importProgress.done}/{importProgress.total}
              </p>
              <div className="w-full max-w-md bg-[var(--gray-200)] rounded-full h-2">
                <div
                  className="bg-[#f97316] h-2 rounded-full transition-all duration-300"
                  style={{ width: `${importProgress.total ? (importProgress.done / importProgress.total) * 100 : 0}%` }}
                />
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-4 py-8">
              <CheckCircle className="h-12 w-12 text-green-500" />
              <p className="text-sm text-[var(--color-text-primary)] font-medium">
                {importedPlaces.length} places imported successfully
              </p>
              <Button icon={ChevronRight} iconRight onClick={() => setStep(3)}>Review</Button>
            </div>
          )}
        </SectionCard>
      )}

      {/* Step 4: Review */}
      {step === 3 && (
        <SectionCard title="Review imported content">
          <p className="text-sm text-[var(--color-text-secondary)] mb-4">
            Review and edit before going live. Deactivate anything that doesn't look right.
          </p>

          <DataTable
            columns={[
              { key: "name", label: "Name", sortable: true },
              { key: "category", label: "Category" },
              { key: "rating", label: "Rating", sortable: true, render: (v) => v ? `${v} ★` : "—" },
              { key: "is_active", label: "Status", render: (v) => <Badge variant={v ? "success" : "default"}>{v ? "Active" : "Inactive"}</Badge> },
            ]}
            rows={importedPlaces}
            emptyMessage="No places imported."
          />

          <div className="flex justify-between mt-4">
            <Button variant="secondary" icon={ChevronLeft} onClick={() => setStep(2)}>Back</Button>
            <Button icon={ChevronRight} iconRight onClick={() => setStep(4)}>Proceed to Launch</Button>
          </div>
        </SectionCard>
      )}

      {/* Step 5: Launch */}
      {step === 4 && (
        <SectionCard title="Ready to launch">
          {launched ? (
            <div className="flex flex-col items-center gap-4 py-12">
              <Rocket className="h-16 w-16 text-[#f97316]" />
              <h2 className="text-xl font-bold text-[var(--color-text-primary)]">{city} is live!</h2>
              <p className="text-sm text-[var(--color-text-secondary)]">
                {importedPlaces.length} places are now visible to users.
              </p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-4 py-8">
              <div className="text-center">
                <p className="text-lg font-semibold text-[var(--color-text-primary)]">{importedPlaces.length} places ready</p>
                <p className="text-sm text-[var(--color-text-secondary)] mt-1">for {city}</p>
              </div>
              <Button
                variant="primary"
                size="lg"
                icon={Rocket}
                loading={launching}
                onClick={() => setLaunchConfirm(true)}
              >
                Launch {city}
              </Button>
            </div>
          )}

          {!launched && (
            <div className="flex justify-start mt-4">
              <Button variant="secondary" icon={ChevronLeft} onClick={() => setStep(3)}>Back</Button>
            </div>
          )}
        </SectionCard>
      )}

      {/* Launch Confirmation Modal */}
      <Modal open={launchConfirm} onClose={() => setLaunchConfirm(false)} title={`Launch ${city}?`}>
        <ModalBody>
          <p className="text-sm text-[var(--color-text-secondary)]">
            This will make {importedPlaces.length} places visible to users. You can deactivate individual places later from the Places page.
          </p>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setLaunchConfirm(false)}>Cancel</Button>
          <Button onClick={handleLaunch}>Launch {city}</Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
