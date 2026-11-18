import 'dotenv/config';
import crypto from 'node:crypto';
import express, { NextFunction, Request, Response } from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createMarketService } from './src/market/service';
import type { AssetCategory, MarketRegion, TimeframeKey } from './src/lib/marketData';
import { executeFinancialResearch } from './src/lib/researchEngine';
import {
  PublicRoutePath,
  REDIRECT_RULES_301,
  ROUTE_SEO_META,
  SITE_IDENTITY,
  buildBreadcrumbSchema,
  buildOrganizationSchema,
  buildWebApplicationSchema,
  buildWebSiteSchema,
  getAdminRouteSeoMeta,
  isAdminRoutePath,
} from './src/lib/siteData';
import {
  SlidingWindowRateLimiter,
  isSafeRelativeRedirect,
  safeJsonLdStringify,
  sanitizeBaseUrl,
  sanitizeInternalPath,
  stripControlChars,
} from './src/lib/security';
import { createAuthDatabase } from './src/auth/db';
import { createAuthEmailSender } from './src/auth/email';
import { isAdminRole } from './src/auth/rbac';
import { createAuthService } from './src/auth/service';
import { createAuthRouter, extractSessionToken } from './src/auth/router';
import { createWorkspaceService } from './src/workspace/service';
import { createWorkspaceRouter } from './src/workspace/router';
import { createRuntimeConfigManager } from './src/admin/runtimeSettings';
import { createBackgroundJobManager, createTelemetryCollector } from './src/admin/telemetry';
import { createAdminService } from './src/admin/service';
import { createAdminRouter } from './src/admin/router';
import { createPrivacyRouter } from './src/admin/privacyRouter';
import { bootstrapSuperAdmin } from './src/admin/bootstrap';
import { InitialAuthPayload } from './src/lib/authContext';

const PROTECTED_WORKSPACE_ROUTES = new Set(['/app', '/app/account', '/app/security']);
const NON_INDEXABLE_ROUTES = new Set([
  '/app',
  '/app/account',
  '/app/security',
  '/reset-password',
  '/verify-email',
]);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const isVercel = Boolean(process.env.VERCEL);
const isProduction = process.env.NODE_ENV === 'production' || isVercel;
const writableRoot = isVercel ? path.join(os.tmpdir(), 'nextrade-data') : __dirname;
const MAX_CONTACT_LOG_BYTES = 10 * 1024 * 1024;
const researchLimiter = new SlidingWindowRateLimiter(25, 60_000);
const contactLimiter = new SlidingWindowRateLimiter(5, 15 * 60_000);

