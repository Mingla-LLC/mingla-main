/* global React */

// =================================================================
// EMAIL COMPOSER — Pick template · Edit · Audience · Schedule · Preview
// =================================================================

const EMAIL_TEMPLATES = [
  { id: "blank",  name: "Blank",                kind: "Start fresh",      icon: "edit",  preview: "blank" },
  { id: "ann",    name: "Event announce",       kind: "Acquisition",      icon: "rocket", preview: "ann" },
  { id: "ls",     name: "Last chance · 24h",    kind: "Conversion",       icon: "clock", preview: "ls" },
  { id: "tonight",name: "Tonight · doors open", kind: "Day-of",           icon: "calendar", preview: "tonight" },
  { id: "thx",    name: "Thank you · post",     kind: "Retention",        icon: "star", preview: "thx" },
  { id: "wait",   name: "Waitlist released",    kind: "Conversion",       icon: "ticket", preview: "wait" },
  { id: "vip",    name: "VIP early access",     kind: "Loyalty",          icon: "award", preview: "vip" },
];

// ===== EMAIL TEMPLATES PICKER =====
const EmailTemplatesScreen = ({ onBack, onPick }) => (
  <div style={{position: "absolute", inset: 0, overflow: "hidden"}}>
    <div className="phone-bg"/>
    <div style={{position: "relative", zIndex: 1}}><StatusBar/></div>
    <TopBar leftKind="back" onBack={onBack} title="Email" right={<IconChrome icon="search"/>}/>

    <div style={{position: "absolute", top: 116, left: 0, right: 0, bottom: 0, overflowY: "auto", padding: "8px 16px 32px", zIndex: 1}}>
      <div style={{padding: "4px 8px 16px"}}>
        <h1 style={{fontSize: 22, fontWeight: 700, letterSpacing: -0.2, margin: 0}}>Start a campaign</h1>
        <div style={{fontSize: 13, color: "var(--text-secondary)", marginTop: 4}}>Pick a starting point — every template is editable.</div>
      </div>

      <SectionLbl>Templates</SectionLbl>
      <div style={{display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 16}}>
        {EMAIL_TEMPLATES.map((t) => (
          <button key={t.id} onClick={() => onPick(t.id)} className="glass-card" style={{
            padding: 0, border: 0, fontFamily: "inherit", cursor: "pointer", textAlign: "left",
            display: "flex", flexDirection: "column", color: "white", overflow: "hidden",
          }}>
            {/* Visual preview */}
            <div style={{
              aspectRatio: "1.4 / 1",
              background: "linear-gradient(180deg, oklch(0.18 0.01 60), oklch(0.13 0.01 60))",
              borderBottom: "1px solid rgba(255,255,255,0.04)",
              padding: 12, display: "flex", flexDirection: "column", justifyContent: "flex-end",
              position: "relative",
            }}>
              <TemplatePreview kind={t.preview}/>
            </div>
            <div style={{padding: "10px 12px"}}>
              <div style={{fontSize: 13, fontWeight: 600}}>{t.name}</div>
              <div style={{fontSize: 11, color: "var(--text-tertiary)", marginTop: 2}}>{t.kind}</div>
            </div>
          </button>
        ))}
      </div>

      <SectionLbl>Recent drafts</SectionLbl>
      <div className="glass-card" style={{padding: 4}}>
        <DraftRow name="Slow Burn vol. 4 · last chance" sent="Sent · 14m ago" tone="success"/>
        <DraftRow name="VIP early access · vol. 5" sent="Draft · last edited 2h ago"/>
        <DraftRow name="Sunday Languor · April series" sent="Scheduled · Sat 09:00" tone="info" last/>
      </div>
    </div>
  </div>
);

