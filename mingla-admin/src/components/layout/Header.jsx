import { Menu, Moon, PanelLeft, Search, Sun } from "lucide-react";
import { useTheme } from "../../context/ThemeContext";
import { Breadcrumbs } from "../ui/Breadcrumbs";
import { useAuth } from "../../context/AuthContext";
import { AREA } from "../../lib/access";
import { NAV_GROUPS } from "../../lib/constants";
import { breadcrumbFor } from "../../lib/shellNav";

const ICON_BUTTON =
  "grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[var(--color-text-secondary)] " +
  "hover:bg-[var(--gray-100)] hover:text-[var(--color-text-primary)] transition-colors duration-150 cursor-pointer";

// The shortcut that opens search, as this person's keyboard names it.
function searchShortcut() {
  const platform = typeof navigator === "undefined" ? "" : navigator.platform || "";
  return /Mac|iPhone|iPad/.test(platform) ? "⌘K" : "Ctrl K";
}

// Issue #3802 (admin shell). The header is as tall as the menu's logo row
// (--header-height) and its content starts on the page gutter, the same edge
// every page starts on. `title` is the page's own title, already resolved for
// this person (a role home reads "My day" or "Company view").
export function Header({ activeTab, title, collapsed, onToggleCollapsed, onMobileMenuOpen, onOpenSearch }) {
  const { theme, toggleTheme } = useTheme();
  const { access } = useAuth();
  // The same words the search box itself uses (components/CommandPalette.jsx).
  const searchesEverything = !!access && access.status === "active" && access.areas.includes(AREA.ADMIN_CONSOLE);
  const searchLabel = searchesEverything ? "Search pages, users, places" : "Search pages";

  return (
    <header
      className="sticky top-0 flex shrink-0 items-center gap-3 border-b border-[var(--header-border)] bg-[var(--header-bg)] px-[var(--page-gutter)]"
      style={{ zIndex: "var(--z-sticky)", height: "var(--header-height)" }}
    >
      {/* The first control's icon, not its box, sits on the gutter. */}
      <button
        type="button"
        onClick={onMobileMenuOpen}
        className={`${ICON_BUTTON} -ml-2 lg:hidden`}
        aria-label="Open menu"
      >
        <Menu aria-hidden="true" className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={onToggleCollapsed}
        className={`${ICON_BUTTON} -ml-2 hidden lg:grid`}
        aria-label={collapsed ? "Expand menu" : "Collapse menu"}
        aria-expanded={!collapsed}
        title={collapsed ? "Expand menu" : "Collapse menu"}
      >
        <PanelLeft aria-hidden="true" className="h-4 w-4" />
      </button>

      <Breadcrumbs oneLine items={breadcrumbFor(activeTab, title, NAV_GROUPS)} />

      <div className="ml-auto flex shrink-0 items-center gap-2">
        {/* Opens the search the app already has (also on the keyboard shortcut). */}
        <button
          type="button"
          onClick={onOpenSearch}
          aria-label={searchLabel}
          className={[
            "flex h-8 items-center gap-2 rounded-lg border border-[var(--gray-200)] bg-[var(--color-background-secondary)]",
            "text-[13px] text-[var(--color-text-tertiary)] hover:border-[var(--gray-300)] hover:text-[var(--color-text-secondary)]",
            "transition-colors duration-150 cursor-pointer w-8 justify-center px-0 md:w-60 md:justify-start md:px-2.5",
          ].join(" ")}
        >
          <Search aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
          <span className="hidden truncate md:inline">{searchLabel}</span>
          <kbd className="ml-auto hidden rounded border border-[var(--gray-300)] px-1.5 font-mono text-[10.5px] md:inline">
            {searchShortcut()}
          </kbd>
        </button>

        {/* Live indicator */}
        <div className="flex items-center gap-1.5 rounded-full bg-[var(--color-success-50)] px-3 py-1 text-xs font-medium text-[var(--color-success-700)]">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full rounded-full bg-[var(--color-success-500)] opacity-75 animate-[ping_1s_cubic-bezier(0,0,0.2,1)_infinite]" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--color-success-500)]" />
          </span>
          Live
        </div>

        <button
          type="button"
          onClick={toggleTheme}
          className={`${ICON_BUTTON} -mr-2`}
          aria-label={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
        >
          {theme === "light" ? <Moon aria-hidden="true" className="h-4 w-4" /> : <Sun aria-hidden="true" className="h-4 w-4" />}
        </button>
      </div>
    </header>
  );
}
