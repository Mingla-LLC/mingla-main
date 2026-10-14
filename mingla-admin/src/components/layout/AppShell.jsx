import { useState, useCallback } from "react";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { NAV_ITEMS } from "../../lib/constants";
import { useAuth } from "../../context/AuthContext";
import { pageTitle } from "../../lib/access";

// Issue #3802 (admin shell): the one frame every page sits in. The shell, and
// only the shell, sets the space around a page: the gutter on all four sides,
// left-aligned, one maximum width. A page starts with <PageHeader> and adds no
// outer padding, width or centring of its own.
// Invariant: I-3802-ADMIN-SHELL-ONE-FRAME (docs/INVARIANT_REGISTRY.md).
export function AppShell({ activeTab, onTabChange, onOpenSearch, children }) {
  const { access } = useAuth();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleToggleCollapsed = useCallback(() => {
    setSidebarCollapsed((prev) => !prev);
  }, []);

  const handleMobileClose = useCallback(() => {
    setMobileMenuOpen(false);
  }, []);

  const handleMobileOpen = useCallback(() => {
    setMobileMenuOpen(true);
  }, []);

  const currentTitle = pageTitle(activeTab, access, NAV_ITEMS);

  return (
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

        <main className="flex-1 overflow-y-auto">
          <div className="w-full min-w-0 max-w-[var(--content-max-width)] p-[var(--page-gutter)]">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
