// Cryptographic helpers for Admin Dashboard PIN Lock (PBKDF2-SHA256 via Web Crypto),
// persistent PIN lockout protection, RBAC helpers, and Parent Barcode Stage Lock persistence.

import { StaffRole } from '../types/wisaal';

const PBKDF2_ITERATIONS = 100000;
const LOCKED_STAGE_STORAGE_KEY = 'wisaal_locked_stage_token';
const PIN_LOCKOUT_PREFIX = 'wisaal_pin_lock_v1_';

export const PIN_MAX_ATTEMPTS = 5;
const LOCKOUT_DURATIONS_SEC = [30, 60, 180];

export interface PinLockoutState {
  failedAttempts: number;
  lockoutCount: number;
  lockedUntilMs: number;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim().toLowerCase();
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function normalizePinInput(raw: string): string {
  return raw
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .trim();
}

export function isValidAdminPinFormat(pin: string): boolean {
  const normalized = normalizePinInput(pin);
  return normalized.length >= 4 && normalized.length <= 16;
}

export async function hashAdminPin(
  pin: string,
  existingSaltHex?: string
): Promise<{ hash: string; salt: string }> {
  const normalized = normalizePinInput(pin);
  const saltBytes = existingSaltHex
    ? hexToBytes(existingSaltHex)
    : crypto.getRandomValues(new Uint8Array(16));
  const saltHex = bytesToHex(saltBytes);

  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(normalized),
    'PBKDF2',
    false,
    ['deriveBits']
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltBytes.buffer as ArrayBuffer,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    256
  );

  return {
    hash: bytesToHex(new Uint8Array(derivedBits)),
    salt: saltHex,
  };
}

export async function verifyAdminPin(
  pin: string,
  storedHash: string,
  storedSalt: string
): Promise<boolean> {
  if (!/^[a-f0-9]{64}$/.test(storedHash) || !/^[a-f0-9]{32}$/.test(storedSalt)) {
    return false;
  }
  const { hash } = await hashAdminPin(pin, storedSalt);
  if (hash.length !== storedHash.length) return false;
  let diff = 0;
  for (let i = 0; i < hash.length; i++) {
    diff |= hash.charCodeAt(i) ^ storedHash.charCodeAt(i);
  }
  return diff === 0;
}

// --- Persistent PIN Lockout Protection (survives page refresh) ---
export function readPinLockoutState(schoolId: string): PinLockoutState {
  const empty: PinLockoutState = { failedAttempts: 0, lockoutCount: 0, lockedUntilMs: 0 };
  if (!schoolId) return empty;
  try {
    const raw = window.localStorage.getItem(`${PIN_LOCKOUT_PREFIX}${schoolId}`);
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as Partial<PinLockoutState>;
    return {
      failedAttempts: typeof parsed.failedAttempts === 'number' ? Math.max(0, parsed.failedAttempts) : 0,
      lockoutCount: typeof parsed.lockoutCount === 'number' ? Math.max(0, parsed.lockoutCount) : 0,
      lockedUntilMs: typeof parsed.lockedUntilMs === 'number' ? Math.max(0, parsed.lockedUntilMs) : 0,
    };
  } catch {
    return empty;
  }
}

export function recordPinFailure(schoolId: string): {
  state: PinLockoutState;
  justLockedSeconds: number;
} {
  const current = readPinLockoutState(schoolId);
  const nextAttempts = current.failedAttempts + 1;
  let justLockedSeconds = 0;
  let nextState: PinLockoutState;

  if (nextAttempts >= PIN_MAX_ATTEMPTS) {
    const tierIdx = Math.min(current.lockoutCount, LOCKOUT_DURATIONS_SEC.length - 1);
    justLockedSeconds = LOCKOUT_DURATIONS_SEC[tierIdx];
    nextState = {
      failedAttempts: 0,
      lockoutCount: current.lockoutCount + 1,
      lockedUntilMs: Date.now() + justLockedSeconds * 1000,
    };
  } else {
    nextState = {
      ...current,
      failedAttempts: nextAttempts,
    };
  }

  try {
    window.localStorage.setItem(`${PIN_LOCKOUT_PREFIX}${schoolId}`, JSON.stringify(nextState));
  } catch {
    // Ignore storage restrictions
  }

  return { state: nextState, justLockedSeconds };
}

export function clearPinLockout(schoolId: string): void {
  if (!schoolId) return;
  try {
    window.localStorage.removeItem(`${PIN_LOCKOUT_PREFIX}${schoolId}`);
  } catch {
    // Ignore
  }
}

// --- Role-Based Access Helpers ---
export function canManageDestructiveRecords(
  isSchoolOwner: boolean,
  staffRole?: StaffRole | null
): boolean {
  return isSchoolOwner || staffRole === 'vice_principal';
}

export function normalizeStaffEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isValidStaffEmail(email: string): boolean {
  const clean = normalizeStaffEmail(email);
  return (
    clean.length >= 5 &&
    clean.length <= 120 &&
    /^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$/.test(clean)
  );
}

// --- Parent Barcode Stage Lock Helpers ---
export function saveLockedStageToken(stageToken: string): void {
  if (!/^[a-zA-Z0-9_\-]{16,64}$/.test(stageToken)) return;
  try {
    window.localStorage.setItem(LOCKED_STAGE_STORAGE_KEY, stageToken);
  } catch {
    // Ignore storage restrictions
  }
}

export function readLockedStageToken(): string | null {
  try {
    const val = window.localStorage.getItem(LOCKED_STAGE_STORAGE_KEY);
    if (val && /^[a-zA-Z0-9_\-]{16,64}$/.test(val)) {
      return val;
    }
    return null;
  } catch {
    return null;
  }
}

export function clearLockedStageToken(): void {
  try {
    window.localStorage.removeItem(LOCKED_STAGE_STORAGE_KEY);
  } catch {
    // Ignore storage restrictions
  }
}
