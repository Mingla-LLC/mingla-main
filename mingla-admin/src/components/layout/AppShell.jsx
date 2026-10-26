import { useState, useCallback } from "react";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { HEADER_PAGE_ITEMS, NAV_ITEMS } from "../../lib/constants";
import { activeMenuId } from "../../lib/adminRoutes";
import { useAuth } from "../../context/AuthContext";
import { pageTitle } from "../../lib/access";
import { DraftCountProvider, useDraftCounts } from "../../hooks/useDraftCounts";

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

  // #4130: the menu entry for the page on screen. The same as the page id,
  // except the Community & Support console, which is the Support or the
  // Community entry depending on its tab (until Wave 6 splits it). App
  // re-renders the shell on every address change, so this follows tabs too.
  const menuId = activeMenuId(activeTab, typeof window === "undefined" ? "" : window.location.hash);
  const currentTitle = pageTitle(menuId, access, [...NAV_ITEMS, ...HEADER_PAGE_ITEMS]);

  return (
    <DraftCountProvider value={draftCounts}>
    <div className="flex h-screen overflow-hidden bg-[var(--color-background-secondary)]">
      <Sidebar
        activeTab={menuId}
        onTabChange={onTabChange}
        collapsed={sidebarCollapsed}
        mobileOpen={mobileMenuOpen}
        onMobileClose={handleMobileClose}
      />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Header
          activeTab={menuId}
          onTabChange={onTabChange}
          title={currentTitle}
          collapsed={sidebarCollapsed}
          onToggleCollapsed={handleToggleCollapsed}
          onMobileMenuOpen={handleMobileOpen}
          onOpenSearch={onOpenSearch}
        />

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
