import { useEffect, useState } from "react";
import {
  LayoutDashboard,
  LifeBuoy,
  Home,
  Handshake,
  Sparkles,
  Inbox,
  Wrench,
  BarChart3,
  Users,
  Building2,
  Globe,
  Store,
  CalendarDays,
  ClipboardList,
  CreditCard,
  Receipt,
  Landmark,
  RotateCcw,
  Repeat,
  Percent,
  CircleUser,
  Map as MapIcon,
  Rocket,
  Activity,
  SlidersHorizontal,
  Microscope,
  Megaphone,
  PencilRuler,
  Flag,
  Mail,
  Shield,
  Briefcase,
  Wallet,
  HeartPulse,
  Settings,
  LogOut,
  ChevronDown,
  X,
  Bot,
} from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { NAV_GROUPS } from "../../lib/constants";
import { ROLE_LABELS, visibleNavGroups } from "../../lib/access";
import {
  browserStorage,
  isGroupOpen,
  readFoldedGroups,
  toggleFoldedGroup,
  writeFoldedGroups,
} from "../../lib/shellNav";
// The canonical wordmark from the brand package (ISSUE-1001): never a copy,
// and never a typed "Mingla" beside it.
import minglaLogo from "../../../../packages/brand-assets/mingla-wordmark.png";

// The one registry of menu icons. Every `icon` named in NAV_GROUPS
// (lib/constants.js) and in the role Home group (lib/access.js) must be a key
// here, and every key here must be used by exactly one menu item:
// src/__tests__/admin_shell_issue3802.implementor.happy.test.js fails
// otherwise. There is no fallback icon, so a wrong name cannot ship looking
// like the Dashboard.
const ICON_MAP = {
  Home,
  LayoutDashboard,
  LifeBuoy,
  Handshake,
  Sparkles,
  Inbox,
  Wrench,
  BarChart3,
  Users,
  Building2,
  Globe,
  Store,
  CalendarDays,
  ClipboardList,
  CreditCard,
  Receipt,
  Landmark,
  RotateCcw,
  Repeat,
  Percent,
  CircleUser,
  Map: MapIcon,
  Rocket,
  Activity,
  SlidersHorizontal,
  Microscope,
  Megaphone,
  PencilRuler,
  Flag,
  Mail,
  Shield,
  Briefcase,
  Wallet,
  HeartPulse,
  Settings,
  Bot,
};

// Two letters for the footer avatar, from the sign-in email: "seth.ogieva@…"
// reads SO, "seth@…" reads SE.
function initialsFor(email) {
  const name = String(email || "").split("@")[0];
  const parts = name.split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : parts[0].slice(0, 2);
  return letters.toUpperCase();
}

