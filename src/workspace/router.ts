import express from 'express';
import {
  PERMISSIONS,
  RbacAuthenticatedRequest,
  requireAuthenticatedUser,
  requirePermission,
} from '../auth/rbac';
import { isSameOriginMutation } from '../auth/router';
import type { AuthService } from '../auth/service';
import { SlidingWindowRateLimiter } from '../lib/security';
import type { WorkspaceService } from './service';

export interface WorkspaceRouterOptions {
  authService: AuthService;
  workspaceService: WorkspaceService;
  rateLimits?: {
    mutationMax?: number;
    researchMax?: number;
    orderMax?: number;
  };
}

export function createWorkspaceRouter(options: WorkspaceRouterOptions) {
  const { authService, workspaceService, rateLimits } = options;
  const router = express.Router();

  const mutationLimiter = new SlidingWindowRateLimiter(rateLimits?.mutationMax ?? 120, 60_000);
  const orderLimiter = new SlidingWindowRateLimiter(rateLimits?.orderMax ?? 40, 60_000);
  const researchLimiter = new SlidingWindowRateLimiter(rateLimits?.researchMax ?? 25, 60_000);

  router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
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

  router.use(requireAuthenticatedUser(authService));

  // General mutation rate-limiter for authenticated writes
  router.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
      const authedReq = req as RbacAuthenticatedRequest;
      const key = `${authedReq.auth?.user.id ?? req.ip ?? 'unknown'}`;
      const check = mutationLimiter.check(key);
      if (!check.allowed) {
        res.setHeader('Retry-After', String(check.retryAfterSeconds));
        res.status(429).json({
          error: 'Too many workspace updates in a short window. Please wait briefly.',
          code: 'RATE_LIMITED',
        });
        return;
      }
    }
    next();
  });

  router.get(
    '/profile',
    requirePermission(PERMISSIONS.WORKSPACE_READ),
    async (req: RbacAuthenticatedRequest, res, next) => {
      try {
        const profile = await workspaceService.getProfile(req.auth!.user);
        res.json({ ok: true, ...profile });
      } catch (err) {
        next(err);
      }
    },
  );

  // ---- Portfolios & Holdings ----
  router.get(
    '/portfolios',
    requirePermission(PERMISSIONS.PORTFOLIO_READ),
    async (req: RbacAuthenticatedRequest, res, next) => {
      try {
        const portfolios = await workspaceService.listPortfolios(req.auth!.user.id);
        res.json({ ok: true, portfolios });
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/portfolios',
    requirePermission(PERMISSIONS.PORTFOLIO_WRITE),
    async (req: RbacAuthenticatedRequest, res, next) => {
      try {
        const outcome = await workspaceService.createPortfolio(req.auth!.user.id, {
          name: req.body?.name,
          baseCurrency: req.body?.baseCurrency,
          initialBalanceUsd: req.body?.initialBalanceUsd,
        });
        if (!outcome.ok) {
          res.status(outcome.status).json({ error: outcome.error, code: outcome.code });
          return;
        }
        res.status(outcome.status).json({ ok: true, ...outcome.data });
      } catch (err) {
        next(err);
      }
    },
  );

  router.get(
    '/portfolios/:id',
    requirePermission(PERMISSIONS.PORTFOLIO_READ),
    async (req: RbacAuthenticatedRequest, res, next) => {
      try {
        const outcome = await workspaceService.getPortfolio(req.auth!.user.id, req.params.id);
        if (!outcome.ok) {
          res.status(outcome.status).json({ error: outcome.error, code: outcome.code });
          return;
        }
        res.json({ ok: true, ...outcome.data });
      } catch (err) {
        next(err);
      }
    },
  );

  router.patch(
    '/portfolios/:id',
    requirePermission(PERMISSIONS.PORTFOLIO_WRITE),
    async (req: RbacAuthenticatedRequest, res, next) => {
      try {
        const outcome = await workspaceService.updatePortfolio(
          req.auth!.user.id,
          req.params.id,
          {
            name: req.body?.name,
            isDefault: req.body?.isDefault,
          },
        );
        if (!outcome.ok) {
          res.status(outcome.status).json({ error: outcome.error, code: outcome.code });
          return;
        }
        res.json({ ok: true, ...outcome.data });
      } catch (err) {
        next(err);
      }
    },
  );

  router.delete(
    '/portfolios/:id',
    requirePermission(PERMISSIONS.PORTFOLIO_WRITE),
    async (req: RbacAuthenticatedRequest, res, next) => {
      try {
        const outcome = await workspaceService.deletePortfolio(req.auth!.user.id, req.params.id, {
          ipAddress: req.ip || 'unknown',
          userAgent: req.get('user-agent'),
        });
        if (!outcome.ok) {
          res.status(outcome.status).json({ error: outcome.error, code: outcome.code });
          return;
        }
        res.json({ ok: true, ...outcome.data });
      } catch (err) {
        next(err);
      }
    },
  );

  router.put(
    '/portfolios/:id/holdings/:symbol',
    requirePermission(PERMISSIONS.PORTFOLIO_WRITE),
    async (req: RbacAuthenticatedRequest, res, next) => {
      try {
        const outcome = await workspaceService.upsertPortfolioHolding(
          req.auth!.user.id,
          req.params.id,
          {
            symbol: req.params.symbol,
            quantity: req.body?.quantity,
            avgCostNative: req.body?.avgCostNative,
          },
        );
        if (!outcome.ok) {
          res.status(outcome.status).json({ error: outcome.error, code: outcome.code });
          return;
        }
        res.json({ ok: true, ...outcome.data });
      } catch (err) {
        next(err);
      }
    },
  );

  router.delete(
    '/portfolios/:id/holdings/:symbol',
    requirePermission(PERMISSIONS.PORTFOLIO_WRITE),
    async (req: RbacAuthenticatedRequest, res, next) => {
      try {
        const outcome = await workspaceService.removePortfolioHolding(
          req.auth!.user.id,
          req.params.id,
          req.params.symbol,
        );
        if (!outcome.ok) {
          res.status(outcome.status).json({ error: outcome.error, code: outcome.code });
          return;
        }
        res.json({ ok: true, ...outcome.data });
      } catch (err) {
        next(err);
      }
    },
  );

  // ---- Watchlists ----
  router.get(
    '/watchlists',
    requirePermission(PERMISSIONS.WATCHLIST_READ),
    async (req: RbacAuthenticatedRequest, res, next) => {
      try {
        const watchlists = await workspaceService.listWatchlists(req.auth!.user.id);
        res.json({ ok: true, watchlists });
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/watchlists',
    requirePermission(PERMISSIONS.WATCHLIST_WRITE),
    async (req: RbacAuthenticatedRequest, res, next) => {
      try {
        const outcome = await workspaceService.createWatchlist(req.auth!.user.id, {
          name: req.body?.name,
        });
        if (!outcome.ok) {
          res.status(outcome.status).json({ error: outcome.error, code: outcome.code });
          return;
        }
        res.status(outcome.status).json({ ok: true, ...outcome.data });
      } catch (err) {
        next(err);
      }
    },
  );

  router.patch(
    '/watchlists/:id',
    requirePermission(PERMISSIONS.WATCHLIST_WRITE),
    async (req: RbacAuthenticatedRequest, res, next) => {
      try {
        const outcome = await workspaceService.updateWatchlist(req.auth!.user.id, req.params.id, {
          name: req.body?.name,
          isDefault: req.body?.isDefault,
        });
        if (!outcome.ok) {
          res.status(outcome.status).json({ error: outcome.error, code: outcome.code });
          return;
        }
        res.json({ ok: true, ...outcome.data });
      } catch (err) {
        next(err);
      }
    },
  );

  router.delete(
    '/watchlists/:id',
    requirePermission(PERMISSIONS.WATCHLIST_WRITE),
    async (req: RbacAuthenticatedRequest, res, next) => {
      try {
        const outcome = await workspaceService.deleteWatchlist(req.auth!.user.id, req.params.id);
        if (!outcome.ok) {
          res.status(outcome.status).json({ error: outcome.error, code: outcome.code });
          return;
        }
        res.json({ ok: true, ...outcome.data });
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/watchlists/:id/items',
    requirePermission(PERMISSIONS.WATCHLIST_WRITE),
    async (req: RbacAuthenticatedRequest, res, next) => {
      try {
        const outcome = await workspaceService.addWatchlistItem(req.auth!.user.id, req.params.id, {
          symbol: req.body?.symbol,
        });
        if (!outcome.ok) {
          res.status(outcome.status).json({ error: outcome.error, code: outcome.code });
          return;
        }
        res.status(outcome.status).json({ ok: true, ...outcome.data });
      } catch (err) {
        next(err);
      }
    },
  );

  router.delete(
    '/watchlists/:id/items/:itemId',
    requirePermission(PERMISSIONS.WATCHLIST_WRITE),
    async (req: RbacAuthenticatedRequest, res, next) => {
      try {
        const outcome = await workspaceService.removeWatchlistItem(
          req.auth!.user.id,
          req.params.id,
          req.params.itemId,
        );
        if (!outcome.ok) {
          res.status(outcome.status).json({ error: outcome.error, code: outcome.code });
          return;
        }
        res.json({ ok: true, ...outcome.data });
      } catch (err) {
        next(err);
      }
    },
  );

  // ---- Paper Trading ----
  router.get(
    '/paper-trading/account',
    requirePermission(PERMISSIONS.PAPER_TRADING_READ),
    async (req: RbacAuthenticatedRequest, res, next) => {
      try {
        const data = await workspaceService.getPaperAccount(req.auth!.user.id);
        res.json({ ok: true, ...data });
      } catch (err) {
        next(err);
      }
    },
  );

  router.get(
    '/paper-trading/orders',
    requirePermission(PERMISSIONS.PAPER_TRADING_READ),
    async (req: RbacAuthenticatedRequest, res, next) => {
      try {
        const data = await workspaceService.listPaperOrders(req.auth!.user.id, {
          symbol: typeof req.query.symbol === 'string' ? req.query.symbol : undefined,
          limit: typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined,
          offset: typeof req.query.offset === 'string' ? Number(req.query.offset) : undefined,
        });
        res.json({ ok: true, ...data });
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/paper-trading/orders',
    requirePermission(PERMISSIONS.PAPER_TRADING_EXECUTE),
    async (req: RbacAuthenticatedRequest, res, next) => {
      try {
        const check = orderLimiter.check(req.auth!.user.id);
        if (!check.allowed) {
          res.setHeader('Retry-After', String(check.retryAfterSeconds));
          res.status(429).json({
            error: 'Paper order rate limit exceeded. Please pause briefly before submitting more orders.',
            code: 'RATE_LIMITED',
          });
          return;
        }

        const outcome = await workspaceService.executePaperTrade(req.auth!.user.id, {
          symbol: req.body?.symbol,
          side: req.body?.side,
          quantity: req.body?.quantity,
          orderType: req.body?.orderType,
          clientOrderId: req.body?.clientOrderId,
          ipAddress: req.ip || 'unknown',
          userAgent: req.get('user-agent'),
        });
        if (!outcome.ok) {
          res.status(outcome.status).json({ error: outcome.error, code: outcome.code });
          return;
        }
        res.status(outcome.status).json({ ok: true, ...outcome.data });
      } catch (err) {
        next(err);
      }
    },
  );

  router.get(
    '/paper-trading/transactions',
    requirePermission(PERMISSIONS.PAPER_TRADING_READ),
    async (req: RbacAuthenticatedRequest, res, next) => {
      try {
        const data = await workspaceService.listPaperTransactions(req.auth!.user.id, {
          symbol: typeof req.query.symbol === 'string' ? req.query.symbol : undefined,
          limit: typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined,
          offset: typeof req.query.offset === 'string' ? Number(req.query.offset) : undefined,
        });
        res.json({ ok: true, ...data });
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/paper-trading/reset',
    requirePermission(PERMISSIONS.PAPER_TRADING_EXECUTE),
    async (req: RbacAuthenticatedRequest, res, next) => {
      try {
        const outcome = await workspaceService.resetPaperAccount(req.auth!.user.id, {
          mode: 'clean',
          ipAddress: req.ip || 'unknown',
          userAgent: req.get('user-agent'),
        });
        if (!outcome.ok) {
          res.status(outcome.status).json({ error: outcome.error, code: outcome.code });
          return;
        }
        res.json({ ok: true, ...outcome.data });
      } catch (err) {
        next(err);
      }
    },
  );

  // ---- AI Research History & Saved Reports ----
  router.get(
    '/research',
    requirePermission(PERMISSIONS.RESEARCH_READ),
    async (req: RbacAuthenticatedRequest, res, next) => {
      try {
        const data = await workspaceService.listResearchHistory(req.auth!.user.id, {
          symbol: typeof req.query.symbol === 'string' ? req.query.symbol : undefined,
          search: typeof req.query.search === 'string' ? req.query.search : undefined,
          limit: typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined,
          offset: typeof req.query.offset === 'string' ? Number(req.query.offset) : undefined,
        });
        res.json({ ok: true, ...data });
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/research',
    requirePermission(PERMISSIONS.RESEARCH_EXECUTE, PERMISSIONS.RESEARCH_WRITE),
    async (req: RbacAuthenticatedRequest, res, next) => {
      try {
        const check = researchLimiter.check(req.auth!.user.id);
        if (!check.allowed) {
          res.setHeader('Retry-After', String(check.retryAfterSeconds));
          res.status(429).json({
            error: 'Research rate limit exceeded. Please wait briefly before running another query.',
            code: 'RATE_LIMITED',
          });
          return;
        }

        const outcome = await workspaceService.runAndSaveResearch(req.auth!.user.id, {
          symbol: req.body?.symbol,
          query: req.body?.query,
        });
        if (!outcome.ok) {
          res.status(outcome.status).json({ error: outcome.error, code: outcome.code });
          return;
        }
        res.status(outcome.status).json({ ok: true, ...outcome.data });
      } catch (err) {
        next(err);
      }
    },
  );

  router.get(
    '/research/:id',
    requirePermission(PERMISSIONS.RESEARCH_READ),
    async (req: RbacAuthenticatedRequest, res, next) => {
      try {
        const outcome = await workspaceService.getResearchItem(req.auth!.user.id, req.params.id);
        if (!outcome.ok) {
          res.status(outcome.status).json({ error: outcome.error, code: outcome.code });
          return;
        }
        res.json({ ok: true, ...outcome.data });
      } catch (err) {
        next(err);
      }
    },
  );

  router.delete(
    '/research/:id',
    requirePermission(PERMISSIONS.RESEARCH_WRITE),
    async (req: RbacAuthenticatedRequest, res, next) => {
      try {
        const outcome = await workspaceService.deleteResearchItem(req.auth!.user.id, req.params.id);
        if (!outcome.ok) {
          res.status(outcome.status).json({ error: outcome.error, code: outcome.code });
          return;
        }
        res.json({ ok: true, ...outcome.data });
      } catch (err) {
        next(err);
      }
    },
  );

  router.get(
    '/reports',
    requirePermission(PERMISSIONS.REPORTS_READ),
    async (req: RbacAuthenticatedRequest, res, next) => {
      try {
        const reports = await workspaceService.listSavedReports(req.auth!.user.id);
        res.json({ ok: true, reports });
      } catch (err) {
        next(err);
      }
    },
  );

  router.post(
    '/reports',
    requirePermission(PERMISSIONS.REPORTS_WRITE),
    async (req: RbacAuthenticatedRequest, res, next) => {
      try {
        const outcome = await workspaceService.createSavedReport(req.auth!.user.id, {
          title: req.body?.title,
          reportType: req.body?.reportType,
          symbol: req.body?.symbol,
          content: req.body?.content,
        });
        if (!outcome.ok) {
          res.status(outcome.status).json({ error: outcome.error, code: outcome.code });
          return;
        }
        res.status(outcome.status).json({ ok: true, ...outcome.data });
      } catch (err) {
        next(err);
      }
    },
  );

  router.delete(
    '/reports/:id',
    requirePermission(PERMISSIONS.REPORTS_WRITE),
    async (req: RbacAuthenticatedRequest, res, next) => {
      try {
        const outcome = await workspaceService.deleteSavedReport(req.auth!.user.id, req.params.id);
        if (!outcome.ok) {
          res.status(outcome.status).json({ error: outcome.error, code: outcome.code });
          return;
        }
        res.json({ ok: true, ...outcome.data });
      } catch (err) {
        next(err);
      }
    },
  );

  // ---- User Preferences ----
  router.get(
    '/preferences',
    requirePermission(PERMISSIONS.PREFERENCES_READ),
    async (req: RbacAuthenticatedRequest, res, next) => {
      try {
        const preferences = await workspaceService.getPreferences(req.auth!.user.id);
        res.json({ ok: true, preferences });
      } catch (err) {
        next(err);
      }
    },
  );

  router.patch(
    '/preferences',
    requirePermission(PERMISSIONS.PREFERENCES_WRITE),
    async (req: RbacAuthenticatedRequest, res, next) => {
      try {
        const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
        if ('role' in body || 'userId' in body || 'user_id' in body || 'legacyImportedAt' in body) {
          res.status(403).json({
            error: 'Protected identity and migration fields cannot be modified via preferences.',
            code: 'FORBIDDEN_MASS_ASSIGNMENT',
          });
          return;
        }
        const outcome = await workspaceService.updatePreferences(req.auth!.user.id, body);
        if (!outcome.ok) {
          res.status(outcome.status).json({ error: outcome.error, code: outcome.code });
          return;
        }
        res.json({ ok: true, ...outcome.data });
      } catch (err) {
        next(err);
      }
    },
  );

  // ---- Legacy Browser Migration ----
  router.post(
    '/import-legacy',
    requirePermission(
      PERMISSIONS.PORTFOLIO_WRITE,
      PERMISSIONS.WATCHLIST_WRITE,
      PERMISSIONS.PREFERENCES_WRITE,
    ),
    async (req: RbacAuthenticatedRequest, res, next) => {
      try {
        const outcome = await workspaceService.importLegacyBrowserData(req.auth!.user.id, {
          portfolio: req.body?.portfolio,
          watchlist: req.body?.watchlist,
          defaultRegion: req.body?.defaultRegion,
          ipAddress: req.ip || 'unknown',
          userAgent: req.get('user-agent'),
        });
        if (!outcome.ok) {
          res.status(outcome.status).json({ error: outcome.error, code: outcome.code });
          return;
        }
        res.json({ ok: true, ...outcome.data });
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
