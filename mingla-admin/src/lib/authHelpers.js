/**
 * Password strength rules for admin dashboard login.
 * All rules must pass for the password to be accepted.
 */
const PASSWORD_RULES = [
  { test: (p) => p.length >= 12, message: "At least 12 characters" },
  { test: (p) => /[A-Z]/.test(p), message: "At least 1 uppercase letter" },
  { test: (p) => /[a-z]/.test(p), message: "At least 1 lowercase letter" },
  { test: (p) => /[0-9]/.test(p), message: "At least 1 number" },
  { test: (p) => /[^A-Za-z0-9]/.test(p), message: "At least 1 special character (!@#$%...)" },
];

/**
 * Validate password against all strength rules.
 * Returns { valid: boolean, failures: string[] }
 */
export function validatePassword(password) {
  const failures = PASSWORD_RULES
    .filter((rule) => !rule.test(password))
    .map((rule) => rule.message);
  return { valid: failures.length === 0, failures };
}

/**
 * Brute-force lockout.
 * After MAX_ATTEMPTS failed tries, lock for LOCKOUT_MS.
 * Uses localStorage so it persists across page refreshes.
 */
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 5 * 60 * 1000; // 5 minutes
const STORAGE_KEY = "mingla_admin_auth_lockout";

function getLockoutState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { attempts: 0, lockedUntil: null };
    return JSON.parse(raw);
  } catch {
    return { attempts: 0, lockedUntil: null };
  }
}

function setLockoutState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function checkLockout() {
  const state = getLockoutState();
  if (state.lockedUntil && Date.now() < state.lockedUntil) {
    const remainingMs = state.lockedUntil - Date.now();
    const remainingMin = Math.ceil(remainingMs / 60000);
    return { locked: true, message: `Too many failed attempts. Try again in ${remainingMin} minute${remainingMin === 1 ? "" : "s"}.` };
  }
  // If lockout expired, reset
  if (state.lockedUntil && Date.now() >= state.lockedUntil) {
    setLockoutState({ attempts: 0, lockedUntil: null });
  }
  return { locked: false, message: null };
}

export function recordFailedAttempt() {
  const state = getLockoutState();
  const newAttempts = state.attempts + 1;
  if (newAttempts >= MAX_ATTEMPTS) {
    setLockoutState({ attempts: newAttempts, lockedUntil: Date.now() + LOCKOUT_MS });
  } else {
    setLockoutState({ attempts: newAttempts, lockedUntil: null });
  }
}

export function resetLockout() {
  localStorage.removeItem(STORAGE_KEY);
}
