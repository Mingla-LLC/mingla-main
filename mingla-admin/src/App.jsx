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
import { AdminPage } from "./pages/AdminPage";
import { PlacePoolManagementPage } from "./pages/PlacePoolManagementPage";
import { UserManagementPage } from "./pages/UserManagementPage";
import { SettingsPage } from "./pages/SettingsPage";
import { EmailPage } from "./pages/EmailPage";
import { SubscriptionManagementPage } from "./pages/SubscriptionManagementPage";
import { SignalLibraryPage } from "./pages/SignalLibraryPage";
import { PhotoLabelingPage } from "./pages/PhotoLabelingPage";
import { PhotoScorerPage } from "./pages/PhotoScorerPage";
import { PlaceIntelligenceTrialPage } from "./pages/PlaceIntelligenceTrialPage";
import { ClaimsPage } from "./pages/ClaimsPage";
// ORCH-1008: 6 pages deleted (Seed, ContentModeration, Analytics, Reports,
//   BetaFeedback, TableBrowser). Sidebar flattened; System dropdown removed.
//   See SPEC_ORCH-1008_ADMIN_SHELL_PRUNE_INTELLIGENCE_OVERVIEW.md §2 + §3.
// ORCH-0671: PhotoPoolManagementPage DELETED — bouncer-blind ghost page replaced by Photos tab on Place Pool page.
// ORCH-0640 ch08: AIValidationPage + CardPoolManagementPage DELETED.

const PAGES = {
  overview: OverviewPage,
  users: UserManagementPage,
  subscriptions: SubscriptionManagementPage,
  placepool: PlacePoolManagementPage,
  claims: ClaimsPage,
  // ORCH-0671: 'photos' route deleted — getTabFromHash falls back to 'overview' via PAGES[hash] guard.
  email: EmailPage,
  admin: AdminPage,
  settings: SettingsPage,
  signals: SignalLibraryPage,
  "photo-labeling": PhotoLabelingPage,
  "photo-scorer": PhotoScorerPage,
  "place-intelligence-trial": PlaceIntelligenceTrialPage,
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
