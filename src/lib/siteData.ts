export const GITHUB_REPO_URL = 'https://github.com/MERIL2026/nextrade-ai';
export const GITHUB_ISSUES_URL = 'https://github.com/MERIL2026/nextrade-ai/issues';
export const GITHUB_NEW_ISSUE_URL = 'https://github.com/MERIL2026/nextrade-ai/issues/new';

export type PublicRoutePath =
  | '/'
  | '/app'
  | '/product'
  | '/features'
  | '/markets'
  | '/research'
  | '/paper-trading'
  | '/open-source'
  | '/about'
  | '/changelog'
  | '/roadmap'
  | '/contribute'
  | '/security'
  | '/contact'
  | '/status'
  | '/docs'
  | '/privacy'
  | '/terms'
  | '/cookies'
  | '/disclaimer'
  | '/login'
  | '/signup'
  | '/forgot-password'
  | '/reset-password'
  | '/verify-email'
  | '/app/account'
  | '/app/security';

export const SITE_IDENTITY = {
  name: 'Nextrade AI',
  builder: 'Meril & NEXORA Labs',
  tagline: 'Understand markets. Research deeper. Make informed decisions.',
  license: 'Apache-2.0',
  ogImagePath: '/assets/og-nextrade-ai.webp',
  ogImageAlt:
    'Nextrade AI by Meril & NEXORA Labs — Free and open-source financial intelligence platform for global markets',
  logoPath: '/assets/aistudio/04-symbol-black_2ad61c4e.svg',
  githubUrl: GITHUB_REPO_URL,
  defaultOrigin: 'https://nextrade.ai',
} as const;

export interface RouteSeoMeta {
  title: string;
  description: string;
}

