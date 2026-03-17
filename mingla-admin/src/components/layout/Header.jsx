import { Menu, Moon, Sun } from "lucide-react";
import { useTheme } from "../../context/ThemeContext";
import { Breadcrumbs } from "../ui/Breadcrumbs";

export function Header({ title, onMobileMenuOpen, onNavigate }) {
  const { theme, toggleTheme } = useTheme();

  const breadcrumbItems = [
    { label: "Admin", onClick: () => onNavigate?.("overview") },
    { label: title },
  ];

  return (
    <header
      className="sticky top-0 flex items-center justify-between shrink-0 px-6 border-b border-[var(--header-border)] bg-[var(--header-bg)]"
      style={{ zIndex: "var(--z-sticky)", height: "var(--header-height)" }}
    >
      {/* Left */}
      <div className="flex items-center gap-4">
        <button
          onClick={onMobileMenuOpen}
          className="lg:hidden flex items-center justify-center h-10 w-10 rounded-lg text-[var(--color-text-secondary)] hover:bg-[var(--gray-100)] transition-colors duration-150 cursor-pointer"
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5" />
        </button>
        <Breadcrumbs items={breadcrumbItems} />
      </div>

      {/* Right */}
      <div className="flex items-center gap-2">
        <button
          onClick={toggleTheme}
          className="flex items-center justify-center h-10 w-10 rounded-lg text-[var(--color-text-secondary)] hover:bg-[var(--gray-100)] transition-colors duration-150 cursor-pointer"
          aria-label={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
        >
          {theme === "light" ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />}
        </button>

        {/* Live indicator */}
        <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-[var(--color-success-50)] text-[var(--color-success-700)] text-xs font-medium">
          <span className="relative flex w-2 h-2">
            <span className="absolute inline-flex w-full h-full rounded-full bg-[#22c55e] opacity-75 animate-[ping_1s_cubic-bezier(0,0,0.2,1)_infinite]" />
            <span className="relative inline-flex w-2 h-2 rounded-full bg-[#22c55e]" />
          </span>
          Live
        </div>
      </div>
    </header>
  );
}
