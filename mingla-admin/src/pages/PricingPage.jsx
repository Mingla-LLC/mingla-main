// ORCH-1006 [Universal all-in pricing engine] — admin Mingla take-rate screen.
//
// The single highest-stakes lever in the product: how much Mingla earns on
// every transaction. Built per DESIGN_ORCH-1006_ADMIN_TAKE_RATE_SCREEN.md —
// a dedicated /pricing page (NOT a Settings tab), a global default + a
// per-brand override exception list, every persist double-gated through an
// explicit before->after confirm, all writes audited to admin_audit_log.
//
// Stack: React 19 + Vite + Tailwind v4 (CSS-variable theme tokens, light+dark
// for free). Reuses the verified admin UI kit + the persist lib in
// src/lib/pricing.js (shipped in the foundation pass). No new external API —
// only Supabase RPCs (admin_get_pricing_config / admin_set_platform_take_rate
// / admin_set_brand_take_rate_override / admin_clear_brand_take_rate_override),
// each admin-gated server-side via is_admin_user().
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Percent, Clock, Plus, Layers, MoreHorizontal } from "lucide-react";

import { SectionCard, AlertCard } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Badge } from "../components/ui/Badge";
import { DataTable } from "../components/ui/Table";
import { Modal, ModalBody, ModalFooter } from "../components/ui/Modal";
import { Skeleton } from "../components/ui/Skeleton";
import { useToast } from "../context/ToastContext";
import { useAuth } from "../context/AuthContext";
import { logAdminAction } from "../lib/auditLog";
import { formatDate } from "../lib/formatters";
import { supabase } from "../lib/supabase";
import {
  getPricingConfig,
  setGlobalDefault,
  setBrandOverride,
  clearBrandOverride,
  bpsToPct,
  pctToBps,
  formatPct,
  validatePctInput,
} from "../lib/pricing";

// ── helpers ──────────────────────────────────────────────────────────────
// Resolve an updated_by auth uid to a friendly label (design §8). The seed
// row (null) reads "system default".
function actorLabel(updatedBy, currentUserId) {
  if (!updatedBy) return "system default";
  if (currentUserId && updatedBy === currentUserId) return "you";
  return "an admin";
}

