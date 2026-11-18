import express from 'express';
import { PERMISSIONS, RbacAuthenticatedRequest, requireAuthenticatedUser, requirePermission } from '../auth/rbac';
import { isSameOriginMutation } from '../auth/router';
import type { AuthService } from '../auth/service';
import { SlidingWindowRateLimiter } from '../lib/security';
import type { AdminService } from './service';

export interface PrivacyRouterOptions {
  authService: AuthService;
  adminService: AdminService;
}

export function createPrivacyRouter(options: PrivacyRouterOptions) {
  const { authService, adminService } = options;
  const router = express.Router();
  const mutationLimiter = new SlidingWindowRateLimiter(15, 60_000);

  router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
      if (!isSameOriginMutation(req)) {
        res.status(403).json({
          error: 'Cross-origin privacy mutation rejected.',
          code: 'CSRF_ORIGIN_MISMATCH',
        });
        return;
      }
    }
    next();
  });

  router.use(requireAuthenticatedUser(authService));
  router.use(requirePermission(PERMISSIONS.ACCOUNT_SELF));

  router.get('/summary', async (req: RbacAuthenticatedRequest, res, next) => {
    try {
      const data = await adminService.governance.getUserPrivacySummary(req.auth!.user.id);
      res.json({ ok: true, ...data });
    } catch (err) {
      next(err);
    }
  });

  router.post('/export', async (req: RbacAuthenticatedRequest, res, next) => {
    try {
      const rate = mutationLimiter.check(`export:${req.auth!.user.id}`);
      if (!rate.allowed) {
        res.setHeader('Retry-After', String(rate.retryAfterSeconds));
        res.status(429).json({ error: 'Too many export requests. Please wait briefly.', code: 'RATE_LIMITED' });
        return;
      }
      const user = req.auth!.user;
      const out = await adminService.governance.requestPersonalExport({
        targetUserId: user.id,
        requestedByUserId: user.id,
        requestedByEmail: user.email,
        autoProcess: true,
      });
      if (!out.ok) {
        res.status(out.status).json({ error: out.error, code: out.code });
        return;
      }
      res.status(out.status).json({ ok: true, ...out.data });
    } catch (err) {
      next(err);
    }
  });

  router.get('/export/:id/download', async (req: RbacAuthenticatedRequest, res, next) => {
    try {
      const out = await adminService.governance.downloadUserExportArtifact({
        requestingUserId: req.auth!.user.id,
        exportId: req.params.id,
        sig: typeof req.query.sig === 'string' ? req.query.sig : undefined,
      });
      if (!out.ok) {
        res.status(out.status).json({ error: out.error, code: out.code });
        return;
      }
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${out.data.filename}"`);
      res.send(out.data.jsonContent);
    } catch (err) {
      next(err);
    }
  });

  router.post('/deletion', async (req: RbacAuthenticatedRequest, res, next) => {
    try {
      const rate = mutationLimiter.check(`delete:${req.auth!.user.id}`);
      if (!rate.allowed) {
        res.setHeader('Retry-After', String(rate.retryAfterSeconds));
        res.status(429).json({ error: 'Too many deletion requests. Please wait briefly.', code: 'RATE_LIMITED' });
        return;
      }
      const user = req.auth!.user;
      const out = await adminService.governance.requestSelfDeletion({
        userId: user.id,
        email: user.email,
        role: user.role,
        reason: req.body?.reason,
      });
      if (!out.ok) {
        res.status(out.status).json({ error: out.error, code: out.code });
        return;
      }
      res.status(out.status).json({ ok: true, ...out.data });
    } catch (err) {
      next(err);
    }
  });

  router.post('/deletion/:id/cancel', async (req: RbacAuthenticatedRequest, res, next) => {
    try {
      const user = req.auth!.user;
      const out = await adminService.governance.cancelSelfDeletionRequest({
        userId: user.id,
        email: user.email,
        deletionRequestId: req.params.id,
      });
      if (!out.ok) {
        res.status(out.status).json({ error: out.error, code: out.code });
        return;
      }
      res.json({ ok: true, ...out.data });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
