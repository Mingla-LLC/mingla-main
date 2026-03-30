import { useState, useEffect, useCallback, useRef } from "react";
import {
  Layers, CreditCard, Star, Database, Trash2, Edit3, Eye, EyeOff,
  Save, RefreshCw, ChevronDown, ChevronUp, AlertCircle,
  X, Power, PowerOff, Download, Image, CheckCircle, XCircle, Flag,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import { SectionCard, StatCard } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Badge } from "../components/ui/Badge";
import { SearchInput } from "../components/ui/SearchInput";
import { DataTable } from "../components/ui/Table";
import { Modal, ModalBody, ModalFooter } from "../components/ui/Modal";
import { Tabs } from "../components/ui/Tabs";
import { Spinner } from "../components/ui/Spinner";
import { StatCardSkeleton } from "../components/ui/Skeleton";
import { useToast } from "../context/ToastContext";
import { timeAgo, formatDate, formatDateTime, truncate, escapeLike } from "../lib/formatters";
import { logAdminAction } from "../lib/auditLog";
import { exportCsv } from "../lib/exportCsv";

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 400;

const SUB_TABS = [
  { id: "experiences", label: "Experiences" },
  { id: "cardpool", label: "Card Pool" },
  { id: "reviews", label: "Place Reviews" },
  { id: "curated", label: "Curated Cache" },
];

const EXPERIENCE_CATEGORIES = [
  "Nature", "First Meet", "Picnic", "Drink", "Casual Eats", "Fine Dining",
  "Watch", "Creative Arts", "Play", "Wellness", "Groceries & Flowers", "Work & Business",
];


// ─── Helpers ──────────────────────────────────────────────────────────────────

function countCategoryPlaces(categoryPlaces) {
  if (!categoryPlaces || typeof categoryPlaces !== "object") return { categories: 0, places: 0 };
  const keys = Object.keys(categoryPlaces);
  let places = 0;
  for (const key of keys) {
    if (Array.isArray(categoryPlaces[key])) {
      places += categoryPlaces[key].length;
    }
  }
  return { categories: keys.length, places };
}

function renderStars(rating) {
  if (rating == null) return "—";
  const n = Math.round(Number(rating));
  return "★".repeat(Math.min(n, 5)) + "☆".repeat(Math.max(5 - n, 0));
}

// ─── Thumbnail Preview Modal ─────────────────────────────────────────────────

function ThumbnailPreview({ src, alt, onClose }) {
  if (!src) return null;
  return (
    <Modal open={!!src} onClose={onClose} title="Image Preview" size="lg">
      <ModalBody>
        <div className="flex items-center justify-center">
          <img src={src} alt={alt || "Preview"} className="max-w-full max-h-[70vh] rounded-lg object-contain" />
        </div>
      </ModalBody>
    </Modal>
  );
}

// ─── Experiences Sub-View ────────────────────────────────────────────────────