export const ROUTE_SEO_META: Record<PublicRoutePath, RouteSeoMeta> = {
  '/': {
    title: 'Nextrade AI — Financial Intelligence Platform by Meril & NEXORA Labs',
    description:
      'Free and open-source financial intelligence platform built by Meril & NEXORA Labs for exploring real Indian, US, Crypto, ETF, and Forex market data with simulated paper trading and transparent AI capabilities.',
  },
  '/app': {
    title: 'Workspace — Nextrade AI Browser Application',
    description:
      'Launch the Nextrade AI workspace to track real Indian (NSE/BSE), US (NYSE/NASDAQ), Crypto, ETF, and Forex quotes, manage portfolios, run Gemini research, and simulate paper trades.',
  },
  '/product': {
    title: 'Product Overview — Nextrade AI Platform',
    description:
      'Explore how Nextrade AI by Meril & NEXORA Labs combines real-time and delayed exchange market feeds, portfolio tracking, simulated paper trading, and evolving AI intelligence.',
  },
  '/features': {
    title: 'Features — Core Capabilities | Nextrade AI',
    description:
      'Inspect Nextrade AI capabilities: Real Multi-Asset Market Data, AI Research (Building Mode & Gemini), Portfolio Intelligence, Simulated Paper Trading, and Risk Analytics.',
  },
  '/markets': {
    title: 'Supported Markets — Stocks, Indices, ETFs, Crypto & Forex | Nextrade AI',
    description:
      'Explore live and delayed quotes across Indian equities (NSE/BSE), US equities (NYSE/NASDAQ), global indices, ETFs, crypto assets, and USD/INR forex rates.',
  },
  '/research': {
    title: 'AI Research Engine — Building Mode & Gemini Synthesis | Nextrade AI',
    description:
      'Explore structured financial research powered by Google Gemini when configured, alongside transparent AI Building Mode status updates for upcoming intelligence modules.',
  },
  '/paper-trading': {
    title: 'Paper Trading — Simulated Execution on Real Quotes | Nextrade AI',
    description:
      'Practice simulated BUY and SELL orders against live market prices and dynamic USD/INR conversion with explicit simulation labeling and zero brokerage risk.',
  },
  '/open-source': {
    title: 'Open Source — Apache-2.0 Platform by Meril & NEXORA Labs | Nextrade AI',
    description:
      'Review the open-source philosophy, Apache-2.0 licensing, full-stack architecture, and attribution for Nextrade AI built by Meril & NEXORA Labs.',
  },
  '/about': {
    title: 'About Nextrade AI — Built by Meril & NEXORA Labs',
    description:
      'Learn about Nextrade AI and its creators Meril & NEXORA Labs: building a transparent, free, open-source platform for global market understanding.',
  },
  '/changelog': {
    title: 'Changelog — Release History | Nextrade AI',
    description:
      'Chronological release history tracking verified features, real market data integrations, improvements, and engineering updates across Nextrade AI.',
  },
  '/roadmap': {
    title: 'Public Roadmap — Platform Direction | Nextrade AI',
    description:
      'Track completed capabilities, active improvements, planned integrations, and future ideas on the transparent Nextrade AI roadmap.',
  },
  '/contribute': {
    title: 'Contribute — Developer Guide | Nextrade AI',
    description:
      'Learn how to fork, run locally, test, report issues, and submit pull requests to the open-source Nextrade AI repository on GitHub.',
  },
  '/security': {
    title: 'Security & Data Practices — Nextrade AI',
    description:
      'Understand how Nextrade AI protects server-side API keys, handles browser-local state, and approaches responsible vulnerability disclosure.',
  },
  '/contact': {
    title: 'Contact & Feedback — Nextrade AI Community',
    description:
      'Reach the Nextrade AI maintainers for general questions, bug reports, feature proposals, and open-source developer collaboration via GitHub.',
  },
  '/status': {
    title: 'System Status — Live Service Health | Nextrade AI',
    description:
      'Inspect live diagnostic checks for the Nextrade AI website, Express backend health, market data endpoint, and AI research synthesis service.',
  },
  '/docs': {
    title: 'Documentation — Architecture & Guides | Nextrade AI',
    description:
      'Searchable documentation covering getting started, product guides, API reference (/api/health, /api/markets, /api/research), and local setup.',
  },
  '/privacy': {
    title: 'Privacy Policy — Nextrade AI Open Source',
    description:
      'Read how Nextrade AI handles browser localStorage state, server research queries, contact messages, and user privacy with transparent data boundaries.',
  },
  '/terms': {
    title: 'Terms & Conditions — Nextrade AI Apache-2.0',
    description:
      'Review the Apache-2.0 license terms, platform rules, and informational boundaries governing the Nextrade AI website and browser workspace.',
  },
  '/cookies': {
    title: 'Cookies Policy & Consent — Nextrade AI',
    description:
      'Inspect how Nextrade AI uses essential browser localStorage and optional consent-gated Google Analytics 4 telemetry, and manage cookie preferences anytime.',
  },
  '/disclaimer': {
    title: 'Financial Disclaimer — Informational Only | Nextrade AI',
    description:
      'Important disclosure: Nextrade AI is an informational research and paper-trading tool, not a registered broker, exchange, or investment advisor.',
  },
  '/login': {
    title: 'Sign In — Nextrade AI Workspace Authentication',
    description:
      'Sign in securely to your Nextrade AI account to access the cross-market research, portfolio analytics, and paper-trading workspace.',
  },
  '/signup': {
    title: 'Create Account — Nextrade AI Financial Platform',
    description:
      'Register a Nextrade AI account with verified email onboarding and Argon2id credential protection to launch your browser workspace.',
  },
  '/forgot-password': {
    title: 'Forgot Password — Account Recovery | Nextrade AI',
    description:
      'Request a single-use password reset link for your Nextrade AI account without exposing whether an email address is registered.',
  },
  '/reset-password': {
    title: 'Reset Password — Choose New Credentials | Nextrade AI',
    description:
      'Set a new strong password for your Nextrade AI account using a verified single-use recovery token and revoke prior active sessions.',
  },
  '/verify-email': {
    title: 'Verify Email — Activate Account | Nextrade AI',
    description:
      'Confirm your email address using a single-use verification link to activate sign-in access to your Nextrade AI browser workspace.',
  },
  '/app/account': {
    title: 'Account Settings — Nextrade AI Workspace',
    description:
      'Manage your authenticated Nextrade AI profile details, inspect email verification status, and review browser-local data boundaries.',
  },
  '/app/security': {
    title: 'Security & Active Sessions — Nextrade AI Workspace',
    description:
      'Inspect active authenticated browser sessions, revoke stale sessions individually, and initiate secure password recovery.',
  },
};

export interface NavLinkItem {
  label: string;
  href: string;
  description?: string;
  external?: boolean;
}

export interface NavGroup {
  id: string;
  label: string;
  items: NavLinkItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    id: 'product',
    label: 'Product',
    items: [
      { label: 'Overview', href: '/product', description: 'Complete browser platform tour' },
      { label: 'Features', href: '/features', description: 'Six core intelligence modules' },
      { label: 'Markets', href: '/markets', description: 'India (NSE/BSE) & US coverage' },
      { label: 'AI Research', href: '/research', description: 'Explainable synthesis engine' },
      { label: 'Paper Trading', href: '/paper-trading', description: 'Zero-risk simulated orders' },
    ],
  },
  {
    id: 'resources',
    label: 'Resources',
    items: [
      { label: 'Documentation', href: '/docs', description: 'Guides & API reference' },
      { label: 'Changelog', href: '/changelog', description: 'Verified release timeline' },
      { label: 'Roadmap', href: '/roadmap', description: 'Completed & planned work' },
      { label: 'System Status', href: '/status', description: 'Live /api health diagnostics' },
    ],
  },
  {
    id: 'community',
    label: 'Community',
    items: [
      { label: 'Open Source', href: '/open-source', description: 'Apache-2.0 architecture' },
      { label: 'Contribute', href: '/contribute', description: 'Setup, tests & pull requests' },
      { label: 'GitHub', href: GITHUB_REPO_URL, description: 'MERIL2026/nextrade-ai', external: true },
    ],
  },
  {
    id: 'about',
    label: 'About',
    items: [
      { label: 'About', href: '/about', description: 'Mission & product philosophy' },
      { label: 'Contact', href: '/contact', description: 'Issues, feedback & support' },
    ],
  },
];

