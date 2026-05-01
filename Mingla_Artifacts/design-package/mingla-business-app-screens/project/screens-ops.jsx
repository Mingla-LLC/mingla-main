/* global React */

// =================================================================
// SCANNER, ORDERS, GUESTS, PUBLIC PAGE, ACCOUNT, CHAT
// =================================================================

const ScannerScreen = ({ onBack, scanState, onScan, onCash, onManual }) => (
  <div style={{position: "absolute", inset: 0, background: "#000", overflow: "hidden"}}>
    {/* Camera viewport */}
    <div style={{
      position: "absolute", inset: 0,
      background: `
        radial-gradient(circle at 50% 50%, rgba(80, 80, 100, 0.4) 0%, rgba(0,0,0,0.95) 70%),
        repeating-linear-gradient(135deg, rgba(255,255,255,0.02) 0px, rgba(255,255,255,0.02) 2px, transparent 2px, transparent 4px),
        #0a0a0e
      `,
    }}/>

    <div style={{position: "relative", zIndex: 2}}><StatusBar/></div>

    {/* Top chrome */}
    <div style={{
      position: "absolute", top: 44, left: 12, right: 12, zIndex: 3,
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: 12, borderRadius: 999,
      background: "rgba(12, 14, 18, 0.55)",
      backdropFilter: "blur(28px)", WebkitBackdropFilter: "blur(28px)",
      border: "1px solid rgba(255,255,255,0.06)",
    }}>
      <button onClick={onBack} style={{
        width: 36, height: 36, borderRadius: 999, border: 0,
        background: "rgba(255,255,255,0.08)", color: "white",
        display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
      }}><MinglaIcon name="close" size={20}/></button>
      <div style={{textAlign: "center"}}>
        <div style={{fontSize: 12, color: "var(--text-secondary)"}}>Slow Burn vol. 4</div>
        <div style={{fontSize: 11, fontWeight: 600, color: "var(--success)", display: "flex", alignItems: "center", gap: 4, justifyContent: "center"}}>
          <span className="dot live-pulse" style={{background: "var(--success)"}}/> 132 SCANNED
        </div>
      </div>
      <button style={{
        width: 36, height: 36, borderRadius: 999, border: 0,
        background: "rgba(255,255,255,0.08)", color: "white",
        display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
      }}><MinglaIcon name="flash" size={18}/></button>
    </div>

    {/* Reticle */}
    <div style={{
      position: "absolute", top: "50%", left: "50%",
      transform: "translate(-50%, -55%)",
      width: 260, height: 260, zIndex: 3,
    }}>
      {/* Corner brackets */}
      {[
        {top: 0, left: 0, br: "0 0 0 16px", border: "3px 0 0 3px"},
        {top: 0, right: 0, br: "0 0 16px 0", border: "3px 3px 0 0"},
        {bottom: 0, left: 0, br: "0 16px 0 0", border: "0 0 3px 3px"},
        {bottom: 0, right: 0, br: "16px 0 0 0", border: "0 3px 3px 0"},
      ].map((s, i) => (
        <div key={i} style={{
          position: "absolute", width: 36, height: 36,
          ...s,
          borderColor: scanState === "success" ? "var(--success)" : scanState === "duplicate" ? "var(--warning)" : "white",
          borderStyle: "solid",
          borderWidth: s.border.split(" ").map(v => v).join(" "),
          borderRadius: s.br,
          transition: "border-color 200ms var(--ease-out)",
        }}/>
      ))}

      {/* Scan animation: line */}
      {scanState === "idle" && (
        <div style={{
          position: "absolute", left: 8, right: 8,
          top: "50%", height: 2,
          background: "linear-gradient(90deg, transparent, var(--accent), transparent)",
          boxShadow: "0 0 12px var(--accent-glow)",
        }}/>
      )}

      {/* Success badge */}
      {scanState === "success" && (
        <div className="scan-success" style={{
          position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <div style={{
            width: 100, height: 100, borderRadius: 999,
            background: "var(--success)",
            display: "flex", alignItems: "center", justifyContent: "center",
            boxShadow: "0 0 60px rgba(34, 197, 94, 0.6)",
          }}>
            <MinglaIcon name="check" size={56} color="white" strokeWidth={3}/>
          </div>
        </div>
      )}

      {/* Duplicate warning */}
      {scanState === "duplicate" && (
        <div className="scan-success" style={{
          position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <div style={{
            width: 100, height: 100, borderRadius: 999,
            background: "var(--warning)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 48, fontWeight: 700, color: "white",
          }}>!</div>
        </div>
      )}
    </div>

    {/* Subtitle */}
    <div style={{
      position: "absolute", top: "50%", left: 0, right: 0,
      transform: "translateY(120px)", textAlign: "center", zIndex: 3, padding: "0 32px",
    }}>
      {scanState === "idle" && (
        <>
          <div style={{fontSize: 16, fontWeight: 600, marginBottom: 4}}>Point at a ticket QR</div>
          <div style={{fontSize: 13, color: "var(--text-secondary)"}}>Hold steady — it scans automatically</div>
        </>
      )}
      {scanState === "success" && (
        <>
          <div style={{fontSize: 18, fontWeight: 700, color: "var(--success)", marginBottom: 4}}>Scanned</div>
          <div style={{fontSize: 14, color: "white"}}>Marcus Lin · 1 × General Admission</div>
          <div style={{fontSize: 12, color: "var(--text-tertiary)", marginTop: 2}}>Order #M-44218</div>
        </>
      )}
      {scanState === "duplicate" && (
        <>
          <div style={{fontSize: 18, fontWeight: 700, color: "var(--warning)", marginBottom: 4}}>Already used</div>
          <div style={{fontSize: 14, color: "white"}}>Scanned 47 minutes ago at the door</div>
        </>
      )}
    </div>

    {/* Bottom action bar */}
    <div style={{
      position: "absolute", bottom: 24, left: 12, right: 12, height: 80,
      borderRadius: 28, padding: 8,
      background: "rgba(12, 14, 18, 0.55)",
      backdropFilter: "blur(28px)", WebkitBackdropFilter: "blur(28px)",
      border: "1px solid rgba(255,255,255,0.06)",
      display: "flex", alignItems: "center", gap: 6, zIndex: 3,
    }}>
      <ScanBtn icon="qr" label="Scan" active onClick={onScan}/>
      <ScanBtn icon="search" label="Lookup" onClick={onManual}/>
      <ScanBtn icon="cash" label="Door sale" onClick={onCash}/>
      <ScanBtn icon="list" label="Activity"/>
    </div>
  </div>
);

const ScanBtn = ({ icon, label, active, onClick }) => (
  <button onClick={onClick} style={{
    flex: 1, height: 64, border: 0,
    borderRadius: 22,
    background: active ? "var(--accent-tint)" : "transparent",
    boxShadow: active ? "0 0 14px rgba(235, 120, 37, 0.35)" : "none",
    color: "white", cursor: "pointer", fontFamily: "inherit",
    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2,
  }}>
    <MinglaIcon name={icon} size={20}/>
    <span style={{fontSize: 10, fontWeight: 600}}>{label}</span>
  </button>
);

// ===== ORDERS =====
const OrdersScreen = ({ onBack, onOrder }) => (
  <div style={{position: "absolute", inset: 0, overflow: "hidden"}}>
    <div className="phone-bg"/>
    <div style={{position: "relative", zIndex: 1}}><StatusBar/></div>
    <TopBar leftKind="back" onBack={onBack} title="Orders"
      right={<><IconChrome icon="search"/><IconChrome icon="settings"/></>}/>

    <div style={{
      position: "absolute", top: 116, left: 0, right: 0, bottom: 0,
      overflowY: "auto", padding: "12px 16px 32px", zIndex: 1,
    }}>
      {/* Filter pills */}
      <div style={{display: "flex", gap: 8, marginBottom: 12, overflowX: "auto", paddingBottom: 4}}>
        {["All · 284", "Paid", "Refunded", "Pending"].map((p, i) => (
          <button key={i} className={i === 0 ? "" : "glass-card"} style={{
            height: 32, padding: "0 14px", borderRadius: 999,
            border: i === 0 ? "1px solid var(--accent-border)" : undefined,
            background: i === 0 ? "var(--accent-tint)" : undefined,
            color: "white", fontSize: 13, fontWeight: 500, fontFamily: "inherit", cursor: "pointer",
            whiteSpace: "nowrap", flexShrink: 0,
          }}>{p}</button>
        ))}
      </div>

      <div style={{display: "flex", flexDirection: "column", gap: 8}}>
        {[
          {n: "Marcus Lin", id: "M-44218", t: "2 × GA", amt: "70.00", time: "2m ago", st: "paid", first: true},
          {n: "Adaeze K.", id: "M-44217", t: "1 × VIP", amt: "75.00", time: "8m ago", st: "paid"},
          {n: "Theo R.", id: "M-44216", t: "1 × GA", amt: "35.00", time: "14m ago", st: "paid"},
          {n: "Jules N.", id: "M-44210", t: "1 × VIP", amt: "75.00", time: "1h ago", st: "refunded"},
          {n: "Priya V.", id: "M-44209", t: "4 × GA", amt: "140.00", time: "1h ago", st: "paid"},
          {n: "Sam D.", id: "M-44208", t: "2 × VIP", amt: "150.00", time: "2h ago", st: "paid"},
          {n: "Lina W.", id: "M-44207", t: "1 × GA", amt: "35.00", time: "2h ago", st: "pending"},
        ].map((o, i) => (
          <button key={i} onClick={o.first ? onOrder : null} className="glass-card" style={{
            padding: 14, border: 0, color: "white", fontFamily: "inherit", cursor: "pointer", textAlign: "left",
            display: "flex", alignItems: "center", gap: 12,
          }}>
            <div style={{
              width: 40, height: 40, borderRadius: 999,
              background: `oklch(0.5 0.15 ${(i*47) % 360})`,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontWeight: 700, fontSize: 14, flexShrink: 0,
            }}>{o.n.split(" ").map(s=>s[0]).join("")}</div>
            <div style={{flex: 1, minWidth: 0}}>
              <div style={{fontWeight: 600, fontSize: 14}}>{o.n}</div>
              <div style={{fontSize: 12, color: "var(--text-tertiary)", marginTop: 2}}>
                <span className="mono">{o.id}</span> · {o.t} · {o.time}
              </div>
            </div>
            <div style={{textAlign: "right"}}>
              <div className="mono" style={{fontWeight: 600, fontSize: 14, color: o.st === "refunded" ? "var(--text-tertiary)" : "white", textDecoration: o.st === "refunded" ? "line-through" : "none"}}>£{o.amt}</div>
              {o.st === "refunded" && <div style={{fontSize: 10, color: "var(--error)", fontWeight: 600, marginTop: 2}}>REFUNDED</div>}
              {o.st === "pending" && <div style={{fontSize: 10, color: "var(--warning)", fontWeight: 600, marginTop: 2}}>PENDING</div>}
            </div>
          </button>
        ))}
      </div>
    </div>
  </div>
);

const OrderDetailScreen = ({ onBack, onRefund, refunded }) => (
  <div style={{position: "absolute", inset: 0, overflow: "hidden"}}>
    <div className="phone-bg"/>
    <div style={{position: "relative", zIndex: 1}}><StatusBar/></div>
    <TopBar leftKind="back" onBack={onBack} title="Order"
      right={<IconChrome icon="moreH"/>}/>

    <div style={{
      position: "absolute", top: 116, left: 0, right: 0, bottom: 0,
      overflowY: "auto", padding: "16px 16px 32px", zIndex: 1,
    }}>
      <div className="glass-card-elev" style={{padding: 20, marginBottom: 12}}>
        <div style={{display: "flex", alignItems: "center", gap: 12, marginBottom: 16}}>
          <div style={{
            width: 56, height: 56, borderRadius: 999,
            background: "oklch(0.5 0.15 50)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontWeight: 700, fontSize: 18,
          }}>ML</div>
          <div>
            <div style={{fontWeight: 700, fontSize: 18}}>Marcus Lin</div>
            <div style={{fontSize: 13, color: "var(--text-secondary)"}}>marcus.l@email.com</div>
          </div>
        </div>
        <div style={{
          padding: 12, borderRadius: 12,
          background: refunded ? "var(--error-tint)" : "var(--success-tint)",
          border: `1px solid ${refunded ? "rgba(239,68,68,0.3)" : "rgba(34,197,94,0.3)"}`,
          fontSize: 13, color: "white",
          display: "flex", alignItems: "center", gap: 10,
        }}>
          <MinglaIcon name={refunded ? "refund" : "check"} size={16} color={refunded ? "var(--error)" : "var(--success)"}/>
          <span>{refunded ? "Refund sent. Marcus will see it in 3–5 days." : "Paid · Stripe will settle in 3–5 days"}</span>
        </div>
      </div>

      <div className="glass-card" style={{padding: 16, marginBottom: 12}}>
        <Row label="Order" value="M-44218" mono/>
        <Row label="Tickets" value="2 × General Admission"/>
        <Row label="Subtotal" value="£70.00" mono/>
        <Row label="Service fee" value="£2.80" mono/>
        <Row label="Total" value={refunded ? "£0.00" : "£72.80"} mono bold/>
        <Row label="Method" value="Apple Pay · Visa •• 4218" last/>
      </div>

      {!refunded && (
        <button onClick={onRefund} className="btn btn-secondary" style={{
          width: "100%", color: "var(--error)", borderColor: "rgba(239,68,68,0.3)",
        }}>
          <MinglaIcon name="refund" size={16}/> Refund order
        </button>
      )}
    </div>
  </div>
);

const Row = ({ label, value, mono, bold, last }) => (
  <div style={{
    display: "flex", justifyContent: "space-between", padding: "10px 0",
    borderBottom: last ? 0 : "1px solid rgba(255,255,255,0.04)",
    fontSize: 14,
  }}>
    <span style={{color: "var(--text-secondary)"}}>{label}</span>
    <span className={mono ? "mono" : ""} style={{fontWeight: bold ? 700 : 500}}>{value}</span>
  </div>
);

// ===== ACCOUNT =====
const AccountScreen = ({ onTab, onDelete, onBrand, onBrandsList }) => (
  <div style={{position: "absolute", inset: 0, overflow: "hidden"}}>
    <div className="phone-bg"/>
    <div style={{position: "relative", zIndex: 1}}><StatusBar/></div>
    <TopBar/>

    <div style={{
      position: "absolute", top: 116, left: 0, right: 0, bottom: 0,
      overflowY: "auto", padding: "16px 16px 130px", zIndex: 1,
    }}>
      <div className="glass-card-elev" style={{padding: 20, marginBottom: 16, textAlign: "center"}}>
        <div style={{
          width: 72, height: 72, borderRadius: 999,
          background: "linear-gradient(135deg, oklch(0.55 0.18 25), oklch(0.45 0.16 290))",
          margin: "0 auto 12px",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontWeight: 700, fontSize: 28, color: "white",
          border: "2px solid rgba(255,255,255,0.12)",
        }}>SM</div>
        <div style={{fontWeight: 700, fontSize: 20, letterSpacing: -0.2}}>Sara Marlowe</div>
        <div style={{fontSize: 13, color: "var(--text-secondary)", marginTop: 2}}>sara@lonelymoth.events</div>
        <div style={{display: "flex", gap: 6, justifyContent: "center", marginTop: 12}}>
          <span className="pill pill-accent">ACCOUNT OWNER</span>
        </div>
      </div>

      <Section title="Brands">
        <Row2 onClick={onBrandsList} left={<><div style={{width:32,height:32,borderRadius:8,background:"linear-gradient(135deg,#fb923c,#eb7825)",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700}}>L</div><div><div style={{fontWeight:600,fontSize:14}}>Lonely Moth</div><div style={{fontSize:11,color:"var(--text-tertiary)"}}>3 events · primary · 2,418 followers</div></div></>}/>
        <Row2 onClick={onBrandsList} left={<><div style={{width:32,height:32,borderRadius:8,background:"linear-gradient(135deg,#7c3aed,#a78bfa)",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700}}>L</div><div><div style={{fontWeight:600,fontSize:14}}>The Long Lunch</div><div style={{fontSize:11,color:"var(--text-tertiary)"}}>1 series · weekly</div></div></>}/>
        <Row2 onClick={onBrandsList} left={<><div style={{width:32,height:32,borderRadius:8,background:"linear-gradient(135deg,#0ea5e9,#22d3ee)",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700}}>S</div><div><div style={{fontWeight:600,fontSize:14}}>Sunday Languor</div><div style={{fontSize:11,color:"var(--text-tertiary)"}}>6 events · brunch</div></div></>}/>
        <Row2 onClick={onBrandsList} left={<><MinglaIcon name="award" size={16} color="var(--text-tertiary)"/><span style={{fontWeight: 600, fontSize: 14}}>Manage all brands</span></>}/>
        <Row2 left={<><MinglaIcon name="plus" size={18} color="var(--accent)"/><span style={{color: "var(--accent)", fontWeight: 600, fontSize: 14}}>Add a brand</span></>} last/>
      </Section>

      <Section title="Account">
        <Row2 label="Personal details"/>
        <Row2 label="Notifications"/>
        <Row2 label="Security"/>
        <Row2 label="Help & support" last/>
      </Section>

      <Section title="Danger zone">
        <button onClick={onDelete} style={{
          width: "100%", padding: 14, border: 0,
          background: "transparent", color: "var(--error)",
          fontFamily: "inherit", fontSize: 14, fontWeight: 500, cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <span style={{display: "flex", gap: 12, alignItems: "center"}}>
            <MinglaIcon name="trash" size={18}/> Delete account
          </span>
          <MinglaIcon name="chevR" size={16}/>
        </button>
      </Section>

      <div style={{textAlign: "center", padding: "24px 0 0", color: "var(--text-quaternary)", fontSize: 11}}>
        <div className="mono">Mingla Business · v0.4.2</div>
        <div style={{marginTop: 4}}>Built for operators</div>
      </div>
    </div>

    <BottomNav active="account" onChange={onTab}/>
  </div>
);

const Section = ({ title, children }) => (
  <div style={{marginBottom: 16}}>
    <div style={{
      fontSize: 11, color: "var(--text-tertiary)", letterSpacing: 1.4, fontWeight: 700,
      textTransform: "uppercase", padding: "0 4px 8px",
    }}>{title}</div>
    <div className="glass-card" style={{padding: 4}}>{children}</div>
  </div>
);

const Row2 = ({ label, left, last, onClick }) => (
  <button onClick={onClick} style={{
    width: "100%", padding: "14px 12px",
    border: 0, background: "transparent", color: "white",
    fontFamily: "inherit", fontSize: 14, cursor: "pointer", textAlign: "left",
    display: "flex", alignItems: "center", justifyContent: "space-between",
    borderBottom: last ? 0 : "1px solid rgba(255,255,255,0.04)",
  }}>
    <span style={{display: "flex", gap: 12, alignItems: "center"}}>{left || label}</span>
    <MinglaIcon name="chevR" size={16} color="var(--text-tertiary)"/>
  </button>
);

// ===== CHAT (placeholder) =====
const ChatScreen = ({ onTab }) => (
  <div style={{position: "absolute", inset: 0, overflow: "hidden"}}>
    <div className="phone-bg"/>
    <div style={{position: "relative", zIndex: 1}}><StatusBar/></div>
    <TopBar/>
    <div style={{
      position: "absolute", top: 116, left: 0, right: 0, bottom: 130,
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      padding: 32, zIndex: 1, textAlign: "center",
    }}>
      <div style={{
        width: 80, height: 80, borderRadius: 999,
        background: "var(--glass-card-elev)",
        border: "1px solid var(--border-card-elev)",
        display: "flex", alignItems: "center", justifyContent: "center",
        marginBottom: 20,
      }}>
        <MinglaIcon name="sparkle" size={36} color="var(--accent)"/>
      </div>
      <h2 style={{fontSize: 22, fontWeight: 700, letterSpacing: -0.2, margin: "0 0 8px"}}>Chat is on the way</h2>
      <p style={{fontSize: 14, color: "var(--text-secondary)", margin: 0, lineHeight: 1.5, maxWidth: 280}}>
        An AI co-pilot that helps you draft event copy, answer guest questions, and run campaigns. We'll switch this on in a future release.
      </p>
      <button className="btn btn-secondary" style={{marginTop: 24}}>Get early access</button>
    </div>
    <BottomNav active="chat" onChange={onTab}/>
  </div>
);

// ===== DELETE ACCOUNT =====
const DeleteScreen = ({ onBack, onConfirm, step, onTypeConfirm }) => {
  const screens = [
    { // Step 1: warning
      title: "Delete your account",
      body: (
        <>
          <p style={{color: "var(--text-secondary)", lineHeight: 1.6, fontSize: 14, marginBottom: 16}}>
            We'll keep everything for 30 days in case you change your mind. After that, your account, brands, events, and orders are gone for good.
          </p>
          <div className="glass-card" style={{padding: 16, marginBottom: 12}}>
            <div style={{fontWeight: 600, fontSize: 14, marginBottom: 10}}>What happens immediately</div>
            <Bullet>You sign out of every device</Bullet>
            <Bullet>Live events are hidden from search</Bullet>
            <Bullet>Pending payouts complete normally</Bullet>
            <Bullet>Guests with tickets keep their tickets</Bullet>
          </div>
        </>
      ),
      cta: "Continue",
      ghost: "Keep my account",
    },
    { // Step 2: consequences
      title: "This affects 4 brands and 12 events",
      body: (
        <>
          <p style={{color: "var(--text-secondary)", lineHeight: 1.6, fontSize: 14, marginBottom: 16}}>
            You're the owner on these. After deletion, no one else can manage them.
          </p>
          <div className="glass-card" style={{padding: 0}}>
            {["Lonely Moth · 3 events · 412 guests", "The Long Lunch · 1 event · 80 guests", "Sunday Languor · 6 events · 312 guests", "Hidden Rooms · 2 events · 144 guests"].map((b, i, arr) => (
              <div key={i} style={{
                padding: "14px 16px", fontSize: 13,
                borderBottom: i === arr.length-1 ? 0 : "1px solid rgba(255,255,255,0.04)",
              }}>{b}</div>
            ))}
          </div>
        </>
      ),
      cta: "I understand, continue",
      ghost: "Go back",
    },
    { // Step 3: type to confirm
      title: "Type DELETE to confirm",
      body: (
        <>
          <p style={{color: "var(--text-secondary)", lineHeight: 1.6, fontSize: 14, marginBottom: 16}}>
            One more step. Type the word DELETE in the box below to schedule your account for deletion in 30 days.
          </p>
          <input className="input" placeholder="Type DELETE" defaultValue="DELETE" style={{
            fontFamily: "var(--font-mono)", letterSpacing: 2,
            borderColor: "var(--error)", color: "var(--error)", fontWeight: 600,
          }}/>
          <div style={{fontSize: 12, color: "var(--text-tertiary)", marginTop: 10}}>
            You'll get an email confirming the deletion has been scheduled. You can cancel from that email any time in the next 30 days.
          </div>
        </>
      ),
      cta: "Schedule deletion",
      destructive: true,
      ghost: "Cancel",
    },
    { // Step 4: confirmation
      title: "Scheduled for deletion",
      body: (
        <>
          <div style={{
            width: 64, height: 64, borderRadius: 999,
            background: "var(--success-tint)", border: "1px solid rgba(34,197,94,0.3)",
            display: "flex", alignItems: "center", justifyContent: "center",
            margin: "0 auto 20px",
          }}>
            <MinglaIcon name="clock" size={28} color="var(--success)"/>
          </div>
          <p style={{textAlign: "center", color: "var(--text-secondary)", lineHeight: 1.6, fontSize: 14, marginBottom: 24}}>
            Your account will be deleted on <span className="mono" style={{color: "white", fontWeight: 600}}>27 May 2026</span>.
            We've sent a confirmation to <span style={{color: "white"}}>sara@lonelymoth.events</span> with a one-click cancel link.
          </p>
        </>
      ),
      cta: "Sign out",
      ghost: "Cancel deletion",
    },
  ];
  const cur = screens[step];
  const isLast = step === screens.length - 1;

  return (
    <div style={{position: "absolute", inset: 0, display: "flex", flexDirection: "column"}}>
      <div className="phone-bg"/>
      <div style={{position: "relative", zIndex: 1}}><StatusBar/></div>
      <TopBar leftKind="back" onBack={onBack} title="Delete account" right={<span/>}/>

      <div className="fade-up" key={step} style={{
        position: "relative", zIndex: 1, flex: 1,
        padding: "84px 24px 12px", overflowY: "auto",
      }}>
        <h1 style={{fontSize: 24, fontWeight: 700, letterSpacing: -0.2, margin: "0 0 12px", textAlign: isLast ? "center" : "left"}}>{cur.title}</h1>
        {cur.body}
      </div>

      <div style={{
        position: "relative", zIndex: 1,
        padding: "12px 24px 32px",
        display: "flex", flexDirection: "column", gap: 8,
      }}>
        <button className={"btn " + (cur.destructive || isLast ? "btn-destructive" : "btn-primary")} onClick={onConfirm}>{cur.cta}</button>
        {cur.ghost && <button className="btn btn-ghost" onClick={onBack}>{cur.ghost}</button>}
      </div>
    </div>
  );
};

const Bullet = ({ children }) => (
  <div style={{display: "flex", gap: 10, alignItems: "flex-start", padding: "6px 0", fontSize: 13, color: "var(--text-secondary)"}}>
    <div style={{width: 4, height: 4, borderRadius: 999, background: "var(--accent)", marginTop: 7, flexShrink: 0}}/>
    <span>{children}</span>
  </div>
);

// ===== CASH SALE =====
const CashSaleScreen = ({ onBack, onConfirm }) => {
  const [amt, setAmt] = React.useState("35");
  const press = (k) => {
    if (k === "back") setAmt(a => a.slice(0, -1) || "0");
    else if (k === ".") setAmt(a => a.includes(".") ? a : a + ".");
    else setAmt(a => (a === "0" ? "" : a) + k);
  };
  return (
    <div style={{position: "absolute", inset: 0, overflow: "hidden", display: "flex", flexDirection: "column"}}>
      <div className="phone-bg"/>
      <div style={{position: "relative", zIndex: 1}}><StatusBar/></div>
      <TopBar leftKind="back" onBack={onBack} title="Door cash sale" right={<span/>}/>

      <div style={{position: "relative", zIndex: 1, flex: 1, padding: "84px 24px 16px", display: "flex", flexDirection: "column"}}>
        <div style={{flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center"}}>
          <div style={{fontSize: 12, color: "var(--text-tertiary)", letterSpacing: 1.4, fontWeight: 600, textTransform: "uppercase", marginBottom: 8}}>Amount taken</div>
          <div className="mono" style={{fontSize: 64, fontWeight: 700, letterSpacing: -2, color: "white", lineHeight: 1}}>
            <span style={{color: "var(--text-tertiary)", fontSize: 36}}>£</span>{amt}
          </div>
          <div style={{marginTop: 20, display: "flex", gap: 6}}>
            {["1 × GA", "1 × VIP", "Custom"].map((p, i) => (
              <button key={i} className="glass-card" style={{
                padding: "8px 14px", border: i === 0 ? "1px solid var(--accent-border)" : undefined,
                background: i === 0 ? "var(--accent-tint)" : undefined,
                fontSize: 12, fontWeight: 600, color: "white", fontFamily: "inherit", cursor: "pointer",
              }}>{p}</button>
            ))}
          </div>
        </div>

        <div style={{display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, marginBottom: 12}}>
          {["1","2","3","4","5","6","7","8","9",".","0","back"].map((k, i) => (
            <button key={i} onClick={() => press(k)} className="glass-card" style={{
              height: 56, fontSize: 22, fontWeight: 600, color: "white", fontFamily: "inherit",
              border: 0, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              {k === "back" ? <MinglaIcon name="backspace" size={20}/> : k}
            </button>
          ))}
        </div>

        <button onClick={onConfirm} className="btn btn-primary">Take £{amt} cash · issue ticket</button>
      </div>
    </div>
  );
};

window.ScannerScreen = ScannerScreen;
window.OrdersScreen = OrdersScreen;
window.OrderDetailScreen = OrderDetailScreen;
window.AccountScreen = AccountScreen;
window.ChatScreen = ChatScreen;
window.DeleteScreen = DeleteScreen;
window.CashSaleScreen = CashSaleScreen;