function ExperiencesSubView() {
  const { addToast } = useToast();
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const [experiences, setExperiences] = useState([]);
  const [expCount, setExpCount] = useState(0);
  const [expPage, setExpPage] = useState(0);
  const [expSearch, setExpSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [expCategoryFilter, setExpCategoryFilter] = useState("");
  const [expLoading, setExpLoading] = useState(true);
  const [expError, setExpError] = useState(null);

  // Edit modal
  const [editingExp, setEditingExp] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [saving, setSaving] = useState(false);

  // Delete confirmation
  const [deleteId, setDeleteId] = useState(null);
  const [deleting, setDeleting] = useState(false);

  // Bulk selection
  const [selectedIds, setSelectedIds] = useState(new Set());

  // Bulk action loading
  const [bulkActioning, setBulkActioning] = useState(false);

  // Thumbnail preview
  const [previewUrl, setPreviewUrl] = useState(null);

  const searchTimerRef = useRef(null);

  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      setDebouncedSearch(expSearch);
      setExpPage(0);
    }, SEARCH_DEBOUNCE_MS);
    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current); };
  }, [expSearch]);

  const fetchExperiences = useCallback(async () => {
    setExpLoading(true);
    setExpError(null);
    try {
      let query = supabase
        .from("experiences")
        .select("*", { count: "exact" })
        .order("created_at", { ascending: false })
        .range(expPage * PAGE_SIZE, (expPage + 1) * PAGE_SIZE - 1);

      if (debouncedSearch) query = query.ilike("title", `%${escapeLike(debouncedSearch)}%`);
      if (expCategoryFilter) query = query.eq("category", expCategoryFilter);

      const { data, count, error } = await query;
      if (error) throw error;
      if (!mountedRef.current) return;
      setExperiences(data || []);
      setExpCount(count ?? 0);
    } catch (err) {
      if (!mountedRef.current) return;
      setExpError(err.message);
      addToast({ variant: "error", title: "Failed to load experiences", description: err.message });
    } finally {
      if (mountedRef.current) setExpLoading(false);
    }
  }, [expPage, debouncedSearch, expCategoryFilter, addToast]);

  useEffect(() => { fetchExperiences(); }, [fetchExperiences]);

  // Edit
  const openEdit = (exp) => {
    setEditingExp(exp);
    setEditForm({
      title: exp.title || "",
      category: exp.category || "",
      price_min: exp.price_min ?? "",
      price_max: exp.price_max ?? "",
      duration_min: exp.duration_min ?? "",
      image_url: exp.image_url || "",
    });
  };

  const saveEdit = async () => {
    if (!editingExp) return;
    setSaving(true);
    try {
      const updates = {
        title: editForm.title.trim() || null,
        category: editForm.category || null,
        price_min: editForm.price_min === "" ? null : Number(editForm.price_min),
        price_max: editForm.price_max === "" ? null : Number(editForm.price_max),
        duration_min: editForm.duration_min === "" ? null : Number(editForm.duration_min),
        image_url: editForm.image_url.trim() || null,
      };
      const { error } = await supabase.from("experiences").update(updates).eq("id", editingExp.id);
      if (error) throw error;
      addToast({ variant: "success", title: "Experience updated" });
      logAdminAction("content.edit", "experience", editingExp.id, { title: updates.title });
      setEditingExp(null);
      fetchExperiences();
    } catch (err) {
      addToast({ variant: "error", title: "Update failed", description: err.message });
    } finally {
      setSaving(false);
    }
  };

  // Delete
  const confirmDelete = async () => {
    if (!deleteId) return;
    setDeleting(true);
    try {
      const { error } = await supabase.from("experiences").delete().eq("id", deleteId);
      if (error) throw error;
      addToast({ variant: "success", title: "Experience deleted" });
      logAdminAction("content.delete", "experience", deleteId);
      setDeleteId(null);
      fetchExperiences();
    } catch (err) {
      addToast({ variant: "error", title: "Delete failed", description: err.message });
    } finally {
      setDeleting(false);
    }
  };

  // Bulk actions
  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    setBulkActioning(true);
    try {
      const ids = [...selectedIds];
      const { error } = await supabase.from("experiences").delete().in("id", ids);
      if (error) throw error;
      addToast({ variant: "success", title: `${ids.length} experience(s) deleted` });
      ids.forEach(id => logAdminAction("content.delete", "experience", id));
      setSelectedIds(new Set());
      fetchExperiences();
    } catch (err) {
      addToast({ variant: "error", title: "Bulk delete failed", description: err.message });
    } finally {
      setBulkActioning(false);
    }
  };

  const columns = [
    {
      key: "image_url",
      label: "",
      width: "50px",
      render: (_v, row) => row.image_url ? (
        <button onClick={() => setPreviewUrl(row.image_url)} className="cursor-pointer">
          <img src={row.image_url} alt="" className="w-10 h-10 rounded object-cover" />
        </button>
      ) : (
        <div className="w-10 h-10 rounded bg-[var(--gray-100)] flex items-center justify-center">
          <Image className="w-4 h-4 text-[var(--color-text-muted)]" />
        </div>
      ),
    },
    {
      key: "title",
      label: "Title",
      render: (_v, row) => (
        <span className="text-[var(--color-text-primary)] font-medium">{truncate(row.title, 50)}</span>
      ),
    },
    {
      key: "category",
      label: "Category",
      render: (_v, row) => row.category ? <Badge variant="brand">{row.category}</Badge> : <span className="text-[var(--color-text-muted)]">—</span>,
    },
    {
      key: "place_id",
      label: "Place ID",
      render: (_v, row) => (
        <span className="text-[var(--color-text-tertiary)] font-mono text-xs" title={row.place_id || ""}>
          {truncate(row.place_id, 20)}
        </span>
      ),
    },
    {
      key: "price_min",
      label: "Price",
      render: (_v, row) => {
        if (row.price_min == null && row.price_max == null) return <span className="text-[var(--color-text-muted)]">—</span>;
        return <span className="text-[var(--color-text-secondary)]">${row.price_min ?? "?"} – ${row.price_max ?? "?"}</span>;
      },
    },
    {
      key: "duration_min",
      label: "Duration",
      render: (_v, row) => row.duration_min != null
        ? <span className="text-[var(--color-text-secondary)]">{row.duration_min} min</span>
        : <span className="text-[var(--color-text-muted)]">—</span>,
    },
    {
      key: "created_at",
      label: "Created",
      render: (_v, row) => <span className="text-[var(--color-text-tertiary)] text-xs">{timeAgo(row.created_at)}</span>,
    },
    {
      key: "actions",
      label: "",
      width: "100px",
      render: (_v, row) => (
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" icon={Edit3} onClick={() => openEdit(row)}>Edit</Button>
          <Button variant="ghost" size="sm" icon={Trash2} onClick={() => setDeleteId(row.id)} className="text-[#ef4444] hover:text-[#ef4444]">Del</Button>
        </div>
      ),
    },
  ];

  const from = expPage * PAGE_SIZE + 1;
  const to = Math.min((expPage + 1) * PAGE_SIZE, expCount);

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <SearchInput
          value={expSearch}
          onChange={(e) => setExpSearch(e.target.value)}
          onClear={() => setExpSearch("")}
          placeholder="Search by title..."
          className="w-64"
        />
        <select
          value={expCategoryFilter}
          onChange={(e) => { setExpCategoryFilter(e.target.value); setExpPage(0); }}
          className="h-10 px-3 rounded-lg text-sm bg-[var(--color-background-primary)] border border-[var(--gray-200)] text-[var(--color-text-primary)] cursor-pointer"
        >
          <option value="">All Categories</option>
          {EXPERIENCE_CATEGORIES.map((cat) => (
            <option key={cat} value={cat}>{cat}</option>
          ))}
        </select>
        <Button variant="ghost" size="sm" icon={RefreshCw} onClick={fetchExperiences}>Refresh</Button>
        <span className="text-xs text-[var(--color-text-tertiary)] ml-auto">{expCount} total</span>
      </div>

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-2 rounded-lg bg-[var(--color-brand-50,#fff7ed)] border border-[var(--color-brand-200)]">
          <span className="text-sm font-medium text-[var(--color-text-primary)]">{selectedIds.size} selected</span>
          <Button variant="danger" size="sm" icon={Trash2} loading={bulkActioning} onClick={handleBulkDelete}>
            Delete Selected
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())}>Clear</Button>
        </div>
      )}

      {/* Table */}
      <SectionCard noPadding>
        {expError && !expLoading ? (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <AlertCircle className="w-10 h-10 text-[#ef4444]" />
            <p className="text-sm text-[var(--color-text-primary)] font-medium">Failed to load experiences</p>
            <p className="text-xs text-[var(--color-text-tertiary)]">{expError}</p>
            <Button variant="link" onClick={fetchExperiences}>Try again</Button>
          </div>
        ) : (
          <DataTable
            columns={columns}
            rows={experiences}
            loading={expLoading}
            emptyIcon={Layers}
            emptyMessage="No experiences found"
            selectable
            selectedIds={selectedIds}
            onSelect={(id) => {
              setSelectedIds(prev => {
                const next = new Set(prev);
                if (next.has(id)) next.delete(id); else next.add(id);
                return next;
              });
            }}
            onSelectAll={(allSelected) => {
              if (allSelected) setSelectedIds(new Set());
              else setSelectedIds(new Set(experiences.map(e => e.id)));
            }}
            pagination={{
              page: expPage,
              pageSize: PAGE_SIZE,
              total: expCount,
              from: expCount > 0 ? from : 0,
              to,
              onChange: setExpPage,
            }}
          />
        )}
      </SectionCard>

      {/* Edit Modal */}
      <Modal open={!!editingExp} onClose={() => setEditingExp(null)} title="Edit Experience" size="md">
        <ModalBody>
          <div className="space-y-4">
            <Input label="Title" value={editForm.title || ""} onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))} />
            <div>
              <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1.5">Category</label>
              <select
                value={editForm.category || ""}
                onChange={(e) => setEditForm((f) => ({ ...f, category: e.target.value }))}
                className="w-full h-10 px-3 rounded-lg text-sm bg-[var(--color-background-primary)] border border-[var(--gray-200)] text-[var(--color-text-primary)]"
              >
                <option value="">None</option>
                {EXPERIENCE_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input label="Price Min" type="number" value={editForm.price_min ?? ""} onChange={(e) => setEditForm((f) => ({ ...f, price_min: e.target.value }))} />
              <Input label="Price Max" type="number" value={editForm.price_max ?? ""} onChange={(e) => setEditForm((f) => ({ ...f, price_max: e.target.value }))} />
            </div>
            <Input label="Duration (min)" type="number" value={editForm.duration_min ?? ""} onChange={(e) => setEditForm((f) => ({ ...f, duration_min: e.target.value }))} />
            <Input label="Image URL" value={editForm.image_url || ""} onChange={(e) => setEditForm((f) => ({ ...f, image_url: e.target.value }))} />
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setEditingExp(null)}>Cancel</Button>
          <Button variant="primary" icon={Save} loading={saving} onClick={saveEdit}>Save Changes</Button>
        </ModalFooter>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal open={!!deleteId} onClose={() => setDeleteId(null)} title="Delete Experience" size="sm" destructive>
        <ModalBody>
          <p className="text-sm text-[var(--color-text-secondary)]">
            Are you sure you want to permanently delete this experience? This action cannot be undone.
          </p>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setDeleteId(null)}>Cancel</Button>
          <Button variant="danger" icon={Trash2} loading={deleting} onClick={confirmDelete}>Delete</Button>
        </ModalFooter>
      </Modal>

      {/* Thumbnail Preview */}
      <ThumbnailPreview src={previewUrl} onClose={() => setPreviewUrl(null)} />
    </div>
  );
}