export interface FooterColumn {
  heading: string;
  links: NavLinkItem[];
}

export const FOOTER_COLUMNS: FooterColumn[] = [
  {
    heading: 'Product',
    links: [
      { label: 'Product', href: '/product' },
      { label: 'Features', href: '/features' },
      { label: 'Markets', href: '/markets' },
      { label: 'AI Research', href: '/research' },
      { label: 'Paper Trading', href: '/paper-trading' },
      { label: 'Launch App', href: '/app' },
    ],
  },
  {
    heading: 'Resources',
    links: [
      { label: 'Documentation', href: '/docs' },
      { label: 'Changelog', href: '/changelog' },
      { label: 'Roadmap', href: '/roadmap' },
      { label: 'System Status', href: '/status' },
    ],
  },
  {
    heading: 'Community',
    links: [
      { label: 'GitHub', href: GITHUB_REPO_URL, external: true },
      { label: 'Open Source', href: '/open-source' },
      { label: 'Contribute', href: '/contribute' },
    ],
  },
  {
    heading: 'Company',
    links: [
      { label: 'About', href: '/about' },
      { label: 'Contact', href: '/contact' },
    ],
  },
  {
    heading: 'Legal',
    links: [
      { label: 'Privacy Policy', href: '/privacy' },
      { label: 'Terms & Conditions', href: '/terms' },
      { label: 'Cookies Policy', href: '/cookies' },
      { label: 'Disclaimer', href: '/disclaimer' },
      { label: 'Security', href: '/security' },
    ],
  },
];

export const REDIRECT_RULES_301: Record<string, string> = {
  '/home': '/',
  '/index.html': '/',
  '/workspace': '/app',
  '/dashboard': '/app',
  '/terminal': '/app',
  '/documentation': '/docs',
  '/privacy-policy': '/privacy',
  '/terms-and-conditions': '/terms',
  '/terms-of-use': '/terms',
  '/cookies-policy': '/cookies',
  '/cookie-policy': '/cookies',
  '/ai-research': '/research',
  '/simulator': '/paper-trading',
  '/github': '/open-source',
  '/robort.txt': '/robots.txt',
};

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

const BREADCRUMB_MAP: Record<PublicRoutePath, BreadcrumbItem[]> = {
  '/': [{ label: 'Home', href: '/' }],
  '/app': [{ label: 'Home', href: '/' }, { label: 'Workspace' }],
  '/product': [{ label: 'Home', href: '/' }, { label: 'Product' }],
  '/features': [{ label: 'Home', href: '/' }, { label: 'Product', href: '/product' }, { label: 'Features' }],
  '/markets': [{ label: 'Home', href: '/' }, { label: 'Product', href: '/product' }, { label: 'Markets' }],
  '/research': [{ label: 'Home', href: '/' }, { label: 'Product', href: '/product' }, { label: 'AI Research' }],
  '/paper-trading': [{ label: 'Home', href: '/' }, { label: 'Product', href: '/product' }, { label: 'Paper Trading' }],
  '/open-source': [{ label: 'Home', href: '/' }, { label: 'Community', href: '/open-source' }, { label: 'Open Source' }],
  '/about': [{ label: 'Home', href: '/' }, { label: 'About' }],
  '/changelog': [{ label: 'Home', href: '/' }, { label: 'Resources', href: '/docs' }, { label: 'Changelog' }],
  '/roadmap': [{ label: 'Home', href: '/' }, { label: 'Resources', href: '/docs' }, { label: 'Roadmap' }],
  '/contribute': [{ label: 'Home', href: '/' }, { label: 'Open Source', href: '/open-source' }, { label: 'Contribute' }],
  '/security': [{ label: 'Home', href: '/' }, { label: 'Legal & Trust', href: '/privacy' }, { label: 'Security' }],
  '/contact': [{ label: 'Home', href: '/' }, { label: 'About', href: '/about' }, { label: 'Contact' }],
  '/status': [{ label: 'Home', href: '/' }, { label: 'Resources', href: '/docs' }, { label: 'System Status' }],
  '/docs': [{ label: 'Home', href: '/' }, { label: 'Documentation' }],
  '/privacy': [{ label: 'Home', href: '/' }, { label: 'Legal', href: '/terms' }, { label: 'Privacy Policy' }],
  '/terms': [{ label: 'Home', href: '/' }, { label: 'Legal', href: '/privacy' }, { label: 'Terms & Conditions' }],
  '/cookies': [{ label: 'Home', href: '/' }, { label: 'Legal', href: '/privacy' }, { label: 'Cookies Policy' }],
  '/disclaimer': [{ label: 'Home', href: '/' }, { label: 'Legal', href: '/terms' }, { label: 'Financial Disclaimer' }],
  '/login': [{ label: 'Home', href: '/' }, { label: 'Sign In' }],
  '/signup': [{ label: 'Home', href: '/' }, { label: 'Create Account' }],
  '/forgot-password': [{ label: 'Home', href: '/' }, { label: 'Sign In', href: '/login' }, { label: 'Forgot Password' }],
  '/reset-password': [{ label: 'Home', href: '/' }, { label: 'Sign In', href: '/login' }, { label: 'Reset Password' }],
  '/verify-email': [{ label: 'Home', href: '/' }, { label: 'Sign In', href: '/login' }, { label: 'Verify Email' }],
  '/app/account': [{ label: 'Home', href: '/' }, { label: 'Workspace', href: '/app' }, { label: 'Account Settings' }],
  '/app/security': [{ label: 'Home', href: '/' }, { label: 'Workspace', href: '/app' }, { label: 'Security & Sessions' }],
};

