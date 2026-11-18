import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  MailCheck,
  ShieldCheck,
} from 'lucide-react';
import {
  evaluatePasswordStrength,
  normalizeEmail,
  validateEmailAddress,
  validateFullName,
} from '../../lib/authValidation';
import { PublicAuthUser, PublicSessionInfo, useAuth } from '../../lib/authContext';
import { sanitizeInternalPath } from '../../lib/security';
import { AuthLayout } from './AuthLayout';

interface AuthPageProps {
  onNavigate: (path: string) => void;
  searchParamsString?: string;
}

function getSafeRedirectParam(searchParamsString?: string): string {
  const rawSearch =
    searchParamsString ?? (typeof window !== 'undefined' ? window.location.search : '');
  const params = new URLSearchParams(rawSearch);
  const candidate = params.get('redirect');
  if (!candidate) return '/app';
  const cleaned = sanitizeInternalPath(candidate);
  if (
    cleaned === '/login' ||
    cleaned === '/signup' ||
    cleaned === '/forgot-password' ||
    cleaned === '/reset-password' ||
    cleaned === '/verify-email'
  ) {
    return '/app';
  }
  return cleaned || '/app';
}

function getTokenParam(searchParamsString?: string): string {
  const rawSearch =
    searchParamsString ?? (typeof window !== 'undefined' ? window.location.search : '');
  const params = new URLSearchParams(rawSearch);
  return (params.get('token') ?? '').trim();
}

