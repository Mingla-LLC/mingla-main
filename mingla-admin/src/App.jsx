import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "./context/AuthContext";
import { LoginScreen } from "./components/LoginScreen";
import { InviteSetupScreen } from "./components/InviteSetupScreen";
import { InviteAcceptScreen } from "./components/InviteAcceptScreen";
import { AppShell } from "./components/layout/AppShell";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ToastContainer } from "./components/ui/Toast";
import { PageLoader } from "./components/ui/Spinner";
import { CommandPalette } from "./components/CommandPalette";
import { Button } from "./components/ui/Button";
import { useToast } from "./context/ToastContext";
import { NAV_ITEMS } from "./lib/constants";
import { pageTitle, resolveRoute } from "./lib/access";
import { INVITE_ROUTE, parseInviteHash } from "./lib/inviteLink";
// Issue #3802 — the home page of the two non-admin team roles (#/home).
import { RoleHomePage } from "./pages/RoleHomePage";
import { TeamDashboardPage } from "./pages/TeamDashboardPage";
import { OverviewPage } from "./pages/OverviewPage";
import { AdminPage } from "./pages/AdminPage";
import { PlacePoolManagementPage } from "./pages/PlacePoolManagementPage";
import { UserManagementPage } from "./pages/UserManagementPage";
import { SettingsPage } from "./pages/SettingsPage";
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
// #3720 Slice F — unified Community & Support console (replaces Support + Email nav).
import { CommunitySupportPage } from "./pages/CommunitySupportPage";
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
// Issue #3802 (Wave 1) — the team's Hosts and Creators boards (#/hosts, #/creators).
import { HostsPage, CreatorsPage } from "./pages/PipelinePage";
import { DraftsPage } from "./pages/DraftsPage";
// Issue #3802 (Wave 4) — connect your own agent (#/agent).
import { AgentPage } from "./pages/AgentPage";
import { GuidePage } from "./pages/GuidePage";
import { ContentCalendarPage } from "./pages/ContentCalendarPage";
import { NotificationsPage } from "./pages/NotificationsPage";
import { DataRoomPage } from "./pages/DataRoomPage";
// ORCH-1008: 6 pages deleted (Seed, ContentModeration, Analytics, Reports,
//   BetaFeedback, TableBrowser). Sidebar flattened; System dropdown removed.
//   See SPEC_ORCH-1008_ADMIN_SHELL_PRUNE_INTELLIGENCE_OVERVIEW.md §2 + §3.
// ORCH-1014: PhotoLabelingPage + PhotoScorerPage DELETED — DEC-099 Cut 1
//   cleanup; the Gemini intelligence pipeline (ORCH-1008/1013) replaces
//   what they did. NAV is now 10 items.
// ORCH-0671: PhotoPoolManagementPage DELETED — bouncer-blind ghost page replaced by Photos tab on Place Pool page.
// ORCH-0640 ch08: AIValidationPage + CardPoolManagementPage DELETED.

const PAGES = {
  home: RoleHomePage,
  overview: OverviewPage,
  users: UserManagementPage,
  subscriptions: SubscriptionManagementPage,
  placepool: PlacePoolManagementPage,
  "launch-cities": LaunchCitiesPage,
  "beta-leads": BetaLeadsPage,
  // ISSUE-1354: all free-tool submissions + report detail (hash route #/tool-leads).
  "tool-leads": ToolLeadsPage,
  claims: ClaimsPage,
  // #3720 Slice F — #/community-support (legacy #/support and #/email rewrite below).
  "community-support": CommunitySupportPage,
  notifications: NotificationsPage,
  // ORCH-0671: 'photos' route deleted — getTabFromHash falls back to 'overview' via PAGES[hash] guard.
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
  "data-room": DataRoomPage,
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
  // Issue #3802 (Wave 1): opened by the `crm` area, not by admin_console.
  hosts: HostsPage,
  "team-dashboard": TeamDashboardPage,
  creators: CreatorsPage,
  drafts: DraftsPage,
  // Issue #3802 (Wave 4): opened by the `crm` area, like the boards.
  agent: AgentPage,
  guide: GuidePage,
  "content-calendar": ContentCalendarPage,
};

// Issue #3802 — every page id the app knows. Which of them a person may open
// is decided by resolveRoute() from the access the server returned.
const PAGE_IDS = Object.keys(PAGES);

// The page id the address names, exactly as written (first path segment only).
function requestedPageId() {
  return window.location.hash.replace("#/", "").split("?")[0].split("/")[0];
}

// #3720 Slice F — old Support / Email bookmarks open the matching console tab.
function canonicalizeLegacyCommunityHashes() {
  const page = requestedPageId();
  if (page === "support") {
    const next = "#/community-support?tab=support";
    if (window.location.hash !== next) {
      window.history.replaceState(null, "", next);
    }
    return;
  }
  if (page === "email") {
    const next = "#/community-support?tab=email";
    if (window.location.hash !== next) {
      window.history.replaceState(null, "", next);
    }
  }
}

// An address that names no page reads as the dashboard, as it always has.
// Whether the person may open that page is NOT decided here: resolveRoute()
// decides what is actually shown.
function getTabFromHash() {
  canonicalizeLegacyCommunityHashes();
  const hash = requestedPageId();
  return PAGES[hash] ? hash : "overview";
}

// Did the address name a real page? Only then is a refusal worth a message.
// Legacy #/support and #/email count as named (they rewrite to community-support).
function addressNamesPage() {
  const page = requestedPageId();
  if (page === "support" || page === "email") return true;
  return Object.hasOwn(PAGES, page);
}

