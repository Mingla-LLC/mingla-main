/* global React */

// =================================================================
// EVENT CREATOR (7-step wizard) - condensed to key steps
// =================================================================

const EventCreatorScreen = ({ step, onNext, onBack, onPreview, onPublish }) => {
  const total = 7;
  const stepDefs = [
    { title: "Basics", sub: "Name, format, and category", content: <CreatorStep1/> },
    { title: "When", sub: "Date, time, and recurrence", content: <CreatorStep2/> },
    { title: "Where", sub: "Venue or online link", content: <CreatorStep3/> },
    { title: "Cover", sub: "Image, video, or GIF", content: <CreatorStep4/> },
    { title: "Tickets", sub: "Types, prices, capacity", content: <CreatorStep5/> },
    { title: "Settings", sub: "Visibility, approvals, transfers", content: <CreatorStep6/> },
    { title: "Preview", sub: "How it looks to guests", content: <CreatorStep7 onPreview={onPreview}/> },
  ];
  const cur = stepDefs[step];
  const last = step === total - 1;

  return (
    <div style={{position: "absolute", inset: 0, display: "flex", flexDirection: "column"}}>
      <div className="phone-bg"/>
      <div style={{position: "relative", zIndex: 1}}><StatusBar/></div>

      <div style={{position: "relative", zIndex: 1, padding: "8px 16px 0", display: "flex", alignItems: "center", gap: 8}}>
        <button onClick={onBack} style={{
          width: 36, height: 36, borderRadius: 999, border: 0,
          background: "rgba(255,255,255,0.06)", color: "white",
          display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
        }}><MinglaIcon name={step === 0 ? "close" : "chevL"} size={20}/></button>
        <div style={{flex: 1, display: "flex", gap: 3}}>
          {Array.from({length: total}).map((_, i) => (
            <div key={i} style={{
              flex: 1, height: 3, borderRadius: 999,
              background: i <= step ? "var(--accent)" : "rgba(255,255,255,0.12)",
            }}/>
          ))}
        </div>
        <span className="mono" style={{fontSize: 12, color: "var(--text-tertiary)"}}>{step + 1}/{total}</span>
      </div>

      <div className="fade-up" key={step} style={{
        position: "relative", zIndex: 1, flex: 1,
        padding: "24px 24px 12px", overflowY: "auto",
      }}>
        <div style={{fontSize: 11, color: "var(--accent)", letterSpacing: 1.4, fontWeight: 700, textTransform: "uppercase", marginBottom: 6}}>Step {step+1} of {total}</div>
        <h1 style={{fontSize: 26, fontWeight: 700, letterSpacing: -0.2, margin: "0 0 6px"}}>{cur.title}</h1>
        <p style={{fontSize: 14, color: "var(--text-secondary)", margin: "0 0 24px"}}>{cur.sub}</p>
        {cur.content}
      </div>

      <div style={{
        position: "relative", zIndex: 1,
        padding: "12px 24px 32px",
        display: "flex", flexDirection: "column", gap: 8,
        borderTop: "1px solid rgba(255,255,255,0.06)",
        background: "rgba(12,14,18,0.6)",
        backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)",
      }}>
        {last ? (
          <>
            <button className="btn btn-primary" onClick={onPublish}>Publish event</button>
            <button className="btn btn-ghost" onClick={onPreview}>Preview public page</button>
          </>
        ) : (
          <button className="btn btn-primary" onClick={onNext}>Continue</button>
        )}
      </div>
    </div>
  );
};

const Field = ({ label, children, helper }) => (
  <div style={{marginBottom: 14}}>
    <label style={{fontSize: 12, color: "var(--text-secondary)", marginBottom: 6, display: "block", fontWeight: 500}}>{label}</label>
    {children}
    {helper && <div style={{fontSize: 12, color: "var(--text-tertiary)", marginTop: 6}}>{helper}</div>}
  </div>
);

const CreatorStep1 = () => (
  <div>
    <Field label="Event name"><input className="input" defaultValue="Slow Burn vol. 4"/></Field>
    <Field label="Format">
      <div style={{display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6}}>
        {[{l:"In person",a:1},{l:"Online",a:0},{l:"Hybrid",a:0}].map((o,i)=> (
          <button key={i} className="glass-card" style={{
            padding: 12, fontSize: 13, fontWeight: 500, color: "white",
            border: o.a ? "1px solid var(--accent-border)" : undefined,
            background: o.a ? "var(--accent-tint)" : undefined,
            cursor: "pointer", fontFamily: "inherit",
          }}>{o.l}</button>
        ))}
      </div>
    </Field>
    <Field label="Category">
      <div className="input" style={{display: "flex", alignItems: "center", justifyContent: "space-between"}}>
        <span>Nightlife</span>
        <MinglaIcon name="chevD" size={16} color="var(--text-tertiary)"/>
      </div>
    </Field>
  </div>
);

