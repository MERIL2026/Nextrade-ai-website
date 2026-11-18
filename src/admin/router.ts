import express, { Request, Response } from 'express';
import {
  PERMISSIONS,
  RbacAuthenticatedRequest,
  normalizeUserRole,
  requireAdminAccess,
  requireAuthenticatedUser,
  requirePermission,
} from '../auth/rbac';
import { isSameOriginMutation } from '../auth/router';
import type { AuthService } from '../auth/service';
import { SlidingWindowRateLimiter, stripControlChars } from '../lib/security';
import type { AdminActor, AdminService } from './service';
import type { BackgroundJobManager } from './telemetry';

export interface AdminRouterOptions {
  authService: AuthService;
  adminService: AdminService;
  jobManager: BackgroundJobManager;
  rateLimits?: {
    mutationMax?: number;
    sensitiveMax?: number;
  };
}

function buildActor(req: RbacAuthenticatedRequest): AdminActor {
  const auth = req.auth!;
  return {
    userId: auth.user.id,
    email: auth.user.email,
    role: normalizeUserRole(auth.user.role),
    ipAddress: stripControlChars(req.ip || 'unknown', 64) || 'unknown',
    userAgent: stripControlChars(req.get('user-agent') ?? 'unknown', 240) || 'unknown',
    currentSessionId: auth.session.id,
  };
}

