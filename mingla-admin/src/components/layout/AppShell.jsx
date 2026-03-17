import { useState, useCallback } from "react";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { NAV_ITEMS } from "../../lib/constants";

export function AppShell({ activeTab, onTabChange, children }) {
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

  const currentTitle = NAV_ITEMS.find((t) => t.id === activeTab)?.label || "Dashboard";

  return (
    <div className="flex h-screen overflow-hidden bg-[--color-background-secondary]">
      <Sidebar
        activeTab={activeTab}
        onTabChange={onTabChange}
        collapsed={sidebarCollapsed}
        onToggleCollapsed={handleToggleCollapsed}
        mobileOpen={mobileMenuOpen}
        onMobileClose={handleMobileClose}
      />

      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <Header title={currentTitle} onMobileMenuOpen={handleMobileOpen} onNavigate={onTabChange} />

        <main className="flex-1 overflow-y-auto">
          <div className="w-full max-w-[--content-max-width] mx-auto px-16">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