const PasswordStrengthMeter: React.FC<{
  password: string;
  email?: string;
  fullName?: string;
}> = ({ password, email, fullName }) => {
  const report = useMemo(
    () => evaluatePasswordStrength(password, { email, fullName }),
    [password, email, fullName],
  );

  const barColors = [
    'bg-[#DC2626]',
    'bg-[#EA580C]',
    'bg-[#D97706]',
    'bg-[#2D46E6]',
    'bg-[#16A34A]',
  ];
  const labelColor =
    report.score >= 4
      ? 'text-[#16A34A]'
      : report.score === 3
        ? 'text-[#2D46E6]'
        : report.score === 2
          ? 'text-[#D97706]'
          : 'text-[#DC2626]';

  const activeSegments = password.length === 0 ? 0 : Math.max(1, report.score);

  const rules = [
    { ok: report.checks.minLength, text: 'At least 10 characters' },
    { ok: report.checks.hasUpper, text: 'Uppercase letter (A–Z)' },
    { ok: report.checks.hasLower, text: 'Lowercase letter (a–z)' },
    { ok: report.checks.hasNumber, text: 'Number (0–9)' },
    { ok: report.checks.hasSpecial, text: 'Special symbol (!@#$...)' },
    { ok: report.checks.notCommon, text: 'Not common or containing name/email' },
  ];

  return (
    <div className="space-y-2.5 pt-1" aria-live="polite">
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-[#667085] font-medium">Password strength</span>
        <span className={`font-mono font-semibold ${password ? labelColor : 'text-[#94A3B8]'}`}>
          {password ? report.label : 'Enter password'}
        </span>
      </div>
      <div className="grid grid-cols-4 gap-1.5" role="progressbar" aria-valuenow={activeSegments} aria-valuemin={0} aria-valuemax={4}>
        {[0, 1, 2, 3].map((idx) => (
          <div
            key={idx}
            className={`h-1.5 rounded-sm transition-colors ${
              idx < activeSegments ? barColors[report.score] : 'bg-[#E4E8F2]'
            }`}
          />
        ))}
      </div>
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1 text-[11px] text-[#667085]">
        {rules.map((r) => (
          <li key={r.text} className="flex items-center gap-1.5">
            <span
              className={`h-1.5 w-1.5 rounded-sm shrink-0 ${
                password.length > 0 && r.ok ? 'bg-[#16A34A]' : 'bg-[#CBD5E1]'
              }`}
              aria-hidden="true"
            />
            <span className={password.length > 0 && r.ok ? 'text-[#080B12]' : ''}>{r.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
};

export const LoginPage: React.FC<AuthPageProps> = ({ onNavigate, searchParamsString }) => {
  const { status, setAuthenticatedState, config } = useAuth();
  const redirectTarget = getSafeRedirectParam(searchParamsString);
  const navigatedRef = useRef(false);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [resendState, setResendState] = useState<{
    loading: boolean;
    message?: string;
    error?: string;
  }>({ loading: false });

  useEffect(() => {
    if (status === 'authenticated' && !navigatedRef.current) {
      navigatedRef.current = true;
      onNavigate(redirectTarget);
    }
  }, [status, onNavigate, redirectTarget]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setErrorCode(null);

    const normalized = normalizeEmail(email);
    const emailCheck = validateEmailAddress(normalized);
    if (!emailCheck.valid || !password) {
      setErrorMsg('Please enter a valid email address and your password.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: normalized,
          password,
          rememberMe,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        code?: string;
        user?: PublicAuthUser;
        session?: PublicSessionInfo;
      };

      if (!res.ok || !data.ok || !data.user) {
        setErrorMsg(data.error ?? 'Sign in failed. Please check your credentials.');
        setErrorCode(data.code ?? null);
        return;
      }

      // Confirm the browser stored and sends the HttpOnly session cookie before navigating
      const verifyCookieRes = await fetch('/api/auth/me', {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
      });
      if (!verifyCookieRes.ok) {
        setErrorCode('COOKIES_BLOCKED');
        setErrorMsg(
          'Your credentials are valid, but your browser blocked the session cookie in this embedded frame. Allow third-party/partitioned cookies or open Nextrade AI in a full browser tab to continue.',
        );
        return;
      }

      navigatedRef.current = true;
      setAuthenticatedState(data.user, data.session ?? null);
      onNavigate(redirectTarget);
    } catch {
      setErrorMsg('Network error while reaching the authentication server. Please retry.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleResendVerification = async () => {
    setResendState({ loading: true });
    try {
      const res = await fetch('/api/auth/resend-verification', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: normalizeEmail(email) }),
      });
      const data = (await res.json()) as { ok?: boolean; message?: string; error?: string };
      if (!res.ok) {
        setResendState({
          loading: false,
          error: data.error ?? 'Unable to process verification email request.',
        });
        return;
      }
      setResendState({
        loading: false,
        message: data.message ?? 'Verification instructions processed.',
      });
    } catch {
      setResendState({ loading: false, error: 'Network error while requesting verification.' });
    }
  };

  return (
    <AuthLayout
      onNavigate={onNavigate}
      eyebrow="Account Access"
      title="Sign in to your Nextrade AI workspace."
      subtitle="Authenticate with your verified account to open Indian and US equity exploration, AI research, portfolio metrics, and paper trading."
    >
      <form onSubmit={handleSubmit} noValidate className="space-y-5">
        <div className="border-b border-[#E4E8F2] pb-4 flex items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-xl font-bold text-[#080B12]">Sign In</h2>
            <p className="text-xs text-[#667085] mt-0.5">
              Protected by HttpOnly session cookies and rate limiting.
            </p>
          </div>
          <span className="rounded-md border border-[#E4E8F2] bg-[#F7F8FA] px-2.5 py-1 font-mono text-[11px] font-medium text-[#080B12]">
            Phase 1 Auth
          </span>
        </div>

        {errorMsg && (
          <div
            role="alert"
            className="rounded-lg border border-[#FECACA] bg-[#FEF2F2] p-3.5 text-xs text-[#B91C1C] space-y-2.5"
          >
            <div className="flex items-start gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
              <span className="font-medium leading-relaxed">{errorMsg}</span>
            </div>

            {errorCode === 'COOKIES_BLOCKED' && (
              <div className="pl-6">
                <a
                  href={`/login?redirect=${encodeURIComponent(redirectTarget)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#FCA5A5] bg-[#FFFFFF] px-3 text-[11px] font-semibold text-[#991B1B] hover:bg-[#FEF2F2]"
                >
                  Open Sign In in New Tab →
                </a>
              </div>
            )}

            {errorCode === 'EMAIL_NOT_VERIFIED' && (
              <div className="pl-6 space-y-2">
                {!config.emailDeliveryConfigured && (
                  <p className="text-[11px] text-[#7F1D1D]">
                    Note: Transactional email delivery is not configured in this environment. Set your{' '}
                    <code className="font-mono">EMAILJS_SERVICE_ID</code>,{' '}
                    <code className="font-mono">EMAILJS_TEMPLATE_ID</code>, and{' '}
                    <code className="font-mono">EMAILJS_PUBLIC_KEY</code> (or Resend keys) in{' '}
                    <code className="font-mono">.env</code>, or verify with an issued token at{' '}
                    <a
                      href="/verify-email"
                      onClick={(e) => {
                        e.preventDefault();
                        onNavigate('/verify-email');
                      }}
                      className="underline font-semibold"
                    >
                      /verify-email
                    </a>
                    .
                  </p>
                )}
                <button
                  type="button"
                  disabled={resendState.loading}
                  onClick={handleResendVerification}
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[#FCA5A5] bg-[#FFFFFF] px-3 text-[11px] font-semibold text-[#991B1B] hover:bg-[#FEF2F2] cursor-pointer"
                >
                  {resendState.loading ? 'Sending...' : 'Resend verification email'}
                </button>
              </div>
            )}
          </div>
        )}

        {resendState.message && (
          <div
            role="status"
            className="rounded-lg border border-[#BBF7D0] bg-[#F0FDF4] p-3 text-xs text-[#15803D]"
          >
            {resendState.message}
          </div>
        )}
        {resendState.error && (
          <div
            role="alert"
            className="rounded-lg border border-[#FECACA] bg-[#FEF2F2] p-3 text-xs text-[#B91C1C]"
          >
            {resendState.error}
          </div>
        )}

        <div className="space-y-1.5">
          <label htmlFor="login-email" className="block text-xs font-semibold text-[#080B12]">
            Email Address
          </label>
          <input
            id="login-email"
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="analyst@example.com"
            className="h-11 w-full rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] px-3.5 text-sm text-[#080B12] placeholder:text-[#98A2B3] focus:border-[#2D46E6] focus:outline-none"
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label htmlFor="login-password" className="block text-xs font-semibold text-[#080B12]">
              Password
            </label>
            <a
              href="/forgot-password"
              onClick={(e) => {
                e.preventDefault();
                onNavigate('/forgot-password');
              }}
              className="text-xs font-medium text-[#2D46E6] hover:underline"
            >
              Forgot password?
            </a>
          </div>
          <div className="relative">
            <input
              id="login-password"
              name="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              className="h-11 w-full rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] pl-3.5 pr-11 text-sm text-[#080B12] placeholder:text-[#98A2B3] focus:border-[#2D46E6] focus:outline-none"
            />
            <button
              type="button"
              onClick={() => setShowPassword((prev) => !prev)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex h-8 w-8 items-center justify-center rounded-md text-[#667085] hover:text-[#080B12] hover:bg-[#F7F8FA] cursor-pointer"
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <label className="flex items-center gap-2.5 text-xs text-[#667085] cursor-pointer select-none">
          <input
            type="checkbox"
            checked={rememberMe}
            onChange={(e) => setRememberMe(e.target.checked)}
            className="h-4 w-4 rounded border-[#CBD5E1] text-[#2D46E6] focus:ring-[#2D46E6]"
          />
          <span>Keep me signed in on this browser for 14 days</span>
        </label>

        <button
          type="submit"
          disabled={submitting}
          className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-[#2D46E6] px-5 text-xs font-semibold uppercase tracking-[0.04em] text-[#FFFFFF] shadow-[0_8px_20px_rgba(45,70,230,0.22)] hover:bg-[#2238C9] disabled:opacity-60 transition-colors cursor-pointer"
        >
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              <span>Signing In...</span>
            </>
          ) : (
            <span>Sign In to Workspace</span>
          )}
        </button>

        <div className="border-t border-[#E4E8F2] pt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-[#667085]">
          <span>New to Nextrade AI?</span>
          <a
            href="/signup"
            onClick={(e) => {
              e.preventDefault();
              onNavigate('/signup');
            }}
            className="font-semibold text-[#2D46E6] hover:underline"
          >
            Create an account →
          </a>
        </div>
      </form>
    </AuthLayout>
  );
};

export const SignupPage: React.FC<AuthPageProps> = ({ onNavigate }) => {
  const { status } = useAuth();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [acceptPrivacy, setAcceptPrivacy] = useState(false);

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [createdResult, setCreatedResult] = useState<{
    email: string;
    message: string;
    emailDeliveryConfigured: boolean;
    emailDelivered: boolean;
  } | null>(null);

  useEffect(() => {
    if (status === 'authenticated') {
      onNavigate('/app');
    }
  }, [status, onNavigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setFieldErrors({});

    const localErrors: Record<string, string> = {};
    const nameCheck = validateFullName(fullName);
    if (!nameCheck.valid) localErrors.fullName = nameCheck.error!;

    const normalizedEmail = normalizeEmail(email);
    const emailCheck = validateEmailAddress(normalizedEmail);
    if (!emailCheck.valid) localErrors.email = emailCheck.error!;

    const pwCheck = evaluatePasswordStrength(password, {
      email: normalizedEmail,
      fullName: nameCheck.cleaned,
    });
    if (!pwCheck.valid) localErrors.password = pwCheck.error!;

    if (password !== confirmPassword) {
      localErrors.confirmPassword = 'Password confirmation does not match.';
    }
    if (!acceptTerms) {
      localErrors.acceptTerms = 'Please accept the Terms of Service.';
    }
    if (!acceptPrivacy) {
      localErrors.acceptPrivacy = 'Please accept the Privacy Policy.';
    }

    if (Object.keys(localErrors).length > 0) {
      setFieldErrors(localErrors);
      setErrorMsg(Object.values(localErrors)[0]);
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: nameCheck.cleaned,
          email: normalizedEmail,
          password,
          confirmPassword,
          acceptTerms,
          acceptPrivacy,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        fieldErrors?: Record<string, string>;
        message?: string;
        emailDeliveryConfigured?: boolean;
        emailDelivered?: boolean;
        user?: PublicAuthUser;
      };

      if (!res.ok || !data.ok) {
        if (data.fieldErrors) setFieldErrors(data.fieldErrors);
        setErrorMsg(data.error ?? 'Could not complete account registration.');
        return;
      }

      setCreatedResult({
        email: data.user?.email ?? normalizedEmail,
        message:
          data.message ??
          'Account created. Verify your email address before signing in.',
        emailDeliveryConfigured: Boolean(data.emailDeliveryConfigured),
        emailDelivered: Boolean(data.emailDelivered),
      });
    } catch {
      setErrorMsg('Network error while creating your account. Please retry.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout
      onNavigate={onNavigate}
      eyebrow="Account Registration"
      title="Create your Nextrade AI account."
      subtitle="Verify your email address once to unlock protected access to the multi-market research and simulation workspace."
    >
      {createdResult ? (
        <div className="space-y-5 py-2" role="status" aria-live="polite">
          <div className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-[#D5DDF7] bg-[#EFF2FA] text-[#2D46E6]">
            <MailCheck className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="space-y-2">
            <h2 className="font-display text-2xl font-bold text-[#080B12]">
              Verify your email to activate sign-in
            </h2>
            <p className="text-sm text-[#667085] leading-relaxed">{createdResult.message}</p>
          </div>

          <div className="rounded-xl border border-[#E4E8F2] bg-[#F7F8FA] p-4 space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-[#667085]">Registered email</span>
              <span className="font-mono font-semibold text-[#080B12]">{createdResult.email}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[#667085]">Verification status</span>
              <span className="font-mono font-semibold text-[#D97706]">Pending Verification</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[#667085]">Email delivery provider</span>
              <span className="font-mono font-semibold text-[#080B12]">
                {createdResult.emailDeliveryConfigured
                  ? createdResult.emailDelivered
                    ? 'Dispatched'
                    : 'Dispatch Retry Available'
                  : 'Not Configured'}
              </span>
            </div>
          </div>

          {!createdResult.emailDeliveryConfigured && (
            <div className="rounded-lg border border-[#FDE68A] bg-[#FFFBEB] p-3.5 text-xs text-[#92400E] leading-relaxed">
              Transactional email delivery is currently unconfigured on the server (set{' '}
              <code className="font-mono font-semibold">EMAILJS_SERVICE_ID</code>,{' '}
              <code className="font-mono font-semibold">EMAILJS_TEMPLATE_ID</code>, and{' '}
              <code className="font-mono font-semibold">EMAILJS_PUBLIC_KEY</code> in{' '}
              <code className="font-mono">.env</code>). If you already have a verification token, complete activation on the{' '}
              <a
                href="/verify-email"
                onClick={(e) => {
                  e.preventDefault();
                  onNavigate('/verify-email');
                }}
                className="font-semibold underline"
              >
                email verification page
              </a>
              .
            </div>
          )}

          <div className="flex flex-wrap gap-3 pt-1">
            <button
              type="button"
              onClick={() => onNavigate('/login')}
              className="inline-flex h-10 items-center justify-center rounded-md bg-[#2D46E6] px-5 text-xs font-semibold uppercase tracking-[0.04em] text-[#FFFFFF] hover:bg-[#2238C9] cursor-pointer"
            >
              Proceed to Sign In
            </button>
            <button
              type="button"
              onClick={() => onNavigate('/verify-email')}
              className="inline-flex h-10 items-center justify-center rounded-md border border-[#E4E8F2] bg-[#FFFFFF] px-4 text-xs font-semibold text-[#080B12] hover:border-[#2D46E6] hover:text-[#2D46E6] cursor-pointer"
            >
              Open Verification Page
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <div className="border-b border-[#E4E8F2] pb-4">
            <h2 className="font-display text-xl font-bold text-[#080B12]">Create Account</h2>
            <p className="text-xs text-[#667085] mt-0.5">
              All fields are validated both in your browser and on the server.
            </p>
          </div>

          {errorMsg && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-[#FECACA] bg-[#FEF2F2] p-3 text-xs font-medium text-[#B91C1C]"
            >
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
              <span>{errorMsg}</span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label htmlFor="signup-name" className="block text-xs font-semibold text-[#080B12]">
                Full Name
              </label>
              <input
                id="signup-name"
                name="fullName"
                type="text"
                autoComplete="name"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Aarav Mehta"
                className="h-10 w-full rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] px-3.5 text-sm text-[#080B12] placeholder:text-[#98A2B3] focus:border-[#2D46E6] focus:outline-none"
              />
              {fieldErrors.fullName && (
                <p className="text-[11px] text-[#DC2626]">{fieldErrors.fullName}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <label htmlFor="signup-email" className="block text-xs font-semibold text-[#080B12]">
                Email Address
              </label>
              <input
                id="signup-email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="aarav@example.com"
                className="h-10 w-full rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] px-3.5 text-sm text-[#080B12] placeholder:text-[#98A2B3] focus:border-[#2D46E6] focus:outline-none"
              />
              {fieldErrors.email && (
                <p className="text-[11px] text-[#DC2626]">{fieldErrors.email}</p>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="signup-password" className="block text-xs font-semibold text-[#080B12]">
              Password
            </label>
            <div className="relative">
              <input
                id="signup-password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Minimum 10 characters"
                className="h-10 w-full rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] pl-3.5 pr-11 text-sm text-[#080B12] placeholder:text-[#98A2B3] focus:border-[#2D46E6] focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex h-8 w-8 items-center justify-center rounded-md text-[#667085] hover:text-[#080B12] hover:bg-[#F7F8FA] cursor-pointer"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {fieldErrors.password && (
              <p className="text-[11px] text-[#DC2626]">{fieldErrors.password}</p>
            )}
            <PasswordStrengthMeter password={password} email={email} fullName={fullName} />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="signup-confirm" className="block text-xs font-semibold text-[#080B12]">
              Confirm Password
            </label>
            <div className="relative">
              <input
                id="signup-confirm"
                name="confirmPassword"
                type={showConfirm ? 'text' : 'password'}
                autoComplete="new-password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter your password"
                className="h-10 w-full rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] pl-3.5 pr-11 text-sm text-[#080B12] placeholder:text-[#98A2B3] focus:border-[#2D46E6] focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setShowConfirm((prev) => !prev)}
                aria-label={showConfirm ? 'Hide confirmation password' : 'Show confirmation password'}
                className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex h-8 w-8 items-center justify-center rounded-md text-[#667085] hover:text-[#080B12] hover:bg-[#F7F8FA] cursor-pointer"
              >
                {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {fieldErrors.confirmPassword && (
              <p className="text-[11px] text-[#DC2626]">{fieldErrors.confirmPassword}</p>
            )}
          </div>

          <div className="space-y-2 rounded-lg border border-[#E4E8F2] bg-[#F7F8FA] p-3.5">
            <label className="flex items-start gap-2.5 text-xs text-[#667085] cursor-pointer">
              <input
                type="checkbox"
                checked={acceptTerms}
                onChange={(e) => setAcceptTerms(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-[#CBD5E1] text-[#2D46E6] focus:ring-[#2D46E6]"
              />
              <span>
                I accept the{' '}
                <a
                  href="/terms"
                  onClick={(e) => {
                    e.preventDefault();
                    onNavigate('/terms');
                  }}
                  className="font-semibold text-[#2D46E6] hover:underline"
                >
                  Terms of Service
                </a>
                .
              </span>
            </label>
            {fieldErrors.acceptTerms && (
              <p className="text-[11px] text-[#DC2626] pl-6">{fieldErrors.acceptTerms}</p>
            )}

            <label className="flex items-start gap-2.5 text-xs text-[#667085] cursor-pointer">
              <input
                type="checkbox"
                checked={acceptPrivacy}
                onChange={(e) => setAcceptPrivacy(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-[#CBD5E1] text-[#2D46E6] focus:ring-[#2D46E6]"
              />
              <span>
                I acknowledge the{' '}
                <a
                  href="/privacy"
                  onClick={(e) => {
                    e.preventDefault();
                    onNavigate('/privacy');
                  }}
                  className="font-semibold text-[#2D46E6] hover:underline"
                >
                  Privacy Policy
                </a>
                .
              </span>
            </label>
            {fieldErrors.acceptPrivacy && (
              <p className="text-[11px] text-[#DC2626] pl-6">{fieldErrors.acceptPrivacy}</p>
            )}
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-[#2D46E6] px-5 text-xs font-semibold uppercase tracking-[0.04em] text-[#FFFFFF] shadow-[0_8px_20px_rgba(45,70,230,0.22)] hover:bg-[#2238C9] disabled:opacity-60 transition-colors cursor-pointer"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                <span>Creating Account...</span>
              </>
            ) : (
              <span>Create Verified Account</span>
            )}
          </button>

          <div className="border-t border-[#E4E8F2] pt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-[#667085]">
            <span>Already have an account?</span>
            <a
              href="/login"
              onClick={(e) => {
                e.preventDefault();
                onNavigate('/login');
              }}
              className="font-semibold text-[#2D46E6] hover:underline"
            >
              Sign in instead →
            </a>
          </div>
        </form>
      )}
    </AuthLayout>
  );
};

export const ForgotPasswordPage: React.FC<AuthPageProps> = ({ onNavigate }) => {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [doneMsg, setDoneMsg] = useState<string | null>(null);
  const [emailConfigured, setEmailConfigured] = useState<boolean>(true);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    const normalized = normalizeEmail(email);
    const check = validateEmailAddress(normalized);
    if (!check.valid) {
      setErrorMsg(check.error!);
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: normalized }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        message?: string;
        error?: string;
        emailDeliveryConfigured?: boolean;
      };
      if (!res.ok || !data.ok) {
        setErrorMsg(data.error ?? 'Unable to submit password reset request.');
        return;
      }
      setEmailConfigured(Boolean(data.emailDeliveryConfigured));
      setDoneMsg(
        data.message ??
          'If an account matches that email address, password reset instructions have been processed.',
      );
    } catch {
      setErrorMsg('Network error while requesting password reset.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout
      onNavigate={onNavigate}
      eyebrow="Account Recovery"
      title="Reset your account password."
      subtitle="Enter your account email to receive a single-use 30-minute recovery link. All active sessions are automatically revoked upon reset."
    >
      {doneMsg ? (
        <div className="space-y-5 py-2" role="status" aria-live="polite">
          <div className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-[#BBF7D0] bg-[#F0FDF4] text-[#16A34A]">
            <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="space-y-2">
            <h2 className="font-display text-2xl font-bold text-[#080B12]">Recovery Request Received</h2>
            <p className="text-sm text-[#667085] leading-relaxed">{doneMsg}</p>
          </div>
          {!emailConfigured && (
            <div className="rounded-lg border border-[#FDE68A] bg-[#FFFBEB] p-3.5 text-xs text-[#92400E] leading-relaxed">
              Transactional email delivery is unconfigured in this environment. Set{' '}
              <code className="font-mono font-semibold">EMAILJS_SERVICE_ID</code>,{' '}
              <code className="font-mono font-semibold">EMAILJS_TEMPLATE_ID</code>, and{' '}
              <code className="font-mono font-semibold">EMAILJS_PUBLIC_KEY</code> in{' '}
              <code className="font-mono">.env</code> to send recovery links automatically.
            </div>
          )}
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => onNavigate('/login')}
              className="inline-flex h-10 items-center justify-center rounded-md bg-[#2D46E6] px-5 text-xs font-semibold uppercase tracking-[0.04em] text-[#FFFFFF] hover:bg-[#2238C9] cursor-pointer"
            >
              Return to Sign In
            </button>
            <button
              type="button"
              onClick={() => setDoneMsg(null)}
              className="inline-flex h-10 items-center justify-center rounded-md border border-[#E4E8F2] bg-[#FFFFFF] px-4 text-xs font-semibold text-[#080B12] hover:border-[#2D46E6] cursor-pointer"
            >
              Try Another Email
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} noValidate className="space-y-5">
          <div className="border-b border-[#E4E8F2] pb-4">
            <h2 className="font-display text-xl font-bold text-[#080B12]">Forgot Password</h2>
            <p className="text-xs text-[#667085] mt-0.5">
              Responses never disclose whether an email address is registered.
            </p>
          </div>

          {errorMsg && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-[#FECACA] bg-[#FEF2F2] p-3 text-xs font-medium text-[#B91C1C]"
            >
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
              <span>{errorMsg}</span>
            </div>
          )}

          <div className="space-y-1.5">
            <label htmlFor="forgot-email" className="block text-xs font-semibold text-[#080B12]">
              Account Email Address
            </label>
            <input
              id="forgot-email"
              name="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="analyst@example.com"
              className="h-11 w-full rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] px-3.5 text-sm text-[#080B12] placeholder:text-[#98A2B3] focus:border-[#2D46E6] focus:outline-none"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-[#2D46E6] px-5 text-xs font-semibold uppercase tracking-[0.04em] text-[#FFFFFF] shadow-[0_8px_20px_rgba(45,70,230,0.22)] hover:bg-[#2238C9] disabled:opacity-60 transition-colors cursor-pointer"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                <span>Submitting Request...</span>
              </>
            ) : (
              <span>Send Recovery Instructions</span>
            )}
          </button>

          <div className="border-t border-[#E4E8F2] pt-4 text-xs text-[#667085] flex items-center justify-between">
            <span>Remembered your credentials?</span>
            <a
              href="/login"
              onClick={(e) => {
                e.preventDefault();
                onNavigate('/login');
              }}
              className="font-semibold text-[#2D46E6] hover:underline"
            >
              Back to Sign In →
            </a>
          </div>
        </form>
      )}
    </AuthLayout>
  );
};

export const ResetPasswordPage: React.FC<AuthPageProps> = ({
  onNavigate,
  searchParamsString,
}) => {
  const { clearAuthState } = useAuth();
  const initialToken = getTokenParam(searchParamsString);

  const [token, setToken] = useState(initialToken);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!token.trim()) {
      setErrorMsg('A valid password reset token is required.');
      return;
    }

    const strength = evaluatePasswordStrength(password);
    if (!strength.valid) {
      setErrorMsg(strength.error!);
      return;
    }
    if (password !== confirmPassword) {
      setErrorMsg('Password confirmation does not match.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: token.trim(),
          password,
          confirmPassword,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; message?: string; error?: string };
      if (!res.ok || !data.ok) {
        setErrorMsg(data.error ?? 'Unable to reset password.');
        return;
      }

      clearAuthState();
      setSuccessMsg(
        data.message ??
          'Your password has been updated and all prior active sessions were signed out.',
      );
    } catch {
      setErrorMsg('Network error while updating your password.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthLayout
      onNavigate={onNavigate}
      eyebrow="Credential Update"
      title="Choose a new password."
      subtitle="Completing a password reset invalidates the single-use recovery token and revokes every previously active browser session."
    >
      {successMsg ? (
        <div className="space-y-5 py-2" role="status" aria-live="polite">
          <div className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-[#BBF7D0] bg-[#F0FDF4] text-[#16A34A]">
            <ShieldCheck className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="space-y-2">
            <h2 className="font-display text-2xl font-bold text-[#080B12]">Password Updated</h2>
            <p className="text-sm text-[#667085] leading-relaxed">{successMsg}</p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('/login')}
            className="inline-flex h-10 items-center justify-center rounded-md bg-[#2D46E6] px-5 text-xs font-semibold uppercase tracking-[0.04em] text-[#FFFFFF] hover:bg-[#2238C9] cursor-pointer"
          >
            Sign In with New Password
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <div className="border-b border-[#E4E8F2] pb-4">
            <h2 className="font-display text-xl font-bold text-[#080B12]">Reset Password</h2>
            <p className="text-xs text-[#667085] mt-0.5">
              Choose a unique password of at least 10 characters.
            </p>
          </div>

          {errorMsg && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-[#FECACA] bg-[#FEF2F2] p-3 text-xs font-medium text-[#B91C1C]"
            >
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
              <span>{errorMsg}</span>
            </div>
          )}

          {!initialToken && (
            <div className="space-y-1.5">
              <label htmlFor="reset-token" className="block text-xs font-semibold text-[#080B12]">
                Recovery Token
              </label>
              <input
                id="reset-token"
                name="token"
                type="text"
                required
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Paste your single-use reset token"
                className="h-10 w-full rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] px-3.5 font-mono text-xs text-[#080B12] placeholder:text-[#98A2B3] focus:border-[#2D46E6] focus:outline-none"
              />
            </div>
          )}

          <div className="space-y-1.5">
            <label htmlFor="reset-password" className="block text-xs font-semibold text-[#080B12]">
              New Password
            </label>
            <div className="relative">
              <input
                id="reset-password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Minimum 10 characters"
                className="h-10 w-full rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] pl-3.5 pr-11 text-sm text-[#080B12] placeholder:text-[#98A2B3] focus:border-[#2D46E6] focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex h-8 w-8 items-center justify-center rounded-md text-[#667085] hover:text-[#080B12] cursor-pointer"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <PasswordStrengthMeter password={password} />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="reset-confirm" className="block text-xs font-semibold text-[#080B12]">
              Confirm New Password
            </label>
            <input
              id="reset-confirm"
              name="confirmPassword"
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Re-enter your new password"
              className="h-10 w-full rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] px-3.5 text-sm text-[#080B12] placeholder:text-[#98A2B3] focus:border-[#2D46E6] focus:outline-none"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-[#2D46E6] px-5 text-xs font-semibold uppercase tracking-[0.04em] text-[#FFFFFF] shadow-[0_8px_20px_rgba(45,70,230,0.22)] hover:bg-[#2238C9] disabled:opacity-60 transition-colors cursor-pointer"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                <span>Updating Password...</span>
              </>
            ) : (
              <span>Update Password</span>
            )}
          </button>

          <div className="border-t border-[#E4E8F2] pt-4 text-xs text-[#667085] flex items-center justify-between">
            <span>Need a fresh recovery link?</span>
            <a
              href="/forgot-password"
              onClick={(e) => {
                e.preventDefault();
                onNavigate('/forgot-password');
              }}
              className="font-semibold text-[#2D46E6] hover:underline"
            >
              Request new link →
            </a>
          </div>
        </form>
      )}
    </AuthLayout>
  );
};

export const VerifyEmailPage: React.FC<AuthPageProps> = ({
  onNavigate,
  searchParamsString,
}) => {
  const urlToken = getTokenParam(searchParamsString);

  const [tokenInput, setTokenInput] = useState(urlToken);
  const [resendEmail, setResendEmail] = useState('');
  const [verifyState, setVerifyState] = useState<{
    status: 'idle' | 'verifying' | 'success' | 'error';
    message?: string;
    code?: string;
  }>({ status: urlToken ? 'verifying' : 'idle' });
  const [resendState, setResendState] = useState<{
    loading: boolean;
    message?: string;
    error?: string;
  }>({ loading: false });

  const submitToken = async (tok: string) => {
    if (!tok.trim()) {
      setVerifyState({ status: 'error', message: 'Please enter a verification token.' });
      return;
    }
    setVerifyState({ status: 'verifying' });
    try {
      const res = await fetch('/api/auth/verify-email', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: tok.trim() }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        message?: string;
        error?: string;
        code?: string;
      };
      if (!res.ok || !data.ok) {
        setVerifyState({
          status: 'error',
          message: data.error ?? 'Verification link is invalid or expired.',
          code: data.code,
        });
        return;
      }
      setVerifyState({
        status: 'success',
        message: data.message ?? 'Email verified successfully.',
      });
    } catch {
      setVerifyState({
        status: 'error',
        message: 'Network error while verifying your email address.',
      });
    }
  };

  useEffect(() => {
    if (urlToken) {
      void submitToken(urlToken);
    }
  }, [urlToken]);

  const handleResend = async (e: React.FormEvent) => {
    e.preventDefault();
    const normalized = normalizeEmail(resendEmail);
    const check = validateEmailAddress(normalized);
    if (!check.valid) {
      setResendState({ loading: false, error: check.error });
      return;
    }
    setResendState({ loading: true });
    try {
      const res = await fetch('/api/auth/resend-verification', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: normalized }),
      });
      const data = (await res.json()) as { ok?: boolean; message?: string; error?: string };
      if (!res.ok) {
        setResendState({ loading: false, error: data.error ?? 'Resend request failed.' });
        return;
      }
      setResendState({
        loading: false,
        message: data.message ?? 'Verification email request processed.',
      });
    } catch {
      setResendState({ loading: false, error: 'Network error while resending verification.' });
    }
  };

  return (
    <AuthLayout
      onNavigate={onNavigate}
      eyebrow="Email Verification"
      title="Confirm your email address."
      subtitle="Verification tokens are single-use and stored as SHA-256 hashes on the server to protect account activation."
    >
      <div className="space-y-6">
        {verifyState.status === 'verifying' && (
          <div className="flex items-center gap-3 rounded-xl border border-[#D5DDF7] bg-[#EFF2FA] p-4 text-sm text-[#2D46E6]">
            <Loader2 className="h-5 w-5 animate-spin shrink-0" aria-hidden="true" />
            <span>Verifying your single-use email token...</span>
          </div>
        )}

        {verifyState.status === 'success' && (
          <div className="space-y-5" role="status" aria-live="polite">
            <div className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-[#BBF7D0] bg-[#F0FDF4] text-[#16A34A]">
              <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="space-y-2">
              <h2 className="font-display text-2xl font-bold text-[#080B12]">Email Verified</h2>
              <p className="text-sm text-[#667085] leading-relaxed">{verifyState.message}</p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('/login')}
              className="inline-flex h-10 items-center justify-center rounded-md bg-[#2D46E6] px-5 text-xs font-semibold uppercase tracking-[0.04em] text-[#FFFFFF] hover:bg-[#2238C9] cursor-pointer"
            >
              Sign In to Workspace
            </button>
          </div>
        )}

        {verifyState.status !== 'success' && (
          <>
            {verifyState.status === 'error' && verifyState.message && (
              <div
                role="alert"
                className="rounded-lg border border-[#FECACA] bg-[#FEF2F2] p-3.5 text-xs font-medium text-[#B91C1C] space-y-2"
              >
                <div className="flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
                  <span>{verifyState.message}</span>
                </div>
                {verifyState.code === 'TOKEN_USED' && (
                  <div className="pl-6">
                    <button
                      type="button"
                      onClick={() => onNavigate('/login')}
                      className="inline-flex h-8 items-center rounded-md border border-[#FCA5A5] bg-[#FFFFFF] px-3 text-[11px] font-semibold text-[#991B1B] hover:bg-[#FEF2F2] cursor-pointer"
                    >
                      Already verified? Proceed to Sign In →
                    </button>
                  </div>
                )}
              </div>
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                void submitToken(tokenInput);
              }}
              className="space-y-3"
            >
              <h2 className="font-display text-lg font-bold text-[#080B12]">
                Verify with Token
              </h2>
              <div className="flex flex-col sm:flex-row gap-2.5">
                <input
                  type="text"
                  aria-label="Verification token"
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                  placeholder="Paste verification token"
                  className="h-10 flex-1 rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] px-3.5 font-mono text-xs text-[#080B12] placeholder:text-[#98A2B3] focus:border-[#2D46E6] focus:outline-none"
                />
                <button
                  type="submit"
                  className="inline-flex h-10 items-center justify-center rounded-md bg-[#2D46E6] px-4 text-xs font-semibold text-[#FFFFFF] hover:bg-[#2238C9] cursor-pointer"
                >
                  Verify Email
                </button>
              </div>
            </form>

            <form
              onSubmit={handleResend}
              noValidate
              className="border-t border-[#E4E8F2] pt-5 space-y-3"
            >
              <h3 className="font-display text-sm font-bold text-[#080B12]">
                Need a new verification link?
              </h3>
              <p className="text-xs text-[#667085]">
                Enter the email address you registered with to issue a fresh 24-hour verification link.
              </p>
              {resendState.message && (
                <div
                  role="status"
                  className="rounded-lg border border-[#BBF7D0] bg-[#F0FDF4] p-3 text-xs text-[#15803D]"
                >
                  {resendState.message}
                </div>
              )}
              {resendState.error && (
                <div
                  role="alert"
                  className="rounded-lg border border-[#FECACA] bg-[#FEF2F2] p-3 text-xs text-[#B91C1C]"
                >
                  {resendState.error}
                </div>
              )}
              <div className="flex flex-col sm:flex-row gap-2.5">
                <input
                  type="email"
                  aria-label="Email address for verification resend"
                  value={resendEmail}
                  onChange={(e) => setResendEmail(e.target.value)}
                  placeholder="analyst@example.com"
                  className="h-10 flex-1 rounded-lg border border-[#E4E8F2] bg-[#FFFFFF] px-3.5 text-sm text-[#080B12] placeholder:text-[#98A2B3] focus:border-[#2D46E6] focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={resendState.loading}
                  className="inline-flex h-10 items-center justify-center rounded-md border border-[#E4E8F2] bg-[#FFFFFF] px-4 text-xs font-semibold text-[#080B12] hover:border-[#2D46E6] hover:text-[#2D46E6] disabled:opacity-60 cursor-pointer"
                >
                  {resendState.loading ? 'Sending...' : 'Resend Email'}
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </AuthLayout>
  );
};
