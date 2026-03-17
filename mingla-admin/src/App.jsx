import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "./context/AuthContext";
import { LoginScreen } from "./components/LoginScreen";
import { InviteSetupScreen } from "./components/InviteSetupScreen";
import { AppShell } from "./components/layout/AppShell";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ToastContainer } from "./components/ui/Toast";
import { PageLoader } from "./components/ui/Spinner";
import { CommandPalette } from "./components/CommandPalette";
import { OverviewPage } from "./pages/OverviewPage";
import { TableBrowserPage } from "./pages/TableBrowserPage";
import { SeedPage } from "./pages/SeedPage";
import { ReportsPage } from "./pages/ReportsPage";
import { AdminPage } from "./pages/AdminPage";
import { PlacePoolBuilderPage } from "./pages/PlacePoolBuilderPage";
import { UserManagementPage } from "./pages/UserManagementPage";
import { ContentModerationPage } from "./pages/ContentModerationPage";
import { AnalyticsPage } from "./pages/AnalyticsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { EmailPage } from "./pages/EmailPage";
import { SubscriptionManagementPage } from "./pages/SubscriptionManagementPage";
import { PhotoPoolManagementPage } from "./pages/PhotoPoolManagementPage";
import { BetaFeedbackPage } from "./pages/BetaFeedbackPage";
import { CityLauncherPage } from "./pages/CityLauncherPage";

const PAGES = {
  overview: OverviewPage,
  analytics: AnalyticsPage,
  users: UserManagementPage,
  subscriptions: SubscriptionManagementPage,
  content: ContentModerationPage,
  tables: TableBrowserPage,
  seed: SeedPage,
  placepool: PlacePoolBuilderPage,
  photopool: PhotoPoolManagementPage,
  feedback: BetaFeedbackPage,
  reports: ReportsPage,
  email: EmailPage,
  admin: AdminPage,
  settings: SettingsPage,
  citylauncher: CityLauncherPage,
};

function getTabFromHash() {
  const hash = window.location.hash.replace("#/", "").split("?")[0];
  return PAGES[hash] ? hash : "overview";
}

const pageTransition = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -4 },
  transition: { duration: 0.2, ease: "easeOut" },
};

export default function App() {
  const { session, loading, inviteSetup } = useAuth();
  const [activeTab, setActiveTab] = useState(getTabFromHash);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);

  // Hash → state sync (one-directional: hashchange sets activeTab)
  useEffect(() => {
    const onHashChange = () => setActiveTab(getTabFromHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  // Set initial hash if none exists (no history entry)
  useEffect(() => {
    if (!window.location.hash) {
      window.history.replaceState(null, "", "#/overview");
    }
  }, []);

  // State → hash sync (activeTab change writes hash)
  const handleTabChange = useCallback((tabId) => {
    window.location.hash = `#/${tabId}`;
    // hashchange event fires → setActiveTab runs — no direct setState needed
  }, []);

  // Cmd+K / Ctrl+K to open command palette
  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setCommandPaletteOpen(true);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[--color-background-secondary]">
        <PageLoader />
      </div>
    );
  }

  if (inviteSetup) {
    return <InviteSetupScreen />;
  }

  if (!session) {
    return <LoginScreen />;
  }

  const ActivePage = PAGES[activeTab] || OverviewPage;

  return (
    <>
      <AppShell activeTab={activeTab} onTabChange={handleTabChange}>
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={pageTransition.initial}
            animate={pageTransition.animate}
            exit={pageTransition.exit}
            transition={pageTransition.transition}
          >
            <ErrorBoundary>
              <ActivePage onTabChange={handleTabChange} />
            </ErrorBoundary>
          </motion.div>
        </AnimatePresence>
      </AppShell>
      <CommandPalette
        open={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        onNavigate={handleTabChange}
      />
      <ErrorBoundary>
        <ToastContainer />
      </ErrorBoundary>
    </>
  );
}