const DraftRow = ({ name, sent, tone, last }) => (
  <div style={{
    padding: 12, display: "flex", alignItems: "center", gap: 12,
    borderBottom: last ? 0 : "1px solid rgba(255,255,255,0.04)",
  }}>
    <div style={{
      width: 32, height: 32, borderRadius: 8, flexShrink: 0,
      background: tone === "success" ? "var(--success-tint)" : tone === "info" ? "var(--info-tint)" : "rgba(255,255,255,0.04)",
      display: "flex", alignItems: "center", justifyContent: "center",
    }}><MinglaIcon name="mail" size={14} color={tone === "success" ? "var(--success)" : tone === "info" ? "var(--info)" : "white"}/></div>
    <div style={{flex: 1, minWidth: 0}}>
      <div style={{fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis"}}>{name}</div>
      <div style={{fontSize: 11, color: "var(--text-tertiary)", marginTop: 2}}>{sent}</div>
    </div>
    <MinglaIcon name="chevR" size={14} color="var(--text-tertiary)"/>
  </div>
);

const TemplatePreview = ({ kind }) => {
  const styles = {
    blank: { sub: "Untitled", h: "Your headline", b: "Body copy goes here." },
    ann: { sub: "Slow Burn vol. 4", h: "Tickets are live.", b: "27 May · East London" },
    ls: { sub: "Last chance", h: "24 hours left", b: "12 of 480 tickets remain" },
    tonight: { sub: "Tonight", h: "Doors at 9 PM", b: "Bring your QR · IDs at door" },
    thx: { sub: "Thank you", h: "That was special.", b: "Photos · early access" },
    wait: { sub: "Waitlist", h: "A seat just opened.", b: "Hold expires in 2h" },
    vip: { sub: "For you", h: "VIP early access.", b: "Tickets · 24h before public" },
  };
  const s = styles[kind] || styles.blank;
  if (kind === "blank") {
    return (
      <div style={{position: "absolute", inset: 12, border: "1px dashed rgba(255,255,255,0.12)", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-tertiary)"}}>
        <MinglaIcon name="plus" size={18} color="var(--text-tertiary)"/>
      </div>
    );
  }
  return (
    <>
      <div style={{fontSize: 7, color: "var(--text-tertiary)", letterSpacing: 0.4, fontWeight: 700, textTransform: "uppercase"}}>{s.sub}</div>
      <div style={{fontSize: 12, fontWeight: 700, marginTop: 4, lineHeight: 1.1, color: "white", letterSpacing: -0.1}}>{s.h}</div>
      <div style={{fontSize: 8, color: "var(--text-secondary)", marginTop: 4}}>{s.b}</div>
      {(kind === "ls" || kind === "tonight" || kind === "wait" || kind === "vip" || kind === "ann") && (
        <div style={{marginTop: 6, padding: "4px 8px", background: "var(--accent)", borderRadius: 4, fontSize: 8, fontWeight: 700, alignSelf: "flex-start"}}>Get tickets</div>
      )}
    </>
  );
};

// ===== EMAIL COMPOSER =====
const EmailComposerScreen = ({ onBack, onSchedule, onAudience, onPreview }) => {
  const [stage, setStage] = React.useState("setup"); // setup · content · review

  return (
    <div style={{position: "absolute", inset: 0, overflow: "hidden"}}>
      <div className="phone-bg"/>
      <div style={{position: "relative", zIndex: 1}}><StatusBar/></div>
      <TopBar leftKind="x" onBack={onBack} title="New campaign" right={<button className="btn-ghost" style={{padding: "0 12px", fontSize: 14, color: "var(--accent)", border: 0, background: "transparent", cursor: "pointer", fontWeight: 600, height: 36}}>Save</button>}/>

      {/* Step rail */}
      <div style={{position: "absolute", top: 116, left: 0, right: 0, padding: "0 16px", zIndex: 2}}>
        <div className="glass-card" style={{padding: 4, display: "flex", gap: 4}}>
          {["setup", "content", "review"].map((s, i) => {
            const a = s === stage;
            return (
              <button key={s} onClick={() => setStage(s)} style={{
                flex: 1, height: 32, borderRadius: 8,
                background: a ? "var(--accent)" : "transparent",
                color: "white", border: 0, fontSize: 12, fontWeight: 600,
                fontFamily: "inherit", cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              }}>
                <span style={{
                  width: 16, height: 16, borderRadius: 999, fontSize: 10, fontWeight: 700,
                  background: a ? "rgba(255,255,255,0.25)" : "rgba(255,255,255,0.08)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>{i + 1}</span>
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            );
          })}
        </div>
      </div>

      <div style={{
        position: "absolute", top: 168, left: 0, right: 0, bottom: 76,
        overflowY: "auto", padding: "12px 16px", zIndex: 1,
      }}>
        {stage === "setup" && <ComposerSetup onAudience={onAudience}/>}
        {stage === "content" && <ComposerContent onPreview={onPreview}/>}
        {stage === "review" && <ComposerReview onSchedule={onSchedule}/>}
      </div>

      {/* Footer */}
      <div style={{
        position: "absolute", left: 0, right: 0, bottom: 0,
        padding: "10px 16px 22px", background: "linear-gradient(180deg,transparent,#0c0d11 30%)",
        zIndex: 3, display: "flex", gap: 8,
      }}>
        {stage !== "review" ? (
          <>
            <button className="btn-secondary" style={{flex: 1}} onClick={onPreview}>
              <MinglaIcon name="eye" size={14}/> Preview
            </button>
            <button className="btn-primary" style={{flex: 1}} onClick={() => setStage(stage === "setup" ? "content" : "review")}>
              Continue <MinglaIcon name="chevR" size={14}/>
            </button>
          </>
        ) : (
          <>
            <button className="btn-secondary" style={{flex: 1}}>Send test</button>
            <button className="btn-primary" style={{flex: 1.4}} onClick={onSchedule}>
              <MinglaIcon name="send" size={14}/> Send · 2,418 people
            </button>
          </>
        )}
      </div>
    </div>
  );
};

const ComposerSetup = ({ onAudience }) => (
  <>
    <SectionLbl>Audience</SectionLbl>
    <button onClick={onAudience} className="glass-card" style={{
      padding: 14, marginBottom: 12, border: 0, color: "white", fontFamily: "inherit", cursor: "pointer", textAlign: "left",
      width: "100%", display: "flex", alignItems: "center", gap: 12,
    }}>
      <div style={{width: 36, height: 36, borderRadius: 10, background: "var(--accent-tint)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0}}>
        <MinglaIcon name="users" size={16} color="var(--accent)"/>
      </div>
      <div style={{flex: 1}}>
        <div style={{fontSize: 13, fontWeight: 600}}>Slow Burn vol. 4 · followers</div>
        <div style={{fontSize: 11, color: "var(--text-tertiary)"}}>2,418 contacts · email opt-in</div>
      </div>
      <MinglaIcon name="chevR" size={14} color="var(--text-tertiary)"/>
    </button>
    <div className="glass-card" style={{padding: 12, marginBottom: 16, fontSize: 12, color: "var(--text-secondary)", display: "flex", gap: 10, alignItems: "flex-start"}}>
      <MinglaIcon name="filter" size={14} color="var(--text-tertiary)"/>
      <div>
        <div style={{fontWeight: 600, color: "white", marginBottom: 2}}>Segment filters</div>
        Hasn't bought + opened last 30d · Add filter
      </div>
    </div>

    <SectionLbl>Sender</SectionLbl>
    <div style={{display: "flex", flexDirection: "column", gap: 8, marginBottom: 16}}>
      <FieldRow label="From name" value="Lonely Moth" icon="user"/>
      <FieldRow label="Reply to" value="hello@lonelymoth.events" icon="mail"/>
    </div>

    <SectionLbl>Subject & preview</SectionLbl>
    <div style={{display: "flex", flexDirection: "column", gap: 8}}>
      <FieldRow label="Subject line" value="24h left · Slow Burn vol. 4" icon="mail"/>
      <FieldRow label="Preview text" value="12 of 480 tickets remain. Then we lock the doors." icon="edit"/>
    </div>
  </>
);

const ComposerContent = ({ onPreview }) => (
  <>
    {/* Preview frame */}
    <div className="glass-card-elev" style={{padding: 0, marginBottom: 12, overflow: "hidden"}}>
      <div style={{
        padding: 16, background: "linear-gradient(135deg, oklch(0.22 0.04 60), oklch(0.18 0.04 60))",
        borderBottom: "1px solid rgba(255,255,255,0.04)",
      }}>
        <div style={{fontSize: 9, letterSpacing: 1.6, fontWeight: 700, color: "rgba(255,255,255,0.5)", textTransform: "uppercase"}}>Lonely Moth</div>
        <div style={{fontSize: 22, fontWeight: 700, color: "white", marginTop: 6, letterSpacing: -0.3, lineHeight: 1.05}}>24 hours left.</div>
        <div style={{fontSize: 13, color: "rgba(255,255,255,0.7)", marginTop: 4}}>Then we lock the doors.</div>
      </div>
      <div style={{padding: 16, fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.6}}>
        Hi {"{first_name}"} —<br/><br/>
        12 of 480 tickets remain for <strong style={{color: "white"}}>Slow Burn vol. 4</strong>. We open the doors at 9, the room runs until 3, and we don't list anyone we can't seat. <br/><br/>
        <button style={{
          padding: "10px 16px", background: "var(--accent)", border: 0, borderRadius: 8,
          color: "white", fontFamily: "inherit", fontSize: 12, fontWeight: 700, marginTop: 6, cursor: "pointer",
        }}>Get your ticket → £25</button>
      </div>
    </div>

    {/* Building blocks */}
    <SectionLbl>Add block</SectionLbl>
    <div style={{display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6, marginBottom: 16}}>
      {[
        { i: "edit", l: "Text" },
        { i: "image", l: "Image" },
        { i: "ticket", l: "CTA" },
        { i: "calendar", l: "Event" },
        { i: "users", l: "Lineup" },
        { i: "map", l: "Map" },
        { i: "globe", l: "Social" },
        { i: "branch", l: "Divider" },
      ].map((b) => (
        <button key={b.l} className="glass-card" style={{
          padding: "10px 4px", border: 0, color: "white", fontFamily: "inherit", cursor: "pointer",
          display: "flex", flexDirection: "column", alignItems: "center", gap: 4, fontSize: 10,
        }}>
          <MinglaIcon name={b.i} size={16}/>
          {b.l}
        </button>
      ))}
    </div>

    {/* AI assist */}
    <div className="glass-card" style={{
      padding: 14, marginBottom: 16, border: "1px solid var(--accent-border)",
      background: "linear-gradient(135deg, rgba(235,120,37,0.10), rgba(235,120,37,0.02))",
      display: "flex", gap: 12, alignItems: "flex-start",
    }}>
      <div style={{width: 32, height: 32, borderRadius: 999, background: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0}}>
        <MinglaIcon name="sparkle" size={14}/>
      </div>
      <div style={{flex: 1}}>
        <div style={{fontSize: 13, fontWeight: 600, color: "white"}}>Tighten this email with AI</div>
        <div style={{fontSize: 11, color: "var(--text-secondary)", marginTop: 2}}>Match Lonely Moth's voice · suggest subject lines · A/B test winners</div>
        <button style={{
          marginTop: 10, padding: "6px 12px", background: "var(--accent)", color: "white",
          border: 0, borderRadius: 6, fontSize: 11, fontWeight: 600, fontFamily: "inherit", cursor: "pointer",
        }}>Suggest 3 variants</button>
      </div>
    </div>

    <SectionLbl>Personalisation</SectionLbl>
    <div className="glass-card" style={{padding: 4}}>
      <Row3b label="{first_name}" value="Marcus"/>
      <Row3b label="{event_name}" value="Slow Burn vol. 4"/>
      <Row3b label="{event_date}" value="27 May, 9 PM"/>
      <Row3b label="{ticket_link}" value="…/lm/sb-4" last/>
    </div>
  </>
);

const ComposerReview = () => (
  <>
    <SectionLbl>Ready to send</SectionLbl>

    <div className="glass-card-elev" style={{padding: 16, marginBottom: 12}}>
      <div style={{fontSize: 11, color: "var(--text-tertiary)", letterSpacing: 1.4, fontWeight: 700, textTransform: "uppercase", marginBottom: 6}}>Preview · subject line</div>
      <div style={{fontSize: 14, fontWeight: 600, color: "white"}}>24h left · Slow Burn vol. 4</div>
      <div style={{fontSize: 12, color: "var(--text-secondary)", marginTop: 2}}>12 of 480 tickets remain. Then we lock the doors.</div>
      <div style={{display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 14}}>
        <KpiTileSm label="Recipients" value="2,418"/>
        <KpiTileSm label="Est. opens" value="≈ 1,015"/>
      </div>
    </div>

    <SectionLbl>Schedule</SectionLbl>
    <div className="glass-card" style={{padding: 4, marginBottom: 12}}>
      <ScheduleOpt icon="send" label="Send now" sub="Delivery starts immediately" selected/>
      <ScheduleOpt icon="clock" label="Schedule for later" sub="Sat 25 May · 09:00 BST"/>
      <ScheduleOpt icon="sparkle" label="AI Smart Send" sub="Send when each contact is most likely to open" last/>
    </div>

    <SectionLbl>Pre-flight</SectionLbl>
    <div className="glass-card" style={{padding: 4, marginBottom: 12}}>
      <CheckRow label="Subject line under 50 chars" ok/>
      <CheckRow label="Has unsubscribe link" ok/>
      <CheckRow label="No broken merge tags" ok/>
      <CheckRow label="Test sent to hello@" ok last/>
    </div>

    <div className="glass-card" style={{padding: 12, fontSize: 11, color: "var(--text-tertiary)", display: "flex", gap: 8, alignItems: "flex-start"}}>
      <MinglaIcon name="shield" size={14} color="var(--text-tertiary)"/>
      <div>By sending, you confirm recipients consented to email from Lonely Moth. Mingla will append unsubscribe + your business address (GDPR / CAN-SPAM).</div>
    </div>
  </>
);

const ScheduleOpt = ({ icon, label, sub, selected, last }) => (
  <div style={{
    padding: 12, display: "flex", alignItems: "center", gap: 12,
    background: selected ? "var(--accent-tint)" : "transparent",
    borderRadius: selected ? 12 : 0,
    borderBottom: last ? 0 : "1px solid rgba(255,255,255,0.04)",
  }}>
    <div style={{
      width: 32, height: 32, borderRadius: 999, flexShrink: 0,
      background: selected ? "var(--accent)" : "rgba(255,255,255,0.06)",
      display: "flex", alignItems: "center", justifyContent: "center",
    }}><MinglaIcon name={icon} size={14}/></div>
    <div style={{flex: 1}}>
      <div style={{fontSize: 13, fontWeight: 600}}>{label}</div>
      <div style={{fontSize: 11, color: "var(--text-tertiary)", marginTop: 2}}>{sub}</div>
    </div>
    <div style={{width: 18, height: 18, borderRadius: 999, border: `2px solid ${selected ? "var(--accent)" : "rgba(255,255,255,0.2)"}`, display: "flex", alignItems: "center", justifyContent: "center"}}>
      {selected && <span style={{width: 8, height: 8, borderRadius: 999, background: "var(--accent)"}}/>}
    </div>
  </div>
);

const CheckRow = ({ label, ok, last }) => (
  <div style={{
    padding: 10, display: "flex", alignItems: "center", gap: 10,
    borderBottom: last ? 0 : "1px solid rgba(255,255,255,0.04)",
  }}>
    <div style={{width: 18, height: 18, borderRadius: 999, background: "var(--success-tint)", border: "1px solid var(--success-border)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0}}>
      <MinglaIcon name="check" size={11} color="var(--success)"/>
    </div>
    <div style={{flex: 1, fontSize: 12, color: "var(--text-secondary)"}}>{label}</div>
  </div>
);

// ===== SMS COMPOSER =====
const SmsComposerScreen = ({ onBack }) => (
  <div style={{position: "absolute", inset: 0, overflow: "hidden"}}>
    <div className="phone-bg"/>
    <div style={{position: "relative", zIndex: 1}}><StatusBar/></div>
    <TopBar leftKind="x" onBack={onBack} title="New SMS" right={<button className="btn-ghost" style={{padding: "0 12px", fontSize: 14, color: "var(--accent)", border: 0, background: "transparent", cursor: "pointer", fontWeight: 600, height: 36}}>Save</button>}/>

    <div style={{position: "absolute", top: 116, left: 0, right: 0, bottom: 76, overflowY: "auto", padding: "12px 16px", zIndex: 1}}>
      {/* iOS-style preview */}
      <div className="glass-card-elev" style={{padding: 16, marginBottom: 14, background: "linear-gradient(180deg, oklch(0.18 0.01 60), oklch(0.12 0.01 60))"}}>
        <div style={{textAlign: "center", fontSize: 10, color: "var(--text-tertiary)", letterSpacing: 1.4, fontWeight: 600, textTransform: "uppercase", marginBottom: 12}}>Tue · 18:42</div>
        <div style={{textAlign: "center", fontSize: 11, fontWeight: 600, color: "var(--text-secondary)", marginBottom: 12}}>LonelyMoth</div>
        <div style={{
          maxWidth: 240, padding: "10px 14px", borderRadius: 18,
          background: "rgba(255,255,255,0.08)", margin: "0 auto",
          fontSize: 13, color: "white", lineHeight: 1.4,
        }}>
          Tonight · doors at 9 PM. Bring your QR — IDs at the door. See you in a few hours. <br/>
          <span style={{color: "var(--info)"}}>Reply STOP to opt out</span>
        </div>
        <div style={{textAlign: "center", marginTop: 12}}>
          <span className="mono" style={{fontSize: 11, color: "var(--text-tertiary)"}}>132 / 160 chars · 1 segment</span>
        </div>
      </div>

      <SectionLbl>From</SectionLbl>
      <div className="glass-card" style={{padding: 12, marginBottom: 14, display: "flex", alignItems: "center", gap: 10}}>
        <div style={{width: 32, height: 32, borderRadius: 999, background: "var(--success-tint)", display: "flex", alignItems: "center", justifyContent: "center"}}>
          <MinglaIcon name="sms" size={14} color="var(--success)"/>
        </div>
        <div style={{flex: 1}}>
          <div style={{fontSize: 13, fontWeight: 600}}>LonelyMoth</div>
          <div style={{fontSize: 11, color: "var(--text-tertiary)"}}>Sender ID · UK alphanumeric</div>
        </div>
        <MinglaIcon name="check" size={14} color="var(--success)"/>
      </div>

      <SectionLbl>Audience</SectionLbl>
      <div className="glass-card" style={{padding: 12, marginBottom: 14, display: "flex", alignItems: "center", gap: 10}}>
        <div style={{width: 32, height: 32, borderRadius: 999, background: "var(--accent-tint)", display: "flex", alignItems: "center", justifyContent: "center"}}>
          <MinglaIcon name="users" size={14} color="var(--accent)"/>
        </div>
        <div style={{flex: 1}}>
          <div style={{fontSize: 13, fontWeight: 600}}>vol. 4 attendees · SMS opted in</div>
          <div style={{fontSize: 11, color: "var(--text-tertiary)"}}>284 recipients · est. cost £8.52</div>
        </div>
      </div>

      <SectionLbl>Message</SectionLbl>
      <div className="glass-card" style={{padding: 14, marginBottom: 12}}>
        <div style={{fontSize: 13, color: "white", lineHeight: 1.5, marginBottom: 12}}>
          Tonight · doors at 9 PM. Bring your QR — IDs at the door. See you in a few hours. Reply STOP to opt out
        </div>
        <div style={{display: "flex", gap: 6, flexWrap: "wrap"}}>
          {["{first_name}", "{event_date}", "{ticket_link}"].map((t, i) => (
            <span key={i} className="pill" style={{background: "rgba(255,255,255,0.06)", fontSize: 11, fontFamily: "var(--font-mono)"}}>{t}</span>
          ))}
        </div>
      </div>

      <div className="glass-card" style={{
        padding: 12, fontSize: 11, color: "var(--text-tertiary)",
        display: "flex", gap: 8, alignItems: "flex-start",
      }}>
        <MinglaIcon name="shield" size={14} color="var(--text-tertiary)"/>
        <div>SMS only sent to opted-in numbers. STOP / HELP keywords handled automatically. SMS rate: £0.03 per segment.</div>
      </div>
    </div>

    <div style={{
      position: "absolute", left: 0, right: 0, bottom: 0,
      padding: "10px 16px 22px", background: "linear-gradient(180deg,transparent,#0c0d11 30%)",
      zIndex: 3, display: "flex", gap: 8,
    }}>
      <button className="btn-secondary" style={{flex: 1}}>
        <MinglaIcon name="clock" size={14}/> Schedule
      </button>
      <button className="btn-primary" style={{flex: 1.4}}>
        <MinglaIcon name="send" size={14}/> Send to 284
      </button>
    </div>
  </div>
);

// ===== JOURNEYS =====
const JOURNEYS = [
  { i: "calendarPlus", title: "24h pre-event reminder", sub: "Email + SMS · 1,824 entered · 11.4% click", color: "var(--accent)", on: true },
  { i: "rocket", title: "Tonight · doors open", sub: "SMS · 284 entered · 22% click", color: "var(--success)", on: true },
  { i: "star", title: "Thank you · 24h post-event", sub: "Email · 392 entered · 41% open", color: "var(--info)", on: true },
  { i: "ticket", title: "Abandoned checkout", sub: "Email · 14 recovered orders · £490", color: "var(--warning)", on: false },
  { i: "users", title: "Waitlist released", sub: "Email + SMS · 62 entered · 18% conv", color: "var(--info)", on: true },
  { i: "award", title: "VIP early access (3+ orders)", sub: "Email · 184 entered · 34% conv", color: "var(--accent)", on: true },
];

const JourneysScreen = ({ onBack, onJourney }) => (
  <div style={{position: "absolute", inset: 0, overflow: "hidden"}}>
    <div className="phone-bg"/>
    <div style={{position: "relative", zIndex: 1}}><StatusBar/></div>
    <TopBar leftKind="back" onBack={onBack} title="Journeys" right={<IconChrome icon="plus"/>}/>

    <div style={{position: "absolute", top: 116, left: 0, right: 0, bottom: 0, overflowY: "auto", padding: "8px 16px 32px", zIndex: 1}}>
      <div style={{padding: "4px 8px 12px"}}>
        <h1 style={{fontSize: 22, fontWeight: 700, letterSpacing: -0.2, margin: 0}}>Automated journeys</h1>
        <div style={{fontSize: 13, color: "var(--text-secondary)", marginTop: 4}}>Drip messages on a trigger — no manual sends.</div>
      </div>

      {/* Stat strip */}
      <div className="glass-card-elev" style={{padding: 14, marginBottom: 14, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10}}>
        <KpiCell label="Active" value="5" sub="of 9"/>
        <KpiCell label="Entered · 30d" value="2,748"/>
        <KpiCell label="Revenue" value="£2,140" sub="+18%"/>
      </div>

      <SectionLbl>All journeys</SectionLbl>
      <div style={{display: "flex", flexDirection: "column", gap: 8}}>
        {JOURNEYS.map((j, i) => (
          <button key={i} onClick={() => onJourney(j)} className="glass-card" style={{
            padding: 14, border: 0, color: "white", fontFamily: "inherit", cursor: "pointer", textAlign: "left",
            display: "flex", alignItems: "center", gap: 12,
          }}>
            <div style={{
              width: 40, height: 40, borderRadius: 12, flexShrink: 0,
              background: `${j.color.replace(")", " / 0.12)").replace("var(--", "var(--")}`,
              border: `1px solid ${j.color.replace(")", " / 0.3)").replace("var(--", "var(--")}`,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}><MinglaIcon name={j.i} size={18} color={j.color}/></div>
            <div style={{flex: 1, minWidth: 0}}>
              <div style={{fontSize: 14, fontWeight: 600, display: "flex", alignItems: "center", gap: 6}}>
                {j.title}
                {j.on && <span className="dot" style={{background: "var(--success)"}}/>}
              </div>
              <div style={{fontSize: 11, color: "var(--text-tertiary)", marginTop: 2}}>{j.sub}</div>
            </div>
            <div style={{width: 36, height: 22, borderRadius: 999, background: j.on ? "var(--accent)" : "rgba(255,255,255,0.16)", position: "relative", flexShrink: 0}}>
              <div style={{position: "absolute", top: 3, left: j.on ? 17 : 3, width: 16, height: 16, borderRadius: 999, background: "white"}}/>
            </div>
          </button>
        ))}
      </div>
    </div>
  </div>
);

// ===== JOURNEY DETAIL (visual flow) =====
const JourneyDetailScreen = ({ onBack, journey = JOURNEYS[0] }) => (
  <div style={{position: "absolute", inset: 0, overflow: "hidden"}}>
    <div className="phone-bg"/>
    <div style={{position: "relative", zIndex: 1}}><StatusBar/></div>
    <TopBar leftKind="back" onBack={onBack} title="Journey" right={<><IconChrome icon="play"/><IconChrome icon="moreH"/></>}/>

    <div style={{position: "absolute", top: 116, left: 0, right: 0, bottom: 0, overflowY: "auto", padding: "8px 16px 32px", zIndex: 1}}>
      <div style={{padding: "4px 8px 12px"}}>
        <h1 style={{fontSize: 20, fontWeight: 700, letterSpacing: -0.2, margin: 0}}>{journey.title}</h1>
        <div style={{fontSize: 12, color: "var(--text-secondary)", marginTop: 4}}>{journey.sub}</div>
      </div>

      {/* Performance */}
      <div className="glass-card-elev" style={{padding: 14, marginBottom: 16, display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10}}>
        <KpiCell label="Entered" value="1,824"/>
        <KpiCell label="Completed" value="1,492" sub="82%"/>
        <KpiCell label="Click" value="11.4%"/>
        <KpiCell label="Revenue" value="£740"/>
      </div>

      <SectionLbl>Flow</SectionLbl>

      {/* Visual flow */}
      <div style={{display: "flex", flexDirection: "column", gap: 0, marginBottom: 16}}>
        <FlowNode kind="trigger" title="Trigger" sub="Event = 24h before start"/>
        <FlowConnector/>
        <FlowNode kind="action" title="Send email" sub='"Tomorrow night · Slow Burn vol. 4"' icon="mail"/>
        <FlowConnector/>
        <FlowNode kind="wait" title="Wait" sub="2 hours"/>
        <FlowConnector/>
        <FlowNode kind="branch" title="Branch · Opened email?" sub="Yes / No"/>
        <FlowConnector branch/>
        <div style={{display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8}}>
          <FlowNode kind="action" title="Wait 8h" sub="Then end" small icon="clock"/>
          <FlowNode kind="action" title="Send SMS" sub="Tonight · doors open" small icon="sms" warning/>
        </div>
      </div>

      <button className="glass-card" style={{
        width: "100%", padding: 12, color: "var(--accent)", fontFamily: "inherit", cursor: "pointer",
        border: "1px dashed rgba(235,120,37,0.3)", fontSize: 13, fontWeight: 600,
        display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
      }}>
        <MinglaIcon name="plus" size={14}/> Add a step
      </button>
    </div>
  </div>
);

const FlowNode = ({ kind, title, sub, icon, small, warning }) => {
  const meta = {
    trigger: { icon: "rocket", color: "var(--accent)" },
    action: { icon: icon || "mail", color: warning ? "var(--warning)" : "var(--info)" },
    wait: { icon: "clock", color: "var(--text-tertiary)" },
    branch: { icon: "branch", color: "var(--accent)" },
  }[kind];
  return (
    <div className="glass-card" style={{
      padding: small ? 10 : 14,
      borderColor: kind === "trigger" ? "var(--accent-border)" : undefined,
      background: kind === "trigger" ? "var(--accent-tint)" : undefined,
      display: "flex", alignItems: "center", gap: 10,
    }}>
      <div style={{
        width: small ? 28 : 36, height: small ? 28 : 36, borderRadius: 999, flexShrink: 0,
        background: meta.color === "var(--accent)" ? "var(--accent)" :
                    meta.color === "var(--info)" ? "var(--info-tint)" :
                    meta.color === "var(--warning)" ? "var(--warning-tint)" :
                    "rgba(255,255,255,0.06)",
        border: `1px solid ${meta.color === "var(--accent)" ? "transparent" : "rgba(255,255,255,0.08)"}`,
        display: "flex", alignItems: "center", justifyContent: "center",
        color: meta.color === "var(--accent)" ? "white" : meta.color,
      }}><MinglaIcon name={meta.icon} size={small ? 12 : 14} color="currentColor"/></div>
      <div style={{flex: 1, minWidth: 0}}>
        <div style={{fontSize: small ? 11 : 13, fontWeight: 600, color: "white"}}>{title}</div>
        <div style={{fontSize: small ? 9 : 11, color: "var(--text-tertiary)", marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis"}}>{sub}</div>
      </div>
    </div>
  );
};

const FlowConnector = ({ branch }) => (
  <div style={{height: 18, position: "relative", display: "flex", justifyContent: "center", alignItems: "center"}}>
    <div style={{width: 2, height: "100%", background: branch ? "transparent" : "rgba(255,255,255,0.12)"}}/>
    {branch && (
      <svg width="120" height="18" style={{position: "absolute"}} viewBox="0 0 120 18">
        <path d="M60 0 V8 H10 V18 M60 8 H110 V18" stroke="rgba(255,255,255,0.12)" strokeWidth="2" fill="none"/>
      </svg>
    )}
  </div>
);

window.EmailTemplatesScreen = EmailTemplatesScreen;
window.EmailComposerScreen = EmailComposerScreen;
window.SmsComposerScreen = SmsComposerScreen;
window.JourneysScreen = JourneysScreen;
window.JourneyDetailScreen = JourneyDetailScreen;