// Issue #3802 (admin shell). Geometry, from the approved frame:
//   - the logo row is as tall as the header (--header-height)
//   - logo, menu icons and the footer avatar share one left edge, 24px in
//     (12px of menu padding + 12px inside each row)
//   - rows are 34px tall with 16px icons; the page you are on has a soft fill
//     and a 3px marker on the menu's edge
//   - every colour is a --sidebar-* token, so the menu follows the theme
// `rail` is the collapsed desktop menu: icons only, each named by its tooltip.
export function Sidebar({ activeTab, onTabChange, collapsed, mobileOpen, onMobileClose }) {
  const { session, access, signOut } = useAuth();
  const { addToast } = useToast();
  // Issue #3802 — the menu holds only what this person may open.
  const groups = visibleNavGroups(NAV_GROUPS, access);
  const [foldedGroups, setFoldedGroups] = useState(() => readFoldedGroups(browserStorage()));
  const [signingOut, setSigningOut] = useState(false);

  // Escape closes the phone menu.
  useEffect(() => {
    if (!mobileOpen) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") onMobileClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mobileOpen, onMobileClose]);

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
    } catch (err) {
      console.error("Sign out failed:", err?.message || err);
      addToast({
        variant: "error",
        title: "Couldn't sign you out",
        description: "Check your connection and try again.",
      });
      setSigningOut(false);
    }
  };

  const toggleGroup = (label) => {
    const next = toggleFoldedGroup(foldedGroups, label);
    setFoldedGroups(next);
    writeFoldedGroups(browserStorage(), next);
  };

  const openPage = (id) => {
    onTabChange(id);
    onMobileClose();
  };

  const renderNavItem = (item, rail) => {
    const Icon = ICON_MAP[item.icon];
    const isActive = activeTab === item.id;

    return (
      <li key={item.id}>
        <button
          type="button"
          onClick={() => openPage(item.id)}
          aria-current={isActive ? "page" : undefined}
          title={rail ? item.label : undefined}
          className={[
            "relative flex h-[34px] w-full items-center gap-2.5 rounded-lg text-left text-[13.5px] font-medium",
            "transition-colors duration-150 cursor-pointer",
            rail ? "justify-center px-0" : "px-3",
            isActive
              ? "bg-[var(--sidebar-active-bg)] text-[var(--sidebar-text-active)]"
              : "text-[var(--sidebar-text)] hover:bg-[var(--sidebar-hover)] hover:text-[var(--sidebar-text-active)]",
          ].join(" ")}
        >
          {isActive && (
            <span
              aria-hidden="true"
              className="absolute -left-3 top-2 bottom-2 w-[3px] rounded-r-[3px] bg-[var(--sidebar-accent)]"
            />
          )}
          {Icon ? (
            <Icon
              aria-hidden="true"
              className={["h-4 w-4 shrink-0", isActive ? "text-[var(--sidebar-accent)]" : "opacity-85"].join(" ")}
            />
          ) : (
            <span aria-hidden="true" className="h-4 w-4 shrink-0" />
          )}
          <span className={rail ? "sr-only" : "min-w-0 truncate"}>{item.label}</span>
        </button>
      </li>
    );
  };

  // `idPrefix` keeps the two copies of the menu (phone, desktop) from sharing ids.
  const renderContent = (rail, idPrefix) => (
    <div className="flex h-full flex-col">
      {/* Logo row: same height as the header, so both bottom rules are one line. */}
      <div
        className={[
          "flex h-[var(--header-height)] shrink-0 items-center gap-2.5 border-b border-[var(--sidebar-border)]",
          rail ? "justify-center px-0" : "px-6",
        ].join(" ")}
      >
        {/* The rail shows the wordmark's own M: the same image, clipped. */}
        <span className={["block h-[26px] shrink-0 overflow-hidden", rail ? "w-[21px]" : ""].join(" ")}>
          <img src={minglaLogo} alt="Mingla" className="block h-[26px] w-auto max-w-none" />
        </span>
        {!rail && (
          <span className="text-[10.5px] font-medium uppercase tracking-[0.06em] text-[var(--sidebar-text-dim)]">
            Admin
          </span>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pb-4 pt-2.5" aria-label="Main">
        <ul className="flex flex-col gap-0.5">
          {groups.map((group, gi) => {
            const hasLabel = typeof group.label === "string" && group.label !== "";
            // The rail has no group headings to click, so it never hides a page.
            const open = rail || isGroupOpen(group, foldedGroups, activeTab);
            const listId = `${idPrefix}-group-${gi}`;

            return (
              <li key={group.label || `group-${gi}`}>
                {hasLabel && !rail && (
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.label)}
                    aria-expanded={open}
                    aria-controls={listId}
                    className={[
                      "flex w-full items-center justify-between rounded-md px-3 pb-1.5 pt-3.5",
                      "text-[10.5px] font-semibold uppercase tracking-[0.09em]",
                      "text-[var(--sidebar-text-dim)] hover:text-[var(--sidebar-text-active)]",
                      "transition-colors duration-150 cursor-pointer",
                    ].join(" ")}
                  >
                    <span>{group.label}</span>
                    <ChevronDown
                      aria-hidden="true"
                      className={["h-3 w-3 transition-transform duration-150", open ? "" : "-rotate-90"].join(" ")}
                    />
                  </button>
                )}
                {hasLabel && rail && (
                  <div aria-hidden="true" className="mx-2 my-2 border-t border-[var(--sidebar-border)]" />
                )}
                {open && (
                  <ul id={listId} aria-label={hasLabel ? group.label : undefined} className="flex flex-col gap-0.5">
                    {group.items.map((item) => renderNavItem(item, rail))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Footer: one row. Who you are, your role, and Sign out. */}
      <div
        className={[
          "flex h-[60px] shrink-0 items-center gap-2.5 border-t border-[var(--sidebar-border)]",
          rail ? "justify-center px-0" : "px-6",
        ].join(" ")}
      >
        {!rail && session?.user && (
          <>
            <span
              aria-hidden="true"
              className="grid size-7 shrink-0 place-items-center rounded-full bg-[var(--sidebar-active-bg)] text-[11.5px] font-semibold text-[var(--sidebar-text-active)]"
            >
              {initialsFor(session.user.email)}
            </span>
            <span className="min-w-0 leading-tight">
              <span
                className="block truncate text-[12.5px] font-semibold text-[var(--sidebar-text-active)]"
                title={session.user.email}
              >
                {session.user.email}
              </span>
              {access && (
                <span className="block truncate text-[11.5px] text-[var(--sidebar-text-dim)]">
                  {ROLE_LABELS[access.role]}
                </span>
              )}
            </span>
          </>
        )}
        <button
          type="button"
          onClick={handleSignOut}
          disabled={signingOut}
          aria-label="Sign out"
          title="Sign out"
          className={[
            "grid h-8 w-8 shrink-0 place-items-center rounded-md text-[var(--sidebar-text-dim)]",
            "hover:bg-[var(--sidebar-hover)] hover:text-[var(--sidebar-text-active)]",
            "transition-colors duration-150 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50",
            rail ? "" : "ml-auto -mr-2",
          ].join(" ")}
        >
          <LogOut aria-hidden="true" className="h-[15px] w-[15px]" />
        </button>
      </div>
    </div>
  );

  return (
    <>
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-[rgba(0,0,0,0.5)] backdrop-blur-sm lg:hidden animate-[overlay-fade-in_200ms_ease-out]"
          style={{ zIndex: "var(--z-overlay)" }}
          onClick={onMobileClose}
        />
      )}

      {/* Phone and tablet: the full menu slides over the page. */}
      <aside
        className={[
          "fixed left-0 top-0 h-full w-[var(--sidebar-width)] max-w-[85vw] bg-[var(--sidebar-bg)]",
          "border-r border-[var(--sidebar-border)]",
          "transform transition-transform duration-300 ease-in-out lg:hidden",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        ].join(" ")}
        style={{ zIndex: "calc(var(--z-overlay) + 1)" }}
        aria-hidden={mobileOpen ? undefined : true}
        inert={mobileOpen ? undefined : true}
      >
        <button
          type="button"
          onClick={onMobileClose}
          className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-md text-[var(--sidebar-text-dim)] hover:bg-[var(--sidebar-hover)] hover:text-[var(--sidebar-text-active)] cursor-pointer"
          aria-label="Close menu"
        >
          <X aria-hidden="true" className="h-4 w-4" />
        </button>
        {renderContent(false, "nav-phone")}
      </aside>

      {/* Desktop: full menu, or the icon rail. */}
      <aside
        className={[
          "hidden h-screen shrink-0 flex-col bg-[var(--sidebar-bg)] lg:flex",
          "border-r border-[var(--sidebar-border)] transition-[width] duration-200 ease-out",
        ].join(" ")}
        style={{
          width: collapsed ? "var(--sidebar-collapsed-width)" : "var(--sidebar-width)",
        }}
      >
        {renderContent(collapsed, "nav-desktop")}
      </aside>
    </>
  );
}