// ─── Card Pool Sub-View ──────────────────────────────────────────────────────

function CardPoolSubView() {
  const { addToast } = useToast();
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const [cards, setCards] = useState([]);
  const [cardCount, setCardCount] = useState(0);
  const [cardPage, setCardPage] = useState(0);
  const [cardSearch, setCardSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [cardTypeFilter, setCardTypeFilter] = useState("");
  const [cardActiveFilter, setCardActiveFilter] = useState("active");
  const [cardLoading, setCardLoading] = useState(true);
  const [cardError, setCardError] = useState(null);
  const [togglingId, setTogglingId] = useState(null);

  // Bulk selection
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkActioning, setBulkActioning] = useState(false);

  // Thumbnail preview
  const [previewUrl, setPreviewUrl] = useState(null);

  const searchTimerRef = useRef(null);

  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      setDebouncedSearch(cardSearch);
      setCardPage(0);
    }, SEARCH_DEBOUNCE_MS);
    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current); };
  }, [cardSearch]);

  const fetchCards = useCallback(async () => {
    setCardLoading(true);
    setCardError(null);
    try {
      let query = supabase
        .from("card_pool")
        .select("id, title, category, card_type, rating, review_count, popularity_score, served_count, last_served_at, is_active, price_min, price_max, lat, lng, image_url, created_at", { count: "exact" })
        .order("popularity_score", { ascending: false, nullsFirst: false })
        .range(cardPage * PAGE_SIZE, (cardPage + 1) * PAGE_SIZE - 1);

      if (debouncedSearch) query = query.ilike("title", `%${escapeLike(debouncedSearch)}%`);
      if (cardTypeFilter) query = query.eq("card_type", cardTypeFilter);
      if (cardActiveFilter === "active") query = query.eq("is_active", true);
      if (cardActiveFilter === "inactive") query = query.eq("is_active", false);

      const { data, count, error } = await query;
      if (error) throw error;
      if (!mountedRef.current) return;
      setCards(data || []);
      setCardCount(count ?? 0);
    } catch (err) {
      if (!mountedRef.current) return;
      setCardError(err.message);
      addToast({ variant: "error", title: "Failed to load card pool", description: err.message });
    } finally {
      if (mountedRef.current) setCardLoading(false);
    }
  }, [cardPage, debouncedSearch, cardTypeFilter, cardActiveFilter, addToast]);

  useEffect(() => { fetchCards(); }, [fetchCards]);

  const toggleCardActive = async (id, currentlyActive) => {
    setTogglingId(id);
    try {
      const { error } = await supabase.from("card_pool").update({ is_active: !currentlyActive }).eq("id", id);
      if (error) throw error;
      addToast({ variant: "success", title: currentlyActive ? "Card deactivated" : "Card reactivated" });
      logAdminAction("content.toggle_active", "card_pool", id, { is_active: !currentlyActive });
      setCards((prev) => prev.map((c) => c.id === id ? { ...c, is_active: !currentlyActive } : c));
    } catch (err) {
      addToast({ variant: "error", title: "Toggle failed", description: err.message });
    } finally {
      if (mountedRef.current) setTogglingId(null);
    }
  };

  // Bulk actions
  const handleBulkActivate = async () => {
    if (selectedIds.size === 0) return;
    setBulkActioning(true);
    try {
      const ids = [...selectedIds];
      const { error } = await supabase.from("card_pool").update({ is_active: true }).in("id", ids);
      if (error) throw error;
      addToast({ variant: "success", title: `${ids.length} card(s) activated` });
      ids.forEach(id => logAdminAction("content.toggle_active", "card_pool", id, { is_active: true }));
      setSelectedIds(new Set());
      fetchCards();
    } catch (err) {
      addToast({ variant: "error", title: "Bulk activate failed", description: err.message });
    } finally {
      setBulkActioning(false);
    }
  };

  const handleBulkDeactivate = async () => {
    if (selectedIds.size === 0) return;
    setBulkActioning(true);
    try {
      const ids = [...selectedIds];
      const { error } = await supabase.from("card_pool").update({ is_active: false }).in("id", ids);
      if (error) throw error;
      addToast({ variant: "success", title: `${ids.length} card(s) deactivated` });
      ids.forEach(id => logAdminAction("content.toggle_active", "card_pool", id, { is_active: false }));
      setSelectedIds(new Set());
      fetchCards();
    } catch (err) {
      addToast({ variant: "error", title: "Bulk deactivate failed", description: err.message });
    } finally {
      setBulkActioning(false);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    setBulkActioning(true);
    try {
      const ids = [...selectedIds];
      const { error } = await supabase.from("card_pool").delete().in("id", ids);
      if (error) throw error;
      addToast({ variant: "success", title: `${ids.length} card(s) deleted` });
      ids.forEach(id => logAdminAction("content.delete", "card_pool", id));
      setSelectedIds(new Set());
      fetchCards();
    } catch (err) {
      addToast({ variant: "error", title: "Bulk delete failed", description: err.message });
    } finally {
      setBulkActioning(false);
    }
  };

  const columns = [
    {
      key: "image_url",
      label: "",
      width: "50px",
      render: (_v, row) => row.image_url ? (
        <button onClick={() => setPreviewUrl(row.image_url)} className="cursor-pointer">
          <img src={row.image_url} alt="" className="w-10 h-10 rounded object-cover" />
        </button>
      ) : (
        <div className="w-10 h-10 rounded bg-[var(--gray-100)] flex items-center justify-center">
          <Image className="w-4 h-4 text-[var(--color-text-muted)]" />
        </div>
      ),
    },
    {
      key: "title",
      label: "Title",
      render: (_v, row) => (
        <span className="text-[var(--color-text-primary)] font-medium">{truncate(row.title, 45)}</span>
      ),
    },
    {
      key: "card_type",
      label: "Type",
      render: (_v, row) => (
        <Badge variant={row.card_type === "curated" ? "brand" : "info"}>
          {row.card_type || "single"}
        </Badge>
      ),
    },
    {
      key: "category",
      label: "Category",
      render: (_v, row) => row.category ? <Badge variant="default">{row.category}</Badge> : <span className="text-[var(--color-text-muted)]">—</span>,
    },
    {
      key: "rating",
      label: "Rating",
      render: (_v, row) => (
        <span className="text-[var(--color-text-secondary)] text-xs">
          {row.rating != null ? `★ ${Number(row.rating).toFixed(1)}` : "—"}
        </span>
      ),
    },
    {
      key: "popularity_score",
      label: "Popularity",
      render: (_v, row) => (
        <span className="text-[var(--color-text-secondary)] font-mono text-xs">
          {row.popularity_score != null ? Number(row.popularity_score).toFixed(2) : "—"}
        </span>
      ),
    },
    {
      key: "served_count",
      label: "Served",
      render: (_v, row) => (
        <span className="text-[var(--color-text-secondary)] font-mono text-xs">
          {row.served_count ?? 0}
        </span>
      ),
    },
    {
      key: "last_served_at",
      label: "Last Served",
      render: (_v, row) => (
        <span className="text-[var(--color-text-tertiary)] text-xs">
          {row.last_served_at ? timeAgo(row.last_served_at) : "Never"}
        </span>
      ),
    },
    {
      key: "is_active",
      label: "Status",
      render: (_v, row) => (
        <Badge variant={row.is_active ? "success" : "error"} dot>
          {row.is_active ? "Active" : "Inactive"}
        </Badge>
      ),
    },
    {
      key: "actions",
      label: "",
      width: "130px",
      render: (_v, row) => (
        <Button
          variant="ghost"
          size="sm"
          icon={row.is_active ? EyeOff : Eye}
          loading={togglingId === row.id}
          onClick={() => toggleCardActive(row.id, row.is_active)}
        >
          {row.is_active ? "Deactivate" : "Reactivate"}
        </Button>
      ),
    },
  ];

  const from = cardPage * PAGE_SIZE + 1;
  const to = Math.min((cardPage + 1) * PAGE_SIZE, cardCount);

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <SearchInput
          value={cardSearch}
          onChange={(e) => setCardSearch(e.target.value)}
          onClear={() => setCardSearch("")}
          placeholder="Search by title..."
          className="w-64"
        />
        <select
          value={cardTypeFilter}
          onChange={(e) => { setCardTypeFilter(e.target.value); setCardPage(0); }}
          className="h-10 px-3 rounded-lg text-sm bg-[var(--color-background-primary)] border border-[var(--gray-200)] text-[var(--color-text-primary)] cursor-pointer"
        >
          <option value="">All Types</option>
          <option value="single">Single</option>
          <option value="curated">Curated</option>
        </select>
        <select
          value={cardActiveFilter}
          onChange={(e) => { setCardActiveFilter(e.target.value); setCardPage(0); }}
          className="h-10 px-3 rounded-lg text-sm bg-[var(--color-background-primary)] border border-[var(--gray-200)] text-[var(--color-text-primary)] cursor-pointer"
        >
          <option value="all">All Status</option>
          <option value="active">Active Only</option>
          <option value="inactive">Inactive Only</option>
        </select>
        <Button variant="ghost" size="sm" icon={RefreshCw} onClick={fetchCards}>Refresh</Button>
        <span className="text-xs text-[var(--color-text-tertiary)] ml-auto">{cardCount} total</span>
      </div>

      {/* Bulk action bar */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-2 rounded-lg bg-[var(--color-brand-50,#fff7ed)] border border-[var(--color-brand-200)]">
          <span className="text-sm font-medium text-[var(--color-text-primary)]">{selectedIds.size} selected</span>
          <Button variant="secondary" size="sm" icon={Eye} loading={bulkActioning} onClick={handleBulkActivate}>Activate</Button>
          <Button variant="secondary" size="sm" icon={EyeOff} loading={bulkActioning} onClick={handleBulkDeactivate}>Deactivate</Button>
          <Button variant="danger" size="sm" icon={Trash2} loading={bulkActioning} onClick={handleBulkDelete}>Delete Selected</Button>
          <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())}>Clear</Button>
        </div>
      )}

      {/* Table */}
      <SectionCard noPadding>
        {cardError && !cardLoading ? (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <AlertCircle className="w-10 h-10 text-[#ef4444]" />
            <p className="text-sm text-[var(--color-text-primary)] font-medium">Failed to load card pool</p>
            <p className="text-xs text-[var(--color-text-tertiary)]">{cardError}</p>
            <Button variant="link" onClick={fetchCards}>Try again</Button>
          </div>
        ) : (
          <DataTable
            columns={columns}
            rows={cards}
            loading={cardLoading}
            emptyIcon={CreditCard}
            emptyMessage="No cards found"
            selectable
            selectedIds={selectedIds}
            onSelect={(id) => {
              setSelectedIds(prev => {
                const next = new Set(prev);
                if (next.has(id)) next.delete(id); else next.add(id);
                return next;
              });
            }}
            onSelectAll={(allSelected) => {
              if (allSelected) setSelectedIds(new Set());
              else setSelectedIds(new Set(cards.map(c => c.id)));
            }}
            pagination={{
              page: cardPage,
              pageSize: PAGE_SIZE,
              total: cardCount,
              from: cardCount > 0 ? from : 0,
              to,
              onChange: setCardPage,
            }}
          />
        )}
      </SectionCard>

      {/* Thumbnail Preview */}
      <ThumbnailPreview src={previewUrl} onClose={() => setPreviewUrl(null)} />
    </div>
  );
}

