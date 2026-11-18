import React, { useEffect, useState } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import {
  ArrowLeft,
  ArrowRight,
  Compass,
  FileText,
  Globe,
  Loader2,
  ShieldCheck,
} from 'lucide-react';
import { FINTECH_EASE } from './lib/motionPrimitives';
import { AuthProvider, InitialAuthPayload, useAuth } from './lib/authContext';
import { Navbar } from './components/Navbar';
import { HeroSection } from './components/HeroSection';
import { MarketOverviewSection } from './components/MarketOverviewSection';
import { FeaturesSection } from './components/FeaturesSection';
import { ShowcaseAndFlowSection } from './components/ShowcaseAndFlowSection';
import { FaqAndFooter } from './components/FaqAndFooter';
import { WorkspaceApp } from './components/WorkspaceApp';
import { AdminConsoleApp } from './components/admin/AdminConsoleApp';
import { DocsAndLegalPages } from './components/DocsAndLegalPages';
import { Breadcrumbs, SitePageShell } from './components/PagePrimitives';
import { CookieConsentBanner } from './components/CookieConsentBanner';
import { ProductPage, FeaturesPage } from './components/pages/ProductAndFeaturesPages';
import {
  MarketsPage,
  ResearchPage,
  PaperTradingPage,
} from './components/pages/MarketsResearchPaperPages';
import {
  OpenSourcePage,
  AboutPage,
  ChangelogPage,
  RoadmapPage,
  ContributePage,
} from './components/pages/OpenSourceAndCommunityPages';
import {
  SecurityPage,
  ContactPage,
  StatusPage,
} from './components/pages/TrustAndSupportPages';
import {
  ForgotPasswordPage,
  LoginPage,
  ResetPasswordPage,
  SignupPage,
  VerifyEmailPage,
} from './components/auth/AuthPages';
import { MarketRegion } from './lib/marketData';
import {
  PublicRoutePath,
  ROUTE_SEO_META,
  SITE_IDENTITY,
  buildBreadcrumbSchema,
  buildOrganizationSchema,
  buildWebApplicationSchema,
  buildWebSiteSchema,
  getAdminRouteSeoMeta,
  getBreadcrumbsForPath,
  isAdminRoutePath,
} from './lib/siteData';
import { trackPageView } from './lib/analytics';
import { safeJsonLdStringify, sanitizeInternalPath } from './lib/security';

interface RouteState {
  pathname: string;
  search: string;
  tab?: string;
  symbol?: string;
  region?: MarketRegion | 'ALL';
}

interface AppProps {
  initialUrl?: string;
  initialAuth?: InitialAuthPayload;
}

const NOINDEX_ROUTES = new Set([
  '/app',
  '/app/account',
  '/app/security',
  '/reset-password',
  '/verify-email',
]);

function normalizePath(rawPath: string): string {
  const safe = sanitizeInternalPath(rawPath).split('?')[0].split('#')[0];
  if (!safe || safe === '/') return '/';
  const trimmed = safe.replace(/\/+$/, '');
  return trimmed || '/';
}

function parseLocation(initialUrl?: string): RouteState {
  let rawHref: string;
  if (initialUrl) {
    rawHref = initialUrl.startsWith('http')
      ? initialUrl
      : `${SITE_IDENTITY.defaultOrigin}${initialUrl.startsWith('/') ? '' : '/'}${initialUrl}`;
  } else if (typeof window !== 'undefined') {
    rawHref = window.location.href;
  } else {
    rawHref = `${SITE_IDENTITY.defaultOrigin}/`;
  }

  const url = new URL(rawHref);
  const autostart = url.searchParams.get('autostart');
  const pathname = autostart === '1' ? '/app' : normalizePath(url.pathname);
  const tab = url.searchParams.get('tab') ?? undefined;
  const symbol = url.searchParams.get('symbol') ?? undefined;
  const regParam = url.searchParams.get('region');
  const region =
    regParam === 'IN' || regParam === 'US' || regParam === 'GLOBAL' || regParam === 'ALL'
      ? regParam
      : undefined;
  return { pathname, search: url.search, tab, symbol, region };
}

