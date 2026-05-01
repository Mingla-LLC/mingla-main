/* global React */

// =================================================================
// BRAND MANAGEMENT — Switcher · Brands list · Profile editor ·
// Payments (Stripe) · Payouts · Tax/VAT · Finance reports
// =================================================================

const BRANDS = [
  { id: "lm",   initial: "L", grad: "linear-gradient(135deg,#fb923c,#eb7825)", name: "Lonely Moth",       sub: "3 events · primary · 2,418 followers", events: 3,  rev: "£18,720", live: 2 },
  { id: "tll",  initial: "L", grad: "linear-gradient(135deg,#7c3aed,#a78bfa)", name: "The Long Lunch",    sub: "1 series · weekly · 484 followers",   events: 1,  rev: "£3,240",  live: 0 },
  { id: "sl",   initial: "S", grad: "linear-gradient(135deg,#0ea5e9,#22d3ee)", name: "Sunday Languor",    sub: "6 events · brunch · 312 followers",   events: 6,  rev: "£11,860", live: 1 },
  { id: "hr",   initial: "H", grad: "linear-gradient(135deg,#f43f5e,#fb7185)", name: "Hidden Rooms",      sub: "2 events · curated · 144 followers",  events: 2,  rev: "£4,520",  live: 0 },
];

