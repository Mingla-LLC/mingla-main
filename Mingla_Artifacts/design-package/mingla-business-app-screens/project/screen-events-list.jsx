/* global React */

// =================================================================
// EVENTS LIST — All events the user has created.
// Tabs: Live · Upcoming · Drafts · Past. Each row has Manage menu.
// =================================================================

const EventsListScreen = ({ onTab, onOpenEvent, onCreate, onPublic, onBrand }) => {
  const [filter, setFilter] = React.useState("all");
  const [openMenu, setOpenMenu] = React.useState(null);

  const events = [
    { id: 1, status: "live", hue: 25, title: "Slow Burn vol. 4", date: "TONIGHT · 21:00", venue: "Hidden Rooms · EC2A", sold: 284, cap: 400, rev: "£8,420", soldDelta: "+12 today" },
    { id: 2, status: "live", hue: 290, title: "Sunday Languor Brunch", date: "SUN 17 MAY · 12:00", venue: "Room 8 · N1", sold: 62, cap: 80, rev: "£1,860", soldDelta: "+4 today" },
    { id: 3, status: "upcoming", hue: 350, title: "A Long Sit-Down", date: "SAT 30 MAY · 20:00", venue: "Brick House · N1", sold: 32, cap: 60, rev: "£1,920", soldDelta: "+8 this week" },
    { id: 4, status: "draft", hue: 200, title: "Slow Burn vol. 5", date: "FRI 12 JUN · 21:30", venue: "TBA", sold: 0, cap: 400, rev: "—", soldDelta: "Not published" },
    { id: 5, status: "draft", hue: 150, title: "The Long Lunch (Series)", date: "Recurring · weekly", venue: "Various", sold: 0, cap: 0, rev: "—", soldDelta: "Series template" },
    { id: 6, status: "past", hue: 60, title: "Slow Burn vol. 3", date: "FRI 18 APR · 21:00", venue: "Hidden Rooms · EC2A", sold: 392, cap: 400, rev: "£11,760", soldDelta: "98% capacity" },
    { id: 7, status: "past", hue: 320, title: "Easter Languor", date: "SUN 06 APR · 12:00", venue: "Room 8 · N1", sold: 78, cap: 80, rev: "£2,340", soldDelta: "Sold out" },
  ];

  const filtered = filter === "all" ? events : events.filter(e => e.status === filter);
  const counts = {
    all: events.length,
    live: events.filter(e => e.status === "live").length,
    upcoming: events.filter(e => e.status === "upcoming").length,
    draft: events.filter(e => e.status === "draft").length,
    past: events.filter(e => e.status === "past").length,
  };

  return (
    <div style={{position: "absolute", inset: 0, overflow: "hidden"}}>
      <div className="phone-bg"/>
      <div style={{position: "relative", zIndex: 1}}><StatusBar/></div>
      <TopBar
        title="Events"
        right={
          <>
            <IconChrome icon="search"/>
            <IconChrome icon="plus" onClick={onCreate}/>
          </>
        }
      />

      <div style={{
        position: "absolute", top: 116, left: 0, right: 0, bottom: 0,
        overflowY: "auto", padding: "8px 16px 130px", zIndex: 1,
      }} onClick={() => setOpenMenu(null)}>

        {/* Filter pills */}
        <div style={{display: "flex", gap: 8, marginBottom: 14, overflowX: "auto", paddingBottom: 4, marginLeft: -4, marginRight: -4, paddingLeft: 4, paddingRight: 4}}>
          {[
            { k: "all", l: "All", n: counts.all },
            { k: "live", l: "Live", n: counts.live, color: "var(--success)" },
            { k: "upcoming", l: "Upcoming", n: counts.upcoming },
            { k: "draft", l: "Drafts", n: counts.draft },
            { k: "past", l: "Past", n: counts.past },
          ].map((p) => {
            const active = filter === p.k;
            return (
              <button key={p.k} onClick={(e) => { e.stopPropagation(); setFilter(p.k); }} style={{
                height: 34, padding: "0 14px", borderRadius: 999,
                border: active ? "1px solid var(--accent-border)" : "1px solid var(--border-card)",
                background: active ? "var(--accent-tint)" : "var(--glass-card)",
                backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)",
                color: "white", fontSize: 13, fontWeight: 500, fontFamily: "inherit", cursor: "pointer",
                whiteSpace: "nowrap", flexShrink: 0,
                display: "flex", alignItems: "center", gap: 6,
              }}>
                {p.color && <span className="dot" style={{background: p.color}}/>}
                {p.l}
                <span style={{
                  fontSize: 11, fontWeight: 600,
                  color: active ? "var(--accent)" : "var(--text-tertiary)",
                  fontFamily: "var(--font-mono)",
                }}>{p.n}</span>
              </button>
            );
          })}
        </div>

        {/* Empty state */}
        {filtered.length === 0 && (
          <div className="glass-card" style={{padding: 32, textAlign: "center"}}>
            <div style={{fontSize: 14, color: "var(--text-secondary)"}}>No events here.</div>
          </div>
        )}

        {/* Event list */}
        <div style={{display: "flex", flexDirection: "column", gap: 10}}>
          {filtered.map((e) => (
            <EventListCard
              key={e.id}
              ev={e}
              menuOpen={openMenu === e.id}
              onMenuToggle={(ev) => { ev.stopPropagation(); setOpenMenu(openMenu === e.id ? null : e.id); }}
              onOpen={() => onOpenEvent(e)}
              onPublic={onPublic}
              onBrand={onBrand}
            />
          ))}
        </div>
      </div>

      <BottomNav active="events" onChange={onTab}/>
    </div>
  );
};

