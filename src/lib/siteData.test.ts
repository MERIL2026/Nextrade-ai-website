import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHANGELOG_RELEASES,
  DOC_ARTICLES,
  FOOTER_COLUMNS,
  GITHUB_REPO_URL,
  NAV_GROUPS,
  PublicRoutePath,
  REDIRECT_RULES_301,
  ROADMAP_ITEMS,
  ROUTE_SEO_META,
  SITE_IDENTITY,
  buildBreadcrumbSchema,
  buildOrganizationSchema,
  buildWebApplicationSchema,
  buildWebSiteSchema,
  filterDocsArticles,
  getBreadcrumbsForPath,
} from './siteData';

test('all route SEO metadata entries have non-empty titles and descriptions including /cookies', () => {
  const paths = Object.keys(ROUTE_SEO_META) as PublicRoutePath[];
  assert.ok(paths.length >= 20);
  assert.ok(paths.includes('/cookies'));
  const seenTitles = new Set<string>();
  for (const path of paths) {
    const meta = ROUTE_SEO_META[path];
    assert.ok(meta.title.length >= 20, `Title too short for ${path}`);
    assert.ok(meta.description.length >= 80, `Description too short for ${path}`);
    assert.ok(!seenTitles.has(meta.title), `Duplicate title for ${path}`);
    seenTitles.add(meta.title);
  }
});

test('navigation groups and footer columns only link to valid routes or verified GitHub URLs', () => {
  const validRoutes = new Set(Object.keys(ROUTE_SEO_META));
  for (const group of NAV_GROUPS) {
    assert.ok(group.items.length >= 2);
    for (const item of group.items) {
      if (item.external) {
        assert.ok(item.href.startsWith(GITHUB_REPO_URL));
      } else {
        assert.ok(validRoutes.has(item.href), `Invalid nav route: ${item.href}`);
      }
    }
  }
  for (const col of FOOTER_COLUMNS) {
    assert.ok(col.links.length >= 2);
    for (const link of col.links) {
      if (link.external) {
        assert.ok(link.href.startsWith(GITHUB_REPO_URL));
      } else {
        assert.ok(validRoutes.has(link.href), `Invalid footer route: ${link.href}`);
      }
    }
  }
});

test('301 redirect rules point to valid target routes or robots.txt', () => {
  const validRoutes = new Set([...Object.keys(ROUTE_SEO_META), '/robots.txt']);
  for (const [source, target] of Object.entries(REDIRECT_RULES_301)) {
    assert.ok(source.startsWith('/'));
    assert.ok(validRoutes.has(target), `Invalid redirect target for ${source}: ${target}`);
  }
});

test('breadcrumbs and Schema.org JSON-LD builders return structured valid objects', () => {
  const origin = 'https://nextrade.ai';
  const crumbs = getBreadcrumbsForPath('/features');
  assert.equal(crumbs[0].label, 'Home');
  assert.equal(crumbs[crumbs.length - 1].label, 'Features');

  const notFoundCrumbs = getBreadcrumbsForPath('/unknown-route');
  assert.equal(notFoundCrumbs[notFoundCrumbs.length - 1].label, '404 Not Found');

  const org = buildOrganizationSchema(origin);
  assert.equal(org['@type'], 'Organization');
  assert.equal(org.name, SITE_IDENTITY.name);
  assert.ok(org.logo.endsWith(SITE_IDENTITY.logoPath));

  const site = buildWebSiteSchema(origin);
  assert.equal(site['@type'], 'WebSite');

  const app = buildWebApplicationSchema(origin);
  assert.equal(app['@type'], 'WebApplication');
  assert.equal(app.offers.price, '0');

  const bcSchema = buildBreadcrumbSchema(origin, '/features');
  assert.equal(bcSchema['@type'], 'BreadcrumbList');
  assert.equal(bcSchema.itemListElement.length, 3);

  const notFoundSchema = buildBreadcrumbSchema(origin, '/</script><script>alert(1)</script>');
  assert.equal(notFoundSchema.itemListElement[1].item, `${origin}/404`);
});

test('changelog and roadmap structures contain valid non-empty items', () => {
  assert.ok(CHANGELOG_RELEASES.length >= 3);
  for (const rel of CHANGELOG_RELEASES) {
    assert.match(rel.version, /^v\d+\.\d+\.\d+$/);
    assert.match(rel.date, /^\d{4}-\d{2}-\d{2}$/);
  }
  const statuses = new Set(ROADMAP_ITEMS.map((item) => item.status));
  assert.ok(statuses.has('Completed'));
  assert.ok(statuses.has('In Progress'));
  assert.ok(statuses.has('Planned'));
  assert.ok(statuses.has('Under Consideration'));
});

test('filterDocsArticles isolates category and keyword matches', () => {
  const apiMatches = filterDocsArticles(DOC_ARTICLES, '/api/research', 'ALL');
  assert.ok(apiMatches.some((a) => a.id === 'tech-endpoints'));

  const devMatches = filterDocsArticles(DOC_ARTICLES, '', 'Developer Guides');
  assert.ok(devMatches.length >= 2);
  assert.ok(devMatches.every((a) => a.category === 'Developer Guides'));
});