// ===== BRAND SWITCHER (bottom sheet) =====
const BrandSwitcherSheet = ({ active = "lm", onPick, onClose, onCreate, onManage }) => (
  <>
    <div onClick={onClose} style={{
      position: "absolute", inset: 0, background: "rgba(8,9,12,0.7)",
      backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)",
      zIndex: 100, animation: "fadeUp 200ms",
    }}/>
    <div className="fade-up" style={{
      position: "absolute", bottom: 0, left: 0, right: 0,
      borderRadius: "28px 28px 0 0", padding: "12px 16px 32px",
      background: "rgba(20,22,26,0.96)",
      backdropFilter: "blur(40px)", WebkitBackdropFilter: "blur(40px)",
      border: "1px solid var(--border-card-elev)",
      borderBottom: 0, zIndex: 101,
    }}>
      <div style={{width: 36, height: 4, borderRadius: 999, background: "rgba(255,255,255,0.2)", margin: "0 auto 16px"}}/>
      <div style={{display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 8px 12px"}}>
        <h3 style={{fontSize: 18, fontWeight: 700, letterSpacing: -0.2, margin: 0}}>Switch brand</h3>
        <button onClick={onManage} className="btn-ghost" style={{background: "transparent", border: 0, color: "var(--accent)", fontSize: 13, fontWeight: 600, cursor: "pointer", padding: 4}}>Manage all</button>
      </div>
      <div style={{display: "flex", flexDirection: "column", gap: 8}}>
        {BRANDS.map((b) => (
          <button key={b.id} onClick={() => onPick(b.id)} className="glass-card" style={{
            padding: 12, border: b.id === active ? "1px solid var(--accent-border)" : undefined,
            background: b.id === active ? "var(--accent-tint)" : undefined,
            display: "flex", alignItems: "center", gap: 12,
            color: "white", fontFamily: "inherit", textAlign: "left", cursor: "pointer",
          }}>
            <div style={{
              width: 40, height: 40, borderRadius: 10, background: b.grad,
              display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 16,
              flexShrink: 0,
            }}>{b.initial}</div>
            <div style={{flex: 1, minWidth: 0}}>
              <div style={{fontWeight: 600, fontSize: 14, display: "flex", alignItems: "center", gap: 6}}>
                {b.name}
                {b.live > 0 && <span className="dot live-pulse" style={{background: "var(--success)"}}/>}
              </div>
              <div style={{fontSize: 11, color: "var(--text-tertiary)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis"}}>{b.sub}</div>
            </div>
            {b.id === active && <MinglaIcon name="check" size={18} color="var(--accent)"/>}
          </button>
        ))}
        <button onClick={onCreate} className="glass-card" style={{
          padding: 14, border: "1px dashed rgba(255,255,255,0.2)",
          color: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
          cursor: "pointer", fontFamily: "inherit", fontSize: 14, fontWeight: 600,
        }}>
          <MinglaIcon name="plus" size={16}/> Create a new brand
        </button>
      </div>
    </div>
  </>
);

// ===== BRANDS LIST (Manage all) =====
const BrandsListScreen = ({ onBack, onOpen, onCreate }) => (
  <div style={{position: "absolute", inset: 0, overflow: "hidden"}}>
    <div className="phone-bg"/>
    <div style={{position: "relative", zIndex: 1}}><StatusBar/></div>
    <TopBar leftKind="back" onBack={onBack} title="All brands" right={<IconChrome icon="plus" onClick={onCreate}/>}/>

    <div style={{
      position: "absolute", top: 116, left: 0, right: 0, bottom: 0,
      overflowY: "auto", padding: "12px 16px 32px", zIndex: 1,
    }}>
      <div className="glass-card" style={{padding: 16, marginBottom: 12, display: "flex", alignItems: "center", gap: 12}}>
        <div style={{width: 36, height: 36, borderRadius: 999, background: "var(--accent-tint)", border: "1px solid var(--accent-border)", display: "flex", alignItems: "center", justifyContent: "center"}}>
          <MinglaIcon name="award" size={18} color="var(--accent)"/>
        </div>
        <div style={{flex: 1, minWidth: 0}}>
          <div style={{fontSize: 13, fontWeight: 600}}>One account, four brands</div>
          <div style={{fontSize: 11, color: "var(--text-tertiary)"}}>Each brand has its own Stripe, audience, and analytics.</div>
        </div>
      </div>

      <div style={{display: "flex", flexDirection: "column", gap: 10}}>
        {BRANDS.map((b) => (
          <button key={b.id} onClick={() => onOpen(b.id)} className="glass-card" style={{
            padding: 14, border: 0, color: "white", fontFamily: "inherit", cursor: "pointer", textAlign: "left",
            display: "flex", flexDirection: "column", gap: 12,
          }}>
            <div style={{display: "flex", alignItems: "center", gap: 12}}>
              <div style={{width: 48, height: 48, borderRadius: 12, background: b.grad, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 18, flexShrink: 0}}>{b.initial}</div>
              <div style={{flex: 1, minWidth: 0}}>
                <div style={{fontWeight: 600, fontSize: 15}}>{b.name}</div>
                <div style={{fontSize: 11, color: "var(--text-tertiary)"}}>{b.sub}</div>
              </div>
              {b.live > 0 && <span className="pill pill-live" style={{flexShrink: 0}}><span className="dot live-pulse" style={{background:"var(--success)"}}/>{b.live} LIVE</span>}
            </div>
            <div style={{display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, paddingTop: 4, borderTop: "1px solid rgba(255,255,255,0.06)"}}>
              <BrandStat label="Events" value={String(b.events)}/>
              <BrandStat label="Revenue · 30d" value={b.rev} mono/>
              <BrandStat label="Followers" value={b.sub.match(/(\d[,\d]*) followers/)?.[1] || "—"} mono/>
            </div>
          </button>
        ))}
      </div>
    </div>
  </div>
);

const BrandStat = ({ label, value, mono }) => (
  <div>
    <div style={{fontSize: 10, color: "var(--text-tertiary)", letterSpacing: 0.4, fontWeight: 600, textTransform: "uppercase", marginBottom: 2}}>{label}</div>
    <div className={mono ? "mono" : ""} style={{fontSize: 14, fontWeight: 700, color: "white"}}>{value}</div>
  </div>
);

// ===== BRAND PROFILE EDITOR =====
const BrandProfileScreen = ({ onBack, onPayments, onTeam, onPublic }) => (
  <div style={{position: "absolute", inset: 0, overflow: "hidden"}}>
    <div className="phone-bg"/>
    <div style={{position: "relative", zIndex: 1}}><StatusBar/></div>
    <TopBar leftKind="back" onBack={onBack} title="Brand profile" right={<button className="btn-ghost" style={{padding: "0 12px", fontSize: 14, color: "var(--accent)", border: 0, background: "transparent", cursor: "pointer", fontWeight: 600, height: 36}}>Save</button>}/>

    <div style={{
      position: "absolute", top: 116, left: 0, right: 0, bottom: 0,
      overflowY: "auto", padding: "12px 16px 32px", zIndex: 1,
    }}>
      {/* Photo + name */}
      <div className="glass-card-elev" style={{padding: 20, marginBottom: 14, textAlign: "center"}}>
        <div style={{position: "relative", display: "inline-block", marginBottom: 12}}>
          <div style={{
            width: 84, height: 84, borderRadius: 20,
            background: "linear-gradient(135deg, #fb923c, #eb7825)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontWeight: 700, fontSize: 36, color: "white",
            border: "2px solid rgba(255,255,255,0.12)",
          }}>L</div>
          <button style={{
            position: "absolute", bottom: -4, right: -4,
            width: 32, height: 32, borderRadius: 999, border: "2px solid #14171c",
            background: "var(--accent)", color: "white",
            display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
          }}><MinglaIcon name="edit" size={14}/></button>
        </div>
        <div style={{fontWeight: 700, fontSize: 18, letterSpacing: -0.2}}>Lonely Moth</div>
        <div style={{fontSize: 12, color: "var(--text-tertiary)", marginTop: 2}}>mingla.com/<span style={{color: "white"}}>lonelymoth</span></div>
        <button onClick={onPublic} className="btn-secondary" style={{marginTop: 14, height: 36, fontSize: 13, padding: "0 16px"}}>
          <MinglaIcon name="eye" size={14}/> Preview public page
        </button>
      </div>

      <SectionLbl>About</SectionLbl>
      <div style={{display: "flex", flexDirection: "column", gap: 8, marginBottom: 16}}>
        <FieldRow label="Display name" value="Lonely Moth"/>
        <FieldRow label="Tagline" value="One room. One sound system. Slow-burn evenings in East London."/>
        <FieldRow label="Description" value="A six-year-running curatorial project from Sara Marlowe. Limited capacity, generous time."/>
      </div>

      <SectionLbl>Contact</SectionLbl>
      <div style={{display: "flex", flexDirection: "column", gap: 8, marginBottom: 16}}>
        <FieldRow label="Email" value="hello@lonelymoth.events" icon="mail"/>
        <FieldRow label="Phone" value="+44 7700 900 312" icon="bell"/>
      </div>

      <SectionLbl>Links</SectionLbl>
      <div style={{display: "flex", flexDirection: "column", gap: 8, marginBottom: 16}}>
        <FieldRow label="Website" value="lonelymoth.events" icon="globe"/>
        <FieldRow label="Instagram" value="@lonely.moth.events" icon="user"/>
        <FieldRow label="Add a link" value="" icon="plus" tone="accent"/>
      </div>

      <SectionLbl>Operations</SectionLbl>
      <div className="glass-card" style={{padding: 4, marginBottom: 16}}>
        <Row3 onClick={onPayments} icon="bank" label="Payments & Stripe" sub="Connected · UK · GBP" tone="success"/>
        <Row3 onClick={onTeam} icon="users" label="Team & permissions" sub="2 members"/>
        <Row3 icon="receipt" label="Tax & VAT settings" sub="VAT registered · GB123456789"/>
        <Row3 icon="chart" label="Finance reports" sub="Export Stripe-ready CSVs" last/>
      </div>

      <SectionLbl>Brand on Mingla</SectionLbl>
      <div style={{display: "flex", flexDirection: "column", gap: 8, marginBottom: 16}}>
        <ToggleRowMini label="Show attendee count" sub="Display live RSVP numbers" on/>
        <ToggleRowMini label="Allow followers to message" sub="Members can DM your brand" on={false}/>
        <ToggleRowMini label="List in Discover" sub="Surface this brand to new audiences" on/>
      </div>
    </div>
  </div>
);

const SectionLbl = ({ children }) => (
  <div style={{fontSize: 11, color: "var(--text-tertiary)", letterSpacing: 1.4, fontWeight: 700, textTransform: "uppercase", padding: "8px 4px"}}>{children}</div>
);

const FieldRow = ({ label, value, icon, tone }) => (
  <div className="glass-card" style={{padding: "12px 14px", display: "flex", alignItems: "center", gap: 12}}>
    {icon && <MinglaIcon name={icon} size={16} color={tone === "accent" ? "var(--accent)" : "var(--text-tertiary)"}/>}
    <div style={{flex: 1, minWidth: 0}}>
      <div style={{fontSize: 11, color: "var(--text-tertiary)", marginBottom: 2}}>{label}</div>
      <div style={{fontSize: 14, color: tone === "accent" ? "var(--accent)" : "white", fontWeight: tone === "accent" ? 600 : 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis"}}>
        {value || "—"}
      </div>
    </div>
    <MinglaIcon name="chevR" size={14} color="var(--text-tertiary)"/>
  </div>
);

const Row3 = ({ icon, label, sub, tone, last, onClick }) => (
  <button onClick={onClick} style={{
    width: "100%", padding: "12px 12px", border: 0,
    background: "transparent", color: "white", fontFamily: "inherit",
    cursor: "pointer", textAlign: "left",
    display: "flex", alignItems: "center", gap: 12,
    borderBottom: last ? 0 : "1px solid rgba(255,255,255,0.04)",
  }}>
    <div style={{
      width: 32, height: 32, borderRadius: 10,
      background: tone === "success" ? "var(--success-tint)" : "rgba(255,255,255,0.04)",
      display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
    }}><MinglaIcon name={icon} size={16} color={tone === "success" ? "var(--success)" : "white"}/></div>
    <div style={{flex: 1, minWidth: 0}}>
      <div style={{fontSize: 14, fontWeight: 500}}>{label}</div>
      <div style={{fontSize: 11, color: tone === "success" ? "var(--success)" : "var(--text-tertiary)", marginTop: 1}}>{sub}</div>
    </div>
    <MinglaIcon name="chevR" size={14} color="var(--text-tertiary)"/>
  </button>
);

const ToggleRowMini = ({ label, sub, on }) => (
  <div className="glass-card" style={{padding: "12px 14px", display: "flex", alignItems: "center", gap: 12}}>
    <div style={{flex: 1}}>
      <div style={{fontWeight: 500, fontSize: 13, marginBottom: 2}}>{label}</div>
      <div style={{fontSize: 11, color: "var(--text-tertiary)"}}>{sub}</div>
    </div>
    <div style={{width: 40, height: 24, borderRadius: 999, background: on ? "var(--accent)" : "rgba(255,255,255,0.16)", position: "relative"}}>
      <div style={{position: "absolute", top: 3, left: on ? 19 : 3, width: 18, height: 18, borderRadius: 999, background: "white"}}/>
    </div>
  </div>
);

// ===== BRAND PAYMENTS · STRIPE =====
const BrandPaymentsScreen = ({ onBack, onReports }) => (
  <div style={{position: "absolute", inset: 0, overflow: "hidden"}}>
    <div className="phone-bg"/>
    <div style={{position: "relative", zIndex: 1}}><StatusBar/></div>
    <TopBar leftKind="back" onBack={onBack} title="Payments" right={<IconChrome icon="settings"/>}/>

    <div style={{
      position: "absolute", top: 116, left: 0, right: 0, bottom: 0,
      overflowY: "auto", padding: "12px 16px 32px", zIndex: 1,
    }}>
      {/* Stripe connected card */}
      <div className="glass-card-elev" style={{padding: 20, marginBottom: 14, position: "relative", overflow: "hidden"}}>
        <div style={{position: "absolute", top: 0, right: 0, width: 140, height: 140, borderRadius: "50%", background: "radial-gradient(circle, rgba(99,91,255,0.18), transparent 60%)"}}/>
        <div style={{display: "flex", alignItems: "center", gap: 12, marginBottom: 14, position: "relative"}}>
          <div style={{
            width: 44, height: 44, borderRadius: 12,
            background: "linear-gradient(135deg,#635bff,#7a73ff)",
            display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 18,
          }}>S</div>
          <div style={{flex: 1}}>
            <div style={{fontWeight: 700, fontSize: 16}}>Stripe</div>
            <div style={{fontSize: 12, color: "var(--success)", display: "flex", alignItems: "center", gap: 6}}>
              <span className="dot" style={{background: "var(--success)"}}/>
              Connected · acct_1Lo···Mt
            </div>
          </div>
        </div>
        <div style={{display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, position: "relative"}}>
          <KpiMini label="Available" value="£3,840" mono/>
          <KpiMini label="In transit" value="£1,260" mono sub="2 payouts pending"/>
        </div>
      </div>

      {/* Acceptance */}
      <SectionLbl>Accepted methods</SectionLbl>
      <div className="glass-card" style={{padding: 4, marginBottom: 16}}>
        <PayMethod icon="ticket" label="Online card payments" sub="Visa, Mastercard, Amex" on/>
        <PayMethod icon="tap" label="In-person card · Tap to Pay" sub="iPhone NFC · no terminal needed" on/>
        <PayMethod icon="cash" label="Door cash sales" sub="Manually recorded" on/>
        <PayMethod icon="globe" label="Apple Pay / Google Pay" sub="Auto-enabled with cards" on last/>
      </div>

      {/* Fees */}
      <SectionLbl>Fees</SectionLbl>
      <div className="glass-card" style={{padding: 16, marginBottom: 16}}>
        <Row3b label="Mingla service fee" value="2% + £0.30"/>
        <Row3b label="Stripe processing" value="1.5% + £0.20" sub="Domestic UK card"/>
        <Row3b label="International cards" value="3.25%"/>
        <Row3b label="Pass fees to buyer" value="On" tone="accent" last/>
      </div>

      {/* Payouts */}
      <SectionLbl>Payouts</SectionLbl>
      <div className="glass-card" style={{padding: 16, marginBottom: 14}}>
        <Row3b label="Schedule" value="Daily · 2 day delay"/>
        <Row3b label="Bank account" value="Lloyds •• 4012" sub="GBP · UK"/>
        <Row3b label="Statement descriptor" value="LONELYMOTH" last/>
      </div>

      <button onClick={onReports} className="glass-card" style={{
        width: "100%", padding: 14, border: 0, color: "white", fontFamily: "inherit", cursor: "pointer", textAlign: "left",
        display: "flex", alignItems: "center", gap: 12,
      }}>
        <MinglaIcon name="receipt" size={18} color="var(--accent)"/>
        <div style={{flex: 1}}>
          <div style={{fontSize: 14, fontWeight: 600}}>Finance reports</div>
          <div style={{fontSize: 11, color: "var(--text-tertiary)"}}>Stripe-ready CSV · payouts · tax-ready</div>
        </div>
        <MinglaIcon name="chevR" size={14} color="var(--text-tertiary)"/>
      </button>
    </div>
  </div>
);

const KpiMini = ({ label, value, sub, mono }) => (
  <div className="glass-card" style={{padding: 12}}>
    <div style={{fontSize: 10, color: "var(--text-tertiary)", letterSpacing: 0.4, fontWeight: 600, textTransform: "uppercase", marginBottom: 4}}>{label}</div>
    <div className={mono ? "mono" : ""} style={{fontSize: 18, fontWeight: 700, color: "white"}}>{value}</div>
    {sub && <div style={{fontSize: 10, color: "var(--text-tertiary)", marginTop: 2}}>{sub}</div>}
  </div>
);

const PayMethod = ({ icon, label, sub, on, last }) => (
  <div style={{
    padding: "12px 12px", display: "flex", alignItems: "center", gap: 12,
    borderBottom: last ? 0 : "1px solid rgba(255,255,255,0.04)",
  }}>
    <div style={{width: 32, height: 32, borderRadius: 10, background: "rgba(255,255,255,0.04)", display: "flex", alignItems: "center", justifyContent: "center"}}>
      <MinglaIcon name={icon} size={16}/>
    </div>
    <div style={{flex: 1, minWidth: 0}}>
      <div style={{fontSize: 14, fontWeight: 500}}>{label}</div>
      <div style={{fontSize: 11, color: "var(--text-tertiary)"}}>{sub}</div>
    </div>
    <div style={{width: 40, height: 24, borderRadius: 999, background: on ? "var(--accent)" : "rgba(255,255,255,0.16)", position: "relative"}}>
      <div style={{position: "absolute", top: 3, left: on ? 19 : 3, width: 18, height: 18, borderRadius: 999, background: "white"}}/>
    </div>
  </div>
);

const Row3b = ({ label, value, sub, tone, last }) => (
  <div style={{
    padding: "10px 0", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
    borderBottom: last ? 0 : "1px solid rgba(255,255,255,0.04)",
  }}>
    <div>
      <div style={{fontSize: 13, color: "var(--text-secondary)"}}>{label}</div>
      {sub && <div style={{fontSize: 11, color: "var(--text-tertiary)", marginTop: 2}}>{sub}</div>}
    </div>
    <div className="mono" style={{fontSize: 13, fontWeight: 600, color: tone === "accent" ? "var(--accent)" : "white"}}>{value}</div>
  </div>
);

// ===== FINANCE REPORTS =====
const FinanceReportsScreen = ({ onBack }) => (
  <div style={{position: "absolute", inset: 0, overflow: "hidden"}}>
    <div className="phone-bg"/>
    <div style={{position: "relative", zIndex: 1}}><StatusBar/></div>
    <TopBar leftKind="back" onBack={onBack} title="Finance" right={<IconChrome icon="download"/>}/>

    <div style={{
      position: "absolute", top: 116, left: 0, right: 0, bottom: 0,
      overflowY: "auto", padding: "12px 16px 32px", zIndex: 1,
    }}>
      {/* Period switcher */}
      <div style={{display: "flex", gap: 6, marginBottom: 14}}>
        {["7d", "30d", "90d", "YTD", "All"].map((p, i) => (
          <button key={p} className={i === 1 ? "" : "glass-card"} style={{
            flex: 1, height: 32, borderRadius: 999, border: i === 1 ? "1px solid var(--accent-border)" : undefined,
            background: i === 1 ? "var(--accent-tint)" : undefined,
            color: "white", fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer",
          }}>{p}</button>
        ))}
      </div>

      {/* Headline */}
      <div className="glass-card-elev" style={{padding: 20, marginBottom: 12}}>
        <div style={{fontSize: 11, color: "var(--text-tertiary)", letterSpacing: 1.4, fontWeight: 600, textTransform: "uppercase", marginBottom: 4}}>Net revenue · 30d</div>
        <div className="mono" style={{fontSize: 32, fontWeight: 700, letterSpacing: -0.4, color: "white"}}>£18,720.40</div>
        <div style={{fontSize: 12, color: "var(--success)", fontWeight: 600, marginTop: 4}}>+22% vs prior 30d · £3,378 more</div>

        <div style={{display: "flex", alignItems: "flex-end", gap: 4, height: 56, marginTop: 16}}>
          {[24, 32, 18, 28, 36, 44, 30, 52, 40, 58, 64, 48, 56, 72, 68, 60, 78, 84, 72, 90, 80, 95, 88, 76, 100, 92, 70, 84, 76, 96].map((v, i) => (
            <div key={i} style={{
              flex: 1, height: `${v}%`,
              background: i >= 25 ? "linear-gradient(180deg, #fb923c, #eb7825)" : "rgba(255,255,255,0.16)",
              borderRadius: 2,
            }}/>
          ))}
        </div>
      </div>

      {/* Breakdown */}
      <div className="glass-card" style={{padding: 16, marginBottom: 12}}>
        <Row3b label="Gross sales" value="£20,420.00"/>
        <Row3b label="Refunds" value="−£480.00" tone="accent"/>
        <Row3b label="Mingla fee (2% + £0.30)" value="−£612.40"/>
        <Row3b label="Stripe processing" value="−£607.20"/>
        <Row3b label="Net to bank" value="£18,720.40" last/>
      </div>

      {/* By event */}
      <SectionLbl>Top events · 30d</SectionLbl>
      <div className="glass-card" style={{padding: 4, marginBottom: 12}}>
        <RevRow title="Slow Burn vol. 4" sub="284 sold · in person" amt="£8,420"/>
        <RevRow title="Sunday Languor (4 brunches)" sub="248 sold · brunch series" amt="£5,420"/>
        <RevRow title="A Long Sit-Down" sub="32 sold · upcoming" amt="£1,920"/>
        <RevRow title="Slow Burn vol. 3" sub="392 sold · ended" amt="£2,960" last/>
      </div>

      {/* Exports */}
      <SectionLbl>Exports</SectionLbl>
      <div className="glass-card" style={{padding: 4}}>
        <Row3 icon="receipt" label="Stripe payouts CSV" sub="For Xero / QuickBooks"/>
        <Row3 icon="receipt" label="Tax-ready (UK VAT)" sub="Quarterly summary"/>
        <Row3 icon="receipt" label="All transactions" sub="Itemised CSV" last/>
      </div>
    </div>
  </div>
);

const RevRow = ({ title, sub, amt, last }) => (
  <div style={{
    padding: "12px 12px", display: "flex", alignItems: "center", gap: 12,
    borderBottom: last ? 0 : "1px solid rgba(255,255,255,0.04)",
  }}>
    <div style={{flex: 1, minWidth: 0}}>
      <div style={{fontSize: 13, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis"}}>{title}</div>
      <div style={{fontSize: 11, color: "var(--text-tertiary)", marginTop: 2}}>{sub}</div>
    </div>
    <span className="mono" style={{fontSize: 14, fontWeight: 700}}>{amt}</span>
  </div>
);

window.BrandSwitcherSheet = BrandSwitcherSheet;
window.BrandsListScreen = BrandsListScreen;
window.BrandProfileScreen = BrandProfileScreen;
window.BrandPaymentsScreen = BrandPaymentsScreen;
window.FinanceReportsScreen = FinanceReportsScreen;
