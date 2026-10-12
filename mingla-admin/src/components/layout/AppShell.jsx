import { useState, useCallback } from "react";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { NAV_ITEMS } from "../../lib/constants";
import { useAuth } from "../../context/AuthContext";
import { homePageFor, pageTitle } from "../../lib/access";

export function AppShell({ activeTab, onTabChange, children }) {
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
        <Header
          title={currentTitle}
          onMobileMenuOpen={handleMobileOpen}
          onNavigate={onTabChange}
          homeId={homePageFor(access)}
        />

        <main className="flex-1 overflow-y-auto">
          <div className="w-full min-w-0 max-w-[--content-max-width] mx-auto px-4 sm:px-6 lg:px-8 xl:px-10 2xl:px-12">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
