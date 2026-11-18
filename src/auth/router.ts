import express, { NextFunction, Request, Response } from 'express';
import { normalizeEmail } from '../lib/authValidation';
import { sanitizeBaseUrl, SlidingWindowRateLimiter } from '../lib/security';
import {
  parseCookieHeader,
  SESSION_COOKIE_NAME,
  serializeClearedSessionCookie,
  serializeSessionCookie,
} from './crypto';
import { AuthEmailSender } from './email';
import { AuthService, PublicAuthUser, PublicSessionInfo } from './service';

export interface AuthenticatedRequest extends Request {
  auth?: {
    user: PublicAuthUser;
    session: PublicSessionInfo;
    rawToken: string;
  };
}

export interface AuthRouterOptions {
  authService: AuthService;
  emailSender: AuthEmailSender;
  authDatabase?: 'supabase-postgres' | 'sqlite';
  rateLimits?: {
    signupIpMax?: number;
    loginIpMax?: number;
    loginAccountMax?: number;
    forgotIpMax?: number;
    resendIpMax?: number;
    resendAccountMax?: number;
    resetIpMax?: number;
    verifyIpMax?: number;
  };
}

export function isSecureRequest(req: Request): boolean {
  if (process.env.NODE_ENV === 'production') return true;
  if (req.secure) return true;
  const proto = (req.get('x-forwarded-proto') ?? '').split(',')[0].trim().toLowerCase();
  if (proto === 'https') return true;
  const origin = (req.get('origin') ?? '').trim().toLowerCase();
  if (origin.startsWith('https://')) return true;
  const referer = (req.get('referer') ?? '').trim().toLowerCase();
  return referer.startsWith('https://');
}

export function extractSessionToken(req: Request): string | undefined {
  const cookies = parseCookieHeader(req.headers.cookie);
  const val = cookies[SESSION_COOKIE_NAME];
  return val ? val.trim() : undefined;
}

export function isSameOriginMutation(req: Request): boolean {
  const originHeader = req.get('origin');
  const refererHeader = req.get('referer');
  if (!originHeader && !refererHeader) {
    return true;
  }

  const expectedBase = sanitizeBaseUrl(
    process.env.APP_URL,
    req.get('x-forwarded-host') || req.get('host'),
    req.get('x-forwarded-proto') || req.protocol,
    3000,
  );
  const requestHostBase = sanitizeBaseUrl(
    undefined,
    req.get('x-forwarded-host') || req.get('host'),
    req.get('x-forwarded-proto') || req.protocol,
    3000,
  );

  const allowedOrigins = new Set([
    new URL(expectedBase).origin,
    new URL(requestHostBase).origin,
  ]);

  if (originHeader) {
    try {
      if (!allowedOrigins.has(new URL(originHeader).origin)) {
        return false;
      }
    } catch {
      return false;
    }
  }

  if (refererHeader) {
    try {
      if (!allowedOrigins.has(new URL(refererHeader).origin)) {
        return false;
      }
    } catch {
      return false;
    }
  }

  return true;
}

export function createAuthMiddleware(authService: AuthService) {
  const attachAuth = async (req: AuthenticatedRequest, _res: Response, next: NextFunction) => {
    try {
      const rawToken = extractSessionToken(req);
      if (rawToken) {
        const verified = await authService.authenticateSessionToken(rawToken);
        if (verified) {
          req.auth = { ...verified, rawToken };
        }
      }
      next();
    } catch (err) {
      next(err);
    }
  };

  const requireAuth = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const rawToken = extractSessionToken(req);
      const verified = rawToken ? await authService.authenticateSessionToken(rawToken) : null;
      if (!verified || !rawToken) {
        res.status(401).json({
          error: 'Authentication required. Please sign in to continue.',
          code: 'UNAUTHENTICATED',
        });
        return;
      }
      req.auth = { ...verified, rawToken };
      next();
    } catch (err) {
      next(err);
    }
  };

  return { attachAuth, requireAuth };
}

