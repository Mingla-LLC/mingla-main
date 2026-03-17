import { useEffect, useCallback } from "react";
import {
  LayoutDashboard,
  Database,
  Terminal,
  Flag,
  Shield,
  Globe,
  Users,
  Layers,
  BarChart3,
  Mail,
  Settings,
  CreditCard,
  Camera,
  Mic,
  LogOut,
  ChevronLeft,
  ChevronRight,
  X,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { NAV_ITEMS } from "../../lib/constants";
import minglaLogo from "../../assets/mingla-logo.png";

const ICON_MAP = { LayoutDashboard, Database, Terminal, Globe, Flag, Shield, Users, Layers, BarChart3, Mail, Settings, CreditCard, Camera, Mic };

export function Sidebar({
  activeTab,
  onTabChange,
  collapsed,
  onToggleCollapsed,
  mobileOpen,
  onMobileClose,
}) {
  const { session, signOut } = useAuth();

  const stableOnMobileClose = useCallback(onMobileClose, [onMobileClose]);
  useEffect(() => {
    if (mobileOpen) stableOnMobileClose();
  }, [activeTab, mobileOpen, stableOnMobileClose]);

  const handleSignOut = async () => {
    try {
      await signOut();
    } catch (err) {
      console.error("Sign out failed:", err.message);
    }
  };

  const sidebarContent = (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="flex items-center h-16 px-5 border-b border-white/10 shrink-0 overflow-hidden">
        <img src={minglaLogo} alt="Mingla" className="h-7 w-7 rounded-lg object-contain shrink-0" />
        <span
          className={[
            "text-lg font-semibold text-white overflow-hidden whitespace-nowrap",
            "transition-all duration-200 ease-out",
            collapsed ? "max-w-0 opacity-0 ml-0" : "max-w-[160px] opacity-100 ml-3",
          ].join(" ")}
        >
          Mingla
        </span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-3 px-2 overflow-y-auto" role="navigation" aria-label="Main navigation">
        <div className="flex flex-col gap-1" role="list">
          {NAV_ITEMS.map((item) => {
            const Icon = ICON_MAP[item.icon] || LayoutDashboard;
            const isActive = activeTab === item.id;

            return (
              <button
                key={item.id}
                onClick={() => onTabChange(item.id)}
                role="listitem"
                aria-current={isActive ? "page" : undefined}
                className={[
                  "group relative flex items-center h-11 rounded-lg text-sm font-medium overflow-hidden",
                  "transition-all duration-150 cursor-pointer",
                  collapsed ? "justify-center px-0" : "px-3",
                  isActive
                    ? "bg-white/10 text-white"
                    : "text-[var(--sidebar-text)] hover:bg-white/[0.08] hover:text-white",
                ].join(" ")}
              >
                {isActive && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-[60%] bg-[#f97316] rounded-r-full" />
                )}
                <Icon className="h-5 w-5 shrink-0" />
                <span
                  className={[
                    "overflow-hidden whitespace-nowrap truncate transition-all duration-200 ease-out",
                    collapsed ? "max-w-0 opacity-0 ml-0" : "max-w-[160px] opacity-100 ml-3",
                  ].join(" ")}
                >
                  {item.label}
                </span>
                {collapsed && (
                  <div className="absolute left-full ml-2 px-2 py-1 text-xs font-medium text-white bg-[var(--sidebar-bg)] rounded-md whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity duration-150 z-50">
                    {item.label}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </nav>

      {/* Footer */}
      <div className="border-t border-white/10 p-3 shrink-0">
        {!collapsed && session?.user && (
          <div className="px-2 mb-2">
            <p className="text-xs text-[var(--gray-500)] truncate">{session.user.email}</p>
          </div>
        )}
        <button
          onClick={handleSignOut}
          className={[
            "group relative flex items-center w-full h-10 rounded-lg text-sm font-medium overflow-hidden",
            "text-[var(--sidebar-text)] hover:bg-white/[0.08] hover:text-white",
            "transition-all duration-150 cursor-pointer",
            collapsed ? "justify-center px-0" : "px-3",
          ].join(" ")}
        >
          <LogOut className="h-5 w-5 shrink-0" />
          <span
            className={[
              "overflow-hidden whitespace-nowrap transition-all duration-200 ease-out",
              collapsed ? "max-w-0 opacity-0 ml-0" : "max-w-[160px] opacity-100 ml-3",
            ].join(" ")}
          >
            Sign Out
          </span>
          {collapsed && (
            <div className="absolute left-full ml-2 px-2 py-1 text-xs font-medium text-white bg-[var(--sidebar-bg)] rounded-md whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity duration-150 z-50">
              Sign Out
            </div>
          )}
        </button>
      </div>

      {/* Collapse toggle */}
      <button
        onClick={onToggleCollapsed}
        className="hidden lg:flex items-center justify-center h-10 border-t border-white/10 text-[var(--gray-500)] hover:text-white hover:bg-white/[0.08] transition-all duration-150 cursor-pointer"
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
      </button>
    </div>
  );

  return (
    <>
      {/* Mobile Overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm lg:hidden animate-[overlay-fade-in_200ms_ease-out]"
          style={{ zIndex: "var(--z-overlay)" }}
          onClick={onMobileClose}
        />
      )}

      {/* Mobile Sidebar */}
      <aside
        className={[
          "fixed top-0 left-0 h-full w-[260px] bg-[var(--sidebar-bg)]",
          "transform transition-transform duration-300 ease-in-out lg:hidden",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        ].join(" ")}
        style={{ zIndex: "calc(var(--z-overlay) + 1)" }}
      >
        <button
          onClick={onMobileClose}
          className="absolute top-4 right-4 text-[var(--gray-400)] hover:text-white cursor-pointer"
          aria-label="Close menu"
        >
          <X className="h-5 w-5" />
        </button>
        {sidebarContent}
      </aside>

      {/* Desktop Sidebar */}
      <aside
        className={[
          "hidden lg:flex flex-col shrink-0 h-screen bg-[var(--sidebar-bg)]",
          "border-r border-white/10 transition-[width] duration-300 ease-in-out",
        ].join(" ")}
        style={{
          width: collapsed ? "var(--sidebar-collapsed-width)" : "var(--sidebar-width)",
        }}
      >
        {sidebarContent}
      </aside>
    </>
  );
}