// Issue #3802 — shown when someone is signed in but the app could not find out
// what they may open. Never the dashboard, never a blank page.
function AccessErrorScreen({ onRetry, onSignOut }) {
  const [retrying, setRetrying] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [stillFailing, setStillFailing] = useState(false);

  const handleRetry = async () => {
    setRetrying(true);
    setStillFailing(false);
    try {
      await onRetry();
    } catch (err) {
      console.error("Access retry failed:", err?.message || err);
    } finally {
      // Still on this screen after the attempt means it failed again.
      setRetrying(false);
      setStillFailing(true);
    }
  };

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await onSignOut();
    } catch (err) {
      console.error("Sign out failed:", err?.message || err);
      setSigningOut(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-[--color-background-secondary]">
      <div
        role="alert"
        className="w-full max-w-[420px] rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-primary)] p-6 shadow-[var(--shadow-md)]"
      >
        <h1 className="text-lg font-semibold text-[var(--color-text-primary)]">
          Couldn&apos;t load your access
        </h1>
        <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
          We couldn&apos;t confirm what you can open. Your sign-in is fine.
        </p>
        {stillFailing && !retrying && (
          <p className="mt-2 text-sm text-[var(--color-text-secondary)]" aria-live="polite">
            That didn&apos;t work either. Check your connection and try again.
          </p>
        )}
        <div className="mt-5 flex flex-wrap gap-2">
          <Button variant="primary" loading={retrying} disabled={signingOut} onClick={handleRetry}>
            Try again
          </Button>
          <Button variant="secondary" loading={signingOut} disabled={retrying} onClick={handleSignOut}>
            Sign out
          </Button>
        </div>
      </div>
    </div>
  );
}

const pageTransition = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -4 },
  transition: { duration: 0.2, ease: "easeOut" },
};

export default function App() {
  const { session, loading, inviteSetup, access, accessError, retryAccess, signOut } = useAuth();
  const { addToast } = useToast();
  // The page the address asks for, whether the address really named a page,
  // and a counter that moves on every navigation (so asking for the same
  // refused page twice is two events).
  const [nav, setNav] = useState(() => ({
    requested: getTabFromHash(),
    named: addressNamesPage(),
    seq: 0,
  }));
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);

  // Issue #3802 — the secret of a one-time invite link, when the app was opened
  // from one. It lives only in this component's state.
  const [inviteToken, setInviteToken] = useState(() => parseInviteHash(window.location.hash));

  // Take the secret out of the address bar and the history entry straight away.
  useEffect(() => {
    if (parseInviteHash(window.location.hash)) {
      window.history.replaceState(null, "", "#/" + INVITE_ROUTE);
    }
  }, []);

  // Hash → state sync (one-directional: hashchange sets activeTab)
  useEffect(() => {
    const onHashChange = () => {
      // An invite link pasted into a tab that is already open.
      const pasted = parseInviteHash(window.location.hash);
      if (pasted) {
        window.history.replaceState(null, "", "#/" + INVITE_ROUTE);
        setInviteToken(pasted);
      }
      setNav((prev) => ({
        requested: getTabFromHash(),
        named: addressNamesPage(),
        seq: prev.seq + 1,
      }));
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  // Issue #3802 — the page to show is chosen from what this person may open,
  // never from the address alone. A page they may not open is never mounted.
  const signedIn = !!session && !!access;
  const route = signedIn
    ? resolveRoute(nav.requested, access, PAGE_IDS)
    : { pageId: null, denied: false, requestedId: nav.requested };

  // Keep the address honest: when the page shown differs from the one asked
  // for (no address, unknown address, or one outside this person's access),
  // rewrite the address without adding a history entry, and say so when the
  // address named a real page that was refused.
  const lastToldRef = useRef(-1);
  useEffect(() => {
    if (!signedIn || inviteToken || !route.pageId) return;
    if (route.denied && nav.named && lastToldRef.current !== nav.seq) {
      lastToldRef.current = nav.seq;
      addToast({
        variant: "warning",
        title: "That page isn't part of your access",
        description: `You're on ${pageTitle(route.pageId, access, NAV_ITEMS)} instead.`,
      });
    }
    if (requestedPageId() !== route.pageId) {
      window.history.replaceState(null, "", "#/" + route.pageId);
    }
  }, [signedIn, inviteToken, route.pageId, route.denied, nav.named, nav.seq, access, addToast]);

  // State → hash sync (activeTab change writes hash)
  const handleTabChange = useCallback((tabId) => {
    window.location.hash = `#/${tabId}`;
    // hashchange event fires → the handler above records it — no direct setState needed
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

  // An invite link was opened: this screen comes first whether or not somebody
  // is signed in on this browser.
  if (inviteToken) {
    return <InviteAcceptScreen token={inviteToken} onDone={() => setInviteToken(null)} />;
  }

  if (accessError) {
    return <AccessErrorScreen onRetry={retryAccess} onSignOut={signOut} />;
  }

  if (!session) {
    return <LoginScreen />;
  }

  // Signed in, but the server gave this person nothing they can open.
  if (!route.pageId) {
    return <AccessErrorScreen onRetry={retryAccess} onSignOut={signOut} />;
  }

  // Chosen from route.pageId, not from the address: a refused page's component
  // is never mounted, not even for one frame.
  const ActivePage = PAGES[route.pageId];

  return (
    <>
      <AppShell activeTab={route.pageId} onTabChange={handleTabChange} onOpenSearch={() => setCommandPaletteOpen(true)}>
        <AnimatePresence mode="wait">
          <motion.div
            key={route.pageId}
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
