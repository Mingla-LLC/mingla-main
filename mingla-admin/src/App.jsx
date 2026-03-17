import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "./context/AuthContext";
import { LoginScreen } from "./components/LoginScreen";
import { InviteSetupScreen } from "./components/InviteSetupScreen";
import { AppShell } from "./components/layout/AppShell";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ToastContainer } from "./components/ui/Toast";
import { PageLoader } from "./components/ui/Spinner";
import { OverviewPage } from "./pages/OverviewPage";
import { TableBrowserPage } from "./pages/TableBrowserPage";
import { SeedPage } from "./pages/SeedPage";
import { ReportsPage } from "./pages/ReportsPage";
import { AdminPage } from "./pages/AdminPage";
import { PlacePoolBuilderPage } from "./pages/PlacePoolBuilderPage";
import { UserManagementPage } from "./pages/UserManagementPage";
import { ContentModerationPage } from "./pages/ContentModerationPage";
import { AnalyticsPage } from "./pages/AnalyticsPage";
import { AppConfigPage } from "./pages/AppConfigPage";
import { EmailPage } from "./pages/EmailPage";
import { SubscriptionManagementPage } from "./pages/SubscriptionManagementPage";
import { PhotoPoolManagementPage } from "./pages/PhotoPoolManagementPage";
import { BetaFeedbackPage } from "./pages/BetaFeedbackPage";

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
  settings: AppConfigPage,
};

const pageTransition = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -4 },
  transition: { duration: 0.2, ease: "easeOut" },
};

export default function App() {
  const { session, loading, inviteSetup } = useAuth();
  const [activeTab, setActiveTab] = useState("overview");

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
      <AppShell activeTab={activeTab} onTabChange={setActiveTab}>
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={pageTransition.initial}
            animate={pageTransition.animate}
            exit={pageTransition.exit}
            transition={pageTransition.transition}
          >
            <ErrorBoundary>
              <ActivePage />
            </ErrorBoundary>
          </motion.div>
        </AnimatePresence>
      </AppShell>
      <ErrorBoundary>
        <ToastContainer />
      </ErrorBoundary>
    </>
  );
}