function upsertHeadMeta(
  selector: string,
  createEl: () => HTMLElement,
  attr: string,
  value: string,
) {
  let el = document.head.querySelector(selector) as HTMLElement | null;
  if (!el) {
    el = createEl();
    document.head.appendChild(el);
  }
  el.setAttribute(attr, value);
}

function upsertJsonLdScript(id: string, data: unknown) {
  let el = document.getElementById(id) as HTMLScriptElement | null;
  if (!el) {
    el = document.createElement('script');
    el.id = id;
    el.type = 'application/ld+json';
    document.head.appendChild(el);
  }
  el.textContent = safeJsonLdStringify(data);
}

const ProtectedWorkspaceGate: React.FC<{
  route: RouteState;
  onNavigate: (target: string) => void;
}> = ({ route, onNavigate }) => {
  const { status } = useAuth();

  useEffect(() => {
    if (status === 'unauthenticated') {
      const fullTarget = sanitizeInternalPath(`${route.pathname}${route.search}`);
      onNavigate(`/login?redirect=${encodeURIComponent(fullTarget)}`);
    }
  }, [status, route.pathname, route.search, onNavigate]);

  if (status !== 'authenticated') {
    return (
      <div className="min-h-screen bg-[#F7F8FA] text-[#080B12] flex items-center justify-center p-6">
        <div className="rounded-xl border border-[#E4E8F2] bg-[#FFFFFF] px-6 py-5 flex items-center gap-3 text-sm text-[#667085] shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
          <Loader2 className="h-4 w-4 animate-spin text-[#2D46E6]" aria-hidden="true" />
          <span>Verifying authenticated session...</span>
        </div>
      </div>
    );
  }

  const resolvedTab =
    route.pathname === '/app/account'
      ? 'account'
      : route.pathname === '/app/security'
        ? 'security'
        : route.tab;

  return (
    <WorkspaceApp
      onNavigate={onNavigate}
      initialTab={resolvedTab}
      initialSymbol={route.symbol}
      initialRegion={route.region}
    />
  );
};

const ProtectedAdminGate: React.FC<{
  route: RouteState;
  onNavigate: (target: string) => void;
}> = ({ route, onNavigate }) => {
  const { status } = useAuth();

  useEffect(() => {
    if (status === 'unauthenticated') {
      const fullTarget = sanitizeInternalPath(`${route.pathname}${route.search}`);
      onNavigate(`/login?redirect=${encodeURIComponent(fullTarget)}`);
    }
  }, [status, route.pathname, route.search, onNavigate]);

  if (status !== 'authenticated') {
    return (
      <div className="min-h-screen bg-[#F7F8FA] text-[#080B12] flex items-center justify-center p-6">
        <div className="rounded-xl border border-[#E4E8F2] bg-[#FFFFFF] px-6 py-5 flex items-center gap-3 text-sm text-[#667085] shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
          <Loader2 className="h-4 w-4 animate-spin text-[#2D46E6]" aria-hidden="true" />
          <span>Verifying administrative authorization...</span>
        </div>
      </div>
    );
  }

  return (
    <AdminConsoleApp
      pathname={route.pathname}
      search={route.search}
      onNavigate={onNavigate}
    />
  );
};