export function getBreadcrumbsForPath(pathname: string): BreadcrumbItem[] {
  if (pathname in BREADCRUMB_MAP) {
    return BREADCRUMB_MAP[pathname as PublicRoutePath];
  }
  if (isAdminRoutePath(pathname)) {
    return [{ label: 'Home', href: '/' }, { label: 'Admin Control Centre', href: '/admin' }];
  }
  return [{ label: 'Home', href: '/' }, { label: '404 Not Found' }];
}

const ADMIN_STATIC_ROUTES = new Set([
  '/admin',
  '/admin/super-control',
  '/admin/automation',
  '/admin/access-reviews',
  '/admin/ai-policies',
  '/admin/emergency',
  '/admin/intelligence',
  '/admin/users',
  '/admin/privacy',
  '/admin/ai',
  '/admin/markets',
  '/admin/apis',
  '/admin/infrastructure',
  '/admin/jobs',
  '/admin/backups',
  '/admin/features',
  '/admin/releases',
  '/admin/security',
  '/admin/alerts',
  '/admin/incidents',
  '/admin/configuration',
  '/admin/audit-logs',
  '/admin/governance',
  '/admin/announcements',
  '/admin/support',
  '/admin/access-control',
  '/admin/settings',
]);

export function isAdminRoutePath(pathname: string): boolean {
  if (ADMIN_STATIC_ROUTES.has(pathname)) return true;
  if (/^\/admin\/users\/[A-Za-z0-9_-]{4,80}$/.test(pathname)) return true;
  return false;
}

export function getAdminRouteSeoMeta(pathname: string): RouteSeoMeta | null {
  if (!isAdminRoutePath(pathname)) return null;
  return {
    title: 'Admin Control Centre — Nextrade AI Platform Operations',
    description:
      'Restricted Nextrade AI administrative control centre for RBAC governance, security operations, AI telemetry, and system configuration.',
  };
}

export function buildOrganizationSchema(origin: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: SITE_IDENTITY.name,
    url: origin,
    logo: `${origin}${SITE_IDENTITY.logoPath}`,
    description:
      'Free and open-source AI-powered financial intelligence platform built by Meril & NEXORA Labs.',
    founder: {
      '@type': 'Organization',
      name: SITE_IDENTITY.builder,
    },
    sameAs: [SITE_IDENTITY.githubUrl],
    contactPoint: {
      '@type': 'ContactPoint',
      contactType: 'community support',
      url: `${origin}/contact`,
      availableLanguage: ['English'],
    },
  };
}

export function buildWebSiteSchema(origin: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE_IDENTITY.name,
    url: origin,
    description: ROUTE_SEO_META['/'].description,
    publisher: {
      '@type': 'Organization',
      name: SITE_IDENTITY.builder,
    },
  };
}

export function buildWebApplicationSchema(origin: string) {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: SITE_IDENTITY.name,
    url: `${origin}/app`,
    applicationCategory: 'FinanceApplication',
    operatingSystem: 'All',
    browserRequirements: 'Requires JavaScript enabled in modern desktop or mobile browser',
    license: 'https://opensource.org/licenses/Apache-2.0',
    creator: {
      '@type': 'Organization',
      name: SITE_IDENTITY.builder,
    },
    description: ROUTE_SEO_META['/app'].description,
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD',
    },
  };
}

export function buildBreadcrumbSchema(origin: string, pathname: string) {
  const isKnownRoute = pathname in ROUTE_SEO_META;
  const safePath = isKnownRoute ? pathname : '/404';
  const items = getBreadcrumbsForPath(safePath);
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, idx) => ({
      '@type': 'ListItem',
      position: idx + 1,
      name: item.label,
      item: item.href ? `${origin}${item.href}` : `${origin}${safePath}`,
    })),
  };
}

export interface ChangelogRelease {
  version: string;
  date: string;
  title: string;
  summary: string;
  features: string[];
  improvements: string[];
  fixes: string[];
  technical: string[];
}