export function PricingPage() {
  const { addToast } = useToast();
  const { session } = useAuth();
  const currentUserId = session?.user?.id ?? null;
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // ── config state ─────────────────────────────────────────────────────
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [config, setConfig] = useState(null); // { default_take_rate_bps, default_updated_at, default_updated_by, overrides:[] }

  // ── global-default field state ───────────────────────────────────────
  const [defaultInput, setDefaultInput] = useState("");
  const [defaultError, setDefaultError] = useState(null);

  // ── confirm-dialog state (one of: null | global | add | edit | remove) ─
  const [confirm, setConfirm] = useState(null); // { type, brandId?, brandName?, oldBps, newBps }
  const [submitting, setSubmitting] = useState(false);

  // ── add/edit override modal state ────────────────────────────────────
  const [overrideModal, setOverrideModal] = useState(null); // { mode:"add"|"edit", brandId?, brandName? }
  const [brandQuery, setBrandQuery] = useState("");
  const [brands, setBrands] = useState([]); // all brands for the picker
  const [brandsLoading, setBrandsLoading] = useState(false);
  const [pickedBrand, setPickedBrand] = useState(null); // { id, name, slug }
  const [overrideInput, setOverrideInput] = useState("");
  const [overrideError, setOverrideError] = useState(null);

  // ── row action menu (which row's ⋯ menu is open) ─────────────────────
  const [openMenuId, setOpenMenuId] = useState(null);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await getPricingConfig();
      if (!mountedRef.current) return;
      setConfig(data);
      setDefaultInput(bpsToPct(data?.default_take_rate_bps ?? 0));
    } catch (err) {
      if (!mountedRef.current) return;
      setLoadError(err.message || "Could not load pricing config.");
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  const defaultBps = config?.default_take_rate_bps ?? null;
  const defaultPct = defaultBps == null ? "0.00" : bpsToPct(defaultBps);

  // ── global default: dirty + valid gating ─────────────────────────────
  const defaultDirty = defaultInput !== defaultPct;
  const defaultValidationError = validatePctInput(defaultInput);
  const defaultCanSave = defaultDirty && defaultValidationError === null && !submitting;

  const onDefaultChange = (e) => {
    const raw = e.target.value;
    setDefaultInput(raw);
    setDefaultError(validatePctInput(raw));
  };

  const onSaveDefaultClick = () => {
    const err = validatePctInput(defaultInput);
    if (err) {
      setDefaultError(err);
      return;
    }
    setConfirm({
      type: "global",
      oldBps: defaultBps ?? 0,
      newBps: pctToBps(defaultInput),
    });
  };

  // ── brand picker (lazy load on modal open) ───────────────────────────
  const loadBrands = useCallback(async () => {
    setBrandsLoading(true);
    try {
      const { data, error } = await supabase
        .from("brands")
        .select("id, name, slug")
        .order("name", { ascending: true });
      if (error) throw new Error(error.message);
      if (mountedRef.current) setBrands(Array.isArray(data) ? data : []);
    } catch (err) {
      if (mountedRef.current) {
        addToast({
          variant: "error",
          title: "Couldn't load brands",
          description: err.message || "Try again.",
        });
      }
    } finally {
      if (mountedRef.current) setBrandsLoading(false);
    }
  }, [addToast]);

  const openAddOverride = () => {
    setOverrideModal({ mode: "add" });
    setPickedBrand(null);
    setOverrideInput("");
    setOverrideError(null);
    setBrandQuery("");
    if (brands.length === 0) loadBrands();
  };

  const openEditOverride = (row) => {
    setOpenMenuId(null);
    setOverrideModal({ mode: "edit", brandId: row.brand_id, brandName: row.brand_name });
    setPickedBrand({ id: row.brand_id, name: row.brand_name, slug: row.slug });
    setOverrideInput(bpsToPct(row.take_rate_bps_override ?? 0));
    setOverrideError(null);
  };

  const overriddenBrandIds = useMemo(
    () => new Set((config?.overrides ?? []).map((o) => o.brand_id)),
    [config],
  );

  const filteredBrands = useMemo(() => {
    const q = brandQuery.trim().toLowerCase();
    if (!q) return brands.slice(0, 50);
    return brands
      .filter(
        (b) =>
          (b.name ?? "").toLowerCase().includes(q) ||
          (b.slug ?? "").toLowerCase().includes(q),
      )
      .slice(0, 50);
  }, [brands, brandQuery]);

  const overrideValidationError = validatePctInput(overrideInput);
  const overrideCanContinue =
    pickedBrand !== null && overrideValidationError === null && !submitting;

  const onOverrideContinue = () => {
    const err = validatePctInput(overrideInput);
    if (err || !pickedBrand) {
      setOverrideError(err);
      return;
    }
    const existing = (config?.overrides ?? []).find(
      (o) => o.brand_id === pickedBrand.id,
    );
    setConfirm({
      type: overrideModal.mode === "edit" ? "edit" : "add",
      brandId: pickedBrand.id,
      brandName: pickedBrand.name,
      oldBps: existing?.take_rate_bps_override ?? null,
      newBps: pctToBps(overrideInput),
    });
  };

  const onRemoveClick = (row) => {
    setOpenMenuId(null);
    setConfirm({
      type: "remove",
      brandId: row.brand_id,
      brandName: row.brand_name,
      oldBps: row.take_rate_bps_override ?? null,
      newBps: null,
    });
  };

  // ── confirmed persist (pessimistic: await server, then re-read) ──────
  const onConfirmPersist = async () => {
    if (!confirm) return;
    setSubmitting(true);
    try {
      if (confirm.type === "global") {
        await setGlobalDefault(confirm.newBps);
        await logAdminAction("pricing.update", "platform_take_rate", "global", {
          old_bps: confirm.oldBps,
          new_bps: confirm.newBps,
        });
        addToast({
          variant: "success",
          title: "Take-rate updated",
          description: "Applies to all future sales.",
        });
      } else if (confirm.type === "add" || confirm.type === "edit") {
        await setBrandOverride(confirm.brandId, confirm.newBps);
        await logAdminAction("pricing.update", "brand_take_rate", confirm.brandId, {
          old_bps: confirm.oldBps,
          new_bps: confirm.newBps,
        });
        addToast({
          variant: "success",
          title: "Override saved",
          description: "Applies to this brand's future sales.",
        });
        setOverrideModal(null);
      } else if (confirm.type === "remove") {
        await clearBrandOverride(confirm.brandId);
        await logAdminAction("pricing.clear", "brand_take_rate", confirm.brandId, {
          old_bps: confirm.oldBps,
          new_bps: null,
        });
        addToast({
          variant: "success",
          title: "Override removed",
          description: "This brand is back on the default rate.",
        });
      }
      setConfirm(null);
      await loadConfig();
    } catch (err) {
      // Fail loud, keep prior value (Constitution #3) — do NOT close the
      // confirm as if it succeeded; surface the server error.
      addToast({
        variant: "error",
        title: "Couldn't save",
        description: err.message || "Try again.",
      });
    } finally {
      if (mountedRef.current) setSubmitting(false);
    }
  };

  // ── override table rows + columns ────────────────────────────────────
  const overrideRows = (config?.overrides ?? []).map((o) => ({
    id: o.brand_id,
    brand_id: o.brand_id,
    brand_name: o.brand_name,
    slug: o.slug,
    take_rate_bps_override: o.take_rate_bps_override,
    updated_at: o.updated_at,
  }));

  const columns = [
    {
      key: "brand_name",
      label: "Brand",
      render: (_v, row) => (
        <div className="flex flex-col">
          <span className="font-medium text-[var(--color-text-primary)]">
            {row.brand_name}
          </span>
          {row.slug && (
            <span className="text-xs text-[var(--color-text-tertiary)]">
              {row.slug}
            </span>
          )}
        </div>
      ),
    },
    {
      key: "take_rate_bps_override",
      label: "Effective rate",
      render: (v) => (
        <span className="tabular-nums font-semibold text-[var(--color-text-primary)]">
          {formatPct(v)}
        </span>
      ),
    },
    {
      key: "source",
      label: "Source",
      render: () => <Badge variant="brand">Override</Badge>,
    },
    {
      key: "updated_at",
      label: "Last changed",
      render: (v) =>
        v ? (
          <span className="text-[var(--color-text-secondary)]">
            {formatDate(v)}
          </span>
        ) : (
          <span className="text-[var(--color-text-muted)]">&mdash;</span>
        ),
    },
    {
      key: "actions",
      label: "",
      width: "56px",
      render: (_v, row) => (
        <div className="relative flex justify-end">
          <Button
            variant="ghost"
            size="sm"
            icon={MoreHorizontal}
            aria-label={`Actions for ${row.brand_name}`}
            onClick={() =>
              setOpenMenuId((cur) => (cur === row.brand_id ? null : row.brand_id))
            }
          />
          {openMenuId === row.brand_id && (
            <div
              className="absolute right-0 top-9 z-20 min-w-[160px] rounded-lg border border-[var(--gray-200)] bg-[var(--color-background-primary)] shadow-[var(--shadow-lg)] py-1"
              role="menu"
            >
              <button
                role="menuitem"
                onClick={() => openEditOverride(row)}
                className="block w-full text-left px-3 py-2 text-sm text-[var(--color-text-primary)] hover:bg-[var(--gray-100)] cursor-pointer"
              >
                Edit rate
              </button>
              <button
                role="menuitem"
                onClick={() => onRemoveClick(row)}
                className="block w-full text-left px-3 py-2 text-sm text-[#b91c1c] hover:bg-[var(--gray-100)] cursor-pointer"
              >
                Remove override
              </button>
            </div>
          )}
        </div>
      ),
    },
  ];

  // ── confirm dialog copy (design §9 — EXACT, load-bearing money safety) ─
  const confirmCopy = (() => {
    if (!confirm) return null;
    const NEW = formatPct(confirm.newBps);
    const OLD = formatPct(confirm.oldBps);
    const DEFAULT = formatPct(defaultBps);
    const BRAND = confirm.brandName;
    if (confirm.type === "global") {
      return {
        variant: "warning",
        title: "Change Mingla's default take-rate?",
        body: `Mingla will earn ${NEW} on every sale, up from ${OLD}. This applies to all brands on the default — and to every future sale, the moment you confirm. Orders already placed keep the rate they were sold at.`,
        confirmLabel: `Change to ${NEW}`,
        cancelLabel: `Keep ${OLD}`,
        confirmVariant: "primary",
      };
    }
    if (confirm.type === "add") {
      return {
        variant: "warning",
        title: `Put ${BRAND} on a custom rate?`,
        body: `${BRAND} will be charged ${NEW} on all future sales, instead of the ${DEFAULT} default. Orders already placed are unaffected.`,
        confirmLabel: `Set ${NEW}`,
        cancelLabel: "Cancel",
        confirmVariant: "primary",
      };
    }
    if (confirm.type === "edit") {
      return {
        variant: "warning",
        title: `Change ${BRAND}'s take-rate?`,
        body: `Mingla will earn ${NEW} on ${BRAND}'s future sales, up from ${OLD}. Orders already placed keep the rate they were sold at.`,
        confirmLabel: `Set ${NEW}`,
        cancelLabel: "Cancel",
        confirmVariant: "primary",
      };
    }
    // remove
    return {
      variant: "info",
      title: `Remove ${BRAND}'s override?`,
      body: `${BRAND} will go back to the ${DEFAULT} default rate on all future sales. Orders already placed are unaffected. You can add an override again any time.`,
      confirmLabel: `Revert to ${DEFAULT}`,
      cancelLabel: "Keep override",
      confirmVariant: "secondary",
    };
  })();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">
          Pricing
        </h1>
        <p className="text-sm text-[var(--color-text-secondary)] mt-1">
          Set Mingla's cut of every transaction.
        </p>
      </div>

      {loadError ? (
        <AlertCard
          variant="error"
          title="Couldn't load pricing"
          action={
            <Button variant="secondary" size="sm" onClick={loadConfig}>
              Retry
            </Button>
          }
        >
          {loadError}
        </AlertCard>
      ) : null}

      {/* ── Card A: Global default ──────────────────────────────────── */}
      <SectionCard title="Mingla platform take-rate">
        {loading ? (
          <div className="flex flex-col gap-3">
            <Skeleton width="160px" height="56px" />
            <Skeleton width="320px" height="16px" />
            <Skeleton width="200px" height="14px" />
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex items-end gap-2">
              <div className="w-32">
                <Input
                  inputMode="decimal"
                  value={defaultInput}
                  onChange={onDefaultChange}
                  error={defaultError}
                  className="!h-14 !text-3xl text-right tabular-nums"
                  aria-label="Mingla platform take-rate, percent"
                />
              </div>
              <span
                aria-hidden="true"
                className="select-none text-3xl font-semibold text-[var(--color-text-tertiary)] pb-2"
              >
                %
              </span>
            </div>
            <p className="text-sm text-[var(--color-text-secondary)] max-w-xl">
              Mingla's cut of every sale, across all brands. This is what Mingla
              earns — separate from the service fee a brand may add to cover
              card-processing cost.
            </p>
            <div className="flex items-center gap-1.5 text-xs text-[var(--color-text-tertiary)]">
              <Clock className="w-3.5 h-3.5" />
              <span>
                {config?.default_updated_at
                  ? `Last changed by ${actorLabel(
                      config.default_updated_by,
                      currentUserId,
                    )} · ${formatDate(config.default_updated_at)}`
                  : `System default (${defaultPct}%)`}
              </span>
            </div>
            <div>
              <Button
                variant="primary"
                disabled={!defaultCanSave}
                onClick={onSaveDefaultClick}
                aria-label="Save default take-rate"
              >
                Save default
              </Button>
            </div>
          </div>
        )}
      </SectionCard>

      {/* ── Card B: Per-brand overrides ─────────────────────────────── */}
      <SectionCard
        title="Brand overrides"
        action={
          <Button
            variant="secondary"
            size="sm"
            icon={Plus}
            onClick={openAddOverride}
            aria-label="Add a brand override"
          >
            Add override
          </Button>
        }
      >
        <p className="text-sm text-[var(--color-text-secondary)] mb-4">
          Put a specific brand on a custom rate. Brands without an override use
          the default above.
        </p>
        <DataTable
          columns={columns}
          rows={overrideRows}
          loading={loading}
          emptyIcon={Layers}
          emptyMessage="No brand overrides yet. Every brand uses the default rate above."
          emptyAction={
            <Button
              variant="secondary"
              size="sm"
              icon={Plus}
              onClick={openAddOverride}
            >
              Add override
            </Button>
          }
        />
      </SectionCard>

      {/* ── Add / Edit override modal ───────────────────────────────── */}
      <Modal
        open={overrideModal !== null}
        onClose={() => setOverrideModal(null)}
        title={
          overrideModal?.mode === "edit" ? "Edit override" : "Add brand override"
        }
        size="md"
      >
        <ModalBody>
          <div className="flex flex-col gap-4">
            {overrideModal?.mode === "edit" ? (
              <div className="rounded-lg border border-[var(--gray-200)] px-3 py-2">
                <span className="text-sm font-medium text-[var(--color-text-primary)]">
                  {pickedBrand?.name}
                </span>
                {pickedBrand?.slug && (
                  <span className="block text-xs text-[var(--color-text-tertiary)]">
                    {pickedBrand.slug}
                  </span>
                )}
              </div>
            ) : (
              <div>
                <Input
                  label="Brand"
                  placeholder="Search brands…"
                  value={brandQuery}
                  onChange={(e) => setBrandQuery(e.target.value)}
                  aria-label="Search brands"
                />
                <div className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-[var(--gray-200)]">
                  {brandsLoading ? (
                    <div className="p-3 text-sm text-[var(--color-text-tertiary)]">
                      Loading brands…
                    </div>
                  ) : filteredBrands.length === 0 ? (
                    <div className="p-3 text-sm text-[var(--color-text-tertiary)]">
                      No brands match.
                    </div>
                  ) : (
                    filteredBrands.map((b) => {
                      const already = overriddenBrandIds.has(b.id);
                      const selected = pickedBrand?.id === b.id;
                      return (
                        <button
                          key={b.id}
                          disabled={already}
                          onClick={() =>
                            setPickedBrand({ id: b.id, name: b.name, slug: b.slug })
                          }
                          className={[
                            "flex w-full items-center justify-between px-3 py-2 text-left text-sm",
                            already
                              ? "opacity-50 cursor-not-allowed"
                              : "cursor-pointer hover:bg-[var(--gray-100)]",
                            selected ? "bg-[var(--color-brand-50)]" : "",
                          ].join(" ")}
                        >
                          <span className="flex flex-col">
                            <span className="text-[var(--color-text-primary)]">
                              {b.name}
                            </span>
                            {b.slug && (
                              <span className="text-xs text-[var(--color-text-tertiary)]">
                                {b.slug}
                              </span>
                            )}
                          </span>
                          {already && (
                            <Badge variant="default">Already overridden</Badge>
                          )}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            )}

            <div className="flex items-end gap-2">
              <div className="w-32">
                <Input
                  label="This brand's take-rate"
                  inputMode="decimal"
                  value={overrideInput}
                  onChange={(e) => {
                    setOverrideInput(e.target.value);
                    setOverrideError(validatePctInput(e.target.value));
                  }}
                  error={overrideError}
                  className="!h-12 !text-2xl text-right tabular-nums"
                  aria-label="This brand's take-rate, percent"
                />
              </div>
              <span
                aria-hidden="true"
                className="select-none text-2xl font-semibold text-[var(--color-text-tertiary)] pb-2"
              >
                %
              </span>
            </div>
            <p className="text-xs text-[var(--color-text-tertiary)]">
              Default is {defaultPct}%. To put this brand back on the default,
              remove the override.
            </p>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setOverrideModal(null)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!overrideCanContinue}
            onClick={onOverrideContinue}
          >
            Continue
          </Button>
        </ModalFooter>
      </Modal>

      {/* ── Confirm dialog (every persist is double-gated) ──────────── */}
      <Modal
        open={confirm !== null}
        onClose={() => (submitting ? null : setConfirm(null))}
        title={confirmCopy?.title ?? ""}
        size="sm"
      >
        {confirmCopy && (
          <>
            <ModalBody>
              <AlertCard variant={confirmCopy.variant}>
                {confirmCopy.body}
              </AlertCard>
            </ModalBody>
            <ModalFooter>
              <Button
                variant="ghost"
                disabled={submitting}
                onClick={() => setConfirm(null)}
              >
                {confirmCopy.cancelLabel}
              </Button>
              <Button
                variant={confirmCopy.confirmVariant}
                loading={submitting}
                disabled={submitting}
                onClick={onConfirmPersist}
              >
                {confirmCopy.confirmLabel}
              </Button>
            </ModalFooter>
          </>
        )}
      </Modal>
    </div>
  );
}
