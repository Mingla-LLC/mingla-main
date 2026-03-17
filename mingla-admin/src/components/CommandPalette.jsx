import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Search, FileText, User, MapPin, Settings } from "lucide-react";
import { supabase } from "../lib/supabase";
import { NAV_ITEMS } from "../lib/constants";
import { escapeLike } from "../lib/formatters";

export function CommandPalette({ open, onClose, onNavigate }) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [dbResults, setDbResults] = useState({ users: [], places: [] });
  const [dbLoading, setDbLoading] = useState(false);
  const inputRef = useRef(null);
  const debounceRef = useRef(null);

  // Focus input on open
  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
      setDbResults({ users: [], places: [] });
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Debounced DB search
  useEffect(() => {
    if (!open) return;
    clearTimeout(debounceRef.current);

    if (query.length < 2) {
      setDbResults({ users: [], places: [] });
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setDbLoading(true);
      try {
        const q = `%${escapeLike(query)}%`;
        const [usersRes, placesRes] = await Promise.all([
          supabase.from("profiles").select("id, display_name, email").ilike("display_name", q).limit(5),
          supabase.from("place_pool").select("id, name, address").ilike("name", q).limit(5),
        ]);
        setDbResults({
          users: usersRes.data || [],
          places: placesRes.data || [],
        });
      } catch {
        // Silently fail — search is best-effort
      } finally {
        setDbLoading(false);
      }
    }, 300);

    return () => clearTimeout(debounceRef.current);
  }, [query, open]);

  // Client-side page filter (instant)
  const pageResults = useMemo(() => {
    if (!query) return NAV_ITEMS.slice(0, 5);
    const lower = query.toLowerCase();
    return NAV_ITEMS.filter((p) => p.label.toLowerCase().includes(lower)).slice(0, 5);
  }, [query]);

  // Config filter (client-side, simple)
  const configResults = useMemo(() => {
    if (!query || query.length < 2) return [];
    const lower = query.toLowerCase();
    const items = [
      { label: "Feature Flags", tab: "settings" },
      { label: "App Config", tab: "settings" },
      { label: "Integrations", tab: "settings" },
      { label: "Theme", tab: "settings" },
    ];
    return items.filter((i) => i.label.toLowerCase().includes(lower));
  }, [query]);

  // Flat result list for keyboard navigation
  const allResults = useMemo(() => {
    const results = [];
    pageResults.forEach((p) => results.push({ type: "page", id: p.id, label: p.label, icon: FileText }));
    dbResults.users.forEach((u) =>
      results.push({ type: "user", id: u.id, label: u.display_name || u.email, sub: u.email, icon: User })
    );
    dbResults.places.forEach((p) =>
      results.push({ type: "place", id: p.id, label: p.name, sub: p.address, icon: MapPin })
    );
    configResults.forEach((c) =>
      results.push({ type: "config", id: c.tab, label: c.label, icon: Settings })
    );
    return results;
  }, [pageResults, dbResults, configResults]);

  const handleSelect = useCallback(
    (result) => {
      onClose();
      if (result.type === "page") {
        onNavigate(result.id);
      } else if (result.type === "user") {
        window.location.hash = `#/users?userId=${result.id}`;
      } else if (result.type === "place") {
        onNavigate("placepool");
      } else if (result.type === "config") {
        onNavigate(result.id);
      }
    },
    [onClose, onNavigate]
  );

  // Keyboard navigation
  useEffect(() => {
    if (!open) return;

    const handler = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, allResults.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter" && allResults[activeIndex]) {
        e.preventDefault();
        handleSelect(allResults[activeIndex]);
      }
    };

    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose, allResults, activeIndex, handleSelect]);

  // Reset active index when results change
  useEffect(() => {
    setActiveIndex(0);
  }, [allResults.length]);

  if (!open) return null;

  const groupedSections = [
    { label: "Pages", items: allResults.filter((r) => r.type === "page") },
    { label: "Users", items: allResults.filter((r) => r.type === "user") },
    { label: "Places", items: allResults.filter((r) => r.type === "place") },
    { label: "Config", items: allResults.filter((r) => r.type === "config") },
  ].filter((s) => s.items.length > 0);

  let flatIndex = -1;

  return (
    <div
      className="fixed inset-0 flex items-start justify-center pt-[15vh] p-4 bg-black/50 backdrop-blur-[6px] animate-[fade-in_150ms_ease-out]"
      style={{ zIndex: "calc(var(--z-modal) + 10)" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-[560px] bg-[var(--color-background-primary)] rounded-xl shadow-[var(--shadow-xl)] overflow-hidden animate-[scale-in_150ms_ease-out]">
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--gray-200)]">
          <Search className="h-5 w-5 text-[var(--color-text-tertiary)] shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search pages, users, places..."
            className="flex-1 bg-transparent text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] text-base outline-none"
          />
          <kbd className="hidden sm:inline-flex items-center px-1.5 py-0.5 text-[10px] font-mono text-[var(--color-text-muted)] bg-[var(--gray-100)] rounded border border-[var(--gray-200)]">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div className="max-h-[400px] overflow-y-auto py-2">
          {groupedSections.length === 0 && query.length >= 2 && !dbLoading && (
            <p className="px-4 py-6 text-sm text-center text-[var(--color-text-tertiary)]">
              No results found.
            </p>
          )}

          {groupedSections.map((section) => (
            <div key={section.label}>
              <p className="px-4 py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)]">
                {section.label}
              </p>
              {section.items.map((result) => {
                flatIndex++;
                const idx = flatIndex;
                const Icon = result.icon;
                const isActive = idx === activeIndex;

                return (
                  <button
                    key={`${result.type}-${result.id}-${idx}`}
                    onClick={() => handleSelect(result)}
                    onMouseEnter={() => setActiveIndex(idx)}
                    className={[
                      "w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors cursor-pointer",
                      isActive
                        ? "bg-[var(--gray-100)] text-[var(--color-text-primary)]"
                        : "text-[var(--color-text-secondary)] hover:bg-[var(--gray-50)]",
                    ].join(" ")}
                  >
                    <Icon className="h-4 w-4 shrink-0 opacity-50" />
                    <div className="flex-1 min-w-0">
                      <span className="block truncate font-medium">{result.label}</span>
                      {result.sub && (
                        <span className="block truncate text-xs text-[var(--color-text-muted)]">
                          {result.sub}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          ))}

          {dbLoading && (
            <p className="px-4 py-3 text-xs text-center text-[var(--color-text-muted)]">
              Searching...
            </p>
          )}
        </div>

        {/* Footer hint */}
        <div className="flex items-center gap-4 px-4 py-2 border-t border-[var(--gray-200)] text-[10px] text-[var(--color-text-muted)]">
          <span><kbd className="font-mono">↑↓</kbd> navigate</span>
          <span><kbd className="font-mono">↵</kbd> select</span>
          <span><kbd className="font-mono">esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}
