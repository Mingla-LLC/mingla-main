/* global React */
const { useState: usSt } = React;

// =================================================================
// MAIN APP — State machine driving navigation
// =================================================================

function PrototypeApp() {
  const [route, setRoute] = usSt({ name: "auth" });
  const [tab, setTab] = usSt("home");
  const [onboardingStep, setOnboardingStep] = usSt(0);
  const [creatorStep, setCreatorStep] = usSt(0);
  const [scanState, setScanState] = usSt("idle");
  const [refundOpen, setRefundOpen] = usSt(false);
  const [refunded, setRefunded] = usSt(false);
  const [toast, setToast] = usSt(null);
  const [deleteStep, setDeleteStep] = usSt(0);
  const [approvedIdx, setApprovedIdx] = usSt(-1);
  const [following, setFollowing] = usSt(false);
  const [brandSwitcher, setBrandSwitcher] = usSt(false);
  const [activeBrand, setActiveBrand] = usSt("lm");

  const showToast = (kind, msg) => {
    setToast({ kind, msg });
    setTimeout(() => setToast(null), 2600);
  };

  const goTab = (t) => {
    setTab(t);
    if (t === "home") setRoute({ name: "home" });
    if (t === "events") setRoute({ name: "eventsList" });
    if (t === "chat") setRoute({ name: "chat" });
    if (t === "scan") setRoute({ name: "scanner" });
    if (t === "marketing") setRoute({ name: "marketing" });
    if (t === "account") setRoute({ name: "account" });
  };

  // ROUTING
  let screen = null;
  if (route.name === "auth") {
    screen = <AuthScreen onSignIn={() => { setOnboardingStep(0); setRoute({ name: "onboarding" }); }}/>;
  } else if (route.name === "onboarding") {
    screen = <OnboardingScreen
      step={onboardingStep}
      onBack={() => onboardingStep > 0 ? setOnboardingStep(s => s - 1) : setRoute({ name: "auth" })}
      onNext={() => {
        if (onboardingStep === 3) { setRoute({ name: "creator" }); setCreatorStep(0); }
        else setOnboardingStep(s => s + 1);
      }}
    />;
  } else if (route.name === "home") {
    screen = <HomeScreen
      onTab={goTab}
      onOpenEvent={() => setRoute({ name: "eventDetail" })}
      onCreate={() => { setCreatorStep(0); setRoute({ name: "creator" }); }}
      onSwitchBrand={() => setBrandSwitcher(true)}
    />;
  } else if (route.name === "eventsList") {
    screen = <EventsListScreen
      onTab={goTab}
      onOpenEvent={() => setRoute({ name: "eventDetail" })}
      onCreate={() => { setCreatorStep(0); setRoute({ name: "creator" }); }}
      onPublic={() => setRoute({ name: "publicEvent", from: "eventsList" })}
      onBrand={() => setRoute({ name: "publicBrand", from: "eventsList" })}
    />;
  } else if (route.name === "creator") {
    screen = <EventCreatorScreen
      step={creatorStep}
      onNext={() => setCreatorStep(s => Math.min(s + 1, 6))}
      onBack={() => creatorStep === 0 ? setRoute({ name: "home" }) : setCreatorStep(s => s - 1)}
      onPreview={() => setRoute({ name: "publicEvent", from: "creator" })}
      onPublish={() => { showToast("success", "Live. Share: mingla.com/e/lonelymoth/slowburn4"); setRoute({ name: "eventDetail" }); setTab("events"); }}
    />;
  } else if (route.name === "eventDetail") {
    screen = <EventDetailScreen
      onBack={() => setRoute({ name: "eventsList" })}
      onTab={goTab}
      onOrders={() => setRoute({ name: "orders" })}
      onScanner={() => { setScanState("idle"); setRoute({ name: "scanner" }); }}
      onShare={() => showToast("success", "Link copied to clipboard")}
      onGuests={() => { setApprovedIdx(-1); setRoute({ name: "guests" }); }}
      onPublic={() => setRoute({ name: "publicEvent", from: "eventDetail" })}
      onBrand={() => setRoute({ name: "publicBrand", from: "eventDetail" })}
    />;
  } else if (route.name === "scanner") {
    screen = <ScannerScreen
      onBack={() => setRoute({ name: "eventDetail" })}
      scanState={scanState}
      onScan={() => {
        setScanState("success");
        setTimeout(() => {
          setScanState("duplicate");
          setTimeout(() => setScanState("idle"), 1800);
        }, 1800);
      }}
      onCash={() => setRoute({ name: "cash" })}
      onManual={() => showToast("success", "Manual lookup ready — type a name or order ID")}
    />;
  } else if (route.name === "cash") {
    screen = <CashSaleScreen
      onBack={() => setRoute({ name: "scanner" })}
      onConfirm={() => setRoute({ name: "ticketQR" })}
    />;
  } else if (route.name === "ticketQR") {
    screen = <TicketQRScreen onBack={() => setRoute({ name: "scanner" })}/>;
  } else if (route.name === "orders") {
    screen = <OrdersScreen
      onBack={() => setRoute({ name: "eventDetail" })}
      onOrder={() => setRoute({ name: "orderDetail" })}
    />;
  } else if (route.name === "orderDetail") {
    screen = <>
      <OrderDetailScreen
        onBack={() => setRoute({ name: "orders" })}
        onRefund={() => setRefundOpen(true)}
        refunded={refunded}
      />
      {refundOpen && <RefundSheet
        onCancel={() => setRefundOpen(false)}
        onConfirm={() => {
          setRefundOpen(false);
          setRefunded(true);
          showToast("success", "Refunded. Marcus will see it in 3–5 days.");
        }}
      />}
    </>;
  } else if (route.name === "guests") {
    screen = <GuestsScreen
      onBack={() => setRoute({ name: "eventDetail" })}
      onApprove={(i) => { setApprovedIdx(i); showToast("success", "Approved. Tom got an email confirmation."); }}
      approvedIdx={approvedIdx}
    />;
  } else if (route.name === "publicEvent") {
    screen = <PublicEventScreen onBack={() => setRoute({ name: route.from === "creator" ? "creator" : route.from === "eventsList" ? "eventsList" : "eventDetail" })}/>;
  } else if (route.name === "publicBrand") {
    screen = <PublicBrandScreen
      onBack={() => setRoute({ name: route.from === "account" ? "account" : route.from === "brandProfile" ? "brandProfile" : route.from === "eventsList" ? "eventsList" : "eventDetail" })}
      following={following}
      onFollow={() => { setFollowing(f => !f); showToast("success", following ? "Unfollowed" : "Following Lonely Moth"); }}
    />;
  } else if (route.name === "account") {
    screen = <AccountScreen onTab={goTab} onDelete={() => { setDeleteStep(0); setRoute({ name: "deleteAcc" }); }} onBrand={() => setRoute({ name: "publicBrand", from: "account" })} onBrandsList={() => setRoute({ name: "brandsList" })}/>;
  } else if (route.name === "chat") {
    screen = <ChatScreen onTab={goTab}/>;
  } else if (route.name === "marketing") {
    screen = <MarketingScreen
      onTab={goTab}
      onAudience={() => setRoute({ name: "audience" })}
      onEmail={() => setRoute({ name: "emailTemplates" })}
      onSms={() => setRoute({ name: "smsCompose" })}
      onJourneys={() => setRoute({ name: "journeys" })}
      onCampaign={() => setRoute({ name: "emailCompose" })}
      onTemplates={() => setRoute({ name: "emailTemplates" })}
    />;
  } else if (route.name === "audience") {
    screen = <AudienceScreen
      onBack={() => setRoute({ name: "marketing" })}
      onProfile={(c) => setRoute({ name: "contact", contact: c })}
    />;
  } else if (route.name === "contact") {
    screen = <ContactProfileScreen onBack={() => setRoute({ name: "audience" })} contact={route.contact}/>;
  } else if (route.name === "emailTemplates") {
    screen = <EmailTemplatesScreen
      onBack={() => setRoute({ name: "marketing" })}
      onPick={() => setRoute({ name: "emailCompose" })}
    />;
  } else if (route.name === "emailCompose") {
    screen = <EmailComposerScreen
      onBack={() => setRoute({ name: "marketing" })}
      onSchedule={() => { showToast("success", "Sending to 2,418 — track in Marketing."); setRoute({ name: "marketing" }); }}
      onAudience={() => setRoute({ name: "audience" })}
      onPreview={() => showToast("success", "Test sent to hello@lonelymoth.events")}
    />;
  } else if (route.name === "smsCompose") {
    screen = <SmsComposerScreen onBack={() => setRoute({ name: "marketing" })}/>;
  } else if (route.name === "journeys") {
    screen = <JourneysScreen
      onBack={() => setRoute({ name: "marketing" })}
      onJourney={(j) => setRoute({ name: "journeyDetail", journey: j })}
    />;
  } else if (route.name === "journeyDetail") {
    screen = <JourneyDetailScreen onBack={() => setRoute({ name: "journeys" })} journey={route.journey}/>;
  } else if (route.name === "brandsList") {
    screen = <BrandsListScreen
      onBack={() => setRoute({ name: "account" })}
      onOpen={() => setRoute({ name: "brandProfile" })}
      onCreate={() => showToast("success", "Create-a-brand wizard coming up next")}
    />;
  } else if (route.name === "brandProfile") {
    screen = <BrandProfileScreen
      onBack={() => setRoute({ name: "brandsList" })}
      onPayments={() => setRoute({ name: "brandPayments" })}
      onTeam={() => showToast("success", "Team management opens next")}
      onPublic={() => setRoute({ name: "publicBrand", from: "brandProfile" })}
    />;
  } else if (route.name === "brandPayments") {
    screen = <BrandPaymentsScreen
      onBack={() => setRoute({ name: "brandProfile" })}
      onReports={() => setRoute({ name: "financeReports" })}
    />;
  } else if (route.name === "financeReports") {
    screen = <FinanceReportsScreen onBack={() => setRoute({ name: "brandPayments" })}/>;
  } else if (route.name === "deleteAcc") {
    screen = <DeleteScreen
      step={deleteStep}
      onBack={() => deleteStep === 0 ? setRoute({ name: "account" }) : setDeleteStep(s => s - 1)}
      onConfirm={() => {
        if (deleteStep === 3) setRoute({ name: "auth" });
        else setDeleteStep(s => s + 1);
      }}
    />;
  }

  return (
    <>
      {screen}
      {brandSwitcher && <BrandSwitcherSheet
        active={activeBrand}
        onPick={(id) => { setActiveBrand(id); setBrandSwitcher(false); showToast("success", `Switched to ${id === "lm" ? "Lonely Moth" : id === "tll" ? "The Long Lunch" : id === "sl" ? "Sunday Languor" : "Hidden Rooms"}`); }}
        onClose={() => setBrandSwitcher(false)}
        onCreate={() => { setBrandSwitcher(false); showToast("success", "New brand wizard coming next"); }}
        onManage={() => { setBrandSwitcher(false); setRoute({ name: "brandsList" }); }}
      />}
      {toast && <Toast {...toast}/>}
    </>
  );
}

window.PrototypeApp = PrototypeApp;
window.useBrandSwitcher = () => null;
