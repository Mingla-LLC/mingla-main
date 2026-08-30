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
import { PlaceIntelligenceTrialPage } from "./pages/PlaceIntelligenceTrialPage";
import { ClaimsPage } from "./pages/ClaimsPage";
import { DeckScoreTunerPage } from "./pages/DeckScoreTunerPage";
import { PricingPage } from "./pages/PricingPage";
import { LaunchCitiesPage } from "./pages/LaunchCitiesPage";
import { BetaLeadsPage } from "./pages/BetaLeadsPage";
// ISSUE-1354 — Tool Leads: all free-tool submissions + report detail (#/tool-leads).
import { ToolLeadsPage } from "./pages/ToolLeadsPage";
import { StripeModePage } from "./pages/StripeModePage";
// META-ORCH-1104 Phase 2 — admin support desk (queue + thread + agents).
import { SupportDeskPage } from "./pages/SupportDeskPage";
// ORCH-1201 — Admin API-Health hub (board of external-service health + alerts).
import { ApiHealthPage } from "./pages/ApiHealthPage";
// META-ORCH-1222 — Careers: applications list+detail + role CRUD (hash #/careers).
import { CareersPage } from "./pages/CareersPage";
// ORCH-1272 — Business identity console (READ-ONLY): People (#/business-people)
// + Brands (#/business-brands). Replaces the ORCH-1271 scaffolding placeholder.
import { PeopleConsolePage } from "./pages/PeopleConsolePage";
import { BrandsConsolePage } from "./pages/BrandsConsolePage";
import { BrandSitesPage } from "./pages/BrandSitesPage";
// ORCH-1273 — Business offerings console (READ-ONLY): Offerings
// (#/business-offerings) + Venues (#/business-venues). Detail views deep-link via
// ?offeringId= / ?venueId= within the same tab (matches the 1272 pattern).
import { OfferingsConsolePage } from "./pages/OfferingsConsolePage";
import { VenuesConsolePage } from "./pages/VenuesConsolePage";
// ORCH-1274 — Business Money console (READ-ONLY): Payments (#/business-payments),
// Orders (#/business-orders), Money ledger (#/business-money-ledger).
import { BusinessPaymentsPage } from "./pages/BusinessPaymentsPage";
import { BusinessOrdersPage } from "./pages/BusinessOrdersPage";
import { BusinessMoneyLedgerPage } from "./pages/BusinessMoneyLedgerPage";
// ISSUE-862 WP1 — Full Rooms Ad Engine (Meta channel + 4 fail-close stubs;
// hash route #/ad-engine). Minimal functional surface; #864 owns the builder.
import { AdEnginePage } from "./pages/AdEnginePage";
// ISSUE-864 WP4 — Campaign Builder wizard (#/campaign-builder) + campaign
// surface with launch/pause/sync + review_detail cause→fix (#/campaigns).
import { CampaignBuilderPage } from "./pages/CampaignBuilderPage";
import { CampaignsPage } from "./pages/CampaignsPage";
import { RefundOperationsPage } from "./pages/RefundOperationsPage";
// ORCH-1008: 6 pages deleted (Seed, ContentModeration, Analytics, Reports,
//   BetaFeedback, TableBrowser). Sidebar flattened; System dropdown removed.
//   See SPEC_ORCH-1008_ADMIN_SHELL_PRUNE_INTELLIGENCE_OVERVIEW.md §2 + §3.
// ORCH-1014: PhotoLabelingPage + PhotoScorerPage DELETED — DEC-099 Cut 1
//   cleanup; Gemini 2.5 Flash intelligence pipeline (ORCH-1008/1013) replaces
//   what they did. NAV is now 10 items.
// ORCH-0671: PhotoPoolManagementPage DELETED — bouncer-blind ghost page replaced by Photos tab on Place Pool page.
// ORCH-0640 ch08: AIValidationPage + CardPoolManagementPage DELETED.

const PAGES = {
  overview: OverviewPage,
  users: UserManagementPage,
  subscriptions: SubscriptionManagementPage,
  placepool: PlacePoolManagementPage,
  "launch-cities": LaunchCitiesPage,
  "beta-leads": BetaLeadsPage,
  // ISSUE-1354: all free-tool submissions + report detail (hash route #/tool-leads).
  "tool-leads": ToolLeadsPage,
  claims: ClaimsPage,
  // META-ORCH-1104 Phase 2 — #/support support desk.
  support: SupportDeskPage,
  // ORCH-0671: 'photos' route deleted — getTabFromHash falls back to 'overview' via PAGES[hash] guard.
  email: EmailPage,
  pricing: PricingPage,
  admin: AdminPage,
  settings: SettingsPage,
  signals: SignalLibraryPage,
  // ORCH-1066: deck score tuner (hash route #/deck-tuner).
  "deck-tuner": DeckScoreTunerPage,
  "place-intelligence-trial": PlaceIntelligenceTrialPage,
  // ORCH-1056: unified Stripe mode dashboard (hash route #/stripe-mode).
  "stripe-mode": StripeModePage,
  // ORCH-1201: API-health hub (hash route #/api-health).
  "api-health": ApiHealthPage,
  // META-ORCH-1222: careers applications + role manager (hash route #/careers).
  careers: CareersPage,
  // ORCH-1272: Business identity console (READ-ONLY) — People + Brands
  // (hash routes #/business-people, #/business-brands).
  "business-people": PeopleConsolePage,
  "business-brands": BrandsConsolePage,
  "brand-sites": BrandSitesPage,
  // ORCH-1273: Business offerings console (READ-ONLY) — Offerings + Venues
  // (hash routes #/business-offerings, #/business-venues).
  "business-offerings": OfferingsConsolePage,
  "business-venues": VenuesConsolePage,
  // ORCH-1274: Business Money console (READ-ONLY) — Payments + Orders + Money
  // ledger (hash routes #/business-payments, #/business-orders, #/business-money-ledger).
  "business-payments": BusinessPaymentsPage,
  "business-orders": BusinessOrdersPage,
  "business-money-ledger": BusinessMoneyLedgerPage,
  // ISSUE-862 WP1: Full Rooms Ad Engine (hash route #/ad-engine).
  "ad-engine": AdEnginePage,
  // ISSUE-864 WP4: Campaign Builder wizard + campaign surface (launch lives
  // on #/campaigns, never in the builder — I-PROPOSED-864-CREATE-PAUSED).
  "campaign-builder": CampaignBuilderPage,
  campaigns: CampaignsPage,
  "refund-operations": RefundOperationsPage,
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
