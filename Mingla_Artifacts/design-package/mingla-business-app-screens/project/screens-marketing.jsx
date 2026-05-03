/* global React */

// =================================================================
// MARKETING MODULE — Dashboard · Audience · Email · SMS ·
// Templates · Journeys · Compliance
// =================================================================

const MarketingScreen = ({ onTab, onAudience, onEmail, onSms, onJourneys, onCampaign, onTracking, onTemplates }) => (
  <div style={{position: "absolute", inset: 0, overflow: "hidden"}}>
    <div className="phone-bg"/>
    <div style={{position: "relative", zIndex: 1}}><StatusBar/></div>
    <TopBar title="" right={<><IconChrome icon="search"/><IconChrome icon="bell" badge={2}/></>}/>

    <div style={{
      position: "absolute", top: 116, left: 0, right: 0, bottom: 0,
      overflowY: "auto", padding: "8px 16px 130px", zIndex: 1,
    }}>
      {/* Heading */}
      <div style={{padding: "8px 8px 16px"}}>
        <div style={{fontSize: 13, color: "var(--text-tertiary)", letterSpacing: 0.4, fontWeight: 600, textTransform: "uppercase"}}>Marketing</div>
        <h1 style={{fontSize: 28, fontWeight: 700, letterSpacing: -0.2, margin: "4px 0 0"}}>Reach your people</h1>
      </div>

      {/* Headline KPI */}
      <div className="glass-card-elev" style={{padding: 18, marginBottom: 12}}>
        <div style={{display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 14}}>
          <div>
            <div style={{fontSize: 11, color: "var(--text-tertiary)", letterSpacing: 0.4, fontWeight: 600, textTransform: "uppercase", marginBottom: 4}}>Campaign revenue · 30d</div>
            <div className="mono" style={{fontSize: 28, fontWeight: 700, letterSpacing: -0.4, color: "white"}}>£6,240</div>
            <div style={{fontSize: 12, color: "var(--success)", fontWeight: 600, marginTop: 4}}>+34% vs prior · 33% of total revenue</div>
          </div>
          <div style={{
            width: 44, height: 44, borderRadius: 12, flexShrink: 0,
            background: "var(--accent-tint)", border: "1px solid var(--accent-border)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}><MinglaIcon name="trending" size={22} color="var(--accent)"/></div>
        </div>
        <div style={{display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8}}>
          <KpiCell label="Campaigns" value="14" sub="3 live"/>
          <KpiCell label="Open rate" value="42%" sub="+5 pts"/>
          <KpiCell label="Click rate" value="11%" sub="+2 pts"/>
        </div>
      </div>

      {/* Active campaigns */}
      <div style={{display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 8px 8px"}}>
        <h2 style={{fontSize: 16, fontWeight: 700, letterSpacing: -0.2, margin: 0}}>Live now</h2>
        <span style={{fontSize: 12, color: "var(--text-tertiary)", fontFamily: "var(--font-mono)"}}>3 ACTIVE</span>
      </div>
      <div style={{display: "flex", flexDirection: "column", gap: 8, marginBottom: 12}}>
        <CampaignRow channel="email" name="Slow Burn vol. 4 · last chance" sent="2,418" opens="1,142" clicks="284" rev="£1,420" onClick={onCampaign}/>
        <CampaignRow channel="sms" name="Tonight · doors at 9" sent="284" opens="—" clicks="62" rev="—" sub="Sending in 2h 14m"/>
        <CampaignRow channel="journey" name="Pre-event reminder · 24h" sent="1,824" opens="824" clicks="186" rev="£740"/>
      </div>

      {/* Quick actions */}
      <div style={{display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 8px 8px"}}>
        <h2 style={{fontSize: 16, fontWeight: 700, letterSpacing: -0.2, margin: 0}}>Make something</h2>
      </div>
      <div style={{display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12}}>
        <BigAction icon="mail" label="Email campaign" sub="2,418 opted in" onClick={onEmail} primary/>
        <BigAction icon="sms" label="SMS campaign" sub="1,124 opted in" onClick={onSms}/>
        <BigAction icon="branch" label="Automated journey" sub="6 templates" onClick={onJourneys}/>
        <BigAction icon="users" label="Audience" sub="2,418 contacts" onClick={onAudience}/>
      </div>

      {/* Tools */}
      <div style={{display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 8px 8px"}}>
        <h2 style={{fontSize: 16, fontWeight: 700, letterSpacing: -0.2, margin: 0}}>Tools</h2>
      </div>
      <div className="glass-card" style={{padding: 4}}>
        <Row3 onClick={onTracking} icon="link" label="Tracking links" sub="14 active · 3 sources"/>
        <Row3 onClick={onTemplates} icon="template" label="Template library" sub="Email · SMS · Journeys"/>
        <Row3 icon="target" label="Audience segments" sub="9 saved"/>
        <Row3 icon="shield" label="Compliance" sub="GDPR · opt-in · suppression" last/>
      </div>
    </div>

    <BottomNav active="marketing" onChange={onTab}/>
  </div>
);

const KpiCell = ({ label, value, sub }) => (
  <div>
    <div style={{fontSize: 10, color: "var(--text-tertiary)", letterSpacing: 0.4, fontWeight: 600, textTransform: "uppercase"}}>{label}</div>
    <div className="mono" style={{fontSize: 18, fontWeight: 700, color: "white", marginTop: 4}}>{value}</div>
    <div style={{fontSize: 10, color: "var(--success)", fontWeight: 600, marginTop: 2}}>{sub}</div>
  </div>
);

const CampaignRow = ({ channel, name, sent, opens, clicks, rev, sub, onClick }) => {
  const channelMeta = {
    email: { icon: "mail", color: "var(--info)", bg: "var(--info-tint)" },
    sms: { icon: "sms", color: "var(--success)", bg: "var(--success-tint)" },
    journey: { icon: "branch", color: "var(--accent)", bg: "var(--accent-tint)" },
  }[channel];
  return (
    <button onClick={onClick} className="glass-card" style={{
      padding: 12, border: 0, color: "white", fontFamily: "inherit", cursor: "pointer", textAlign: "left",
      display: "flex", alignItems: "center", gap: 12,
    }}>
      <div style={{width: 36, height: 36, borderRadius: 10, background: channelMeta.bg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0}}>
        <MinglaIcon name={channelMeta.icon} size={16} color={channelMeta.color}/>
      </div>
      <div style={{flex: 1, minWidth: 0}}>
        <div style={{fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis"}}>{name}</div>
        <div style={{fontSize: 11, color: "var(--text-tertiary)", marginTop: 2}}>
          {sub || <>Sent {sent} · {opens !== "—" && `${opens} opens · `}{clicks} clicks</>}
        </div>
      </div>
      {rev !== "—" && (
        <div style={{textAlign: "right", flexShrink: 0}}>
          <div className="mono" style={{fontSize: 13, fontWeight: 700, color: "var(--success)"}}>{rev}</div>
          <div style={{fontSize: 10, color: "var(--text-tertiary)"}}>attributed</div>
        </div>
      )}
    </button>
  );
};

const BigAction = ({ icon, label, sub, onClick, primary }) => (
  <button onClick={onClick} className="glass-card" style={{
    padding: 14, border: 0, fontFamily: "inherit", cursor: "pointer", textAlign: "left",
    display: "flex", flexDirection: "column", gap: 8, color: "white",
    background: primary ? "linear-gradient(135deg, rgba(235,120,37,0.18), rgba(235,120,37,0.06))" : undefined,
    borderColor: primary ? "var(--accent-border)" : undefined,
    boxShadow: primary ? "0 0 14px rgba(235,120,37,0.2)" : undefined,
  }}>
    <div style={{
      width: 36, height: 36, borderRadius: 999,
      background: primary ? "var(--accent)" : "rgba(255,255,255,0.06)",
      display: "flex", alignItems: "center", justifyContent: "center",
    }}><MinglaIcon name={icon} size={18}/></div>
    <div>
      <div style={{fontSize: 14, fontWeight: 600}}>{label}</div>
      <div style={{fontSize: 11, color: "var(--text-secondary)"}}>{sub}</div>
    </div>
  </button>
);

// =================================================================
// AUDIENCE
// =================================================================

const AudienceScreen = ({ onBack, onProfile }) => {
  const [tab, setTab] = React.useState("all");
  const segments = [
    { k: "all",  l: "Everyone", n: "2,418", c: "rgba(255,255,255,0.6)" },
    { k: "vip",  l: "VIP", n: "184", c: "var(--accent)" },
    { k: "rep",  l: "Repeat (3+)", n: "428", c: "var(--info)" },
    { k: "new",  l: "New (30d)", n: "184", c: "var(--success)" },
    { k: "wait", l: "On waitlist", n: "62", c: "var(--warning)" },
    { k: "dorm", l: "Dormant 90d+", n: "412", c: "var(--text-tertiary)" },
  ];
  const contacts = [
    { n: "Marcus Lin", e: "marcus.l@email.com", tags: ["VIP", "Repeat 7×"], spent: "£420", last: "Tonight" },
    { n: "Adaeze K.",  e: "ade.k@email.com",   tags: ["Repeat 4×"],          spent: "£280", last: "8m ago" },
    { n: "Theo R.",    e: "theo.r@email.com",  tags: ["New"],                spent: "£35",  last: "14m ago" },
    { n: "Priya V.",   e: "priya@email.com",   tags: ["VIP", "Repeat 5×"],   spent: "£540", last: "1h ago" },
    { n: "Jules N.",   e: "jules.n@email.com", tags: ["Refund"],             spent: "£0",   last: "1h ago" },
    { n: "Lina W.",    e: "lina@email.com",    tags: ["Pending"],            spent: "£35",  last: "2h ago" },
    { n: "Ben T.",     e: "ben.t@email.com",   tags: ["Dormant"],            spent: "£140", last: "112d ago" },
  ];

  return (
    <div style={{position: "absolute", inset: 0, overflow: "hidden"}}>
      <div className="phone-bg"/>
      <div style={{position: "relative", zIndex: 1}}><StatusBar/></div>
      <TopBar leftKind="back" onBack={onBack} title="Audience" right={<><IconChrome icon="upload"/><IconChrome icon="filter"/></>}/>

      <div style={{position: "absolute", top: 116, left: 0, right: 0, bottom: 0, overflowY: "auto", padding: "8px 16px 32px", zIndex: 1}}>
        {/* Segments scroll */}
        <div style={{display: "flex", gap: 8, marginBottom: 12, overflowX: "auto", paddingBottom: 4}}>
          {segments.map((s) => {
            const a = s.k === tab;
            return (
              <button key={s.k} onClick={() => setTab(s.k)} className={a ? "" : "glass-card"} style={{
                height: 36, padding: "0 14px", borderRadius: 999,
                border: a ? "1px solid var(--accent-border)" : undefined,
                background: a ? "var(--accent-tint)" : undefined,
                color: "white", fontSize: 13, fontWeight: 500, fontFamily: "inherit", cursor: "pointer",
                whiteSpace: "nowrap", flexShrink: 0,
                display: "flex", alignItems: "center", gap: 6,
              }}>
                <span className="dot" style={{background: s.c}}/>
                {s.l}
                <span style={{fontSize: 11, color: a ? "var(--accent)" : "var(--text-tertiary)", fontFamily: "var(--font-mono)"}}>{s.n}</span>
              </button>
            );
          })}
        </div>

        {/* Segment summary */}
        <div className="glass-card-elev" style={{padding: 16, marginBottom: 12}}>
          <div style={{display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 12}}>
            <div>
              <div className="mono" style={{fontSize: 24, fontWeight: 700, color: "white"}}>2,418</div>
              <div style={{fontSize: 12, color: "var(--text-secondary)"}}>contacts in this view</div>
            </div>
            <button className="btn-secondary" style={{height: 32, fontSize: 12, padding: "0 12px"}}>
              <MinglaIcon name="send" size={12}/> Message all
            </button>
          </div>
          <div style={{display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8}}>
            <KpiCell label="Email opt-in" value="2,418" sub="100%"/>
            <KpiCell label="SMS opt-in" value="1,124" sub="46%"/>
            <KpiCell label="Avg spend" value="£74" sub="+£8 LTV"/>
          </div>
        </div>

        {/* Manage row */}
        <div style={{display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginBottom: 14}}>
          <Mini icon="upload" label="Import"/>
          <Mini icon="download" label="Export"/>
          <Mini icon="tag" label="Tags"/>
        </div>

        <SectionLbl>Recent activity</SectionLbl>
        <div className="glass-card" style={{padding: 4}}>
          {contacts.map((c, i) => (
            <button key={i} onClick={() => onProfile(c)} style={{
              width: "100%", padding: 12, border: 0, background: "transparent", color: "white", fontFamily: "inherit",
              cursor: "pointer", textAlign: "left",
              display: "flex", alignItems: "center", gap: 12,
              borderBottom: i === contacts.length - 1 ? 0 : "1px solid rgba(255,255,255,0.04)",
            }}>
              <div style={{
                width: 36, height: 36, borderRadius: 999,
                background: `oklch(0.55 0.15 ${(i*73) % 360})`,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontWeight: 700, fontSize: 13, flexShrink: 0,
              }}>{c.n.split(" ").map(s => s[0]).join("")}</div>
              <div style={{flex: 1, minWidth: 0}}>
                <div style={{fontSize: 13, fontWeight: 600}}>{c.n}</div>
                <div style={{fontSize: 11, color: "var(--text-tertiary)", display: "flex", gap: 4, alignItems: "center", marginTop: 2}}>
                  {c.tags.map((t, ti) => (
                    <span key={ti} style={{
                      padding: "1px 6px", borderRadius: 4, fontSize: 10, fontWeight: 600,
                      background: t === "VIP" ? "var(--accent-tint)" : t === "Refund" ? "var(--error-tint)" : t === "New" ? "var(--success-tint)" : "rgba(255,255,255,0.06)",
                      color: t === "VIP" ? "var(--accent)" : t === "Refund" ? "var(--error)" : t === "New" ? "var(--success)" : "var(--text-tertiary)",
                    }}>{t}</span>
                  ))}
                </div>
              </div>
              <div style={{textAlign: "right", flexShrink: 0}}>
                <div className="mono" style={{fontSize: 12, fontWeight: 600}}>{c.spent}</div>
                <div style={{fontSize: 10, color: "var(--text-tertiary)"}}>{c.last}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

const Mini = ({ icon, label, onClick }) => (
  <button onClick={onClick} className="glass-card" style={{
    padding: 12, border: 0, color: "white", fontFamily: "inherit", cursor: "pointer",
    display: "flex", alignItems: "center", justifyContent: "center", gap: 6, fontSize: 12, fontWeight: 600,
  }}>
    <MinglaIcon name={icon} size={14}/>
    {label}
  </button>
);

// =================================================================
// CONTACT PROFILE
// =================================================================

const ContactProfileScreen = ({ onBack, contact = {} }) => {
  const c = { n: "Marcus Lin", e: "marcus.l@email.com", phone: "+44 7700 900 412", spent: "£420", last: "Tonight", tags: ["VIP", "Repeat 7×", "Lonely Moth"], ...contact };
  return (
    <div style={{position: "absolute", inset: 0, overflow: "hidden"}}>
      <div className="phone-bg"/>
      <div style={{position: "relative", zIndex: 1}}><StatusBar/></div>
      <TopBar leftKind="back" onBack={onBack} title="" right={<><IconChrome icon="mail"/><IconChrome icon="moreH"/></>}/>

      <div style={{position: "absolute", top: 116, left: 0, right: 0, bottom: 0, overflowY: "auto", padding: "12px 16px 32px", zIndex: 1}}>
        {/* Header */}
        <div className="glass-card-elev" style={{padding: 20, marginBottom: 12, textAlign: "center"}}>
          <div style={{
            width: 72, height: 72, borderRadius: 999,
            background: "oklch(0.5 0.15 50)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontWeight: 700, fontSize: 26, color: "white", margin: "0 auto 12px",
            border: "2px solid rgba(255,255,255,0.12)",
          }}>{c.n.split(" ").map(s => s[0]).join("")}</div>
          <div style={{fontWeight: 700, fontSize: 20, letterSpacing: -0.2}}>{c.n}</div>
          <div style={{fontSize: 13, color: "var(--text-secondary)", marginTop: 2}}>{c.e}</div>
          <div style={{display: "flex", justifyContent: "center", gap: 6, marginTop: 12, flexWrap: "wrap"}}>
            {c.tags.map((t, i) => (
              <span key={i} className="pill pill-accent" style={{fontSize: 10}}>{t}</span>
            ))}
          </div>
        </div>

        {/* Stats */}
        <div style={{display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 12}}>
          <KpiTileSm label="Lifetime" value="£420"/>
          <KpiTileSm label="Orders" value="7"/>
          <KpiTileSm label="Last seen" value="Tonight"/>
        </div>

        {/* Quick actions */}
        <div style={{display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 6, marginBottom: 16}}>
          <Mini icon="mail" label="Email"/>
          <Mini icon="sms" label="SMS"/>
          <Mini icon="tag" label="Tag"/>
          <Mini icon="ticket" label="Comp"/>
        </div>

        <SectionLbl>Purchase history</SectionLbl>
        <div className="glass-card" style={{padding: 4, marginBottom: 12}}>
          {[
            { t: "Slow Burn vol. 4", d: "Tonight", a: "£70.00", n: "2 × GA"},
            { t: "Slow Burn vol. 3", d: "18 Apr", a: "£35.00", n: "1 × GA"},
            { t: "A Long Sit-Down",  d: "12 Mar", a: "£75.00", n: "1 × VIP"},
            { t: "Sunday Languor",   d: "02 Mar", a: "£35.00", n: "1 × Brunch"},
          ].map((p, i, arr) => (
            <div key={i} style={{
              padding: 12, display: "flex", alignItems: "center", gap: 12,
              borderBottom: i === arr.length - 1 ? 0 : "1px solid rgba(255,255,255,0.04)",
            }}>
              <div style={{flex: 1, minWidth: 0}}>
                <div style={{fontSize: 13, fontWeight: 600}}>{p.t}</div>
                <div style={{fontSize: 11, color: "var(--text-tertiary)", marginTop: 2}}>{p.d} · {p.n}</div>
              </div>
              <span className="mono" style={{fontSize: 13, fontWeight: 600}}>{p.a}</span>
            </div>
          ))}
        </div>

        <SectionLbl>Notes</SectionLbl>
        <div className="glass-card" style={{padding: 14, fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.5, marginBottom: 12}}>
          "Met at vol. 2 — runs an architecture studio in Hackney. Likes early arrival. Add to VIP guestlist by default." <br/>
          <span style={{fontSize: 11, color: "var(--text-tertiary)"}}>— Sara, 18 Apr</span>
        </div>

        <SectionLbl>Communication</SectionLbl>
        <div className="glass-card" style={{padding: 4}}>
          <Row3 icon="mail" label="Email opted in" sub="13 sent · 9 opens" tone="success"/>
          <Row3 icon="sms" label="SMS opted in" sub="4 sent · 4 delivered" tone="success"/>
          <Row3 icon="bell" label="Reminder · 24h before" sub="Subscribed" last/>
        </div>
      </div>
    </div>
  );
};

const KpiTileSm = ({ label, value }) => (
  <div className="glass-card" style={{padding: 12, textAlign: "center"}}>
    <div className="mono" style={{fontSize: 16, fontWeight: 700, color: "white"}}>{value}</div>
    <div style={{fontSize: 10, color: "var(--text-tertiary)", marginTop: 2}}>{label}</div>
  </div>
);

window.MarketingScreen = MarketingScreen;
window.AudienceScreen = AudienceScreen;
window.ContactProfileScreen = ContactProfileScreen;