const EventListCard = ({ ev, menuOpen, onMenuToggle, onOpen, onPublic, onBrand }) => {
  const pct = ev.cap ? Math.min(100, Math.round((ev.sold / ev.cap) * 100)) : 0;
  return (
    <div className="glass-card" style={{
      padding: 0, position: "relative", overflow: "visible",
    }}>
      <button onClick={onOpen} style={{
        width: "100%", border: 0, background: "transparent", color: "white", padding: 12,
        fontFamily: "inherit", textAlign: "left", cursor: "pointer",
        display: "flex", gap: 12, alignItems: "stretch",
      }}>
        {/* Cover */}
        <div style={{
          width: 76, minHeight: 92, flexShrink: 0, borderRadius: 12, overflow: "hidden",
          position: "relative",
        }}>
          <EventCover hue={ev.hue} radius={12} label="" height="100%"/>
          {ev.status === "draft" && (
            <div style={{
              position: "absolute", inset: 0,
              background: "rgba(12,14,18,0.55)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontFamily: "var(--font-mono)", fontSize: 10, color: "rgba(255,255,255,0.7)",
              letterSpacing: 1.4, fontWeight: 700,
            }}>DRAFT</div>
          )}
        </div>

        {/* Body */}
        <div style={{flex: 1, minWidth: 0, display: "flex", flexDirection: "column", justifyContent: "space-between"}}>
          <div>
            <div style={{display: "flex", alignItems: "center", gap: 6, marginBottom: 4}}>
              <StatusPill status={ev.status}/>
            </div>
            <div style={{fontWeight: 600, fontSize: 15, letterSpacing: -0.2, marginBottom: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis"}}>
              {ev.title}
            </div>
            <div style={{fontSize: 11, color: "var(--text-tertiary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis"}}>
              {ev.date} · {ev.venue}
            </div>
          </div>

          {/* Stats row */}
          {ev.cap > 0 ? (
            <div style={{marginTop: 10, display: "flex", alignItems: "center", gap: 10}}>
              <div style={{flex: 1, height: 3, background: "rgba(255,255,255,0.08)", borderRadius: 999, overflow: "hidden"}}>
                <div style={{
                  width: `${pct}%`, height: "100%",
                  background: ev.status === "draft" ? "rgba(255,255,255,0.2)" : "var(--accent)",
                  borderRadius: 999,
                }}/>
              </div>
              <span className="mono" style={{fontSize: 11, color: "var(--text-secondary)", fontWeight: 600, flexShrink: 0}}>
                {ev.sold}/{ev.cap}
              </span>
            </div>
          ) : (
            <div style={{marginTop: 10, fontSize: 11, color: "var(--text-tertiary)"}}>{ev.soldDelta}</div>
          )}
        </div>
      </button>

      {/* Right rail: revenue + manage */}
      <div style={{
        position: "absolute", top: 12, right: 12,
        display: "flex", alignItems: "flex-start", gap: 4,
      }}>
        <button onClick={onMenuToggle} className="icon-chrome" style={{
          width: 32, height: 32, borderRadius: 999,
          border: "1px solid var(--border-card)",
          background: menuOpen ? "var(--accent-tint)" : "var(--glass-chrome)",
          color: "white", cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <MinglaIcon name="moreH" size={16}/>
        </button>
      </div>

      {/* Bottom rail: revenue strip */}
      {ev.status !== "draft" && (
        <div style={{
          position: "absolute", bottom: 12, right: 12,
          textAlign: "right",
          fontSize: 10, color: "var(--text-tertiary)",
          letterSpacing: 0.2, fontWeight: 500,
        }}>
          <div className="mono" style={{fontSize: 13, fontWeight: 700, color: "white"}}>{ev.rev}</div>
          <div style={{fontSize: 9, marginTop: 1}}>{ev.soldDelta}</div>
        </div>
      )}

      {/* Manage menu */}
      {menuOpen && (
        <div className="fade-up" style={{
          position: "absolute", top: 48, right: 12, zIndex: 50,
          minWidth: 200, padding: 4,
          borderRadius: 14,
          background: "rgba(20, 22, 26, 0.96)",
          border: "1px solid var(--border-card-elev)",
          backdropFilter: "blur(40px)", WebkitBackdropFilter: "blur(40px)",
          boxShadow: "0 16px 40px rgba(0,0,0,0.5)",
        }} onClick={(e) => e.stopPropagation()}>
          <MenuItem icon="edit" label="Edit details" onClick={onOpen}/>
          <MenuItem icon="eye" label="View public page" onClick={onPublic}/>
          {ev.status !== "draft" && <MenuItem icon="qr" label="Open scanner"/>}
          <MenuItem icon="ticket" label="Orders"/>
          <MenuItem icon="share" label="Copy share link"/>
          <MenuDivider/>
          {ev.status === "draft" && <MenuItem icon="check" label="Publish event" tone="accent"/>}
          {ev.status === "live" && <MenuItem icon="close" label="End ticket sales" tone="warn"/>}
          {ev.status === "upcoming" && <MenuItem icon="ticket" label="Duplicate"/>}
          {(ev.status === "draft" || ev.status === "upcoming") && <MenuItem icon="trash" label="Delete event" tone="danger"/>}
          {ev.status === "past" && <MenuItem icon="refund" label="Issue refunds"/>}
          {ev.status === "past" && <MenuItem icon="ticket" label="Duplicate as new"/>}
        </div>
      )}
    </div>
  );
};

const StatusPill = ({ status }) => {
  if (status === "live") return <span className="pill pill-live"><span className="dot live-pulse" style={{background: "var(--success)"}}/>LIVE</span>;
  if (status === "upcoming") return <span className="pill pill-accent">UPCOMING</span>;
  if (status === "draft") return <span className="pill pill-draft">DRAFT</span>;
  if (status === "past") return <span className="pill" style={{background: "rgba(255,255,255,0.04)", color: "var(--text-tertiary)", border: "1px solid rgba(255,255,255,0.08)"}}>ENDED</span>;
  return null;
};

const MenuItem = ({ icon, label, onClick, tone }) => {
  const colors = {
    accent: "var(--accent)",
    warn: "var(--warning)",
    danger: "var(--error)",
  };
  const c = colors[tone] || "white";
  return (
    <button onClick={onClick} style={{
      width: "100%", padding: "10px 12px", border: 0,
      background: "transparent", color: c,
      fontFamily: "inherit", fontSize: 13, fontWeight: 500, cursor: "pointer",
      display: "flex", alignItems: "center", gap: 10,
      borderRadius: 10, textAlign: "left",
    }}
    onMouseEnter={(e) => e.currentTarget.style.background = "rgba(255,255,255,0.04)"}
    onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}>
      <MinglaIcon name={icon} size={16} color={c}/>
      <span>{label}</span>
    </button>
  );
};

const MenuDivider = () => (
  <div style={{height: 1, background: "rgba(255,255,255,0.06)", margin: "4px 8px"}}/>
);

window.EventsListScreen = EventsListScreen;
