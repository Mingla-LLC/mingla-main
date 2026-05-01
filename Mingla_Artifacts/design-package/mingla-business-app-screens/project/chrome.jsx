/* global React */
const { useState: uS } = React;

// =================================================================
// SHARED CHROME — Status Bar, Top Bar, Bottom Nav
// =================================================================

const StatusBar = () => (
  <div style={{
    height: 44, padding: "0 24px",
    display: "flex", alignItems: "center", justifyContent: "space-between",
    fontSize: 15, fontWeight: 600, color: "var(--text)",
  }}>
    <span style={{fontFamily: "var(--font-sans)"}}>9:41</span>
    <div style={{display: "flex", gap: 6, alignItems: "center"}}>
      <svg width="18" height="11" viewBox="0 0 18 11" fill="none">
        <rect x="0.5" y="6" width="3" height="4" rx="0.5" fill="white"/>
        <rect x="5" y="4" width="3" height="6" rx="0.5" fill="white"/>
        <rect x="9.5" y="2" width="3" height="8" rx="0.5" fill="white"/>
        <rect x="14" y="0" width="3" height="10" rx="0.5" fill="white"/>
      </svg>
      <svg width="16" height="11" viewBox="0 0 16 11" fill="none">
        <path d="M8 2.5C9.8 2.5 11.5 3.2 12.7 4.4L13.7 3.4C12.2 2 10.2 1.1 8 1.1C5.8 1.1 3.8 2 2.3 3.4L3.3 4.4C4.5 3.2 6.2 2.5 8 2.5Z" fill="white"/>
        <path d="M8 5.5C9 5.5 9.9 5.9 10.6 6.5L11.6 5.5C10.6 4.6 9.4 4 8 4C6.6 4 5.4 4.6 4.4 5.5L5.4 6.5C6.1 5.9 7 5.5 8 5.5Z" fill="white"/>
        <circle cx="8" cy="9" r="1.5" fill="white"/>
      </svg>
      <svg width="26" height="11" viewBox="0 0 26 11" fill="none">
        <rect x="0.5" y="0.5" width="22" height="10" rx="2.5" stroke="white" strokeOpacity="0.4"/>
        <rect x="2" y="2" width="16" height="7" rx="1" fill="white"/>
        <path d="M23.5 4V7C24.3 6.8 24.8 6.1 24.8 5.5C24.8 4.9 24.3 4.2 23.5 4Z" fill="white" fillOpacity="0.4"/>
      </svg>
    </div>
  </div>
);

const TopBar = ({ title, brand = "Lonely Moth", onMenu, leftKind = "brand", onBack, right }) => (
  <div style={{
    position: "absolute", top: 44, left: 12, right: 12, height: 56,
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "0 16px",
    borderRadius: 999,
    background: "rgba(12, 14, 18, 0.34)",
    backdropFilter: "blur(22px) saturate(140%)",
    WebkitBackdropFilter: "blur(22px) saturate(140%)",
    border: "1px solid rgba(255,255,255,0.06)",
    boxShadow: "0 4px 12px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.10)",
    zIndex: 50,
  }}>
    <div style={{display: "flex", alignItems: "center", gap: 10, minWidth: 0}}>
      {leftKind === "back" ? (
        <button onClick={onBack} style={{
          width: 36, height: 36, borderRadius: 999, border: 0,
          background: "rgba(255,255,255,0.06)",
          display: "flex", alignItems: "center", justifyContent: "center",
          color: "white", cursor: "pointer",
        }}>
          <MinglaIcon name="chevL" size={20} />
        </button>
      ) : (
        <button onClick={onMenu} style={{
          display: "flex", alignItems: "center", gap: 8, border: 0,
          background: "transparent", color: "white", cursor: "pointer",
          padding: 0, minWidth: 0,
        }}>
          <MinglaMark size={28}/>
          <span style={{
            fontWeight: 700, fontSize: 15, letterSpacing: -0.2,
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            maxWidth: 130,
          }}>{brand}</span>
          <MinglaIcon name="chevD" size={16} color="rgba(255,255,255,0.6)"/>
        </button>
      )}
      {title && leftKind === "back" && (
        <span style={{fontWeight: 600, fontSize: 16, letterSpacing: -0.2}}>{title}</span>
      )}
    </div>
    <div style={{display: "flex", alignItems: "center", gap: 6}}>
      {right || (
        <>
          <IconChrome icon="search" />
          <IconChrome icon="bell" badge={2} />
        </>
      )}
    </div>
  </div>
);

const IconChrome = ({ icon, badge, onClick, active }) => (
  <button onClick={onClick} style={{
    position: "relative",
    width: 36, height: 36, borderRadius: 999, border: 0,
    background: active ? "var(--accent-tint)" : "rgba(255,255,255,0.06)",
    boxShadow: active ? "var(--shadow-active-glow)" : "none",
    display: "flex", alignItems: "center", justifyContent: "center",
    color: "white", cursor: "pointer",
  }}>
    <MinglaIcon name={icon} size={18}/>
    {badge != null && (
      <span style={{
        position: "absolute", top: -2, right: -2,
        minWidth: 16, height: 16, borderRadius: 999,
        background: "var(--accent)", color: "white",
        fontSize: 10, fontWeight: 700,
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "0 4px",
        border: "2px solid #0c0e12",
      }}>{badge}</span>
    )}
  </button>
);

const BottomNav = ({ active, onChange }) => {
  const tabs = [
    { id: "home", icon: "home", label: "Home" },
    { id: "events", icon: "calendar", label: "Events" },
    { id: "scan", icon: "qr", label: "Scan" },
    { id: "marketing", icon: "sparkle", label: "Market" },
    { id: "account", icon: "user", label: "Account" },
  ];
  return (
    <div style={{
      position: "absolute", bottom: 24, left: 16, right: 16, height: 72,
      borderRadius: 36,
      background: "rgba(12, 14, 18, 0.48)",
      backdropFilter: "blur(28px) saturate(140%)",
      WebkitBackdropFilter: "blur(28px) saturate(140%)",
      border: "1px solid rgba(255,255,255,0.06)",
      boxShadow: "0 4px 12px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.10)",
      display: "flex", alignItems: "center", padding: 6,
      zIndex: 50,
    }}>
      {tabs.map((t) => {
        const isActive = active === t.id;
        return (
          <button key={t.id} onClick={() => onChange(t.id)} style={{
            flex: 1, height: 60, border: 0, background: "transparent",
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            gap: 3, cursor: "pointer",
            color: isActive ? "white" : "rgba(255,255,255,0.55)",
            position: "relative",
          }}>
            {isActive && (
              <div style={{
                position: "absolute", inset: 4,
                background: "var(--accent-tint)",
                border: "1px solid var(--accent-border)",
                borderRadius: 30,
                boxShadow: "0 0 14px rgba(235, 120, 37, 0.35)",
                transition: "all 280ms var(--ease-out)",
              }}/>
            )}
            <div style={{position: "relative", zIndex: 1}}>
              <MinglaIcon name={t.icon} size={22}/>
            </div>
            <span style={{position: "relative", zIndex: 1, fontSize: 10, fontWeight: 600, letterSpacing: 0.2}}>{t.label}</span>
          </button>
        );
      })}
    </div>
  );
};

window.StatusBar = StatusBar;
window.TopBar = TopBar;
window.BottomNav = BottomNav;
window.IconChrome = IconChrome;
