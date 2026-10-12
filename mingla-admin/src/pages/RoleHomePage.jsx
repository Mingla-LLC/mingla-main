import { LogOut } from "lucide-react";
import { useState } from "react";
import { SectionCard } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { useAuth } from "../context/AuthContext";
import { ROLE_HOME_TITLES, ROLE_LABELS } from "../lib/access";

/**
 * Issue #3802 — the home page of the Sales and marketing and Founding partner
 * roles (#/home). A placeholder until their workspaces launch: it reads nothing
 * from the database, and it always offers a next step.
 */
export function RoleHomePage() {
  const { access, signOut } = useAuth();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState("");

  const title = (access && ROLE_HOME_TITLES[access.role]) || "Home";
  const roleLabel = access ? ROLE_LABELS[access.role] : "";

  const handleSignOut = async () => {
    setSigningOut(true);
    setSignOutError("");
    try {
      await signOut();
    } catch (err) {
      console.error("Sign out failed:", err?.message || err);
      setSignOutError("Couldn't sign you out. Check your connection and try again.");
      setSigningOut(false);
    }
  };

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">{title}</h1>
      </div>

      <SectionCard title="You're in">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-[var(--color-text-secondary)]">
            Your workspace is being set up. Hosts, Creators and the Content calendar will appear
            here as they launch. There is nothing you need to do yet.
          </p>
          {access && (
            <p className="text-sm text-[var(--color-text-tertiary)]">
              {`Signed in as ${access.email} · ${roleLabel}`}
            </p>
          )}
          <div className="flex flex-col items-start gap-2">
            <Button variant="secondary" icon={LogOut} loading={signingOut} onClick={handleSignOut}>
              Sign out
            </Button>
            {signOutError && (
              <p className="text-xs text-[#ef4444]" role="alert">{signOutError}</p>
            )}
            <p className="text-xs text-[var(--color-text-tertiary)]">
              Need something sooner? Ask the person who invited you.
            </p>
          </div>
        </div>
      </SectionCard>
    </div>
  );
}