const AppShell: React.FC<{ initialUrl?: string }> = ({ initialUrl }) => {
  const { status } = useAuth();
  const [route, setRoute] = useState<RouteState>(() => parseLocation(initialUrl));

  useEffect(() => {
    const onPopState = () => {
      setRoute(parseLocation());
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    const isAdminRoute = isAdminRoutePath(route.pathname);
    const adminMeta = isAdminRoute ? getAdminRouteSeoMeta(route.pathname) : null;
    const isKnownRoute = route.pathname in ROUTE_SEO_META || isAdminRoute;
    const meta =
      adminMeta ??
      (route.pathname in ROUTE_SEO_META
        ? ROUTE_SEO_META[route.pathname as PublicRoutePath]
        : {
            title: '404 — Page Not Found | Nextrade AI',
            description:
              'The requested Nextrade AI page could not be found. Browse supported Indian and US markets, documentation, or launch the browser workspace.',
          });

    const origin = window.location.origin;
    const safeCanonicalPath = isKnownRoute ? route.pathname : '/404';
    const canonicalUrl = `${origin}${safeCanonicalPath}`;
    const ogImageUrl = `${origin}${SITE_IDENTITY.ogImagePath}`;
    const robotsDirective =
      !isKnownRoute || isAdminRoute || NOINDEX_ROUTES.has(route.pathname)
        ? 'noindex, follow'
        : 'index, follow';

    document.title = meta.title;

    upsertHeadMeta(
      'meta[name="description"]',
      () => {
        const m = document.createElement('meta');
        m.setAttribute('name', 'description');
        return m;
      },
      'content',
      meta.description,
    );
    upsertHeadMeta(
      'meta[name="robots"]',
      () => {
        const m = document.createElement('meta');
        m.setAttribute('name', 'robots');
        return m;
      },
      'content',
      robotsDirective,
    );
    upsertHeadMeta(
      'link[rel="canonical"]',
      () => {
        const l = document.createElement('link');
        l.setAttribute('rel', 'canonical');
        return l;
      },
      'href',
      canonicalUrl,
    );
    upsertHeadMeta(
      'meta[property="og:title"]',
      () => {
        const m = document.createElement('meta');
        m.setAttribute('property', 'og:title');
        return m;
      },
      'content',
      meta.title,
    );
    upsertHeadMeta(
      'meta[property="og:description"]',
      () => {
        const m = document.createElement('meta');
        m.setAttribute('property', 'og:description');
        return m;
      },
      'content',
      meta.description,
    );
    upsertHeadMeta(
      'meta[property="og:url"]',
      () => {
        const m = document.createElement('meta');
        m.setAttribute('property', 'og:url');
        return m;
      },
      'content',
      canonicalUrl,
    );
    upsertHeadMeta(
      'meta[property="og:image"]',
      () => {
        const m = document.createElement('meta');
        m.setAttribute('property', 'og:image');
        return m;
      },
      'content',
      ogImageUrl,
    );
    upsertHeadMeta(
      'meta[name="twitter:title"]',
      () => {
        const m = document.createElement('meta');
        m.setAttribute('name', 'twitter:title');
        return m;
      },
      'content',
      meta.title,
    );
    upsertHeadMeta(
      'meta[name="twitter:description"]',
      () => {
        const m = document.createElement('meta');
        m.setAttribute('name', 'twitter:description');
        return m;
      },
      'content',
      meta.description,
    );
    upsertHeadMeta(
      'meta[name="twitter:image"]',
      () => {
        const m = document.createElement('meta');
        m.setAttribute('name', 'twitter:image');
        return m;
      },
      'content',
      ogImageUrl,
    );

    upsertJsonLdScript('ld-json-organization', buildOrganizationSchema(origin));
    upsertJsonLdScript('ld-json-website', buildWebSiteSchema(origin));
    upsertJsonLdScript('ld-json-webapp', buildWebApplicationSchema(origin));
    upsertJsonLdScript('ld-json-breadcrumbs', buildBreadcrumbSchema(origin, route.pathname));

    trackPageView(route.pathname, meta.title);
  }, [route.pathname]);

  const navigate = (target: string) => {
    const safeTarget = sanitizeInternalPath(target);
    const [, hashPart] = safeTarget.split('#');
    window.history.pushState({}, '', safeTarget);
    setRoute(parseLocation(safeTarget));
    if (hashPart) {
      setTimeout(() => {
        document.getElementById(hashPart)?.scrollIntoView({ behavior: 'smooth' });
      }, 60);
    } else {
      window.scrollTo({ top: 0, behavior: 'auto' });
    }
  };

  const launchApp = (
    initialTab?: string,
    initialSymbol?: string,
    initialRegion?: MarketRegion | 'ALL',
  ) => {
    const params = new URLSearchParams();
    if (initialTab) params.set('tab', initialTab);
    if (initialSymbol) params.set('symbol', initialSymbol);
    if (initialRegion) params.set('region', initialRegion);
    const qs = params.toString();
    const target = qs ? `/app?${qs}` : '/app';

    if (status !== 'authenticated') {
      navigate(`/login?redirect=${encodeURIComponent(target)}`);
      return;
    }

    window.history.pushState({}, '', target);
    setRoute({
      pathname: '/app',
      search: qs ? `?${qs}` : '',
      tab: initialTab,
      symbol: initialSymbol,
      region: initialRegion,
    });
    window.scrollTo({ top: 0, behavior: 'auto' });
  };

  const renderPage = () => {
    if (isAdminRoutePath(route.pathname) || route.pathname.startsWith('/admin/')) {
      return <ProtectedAdminGate route={route} onNavigate={navigate} />;
    }

    switch (route.pathname) {
      case '/app':
      case '/app/account':
      case '/app/security':
        return <ProtectedWorkspaceGate route={route} onNavigate={navigate} />;
      case '/login':
        return <LoginPage onNavigate={navigate} searchParamsString={route.search} />;
      case '/signup':
        return <SignupPage onNavigate={navigate} searchParamsString={route.search} />;
      case '/forgot-password':
        return <ForgotPasswordPage onNavigate={navigate} searchParamsString={route.search} />;
      case '/reset-password':
        return <ResetPasswordPage onNavigate={navigate} searchParamsString={route.search} />;
      case '/verify-email':
        return <VerifyEmailPage onNavigate={navigate} searchParamsString={route.search} />;
      case '/product':
        return <ProductPage onNavigate={navigate} onLaunchApp={launchApp} />;
      case '/features':
        return <FeaturesPage onNavigate={navigate} onLaunchApp={launchApp} />;
      case '/markets':
        return <MarketsPage onNavigate={navigate} onLaunchApp={launchApp} />;
      case '/research':
        return <ResearchPage onNavigate={navigate} onLaunchApp={launchApp} />;
      case '/paper-trading':
        return <PaperTradingPage onNavigate={navigate} onLaunchApp={launchApp} />;
      case '/open-source':
        return <OpenSourcePage onNavigate={navigate} onLaunchApp={launchApp} />;
      case '/about':
        return <AboutPage onNavigate={navigate} onLaunchApp={launchApp} />;
      case '/changelog':
        return <ChangelogPage onNavigate={navigate} />;
      case '/roadmap':
        return <RoadmapPage onNavigate={navigate} />;
      case '/contribute':
        return <ContributePage onNavigate={navigate} />;
      case '/security':
        return <SecurityPage onNavigate={navigate} />;
      case '/contact':
        return <ContactPage onNavigate={navigate} />;
      case '/status':
        return <StatusPage onNavigate={navigate} />;
      case '/docs':
        return <DocsAndLegalPages page="docs" onNavigate={navigate} />;
      case '/privacy':
        return <DocsAndLegalPages page="privacy" onNavigate={navigate} />;
      case '/terms':
        return <DocsAndLegalPages page="terms" onNavigate={navigate} />;
      case '/cookies':
        return <DocsAndLegalPages page="cookies" onNavigate={navigate} />;
      case '/disclaimer':
        return <DocsAndLegalPages page="disclaimer" onNavigate={navigate} />;
      case '/':
        return (
          <div className="min-h-screen bg-[#FFFFFF] text-[#080B12]">
            <Navbar onNavigate={navigate} currentPath={route.pathname} />
            <main>
              <HeroSection onLaunchApp={(tab, sym) => launchApp(tab, sym)} />
              <MarketOverviewSection
                onOpenMarkets={(region) => launchApp('markets', undefined, region)}
                onLaunchSymbol={(sym) => launchApp('research', sym)}
              />
              <FeaturesSection onLaunchApp={(tab, sym) => launchApp(tab, sym)} />
              <ShowcaseAndFlowSection
                onLaunchApp={(tab, sym) => launchApp(tab, sym)}
                onNavigate={navigate}
              />
              <FaqAndFooter onNavigate={navigate} />
            </main>
          </div>
        );
      default: {
        const recoveryLinks = [
          {
            label: 'Product Overview',
            href: '/product',
            desc: 'Tour the cross-market platform',
            icon: <Compass className="h-4 w-4 text-[#2D46E6]" aria-hidden="true" />,
          },
          {
            label: 'Supported Markets',
            href: '/markets',
            desc: 'Indian (NSE/BSE) & US equities',
            icon: <Globe className="h-4 w-4 text-[#2D46E6]" aria-hidden="true" />,
          },
          {
            label: 'Documentation Portal',
            href: '/docs',
            desc: 'Guides, setup & /api reference',
            icon: <FileText className="h-4 w-4 text-[#2D46E6]" aria-hidden="true" />,
          },
          {
            label: 'Contact & Support',
            href: '/contact',
            desc: 'Send feedback or open an enquiry',
            icon: <ShieldCheck className="h-4 w-4 text-[#2D46E6]" aria-hidden="true" />,
          },
        ];

        return (
          <SitePageShell currentPath={route.pathname} onNavigate={navigate}>
            <section className="py-16 sm:py-24">
              <div className="mx-auto max-w-[820px] px-4 sm:px-6 space-y-10">
                <div className="text-center space-y-5">
                  <Breadcrumbs
                    items={getBreadcrumbsForPath(route.pathname)}
                    onNavigate={navigate}
                    centered
                  />
                  <p className="font-mono text-xs font-semibold uppercase tracking-[0.1em] text-[#2D46E6]">
                    404 · Page Not Found
                  </p>
                  <h1 className="font-display text-3xl sm:text-5xl font-bold tracking-[-0.03em] text-[#080B12]">
                    We could not locate that Nextrade AI route.
                  </h1>
                  <p className="mx-auto max-w-xl text-sm sm:text-base text-[#667085] leading-relaxed">
                    The path <code className="font-mono text-xs text-[#080B12]">{route.pathname}</code> does not match an active page. Use the links below to jump directly to markets, documentation, or the browser workspace.
                  </p>
                  <div className="pt-2 flex flex-wrap items-center justify-center gap-3">
                    <button
                      type="button"
                      onClick={() => navigate('/')}
                      className="inline-flex h-11 items-center gap-2 rounded-md border border-[#E4E8F2] bg-[#FFFFFF] px-5 text-xs font-semibold uppercase tracking-[0.03em] text-[#080B12] hover:border-[#2D46E6] hover:text-[#2D46E6] transition-colors cursor-pointer"
                    >
                      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                      <span>Back to Home</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => launchApp()}
                      className="inline-flex h-11 items-center gap-2 rounded-md bg-[#2D46E6] px-6 text-xs font-semibold uppercase tracking-[0.04em] text-[#FFFFFF] shadow-[0_8px_20px_rgba(45,70,230,0.22)] hover:bg-[#2238C9] transition-colors cursor-pointer"
                    >
                      <span>Launch Nextrade AI</span>
                      <ArrowRight className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {recoveryLinks.map((item) => (
                    <a
                      key={item.href}
                      href={item.href}
                      onClick={(e) => {
                        e.preventDefault();
                        navigate(item.href);
                      }}
                      className="rounded-xl border border-[#E4E8F2] bg-[#F7F8FA] p-4 flex items-start gap-3 hover:border-[#2D46E6] transition-colors"
                    >
                      <div className="mt-0.5 rounded-lg bg-[#FFFFFF] border border-[#E4E8F2] p-2">
                        {item.icon}
                      </div>
                      <div>
                        <div className="font-display text-sm font-bold text-[#080B12]">
                          {item.label}
                        </div>
                        <div className="text-xs text-[#667085] mt-0.5">{item.desc}</div>
                      </div>
                    </a>
                  ))}
                </div>
              </div>
            </section>
          </SitePageShell>
        );
      }
    }
  };

  return (
    <MotionConfig reducedMotion="user">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={route.pathname}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15, ease: FINTECH_EASE }}
        >
          {renderPage()}
        </motion.div>
      </AnimatePresence>
      <CookieConsentBanner onNavigate={navigate} />
    </MotionConfig>
  );
};

export default function App({ initialUrl, initialAuth }: AppProps) {
  return (
    <AuthProvider initialAuth={initialAuth}>
      <AppShell initialUrl={initialUrl} />
    </AuthProvider>
  );
}
