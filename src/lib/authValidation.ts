import { stripControlChars } from './security';

export interface PasswordStrengthReport {
  score: 0 | 1 | 2 | 3 | 4;
  label: 'Weak' | 'Fair' | 'Good' | 'Strong';
  valid: boolean;
  checks: {
    minLength: boolean;
    hasUpper: boolean;
    hasLower: boolean;
    hasNumber: boolean;
    hasSpecial: boolean;
    notCommon: boolean;
  };
  error?: string;
}

const COMMON_WEAK_PASSWORDS = new Set([
  'password123!',
  'password123',
  'qwerty123456!',
  'admin123456!',
  'welcome123!',
  'nextrade123!',
  '1234567890!',
  'letmein123!',
]);

export function normalizeEmail(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return stripControlChars(raw, 180).toLowerCase();
}

export function validateEmailAddress(email: string): { valid: boolean; error?: string } {
  const normalized = normalizeEmail(email);
  if (!normalized || normalized.length > 180) {
    return { valid: false, error: 'Please enter a valid email address.' };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(normalized)) {
    return { valid: false, error: 'Please enter a valid email address (e.g. name@domain.com).' };
  }
  return { valid: true };
}

export function validateFullName(raw: unknown): {
  valid: boolean;
  cleaned: string;
  error?: string;
} {
  if (typeof raw !== 'string') {
    return { valid: false, cleaned: '', error: 'Please enter your full name.' };
  }
  const cleaned = stripControlChars(raw, 100).replace(/\s{2,}/g, ' ');
  if (cleaned.length < 2) {
    return { valid: false, cleaned, error: 'Full name must be at least 2 characters.' };
  }
  if (cleaned.length > 100) {
    return { valid: false, cleaned, error: 'Full name must be 100 characters or fewer.' };
  }
  return { valid: true, cleaned };
}

export function evaluatePasswordStrength(
  password: string,
  context?: { email?: string; fullName?: string },
): PasswordStrengthReport {
  if (typeof password !== 'string') {
    return {
      score: 0,
      label: 'Weak',
      valid: false,
      checks: {
        minLength: false,
        hasUpper: false,
        hasLower: false,
        hasNumber: false,
        hasSpecial: false,
        notCommon: true,
      },
      error: 'Password is required.',
    };
  }

  const minLength = password.length >= 10 && password.length <= 128;
  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasNumber = /\d/.test(password);
  const hasSpecial = /[^A-Za-z0-9]/.test(password);
  const lowerPw = password.toLowerCase();

  let containsIdentity = false;
  if (context?.email) {
    const localPart = normalizeEmail(context.email).split('@')[0] ?? '';
    if (localPart.length >= 4 && lowerPw.includes(localPart)) {
      containsIdentity = true;
    }
  }
  if (context?.fullName) {
    const tokens = context.fullName
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length >= 4);
    if (tokens.some((tok) => lowerPw.includes(tok))) {
      containsIdentity = true;
    }
  }

  const notCommon = !COMMON_WEAK_PASSWORDS.has(lowerPw) && !containsIdentity;

  const classCount = [hasUpper, hasLower, hasNumber, hasSpecial].filter(Boolean).length;
  const lengthPoints = password.length >= 14 ? 2 : password.length >= 10 ? 1 : 0;
  let rawScore = Math.min(4, Math.max(0, lengthPoints + Math.max(0, classCount - 2)));
  if (!notCommon || password.length < 10) rawScore = Math.min(rawScore, 1);

  const score = rawScore as 0 | 1 | 2 | 3 | 4;
  const label: PasswordStrengthReport['label'] =
    score >= 4 ? 'Strong' : score === 3 ? 'Good' : score === 2 ? 'Fair' : 'Weak';

  let error: string | undefined;
  if (password.length < 10) {
    error = 'Password must be at least 10 characters long.';
  } else if (password.length > 128) {
    error = 'Password must be 128 characters or fewer.';
  } else if (!hasUpper || !hasLower || !hasNumber || !hasSpecial) {
    error = 'Password must include uppercase, lowercase, a number, and a special character.';
  } else if (!notCommon) {
    error = containsIdentity
      ? 'Password cannot include your name or email address.'
      : 'This password is too common. Choose a stronger passphrase.';
  }

  return {
    score,
    label,
    valid: !error,
    checks: {
      minLength,
      hasUpper,
      hasLower,
      hasNumber,
      hasSpecial,
      notCommon,
    },
    error,
  };
}