export const CHANGELOG_RELEASES: ChangelogRelease[] = [
  {
    version: 'v2.0.0',
    date: '2026-11-17',
    title: 'Real Market Data Integration, Demo Removal & Production Transformation',
    summary:
      'Removed all hardcoded prices, synthetic series, and pre-seeded fake portfolios in favor of live multi-asset market adapters, real USD/INR FX conversion, clean paper-trading accounts, and transparent AI Building Mode.',
    features: [
      'Integrated Yahoo Finance, CoinGecko, and Frankfurter ECB FX adapters (plus optional Finnhub/Alpha Vantage/Twelve Data) with PostgreSQL/SQLite L2 caching and explicit LIVE/DELAYED/CACHED/UNAVAILABLE labeling.',
      'Added GET /api/markets/search, GET /api/markets/quote/:symbol, and GET /api/markets/history/:symbol endpoints supporting Stocks, Indices, ETFs, Crypto, and Forex.',
      'Updated paper trading to execute simulated orders strictly against live market quotes and dynamic FX conversion from clean $100,000 starting cash.',
      'Added explicit Meril & NEXORA Labs creator attribution across public pages, footer, metadata, and structured schemas.',
    ],
    improvements: [
      'Replaced fabricated fallback AI responses with transparent AI Building Mode messaging and explicit error statuses when GEMINI_API_KEY is absent or upstream is unavailable.',
      'Extended the 6-phase Admin Control Centre with live market probe telemetry and multi-provider health observability.',
    ],
    fixes: [
      'Eliminated static synthetic sparkline waves and hardcoded portfolio initializations across workspace and landing components.',
    ],
    technical: [
      'Added paired SQLite & PostgreSQL migration 0007_market_data_cache with persisted quote and history caching.',
      'Expanded unit tests across src/market/marketService.test.ts and updated workspace/admin test suites for real data contracts.',
    ],
  },
  {
    version: 'v1.2.0',
    date: '2026-11-13',
    title: 'Public Website Ecosystem & Live Diagnostics',
    summary:
      'Expanded Nextrade AI from a single landing page into a multi-page fintech website with dedicated product, markets, AI research, paper trading, governance, and developer routes.',
    features: [
      'Added dedicated /product, /features, /markets, /research, and /paper-trading pages.',
      'Added /open-source, /about, /changelog, /roadmap, and /contribute community pages.',
      'Added /security, /contact, and live-probed /status trust & support routes.',
      'Expanded /docs into a searchable 4-category documentation portal.',
    ],
    improvements: [
      'Upgraded top navigation with accessible Product, Resources, Community, and About dropdown menus.',
      'Standardized 5-column global footer across all public routes with official monochrome brand lockup.',
      'Added dynamic per-route SEO titles, meta descriptions, canonical URLs, Open Graph tags, and updated sitemap.xml.',
    ],
    fixes: [
      'Resolved rapid-click card visibility race on the Features capability stage.',
      'Prevented right-edge clipping on the Hero risk readout for wide percentage strings.',
    ],
    technical: [
      'Replaced deprecated THREE.Clock with performance.now() delta timing across 3D scenes.',
      'Added deterministic SEO and site-structure validation tests in src/lib/siteData.test.ts.',
    ],
  },
  {
    version: 'v1.1.0',
    date: '2026-11-12',
    title: '3D Visual Depth, Motion System & Light Editorial Design',
    summary:
      'Refined the visual system to a Light + Royal Cobalt (#2D46E6) design kit with interactive Three.js 3D hero engineering and reduced-motion-safe Motion transitions.',
    features: [
      'Built interactive 3D HeroIsometricEngine optical analyzer with OrbitControls and software-WebGL pacing.',
      'Added subtle monochrome 3D AmbientThreeBackground topographic wave lattice behind the Hero.',
      'Integrated MotionConfig reducedMotion="user" and shared-layout tab pills across landing sections.',
    ],
    improvements: [
      'Added keyboard-accessible FAQ accordion transitions and smooth mobile navigation drawer.',
      'Added interactive Hero exchange-rate currency converter between USD and INR.',
    ],
    fixes: [
      'Deduped React instances in Vite config for single-context MotionConfig compatibility.',
      'Added software-WebGL (SwiftShader) frame pacing via WebGL2 fence sync to prevent headless CPU starvation.',
    ],
    technical: [
      'Added three and @types/three dependencies with clean geometry/material disposal on unmount.',
    ],
  },
  {
    version: 'v1.0.0',
    date: '2026-11-10',
    title: 'Initial Browser Workspace & Explainable Research Backend',
    summary:
      'Launched the core Nextrade AI browser workspace (/app) and Express API layer supporting NSE/BSE and NYSE/NASDAQ exploration.',
    features: [
      'Released 8-module /app workspace: Home, Markets, Research, Portfolio, Paper Trading, Watchlist, Analytics, and Settings.',
      'Implemented pure portfolioEngine.ts with BUY/SELL validation, USD/INR normalization, HHI concentration, volatility, and max drawdown calculations.',
      'Built Express API server with GET /api/health, GET /api/markets, and POST /api/research powered by @google/genai.',
      'Published initial /docs, /privacy, /terms, and /disclaimer routes.',
    ],
    improvements: [
      'Persisted user-scoped portfolio, order history, and watchlists cleanly in relational database tables.',
    ],
    fixes: [],
    technical: [
      'Added unit tests in src/lib/portfolioEngine.test.ts using Node built-in test runner via tsx.',
    ],
  },
];