// ─── Place Reviews Sub-View ──────────────────────────────────────────────────

function ReviewsSubView() {
  const { addToast } = useToast();
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const [reviews, setReviews] = useState([]);
  const [reviewCount, setReviewCount] = useState(0);
  const [reviewPage, setReviewPage] = useState(0);
  const [reviewSearch, setReviewSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [expandedReview, setExpandedReview] = useState(null);
  const [reviewLoading, setReviewLoading] = useState(true);
  const [reviewError, setReviewError] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);

  // Moderation
  const [moderatingId, setModeratingId] = useState(null);

  const joinFailedRef = useRef(false);
  const searchTimerRef = useRef(null);

  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      setDebouncedSearch(reviewSearch);
      setReviewPage(0);
    }, SEARCH_DEBOUNCE_MS);
    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current); };
  }, [reviewSearch]);

  const fetchReviews = useCallback(async () => {
    setReviewLoading(true);
    setReviewError(null);
    try {
      let data, count;

      if (!joinFailedRef.current) {
        let query = supabase
          .from("place_reviews")
          .select("*, reviewer:profiles!place_reviews_user_id_fkey(display_name, email)", { count: "exact" })
          .order("created_at", { ascending: false })
          .range(reviewPage * PAGE_SIZE, (reviewPage + 1) * PAGE_SIZE - 1);

        if (debouncedSearch) query = query.ilike("place_name", `%${escapeLike(debouncedSearch)}%`);

        const result = await query;
        if (result.error) {
          joinFailedRef.current = true;
        } else {
          data = result.data;
          count = result.count;
        }
      }

      if (joinFailedRef.current || data === undefined) {
        let query = supabase
          .from("place_reviews")
          .select("*", { count: "exact" })
          .order("created_at", { ascending: false })
          .range(reviewPage * PAGE_SIZE, (reviewPage + 1) * PAGE_SIZE - 1);

        if (debouncedSearch) query = query.ilike("place_name", `%${escapeLike(debouncedSearch)}%`);

        const result = await query;
        if (result.error) throw result.error;
        data = result.data || [];
        count = result.count;

        const userIds = [...new Set(data.filter((r) => r.user_id).map((r) => r.user_id))];
        if (userIds.length > 0) {
          const { data: profiles } = await supabase.from("profiles").select("id, display_name, email").in("id", userIds);
          const profileMap = {};
          (profiles || []).forEach((p) => { profileMap[p.id] = p; });
          data = data.map((r) => ({ ...r, reviewer: profileMap[r.user_id] || null }));
        }
      }

      if (!mountedRef.current) return;
      setReviews(data || []);
      setReviewCount(count ?? 0);
    } catch (err) {
      if (!mountedRef.current) return;
      setReviewError(err.message);
      addToast({ variant: "error", title: "Failed to load reviews", description: err.message });
    } finally {
      if (mountedRef.current) setReviewLoading(false);
    }
  }, [reviewPage, debouncedSearch, addToast]);

  useEffect(() => { fetchReviews(); }, [fetchReviews]);

  const deleteReview = async (id) => {
    setDeletingId(id);
    try {
      const { error } = await supabase.from("place_reviews").delete().eq("id", id);
      if (error) throw error;
      addToast({ variant: "success", title: "Review deleted" });
      logAdminAction("content.delete", "place_review", id);
      setDeleteConfirmId(null);
      if (expandedReview === id) setExpandedReview(null);
      fetchReviews();
    } catch (err) {
      addToast({ variant: "error", title: "Delete failed", description: err.message });
    } finally {
      if (mountedRef.current) setDeletingId(null);
    }
  };

  // Moderation actions
  const setModerationStatus = async (id, status) => {
    setModeratingId(id);
    try {
      const { error } = await supabase.from("place_reviews").update({ moderation_status: status }).eq("id", id);
      if (error) throw error;
      addToast({ variant: "success", title: `Review ${status}` });
      logAdminAction("content.edit", "place_review", id, { moderation_status: status });
      setReviews((prev) => prev.map((r) => r.id === id ? { ...r, moderation_status: status } : r));
    } catch (err) {
      addToast({ variant: "error", title: "Moderation failed", description: err.message });
    } finally {
      if (mountedRef.current) setModeratingId(null);
    }
  };

  const columns = [
    {
      key: "place_name",
      label: "Place",
      render: (_v, row) => (
        <span className="text-[var(--color-text-primary)] font-medium">{truncate(row.place_name, 35)}</span>
      ),
    },
    {
      key: "reviewer",
      label: "Reviewer",
      render: (_v, row) => (
        <span className="text-[var(--color-text-secondary)] text-xs">
          {row.reviewer?.display_name || row.reviewer?.email || "Unknown"}
        </span>
      ),
    },
    {
      key: "rating",
      label: "Rating",
      render: (_v, row) => (
        <span className="text-yellow-400 text-xs tracking-wide">{renderStars(row.rating)}</span>
      ),
    },
    {
      key: "created_at",
      label: "Date",
      render: (_v, row) => <span className="text-[var(--color-text-tertiary)] text-xs">{timeAgo(row.created_at)}</span>,
    },
    {
      key: "moderation",
      label: "Moderation",
      render: (_v, row) => {
        const isLoading = moderatingId === row.id;
        return (
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" icon={CheckCircle} loading={isLoading} onClick={() => setModerationStatus(row.id, "approved")} title="Approve" />
            <Button variant="ghost" size="sm" icon={XCircle} loading={isLoading} onClick={() => setModerationStatus(row.id, "rejected")} title="Reject" className="text-[#ef4444]" />
            <Button variant="ghost" size="sm" icon={Flag} loading={isLoading} onClick={() => setModerationStatus(row.id, "flagged")} title="Flag" className="text-[#f59e0b]" />
          </div>
        );
      },
    },
    {
      key: "actions",
      label: "",
      width: "110px",
      render: (_v, row) => (
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" icon={expandedReview === row.id ? ChevronUp : ChevronDown} onClick={() => setExpandedReview(expandedReview === row.id ? null : row.id)} />
          <Button variant="ghost" size="sm" icon={Trash2} onClick={() => setDeleteConfirmId(row.id)} className="text-[#ef4444] hover:text-[#ef4444]" />
        </div>
      ),
    },
  ];

  const from = reviewPage * PAGE_SIZE + 1;
  const to = Math.min((reviewPage + 1) * PAGE_SIZE, reviewCount);
  const expandedData = expandedReview ? reviews.find((r) => r.id === expandedReview) : null;

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <SearchInput
          value={reviewSearch}
          onChange={(e) => setReviewSearch(e.target.value)}
          onClear={() => setReviewSearch("")}
          placeholder="Search by place name..."
          className="w-64"
        />
        <Button variant="ghost" size="sm" icon={RefreshCw} onClick={fetchReviews}>Refresh</Button>
        <span className="text-xs text-[var(--color-text-tertiary)] ml-auto">{reviewCount} total</span>
      </div>

      {/* Table */}
      <SectionCard noPadding>
        {reviewError && !reviewLoading ? (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <AlertCircle className="w-10 h-10 text-[#ef4444]" />
            <p className="text-sm text-[var(--color-text-primary)] font-medium">Failed to load reviews</p>
            <p className="text-xs text-[var(--color-text-tertiary)]">{reviewError}</p>
            <Button variant="link" onClick={fetchReviews}>Try again</Button>
          </div>
        ) : (
          <DataTable
            columns={columns}
            rows={reviews}
            loading={reviewLoading}
            emptyIcon={Star}
            emptyMessage="No reviews found"
            pagination={{
              page: reviewPage,
              pageSize: PAGE_SIZE,
              total: reviewCount,
              from: reviewCount > 0 ? from : 0,
              to,
              onChange: setReviewPage,
            }}
          />
        )}
      </SectionCard>

      {/* Expanded Review Panel */}
      {expandedData && (
        <SectionCard>
          <div className="space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-base font-semibold text-[var(--color-text-primary)]">
                  {expandedData.place_name || "Unknown Place"} — {renderStars(expandedData.rating)} ({expandedData.rating ?? "?"}/5)
                </h3>
                <p className="text-xs text-[var(--color-text-tertiary)] mt-0.5">
                  By: {expandedData.reviewer?.display_name || expandedData.reviewer?.email || "Unknown"} · {formatDate(expandedData.created_at)}
                </p>
              </div>
              <Button variant="ghost" size="sm" icon={X} onClick={() => setExpandedReview(null)} />
            </div>

            {expandedData.feedback_text && (
              <div>
                <h4 className="text-xs font-medium text-[var(--color-text-secondary)] mb-1">Feedback</h4>
                <p className="text-sm text-[var(--color-text-primary)] bg-[var(--color-background-secondary)] rounded-lg p-3">
                  {expandedData.feedback_text}
                </p>
              </div>
            )}

            <div className="pt-2 border-t border-[var(--gray-200)]">
              <Button variant="danger" size="sm" icon={Trash2} loading={deletingId === expandedData.id} onClick={() => setDeleteConfirmId(expandedData.id)}>
                Delete Review
              </Button>
            </div>
          </div>
        </SectionCard>
      )}

      {/* Delete Confirmation Modal */}
      <Modal open={!!deleteConfirmId} onClose={() => setDeleteConfirmId(null)} title="Delete Review" size="sm" destructive>
        <ModalBody>
          <p className="text-sm text-[var(--color-text-secondary)]">
            Are you sure you want to permanently delete this review? This action cannot be undone.
          </p>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setDeleteConfirmId(null)}>Cancel</Button>
          <Button variant="danger" icon={Trash2} loading={deletingId === deleteConfirmId} onClick={() => deleteReview(deleteConfirmId)}>Delete</Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}