interface ContactSubmissionRecord {
  ticketId: string;
  submittedAt: string;
  name: string;
  email: string;
  topic: string;
  reference: string;
  message: string;
  userAgent: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizePathname(rawPath: string): string {
  const safe = sanitizeInternalPath(rawPath).split('?')[0].split('#')[0];
  if (!safe || safe === '/') return '/';
  const clean = safe.replace(/\/+$/, '');
  return clean || '/';
}

function getBaseUrl(req: Request): string {
  return sanitizeBaseUrl(
    process.env.APP_URL,
    req.get('x-forwarded-host') || req.get('host'),
    req.get('x-forwarded-proto') || req.protocol,
    PORT,
  );
}

function getGaMeasurementId(): string {
  const val = (process.env.GA_MEASUREMENT_ID || process.env.VITE_GA_MEASUREMENT_ID || '').trim();
  if (!val || val === 'G-XXXXXXXXXX') return '';
  return /^[A-Za-z0-9_-]+$/.test(val) ? val : '';
}

function getGoogleVerificationToken(): string {
  return (process.env.GOOGLE_SITE_VERIFICATION ?? '').trim();
}

function buildSsrMetaBlock(
  baseUrl: string,
  pathname: string,
  isKnownRoute: boolean,
  cspNonce: string,
  initialAuth: InitialAuthPayload,
): string {
  const adminSeo = getAdminRouteSeoMeta(pathname);
  const seo = adminSeo
    ? adminSeo
    : isKnownRoute
      ? ROUTE_SEO_META[pathname as PublicRoutePath]
      : {
          title: '404 — Page Not Found | Nextrade AI',
          description:
            'The requested Nextrade AI page could not be found. Browse supported Indian and US markets, documentation, or launch the browser workspace.',
        };

  const safeCanonicalPath = isKnownRoute ? pathname : '/404';
  const canonicalUrl = `${baseUrl}${safeCanonicalPath}`;
  const ogImageUrl = `${baseUrl}${SITE_IDENTITY.ogImagePath}`;
  const robotsValue =
    !isKnownRoute || NON_INDEXABLE_ROUTES.has(pathname) || isAdminRoutePath(pathname)
      ? 'noindex, follow'
      : 'index, follow';

  const orgSchema = safeJsonLdStringify(buildOrganizationSchema(baseUrl));
  const webSiteSchema = safeJsonLdStringify(buildWebSiteSchema(baseUrl));
  const webAppSchema = safeJsonLdStringify(buildWebApplicationSchema(baseUrl));
  const breadcrumbSchema = safeJsonLdStringify(buildBreadcrumbSchema(baseUrl, pathname));
  const ssrAuthJson = safeJsonLdStringify(initialAuth);

  const gscToken = getGoogleVerificationToken();
  const gaId = getGaMeasurementId();

  const tags: string[] = [
    `<title>${escapeHtml(seo.title)}</title>`,
    `<meta name="description" content="${escapeHtml(seo.description)}" />`,
    `<meta name="robots" content="${robotsValue}" />`,
    `<link rel="canonical" href="${escapeHtml(canonicalUrl)}" />`,
    `<script id="nextrade-ssr-auth" type="application/json">${ssrAuthJson}</script>`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${escapeHtml(SITE_IDENTITY.name)}" />`,
    `<meta property="og:url" content="${escapeHtml(canonicalUrl)}" />`,
    `<meta property="og:title" content="${escapeHtml(seo.title)}" />`,
    `<meta property="og:description" content="${escapeHtml(seo.description)}" />`,
    `<meta property="og:image" content="${escapeHtml(ogImageUrl)}" />`,
    `<meta property="og:image:type" content="image/webp" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="${escapeHtml(SITE_IDENTITY.ogImageAlt)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${escapeHtml(seo.title)}" />`,
    `<meta name="twitter:description" content="${escapeHtml(seo.description)}" />`,
    `<meta name="twitter:image" content="${escapeHtml(ogImageUrl)}" />`,
  ];

  if (gscToken) {
    tags.push(`<meta name="google-site-verification" content="${escapeHtml(gscToken)}" />`);
  }

  tags.push(
    `<script id="ld-json-organization" type="application/ld+json">${orgSchema}</script>`,
    `<script id="ld-json-website" type="application/ld+json">${webSiteSchema}</script>`,
    `<script id="ld-json-webapp" type="application/ld+json">${webAppSchema}</script>`,
    `<script id="ld-json-breadcrumbs" type="application/ld+json">${breadcrumbSchema}</script>`,
  );

  if (gaId) {
    tags.push(
      `<script nonce="${escapeHtml(cspNonce)}">window.__NEXTRADE_GA_ID__=${safeJsonLdStringify(gaId)};window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}window.gtag=gtag;gtag('consent','default',{'analytics_storage':'denied','ad_storage':'denied','ad_user_data':'denied','ad_personalization':'denied'});gtag('js',new Date());gtag('config',${safeJsonLdStringify(gaId)},{'anonymize_ip':true,'send_page_view':false});</script>`,
      `<script async src="https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(gaId)}"></script>`,
    );
  }

  return tags.join('\n    ');
}

function buildSitemapXml(baseUrl: string): string {
  const lastmod = '2026-11-13';
  const priorityMap: Partial<Record<PublicRoutePath, { freq: string; priority: string }>> = {
    '/': { freq: 'weekly', priority: '1.0' },
    '/app': { freq: 'weekly', priority: '0.9' },
    '/product': { freq: 'weekly', priority: '0.9' },
    '/features': { freq: 'weekly', priority: '0.8' },
    '/markets': { freq: 'weekly', priority: '0.8' },
    '/research': { freq: 'weekly', priority: '0.8' },
    '/paper-trading': { freq: 'weekly', priority: '0.8' },
    '/docs': { freq: 'monthly', priority: '0.8' },
    '/open-source': { freq: 'monthly', priority: '0.7' },
    '/about': { freq: 'monthly', priority: '0.7' },
    '/changelog': { freq: 'weekly', priority: '0.7' },
    '/roadmap': { freq: 'weekly', priority: '0.7' },
    '/contribute': { freq: 'monthly', priority: '0.7' },
    '/security': { freq: 'monthly', priority: '0.6' },
    '/contact': { freq: 'monthly', priority: '0.6' },
    '/status': { freq: 'daily', priority: '0.6' },
    '/privacy': { freq: 'yearly', priority: '0.4' },
    '/terms': { freq: 'yearly', priority: '0.4' },
    '/cookies': { freq: 'yearly', priority: '0.4' },
    '/disclaimer': { freq: 'yearly', priority: '0.5' },
  };

  const urls = (Object.keys(ROUTE_SEO_META) as PublicRoutePath[])
    .filter((routePath) => !NON_INDEXABLE_ROUTES.has(routePath))
    .map((routePath) => {
      const cfg = priorityMap[routePath] ?? { freq: 'monthly', priority: '0.5' };
      const loc = routePath === '/' ? `${baseUrl}/` : `${baseUrl}${routePath}`;
      return `  <url>
    <loc>${escapeHtml(loc)}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>${cfg.freq}</changefreq>
    <priority>${cfg.priority}</priority>
  </url>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
}

export async function createApp(): Promise<express.Express> {
  const authDb = await createAuthDatabase();
  const authDatabaseMode = authDb.dialect === 'postgres' ? 'supabase-postgres' : 'sqlite';
  const authEmailSender = createAuthEmailSender();

  const runtimeConfigManager = createRuntimeConfigManager(authDb);
  await runtimeConfigManager.ensureSeeded();

  try {
    const bootstrapResult = await bootstrapSuperAdmin(authDb);
    if (bootstrapResult.executed) {
      console.log(`[Nextrade Admin] ${bootstrapResult.reason}`);
    }
  } catch (err) {
    console.warn(
      '[Nextrade Admin] Super Admin bootstrap skipped with warning:',
      err instanceof Error ? err.message : err,
    );
  }

  const marketService = createMarketService({ db: authDb });
  const telemetryCollector = createTelemetryCollector(authDb);
  const jobManager = createBackgroundJobManager({
    db: authDb,
    runtimeConfigManager,
    emailSender: authEmailSender,
    marketService,
  });
  await jobManager.ensureJobsRegistered();

  const authService = createAuthService({
    db: authDb,
    emailSender: authEmailSender,
    getBaseUrl: () => sanitizeBaseUrl(process.env.APP_URL, undefined, undefined, PORT),
    runtimeConfigManager,
  });
  const workspaceService = createWorkspaceService({
    db: authDb,
    runtimeConfigManager,
    marketService,
  });
  const adminService = createAdminService({
    db: authDb,
    authService,
    emailSender: authEmailSender,
    runtimeConfigManager,
    telemetryCollector,
    jobManager,
    marketService,
    projectRoot: writableRoot,
  });
  await adminService.superOps.ensureSeeded();

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(telemetryCollector.middleware());

  // Security headers & per-request CSP nonce middleware
  app.use((_req, res, next) => {
    const cspNonce = crypto.randomBytes(16).toString('base64');
    res.locals.cspNonce = cspNonce;

    const scriptSrc = isProduction
      ? `script-src 'self' 'nonce-${cspNonce}' https://www.googletagmanager.com`
      : `script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.googletagmanager.com`;

    const connectSrc = isProduction
      ? "connect-src 'self' https://www.google-analytics.com https://region1.google-analytics.com https://www.googletagmanager.com"
      : "connect-src 'self' ws://localhost:* wss://localhost:* https://www.google-analytics.com https://region1.google-analytics.com https://www.googletagmanager.com";

    const csp = [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      scriptSrc,
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      "img-src 'self' data: blob: https://www.google-analytics.com https://www.googletagmanager.com",
      connectSrc,
    ].join('; ');

    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy', csp);
    next();
  });

  app.use(express.json({ limit: '32kb' }));
  app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (err && typeof err === 'object') {
      const e = err as { type?: string; status?: number };
      if (e.type === 'entity.too.large' || e.status === 413) {
        res.status(413).json({ error: 'Request payload exceeds the 32 KB limit.' });
        return;
      }
      if (e.type === 'entity.parse.failed' || e.status === 400) {
        res.status(400).json({ error: 'Malformed JSON request body.' });
        return;
      }
    }
    next(err);
  });

  // 301 Permanent Redirects for legacy / variant URLs & trailing slashes (strictly same-origin)
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      next();
      return;
    }

    const reqPath = req.path;
    if (
      reqPath.startsWith('/api/') ||
      reqPath.startsWith('/assets/') ||
      reqPath.startsWith('/src/') ||
      reqPath.startsWith('/node_modules/') ||
      reqPath.startsWith('/@')
    ) {
      next();
      return;
    }

    const sanitizedReqPath = sanitizeInternalPath(reqPath);
    const queryIndex = req.originalUrl.indexOf('?');
    const querySuffix = queryIndex >= 0 ? req.originalUrl.slice(queryIndex) : '';

    const lowerPath = sanitizedReqPath.toLowerCase();
    const mappedRedirect = REDIRECT_RULES_301[lowerPath];
    if (mappedRedirect && isSafeRelativeRedirect(mappedRedirect)) {
      res.redirect(301, `${mappedRedirect}${querySuffix}`);
      return;
    }

    if (sanitizedReqPath !== reqPath || (sanitizedReqPath.length > 1 && sanitizedReqPath.endsWith('/'))) {
      const normalized = sanitizedReqPath.replace(/\/+$/, '') || '/';
      const normalizedMapped = REDIRECT_RULES_301[normalized.toLowerCase()] ?? normalized;
      if (isSafeRelativeRedirect(normalizedMapped)) {
        res.redirect(301, `${normalizedMapped}${querySuffix}`);
        return;
      }
    }

    next();
  });

  // Dynamic robots.txt and sitemap.xml with resolved canonical origin
  app.get('/robots.txt', (req, res) => {
    const baseUrl = getBaseUrl(req);
    res
      .type('text/plain')
      .send(
        `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /app/\nDisallow: /admin/\n\nSitemap: ${baseUrl}/sitemap.xml\n`,
      );
  });

  app.get('/sitemap.xml', (req, res) => {
    const baseUrl = getBaseUrl(req);
    res.type('application/xml').send(buildSitemapXml(baseUrl));
  });

  // Optional Google Search Console HTML file verification
  const gscVerificationFile = (process.env.GOOGLE_SITE_VERIFICATION_FILE ?? '').trim();
  if (gscVerificationFile && /^google[A-Za-z0-9_-]+\.html$/.test(gscVerificationFile)) {
    app.get(`/${gscVerificationFile}`, (_req, res) => {
      res.type('text/html').send(`google-site-verification: ${gscVerificationFile}`);
    });
  }

  // Mount Phase 1 Authentication endpoints with strict no-store caching
  app.use(
    '/api/auth',
    (_req, res, next) => {
      res.setHeader('Cache-Control', 'no-store');
      next();
    },
    createAuthRouter({
      authService,
      emailSender: authEmailSender,
      authDatabase: authDatabaseMode,
    }),
  );

  // Maintenance mode gate for user/public APIs (never blocks /api/auth, /api/admin, /api/privacy, /api/health)
  const maintenanceGate = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const baseStatus = await adminService.governance.getEffectiveMaintenanceStatus(null);
      if (baseStatus.active) {
        const token = extractSessionToken(req);
        const verified = token ? await authService.authenticateSessionToken(token) : null;
        const roleAware = verified
          ? await adminService.governance.getEffectiveMaintenanceStatus(verified.user.role)
          : baseStatus;
        if (roleAware.active && !roleAware.bypassed) {
          res.status(503).json({
            error: roleAware.message,
            code: 'MAINTENANCE_MODE',
            expectedCompletionNote: roleAware.expectedCompletionNote,
            endsAt: roleAware.endsAt,
            windowId: roleAware.windowId,
          });
          return;
        }
      }
    } catch {
      // fail open if runtime config read errors transiently
    }
    next();
  };

  // Mount Phase 2 Multi-User Workspace API (authenticated + RBAC + strict user isolation)
  app.use(
    '/api/workspace',
    maintenanceGate,
    createWorkspaceRouter({
      authService,
      workspaceService,
    }),
  );

  // Mount Phase 5 User Data Governance & Privacy API (authenticated self-service)
  app.use(
    '/api/privacy',
    createPrivacyRouter({
      authService,
      adminService,
    }),
  );

  // Client-exposed feature flag evaluation endpoint (never reveals internal-only flags)
  app.get('/api/features/evaluated', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const token = extractSessionToken(req);
      const verified = token ? await authService.authenticateSessionToken(token) : null;
      const data = await adminService.governance.evaluateClientFeatureFlags({
        userId: verified?.user.id ?? null,
        userRole: verified?.user.role ?? null,
      });
      res.json({ ok: true, ...data });
    } catch {
      res.json({ ok: true, environment: process.env.NODE_ENV || 'development', flags: {} });
    }
  });

  // Public maintenance status inquiry endpoint (used by client UI banner/screen)
  app.get('/api/maintenance/status', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      const token = extractSessionToken(req);
      const verified = token ? await authService.authenticateSessionToken(token) : null;
      const status = await adminService.governance.getEffectiveMaintenanceStatus(
        verified?.user.role ?? null,
      );
      res.json({ ok: true, ...status });
    } catch {
      res.json({ ok: true, active: false, bypassed: false, source: 'none', message: '', expectedCompletionNote: '', endsAt: null, windowId: null });
    }
  });

  // Mount Phase 3 Admin Control Centre API (strict RBAC + CSRF + audit logging + re-auth)
  app.use(
    '/api/admin',
    createAdminRouter({
      authService,
      adminService,
      jobManager,
    }),
  );

  // Public Active Announcements (non-sensitive broadcast notices only)
  app.get('/api/announcements/active', async (_req, res) => {
    try {
      const announcements = await adminService.listPublicActiveAnnouncements();
      res.json({ ok: true, announcements });
    } catch {
      res.json({ ok: true, announcements: [] });
    }
  });

  // API Endpoints
  app.get('/api/health', async (_req, res) => {
    let maintenanceMode = false;
    let maintenanceMessage = '';
    let maintenanceEndsAt: string | null = null;
    try {
      const status = await adminService.governance.getEffectiveMaintenanceStatus(null);
      maintenanceMode = status.active;
      maintenanceMessage = status.message;
      maintenanceEndsAt = status.endsAt;
    } catch {
      maintenanceMode = false;
    }
    res.json({
      status: maintenanceMode ? 'maintenance' : 'ok',
      maintenanceMode,
      maintenanceMessage: maintenanceMode ? maintenanceMessage : '',
      maintenanceEndsAt,
      geminiConfigured: Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY'),
      ssrEnabled: true,
      authReady: true,
      workspaceIsolationReady: true,
      adminReady: true,
      authDatabase: authDatabaseMode,
      emailDeliveryConfigured: authEmailSender.isConfigured(),
      emailProvider: authEmailSender.getProviderName(),
      gaConfigured: Boolean(getGaMeasurementId()),
      searchConsoleConfigured: Boolean(getGoogleVerificationToken() || gscVerificationFile),
      contactApiReady: true,
    });
  });

  app.get('/api/markets', maintenanceGate, async (req, res) => {
    try {
      const cfg = await runtimeConfigManager.getConfig();
      const rawCategory =
        typeof req.query.category === 'string' ? stripControlChars(req.query.category, 16).toUpperCase() : '';
      const rawRegion =
        typeof req.query.region === 'string' ? stripControlChars(req.query.region, 16).toUpperCase() : '';
      const validCategories = new Set<AssetCategory>(['STOCK', 'INDEX', 'ETF', 'CRYPTO', 'FOREX']);
      const validRegions = new Set<MarketRegion>(['IN', 'US', 'GLOBAL']);

      const catFilter = validCategories.has(rawCategory as AssetCategory)
        ? (rawCategory as AssetCategory)
        : undefined;
      const regFilter = validRegions.has(rawRegion as MarketRegion)
        ? (rawRegion as MarketRegion)
        : undefined;

      const overview = await marketService.getOverview();
      const enabledSet = new Set(cfg.market_data_config.enabledRegions);
      const disabledSet = new Set(cfg.market_data_config.disabledSymbols);

      const indices = overview.indices.filter((idx) => {
        if (!enabledSet.has(idx.region)) return false;
        if (regFilter && idx.region !== regFilter) return false;
        return true;
      });
      const instruments = overview.instruments.filter((inst) => {
        if (!enabledSet.has(inst.region)) return false;
        if (disabledSet.has(inst.symbol)) return false;
        if (catFilter && inst.category !== catFilter) return false;
        if (regFilter && inst.region !== regFilter) return false;
        return true;
      });

      const availableQuotes = instruments.filter((i) => i.price !== null).length;
      const cachedQuotes = instruments.filter((i) => i.status === 'CACHED').length;

      res.json({
        ...overview,
        indices,
        instruments,
        summary: {
          ...overview.summary,
          totalInstruments: instruments.length,
          availableQuotes,
          unavailableQuotes: instruments.length - availableQuotes,
          cachedQuotes,
        },
      });
    } catch (err) {
      res.status(503).json({
        error: err instanceof Error ? err.message : 'Market data temporarily unavailable.',
        code: 'MARKET_DATA_UNAVAILABLE',
        dataStatus: 'UNAVAILABLE',
        indices: [],
        instruments: [],
      });
    }
  });

  app.get('/api/markets/search', maintenanceGate, async (req, res) => {
    const q = typeof req.query.q === 'string' ? stripControlChars(req.query.q, 64).trim() : '';
    if (!q) {
      res.json({ ok: true, results: [] });
      return;
    }
    try {
      const results = (await marketService.searchSymbols(q)).slice(0, 20);
      res.json({ ok: true, results });
    } catch (err) {
      res.status(502).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Market search unavailable.',
        results: [],
      });
    }
  });

  app.get('/api/markets/quote/:symbol', maintenanceGate, async (req, res) => {
    const symbol = stripControlChars(req.params.symbol ?? '', 24).trim().toUpperCase();
    if (!symbol) {
      res.status(400).json({ error: 'Symbol is required.' });
      return;
    }
    try {
      const quote = await marketService.getQuote(symbol);
      res.json({ ok: true, quote });
    } catch (err) {
      res.status(503).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Quote temporarily unavailable.',
      });
    }
  });

  app.get('/api/markets/history/:symbol', maintenanceGate, async (req, res) => {
    const symbol = stripControlChars(req.params.symbol ?? '', 24).trim().toUpperCase();
    const rawTf = typeof req.query.timeframe === 'string' ? req.query.timeframe.trim().toUpperCase() : '1M';
    const validTimeframes = new Set<TimeframeKey>(['1D', '1W', '1M', '6M', '1Y']);
    const timeframe: TimeframeKey = validTimeframes.has(rawTf as TimeframeKey)
      ? (rawTf as TimeframeKey)
      : '1M';
    if (!symbol) {
      res.status(400).json({ error: 'Symbol is required.' });
      return;
    }
    try {
      const history = await marketService.getHistory(symbol, timeframe);
      res.json({ ok: true, ...history });
    } catch (err) {
      res.status(503).json({
        ok: false,
        error: err instanceof Error ? err.message : 'Historical series unavailable.',
      });
    }
  });

  app.post('/api/contact', maintenanceGate, async (req, res) => {
    const rateCheck = contactLimiter.check(req.ip || 'unknown');
    if (!rateCheck.allowed) {
      res.setHeader('Retry-After', String(rateCheck.retryAfterSeconds));
      res.status(429).json({
        error: 'Too many contact submissions from this address. Please wait before submitting again.',
      });
      return;
    }

    const name =
      typeof req.body?.name === 'string' ? stripControlChars(req.body.name, 120) : '';
    const email =
      typeof req.body?.email === 'string' ? stripControlChars(req.body.email, 180) : '';
    const topic =
      typeof req.body?.topic === 'string' ? stripControlChars(req.body.topic, 80) : '';
    const reference =
      typeof req.body?.reference === 'string' ? stripControlChars(req.body.reference, 240) : '';
    const message =
      typeof req.body?.message === 'string'
        ? stripControlChars(req.body.message, 4000, { allowNewlines: true })
        : '';
    const consent = req.body?.consent === true;

    const fieldErrors: Record<string, string> = {};
    if (name.length < 2 || name.length > 120) {
      fieldErrors.name = 'Please enter your name (2–120 characters).';
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 180) {
      fieldErrors.email = 'Please enter a valid email address for follow-up.';
    }
    if (!topic) {
      fieldErrors.topic = 'Please select an enquiry topic.';
    }
    if (message.length < 10 || message.length > 4000) {
      fieldErrors.message = 'Please provide a message between 10 and 4000 characters.';
    }
    if (!consent) {
      fieldErrors.consent = 'Please acknowledge the Privacy Policy before submitting.';
    }

    if (Object.keys(fieldErrors).length > 0) {
      res.status(400).json({
        error: Object.values(fieldErrors)[0],
        fieldErrors,
      });
      return;
    }

    const submittedAt = new Date().toISOString();
    const ticketId = `NXT-${Date.now().toString(36).toUpperCase()}-${crypto
      .randomBytes(2)
      .toString('hex')
      .toUpperCase()}`;

    const record: ContactSubmissionRecord = {
      ticketId,
      submittedAt,
      name,
      email,
      topic,
      reference,
      message,
      userAgent: stripControlChars(req.get('user-agent') ?? 'unknown', 240) || 'unknown',
    };

    try {
      const dataDir = path.join(writableRoot, '.data');
      fs.mkdirSync(dataDir, { recursive: true });
      const logPath = path.join(dataDir, 'contact-submissions.jsonl');
      if (fs.existsSync(logPath) && fs.statSync(logPath).size >= MAX_CONTACT_LOG_BYTES) {
        res.status(503).json({
          error: 'Contact intake storage capacity reached. Please open an issue on GitHub.',
        });
        return;
      }
      fs.appendFileSync(logPath, `${JSON.stringify(record)}\n`, 'utf8');
    } catch (err) {
      console.error('Failed to persist contact submission:', err);
      res.status(500).json({
        error: 'Unable to store your message right now. Please try again or open a GitHub issue.',
      });
      return;
    }

    try {
      const token = extractSessionToken(req);
      const verified = token ? await authService.authenticateSessionToken(token) : null;
      await adminService.ingestPublicSupportTicket({
        ticketId,
        userId: verified?.user.id ?? null,
        name,
        email,
        topic,
        reference,
        message,
        submittedAt,
      });
    } catch (err) {
      console.warn('Support ticket DB ingest warning:', err instanceof Error ? err.message : err);
    }

    res.status(201).json({
      ok: true,
      ticketId,
      submittedAt,
      message: 'Message received. Your enquiry has been logged for maintainer review.',
    });
  });

  app.post('/api/research', maintenanceGate, async (req, res) => {
    const rateCheck = researchLimiter.check(req.ip || 'unknown');
    if (!rateCheck.allowed) {
      res.setHeader('Retry-After', String(rateCheck.retryAfterSeconds));
      res.status(429).json({
        error: 'Research rate limit exceeded. Please wait briefly before running another query.',
      });
      return;
    }

    const rawSymbol = typeof req.body?.symbol === 'string' ? req.body.symbol.trim() : '';
    const rawQuery = typeof req.body?.query === 'string' ? req.body.query.trim() : '';

    if (rawSymbol.length > 24) {
      res.status(400).json({ error: 'Instrument symbol must be 24 characters or fewer.' });
      return;
    }
    if (!rawQuery || rawQuery.length < 2) {
      res.status(400).json({ error: 'Please enter a financial research question (at least 2 characters).' });
      return;
    }
    if (rawQuery.length > 1000) {
      res.status(400).json({ error: 'Research question must be 1000 characters or fewer.' });
      return;
    }

    const symbol = stripControlChars(rawSymbol, 24);
    const query = stripControlChars(rawQuery, 1000);
    let liveQuote: import('./src/lib/marketData').MarketQuoteDto | null = null;
    if (symbol) {
      try {
        const fetched = await marketService.getQuote(symbol);
        if (fetched.price !== null) liveQuote = fetched;
      } catch {
        liveQuote = null;
      }
    }

    try {
      const result = await executeFinancialResearch({
        symbol,
        query,
        runtimeConfigManager,
        userId: null,
        feature: 'public_research',
        liveQuote,
      });
      res.json(result);
    } catch (err) {
      const errCode = (err as { code?: string })?.code ?? 'AI_UNAVAILABLE';
      const rawStatus = (err as { status?: number })?.status;
      const status =
        rawStatus === 503 || rawStatus === 400 || rawStatus === 502
          ? rawStatus
          : errCode === 'AI_POLICY_BLOCKED'
            ? 400
            : errCode === 'AI_NOT_CONFIGURED' || errCode === 'AI_FEATURE_DISABLED'
              ? 503
              : 502;
      res.status(status).json({
        error:
          err instanceof Error
            ? err.message
            : 'AI research is currently unavailable.',
        code: errCode,
      });
    }
  });

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'custom',
    });
    app.use(vite.middlewares);

    app.get('*', async (req, res, next) => {
      if (req.originalUrl.startsWith('/api/')) {
        next();
        return;
      }

      const rawPath = req.path;
      if (/\.[a-zA-Z0-9]{2,6}$/.test(rawPath)) {
        res.status(404).end('Not found');
        return;
      }

      try {
        const pathname = normalizePathname(rawPath);
        const autostart = req.query.autostart === '1';
        const effectivePath = autostart ? '/app' : pathname;

        const sessionToken = extractSessionToken(req);
        const verified = sessionToken ? await authService.authenticateSessionToken(sessionToken) : null;
        const initialAuth: InitialAuthPayload = verified
          ? { authenticated: true, user: verified.user, session: verified.session }
          : { authenticated: false, user: null, session: null };

        let adminDeniedStatus: number | null = null;
        if (PROTECTED_WORKSPACE_ROUTES.has(effectivePath)) {
          res.setHeader('Cache-Control', 'no-store');
          if (!verified) {
            const redirectDest =
              pathname === '/' && autostart ? '/app' : sanitizeInternalPath(req.originalUrl);
            res.redirect(302, `/login?redirect=${encodeURIComponent(redirectDest)}`);
            return;
          }
        } else if (isAdminRoutePath(effectivePath) || effectivePath.startsWith('/admin')) {
          res.setHeader('Cache-Control', 'no-store');
          if (!verified) {
            res.redirect(
              302,
              `/login?redirect=${encodeURIComponent(sanitizeInternalPath(req.originalUrl))}`,
            );
            return;
          }
          if (!isAdminRole(verified.user.role)) {
            adminDeniedStatus = 403;
          }
        }

        const templatePath = path.resolve(__dirname, 'index.html');
        let template = fs.readFileSync(templatePath, 'utf-8');
        template = await vite.transformIndexHtml(req.originalUrl, template);

        const { render } = (await vite.ssrLoadModule('/src/entry-server.tsx')) as {
          render: (url: string, initialAuth?: InitialAuthPayload) => string;
        };

        const isKnownRoute = effectivePath in ROUTE_SEO_META || isAdminRoutePath(effectivePath);
        const baseUrl = getBaseUrl(req);
        const ssrMeta = buildSsrMetaBlock(
          baseUrl,
          effectivePath,
          isKnownRoute,
          String(res.locals.cspNonce ?? ''),
          initialAuth,
        );
        const appHtml = render(req.originalUrl, initialAuth);

        const html = template
          .replace(/<!--ssr-meta-start-->[\s\S]*?<!--ssr-meta-end-->/, () => ssrMeta)
          .replace('<!--ssr-head-->', '')
          .replace('<!--ssr-outlet-->', () => appHtml);

        const statusCode = adminDeniedStatus ?? (isKnownRoute ? 200 : 404);
        res
          .status(statusCode)
          .set({ 'Content-Type': 'text/html; charset=utf-8' })
          .send(html);
      } catch (err) {
        vite.ssrFixStacktrace(err as Error);
        next(err);
      }
    });
  } else {
    const distDir = fs.existsSync(path.join(__dirname, 'index.html'))
      ? path.resolve(__dirname, '..')
      : fs.existsSync(path.join(__dirname, 'dist'))
        ? path.join(__dirname, 'dist')
        : path.join(process.cwd(), 'dist');
    const templatePath = fs.existsSync(path.join(distDir, 'server', 'index.html'))
      ? path.join(distDir, 'server', 'index.html')
      : path.join(distDir, 'index.html');
    const templateHtml = fs.readFileSync(templatePath, 'utf-8');
    const serverEntryPath = fs.existsSync(path.join(distDir, 'server', 'entry-server.mjs'))
      ? path.join(distDir, 'server', 'entry-server.mjs')
      : path.join(distDir, 'server', 'entry-server.js');
    const { render } = (await import(pathToFileURL(serverEntryPath).href)) as {
      render: (url: string, initialAuth?: InitialAuthPayload) => string;
    };

    app.use(express.static(distDir, { index: false }));

    app.get('*', async (req, res, next) => {
      if (req.originalUrl.startsWith('/api/')) {
        next();
        return;
      }
      if (/\.[a-zA-Z0-9]{2,6}$/.test(req.path)) {
        res.status(404).end('Not found');
        return;
      }

      try {
        const pathname = normalizePathname(req.path);
        const autostart = req.query.autostart === '1';
        const effectivePath = autostart ? '/app' : pathname;

        const sessionToken = extractSessionToken(req);
        const verified = sessionToken ? await authService.authenticateSessionToken(sessionToken) : null;
        const initialAuth: InitialAuthPayload = verified
          ? { authenticated: true, user: verified.user, session: verified.session }
          : { authenticated: false, user: null, session: null };

        let adminDeniedStatus: number | null = null;
        if (PROTECTED_WORKSPACE_ROUTES.has(effectivePath)) {
          res.setHeader('Cache-Control', 'no-store');
          if (!verified) {
            const redirectDest =
              pathname === '/' && autostart ? '/app' : sanitizeInternalPath(req.originalUrl);
            res.redirect(302, `/login?redirect=${encodeURIComponent(redirectDest)}`);
            return;
          }
        } else if (isAdminRoutePath(effectivePath) || effectivePath.startsWith('/admin')) {
          res.setHeader('Cache-Control', 'no-store');
          if (!verified) {
            res.redirect(
              302,
              `/login?redirect=${encodeURIComponent(sanitizeInternalPath(req.originalUrl))}`,
            );
            return;
          }
          if (!isAdminRole(verified.user.role)) {
            adminDeniedStatus = 403;
          }
        }

        const isKnownRoute = effectivePath in ROUTE_SEO_META || isAdminRoutePath(effectivePath);
        const baseUrl = getBaseUrl(req);
        const ssrMeta = buildSsrMetaBlock(
          baseUrl,
          effectivePath,
          isKnownRoute,
          String(res.locals.cspNonce ?? ''),
          initialAuth,
        );
        const appHtml = render(req.originalUrl, initialAuth);

        const html = templateHtml
          .replace(/<!--ssr-meta-start-->[\s\S]*?<!--ssr-meta-end-->/, () => ssrMeta)
          .replace('<!--ssr-head-->', '')
          .replace('<!--ssr-outlet-->', () => appHtml);

        const statusCode = adminDeniedStatus ?? (isKnownRoute ? 200 : 404);
        res
          .status(statusCode)
          .set({ 'Content-Type': 'text/html; charset=utf-8' })
          .send(html);
      } catch (err) {
        next(err);
      }
    });
  }

  return app;
}

let cachedAppPromise: Promise<express.Express> | null = null;

export function getApp(): Promise<express.Express> {
  if (!cachedAppPromise) {
    cachedAppPromise = createApp().catch((err) => {
      cachedAppPromise = null;
      throw err;
    });
  }
  return cachedAppPromise;
}

if (!isVercel) {
  getApp()
    .then((app) => {
      app.listen(PORT, '0.0.0.0', () => {
        console.log(`Nextrade AI server listening on http://localhost:${PORT}`);
      });
    })
    .catch((err) => {
      console.error('Failed to start Nextrade AI server:', err);
      process.exit(1);
    });
}