export function createAuthRouter({
  authService,
  emailSender,
  authDatabase = 'sqlite',
  rateLimits,
}: AuthRouterOptions) {
  const router = express.Router();
  const { requireAuth } = createAuthMiddleware(authService);

  const signupIpLimiter = new SlidingWindowRateLimiter(rateLimits?.signupIpMax ?? 8, 15 * 60_000);
  const loginIpLimiter = new SlidingWindowRateLimiter(rateLimits?.loginIpMax ?? 15, 15 * 60_000);
  const loginAccountLimiter = new SlidingWindowRateLimiter(
    rateLimits?.loginAccountMax ?? 8,
    15 * 60_000,
  );
  const forgotIpLimiter = new SlidingWindowRateLimiter(rateLimits?.forgotIpMax ?? 5, 15 * 60_000);
  const resendIpLimiter = new SlidingWindowRateLimiter(rateLimits?.resendIpMax ?? 4, 15 * 60_000);
  const resendAccountLimiter = new SlidingWindowRateLimiter(
    rateLimits?.resendAccountMax ?? 3,
    15 * 60_000,
  );
  const resetIpLimiter = new SlidingWindowRateLimiter(rateLimits?.resetIpMax ?? 10, 15 * 60_000);
  const verifyIpLimiter = new SlidingWindowRateLimiter(rateLimits?.verifyIpMax ?? 20, 15 * 60_000);

  router.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
      if (!isSameOriginMutation(req)) {
        res.status(403).json({
          error: 'Cross-origin state-changing request rejected.',
          code: 'CSRF_ORIGIN_MISMATCH',
        });
        return;
      }
    }
    next();
  });

  router.get('/config', (_req, res) => {
    res.json({
      emailDeliveryConfigured: emailSender.isConfigured(),
      emailProvider: emailSender.getProviderName(),
      authDatabase,
      googleOAuthConfigured: false,
      passwordMinLength: 10,
    });
  });

  router.post('/signup', async (req, res, next) => {
    try {
      const ip = req.ip || 'unknown';
      const ipCheck = signupIpLimiter.check(ip);
      if (!ipCheck.allowed) {
        res.setHeader('Retry-After', String(ipCheck.retryAfterSeconds));
        res.status(429).json({
          error: 'Too many signup attempts from this address. Please wait before trying again.',
          code: 'RATE_LIMITED',
        });
        return;
      }

      const outcome = await authService.signup({
        fullName: req.body?.fullName,
        email: req.body?.email,
        password: req.body?.password,
        confirmPassword: req.body?.confirmPassword,
        acceptTerms: req.body?.acceptTerms,
        acceptPrivacy: req.body?.acceptPrivacy,
        ipAddress: ip,
        userAgent: req.get('user-agent'),
      });

      if (!outcome.ok) {
        res.status(outcome.status).json({
          error: outcome.error,
          code: outcome.code,
          fieldErrors: outcome.fieldErrors,
        });
        return;
      }

      res.status(outcome.status).json({
        ok: true,
        ...outcome.data,
      });
    } catch (err) {
      next(err);
    }
  });

  router.post('/login', async (req, res, next) => {
    try {
      const ip = req.ip || 'unknown';
      const ipCheck = loginIpLimiter.check(ip);
      if (!ipCheck.allowed) {
        res.setHeader('Retry-After', String(ipCheck.retryAfterSeconds));
        res.status(429).json({
          error: 'Too many sign-in attempts. Please wait a few minutes before retrying.',
          code: 'RATE_LIMITED',
        });
        return;
      }

      const emailKey = normalizeEmail(req.body?.email);
      if (emailKey) {
        const acctCheck = loginAccountLimiter.check(`${ip}:${emailKey}`);
        if (!acctCheck.allowed) {
          res.setHeader('Retry-After', String(acctCheck.retryAfterSeconds));
          res.status(429).json({
            error: 'Too many sign-in attempts for this account. Please wait before retrying.',
            code: 'RATE_LIMITED',
          });
          return;
        }
      }

      const outcome = await authService.login({
        email: req.body?.email,
        password: req.body?.password,
        rememberMe: req.body?.rememberMe,
        existingSessionToken: extractSessionToken(req),
        ipAddress: ip,
        userAgent: req.get('user-agent'),
      });

      if (!outcome.ok) {
        res.status(outcome.status).json({
          error: outcome.error,
          code: outcome.code,
          emailDeliveryConfigured: emailSender.isConfigured(),
        });
        return;
      }

      res.setHeader(
        'Set-Cookie',
        serializeSessionCookie(outcome.data.sessionToken, {
          maxAgeSeconds: outcome.data.maxAgeSeconds,
          secure: isSecureRequest(req),
        }),
      );

      res.status(200).json({
        ok: true,
        user: outcome.data.user,
        session: outcome.data.session,
      });
    } catch (err) {
      next(err);
    }
  });

  router.post('/logout', async (req, res, next) => {
    try {
      const rawToken = extractSessionToken(req);
      await authService.logout(rawToken, {
        ipAddress: req.ip || 'unknown',
        userAgent: req.get('user-agent'),
      });
      res.setHeader('Set-Cookie', serializeClearedSessionCookie(isSecureRequest(req)));
      res.status(200).json({ ok: true, message: 'Signed out cleanly.' });
    } catch (err) {
      next(err);
    }
  });

  router.get('/me', async (req: AuthenticatedRequest, res, next) => {
    try {
      const rawToken = extractSessionToken(req);
      const verified = rawToken ? await authService.authenticateSessionToken(rawToken) : null;
      if (!verified) {
        if (rawToken) {
          res.setHeader('Set-Cookie', serializeClearedSessionCookie(isSecureRequest(req)));
        }
        res.status(401).json({
          authenticated: false,
          error: 'Not authenticated.',
          code: 'UNAUTHENTICATED',
        });
        return;
      }

      res.status(200).json({
        authenticated: true,
        user: verified.user,
        session: verified.session,
      });
    } catch (err) {
      next(err);
    }
  });

  router.patch('/account', requireAuth, async (req: AuthenticatedRequest, res, next) => {
    try {
      const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
      if (
        'role' in body ||
        'accountStatus' in body ||
        'account_status' in body ||
        'emailVerified' in body ||
        'email_verified' in body
      ) {
        await authService.recordSecurityEvent({
          userId: req.auth!.user.id,
          eventType: 'privilege_escalation_blocked',
          ipAddress: req.ip || 'unknown',
          userAgent: req.get('user-agent'),
          detail: 'Blocked attempt to modify protected role or account status fields via /api/auth/account.',
        });
        res.status(403).json({
          error: 'Role and account status fields cannot be modified via self-service profile updates.',
          code: 'FORBIDDEN_PRIVILEGE_ESCALATION',
        });
        return;
      }

      const outcome = await authService.updateAccountProfile({
        userId: req.auth!.user.id,
        fullName: body.fullName,
        ipAddress: req.ip || 'unknown',
        userAgent: req.get('user-agent'),
      });

      if (!outcome.ok) {
        res.status(outcome.status).json({
          error: outcome.error,
          fieldErrors: outcome.fieldErrors,
        });
        return;
      }

      res.status(200).json({
        ok: true,
        user: outcome.data.user,
      });
    } catch (err) {
      next(err);
    }
  });

  router.post('/forgot-password', async (req, res, next) => {
    try {
      const ip = req.ip || 'unknown';
      const ipCheck = forgotIpLimiter.check(ip);
      if (!ipCheck.allowed) {
        res.setHeader('Retry-After', String(ipCheck.retryAfterSeconds));
        res.status(429).json({
          error: 'Too many password reset requests. Please wait before trying again.',
          code: 'RATE_LIMITED',
        });
        return;
      }

      const outcome = await authService.forgotPassword({
        email: req.body?.email,
        ipAddress: ip,
        userAgent: req.get('user-agent'),
      });

      if (!outcome.ok) {
        res.status(outcome.status).json({ error: outcome.error });
        return;
      }

      res.status(200).json({
        ok: true,
        ...outcome.data,
      });
    } catch (err) {
      next(err);
    }
  });

  router.post('/reset-password', async (req, res, next) => {
    try {
      const ip = req.ip || 'unknown';
      const ipCheck = resetIpLimiter.check(ip);
      if (!ipCheck.allowed) {
        res.setHeader('Retry-After', String(ipCheck.retryAfterSeconds));
        res.status(429).json({
          error: 'Too many password reset attempts. Please wait before trying again.',
          code: 'RATE_LIMITED',
        });
        return;
      }

      const outcome = await authService.resetPassword({
        token: req.body?.token,
        password: req.body?.password,
        confirmPassword: req.body?.confirmPassword,
        ipAddress: ip,
        userAgent: req.get('user-agent'),
      });

      if (!outcome.ok) {
        res.status(outcome.status).json({
          error: outcome.error,
          code: outcome.code,
          fieldErrors: outcome.fieldErrors,
        });
        return;
      }

      res.setHeader('Set-Cookie', serializeClearedSessionCookie(isSecureRequest(req)));
      res.status(200).json({
        ok: true,
        ...outcome.data,
      });
    } catch (err) {
      next(err);
    }
  });

  router.post('/verify-email', async (req, res, next) => {
    try {
      const ip = req.ip || 'unknown';
      const ipCheck = verifyIpLimiter.check(ip);
      if (!ipCheck.allowed) {
        res.setHeader('Retry-After', String(ipCheck.retryAfterSeconds));
        res.status(429).json({
          error: 'Too many verification attempts. Please wait briefly.',
          code: 'RATE_LIMITED',
        });
        return;
      }

      const outcome = await authService.verifyEmail({
        token: req.body?.token,
        ipAddress: ip,
        userAgent: req.get('user-agent'),
      });

      if (!outcome.ok) {
        res.status(outcome.status).json({
          error: outcome.error,
          code: outcome.code,
        });
        return;
      }

      res.status(200).json({
        ok: true,
        ...outcome.data,
      });
    } catch (err) {
      next(err);
    }
  });

  router.post('/resend-verification', async (req, res, next) => {
    try {
      const ip = req.ip || 'unknown';
      const ipCheck = resendIpLimiter.check(ip);
      if (!ipCheck.allowed) {
        res.setHeader('Retry-After', String(ipCheck.retryAfterSeconds));
        res.status(429).json({
          error: 'Too many verification resend requests. Please wait before retrying.',
          code: 'RATE_LIMITED',
        });
        return;
      }

      const emailKey = normalizeEmail(req.body?.email);
      if (emailKey) {
        const acctCheck = resendAccountLimiter.check(emailKey);
        if (!acctCheck.allowed) {
          res.setHeader('Retry-After', String(acctCheck.retryAfterSeconds));
          res.status(429).json({
            error: 'Verification emails were recently requested for this address. Please wait.',
            code: 'RATE_LIMITED',
          });
          return;
        }
      }

      const outcome = await authService.resendVerification({
        email: req.body?.email,
        ipAddress: ip,
        userAgent: req.get('user-agent'),
      });

      if (!outcome.ok) {
        res.status(outcome.status).json({ error: outcome.error });
        return;
      }

      res.status(200).json({
        ok: true,
        ...outcome.data,
      });
    } catch (err) {
      next(err);
    }
  });

  router.get('/sessions', requireAuth, async (req: AuthenticatedRequest, res, next) => {
    try {
      const sessions = await authService.listSessions(req.auth!.user.id, req.auth!.session.id);
      res.status(200).json({
        ok: true,
        sessions,
      });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/sessions/:id', requireAuth, async (req: AuthenticatedRequest, res, next) => {
    try {
      const targetId = req.params.id;
      const outcome = await authService.revokeSession({
        userId: req.auth!.user.id,
        sessionId: targetId,
        ipAddress: req.ip || 'unknown',
        userAgent: req.get('user-agent'),
      });

      if (!outcome.ok) {
        res.status(outcome.status).json({ error: outcome.error });
        return;
      }

      if (targetId === req.auth!.session.id) {
        res.setHeader('Set-Cookie', serializeClearedSessionCookie(isSecureRequest(req)));
      }

      res.status(200).json({
        ok: true,
        ...outcome.data,
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