export type RoadmapStatus =
  | 'Completed'
  | 'In Progress'
  | 'Planned'
  | 'Under Consideration';

export interface RoadmapItem {
  id: string;
  title: string;
  category: string;
  status: RoadmapStatus;
  description: string;
}

export const ROADMAP_ITEMS: RoadmapItem[] = [
  {
    id: 'rm-workspace',
    title: 'Multi-User Authenticated Workspace (/app) & 6-Phase Admin Plane',
    category: 'Core Platform',
    status: 'Completed',
    description:
      'Full browser experience spanning Home, Markets, Research, Portfolio, Paper Trading, Watchlist, Analytics, Settings, and full RBAC Admin Control Centre.',
  },
  {
    id: 'rm-live-feeds',
    title: 'Real Multi-Asset Market Data Adapters & L2 Caching',
    category: 'Market Data',
    status: 'Completed',
    description:
      'Live and delayed server-side adapters for Yahoo Finance (Stocks, Indices, ETFs, FX), CoinGecko (Crypto), and Frankfurter ECB FX with Postgres/SQLite caching and status transparency.',
  },
  {
    id: 'rm-paper-engine',
    title: 'Simulated Paper Trading on Live Quotes & Dynamic FX',
    category: 'Simulation',
    status: 'Completed',
    description:
      'Clean simulated accounts executing BUY/SELL orders against live market prices and real USD/INR FX with explicit simulation banners and full order/transaction ledgers.',
  },
  {
    id: 'rm-ai-building',
    title: 'AI Intelligence Pipeline & Building Mode Modules',
    category: 'AI Intelligence',
    status: 'In Progress',
    description:
      'Expanding Gemini-backed research with dedicated AI Market Analysis, AI Portfolio Intelligence, and Predictive Analytics modules currently in active engineering.',
  },
  {
    id: 'rm-custom-scenarios',
    title: 'Configurable Portfolio Stress-Test Scenarios',
    category: 'Risk Analytics',
    status: 'In Progress',
    description:
      'Allowing users to test simulated portfolio drawdowns under custom index shock percentages and USD/INR exchange-rate shifts.',
  },
  {
    id: 'rm-export-reports',
    title: 'Exportable Markdown & JSON Research Briefs',
    category: 'Research Workflow',
    status: 'In Progress',
    description:
      'One-click clean export of explainable AI research memos and paper-trading ledger snapshots for personal study.',
  },
  {
    id: 'rm-multi-watchlist',
    title: 'Multi-List Watchlists & Sector Comparisons',
    category: 'Markets',
    status: 'Planned',
    description:
      'Organize custom watchlists by sector or geography and compare side-by-side beta, yield, and volatility metrics.',
  },
  {
    id: 'rm-fundamentals-filing',
    title: 'Structured Quarterly Filing & Earnings Context',
    category: 'AI Intelligence',
    status: 'Under Consideration',
    description:
      'Exploring open financial-statement parsers to ground AI research notes in periodic balance-sheet and cash-flow tables.',
  },
  {
    id: 'rm-backtest-sandbox',
    title: 'Historical Allocation Replay Sandbox',
    category: 'Simulation',
    status: 'Under Consideration',
    description:
      'Evaluating browser-side educational allocation backtesting over historical benchmark series with explicit survivorship-bias disclosures.',
  },
];

export type DocCategory =
  | 'Getting Started'
  | 'Product Guides'
  | 'Technical Documentation'
  | 'Developer Guides';

export interface DocArticle {
  id: string;
  category: DocCategory;
  title: string;
  summary: string;
  body: string[];
  codeSnippet?: {
    label: string;
    code: string;
  };
}

export const DOC_CATEGORIES: DocCategory[] = [
  'Getting Started',
  'Product Guides',
  'Technical Documentation',
  'Developer Guides',
];