const CreatorStep2 = () => (
  <div>
    <Field label="Repeats">
      <div className="input" style={{display: "flex", alignItems: "center", justifyContent: "space-between"}}>
        <span>Once</span>
        <MinglaIcon name="chevD" size={16} color="var(--text-tertiary)"/>
      </div>
    </Field>
    <Field label="Date"><input className="input" defaultValue="Friday, 15 May 2026"/></Field>
    <div style={{display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12}}>
      <Field label="Doors open"><input className="input" defaultValue="9:00 PM"/></Field>
      <Field label="Ends"><input className="input" defaultValue="3:00 AM"/></Field>
    </div>
    <Field label="Timezone" helper="We'll show this to guests in their local time">
      <div className="input" style={{display: "flex", alignItems: "center", justifyContent: "space-between"}}>
        <span>Europe/London (BST)</span>
        <MinglaIcon name="chevD" size={16} color="var(--text-tertiary)"/>
      </div>
    </Field>
  </div>
);

const CreatorStep3 = () => (
  <div>
    <Field label="Venue name"><input className="input" defaultValue="Hidden Rooms"/></Field>
    <Field label="Address" helper="Hidden until the buyer has a ticket">
      <input className="input" defaultValue="14 Curtain Rd, EC2A 3PT"/>
    </Field>
    <div className="glass-card" style={{padding: 0, height: 160, marginBottom: 14, position: "relative", overflow: "hidden"}}>
      <div style={{
        position: "absolute", inset: 0,
        background: `
          repeating-linear-gradient(45deg, rgba(255,255,255,0.02) 0px, rgba(255,255,255,0.02) 12px, transparent 12px, transparent 24px),
          radial-gradient(circle at 50% 60%, rgba(235,120,37,0.2), transparent 40%),
          oklch(0.25 0.02 250)
        `,
      }}/>
      <div style={{position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center"}}>
        <div style={{
          width: 32, height: 32, borderRadius: 999,
          background: "var(--accent)", border: "3px solid white",
          boxShadow: "0 0 20px var(--accent-glow)",
        }}/>
      </div>
      <div style={{position: "absolute", bottom: 12, right: 12, fontFamily: "var(--font-mono)", fontSize: 10, color: "rgba(255,255,255,0.4)"}}>map preview</div>
    </div>
    <div className="glass-card" style={{padding: 12, display: "flex", gap: 12, alignItems: "flex-start"}}>
      <div style={{width: 28, height: 28, borderRadius: 999, background: "var(--info-tint)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0}}>
        <MinglaIcon name="location" size={14} color="var(--info)"/>
      </div>
      <div style={{fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.5}}>
        Address appears in tickets and confirmation emails — not on the public page until the guest checks out.
      </div>
    </div>
  </div>
);

const CreatorStep4 = () => (
  <div>
    <Field label="Cover">
      <div style={{borderRadius: 16, overflow: "hidden", height: 180, marginBottom: 8}}>
        <EventCover hue={25} radius={16} label="cover · 16:9" height="100%"/>
      </div>
      <div style={{display: "flex", gap: 8}}>
        <button className="btn-secondary" style={{flex: 1, height: 40, fontSize: 13}}>Replace</button>
        <button className="btn-secondary" style={{flex: 1, height: 40, fontSize: 13}}>Crop</button>
      </div>
    </Field>
    <Field label="Or pick from the GIF library">
      <div style={{display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6}}>
        {[180, 220, 320, 30, 100, 60].map((h, i) => (
          <div key={i} style={{aspectRatio: "1", borderRadius: 8, overflow: "hidden"}}>
            <EventCover hue={h} radius={8} label="" height="100%"/>
          </div>
        ))}
      </div>
    </Field>
  </div>
);

const CreatorStep5 = () => (
  <div>
    <div style={{display: "flex", flexDirection: "column", gap: 10, marginBottom: 14}}>
      <TicketEditCard name="Early Bird" price="£25" cap="120" cls="paid"/>
      <TicketEditCard name="General Admission" price="£35" cap="250" cls="paid"/>
      <TicketEditCard name="VIP / Lounge" price="£75" cap="30" cls="paid"/>
    </div>
    <button className="glass-card" style={{
      width: "100%", padding: 14, border: "1px dashed rgba(255,255,255,0.2)",
      color: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
      cursor: "pointer", fontFamily: "inherit", fontSize: 14, fontWeight: 600,
    }}>
      <MinglaIcon name="plus" size={16}/> Add ticket type
    </button>
    <div className="glass-card" style={{padding: 14, marginTop: 14}}>
      <div style={{display: "flex", justifyContent: "space-between", marginBottom: 4}}>
        <span style={{fontSize: 13, color: "var(--text-secondary)"}}>Total capacity</span>
        <span className="mono" style={{fontWeight: 600}}>400</span>
      </div>
      <div style={{display: "flex", justifyContent: "space-between"}}>
        <span style={{fontSize: 13, color: "var(--text-secondary)"}}>Max revenue</span>
        <span className="mono" style={{fontWeight: 600}}>£12,000</span>
      </div>
    </div>
  </div>
);

const TicketEditCard = ({ name, price, cap }) => (
  <div className="glass-card" style={{padding: 14}}>
    <div style={{display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10}}>
      <div style={{flex: 1}}>
        <div style={{fontWeight: 600, fontSize: 14}}>{name}</div>
        <div style={{fontSize: 11, color: "var(--text-tertiary)", marginTop: 2}}>Paid · transferable · 1 per buyer</div>
      </div>
      <button style={{background: "transparent", border: 0, color: "var(--text-tertiary)", cursor: "pointer", padding: 4}}>
        <MinglaIcon name="edit" size={16}/>
      </button>
    </div>
    <div style={{display: "flex", gap: 8}}>
      <div style={{flex: 1, padding: "8px 10px", background: "rgba(255,255,255,0.04)", borderRadius: 8}}>
        <div style={{fontSize: 10, color: "var(--text-tertiary)", marginBottom: 2}}>Price</div>
        <div className="mono" style={{fontWeight: 600, fontSize: 14}}>{price}</div>
      </div>
      <div style={{flex: 1, padding: "8px 10px", background: "rgba(255,255,255,0.04)", borderRadius: 8}}>
        <div style={{fontSize: 10, color: "var(--text-tertiary)", marginBottom: 2}}>Capacity</div>
        <div className="mono" style={{fontWeight: 600, fontSize: 14}}>{cap}</div>
      </div>
    </div>
  </div>
);

const CreatorStep6 = () => (
  <div>
    <Field label="Visibility">
      <div className="glass-card" style={{padding: 4, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4}}>
        {[{l:"Public",a:1},{l:"Unlisted",a:0},{l:"Private",a:0}].map((o,i)=> (
          <button key={i} style={{
            padding: 10, fontSize: 12, fontWeight: 600, color: "white",
            border: 0, borderRadius: 12,
            background: o.a ? "var(--accent-tint)" : "transparent",
            cursor: "pointer", fontFamily: "inherit",
          }}>{o.l}</button>
        ))}
      </div>
    </Field>
    <ToggleRow label="Require approval to buy" sub="Manually approve every order" on={false}/>
    <ToggleRow label="Allow ticket transfers" sub="Buyers can send to friends" on={true}/>
    <ToggleRow label="Hide remaining count" sub="Don't show 'X tickets left'" on={false}/>
    <ToggleRow label="Password-protected" sub="Guests need a code to see it" on={false}/>
  </div>
);

const ToggleRow = ({ label, sub, on }) => (
  <div className="glass-card" style={{padding: 14, marginBottom: 8, display: "flex", alignItems: "center", gap: 12}}>
    <div style={{flex: 1}}>
      <div style={{fontWeight: 500, fontSize: 14, marginBottom: 2}}>{label}</div>
      <div style={{fontSize: 12, color: "var(--text-tertiary)"}}>{sub}</div>
    </div>
    <div style={{
      width: 44, height: 26, borderRadius: 999,
      background: on ? "var(--accent)" : "rgba(255,255,255,0.16)",
      position: "relative", transition: "background 200ms var(--ease-out)",
    }}>
      <div style={{
        position: "absolute", top: 3, left: on ? 21 : 3,
        width: 20, height: 20, borderRadius: 999, background: "white",
        transition: "left 200ms var(--ease-out)",
        boxShadow: "0 1px 2px rgba(0,0,0,0.2)",
      }}/>
    </div>
  </div>
);

const CreatorStep7 = ({ onPreview }) => (
  <div>
    <button onClick={onPreview} className="glass-card-elev" style={{
      width: "100%", padding: 0, border: 0, overflow: "hidden",
      cursor: "pointer", fontFamily: "inherit", textAlign: "left",
      background: "var(--glass-card-elev)",
    }}>
      <div style={{height: 140, position: "relative"}}>
        <EventCover hue={25} radius={0} label="" height="100%"/>
      </div>
      <div style={{padding: 16}}>
        <div style={{fontSize: 11, color: "var(--accent)", letterSpacing: 1.4, fontWeight: 700, textTransform: "uppercase", marginBottom: 4}}>Fri 15 May · 9:00 PM</div>
        <div style={{fontWeight: 700, fontSize: 18, letterSpacing: -0.2}}>Slow Burn vol. 4</div>
        <div style={{fontSize: 13, color: "var(--text-secondary)", marginTop: 2}}>Hidden Rooms · From £25</div>
      </div>
    </button>
    <div className="glass-card" style={{padding: 14, marginTop: 12, display: "flex", gap: 12, alignItems: "flex-start"}}>
      <MinglaIcon name="check" size={20} color="var(--success)"/>
      <div>
        <div style={{fontWeight: 600, fontSize: 14}}>Ready to publish</div>
        <div style={{fontSize: 12, color: "var(--text-secondary)", marginTop: 2, lineHeight: 1.5}}>
          Stripe is connected. Tickets will go live at mingla.com/e/lonelymoth/slowburn4.
        </div>
      </div>
    </div>
  </div>
);

window.EventCreatorScreen = EventCreatorScreen;