// ─── Curated Places Cache Sub-View ───────────────────────────────────────────

function CuratedSubView() {
  const { addToast } = useToast();
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const [cache, setCache] = useState([]);
  const [cacheLoading, setCacheLoading] = useState(true);
  const [cacheError, setCacheError] = useState(null);
  const [deletingKey, setDeletingKey] = useState(null);
  const [clearAllModal, setClearAllModal] = useState(false);
  const [clearing, setClearing] = useState(false);

  const fetchCache = useCallback(async () => {
    setCacheLoading(true);
    setCacheError(null);
    try {
      const { data, error } = await supabase
        .from("curated_places_cache")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      if (!mountedRef.current) return;
      setCache(data || []);
    } catch (err) {
      if (!mountedRef.current) return;
      setCacheError(err.message);
      addToast({ variant: "error", title: "Failed to load cache", description: err.message });
    } finally {
      if (mountedRef.current) setCacheLoading(false);
    }
  }, [addToast]);

  useEffect(() => { fetchCache(); }, [fetchCache]);

  const deleteCacheEntry = async (locationKey, radiusM) => {
    const compositeKey = `${locationKey}:${radiusM}`;
    setDeletingKey(compositeKey);
    try {
      const { error } = await supabase
        .from("curated_places_cache")
        .delete()
        .eq("location_key", locationKey)
        .eq("radius_m", radiusM);
      if (error) throw error;
      addToast({ variant: "success", title: "Cache entry deleted" });
      logAdminAction("content.delete", "curated_places_cache", compositeKey);
      setCache((prev) => prev.filter((c) => !(c.location_key === locationKey && c.radius_m === radiusM)));
    } catch (err) {
      addToast({ variant: "error", title: "Delete failed", description: err.message });
    } finally {
      if (mountedRef.current) setDeletingKey(null);
    }
  };

  const clearAllCache = async () => {
    setClearing(true);
    try {
      const { error } = await supabase
        .from("curated_places_cache")
        .delete()
        .gte("created_at", "1970-01-01T00:00:00Z");
      if (error) throw error;
      addToast({ variant: "success", title: "All cache entries cleared" });
      logAdminAction("content.delete", "curated_places_cache", "all");
      setCache([]);
      setClearAllModal(false);
    } catch (err) {
      addToast({ variant: "error", title: "Clear failed", description: err.message });
    } finally {
      if (mountedRef.current) setClearing(false);
    }
  };

  const columns = [
    {
      key: "location_key",
      label: "Location Key",
      render: (_v, row) => (
        <span className="text-[var(--color-text-primary)] font-mono text-xs">{truncate(row.location_key, 40)}</span>
      ),
    },
    {
      key: "radius_m",
      label: "Radius",
      render: (_v, row) => (
        <span className="text-[var(--color-text-secondary)]">{row.radius_m != null ? `${row.radius_m}m` : "—"}</span>
      ),
    },
    {
      key: "categories",
      label: "Categories",
      render: (_v, row) => {
        const { categories } = countCategoryPlaces(row.category_places);
        return <span className="text-[var(--color-text-secondary)] font-mono text-xs">{categories}</span>;
      },
    },
    {
      key: "places",
      label: "Places",
      render: (_v, row) => {
        const { places } = countCategoryPlaces(row.category_places);
        return <span className="text-[var(--color-text-secondary)] font-mono text-xs">{places}</span>;
      },
    },
    {
      key: "created_at",
      label: "Created",
      render: (_v, row) => <span className="text-[var(--color-text-tertiary)] text-xs">{formatDate(row.created_at)}</span>,
    },
    {
      key: "age",
      label: "Age",
      render: (_v, row) => <span className="text-[var(--color-text-tertiary)] text-xs">{timeAgo(row.created_at)}</span>,
    },
    {
      key: "actions",
      label: "",
      width: "80px",
      render: (_v, row) => {
        const compositeKey = `${row.location_key}:${row.radius_m}`;
        return (
          <Button
            variant="ghost"
            size="sm"
            icon={Trash2}
            loading={deletingKey === compositeKey}
            onClick={() => deleteCacheEntry(row.location_key, row.radius_m)}
            className="text-[#ef4444] hover:text-[#ef4444]"
          />
        );
      },
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="sm" icon={RefreshCw} onClick={fetchCache}>Refresh</Button>
        <Button variant="danger" size="sm" icon={Trash2} onClick={() => setClearAllModal(true)} disabled={cache.length === 0}>
          Clear All Cache
        </Button>
        <span className="text-xs text-[var(--color-text-tertiary)] ml-auto">{cache.length} entries</span>
      </div>

      <SectionCard noPadding>
        {cacheError && !cacheLoading ? (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <AlertCircle className="w-10 h-10 text-[#ef4444]" />
            <p className="text-sm text-[var(--color-text-primary)] font-medium">Failed to load cache</p>
            <p className="text-xs text-[var(--color-text-tertiary)]">{cacheError}</p>
            <Button variant="link" onClick={fetchCache}>Try again</Button>
          </div>
        ) : (
          <DataTable
            columns={columns}
            rows={cache.map((c) => ({ ...c, _key: `${c.location_key}:${c.radius_m}` }))}
            loading={cacheLoading}
            emptyIcon={Database}
            emptyMessage="No cache entries"
          />
        )}
      </SectionCard>

      <Modal open={clearAllModal} onClose={() => setClearAllModal(false)} title="Clear All Cache" size="sm" destructive>
        <ModalBody>
          <p className="text-sm text-[var(--color-text-secondary)]">
            This will permanently delete all {cache.length} curated places cache entries. This action cannot be undone.
          </p>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setClearAllModal(false)}>Cancel</Button>
          <Button variant="danger" icon={Trash2} loading={clearing} onClick={clearAllCache}>Clear All</Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}

// ─── Main Content Moderation Page ────────────────────────────────────────────

export function ContentModerationPage() {
  const [activeSubTab, setActiveSubTab] = useState("experiences");

  return (
    <div className="flex flex-col gap-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">Content</h1>
      </div>

      {/* Sub-tab navigation */}
      <Tabs tabs={SUB_TABS} activeTab={activeSubTab} onChange={setActiveSubTab} />

      {/* Sub-view */}
      {activeSubTab === "experiences" && <ExperiencesSubView />}
      {activeSubTab === "cardpool" && <CardPoolSubView />}
      {activeSubTab === "reviews" && <ReviewsSubView />}
      {activeSubTab === "curated" && <CuratedSubView />}
    </div>
  );
}
