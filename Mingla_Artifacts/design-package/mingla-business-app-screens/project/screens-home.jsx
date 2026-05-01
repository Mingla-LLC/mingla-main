/* global React */
const { useState: useS } = React;

// =================================================================
// HOME, EVENTS LIST, EVENT DETAIL
// =================================================================

const HomeScreen = ({ onTab, onOpenEvent, onCreate, onSwitchBrand }) => (
  <div style={{position: "absolute", inset: 0, overflow: "hidden"}}>
    <div className="phone-bg"/>
    <div style={{position: "relative", zIndex: 1}}>
      <StatusBar/>
    </div>
    <TopBar brand="Lonely Moth" onMenu={onSwitchBrand}/>

    <div style={{
      position: "absolute", top: 116, left: 0, right: 0, bottom: 0,
      overflowY: "auto", padding: "16px 16px 130px", zIndex: 1,
    }}>
      {/* Greeting */}
      <div style={{padding: "8px 8px 16px"}}>
        <div style={{fontSize: 13, color: "var(--text-tertiary)", letterSpacing: 0.4, fontWeight: 600, textTransform: "uppercase"}}>Friday evening</div>
        <h1 style={{fontSize: 28, fontWeight: 700, letterSpacing: -0.2, margin: "4px 0 0"}}>Hey, Sara</h1>
      </div>

      {/* Hero KPI tile - elevated */}
      <div className="glass-card-elev fade-up" style={{padding: 20, marginBottom: 12}}>
        <div style={{display: "flex", alignItems: "center", gap: 8, marginBottom: 14}}>
          <span className="dot live-pulse" style={{background: "var(--success)"}}/>
          <span style={{fontSize: 11, fontWeight: 700, color: "var(--success)", letterSpacing: 1.4, textTransform: "uppercase"}}>Live tonight</span>
        </div>
        <div style={{fontSize: 13, color: "var(--text-secondary)", marginBottom: 4}}>Slow Burn vol. 4 · Door opens 21:00</div>
        <div className="mono" style={{fontSize: 32, fontWeight: 700, letterSpacing: -0.4, marginBottom: 16, color: "white"}}>
          £8,420<span style={{fontSize: 18, color: "var(--text-tertiary)", fontWeight: 500}}> / £12,000</span>
        </div>
        <div style={{height: 4, background: "rgba(255,255,255,0.08)", borderRadius: 999, overflow: "hidden", marginBottom: 14}}>
          <div style={{width: "70%", height: "100%", background: "linear-gradient(90deg, #f97316, #eb7825)", borderRadius: 999}}/>
        </div>
        <div style={{display: "flex", justifyContent: "space-between"}}>
          <Stat label="Tickets sold" value="284"/>
          <Stat label="Capacity" value="400"/>
          <Stat label="Scanned" value="0" sub="opens 8pm"/>
        </div>
      </div>

      {/* KPI grid */}
      <div style={{display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12}}>
        <KpiTile label="Last 7 days" value="£24,180" delta="+18%" deltaUp/>
        <KpiTile label="Active events" value="3" sub="2 live · 1 draft"/>
      </div>

      {/* Section header */}
      <div style={{display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 8px 12px"}}>
        <h2 style={{fontSize: 18, fontWeight: 700, letterSpacing: -0.2, margin: 0}}>Upcoming</h2>
        <button className="btn-ghost" style={{padding: 0, fontSize: 14, color: "var(--accent)", border: 0, background: "transparent", cursor: "pointer"}}>See all</button>
      </div>

      {/* Event rows */}
      <div style={{display: "flex", flexDirection: "column", gap: 10}}>
        <EventRow onClick={onOpenEvent} status="live" hue={25} title="Slow Burn vol. 4" date="Tonight · 21:00" sold="284 / 400"/>
        <EventRow status="live" hue={290} title="Sunday Languor Brunch" date="Sun · 12:00" sold="62 / 80"/>
        <EventRow status="draft" hue={150} title="The Long Lunch (Series)" date="Recurring · weekly" sold="—"/>
      </div>

      {/* Create CTA */}
      <button onClick={onCreate} className="glass-card" style={{
        width: "100%", marginTop: 16, padding: 16,
        display: "flex", alignItems: "center", gap: 12,
        border: "1px dashed rgba(255,255,255,0.2)",
        cursor: "pointer", color: "white", textAlign: "left",
        fontFamily: "inherit",
      }}>
        <div style={{
          width: 40, height: 40, borderRadius: 999,
          background: "var(--accent-tint)", border: "1px solid var(--accent-border)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}><MinglaIcon name="plus" size={20}/></div>
        <div>
          <div style={{fontWeight: 600, fontSize: 15}}>Build a new event</div>
          <div style={{fontSize: 12, color: "var(--text-secondary)"}}>About 4 minutes</div>
        </div>
      </button>
    </div>

    <BottomNav active="home" onChange={onTab}/>
  </div>
);

const Stat = ({ label, value, sub }) => (
  <div>
    <div className="mono" style={{fontSize: 18, fontWeight: 700, color: "white"}}>{value}</div>
    <div style={{fontSize: 11, color: "var(--text-tertiary)", marginTop: 2}}>{label}</div>
    {sub && <div style={{fontSize: 10, color: "var(--text-quaternary)"}}>{sub}</div>}
  </div>
);

const KpiTile = ({ label, value, delta, deltaUp, sub }) => (
  <div className="glass-card" style={{padding: 14}}>
    <div style={{fontSize: 11, color: "var(--text-tertiary)", marginBottom: 4, letterSpacing: 0.2, fontWeight: 600, textTransform: "uppercase"}}>{label}</div>
    <div className="mono" style={{fontSize: 22, fontWeight: 700, letterSpacing: -0.2, color: "white"}}>{value}</div>
    {delta && (
      <div style={{fontSize: 12, color: deltaUp ? "var(--success)" : "var(--error)", marginTop: 4, fontWeight: 600}}>
        {delta} vs prior
      </div>
    )}
    {sub && <div style={{fontSize: 12, color: "var(--text-secondary)", marginTop: 4}}>{sub}</div>}
  </div>
);

const EventRow = ({ onClick, status, hue, title, date, sold }) => (
  <button onClick={onClick} className="glass-card" style={{
    display: "flex", alignItems: "center", gap: 12, padding: 10,
    border: 0, color: "white", textAlign: "left", cursor: "pointer",
    fontFamily: "inherit",
  }}>
    <div style={{width: 56, height: 56, flexShrink: 0}}>
      <EventCover hue={hue} radius={12} label="" />
    </div>
    <div style={{flex: 1, minWidth: 0}}>
      <div style={{display: "flex", alignItems: "center", gap: 6, marginBottom: 2}}>
        <span className={status === "live" ? "pill pill-live" : "pill pill-draft"}>
          {status === "live" && <span className="dot" style={{background: "var(--success)"}}/>}
          {status === "live" ? "LIVE" : "DRAFT"}
        </span>
      </div>
      <div style={{fontWeight: 600, fontSize: 15, letterSpacing: -0.1, marginBottom: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis"}}>{title}</div>
      <div style={{fontSize: 12, color: "var(--text-secondary)"}}>{date}</div>
    </div>
    <div style={{textAlign: "right", paddingRight: 4}}>
      <div className="mono" style={{fontSize: 13, fontWeight: 600}}>{sold}</div>
      <div style={{fontSize: 10, color: "var(--text-tertiary)"}}>sold</div>
    </div>
  </button>
);

// ===== EVENT DETAIL =====
const EventDetailScreen = ({ onBack, onTab, onOrders, onScanner, onShare, onGuests, onPublic, onBrand }) => (
  <div style={{position: "absolute", inset: 0, overflow: "hidden"}}>
    <div className="phone-bg"/>
    <div style={{position: "relative", zIndex: 1}}>
      <StatusBar/>
    </div>
    <TopBar leftKind="back" onBack={onBack} title="Event"
      right={<><IconChrome icon="share" onClick={onShare}/><IconChrome icon="moreH"/></>}
    />

    <div style={{
      position: "absolute", top: 116, left: 0, right: 0, bottom: 0,
      overflowY: "auto", padding: "16px 16px 130px", zIndex: 1,
    }}>
      {/* Hero */}
      <div style={{position: "relative", marginBottom: 12, height: 200, borderRadius: 24, overflow: "hidden"}}>
        <EventCover hue={25} radius={24} label="event cover" height="100%"/>
        <div style={{position: "absolute", left: 16, right: 16, bottom: 16}}>
          <span className="pill pill-live" style={{marginBottom: 8}}>
            <span className="dot live-pulse" style={{background: "var(--success)"}}/>LIVE TONIGHT
          </span>
          <h1 style={{fontSize: 24, fontWeight: 700, letterSpacing: -0.2, margin: "8px 0 4px", color: "white", textShadow: "0 2px 12px rgba(0,0,0,0.4)"}}>Slow Burn vol. 4</h1>
          <div style={{fontSize: 13, color: "rgba(255,255,255,0.85)"}}>Friday · 9:00 PM · Hidden Rooms, EC2A</div>
        </div>
      </div>

      {/* Action grid */}
      <div style={{display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12}}>
        <ActionTile icon="qr" label="Scan tickets" onClick={onScanner} primary/>
        <ActionTile icon="ticket" label="Orders" sub="284 sold" onClick={onOrders}/>
        <ActionTile icon="user" label="Guests" sub="3 pending" onClick={onGuests}/>
        <ActionTile icon="eye" label="Public page" onClick={onPublic}/>
        <ActionTile icon="user" label="Brand page" sub="2,418 followers" onClick={onBrand}/>
      </div>

      {/* Revenue card */}
      <div className="glass-card-elev" style={{padding: 18, marginBottom: 12}}>
        <div style={{display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12}}>
          <div>
            <div style={{fontSize: 11, color: "var(--text-tertiary)", letterSpacing: 0.4, fontWeight: 600, textTransform: "uppercase", marginBottom: 4}}>Revenue</div>
            <div className="mono" style={{fontSize: 26, fontWeight: 700, letterSpacing: -0.4, color: "white"}}>£8,420.00</div>
          </div>
          <div style={{textAlign: "right"}}>
            <div style={{fontSize: 11, color: "var(--text-tertiary)", letterSpacing: 0.4, fontWeight: 600, textTransform: "uppercase", marginBottom: 4}}>Payout</div>
            <div className="mono" style={{fontSize: 16, fontWeight: 600, color: "var(--text-secondary)"}}>£8,083.20</div>
          </div>
        </div>
        <SparklineBar/>
      </div>

      {/* Ticket types */}
      <div style={{padding: "8px 4px 8px"}}>
        <div style={{fontSize: 11, color: "var(--text-tertiary)", letterSpacing: 1.4, fontWeight: 600, textTransform: "uppercase"}}>Ticket types</div>
      </div>
      <div style={{display: "flex", flexDirection: "column", gap: 8}}>
        <TicketTypeRow name="Early Bird" price="£25" sold={120} cap={120} sold_out/>
        <TicketTypeRow name="General Admission" price="£35" sold={148} cap={250}/>
        <TicketTypeRow name="VIP / Lounge" price="£75" sold={16} cap={30}/>
      </div>

      {/* Recent activity */}
      <div style={{padding: "20px 4px 8px"}}>
        <div style={{fontSize: 11, color: "var(--text-tertiary)", letterSpacing: 1.4, fontWeight: 600, textTransform: "uppercase"}}>Recent activity</div>
      </div>
      <div className="glass-card" style={{padding: 4}}>
        <ActivityRow icon="ticket" color="var(--success)" title="Marcus L. bought 2 × GA" time="2m ago" amt="+£70.00"/>
        <ActivityRow icon="user" color="var(--info)" title="3 new approval requests" time="14m ago"/>
        <ActivityRow icon="refund" color="var(--warning)" title="Refund — Jules N. · 1 × VIP" time="1h ago" amt="-£75.00" last/>
      </div>
    </div>

    <BottomNav active="events" onChange={onTab}/>
  </div>
);

const ActionTile = ({ icon, label, sub, onClick, primary }) => (
  <button onClick={onClick} className="glass-card" style={{
    padding: 14, border: 0,
    background: primary ? "linear-gradient(135deg, rgba(235,120,37,0.18), rgba(235,120,37,0.08))" : undefined,
    borderColor: primary ? "var(--accent-border)" : undefined,
    color: "white", cursor: "pointer", fontFamily: "inherit", textAlign: "left",
    display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 8,
    boxShadow: primary ? "0 0 14px rgba(235, 120, 37, 0.25)" : undefined,
  }}>
    <div style={{
      width: 36, height: 36, borderRadius: 999,
      background: primary ? "var(--accent)" : "rgba(255,255,255,0.06)",
      display: "flex", alignItems: "center", justifyContent: "center",
    }}><MinglaIcon name={icon} size={18}/></div>
    <div>
      <div style={{fontWeight: 600, fontSize: 14}}>{label}</div>
      {sub && <div style={{fontSize: 11, color: "var(--text-secondary)"}}>{sub}</div>}
    </div>
  </button>
);

const SparklineBar = () => {
  const data = [12, 18, 24, 22, 38, 52, 64, 74, 82, 70];
  return (
    <div style={{display: "flex", alignItems: "flex-end", gap: 4, height: 48}}>
      {data.map((v, i) => (
        <div key={i} style={{
          flex: 1, height: `${v}%`,
          background: i === data.length - 1
            ? "linear-gradient(180deg, #fb923c, #eb7825)"
            : "rgba(255,255,255,0.16)",
          borderRadius: 3,
        }}/>
      ))}
    </div>
  );
};

const TicketTypeRow = ({ name, price, sold, cap, sold_out }) => (
  <div className="glass-card" style={{padding: 14, display: "flex", flexDirection: "column", gap: 8}}>
    <div style={{display: "flex", alignItems: "center", justifyContent: "space-between"}}>
      <div style={{display: "flex", alignItems: "center", gap: 8}}>
        <span style={{fontWeight: 600, fontSize: 14}}>{name}</span>
        {sold_out && <span className="pill pill-warn">SOLD OUT</span>}
      </div>
      <span className="mono" style={{fontWeight: 600}}>{price}</span>
    </div>
    <div style={{display: "flex", alignItems: "center", gap: 10}}>
      <div style={{flex: 1, height: 4, background: "rgba(255,255,255,0.08)", borderRadius: 999, overflow: "hidden"}}>
        <div style={{
          width: `${(sold/cap)*100}%`, height: "100%",
          background: sold_out ? "var(--warning)" : "var(--accent)", borderRadius: 999,
        }}/>
      </div>
      <span className="mono" style={{fontSize: 12, color: "var(--text-secondary)", flexShrink: 0}}>{sold}/{cap}</span>
    </div>
  </div>
);

const ActivityRow = ({ icon, color, title, time, amt, last }) => (
  <div style={{
    padding: 12, display: "flex", alignItems: "center", gap: 12,
    borderBottom: last ? 0 : "1px solid rgba(255,255,255,0.04)",
  }}>
    <div style={{
      width: 32, height: 32, borderRadius: 999,
      background: `color-mix(in srgb, ${color} 18%, transparent)`,
      display: "flex", alignItems: "center", justifyContent: "center",
    }}><MinglaIcon name={icon} size={14} color={color}/></div>
    <div style={{flex: 1, minWidth: 0}}>
      <div style={{fontSize: 13, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis"}}>{title}</div>
      <div style={{fontSize: 11, color: "var(--text-tertiary)"}}>{time}</div>
    </div>
    {amt && <div className="mono" style={{fontSize: 13, fontWeight: 600, color: amt.startsWith("-") ? "var(--error)" : "var(--success)"}}>{amt}</div>}
  </div>
);

window.HomeScreen = HomeScreen;
window.EventDetailScreen = EventDetailScreen;
