import { useState, useCallback, useEffect, useSyncExternalStore } from "react";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { HEADER_PAGE_ITEMS, NAV_ITEMS } from "../../lib/constants";
import { useAuth } from "../../context/AuthContext";
import { pageTitle } from "../../lib/access";
import { DraftCountProvider, useDraftCounts } from "../../hooks/useDraftCounts";
import { AlertCard } from "../ui/Card";
import { tabCeiling } from "../../lib/requestCeiling";

export const CEILING_BANNER_TEXT = "Admin paused refreshing for a minute because this tab sent too many requests. Your work is safe.";

// #4423 (W1.4): the request ceiling tripped (lib/requestCeiling). Shown, not
// dismissible, until the pause ends; it hides itself when the minute is up.
function useCeilingTripped() {
  const tripped = useSyncExternalStore(tabCeiling.subscribe, () => tabCeiling.state().tripped, () => false);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!tripped) return undefined;
    const wait = Math.max(250, tabCeiling.state().resumeInMs + 50);
    const t = setTimeout(() => setTick((n) => n + 1), wait);
    return () => clearTimeout(t);
  }, [tripped]);
  return tripped;
}

export function RequestCeilingBanner() {
  const tripped = useCeilingTripped();
  if (!tripped) return null;
  return (
    <div role="alert" aria-live="assertive" className="px-[var(--page-gutter)] pt-3">
      <AlertCard variant="warning" title="Refreshing paused">{CEILING_BANNER_TEXT}</AlertCard>
    </div>
  );
}

// Issue #3802 (admin shell): the one frame every page sits in. The shell, and
// only the shell, sets the space around a page: the gutter on all four sides,
// left-aligned, one maximum width. A page starts with <PageHeader> and adds no
// outer padding, width or centring of its own.
// Invariant: I-3802-ADMIN-SHELL-ONE-FRAME (docs/INVARIANT_REGISTRY.md).
export function AppShell({ activeTab, onTabChange, onOpenSearch, children }) {
  const { access } = useAuth();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const draftCounts = useDraftCounts({ enabled: !!access?.areas?.includes("crm") });

  const handleToggleCollapsed = useCallback(() => {
    setSidebarCollapsed((prev) => !prev);
  }, []);

  const handleMobileClose = useCallback(() => {
    setMobileMenuOpen(false);
  }, []);

  const handleMobileOpen = useCallback(() => {
    setMobileMenuOpen(true);
  }, []);

  // #4130 Wave 6: every page lights its own menu entry (Support and
  // Community are real pages now, so no page stands in for another).
  const currentTitle = pageTitle(activeTab, access, [...NAV_ITEMS, ...HEADER_PAGE_ITEMS]);

  return (
    <DraftCountProvider value={draftCounts}>
    <div className="flex h-screen overflow-hidden bg-[var(--color-background-secondary)]">
      <Sidebar
        activeTab={activeTab}
        onTabChange={onTabChange}
        collapsed={sidebarCollapsed}
        mobileOpen={mobileMenuOpen}
        onMobileClose={handleMobileClose}
      />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Header
          activeTab={activeTab}
          title={currentTitle}
          collapsed={sidebarCollapsed}
          onToggleCollapsed={handleToggleCollapsed}
          onMobileMenuOpen={handleMobileOpen}
          onOpenSearch={onOpenSearch}
        />

        <RequestCeilingBanner />
        <main className="flex-1 overflow-y-auto">
          <div className="w-full min-w-0 max-w-[var(--content-max-width)] p-[var(--page-gutter)]">
            {children}
          </div>
        </main>
      </div>
    </div>
    </DraftCountProvider>
  );
}