export const DOC_ARTICLES: DocArticle[] = [
  {
    id: 'introduction',
    category: 'Getting Started',
    title: 'Introduction to Nextrade AI',
    summary:
      'Browser-native, free, and open-source financial intelligence platform built by Meril & NEXORA Labs.',
    body: [
      'Nextrade AI is built by Meril & NEXORA Labs for investors, learners, and engineers who want transparent real-world market data, simulated paper trading, and evolving AI financial intelligence directly in a web browser—without subscriptions or paywalls.',
      'Every market quote carries an explicit freshness indicator (LIVE, DELAYED, CACHED, or UNAVAILABLE). Paper trading runs strictly as a simulation against live quotes and never executes real brokerage orders.',
    ],
  },
  {
    id: 'installation',
    category: 'Getting Started',
    title: 'Installation & Prerequisites',
    summary: 'Install Node.js dependencies and boot the Express + Vite full-stack development server.',
    body: [
      'Nextrade AI runs on Node.js with TypeScript, React 19, Vite, Tailwind CSS v4, and Express. Clone the official repository and install dependencies before starting the server on port 3000.',
    ],
    codeSnippet: {
      label: 'Terminal — Clone & Install',
      code: `git clone https://github.com/MERIL2026/nextrade-ai.git
cd nextrade-ai
npm install
npm run dev`,
    },
  },
  {
    id: 'environment-setup',
    category: 'Getting Started',
    title: 'Environment Setup (.env)',
    summary: 'Configure server-side AI, database, email, and optional market data provider variables safely.',
    body: [
      'Copy .env.example to .env when running locally. Yahoo Finance, CoinGecko, and Frankfurter ECB FX work out of the box without API keys. Optional Finnhub, Alpha Vantage, or Twelve Data keys can also be configured.',
      'GEMINI_API_KEY enables live structured AI inference on POST /api/research. When GEMINI_API_KEY is unset or disabled, Nextrade AI enters explicit AI Building Mode and returns transparent unavailability rather than fabricating financial advice.',
      'Authentication and workspace persistence support Supabase PostgreSQL (DATABASE_URL / SUPABASE_DB_URL) with SQLite compatibility (AUTH_DB_PATH). Never prefix server secrets with VITE_.',
    ],
    codeSnippet: {
      label: '.env.example',
      code: `GEMINI_API_KEY="YOUR_GEMINI_API_KEY"
APP_URL="http://localhost:3000"
DATABASE_URL=""
AUTH_DB_PATH=".data/nextrade-auth.sqlite"
EMAIL_PROVIDER="emailjs"`,
    },
  },
  {
    id: 'first-time-usage',
    category: 'Getting Started',
    title: 'First-Time Usage Guide',
    summary: 'Navigate from the public overview into your authenticated /app workspace.',
    body: [
      'Sign in or register an account to enter the 8-module /app workspace. Start in Markets to filter Indian equities, US equities, Indices, ETFs, Crypto, or Forex, add real holdings manually or practice simulated trades, and explore AI Research.',
    ],
  },
  {
    id: 'guide-markets',
    category: 'Product Guides',
    title: 'Market Exploration',
    summary: 'Live and delayed quotes for Indian (NSE/BSE), US (NYSE/NASDAQ), Indices, ETFs, Crypto, and Forex.',
    body: [
      'Use category filters (Stocks, Indices, ETFs, Crypto, Forex) and live server-backed symbol search inside Markets to look up real tickers globally.',
      'Every benchmark card and instrument row displays its upstream provider classification (LIVE, DELAYED, CACHED, or UNAVAILABLE) alongside timestamps and historical charts.',
    ],
  },
  {
    id: 'guide-research',
    category: 'Product Guides',
    title: 'AI Research & Building Mode',
    summary: 'Structured Gemini synthesis grounded in live market quotes alongside active AI module development.',
    body: [
      'Nextrade AI is actively building advanced multi-agent AI financial intelligence modules (AI Market Analysis, AI Portfolio Intelligence, Predictive Analytics). When GEMINI_API_KEY is active on the server, POST /api/research generates structured thesis summaries grounded in fetched market snapshots.',
      'If AI is unconfigured or unavailable, the platform reports explicit HTTP 503 status codes cleanly rather than synthesizing placeholder opinions.',
    ],
  },
  {
    id: 'guide-portfolio',
    category: 'Product Guides',
    title: 'Portfolio Intelligence',
    summary: 'Cross-border USD/INR equity valuation backed by dynamic exchange rates.',
    body: [
      'Portfolio Intelligence lets you track manual holdings with explicit entry cost basis or paper positions, converting USD and INR holdings dynamically using the live ECB/FX USD/INR rate and computing unrealized P&L, cash weight, and Herfindahl concentration.',
    ],
  },
  {
    id: 'guide-paper-trading',
    category: 'Product Guides',
    title: 'Simulated Paper Trading',
    summary: 'Practice simulated BUY and SELL orders on live quotes with zero real-money risk.',
    body: [
      'Every new account begins with a clean $100,000 simulated USD cash ledger and zero fabricated holdings. Select any live symbol, enter quantity, and execute BUY or SELL orders at live fetched market prices and live USD/INR conversion.',
      'Paper Trading is clearly labeled as Simulated Trading — zero real brokerage connectivity or capital is involved.',
    ],
  },
  {
    id: 'guide-watchlist',
    category: 'Product Guides',
    title: 'Watchlists',
    summary: 'Track user-selected symbols across equities, ETFs, crypto, and forex.',
    body: [
      'New watchlists start clean with zero pre-populated demo tickers. Search and add any symbol to track live/delayed price changes and daily moves across your account.',
    ],
  },
  {
    id: 'guide-analytics',
    category: 'Product Guides',
    title: 'Risk & Dispersion Analytics',
    summary: 'Compute period return, annualized volatility, maximum drawdown, and return-to-volatility strictly from fetched series.',
    body: [
      'Analytics computes quantitative metrics from fetched OHLC historical series via calculateSeriesRiskMetrics in src/lib/portfolioEngine.ts, showing an honest Insufficient Data state whenever series history is unavailable.',
    ],
  },
  {
    id: 'tech-architecture',
    category: 'Technical Documentation',
    title: 'System Architecture',
    summary: 'Single-origin Express + Vite runtime with PostgreSQL/SQLite persistence and real upstream data adapters.',
    body: [
      'server.ts runs Express alongside Vite SSR/HMR in development, serving public routes, authentication (/api/auth/*), user workspace APIs (/api/workspace/*), live market endpoints (/api/markets/*), and the 6-phase Admin Control Centre (/api/admin/*).',
      'Authentication uses Argon2id hashing, SHA-256 session tokens in HttpOnly SameSite=Lax cookies, single-use tokens, and CSRF Origin verification.',
    ],
  },
  {
    id: 'tech-endpoints',
    category: 'Technical Documentation',
    title: 'Backend Endpoints (Health, Markets & Research)',
    summary: 'REST contracts implemented in server.ts and src/market/service.ts.',
    body: [
      'GET /api/health returns platform readiness including database dialect, maintenance status, and GEMINI_API_KEY configuration state.',
      'GET /api/markets returns live/delayed/cached overview indices, multi-asset instruments, and live USD/INR FX rate. Additional endpoints include GET /api/markets/search?q=..., GET /api/markets/quote/:symbol, and GET /api/markets/history/:symbol?timeframe=....',
      'POST /api/research accepts { symbol?: string, query: string }, enriches prompts with fetched quote context when available, and executes @google/genai when configured—returning explicit 503 AI_NOT_CONFIGURED / AI_UNAVAILABLE if unconfigured or unreachable.',
    ],
    codeSnippet: {
      label: 'GET /api/markets & POST /api/research',
      code: `GET /api/markets?category=CRYPTO
// -> { dataStatus: "LIVE" | "DELAYED" | "CACHED" | "UNAVAILABLE", usdInrRate, indices, instruments }

POST /api/research
Content-Type: application/json

{
  "symbol": "RELIANCE.NS",
  "query": "Summarize key margin drivers and downside risks."
}

// 200 OK (Gemini active) OR 503 AI_NOT_CONFIGURED (AI Building Mode)`,
    },
  },
  {
    id: 'tech-errors',
    category: 'Technical Documentation',
    title: 'Error Handling & Cache Resilience',
    summary: 'Deterministic L1/L2 caching and transparent degradation without fabricated numbers.',
    body: [
      'Market adapters persist valid upstream quotes and history into market_quotes_cache and market_history_cache. If an upstream provider times out, previously cached rows are served labeled CACHED with original timestamps; if no cache exists, quotes are marked UNAVAILABLE with null price.',
    ],
  },
  {
    id: 'dev-local',
    category: 'Developer Guides',
    title: 'Local Development & Contribution Flow',
    summary: 'Fork, branch, edit, and respect monochrome brand guidelines and pure logic separation.',
    body: [
      'Keep pure financial calculations inside src/lib/portfolioEngine.ts and UI components modular inside src/components/. Use the official monochrome BrandLogo SVG assets without modifying proportions or adding gradients.',
    ],
  },
  {
    id: 'dev-testing',
    category: 'Developer Guides',
    title: 'Testing, Typechecking & Production Build',
    summary: 'Run unit tests via tsx, TypeScript checks, and Vite build verification before opening a pull request.',
    body: [
      'Pure domain calculations and navigation/SEO invariants are unit-tested using Node’s built-in test runner via tsx.',
    ],
    codeSnippet: {
      label: 'Verification Commands',
      code: `npx tsx --test src/lib/portfolioEngine.test.ts
npx tsx --test src/lib/siteData.test.ts
npm run lint
npm run build`,
    },
  },
];

export function filterDocsArticles(
  articles: DocArticle[],
  query: string,
  category: 'ALL' | DocCategory,
): DocArticle[] {
  const q = query.trim().toLowerCase();
  return articles.filter((art) => {
    if (category !== 'ALL' && art.category !== category) return false;
    if (!q) return true;
    return (
      art.title.toLowerCase().includes(q) ||
      art.summary.toLowerCase().includes(q) ||
      art.category.toLowerCase().includes(q) ||
      art.body.some((p) => p.toLowerCase().includes(q))
    );
  });
}
