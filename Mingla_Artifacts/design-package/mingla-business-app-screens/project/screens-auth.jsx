/* global React */

// =================================================================
// AUTH + ONBOARDING SCREENS
// =================================================================

const AuthScreen = ({ onSignIn }) => (
  <div style={{
    position: "absolute", inset: 0,
    background: `
      radial-gradient(120% 70% at 50% 0%, #fff9f5 0%, #ffffff 60%),
      #ffffff
    `,
    display: "flex", flexDirection: "column",
    padding: "44px 24px 24px",
  }}>
    <StatusBar />
    <div style={{flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", paddingTop: 60}}>
      <div style={{display: "flex", justifyContent: "center", marginBottom: 28}}>
        <MinglaMark size={64}/>
      </div>
      <h1 style={{
        fontSize: 30, fontWeight: 700, letterSpacing: -0.4,
        color: "#111827", textAlign: "center", margin: "0 0 12px",
      }}>Welcome to Mingla Business</h1>
      <p style={{
        fontSize: 16, color: "#4b5563", textAlign: "center",
        margin: 0, lineHeight: 1.5, maxWidth: 280, alignSelf: "center",
      }}>Run live experiences. Sell tickets, scan guests, settle payouts — all from one place.</p>
    </div>

    <div style={{display: "flex", flexDirection: "column", gap: 12}}>
      <button onClick={onSignIn} style={{
        height: 56, borderRadius: 999, border: "1px solid #e5e7eb",
        background: "white", color: "#111827", fontWeight: 600, fontSize: 16,
        display: "flex", alignItems: "center", justifyContent: "center", gap: 12,
        cursor: "pointer", fontFamily: "inherit",
        boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
      }}>
        <MinglaIcon name="google" size={20} strokeWidth={0}/>
        Continue with Google
      </button>
      <button style={{
        height: 56, borderRadius: 999, border: 0,
        background: "#111827", color: "white", fontWeight: 600, fontSize: 16,
        display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
        cursor: "pointer", fontFamily: "inherit",
      }}>
        <MinglaIcon name="apple" size={20} strokeWidth={0}/>
        Continue with Apple
      </button>
      <button style={{
        height: 56, borderRadius: 999, border: "1px solid #e5e7eb",
        background: "white", color: "#111827", fontWeight: 600, fontSize: 16,
        cursor: "pointer", fontFamily: "inherit",
      }}>
        Continue with email
      </button>
      <p style={{
        fontSize: 12, color: "#6b7280", textAlign: "center", margin: "12px 0 0",
        lineHeight: 1.5,
      }}>
        By continuing you agree to our <span style={{color: "var(--accent)", fontWeight: 600}}>Terms</span> and <span style={{color: "var(--accent)", fontWeight: 600}}>Privacy</span>.
      </p>
    </div>
  </div>
);

const OnboardingScreen = ({ step, onNext, onBack }) => {
  const steps = [
    {
      title: "What kind of operator are you?",
      subtitle: "Pick the option that fits best — you can change this anytime.",
      content: (
        <div style={{display: "flex", flexDirection: "column", gap: 10}}>
          {[
            { label: "Independent promoter", sub: "Solo or small crew running events" },
            { label: "Brand or hospitality", sub: "Venue, restaurant, hotel, members' club" },
            { label: "Lifestyle operator", sub: "Wellness, fitness, art, community" },
            { label: "Other", sub: "Tell us more on the next step" },
          ].map((o, i) => (
            <button key={i} className="glass-card" style={{
              padding: 16, textAlign: "left", border: i === 0 ? "1px solid var(--accent-border)" : undefined,
              background: i === 0 ? "var(--accent-tint)" : undefined,
              color: "white", cursor: "pointer", fontFamily: "inherit",
            }}>
              <div style={{fontWeight: 600, fontSize: 15, marginBottom: 2}}>{o.label}</div>
              <div style={{fontSize: 13, color: "var(--text-secondary)"}}>{o.sub}</div>
            </button>
          ))}
        </div>
      ),
    },
    {
      title: "Create your first brand",
      subtitle: "This is what guests see on tickets, emails, and your public page.",
      content: (
        <div style={{display: "flex", flexDirection: "column", gap: 16}}>
          <div>
            <label style={{fontSize: 13, color: "var(--text-secondary)", marginBottom: 6, display: "block"}}>Brand name</label>
            <input className="input" defaultValue="Lonely Moth"/>
          </div>
          <div>
            <label style={{fontSize: 13, color: "var(--text-secondary)", marginBottom: 6, display: "block"}}>Public URL</label>
            <div style={{display: "flex", alignItems: "center", gap: 0}}>
              <div className="input" style={{
                flex: "0 0 auto", paddingRight: 4, color: "var(--text-tertiary)",
                borderRight: 0, borderTopRightRadius: 0, borderBottomRightRadius: 0,
                width: "auto",
              }}>mingla.com/</div>
              <input className="input" defaultValue="lonelymoth" style={{
                borderTopLeftRadius: 0, borderBottomLeftRadius: 0, flex: 1,
              }}/>
            </div>
            <div style={{fontSize: 12, color: "var(--success)", marginTop: 6, display: "flex", alignItems: "center", gap: 4}}>
              <MinglaIcon name="check" size={12}/> mingla.com/lonelymoth is available
            </div>
          </div>
          <div>
            <label style={{fontSize: 13, color: "var(--text-secondary)", marginBottom: 6, display: "block"}}>Brand bio</label>
            <textarea className="input" style={{height: 80, padding: 14, resize: "none"}} defaultValue="A nightlife collective putting on slow-burn parties in unusual rooms across East London."/>
          </div>
        </div>
      ),
    },
    {
      title: "Connect Stripe",
      subtitle: "We use Stripe to settle ticket payments to your bank. Takes about 5 minutes.",
      content: (
        <div style={{display: "flex", flexDirection: "column", gap: 16}}>
          <div className="glass-card-elev" style={{padding: 20}}>
            <div style={{display: "flex", alignItems: "center", gap: 12, marginBottom: 12}}>
              <div style={{
                width: 40, height: 40, borderRadius: 12,
                background: "#635bff", display: "flex", alignItems: "center", justifyContent: "center",
                fontWeight: 700, color: "white",
              }}>S</div>
              <div>
                <div style={{fontWeight: 600, fontSize: 15}}>Stripe Connect</div>
                <div style={{fontSize: 12, color: "var(--text-secondary)"}}>Trusted by 4M+ businesses</div>
              </div>
            </div>
            <div style={{fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.5}}>
              We never see your card details. Stripe verifies your business, holds funds securely, and pays out on a schedule you control.
            </div>
          </div>
          <div className="glass-card" style={{padding: 14, display: "flex", gap: 12, alignItems: "flex-start"}}>
            <MinglaIcon name="check" size={18} color="var(--success)"/>
            <div style={{fontSize: 13, lineHeight: 1.5}}>You can finish setting this up later. Tickets stay free to publish.</div>
          </div>
        </div>
      ),
      cta: "Connect Stripe",
      ghost: "I'll do this later",
    },
    {
      title: "You're set",
      subtitle: "Let's build your first event. It takes about 4 minutes.",
      content: (
        <div style={{display: "flex", flexDirection: "column", gap: 12}}>
          {[
            { icon: "check", label: "Account created", color: "var(--success)" },
            { icon: "check", label: "Lonely Moth brand live", color: "var(--success)" },
            { icon: "check", label: "Stripe connected", color: "var(--success)" },
          ].map((item, i) => (
            <div key={i} className="glass-card" style={{
              padding: 14, display: "flex", alignItems: "center", gap: 12,
            }}>
              <div style={{
                width: 32, height: 32, borderRadius: 999,
                background: "var(--success-tint)", color: item.color,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}><MinglaIcon name={item.icon} size={16} color={item.color}/></div>
              <div style={{fontWeight: 500, fontSize: 14}}>{item.label}</div>
            </div>
          ))}
        </div>
      ),
      cta: "Build first event",
    },
  ];
  const cur = steps[step];
  return (
    <div style={{
      position: "absolute", inset: 0,
      display: "flex", flexDirection: "column",
    }}>
      <div className="phone-bg"/>
      <div style={{position: "relative", zIndex: 1}}>
        <StatusBar/>
      </div>
      <div style={{
        position: "relative", zIndex: 1,
        padding: "8px 24px 0", display: "flex", gap: 6, alignItems: "center",
      }}>
        <button onClick={onBack} style={{
          width: 36, height: 36, borderRadius: 999, border: 0,
          background: "rgba(255,255,255,0.06)", color: "white",
          display: "flex", alignItems: "center", justifyContent: "center",
          cursor: "pointer", marginRight: 4,
        }}>
          <MinglaIcon name="chevL" size={20}/>
        </button>
        <div style={{flex: 1, display: "flex", gap: 4}}>
          {steps.map((_, i) => (
            <div key={i} style={{
              flex: 1, height: 3, borderRadius: 999,
              background: i <= step ? "var(--accent)" : "rgba(255,255,255,0.12)",
              transition: "background 280ms var(--ease-out)",
            }}/>
          ))}
        </div>
        <span className="mono" style={{fontSize: 12, color: "var(--text-tertiary)"}}>{step + 1}/4</span>
      </div>

      <div className="fade-up" key={step} style={{
        position: "relative", zIndex: 1, flex: 1,
        padding: "32px 24px 12px", overflowY: "auto",
      }}>
        <h1 style={{fontSize: 26, fontWeight: 700, letterSpacing: -0.2, margin: "0 0 8px"}}>{cur.title}</h1>
        <p style={{fontSize: 15, color: "var(--text-secondary)", margin: "0 0 24px", lineHeight: 1.5}}>{cur.subtitle}</p>
        {cur.content}
      </div>

      <div style={{
        position: "relative", zIndex: 1,
        padding: "16px 24px 32px",
        display: "flex", flexDirection: "column", gap: 10,
      }}>
        <button className="btn btn-primary" onClick={onNext}>
          {cur.cta || (step === 3 ? "Get started" : "Continue")}
        </button>
        {cur.ghost && <button className="btn btn-ghost" onClick={onNext}>{cur.ghost}</button>}
      </div>
    </div>
  );
};

window.AuthScreen = AuthScreen;
window.OnboardingScreen = OnboardingScreen;
