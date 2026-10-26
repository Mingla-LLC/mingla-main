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
// Issue #4130 (Wave 0) — retired page ids and where they now live.
import { isRetiredPageId, redirectHash } from "./lib/adminRoutes";
import {
  OutreachHub,
  InboundHub,
  PlacePoolHub,
  PlatformHealthHub,
  SettingsHub,
  TeamAndRolesHub,
  FeatureFlagsPlaceholder,
} from "./pages/shellHubs";
import { INVITE_ROUTE, parseInviteHash } from "./lib/inviteLink";
// Issue #3802 — the home page of the two non-admin team roles (#/home).
import { RoleHomePage } from "./pages/RoleHomePage";
import { TeamDashboardPage } from "./pages/TeamDashboardPage";
import { OverviewPage } from "./pages/OverviewPage";
import { SubscriptionManagementPage } from "./pages/SubscriptionManagementPage";
import { PricingPage } from "./pages/PricingPage";
// #4130 Wave 6 — the #3720 Community & Support console, split into two pages.
import { SupportPage } from "./pages/SupportPage";
import { CommunityPage } from "./pages/CommunityPage";
// ORCH-1273 — Business offerings console (READ-ONLY): Offerings
// (#/business-offerings). Detail views deep-link via ?offeringId=. Venues now
// open inside Brands (#4130).
import { OfferingsConsolePage } from "./pages/OfferingsConsolePage";
// #4130 (Wave 3) — People (Users + business People) and Brands (Brand Sites,
// Venues and Venue claims inside each brand).
import { PeoplePage } from "./pages/PeoplePage";
import { BrandsPage } from "./pages/BrandsPage";
// ORCH-1274 — Business Money console (READ-ONLY): Payments (#/business-payments),
// Orders (#/business-orders), Money ledger (#/business-money-ledger).
import { BusinessPaymentsPage } from "./pages/BusinessPaymentsPage";
import { BusinessOrdersPage } from "./pages/BusinessOrdersPage";
import { BusinessMoneyLedgerPage } from "./pages/BusinessMoneyLedgerPage";
// #4130 Wave 2a — Mingla money: revenue, profit and host money per currency.
import { MinglaMoneyPage } from "./pages/MinglaMoneyPage";
// ISSUE-862 WP1 — Full Rooms Ad Engine (Meta channel + 4 fail-close stubs;
// hash route #/ad-engine). Minimal functional surface; #864 owns the builder.
import { AdEnginePage } from "./pages/AdEnginePage";
// ISSUE-864 WP4 — Campaign Builder wizard (#/campaign-builder) + campaign
// surface with launch/pause/sync + review_detail cause→fix (#/campaigns).
import { CampaignBuilderPage } from "./pages/CampaignBuilderPage";
import { CampaignsPage } from "./pages/CampaignsPage";
import { RefundOperationsPage } from "./pages/RefundOperationsPage";
import { WorkBoardPage } from "./pages/WorkBoardPage";
import { AGENT_LOG_REDIRECT, AgentLogPage } from "./pages/AgentLogPage";
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
  // ── Home ── #4130 Wave 0: the menu order (lib/constants.js NAV_GROUPS).
  overview: OverviewPage,
  // Issue #3980: everyone who works the pipelines. Needs you (#/drafts) was
  // retired into Work's first column (#4130); Wave 1 opens its draft editor
  // from the card.
  "work-board": WorkBoardPage,
  notifications: NotificationsPage,
  // ── Outreach ── #4130: Hosts and Creators, Beta and Tool leads as tabs.
  outreach: OutreachHub,
  inbound: InboundHub,
  "content-calendar": ContentCalendarPage,
  "team-dashboard": TeamDashboardPage,
  // ── Support ── #4130 Wave 6: the old Community & Support console is two
  // pages; #/community-support redirects by tab (lib/adminRoutes.js).
  support: SupportPage,
  community: CommunityPage,
  // ── Business ── #4130 Wave 3: People replaces Users + People; Brands holds
  // Brand Sites, Venues and Venue claims inside each brand.
  people: PeoplePage,
  brands: BrandsPage,
  // ORCH-1273: Business offerings console (READ-ONLY).
  "business-offerings": OfferingsConsolePage,
  // ── Money ── ORCH-1274 Business Money console; #4130 Mingla money (Wave 2a).
  "mingla-money": MinglaMoneyPage,
  "business-payments": BusinessPaymentsPage,
  "business-orders": BusinessOrdersPage,
  "business-money-ledger": BusinessMoneyLedgerPage,
  "refund-operations": RefundOperationsPage,
  subscriptions: SubscriptionManagementPage,
  pricing: PricingPage,
  // ── Explorer app ── #4130: Launch Cities, Signal Library, Deck tuner as tabs.
  placepool: PlacePoolHub,
  // ── Growth ── ISSUE-862 WP1: Full Rooms Ad Engine (hash route #/ad-engine).
  "ad-engine": AdEnginePage,
  // ISSUE-864 WP4: Campaign Builder wizard + campaign surface (launch lives
  // on #/campaigns, never in the builder — I-PROPOSED-864-CREATE-PAUSED).
  "campaign-builder": CampaignBuilderPage,
  campaigns: CampaignsPage,
  // ── Company ── #4130: Careers is a tab of Team and roles.
  admin: TeamAndRolesHub,
  "data-room": DataRoomPage,
  // ── System ── #4130: Stripe mode, API health, Queue health in one page;
  // Intelligence Trial history is a tab of Settings; Feature flags (Wave 4b).
  "platform-health": PlatformHealthHub,
  "feature-flags": FeatureFlagsPlaceholder,
  settings: SettingsHub,
  // Issue #3980: #/agent-log stays a page that opens Work > Agent activity.
  "agent-log": AgentLogPage,
  // Issue #3802 (Wave 4): opened by the `crm` area. #4130: from the header's
  // profile menu (My agent) and ? help button (Guide), no longer the menu.
  agent: AgentPage,
  guide: GuidePage,
};

// Issue #3802 — every page id the app knows. Which of them a person may open
// is decided by resolveRoute() from the access the server returned.
const PAGE_IDS = Object.keys(PAGES);

// The page id the address names, exactly as written (first path segment only).
function requestedPageId() {
  return window.location.hash.replace("#/", "").split("?")[0].split("/")[0];
}

// Issue #4130 (Wave 0) — an address of a retired page (and #3720's old
// Email bookmarks and the Community & Support console, Wave 6) is rewritten to the page that now holds it,
// keeping its query, before any page is chosen (lib/adminRoutes.js).
function canonicalizeLegacyCommunityHashes() {
  const page = requestedPageId();
  const next = redirectHash(window.location.hash);
  if (next) {
    if (window.location.hash !== next) {
      window.history.replaceState(null, "", next);
    }
    return;
  }
  // Issue #3980 (R8, proof fix P2-1) — an old Agent log link, opened fresh
  // from a bookmark or a message, lands straight on Work > Agent activity.
  // Rewriting it here, before any page is chosen, means the "keep the address
  // honest" effect never writes #/agent-log back over the redirect.
  if (page === "agent-log") {
    window.history.replaceState(null, "", AGENT_LOG_REDIRECT);
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
// A retired page's address counts as named (it rewrites to its new home).
function addressNamesPage() {
  const page = requestedPageId();
  if (isRetiredPageId(page)) return true;
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