export function createAdminRouter(options: AdminRouterOptions) {
  const { authService, adminService, jobManager, rateLimits } = options;
  const router = express.Router();

  const mutationLimiter = new SlidingWindowRateLimiter(rateLimits?.mutationMax ?? 90, 60_000);
  const sensitiveLimiter = new SlidingWindowRateLimiter(rateLimits?.sensitiveMax ?? 20, 60_000);
  const searchLimiter = new SlidingWindowRateLimiter(60, 60_000);

  router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
      if (!isSameOriginMutation(req)) {
        res.status(403).json({
          error: 'Cross-origin administrative mutation rejected.',
          code: 'CSRF_ORIGIN_MISMATCH',
        });
        return;
      }
    }
    next();
  });

  router.use(requireAuthenticatedUser(authService));
  router.use(requireAdminAccess());

  router.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
      const authed = req as RbacAuthenticatedRequest;
      const check = mutationLimiter.check(authed.auth?.user.id ?? req.ip ?? 'unknown');
      if (!check.allowed) {
        res.setHeader('Retry-After', String(check.retryAfterSeconds));
        res.status(429).json({
          error: 'Administrative mutation rate limit reached. Please wait briefly.',
          code: 'RATE_LIMITED',
        });
        return;
      }
    }
    next();
  });

  async function enforceReauth(req: RbacAuthenticatedRequest, res: Response): Promise<boolean> {
    const actor = buildActor(req);
    const rate = sensitiveLimiter.check(`reauth:${actor.userId}`);
    if (!rate.allowed) {
      res.setHeader('Retry-After', String(rate.retryAfterSeconds));
      res.status(429).json({
        error: 'Too many sensitive administrative attempts. Please wait briefly.',
        code: 'RATE_LIMITED',
      });
      return false;
    }

    const password = typeof req.body?.confirmPassword === 'string' ? req.body.confirmPassword : '';
    if (!password) {
      res.status(428).json({
        error: 'Administrator password re-authentication is required for this sensitive action.',
        code: 'REAUTH_REQUIRED',
      });
      return false;
    }

    const valid = await authService.verifyUserPassword(actor.userId, password);
    if (!valid) {
      await adminService.writeAuditLog({
        actor,
        action: 'ADMIN_REAUTH_FAILED',
        resourceType: 'admin_session',
        resourceId: actor.userId,
        result: 'DENIED',
      });
      res.status(403).json({
        error: 'Administrator password verification failed.',
        code: 'REAUTH_FAILED',
      });
      return false;
    }
    return true;
  }

  // ---- OVERVIEW & NOTIFICATIONS ----
  router.get(
    '/overview',
    requirePermission(PERMISSIONS.ADMIN_CONSOLE_READ),
    async (req, res, next) => {
      try {
        const data = await adminService.getOverview(req.query.range);
        res.json({ ok: true, ...data });
      } catch (err) {
        next(err);
      }
    },
  );

  router.get(
    '/notifications',
    requirePermission(PERMISSIONS.ADMIN_CONSOLE_READ),
    async (_req, res, next) => {
      try {
        const data = await adminService.getNotificationsSummary();
        res.json({ ok: true, ...data });
      } catch (err) {
        next(err);
      }
    },
  );

  // ---- USER MANAGEMENT ----
  router.get(
    '/users',
    requirePermission(PERMISSIONS.ADMIN_USERS_READ),
    async (req, res, next) => {
      try {
        const data = await adminService.listUsers({
          search: typeof req.query.search === 'string' ? req.query.search : undefined,
          role: typeof req.query.role === 'string' ? req.query.role : undefined,
          status: typeof req.query.status === 'string' ? req.query.status : undefined,
          verified: typeof req.query.verified === 'string' ? req.query.verified : undefined,
          sort: typeof req.query.sort === 'string' ? req.query.sort : undefined,
          limit: Number(req.query.limit) || 25,
          offset: Number(req.query.offset) || 0,
        });
        res.json({ ok: true, ...data });
      } catch (err) {
        next(err);
      }
    },
  );

  router.get(
    '/users/export',
    requirePermission(PERMISSIONS.ADMIN_USERS_READ),
    async (req: RbacAuthenticatedRequest, res, next) => {
      try {
        const csv = await adminService.exportUsersCsv(buildActor(req));
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="nextrade-users-export.csv"');
        res.send(csv);
      } catch (err) {
        next(err);
      }
    },
  );

  router.get(
    '/users/:id',
    requirePermission(PERMISSIONS.ADMIN_USERS_READ),
    async (req, res, next) => {
      try {
        const out = await adminService.getUserDetail(req.params.id);
        if (!out.ok) {
          res.status(out.status).json({ error: out.error, code: out.code });
          return;
        }
        res.json({ ok: true, ...out.data });
      } catch (err) {
        next(err);
      }
    },
  );

  router.patch(
    '/users/:id',
    requirePermission(PERMISSIONS.ADMIN_USERS_MANAGE),
    async (req: RbacAuthenticatedRequest, res, next) => {
      try {
        if (req.body && ('role' in req.body)) {
          res.status(403).json({
            error: 'Use /api/admin/users/:id/role with Super Admin privileges to modify roles.',
            code: 'ROLE_ENDPOINT_REQUIRED',
          });
          return;
        }
        const out = await adminService.updateUserProfileAdmin(
          buildActor(req),
          req.params.id,
          req.body ?? {},
        );
        if (!out.ok) {
          res.status(out.status).json({ error: out.error, code: out.code });
          return;
        }
        res.json({ ok: true, ...out.data });
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/users/:id/suspend',
    requirePermission(PERMISSIONS.ADMIN_USERS_MANAGE),
    async (req: RbacAuthenticatedRequest, res, next) => {
      try {
        const out = await adminService.suspendUser(
          buildActor(req),
          req.params.id,
          typeof req.body?.reason === 'string' ? req.body.reason : undefined,
        );
        if (!out.ok) {
          res.status(out.status).json({ error: out.error, code: out.code });
          return;
        }
        res.json({ ok: true, ...out.data });
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/users/:id/restore',
    requirePermission(PERMISSIONS.ADMIN_USERS_MANAGE),
    async (req: RbacAuthenticatedRequest, res, next) => {
      try {
        const out = await adminService.restoreUser(
          buildActor(req),
          req.params.id,
          typeof req.body?.reason === 'string' ? req.body.reason : undefined,
        );
        if (!out.ok) {
          res.status(out.status).json({ error: out.error, code: out.code });
          return;
        }
        res.json({ ok: true, ...out.data });
      } catch (err) {
        next(err);
      }
    },
  );

  router.get(
    '/users/:id/sessions',
    requirePermission(PERMISSIONS.ADMIN_USERS_READ),
    async (req, res, next) => {
      try {
        const out = await adminService.getUserDetail(req.params.id);
        if (!out.ok) {
          res.status(out.status).json({ error: out.error, code: out.code });
          return;
        }
        res.json({ ok: true, sessions: out.data.sessions });
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/users/:id/sessions/revoke',
    requirePermission(PERMISSIONS.ADMIN_SESSIONS_MANAGE),
    async (req: RbacAuthenticatedRequest, res, next) => {
      try {
        const sessionId =
          typeof req.body?.sessionId === 'string' ? req.body.sessionId : undefined;
        const out = await adminService.revokeTargetUserSession(
          buildActor(req),
          req.params.id,
          sessionId,
        );
        if (!out.ok) {
          res.status(out.status).json({ error: out.error, code: out.code });
          return;
        }
        res.json({ ok: true, ...out.data });
      } catch (err) {
        next(err);
      }
    },
  );

  router.delete(
    '/users/:id',
    requirePermission(PERMISSIONS.ADMIN_USERS_DELETE),
    async (req: RbacAuthenticatedRequest, res, next) => {
      try {
        if (!(await enforceReauth(req, res))) return;
        const confirmEmail =
          typeof req.body?.confirmEmail === 'string' ? req.body.confirmEmail : '';
        const out = await adminService.deleteUserAccount(
          buildActor(req),
          req.params.id,
          confirmEmail,
        );
        if (!out.ok) {
          res.status(out.status).json({ error: out.error, code: out.code });
          return;
        }
        res.json({ ok: true, ...out.data });
      } catch (err) {
        next(err);
      }
    },
  );

  // ---- ACCESS CONTROL & ROLE ASSIGNMENT ----
  router.get(
    '/roles',
    requirePermission(PERMISSIONS.ADMIN_ROLES_READ),
    (_req, res) => {
      const catalog = adminService.getRolesAndPermissionsCatalog();
      res.json({ ok: true, roles: catalog.roles });
    },
  );

  router.get(
    '/permissions',
    requirePermission(PERMISSIONS.ADMIN_ROLES_READ),
    (_req, res) => {
      const catalog = adminService.getRolesAndPermissionsCatalog();
      res.json({ ok: true, permissions: catalog.allPermissions, roles: catalog.roles });
    },
  );

  router.patch(
    '/users/:id/role',
    requirePermission(PERMISSIONS.ADMIN_ROLES_ASSIGN),
    async (req: RbacAuthenticatedRequest, res, next) => {
      try {
        if (!(await enforceReauth(req, res))) return;
        const out = await adminService.assignUserRole(
          buildActor(req),
          req.params.id,
          req.body?.role,
          typeof req.body?.reason === 'string' ? req.body.reason : '',
        );
        if (!out.ok) {
          res.status(out.status).json({ error: out.error, code: out.code });
          return;
        }
        res.json({ ok: true, ...out.data });
      } catch (err) {
        next(err);
      }
    },
  );

  // ---- AI CONTROL CENTRE ----
  router.get(
    '/ai/overview',
    requirePermission(PERMISSIONS.ADMIN_AI_READ),
    async (_req, res, next) => {
      try {
        const data = await adminService.getAiOverview();
        res.json({ ok: true, ...data });
      } catch (err) {
        next(err);
      }
    },
  );

  router.get(
    '/ai/usage',
    requirePermission(PERMISSIONS.ADMIN_AI_READ),
    async (_req, res, next) => {
      try {
        const data = await adminService.getAiOverview();
        res.json({ ok: true, usage: data.usage, provider: data.provider });
      } catch (err) {
        next(err);
      }
    },
  );

  router.get(
    '/ai/requests',
    requirePermission(PERMISSIONS.ADMIN_AI_READ),
    async (_req, res, next) => {
      try {
        const data = await adminService.getAiOverview();
        res.json({ ok: true, requests: data.requests });
      } catch (err) {
        next(err);
      }
    },
  );

  router.patch(
    '/ai/config',
    requirePermission(PERMISSIONS.ADMIN_AI_MANAGE),
    async (req: RbacAuthenticatedRequest, res, next) => {
      try {
        const out = await adminService.updateAiConfig(buildActor(req), req.body ?? {});
        if (!out.ok) {
          res.status(out.status).json({ error: out.error, code: out.code });
          return;
        }
        res.json({ ok: true, ...out.data });
      } catch (err) {
        next(err);
      }
    },
  );

  router.get(
    '/ai/prompts',
    requirePermission(PERMISSIONS.ADMIN_AI_READ),
    async (_req, res, next) => {
      try {
        const prompts = await adminService.listPromptVersions();
        res.json({ ok: true, prompts });
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/ai/prompts',
    requirePermission(PERMISSIONS.ADMIN_AI_MANAGE),
    async (req: RbacAuthenticatedRequest, res, next) => {
      try {
        const out = await adminService.createPromptVersion(buildActor(req), req.body ?? {});
        if (!out.ok) {
          res.status(out.status).json({ error: out.error, code: out.code });
          return;
        }
        res.status(out.status).json({ ok: true, ...out.data });
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/ai/prompts/:id/activate',
    requirePermission(PERMISSIONS.ADMIN_AI_MANAGE),
    async (req: RbacAuthenticatedRequest, res, next) => {
      try {
        const out = await adminService.activatePromptVersion(buildActor(req), req.params.id);
        if (!out.ok) {
          res.status(out.status).json({ error: out.error, code: out.code });
          return;
        }
        res.json({ ok: true, ...out.data });
      } catch (err) {
        next(err);
      }
    },
  );

  // ---- MARKET DATA MANAGEMENT ----
  router.get(
    '/markets/providers',
    requirePermission(PERMISSIONS.ADMIN_MARKETS_READ),
    async (_req, res, next) => {
      try {
        const data = await adminService.getMarketsOverview();
        res.json({ ok: true, providers: data.providers, coverage: data.coverage, config: data.config });
      } catch (err) {
        next(err);
      }
    },
  );

  router.get(
    '/markets/health',
    requirePermission(PERMISSIONS.ADMIN_MARKETS_READ),
    async (_req, res, next) => {
      try {
        const data = await adminService.getMarketsOverview();
        res.json({ ok: true, providers: data.providers, coverage: data.coverage, config: data.config });
      } catch (err) {
        next(err);
      }
    },
  );

  router.get(
    '/markets/symbols',
    requirePermission(PERMISSIONS.ADMIN_MARKETS_READ),
    async (_req, res, next) => {
      try {
        const data = await adminService.getMarketsOverview();
        res.json({ ok: true, symbols: data.symbols, config: data.config });
      } catch (err) {
        next(err);
      }
    },
  );

  router.patch(
    '/markets/config',
    requirePermission(PERMISSIONS.ADMIN_MARKETS_MANAGE),
    async (req: RbacAuthenticatedRequest, res, next) => {
      try {
        const out = await adminService.updateMarketConfig(buildActor(req), req.body ?? {});
        if (!out.ok) {
          res.status(out.status).json({ error: out.error, code: out.code });
          return;
        }
        res.json({ ok: true, ...out.data });
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/markets/sync',
    requirePermission(PERMISSIONS.ADMIN_MARKETS_MANAGE),
    async (req: RbacAuthenticatedRequest, res, next) => {
      try {
        const actor = buildActor(req);
        const result = await jobManager.runJob('market-catalog-sync', actor.userId);
        await adminService.writeAuditLog({
          actor,
          action: 'MARKET_CATALOG_SYNC',
          resourceType: 'background_job',
          resourceId: 'market-catalog-sync',
          newValue: { summary: result.run?.summary ?? result.error },
          result: result.ok ? 'SUCCESS' : 'ERROR',
        });
        if (!result.ok) {
          res.status(result.status).json({ error: result.error, code: (result as { code?: string }).code });
          return;
        }
        res.json({ ok: true, job: result.job, run: result.run });
      } catch (err) {
        next(err);
      }
    },
  );

  // ---- API & INTEGRATION MANAGEMENT ----
  router.get(
    '/apis/overview',
    requirePermission(PERMISSIONS.ADMIN_APIS_READ),
    async (req, res, next) => {
      try {
        const data = await adminService.getApisOverview(req.query.range);
        res.json({ ok: true, ...data });
      } catch (err) {
        next(err);
      }
    },
  );

  router.get(
    '/apis/traffic',
    requirePermission(PERMISSIONS.ADMIN_APIS_READ),
    async (req, res, next) => {
      try {
        const data = await adminService.getApisOverview(req.query.range);
        res.json({ ok: true, endpoints: data.endpoints, summary: data.summary });
      } catch (err) {
        next(err);
      }
    },
  );

  router.get(
    '/apis/errors',
    requirePermission(PERMISSIONS.ADMIN_APIS_READ),
    async (req, res, next) => {
      try {
        const data = await adminService.getApisOverview(req.query.range);
        res.json({ ok: true, failedRequests: data.failedRequests });
      } catch (err) {
        next(err);
      }
    },
  );

  router.patch(
    '/apis/rate-limits',
    requirePermission(PERMISSIONS.ADMIN_APIS_MANAGE),
    async (req: RbacAuthenticatedRequest, res, next) => {
      try {
        const out = await adminService.updateSystemConfig(buildActor(req), {
          key: 'rate_limits',
          value: req.body ?? {},
          reason: 'API Operations rate-limit policy update',
        });
        if (!out.ok) {
          res.status(out.status).json({ error: out.error, code: out.code });
          return;
        }
        res.json({ ok: true, rateLimits: out.data.config.rate_limits });
      } catch (err) {
        next(err);
      }
    },
  );

  // ---- SECURITY CENTRE ----
  router.get(
    '/security/overview',
    requirePermission(PERMISSIONS.ADMIN_SECURITY_READ),
    async (_req, res, next) => {
      try {
        const data = await adminService.getSecurityOverview();
        res.json({ ok: true, ...data });
      } catch (err) {
        next(err);
      }
    },
  );

  router.get(
    '/security/events',
    requirePermission(PERMISSIONS.ADMIN_SECURITY_READ),
    async (_req, res, next) => {
      try {
        const data = await adminService.getSecurityOverview();
        res.json({ ok: true, events: data.events });
      } catch (err) {
        next(err);
      }
    },
  );

  router.get(
    '/security/audits',
    requirePermission(PERMISSIONS.ADMIN_SECURITY_READ),
    async (_req, res, next) => {
      try {
        const data = await adminService.getSecurityOverview();
        res.json({
          ok: true,
          historicalAudit: data.historicalAudit,
          configurationPosture: data.configurationPosture,
        });
      } catch (err) {
        next(err);
      }
    },
  );

  router.get(
    '/security/incidents',
    requirePermission(PERMISSIONS.ADMIN_SECURITY_READ),
    async (_req, res, next) => {
      try {
        const data = await adminService.getSecurityOverview();
        res.json({ ok: true, incidents: data.incidents });
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/security/incidents',
    requirePermission(PERMISSIONS.ADMIN_SECURITY_MANAGE),
    async (req: RbacAuthenticatedRequest, res, next) => {
      try {
        const out = await adminService.createIncident(buildActor(req), req.body ?? {});
        if (!out.ok) {
          res.status(out.status).json({ error: out.error, code: out.code });
          return;
        }
        res.status(out.status).json({ ok: true, ...out.data });
      } catch (err) {
        next(err);
      }
    },
  );

  router.patch(
    '/security/incidents/:id',
    requirePermission(PERMISSIONS.ADMIN_SECURITY_MANAGE),
    async (req: RbacAuthenticatedRequest, res, next) => {
      try {
        const out = await adminService.updateIncident(
          buildActor(req),
          req.params.id,
          req.body ?? {},
        );
        if (!out.ok) {
          res.status(out.status).json({ error: out.error, code: out.code });
          return;
        }
        res.json({ ok: true, ...out.data });
      } catch (err) {
        next(err);
      }
    },
  );

  // ---- INFRASTRUCTURE MONITORING ----
  router.get(
    '/infrastructure/health',
    requirePermission(PERMISSIONS.ADMIN_INFRASTRUCTURE_READ),
    async (_req, res, next) => {
      try {
        const data = await adminService.getInfrastructureHealth();
        res.json({ ok: true, ...data });
      } catch (err) {
        next(err);
      }
    },
  );

  router.get(
    '/infrastructure/services',
    requirePermission(PERMISSIONS.ADMIN_INFRASTRUCTURE_READ),
    async (_req, res, next) => {
      try {
        const data = await adminService.getInfrastructureHealth();
        res.json({ ok: true, services: data.services, database: data.database });
      } catch (err) {
        next(err);
      }
    },
  );

  // ---- BACKGROUND JOBS ----
  router.get(
    '/jobs',
    requirePermission(PERMISSIONS.ADMIN_JOBS_READ),
    async (_req, res, next) => {
      try {
        const data = await jobManager.listJobs();
        res.json({ ok: true, ...data });
      } catch (err) {
        next(err);
      }
    },
  );

  router.get(
    '/jobs/:id',
    requirePermission(PERMISSIONS.ADMIN_JOBS_READ),
    async (req, res, next) => {
      try {
        const detail = await jobManager.getJob(req.params.id);
        if (!detail) {
          res.status(404).json({ error: 'Registered background job not found.' });
          return;
        }
        res.json({ ok: true, ...detail });
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/jobs/:id/retry',
    requirePermission(PERMISSIONS.ADMIN_JOBS_MANAGE),
    async (req: RbacAuthenticatedRequest, res, next) => {
      try {
        const actor = buildActor(req);
        const result = await jobManager.runJob(req.params.id, actor.userId);
        await adminService.writeAuditLog({
          actor,
          action: 'BACKGROUND_JOB_EXECUTE',
          resourceType: 'background_job',
          resourceId: req.params.id,
          newValue: { summary: result.run?.summary ?? result.error },
          result: result.ok ? 'SUCCESS' : 'ERROR',
        });
        if (!result.ok) {
          res.status(result.status).json({ error: result.error, code: (result as { code?: string }).code });
          return;
        }
        res.json({ ok: true, job: result.job, run: result.run });
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/jobs/:id/cancel',
    requirePermission(PERMISSIONS.ADMIN_JOBS_MANAGE),
    async (req: RbacAuthenticatedRequest, res, next) => {
      try {
        const actor = buildActor(req);
        const result = await jobManager.cancelJob(req.params.id);
        await adminService.writeAuditLog({
          actor,
          action: 'BACKGROUND_JOB_CANCEL',
          resourceType: 'background_job',
          resourceId: req.params.id,
          result: result.ok ? 'SUCCESS' : 'ERROR',
        });
        if (!result.ok) {
          res.status(result.status).json({ error: result.error });
          return;
        }
        res.json({ ok: true, job: result.job });
      } catch (err) {
        next(err);
      }
    },
  );

  // ---- SYSTEM CONFIGURATION & EMERGENCY OPERATIONS ----
  router.get(
    '/config',
    requirePermission(PERMISSIONS.ADMIN_SYSTEM_READ),
    async (_req, res, next) => {
      try {
        const data = await adminService.getSystemConfig();
        res.json({ ok: true, ...data });
      } catch (err) {
        next(err);
      }
    },
  );

  router.patch(
    '/config',
    requirePermission(PERMISSIONS.ADMIN_SYSTEM_MANAGE),
    async (req: RbacAuthenticatedRequest, res, next) => {
      try {
        const out = await adminService.updateSystemConfig(buildActor(req), {
          key: req.body?.key,
          value: req.body?.value,
          reason: req.body?.reason,
        });
        if (!out.ok) {
          res.status(out.status).json({ error: out.error, code: out.code });
          return;
        }
        res.json({ ok: true, ...out.data });
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/config/rollback',
    requirePermission(PERMISSIONS.ADMIN_SYSTEM_MANAGE),
    async (req: RbacAuthenticatedRequest, res, next) => {
      try {
        if (!(await enforceReauth(req, res))) return;
        const auditId = typeof req.body?.auditId === 'string' ? req.body.auditId : '';
        const out = await adminService.rollbackConfigAudit(buildActor(req), auditId);
        if (!out.ok) {
          res.status(out.status).json({ error: out.error, code: out.code });
          return;
        }
        res.json({ ok: true, ...out.data });
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/emergency',
    requirePermission(PERMISSIONS.ADMIN_EMERGENCY_EXECUTE),
    async (req: RbacAuthenticatedRequest, res, next) => {
      try {
        if (!(await enforceReauth(req, res))) return;
        const out = await adminService.executeEmergencyOperation(
          buildActor(req),
          req.body?.operation,
          typeof req.body?.reason === 'string' ? req.body.reason : '',
        );
        if (!out.ok) {
          res.status(out.status).json({ error: out.error, code: out.code });
          return;
        }
        res.json({ ok: true, ...out.data });
      } catch (err) {
        next(err);
      }
    },
  );

  // ---- APPEND-ONLY AUDIT LOGS ----
  router.get(
    '/audit-logs',
    requirePermission(PERMISSIONS.ADMIN_AUDIT_READ),
    async (req, res, next) => {
      try {
        const data = await adminService.listAuditLogs({
          search: typeof req.query.search === 'string' ? req.query.search : undefined,
          action: typeof req.query.action === 'string' ? req.query.action : undefined,
          resourceType:
            typeof req.query.resourceType === 'string' ? req.query.resourceType : undefined,
          result: typeof req.query.result === 'string' ? req.query.result : undefined,
          limit: Number(req.query.limit) || 30,
          offset: Number(req.query.offset) || 0,
        });
        res.json({ ok: true, ...data });
      } catch (err) {
        next(err);
      }
    },
  );

  router.get(
    '/audit-logs/export',
    requirePermission(PERMISSIONS.ADMIN_AUDIT_READ),
    async (req: RbacAuthenticatedRequest, res, next) => {
      try {
        const csv = await adminService.exportAuditLogsCsv(buildActor(req));
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="nextrade-audit-logs.csv"');
        res.send(csv);
      } catch (err) {
        next(err);
      }
    },
  );

  router.all('/audit-logs*', (_req: Request, res: Response) => {
    res.status(405).json({
      error: 'Audit logs are strictly append-only and cannot be modified or deleted.',
      code: 'AUDIT_LOGS_IMMUTABLE',
    });
  });

  // ---- ANNOUNCEMENTS & SUPPORT ----
  router.get(
    '/announcements',
    requirePermission(PERMISSIONS.ADMIN_ANNOUNCEMENTS_READ),
    async (_req, res, next) => {
      try {
        const announcements = await adminService.listAnnouncements();
        res.json({ ok: true, announcements });
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/announcements',
    requirePermission(PERMISSIONS.ADMIN_ANNOUNCEMENTS_MANAGE),
    async (req: RbacAuthenticatedRequest, res, next) => {
      try {
        const out = await adminService.createAnnouncement(buildActor(req), req.body ?? {});
        if (!out.ok) {
          res.status(out.status).json({ error: out.error, code: out.code });
          return;
        }
        res.status(out.status).json({ ok: true, ...out.data });
      } catch (err) {
        next(err);
      }
    },
  );

  router.patch(
    '/announcements/:id',
    requirePermission(PERMISSIONS.ADMIN_ANNOUNCEMENTS_MANAGE),
    async (req: RbacAuthenticatedRequest, res, next) => {
      try {
        const out = await adminService.updateAnnouncement(
          buildActor(req),
          req.params.id,
          req.body ?? {},
        );
        if (!out.ok) {
          res.status(out.status).json({ error: out.error, code: out.code });
          return;
        }
        res.json({ ok: true, ...out.data });
      } catch (err) {
        next(err);
      }
    },
  );

  router.delete(
    '/announcements/:id',
    requirePermission(PERMISSIONS.ADMIN_ANNOUNCEMENTS_MANAGE),
    async (req: RbacAuthenticatedRequest, res, next) => {
      try {
        const out = await adminService.deleteAnnouncement(buildActor(req), req.params.id);
        if (!out.ok) {
          res.status(out.status).json({ error: out.error, code: out.code });
          return;
        }
        res.json({ ok: true, ...out.data });
      } catch (err) {
        next(err);
      }
    },
  );

  router.get(
    '/support',
    requirePermission(PERMISSIONS.ADMIN_SUPPORT_READ),
    async (req, res, next) => {
      try {
        const data = await adminService.listSupportTickets({
          status: typeof req.query.status === 'string' ? req.query.status : undefined,
          search: typeof req.query.search === 'string' ? req.query.search : undefined,
          limit: Number(req.query.limit) || 30,
          offset: Number(req.query.offset) || 0,
        });
        res.json({ ok: true, ...data });
      } catch (err) {
        next(err);
      }
    },
  );

  router.patch(
    '/support/:id',
    requirePermission(PERMISSIONS.ADMIN_SUPPORT_MANAGE),
    async (req: RbacAuthenticatedRequest, res, next) => {
      try {
        const out = await adminService.updateSupportTicket(
          buildActor(req),
          req.params.id,
          req.body ?? {},
        );
        if (!out.ok) {
          res.status(out.status).json({ error: out.error, code: out.code });
          return;
        }
        res.json({ ok: true, ...out.data });
      } catch (err) {
        next(err);
      }
    },
  );

  // ---- PHASE 4: PLATFORM INTELLIGENCE & OBSERVABILITY ----
  router.get(
    '/observability/overview',
    requirePermission(PERMISSIONS.ADMIN_CONSOLE_READ),
    async (req, res, next) => {
      try {
        const data = await adminService.observability.getObservabilityOverview({
          range: req.query.range,
          from: req.query.from,
          to: req.query.to,
        });
        res.json({ ok: true, ...data });
      } catch (err) {
        next(err);
      }
    },
  );

  router.get(
    '/observability/api',
    requirePermission(PERMISSIONS.ADMIN_APIS_READ),
    async (req, res, next) => {
      try {
        const data = await adminService.observability.getObservabilityApi({
          range: req.query.range,
          from: req.query.from,
          to: req.query.to,
          endpoint: typeof req.query.endpoint === 'string' ? req.query.endpoint : undefined,
          method: typeof req.query.method === 'string' ? req.query.method : undefined,
          statusCode: typeof req.query.statusCode === 'string' ? req.query.statusCode : undefined,
          limit: Number(req.query.limit) || 30,
          offset: Number(req.query.offset) || 0,
        });
        res.json({ ok: true, ...data });
      } catch (err) {
        next(err);
      }
    },
  );

  router.get(
    '/observability/ai',
    requirePermission(PERMISSIONS.ADMIN_AI_READ),
    async (req, res, next) => {
      try {
        const data = await adminService.observability.getObservabilityAi({
          range: req.query.range,
          from: req.query.from,
          to: req.query.to,
          status: typeof req.query.status === 'string' ? req.query.status : undefined,
          model: typeof req.query.model === 'string' ? req.query.model : undefined,
          limit: Number(req.query.limit) || 40,
          offset: Number(req.query.offset) || 0,
        });
        res.json({ ok: true, ...data });
      } catch (err) {
        next(err);
      }
    },
  );

  router.get(
    '/observability/ai/requests/:id/inspect',
    requirePermission(PERMISSIONS.ADMIN_AI_INSPECT_SENSITIVE),
    async (req: RbacAuthenticatedRequest, res, next) => {
      try {
        const out = await adminService.observability.inspectSensitiveAiRequest(
          buildActor(req),
          req.params.id,
        );
        if (!out.ok) {
          res.status(out.status).json({ error: out.error, code: out.code });
          return;
        }
        res.json({ ok: true, request: out.data });
      } catch (err) {
        next(err);
      }
    },
  );

  router.get(
    '/observability/market-data',
    requirePermission(PERMISSIONS.ADMIN_MARKETS_READ),
    async (req, res, next) => {
      try {
        const data = await adminService.observability.getObservabilityMarketData(
          Number(req.query.limit) || 25,
        );
        res.json({ ok: true, ...data });
      } catch (err) {
        next(err);
      }
    },
  );

  router.get(
    '/observability/jobs',
    requirePermission(PERMISSIONS.ADMIN_JOBS_READ),
    async (_req, res, next) => {
      try {
        const data = await adminService.observability.getObservabilityJobs();
        res.json({ ok: true, ...data });
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/jobs/queue/pause',
    requirePermission(PERMISSIONS.ADMIN_JOBS_MANAGE),
    async (req: RbacAuthenticatedRequest, res, next) => {
      try {
        const actor = buildActor(req);
        const { workerHeartbeat } = await jobManager.setQueuePaused(true);
        await adminService.writeAuditLog({
          actor,
          action: 'JOB_QUEUE_PAUSE',
          resourceType: 'worker_heartbeat',
          resourceId: workerHeartbeat.workerId,
          newValue: { queuePaused: true },
        });
        res.json({ ok: true, workerHeartbeat });
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/jobs/queue/resume',
    requirePermission(PERMISSIONS.ADMIN_JOBS_MANAGE),
    async (req: RbacAuthenticatedRequest, res, next) => {
      try {
        const actor = buildActor(req);
        const { workerHeartbeat } = await jobManager.setQueuePaused(false);
        await adminService.writeAuditLog({
          actor,
          action: 'JOB_QUEUE_RESUME',
          resourceType: 'worker_heartbeat',
          resourceId: workerHeartbeat.workerId,
          newValue: { queuePaused: false },
        });
        res.json({ ok: true, workerHeartbeat });
      } catch (err) {
        next(err);
      }
    },
  );

  router.get(
    '/observability/security',
    requirePermission(PERMISSIONS.ADMIN_SECURITY_READ),
    async (req, res, next) => {
      try {
        const data = await adminService.observability.getObservabilitySecurity({
          range: req.query.range,
          from: req.query.from,
          to: req.query.to,
          severity: typeof req.query.severity === 'string' ? req.query.severity : undefined,
          eventType: typeof req.query.eventType === 'string' ? req.query.eventType : undefined,
          userId: typeof req.query.userId === 'string' ? req.query.userId : undefined,
          limit: Number(req.query.limit) || 40,
          offset: Number(req.query.offset) || 0,
        });
        res.json({ ok: true, ...data });
      } catch (err) {
        next(err);
      }
    },
  );

  // ---- PHASE 4: OPERATIONAL ALERTS & THRESHOLDS ----
  router.get(
    '/alerts',
    requirePermission(PERMISSIONS.ADMIN_ALERTS_READ),
    async (req, res, next) => {
      try {
        const data = await adminService.observability.listAlerts({
          status: typeof req.query.status === 'string' ? req.query.status : undefined,
          severity: typeof req.query.severity === 'string' ? req.query.severity : undefined,
          category: typeof req.query.category === 'string' ? req.query.category : undefined,
          limit: Number(req.query.limit) || 40,
          offset: Number(req.query.offset) || 0,
        });
        res.json({ ok: true, ...data });
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/alerts/evaluate',
    requirePermission(PERMISSIONS.ADMIN_ALERTS_MANAGE),
    async (req: RbacAuthenticatedRequest, res, next) => {
      try {
        const actor = buildActor(req);
        const result = await adminService.observability.evaluateAlerts(actor);
        await adminService.writeAuditLog({
          actor,
          action: 'ALERTS_EVALUATE_MANUAL',
          resourceType: 'operational_alert',
          newValue: {
            candidatesDetected: result.candidatesDetected,
            createdCount: result.createdCount,
            updatedCount: result.updatedCount,
          },
        });
        res.json({ ok: true, ...result });
      } catch (err) {
        next(err);
      }
    },
  );

  router.get(
    '/alerts/thresholds',
    requirePermission(PERMISSIONS.ADMIN_ALERTS_READ),
    async (_req, res, next) => {
      try {
        const thresholds = await adminService.observability.getThresholdsConfig();
        res.json({ ok: true, thresholds });
      } catch (err) {
        next(err);
      }
    },
  );

  router.patch(
    '/alerts/thresholds',
    requirePermission(PERMISSIONS.ADMIN_ALERTS_MANAGE),
    async (req: RbacAuthenticatedRequest, res, next) => {
      try {
        const out = await adminService.observability.updateThresholdsConfig(
          buildActor(req),
          req.body ?? {},
        );
        if (!out.ok) {
          res.status(out.status).json({ error: out.error, code: out.code });
          return;
        }
        res.json({ ok: true, ...out.data });
      } catch (err) {
        next(err);
      }
    },
  );

  router.get(
    '/alerts/:id',
    requirePermission(PERMISSIONS.ADMIN_ALERTS_READ),
    async (req, res, next) => {
      try {
        const out = await adminService.observability.getAlertDetail(req.params.id);
        if (!out.ok) {
          res.status(out.status).json({ error: out.error, code: out.code });
          return;
        }
        res.json({ ok: true, ...out.data });
      } catch (err) {
        next(err);
      }
    },
  );

  router.patch(
    '/alerts/:id',
    requirePermission(PERMISSIONS.ADMIN_ALERTS_MANAGE),
    async (req: RbacAuthenticatedRequest, res, next) => {
      try {
        const out = await adminService.observability.updateAlertStatus(
          buildActor(req),
          req.params.id,
          req.body ?? {},
        );
        if (!out.ok) {
          res.status(out.status).json({ error: out.error, code: out.code });
          return;
        }
        res.json({ ok: true, ...out.data });
      } catch (err) {
        next(err);
      }
    },
  );

  // ---- PHASE 4: INCIDENT MANAGEMENT & TIMELINES ----
  router.get(
    '/incidents',
    requirePermission(PERMISSIONS.ADMIN_INCIDENTS_READ),
    async (req, res, next) => {
      try {
        const data = await adminService.observability.listIncidents({
          status: typeof req.query.status === 'string' ? req.query.status : undefined,
          severity: typeof req.query.severity === 'string' ? req.query.severity : undefined,
          limit: Number(req.query.limit) || 40,
          offset: Number(req.query.offset) || 0,
        });
        res.json({ ok: true, ...data });
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/incidents',
    requirePermission(PERMISSIONS.ADMIN_INCIDENTS_MANAGE),
    async (req: RbacAuthenticatedRequest, res, next) => {
      try {
        const out = await adminService.observability.createIncident(buildActor(req), req.body ?? {});
        if (!out.ok) {
          res.status(out.status).json({ error: out.error, code: out.code });
          return;
        }
        res.status(out.status).json({ ok: true, ...out.data });
      } catch (err) {
        next(err);
      }
    },
  );

  router.get(
    '/incidents/:id',
    requirePermission(PERMISSIONS.ADMIN_INCIDENTS_READ),
    async (req, res, next) => {
      try {
        const out = await adminService.observability.getIncidentDetail(req.params.id);
        if (!out.ok) {
          res.status(out.status).json({ error: out.error, code: out.code });
          return;
        }
        res.json({ ok: true, ...out.data });
      } catch (err) {
        next(err);
      }
    },
  );

  router.patch(
    '/incidents/:id',
    requirePermission(PERMISSIONS.ADMIN_INCIDENTS_MANAGE),
    async (req: RbacAuthenticatedRequest, res, next) => {
      try {
        const out = await adminService.observability.updateIncident(
          buildActor(req),
          req.params.id,
          req.body ?? {},
        );
        if (!out.ok) {
          res.status(out.status).json({ error: out.error, code: out.code });
          return;
        }
        res.json({ ok: true, ...out.data });
      } catch (err) {
        next(err);
      }
    },
  );

  // ---- PHASE 5: USER & ORGANIZATION LIFECYCLE MANAGEMENT ----
  router.get(
    '/users/:id/lifecycle',
    requirePermission(PERMISSIONS.ADMIN_USERS_READ),
    async (req, res, next) => {
      try {
        const out = await adminService.governance.getUserLifecycleDetail(req.params.id);
        if (!out.ok) {
          res.status(out.status).json({ error: out.error, code: out.code });
          return;
        }
        res.json({ ok: true, lifecycle: out.data });
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/users/:id/notes',
    requirePermission(PERMISSIONS.ADMIN_USERS_LIFECYCLE),
    async (req: RbacAuthenticatedRequest, res, next) => {
      try {
        const out = await adminService.governance.addUserAdminNote(
          buildActor(req),
          req.params.id,
          req.body?.note,
        );
        if (!out.ok) {
          res.status(out.status).json({ error: out.error, code: out.code });
          return;
        }
        res.status(out.status).json({ ok: true, ...out.data });
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/users/:id/lifecycle/deletion',
    requirePermission(PERMISSIONS.ADMIN_USERS_LIFECYCLE),
    async (req: RbacAuthenticatedRequest, res, next) => {
      try {
        if (req.body?.mode === 'anonymize_now') {
          if (!(await enforceReauth(req, res))) return;
        }
        const out = await adminService.governance.initiateDeletionWorkflow(
          buildActor(req),
          req.params.id,
          req.body ?? {},
        );
        if (!out.ok) {
          res.status(out.status).json({ error: out.error, code: out.code });
          return;
        }
        res.status(out.status).json({ ok: true, ...out.data });
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/users/:id/lifecycle/deletion/cancel',
    requirePermission(PERMISSIONS.ADMIN_USERS_LIFECYCLE),
    async (req: RbacAuthenticatedRequest, res, next) => {
      try {
        const out = await adminService.governance.cancelUserDeletionWorkflow(
          buildActor(req),
          req.params.id,
          typeof req.body?.reason === 'string' ? req.body.reason : undefined,
        );
        if (!out.ok) {
          res.status(out.status).json({ error: out.error, code: out.code });
          return;
        }
        res.json({ ok: true, ...out.data });
      } catch (err) {
        next(err);
      }
    },
  );

  // ---- PHASE 5: DATA GOVERNANCE & PRIVACY CENTRE ----
  router.get(
    '/privacy/requests',
    requirePermission(PERMISSIONS.ADMIN_PRIVACY_READ),
    async (_req, res, next) => {
      try {
        const data = await adminService.governance.listAdminPrivacyQueue();
        res.json({ ok: true, ...data });
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/privacy/exports/:id/process',
    requirePermission(PERMISSIONS.ADMIN_PRIVACY_MANAGE),
    async (req: RbacAuthenticatedRequest, res, next) => {
      try {
        const out = await adminService.governance.processExportRequest(
          buildActor(req),
          req.params.id,
          typeof req.body?.note === 'string' ? req.body.note : undefined,
        );
        if (!out.ok) {
          res.status(out.status).json({ error: out.error, code: out.code });
          return;
        }
        res.json({ ok: true, ...out.data });
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/privacy/exports/:id/approve',
    requirePermission(PERMISSIONS.ADMIN_PRIVACY_MANAGE),
    async (req: RbacAuthenticatedRequest, res, next) => {
      try {
        const out = await adminService.governance.processExportRequest(
          buildActor(req),
          req.params.id,
          typeof req.body?.note === 'string' ? req.body.note : 'Approved by administrator',
        );
        if (!out.ok) {
          res.status(out.status).json({ error: out.error, code: out.code });
          return;
        }
        res.json({ ok: true, ...out.data });
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/privacy/exports/:id/reject',
    requirePermission(PERMISSIONS.ADMIN_PRIVACY_MANAGE),
    async (req: RbacAuthenticatedRequest, res, next) => {
      try {
        const out = await adminService.governance.rejectExportRequest(
          buildActor(req),
          req.params.id,
          typeof req.body?.reason === 'string' ? req.body.reason : undefined,
        );
        if (!out.ok) {
          res.status(out.status).json({ error: out.error, code: out.code });
          return;
        }
        res.json({ ok: true, ...out.data });
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/privacy/deletions/:id/action',
    requirePermission(PERMISSIONS.ADMIN_PRIVACY_MANAGE),
    async (req: RbacAuthenticatedRequest, res, next) => {
      try {
        const rawAction = typeof req.body?.action === 'string' ? req.body.action.toUpperCase() : '';
        if (rawAction !== 'SCHEDULE' && rawAction !== 'COMPLETE' && rawAction !== 'REJECT' && rawAction !== 'CANCEL') {
          res.status(400).json({ error: 'Invalid deletion action. Use SCHEDULE, COMPLETE, CANCEL, or REJECT.' });
          return;
        }
        if (rawAction === 'COMPLETE') {
          if (!(await enforceReauth(req, res))) return;
        }
        const out = await adminService.governance.handleAdminDeletionAction(
          buildActor(req),
          req.params.id,
          rawAction,
          { graceDays: req.body?.graceDays, reason: req.body?.reason },
        );
        if (!out.ok) {
          res.status(out.status).json({ error: out.error, code: out.code });
          return;
        }
        res.json({ ok: true, ...out.data });
      } catch (err) {
        next(err);
      }
    },
  );

  // ---- PHASE 5: BACKUP & DISASTER RECOVERY ----
  router.get(
    '/backups',
    requirePermission(PERMISSIONS.ADMIN_BACKUP_READ),
    async (_req, res, next) => {
      try {
        const data = await adminService.governance.listBackupsOverview();
        res.json({ ok: true, ...data });
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/backups',
    requirePermission(PERMISSIONS.ADMIN_BACKUP_CREATE),
    async (req: RbacAuthenticatedRequest, res, next) => {
      try {
        const out = await adminService.governance.createBackup(
          buildActor(req),
          req.body?.backupType,
        );
        if (!out.ok) {
          res.status(out.status).json({ error: out.error, code: out.code });
          return;
        }
        res.status(out.status).json({ ok: true, ...out.data });
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/backups/:id/verify',
    requirePermission(PERMISSIONS.ADMIN_BACKUP_CREATE),
    async (req: RbacAuthenticatedRequest, res, next) => {
      try {
        const out = await adminService.governance.verifyBackup(buildActor(req), req.params.id);
        if (!out.ok) {
          res.status(out.status).json({ error: out.error, code: out.code });
          return;
        }
        res.json({ ok: true, ...out.data });
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/backups/:id/restore',
    requirePermission(PERMISSIONS.ADMIN_BACKUP_RESTORE),
    async (req: RbacAuthenticatedRequest, res, next) => {
      try {
        if (!(await enforceReauth(req, res))) return;
        const out = await adminService.governance.restoreBackup(
          buildActor(req),
          req.params.id,
          req.body?.confirmPhrase,
        );
        if (!out.ok) {
          res.status(out.status).json({ error: out.error, code: out.code });
          return;
        }
        res.json({ ok: true, ...out.data });
      } catch (err) {
        next(err);
      }
    },
  );

  // ---- PHASE 5: FEATURE FLAGS & CONTROLLED ROLLOUTS ----
  router.get(
    '/features',
    requirePermission(PERMISSIONS.ADMIN_FEATURES_READ),
    async (_req, res, next) => {
      try {
        const data = await adminService.governance.listFeatureFlagsOverview();
        res.json({ ok: true, ...data });
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/features',
    requirePermission(PERMISSIONS.ADMIN_FEATURES_MANAGE),
    async (req: RbacAuthenticatedRequest, res, next) => {
      try {
        const out = await adminService.governance.createFeatureFlag(
          buildActor(req),
          req.body ?? {},
        );
        if (!out.ok) {
          res.status(out.status).json({ error: out.error, code: out.code });
          return;
        }
        res.status(out.status).json({ ok: true, ...out.data });
      } catch (err) {
        next(err);
      }
    },
  );

  router.patch(
    '/features/:id',
    requirePermission(PERMISSIONS.ADMIN_FEATURES_MANAGE),
    async (req: RbacAuthenticatedRequest, res, next) => {
      try {
        const out = await adminService.governance.updateFeatureFlag(
          buildActor(req),
          req.params.id,
          req.body ?? {},
        );
        if (!out.ok) {
          res.status(out.status).json({ error: out.error, code: out.code });
          return;
        }
        res.json({ ok: true, ...out.data });
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/features/rollback/:historyId',
    requirePermission(PERMISSIONS.ADMIN_FEATURES_MANAGE),
    async (req: RbacAuthenticatedRequest, res, next) => {
      try {
        const out = await adminService.governance.rollbackFeatureFlag(
          buildActor(req),
          req.params.historyId,
        );
        if (!out.ok) {
          res.status(out.status).json({ error: out.error, code: out.code });
          return;
        }
        res.json({ ok: true, ...out.data });
      } catch (err) {
        next(err);
      }
    },
  );

  // ---- PHASE 5: RELEASE & MAINTENANCE MANAGEMENT ----
  router.get(
    '/releases',
    requirePermission(PERMISSIONS.ADMIN_RELEASES_READ),
    async (_req, res, next) => {
      try {
        const data = await adminService.governance.getReleasesAndMaintenanceOverview();
        res.json({ ok: true, ...data });
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/releases',
    requirePermission(PERMISSIONS.ADMIN_RELEASES_MANAGE),
    async (req: RbacAuthenticatedRequest, res, next) => {
      try {
        const out = await adminService.governance.createManualRelease(
          buildActor(req),
          req.body ?? {},
        );
        if (!out.ok) {
          res.status(out.status).json({ error: out.error, code: out.code });
          return;
        }
        res.status(out.status).json({ ok: true, ...out.data });
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/maintenance-windows',
    requirePermission(PERMISSIONS.ADMIN_MAINTENANCE_MANAGE),
    async (req: RbacAuthenticatedRequest, res, next) => {
      try {
        const out = await adminService.governance.createMaintenanceWindow(
          buildActor(req),
          req.body ?? {},
        );
        if (!out.ok) {
          res.status(out.status).json({ error: out.error, code: out.code });
          return;
        }
        res.status(out.status).json({ ok: true, ...out.data });
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/maintenance-windows/:id/:action',
    requirePermission(PERMISSIONS.ADMIN_MAINTENANCE_MANAGE),
    async (req: RbacAuthenticatedRequest, res, next) => {
      try {
        const act = req.params.action.toUpperCase();
        if (act !== 'ACTIVATE' && act !== 'COMPLETE' && act !== 'CANCEL') {
          res.status(400).json({ error: 'Invalid maintenance window action. Use activate, complete, or cancel.' });
          return;
        }
        const out = await adminService.governance.updateMaintenanceWindow(
          buildActor(req),
          req.params.id,
          act,
        );
        if (!out.ok) {
          res.status(out.status).json({ error: out.error, code: out.code });
          return;
        }
        res.json({ ok: true, ...out.data });
      } catch (err) {
        next(err);
      }
    },
  );

  // ---- PHASE 5: PLATFORM CONFIGURATION GOVERNANCE (10 CATEGORIES) ----
  router.get(
    '/config/governance',
    requirePermission(PERMISSIONS.ADMIN_SYSTEM_READ),
    async (_req, res, next) => {
      try {
        const data = await adminService.governance.getTenCategoryGovernanceConfig();
        res.json({ ok: true, ...data });
      } catch (err) {
        next(err);
      }
    },
  );

  router.patch(
    '/config/governance',
    requirePermission(PERMISSIONS.ADMIN_SYSTEM_MANAGE),
    async (req: RbacAuthenticatedRequest, res, next) => {
      try {
        if (!(await enforceReauth(req, res))) return;
        const out = await adminService.governance.updateGovernancePolicies(
          buildActor(req),
          req.body?.policies ?? req.body ?? {},
          typeof req.body?.reason === 'string' ? req.body.reason : 'Governance policy update',
        );
        if (!out.ok) {
          res.status(out.status).json({ error: out.error, code: out.code });
          return;
        }
        res.json({ ok: true, ...out.data });
      } catch (err) {
        next(err);
      }
    },
  );

  // ---- PHASE 5: COMPLIANCE & GOVERNANCE REPORTING ----
  router.get(
    '/governance/report',
    requirePermission(PERMISSIONS.ADMIN_GOVERNANCE_READ),
    async (req, res, next) => {
      try {
        const data = await adminService.governance.getGovernanceReport({
          category: typeof req.query.category === 'string' ? req.query.category : undefined,
          actor: typeof req.query.actor === 'string' ? req.query.actor : undefined,
          from: typeof req.query.from === 'string' ? req.query.from : undefined,
          to: typeof req.query.to === 'string' ? req.query.to : undefined,
          limit: Number(req.query.limit) || 100,
        });
        res.json({ ok: true, ...data });
      } catch (err) {
        next(err);
      }
    },
  );

  router.get(
    '/governance/export',
    requirePermission(PERMISSIONS.ADMIN_GOVERNANCE_EXPORT),
    async (req: RbacAuthenticatedRequest, res, next) => {
      try {
        const csv = await adminService.governance.exportGovernanceCsv(buildActor(req), {
          category: typeof req.query.category === 'string' ? req.query.category : undefined,
          actor: typeof req.query.actor === 'string' ? req.query.actor : undefined,
          from: typeof req.query.from === 'string' ? req.query.from : undefined,
          to: typeof req.query.to === 'string' ? req.query.to : undefined,
        });
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="nextrade-governance-events.csv"');
        res.send(csv);
      } catch (err) {
        next(err);
      }
    },
  );

  // ---- PHASE 6: UNIFIED SUPER ADMIN COMMAND CENTRE ----
  router.get(
    '/super-control',
    requirePermission(PERMISSIONS.ADMIN_SUPER_CONTROL_READ),
    async (_req, res, next) => {
      try {
        const data = await adminService.superOps.getSuperControlOverview();
        res.json({ ok: true, ...data });
      } catch (err) {
        next(err);
      }
    },
  );

  // ---- PHASE 6: GOVERNED AUTOMATION ENGINE ----
  router.get(
    '/automation',
    requirePermission(PERMISSIONS.ADMIN_AUTOMATION_READ),
    async (_req, res, next) => {
      try {
        const data = await adminService.superOps.listAutomationOverview();
        res.json({ ok: true, ...data });
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/automation/workflows',
    requirePermission(PERMISSIONS.ADMIN_AUTOMATION_MANAGE),
    async (req: RbacAuthenticatedRequest, res, next) => {
      try {
        const out = await adminService.superOps.createWorkflow(buildActor(req), req.body ?? {});
        if (!out.ok) {
          res.status(out.status).json({ error: out.error, code: out.code });
          return;
        }
        res.status(out.status).json({ ok: true, ...out.data });
      } catch (err) {
        next(err);
      }
    },
  );

  router.patch(
    '/automation/workflows/:id/state',
    requirePermission(PERMISSIONS.ADMIN_AUTOMATION_MANAGE),
    async (req: RbacAuthenticatedRequest, res, next) => {
      try {
        const out = await adminService.superOps.updateWorkflowState(
          buildActor(req),
          req.params.id,
          req.body ?? {},
        );
        if (!out.ok) {
          res.status(out.status).json({ error: out.error, code: out.code });
          return;
        }
        res.json({ ok: true, ...out.data });
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/automation/kill-switch',
    requirePermission(PERMISSIONS.ADMIN_AUTOMATION_MANAGE),
    async (req: RbacAuthenticatedRequest, res, next) => {
      try {
        if (!(await enforceReauth(req, res))) return;
        const out = await adminService.superOps.setAutomationKillSwitch(
          buildActor(req),
          Boolean(req.body?.active),
          typeof req.body?.reason === 'string' ? req.body.reason : '',
        );
        if (!out.ok) {
          res.status(out.status).json({ error: out.error, code: out.code });
          return;
        }
        res.json({ ok: true, ...out.data });
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/automation/workflows/:id/execute',
    requirePermission(PERMISSIONS.ADMIN_AUTOMATION_EXECUTE),
    async (req: RbacAuthenticatedRequest, res, next) => {
      try {
        const out = await adminService.superOps.executeWorkflow(buildActor(req), req.params.id, {
          idempotencyKey: req.body?.idempotencyKey,
          triggerSource: typeof req.body?.triggerSource === 'string' ? req.body.triggerSource : 'manual',
        });
        if (!out.ok) {
          res.status(out.status).json({ error: out.error, code: out.code });
          return;
        }
        res.status(out.status).json({ ok: true, ...out.data });
      } catch (err) {
        next(err);
      }
    },
  );

  // ---- PHASE 6: PRIVILEGED ACCESS GOVERNANCE & APPROVAL WORKFLOWS ----
  router.get(
    '/access-reviews',
    requirePermission(PERMISSIONS.ADMIN_ACCESS_REVIEW_READ),
    async (_req, res, next) => {
      try {
        const data = await adminService.superOps.listAccessGovernanceOverview();
        res.json({ ok: true, ...data });
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/access-reviews',
    requirePermission(PERMISSIONS.ADMIN_ACCESS_REVIEW_MANAGE),
    async (req: RbacAuthenticatedRequest, res, next) => {
      try {
        const out = await adminService.superOps.submitAccessReview(buildActor(req), req.body ?? {});
        if (!out.ok) {
          res.status(out.status).json({ error: out.error, code: out.code });
          return;
        }
        res.status(out.status).json({ ok: true, ...out.data });
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/privileged-requests',
    requirePermission(PERMISSIONS.ADMIN_PRIVILEGED_ACTIONS_REQUEST),
    async (req: RbacAuthenticatedRequest, res, next) => {
      try {
        const out = await adminService.superOps.createPrivilegedActionRequest(
          buildActor(req),
          req.body ?? {},
        );
        if (!out.ok) {
          res.status(out.status).json({ error: out.error, code: out.code });
          return;
        }
        res.status(out.status).json({ ok: true, ...out.data });
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/privileged-requests/:id/decide',
    requirePermission(PERMISSIONS.ADMIN_PRIVILEGED_ACTIONS_APPROVE),
    async (req: RbacAuthenticatedRequest, res, next) => {
      try {
        if (!(await enforceReauth(req, res))) return;
        const out = await adminService.superOps.decidePrivilegedActionRequest(
          buildActor(req),
          req.params.id,
          req.body ?? {},
        );
        if (!out.ok) {
          res.status(out.status).json({ error: out.error, code: out.code });
          return;
        }
        res.json({ ok: true, ...out.data });
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/privileged-requests/:id/execute',
    requirePermission(PERMISSIONS.ADMIN_PRIVILEGED_ACTIONS_APPROVE),
    async (req: RbacAuthenticatedRequest, res, next) => {
      try {
        if (!(await enforceReauth(req, res))) return;
        const out = await adminService.superOps.executePrivilegedActionRequest(
          buildActor(req),
          req.params.id,
        );
        if (!out.ok) {
          res.status(out.status).json({ error: out.error, code: out.code });
          return;
        }
        res.json({ ok: true, ...out.data });
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/emergency-access/grant',
    requirePermission(PERMISSIONS.ADMIN_EMERGENCY_MANAGE),
    async (req: RbacAuthenticatedRequest, res, next) => {
      try {
        if (!(await enforceReauth(req, res))) return;
        const out = await adminService.superOps.grantEmergencyAccess(
          buildActor(req),
          req.body ?? {},
        );
        if (!out.ok) {
          res.status(out.status).json({ error: out.error, code: out.code });
          return;
        }
        res.status(out.status).json({ ok: true, ...out.data });
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/emergency-access/:id/:mode',
    requirePermission(PERMISSIONS.ADMIN_ACCESS_REVIEW_MANAGE),
    async (req: RbacAuthenticatedRequest, res, next) => {
      try {
        const mode = req.params.mode.toUpperCase();
        if (mode !== 'REVOKE' && mode !== 'REVIEW') {
          res.status(400).json({ error: 'Emergency access action mode must be revoke or review.' });
          return;
        }
        if (mode === 'REVOKE' && !(await enforceReauth(req, res))) return;
        const out = await adminService.superOps.revokeOrReviewEmergencyGrant(
          buildActor(req),
          req.params.id,
          mode,
          typeof req.body?.note === 'string' ? req.body.note : '',
        );
        if (!out.ok) {
          res.status(out.status).json({ error: out.error, code: out.code });
          return;
        }
        res.json({ ok: true, ...out.data });
      } catch (err) {
        next(err);
      }
    },
  );

  // ---- PHASE 6: AI OPERATIONS GOVERNANCE ----
  router.get(
    '/ai-policies',
    requirePermission(PERMISSIONS.ADMIN_AI_POLICY_READ),
    async (_req, res, next) => {
      try {
        const data = await adminService.superOps.listAiPolicyOverview();
        res.json({ ok: true, ...data });
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/ai-policies',
    requirePermission(PERMISSIONS.ADMIN_AI_POLICY_MANAGE),
    async (req: RbacAuthenticatedRequest, res, next) => {
      try {
        const out = await adminService.superOps.createAiPolicyVersion(
          buildActor(req),
          req.body ?? {},
        );
        if (!out.ok) {
          res.status(out.status).json({ error: out.error, code: out.code });
          return;
        }
        res.status(out.status).json({ ok: true, ...out.data });
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/ai-policies/:id/activate',
    requirePermission(PERMISSIONS.ADMIN_AI_POLICY_MANAGE),
    async (req: RbacAuthenticatedRequest, res, next) => {
      try {
        if (!(await enforceReauth(req, res))) return;
        const out = await adminService.superOps.activateOrRollbackAiPolicy(
          buildActor(req),
          req.params.id,
          false,
        );
        if (!out.ok) {
          res.status(out.status).json({ error: out.error, code: out.code });
          return;
        }
        res.json({ ok: true, ...out.data });
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/ai-policies/:id/rollback',
    requirePermission(PERMISSIONS.ADMIN_AI_POLICY_MANAGE),
    async (req: RbacAuthenticatedRequest, res, next) => {
      try {
        if (!(await enforceReauth(req, res))) return;
        const out = await adminService.superOps.activateOrRollbackAiPolicy(
          buildActor(req),
          req.params.id,
          true,
        );
        if (!out.ok) {
          res.status(out.status).json({ error: out.error, code: out.code });
          return;
        }
        res.json({ ok: true, ...out.data });
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/ai-policies/emergency-control',
    requirePermission(PERMISSIONS.ADMIN_AI_POLICY_MANAGE),
    async (req: RbacAuthenticatedRequest, res, next) => {
      try {
        if (!(await enforceReauth(req, res))) return;
        const out = await adminService.superOps.executeAiEmergencyControl(
          buildActor(req),
          req.body ?? {},
        );
        if (!out.ok) {
          res.status(out.status).json({ error: out.error, code: out.code });
          return;
        }
        res.json({ ok: true, ...out.data });
      } catch (err) {
        next(err);
      }
    },
  );

  // ---- PHASE 6: EMERGENCY RESPONSE CENTRE ----
  router.get(
    '/emergency-centre',
    requirePermission(PERMISSIONS.ADMIN_EMERGENCY_READ),
    async (_req, res, next) => {
      try {
        const data = await adminService.superOps.getEmergencyOverview();
        res.json({ ok: true, ...data });
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/emergency-centre/action',
    requirePermission(PERMISSIONS.ADMIN_EMERGENCY_MANAGE),
    async (req: RbacAuthenticatedRequest, res, next) => {
      try {
        const rawAction =
          typeof req.body?.action === 'string' ? req.body.action.trim().toUpperCase() : '';
        const requiresPasswordReauth =
          rawAction === 'ACTIVATE_MAINTENANCE' ||
          rawAction === 'DEACTIVATE_MAINTENANCE' ||
          rawAction === 'DISABLE_AI_PROVIDER' ||
          rawAction === 'ENABLE_AI_PROVIDER' ||
          rawAction === 'REVOKE_USER_SESSIONS';
        if (requiresPasswordReauth && !(await enforceReauth(req, res))) return;
        const out = await adminService.superOps.executeEmergencyCentreAction(
          buildActor(req),
          req.body ?? {},
        );
        if (!out.ok) {
          res.status(out.status).json({ error: out.error, code: out.code });
          return;
        }
        res.json({ ok: true, ...out.data });
      } catch (err) {
        next(err);
      }
    },
  );

  // ---- PHASE 6: PLATFORM-WIDE INTELLIGENCE & DECISION SUPPORT ----
  router.get(
    '/intelligence',
    requirePermission(PERMISSIONS.ADMIN_INTELLIGENCE_READ),
    async (req, res, next) => {
      try {
        const data = await adminService.superOps.getPlatformIntelligence({
          range: req.query.range,
          from: req.query.from,
          to: req.query.to,
        });
        res.json({ ok: true, ...data });
      } catch (err) {
        next(err);
      }
    },
  );

  // ---- PHASE 6: GLOBAL ACTION CENTRE & PERMISSION-FILTERED GLOBAL SEARCH ----
  router.get(
    '/action-centre',
    requirePermission(PERMISSIONS.ADMIN_CONSOLE_READ),
    async (req: RbacAuthenticatedRequest, res, next) => {
      try {
        const data = await adminService.superOps.getActionCentreSummary(buildActor(req).role);
        res.json({ ok: true, ...data });
      } catch (err) {
        next(err);
      }
    },
  );

  router.get(
    '/search',
    requirePermission(PERMISSIONS.ADMIN_GLOBAL_SEARCH_READ),
    async (req: RbacAuthenticatedRequest, res, next) => {
      try {
        const actor = buildActor(req);
        const rate = searchLimiter.check(`search:${actor.userId}`);
        if (!rate.allowed) {
          res.setHeader('Retry-After', String(rate.retryAfterSeconds));
          res.status(429).json({
            error: 'Admin search rate limit exceeded. Please wait briefly.',
            code: 'RATE_LIMITED',
          });
          return;
        }
        const data = await adminService.superOps.globalSearch(
          actor.role,
          req.query.q,
          Number(req.query.limit) || 20,
          Number(req.query.offset) || 0,
        );
        res.json({ ok: true, ...data });
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
