/* global React */

// =================================================================
// PUBLIC BRAND PAGE — the brand's storefront on Mingla.
// Audience-facing. What guests see when they land on mingla.com/lonelymoth
// =================================================================

const PublicBrandScreen = ({ onBack, following, onFollow }) => {
  const events = [
    { date: "FRI 15 MAY", time: "9:00 PM", title: "Slow Burn vol. 4", venue: "Hidden Rooms · East London", price: "£35", left: "14 left", hue: 25, status: "selling" },
    { date: "SAT 30 MAY", time: "8:00 PM", title: "A Long Sit-Down", venue: "Brick House · N1", price: "£60", left: "Half full", hue: 350, status: "selling" },
    { date: "FRI 12 JUN", time: "9:30 PM", title: "Slow Burn vol. 5", venue: "Address TBA", price: "£35", left: "Early access", hue: 280, status: "preview" },
  ];

  return (
    <div style={{position: "absolute", inset: 0, overflow: "hidden", background: "#0c0e12"}}>
      {/* Cover band */}
      <div style={{position: "absolute", top: 0, left: 0, right: 0, height: 220, zIndex: 0}}>
        <div style={{
          position: "absolute", inset: 0,
          background: `
            radial-gradient(60% 80% at 30% 30%, oklch(0.55 0.18 25 / 0.55), transparent 60%),
            radial-gradient(50% 70% at 80% 60%, oklch(0.45 0.16 320 / 0.55), transparent 60%),
            linear-gradient(135deg, oklch(0.18 0.05 30), oklch(0.14 0.04 280))
          `,
        }}/>
        {/* Grain */}
        <div style={{
          position: "absolute", inset: 0, opacity: 0.5,
          backgroundImage: `repeating-linear-gradient(0deg, rgba(255,255,255,0.02) 0 1px, transparent 1px 3px), repeating-linear-gradient(90deg, rgba(255,255,255,0.02) 0 1px, transparent 1px 3px)`,
        }}/>
        <div style={{
          position: "absolute", inset: 0,
          background: "linear-gradient(180deg, rgba(0,0,0,0.10) 0%, rgba(12,14,18,0) 50%, rgba(12,14,18,0.98) 100%)",
        }}/>
      </div>

      <div style={{position: "relative", zIndex: 2}}><StatusBar/></div>

      {/* Floating chrome */}
      <div style={{
        position: "absolute", top: 50, left: 16, right: 16, zIndex: 3,
        display: "flex", justifyContent: "space-between",
      }}>
        <button onClick={onBack} className="glass-badge" style={{
          width: 40, height: 40, border: 0, color: "white",
          display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
        }}><MinglaIcon name="chevL" size={20}/></button>
        <div style={{display: "flex", gap: 8}}>
          <button className="glass-badge" style={{
            width: 40, height: 40, border: 0, color: "white",
            display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
          }}><MinglaIcon name="share" size={18}/></button>
          <button className="glass-badge" style={{
            width: 40, height: 40, border: 0, color: "white",
            display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
          }}><MinglaIcon name="moreH" size={18}/></button>
        </div>
      </div>

      {/* Preview ribbon */}
      <div style={{position: "absolute", top: 100, left: 16, zIndex: 3}}>
        <span className="pill pill-accent">PUBLIC PREVIEW · mingla.com/lonelymoth</span>
      </div>

      {/* Scroll content */}
      <div style={{
        position: "absolute", top: 168, left: 0, right: 0, bottom: 0, zIndex: 2,
        overflowY: "auto", padding: "0 20px 100px",
      }}>
        {/* Brand identity card */}
        <div style={{display: "flex", gap: 16, alignItems: "flex-start", marginBottom: 20}}>
          <div style={{
            width: 76, height: 76, borderRadius: 22, flexShrink: 0,
            background: "linear-gradient(135deg, #fb923c, #eb7825)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontWeight: 700, fontSize: 32,
            border: "3px solid rgba(12,14,18,0.9)",
            boxShadow: "0 12px 32px rgba(235,120,37,0.35), 0 0 0 1px rgba(255,255,255,0.06) inset",
            marginTop: -18,
          }}>L</div>
          <div style={{flex: 1, paddingTop: 4}}>
            <div style={{display: "flex", alignItems: "center", gap: 6, marginBottom: 2}}>
              <h1 style={{fontSize: 22, fontWeight: 700, letterSpacing: -0.3, margin: 0}}>Lonely Moth</h1>
              <MinglaIcon name="check" size={14} color="var(--accent)"/>
            </div>
            <div style={{fontSize: 13, color: "var(--text-tertiary)"}}>@lonelymoth · East London</div>
          </div>
        </div>

        {/* Bio */}
        <p style={{fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.55, margin: "0 0 16px"}}>
          Late nights for unhurried people. Listening rooms, sit-down dinners, the occasional dance floor.
          Curated by Sara Marlowe since 2022.
        </p>

        {/* Stats */}
        <div className="glass-card" style={{
          padding: "14px 4px", marginBottom: 16,
          display: "grid", gridTemplateColumns: "1fr 1fr 1fr",
        }}>
          {[
            { k: "FOLLOWERS", v: "2,418" },
            { k: "EVENTS", v: "37" },
            { k: "RATING", v: "4.9", tail: <MinglaIcon name="star" size={14} color="var(--accent)"/> },
          ].map((s, i, arr) => (
            <div key={i} style={{
              padding: "0 14px", textAlign: "center",
              borderRight: i < arr.length - 1 ? "1px solid rgba(255,255,255,0.06)" : 0,
            }}>
              <div className="mono" style={{fontSize: 18, fontWeight: 700, display: "flex", justifyContent: "center", alignItems: "center", gap: 4}}>
                {s.v}{s.tail}
              </div>
              <div style={{fontSize: 10, color: "var(--text-tertiary)", letterSpacing: 1.4, fontWeight: 600, marginTop: 2}}>{s.k}</div>
            </div>
          ))}
        </div>

        {/* Follow + message CTAs */}
        <div style={{display: "flex", gap: 8, marginBottom: 24}}>
          <button onClick={onFollow} className={following ? "btn btn-secondary" : "btn btn-primary"} style={{flex: 1}}>
            {following ? <><MinglaIcon name="check" size={16}/> Following</> : <><MinglaIcon name="plus" size={16}/> Follow</>}
          </button>
          <button className="btn btn-secondary" style={{width: 48, padding: 0, flexShrink: 0}}>
            <MinglaIcon name="bell" size={16}/>
          </button>
        </div>

        {/* Tabs */}
        <div style={{
          display: "flex", gap: 4, marginBottom: 16,
          borderBottom: "1px solid rgba(255,255,255,0.06)",
        }}>
          {[
            { l: "Upcoming", n: 3, active: true },
            { l: "Past", n: 34 },
            { l: "About" },
          ].map((t, i) => (
            <button key={i} style={{
              padding: "10px 14px", border: 0,
              background: "transparent",
              color: t.active ? "white" : "var(--text-tertiary)",
              fontWeight: t.active ? 600 : 500, fontSize: 13,
              fontFamily: "inherit", cursor: "pointer",
              borderBottom: t.active ? "2px solid var(--accent)" : "2px solid transparent",
              marginBottom: -1,
            }}>
              {t.l}{t.n !== undefined && <span style={{color: "var(--text-quaternary)", marginLeft: 4, fontWeight: 400}}>{t.n}</span>}
            </button>
          ))}
        </div>

        {/* Upcoming events list */}
        <div style={{display: "flex", flexDirection: "column", gap: 12}}>
          {events.map((e, i) => (
            <div key={i} className="glass-card" style={{
              overflow: "hidden", padding: 0,
            }}>
              <div style={{display: "flex", gap: 0}}>
                {/* Cover thumb */}
                <div style={{
                  width: 96, height: 116, flexShrink: 0, position: "relative",
                  background: `
                    radial-gradient(60% 60% at 50% 40%, oklch(0.55 0.18 ${e.hue} / 0.85), oklch(0.25 0.10 ${e.hue}))
                  `,
                }}>
                  {e.status === "preview" && (
                    <div style={{
                      position: "absolute", top: 6, left: 6,
                      padding: "3px 6px", borderRadius: 4,
                      background: "rgba(12,14,18,0.7)",
                      fontSize: 9, fontWeight: 700, letterSpacing: 1.2,
                      color: "var(--accent)",
                    }}>SOON</div>
                  )}
                </div>
                {/* Detail */}
                <div style={{flex: 1, padding: "12px 14px", display: "flex", flexDirection: "column", justifyContent: "space-between"}}>
                  <div>
                    <div style={{fontSize: 10, color: "var(--accent)", letterSpacing: 1.4, fontWeight: 700, marginBottom: 4}}>{e.date} · {e.time}</div>
                    <div style={{fontWeight: 600, fontSize: 15, marginBottom: 2, letterSpacing: -0.2}}>{e.title}</div>
                    <div style={{fontSize: 11, color: "var(--text-tertiary)"}}>{e.venue}</div>
                  </div>
                  <div style={{display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6}}>
                    <span className="mono" style={{fontSize: 13, fontWeight: 600}}>From {e.price}</span>
                    <span style={{fontSize: 11, color: e.left.includes("left") ? "var(--warning)" : "var(--text-tertiary)", fontWeight: 600}}>
                      {e.left}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Footer trust strip */}
        <div style={{
          marginTop: 24, padding: 14, textAlign: "center",
          borderTop: "1px solid rgba(255,255,255,0.06)",
          fontSize: 11, color: "var(--text-quaternary)",
        }}>
          <div style={{display: "flex", justifyContent: "center", gap: 14, marginBottom: 6, color: "var(--text-tertiary)"}}>
            <a style={{color: "inherit"}}>Refund policy</a>
            <span>·</span>
            <a style={{color: "inherit"}}>House rules</a>
            <span>·</span>
            <a style={{color: "inherit"}}>Report</a>
          </div>
          Verified host on Mingla since 2022
        </div>
      </div>
    </div>
  );
};

window.PublicBrandScreen = PublicBrandScreen;
