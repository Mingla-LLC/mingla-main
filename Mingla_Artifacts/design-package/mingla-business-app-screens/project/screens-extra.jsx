/* global React */

// =================================================================
// ADDITIONAL SCREENS — Public page, Guests, Brand switcher, Refund confirm
// =================================================================

const PublicEventScreen = ({ onBack }) => (
  <div style={{position: "absolute", inset: 0, overflow: "hidden", background: "#0c0e12"}}>
    {/* Hero */}
    <div style={{position: "absolute", top: 0, left: 0, right: 0, height: 380, zIndex: 0}}>
      <EventCover hue={25} radius={0} label="" height="100%"/>
      <div style={{
        position: "absolute", inset: 0,
        background: "linear-gradient(180deg, rgba(0,0,0,0.32) 0%, rgba(0,0,0,0) 30%, rgba(0,0,0,0) 50%, rgba(12,14,18,0.98) 100%)",
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
      </div>
    </div>

    {/* Preview ribbon */}
    <div style={{
      position: "absolute", top: 100, left: 16, zIndex: 3,
    }}>
      <span className="pill pill-accent">PREVIEW · NOT YET PUBLISHED</span>
    </div>

    <div style={{
      position: "absolute", top: 280, left: 0, right: 0, bottom: 0, zIndex: 2,
      overflowY: "auto", padding: "0 20px 100px",
    }}>
      <div style={{paddingTop: 16}}>
        <div style={{fontSize: 11, color: "var(--accent)", letterSpacing: 1.4, fontWeight: 700, textTransform: "uppercase", marginBottom: 8}}>Fri 15 May · 9:00 PM</div>
        <h1 style={{fontSize: 32, fontWeight: 700, letterSpacing: -0.4, margin: "0 0 12px"}}>Slow Burn vol. 4</h1>
        <div style={{display: "flex", alignItems: "center", gap: 8, marginBottom: 18}}>
          <div style={{
            width: 28, height: 28, borderRadius: 8,
            background: "linear-gradient(135deg, #fb923c, #eb7825)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontWeight: 700, fontSize: 13,
          }}>L</div>
          <span style={{fontSize: 14, fontWeight: 500}}>Lonely Moth</span>
          <span style={{fontSize: 12, color: "var(--text-tertiary)"}}>· 217 going</span>
        </div>

        <div className="glass-card" style={{padding: 14, marginBottom: 14, display: "flex", gap: 12}}>
          <MinglaIcon name="location" size={18} color="var(--accent)"/>
          <div>
            <div style={{fontSize: 14, fontWeight: 500}}>Hidden Rooms</div>
            <div style={{fontSize: 12, color: "var(--text-secondary)"}}>East London · address shown after checkout</div>
          </div>
        </div>

        <h3 style={{fontSize: 18, fontWeight: 700, letterSpacing: -0.2, margin: "16px 0 8px"}}>About</h3>
        <p style={{fontSize: 15, color: "var(--text-secondary)", lineHeight: 1.6, margin: 0}}>
          The fourth instalment of our slow-burn series. One room. One sound system. Three sets that take their time.
          Doors at 9, last entry midnight. Dress as you'd wish to be remembered.
        </p>

        <h3 style={{fontSize: 18, fontWeight: 700, letterSpacing: -0.2, margin: "20px 0 10px"}}>Tickets</h3>
        <div style={{display: "flex", flexDirection: "column", gap: 8}}>
          <PublicTicket name="General Admission" price="£35" sub="148 / 250 sold"/>
          <PublicTicket name="VIP / Lounge" price="£75" sub="14 left"/>
        </div>
      </div>
    </div>

    {/* Sticky CTA */}
    <div style={{
      position: "absolute", bottom: 0, left: 0, right: 0, zIndex: 4,
      padding: "16px 20px 32px",
      background: "linear-gradient(180deg, rgba(12,14,18,0) 0%, rgba(12,14,18,0.92) 30%)",
    }}>
      <button className="btn btn-primary" style={{width: "100%"}}>Get tickets · from £35</button>
    </div>
  </div>
);

const PublicTicket = ({ name, price, sub }) => (
  <div className="glass-card" style={{padding: 14, display: "flex", alignItems: "center", justifyContent: "space-between"}}>
    <div>
      <div style={{fontWeight: 600, fontSize: 14}}>{name}</div>
      <div style={{fontSize: 12, color: "var(--text-tertiary)", marginTop: 2}}>{sub}</div>
    </div>
    <span className="mono" style={{fontWeight: 700, fontSize: 16}}>{price}</span>
  </div>
);

// ===== GUESTS =====
const GuestsScreen = ({ onBack, onApprove, approvedIdx }) => (
  <div style={{position: "absolute", inset: 0, overflow: "hidden"}}>
    <div className="phone-bg"/>
    <div style={{position: "relative", zIndex: 1}}><StatusBar/></div>
    <TopBar leftKind="back" onBack={onBack} title="Guests" right={<><IconChrome icon="search"/><IconChrome icon="settings"/></>}/>

    <div style={{
      position: "absolute", top: 116, left: 0, right: 0, bottom: 0,
      overflowY: "auto", padding: "12px 16px 32px", zIndex: 1,
    }}>
      <div style={{display: "flex", gap: 8, marginBottom: 12, overflowX: "auto"}}>
        {[{l: "Pending · 3", a: 1}, {l: "Approved", a: 0}, {l: "All", a: 0}].map((p, i) => (
          <button key={i} className={p.a ? "" : "glass-card"} style={{
            height: 32, padding: "0 14px", borderRadius: 999,
            border: p.a ? "1px solid var(--accent-border)" : undefined,
            background: p.a ? "var(--accent-tint)" : undefined,
            color: "white", fontSize: 13, fontWeight: 500, fontFamily: "inherit", cursor: "pointer",
            whiteSpace: "nowrap", flexShrink: 0,
          }}>{p.l}</button>
        ))}
      </div>

      <div style={{display: "flex", flexDirection: "column", gap: 10}}>
        {[
          {n: "Tom Reeves", t: "1 × VIP · referred by Sara", note: "We met last Sunday."},
          {n: "Anya Petrov", t: "2 × GA", note: "Hi! First time at one of yours — looks gorgeous."},
          {n: "Felix Wright", t: "1 × GA"},
        ].map((g, i) => (
          <div key={i} className="glass-card" style={{padding: 14}}>
            <div style={{display: "flex", gap: 12, alignItems: "flex-start", marginBottom: g.note ? 10 : 0}}>
              <div style={{
                width: 40, height: 40, borderRadius: 999,
                background: `oklch(0.55 0.15 ${i*73 % 360})`,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontWeight: 700, fontSize: 14, flexShrink: 0,
              }}>{g.n.split(" ").map(s=>s[0]).join("")}</div>
              <div style={{flex: 1, minWidth: 0}}>
                <div style={{fontWeight: 600, fontSize: 14}}>{g.n}</div>
                <div style={{fontSize: 12, color: "var(--text-tertiary)", marginTop: 2}}>{g.t}</div>
              </div>
              {approvedIdx === i ? (
                <span className="pill pill-live" style={{flexShrink: 0}}>
                  <MinglaIcon name="check" size={10}/> APPROVED
                </span>
              ) : (
                <span className="pill pill-warn" style={{flexShrink: 0}}>PENDING</span>
              )}
            </div>
            {g.note && (
              <div style={{
                padding: "10px 12px", background: "rgba(255,255,255,0.04)",
                borderRadius: 8, fontSize: 13, color: "var(--text-secondary)",
                lineHeight: 1.5, marginBottom: 10,
              }}>"{g.note}"</div>
            )}
            {approvedIdx !== i && (
              <div style={{display: "flex", gap: 8}}>
                <button onClick={() => onApprove(i)} className="btn btn-primary" style={{flex: 1, height: 40, fontSize: 13}}>Approve</button>
                <button className="btn btn-secondary" style={{flex: 1, height: 40, fontSize: 13}}>Decline</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  </div>
);

// ===== REFUND CONFIRM SHEET =====
const RefundSheet = ({ onCancel, onConfirm }) => (
  <>
    <div onClick={onCancel} style={{
      position: "absolute", inset: 0, background: "rgba(8,9,12,0.7)",
      backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)",
      zIndex: 100, animation: "fadeUp 200ms",
    }}/>
    <div className="fade-up" style={{
      position: "absolute", bottom: 0, left: 0, right: 0,
      borderRadius: "28px 28px 0 0", padding: "12px 24px 32px",
      background: "rgba(20,22,26,0.96)",
      backdropFilter: "blur(40px)", WebkitBackdropFilter: "blur(40px)",
      border: "1px solid var(--border-card-elev)",
      borderBottom: 0,
      zIndex: 101,
    }}>
      <div style={{
        width: 36, height: 4, borderRadius: 999,
        background: "rgba(255,255,255,0.2)",
        margin: "0 auto 20px",
      }}/>
      <h3 style={{fontSize: 22, fontWeight: 700, letterSpacing: -0.2, margin: "0 0 8px"}}>Refund £72.80?</h3>
      <p style={{fontSize: 14, color: "var(--text-secondary)", margin: "0 0 20px", lineHeight: 1.5}}>
        Marcus will see it on his card in 3–5 business days. Stripe's £0.30 fee isn't refundable.
      </p>
      <div className="glass-card" style={{padding: 14, marginBottom: 16}}>
        <Row label="Original" value="£72.80" mono/>
        <Row label="Stripe fee retained" value="£0.30" mono/>
        <Row label="Refund to Marcus" value="£72.50" mono bold last/>
      </div>
      <button onClick={onConfirm} className="btn btn-destructive" style={{width: "100%", marginBottom: 8}}>
        <MinglaIcon name="refund" size={16}/> Send refund
      </button>
      <button onClick={onCancel} className="btn btn-ghost" style={{width: "100%", color: "var(--text-secondary)"}}>Cancel</button>
    </div>
  </>
);

// ===== TOAST =====
const Toast = ({ kind, msg }) => (
  <div className="fade-up" style={{
    position: "absolute", top: 110, left: 16, right: 16, zIndex: 200,
    padding: "12px 16px", borderRadius: 14,
    background: kind === "error" ? "var(--error-tint)" : "var(--success-tint)",
    border: `1px solid ${kind === "error" ? "rgba(239,68,68,0.3)" : "rgba(34,197,94,0.3)"}`,
    backdropFilter: "blur(28px)", WebkitBackdropFilter: "blur(28px)",
    display: "flex", alignItems: "center", gap: 10,
    fontSize: 13, fontWeight: 500,
    boxShadow: "0 16px 40px rgba(0,0,0,0.4)",
  }}>
    <MinglaIcon name={kind === "error" ? "close" : "check"} size={16} color={kind === "error" ? "var(--error)" : "var(--success)"}/>
    <span>{msg}</span>
  </div>
);

// ===== TICKET QR (after door cash sale) =====
const TicketQRScreen = ({ onBack }) => (
  <div style={{position: "absolute", inset: 0, overflow: "hidden", display: "flex", flexDirection: "column"}}>
    <div className="phone-bg"/>
    <div style={{position: "relative", zIndex: 1}}><StatusBar/></div>
    <TopBar leftKind="back" onBack={onBack} title="Ticket" right={<IconChrome icon="share"/>}/>

    <div style={{position: "relative", zIndex: 1, flex: 1, padding: "84px 24px 32px", display: "flex", flexDirection: "column", justifyContent: "center"}}>
      <div className="glass-card-elev fade-up" style={{padding: 24, textAlign: "center"}}>
        <div style={{display: "inline-flex", alignItems: "center", gap: 8, padding: "6px 12px", background: "var(--success-tint)", border: "1px solid rgba(34,197,94,0.3)", borderRadius: 999, marginBottom: 20}}>
          <span className="dot" style={{background: "var(--success)"}}/>
          <span style={{fontSize: 11, fontWeight: 700, color: "var(--success)", letterSpacing: 1.4}}>VALID</span>
        </div>
        <div style={{fontSize: 11, color: "var(--text-tertiary)", letterSpacing: 1.4, fontWeight: 700, textTransform: "uppercase", marginBottom: 4}}>Slow Burn vol. 4</div>
        <h2 style={{fontSize: 22, fontWeight: 700, letterSpacing: -0.2, margin: "0 0 4px"}}>1 × General Admission</h2>
        <div style={{fontSize: 13, color: "var(--text-secondary)", marginBottom: 20}}>Door cash sale · £35.00</div>

        <div style={{display: "flex", justifyContent: "center", marginBottom: 20}}>
          <div style={{padding: 16, background: "white", borderRadius: 16}}>
            <QRCode size={180}/>
          </div>
        </div>

        <div className="mono" style={{fontSize: 14, fontWeight: 600, letterSpacing: 4}}>M-44219</div>
        <div style={{fontSize: 11, color: "var(--text-tertiary)", marginTop: 4}}>Show to scanner at the door</div>
      </div>

      <button className="btn btn-secondary" style={{marginTop: 16, width: "100%"}}>Send via SMS</button>
    </div>
  </div>
);

window.PublicEventScreen = PublicEventScreen;
window.GuestsScreen = GuestsScreen;
window.RefundSheet = RefundSheet;
window.Toast = Toast;
window.TicketQRScreen = TicketQRScreen;
