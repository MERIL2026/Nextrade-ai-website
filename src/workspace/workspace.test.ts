import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import { createAuthDatabase } from '../auth/db';
import { createAuthService } from '../auth/service';
import { createAuthRouter } from '../auth/router';
import type { AuthEmailSender } from '../auth/email';
import { createWorkspaceService } from './service';
import { createWorkspaceRouter } from './router';
import type { ResearchResponsePayload } from '../lib/researchEngine';

function createTestMailSender(): { sender: AuthEmailSender; tokens: Map<string, string> } {
  const tokens = new Map<string, string>();
  return {
    tokens,
    sender: {
      isConfigured: () => true,
      getProviderName: () => 'emailjs',
      send: async (email) => {
        if (email.actionUrl) {
          const tok = new URL(email.actionUrl).searchParams.get('token');
          if (tok) tokens.set(email.to.toLowerCase(), tok);
        }
        return { delivered: true, mode: 'provider', provider: 'emailjs', messageId: 'test-1' };
      },
    },
  };
}

async function startWorkspaceTestApp(opts?: {
  researchExecutor?: (params: {
    symbol: string;
    query: string;
    fallbackOnError?: boolean;
  }) => Promise<ResearchResponsePayload>;
  rateLimits?: { mutationMax?: number; orderMax?: number; researchMax?: number };
}) {
  const db = await createAuthDatabase(':memory:');
  const { sender, tokens } = createTestMailSender();
  const authService = createAuthService({
    db,
    emailSender: sender,
    getBaseUrl: () => 'http://127.0.0.1:3000',
  });
  const workspaceService = createWorkspaceService({
    db,
    fxResolver: async () => 84.5,
    quoteResolver: async (symbol) => ({
      symbol: symbol.toUpperCase(),
      name: `${symbol.toUpperCase()} Corp`,
      exchange: symbol.endsWith('.NS') ? 'NSE' : 'NASDAQ',
      region: symbol.endsWith('.NS') ? 'IN' : 'US',
      category: 'STOCK',
      currency: symbol.endsWith('.NS') ? 'INR' : 'USD',
      sector: 'Technology',
      price: symbol.toUpperCase() === 'MSFT' ? 420.0 : 145.0,
      previousClose: 140.0,
      change: 5.0,
      changePercent: 3.57,
      high: 425.0,
      low: 140.0,
      open: 141.0,
      volume: 1000000,
      providerId: 'test-adapter',
      providerName: 'Test Quote Resolver',
      status: 'DELAYED',
      delayMinutes: 15,
      sourceTimestamp: new Date().toISOString(),
      fetchedAt: new Date().toISOString(),
      unavailableReason: null,
    }),
    researchExecutor:
      opts?.researchExecutor ??
      (async ({ symbol, query }) => ({
        symbol: symbol || 'MARKET',
        source: 'gemini',
        model: 'test-model',
        summary: `Research brief for ${symbol}: ${query}`,
        keyDrivers: ['Strong revenue durability'],
        riskFactors: ['Valuation sensitivity'],
        explainabilityBasis: 'Deterministic test research output',
        disclaimer: 'Informational only.',
      })),
  });

  const app = express();
  app.use(express.json({ limit: '32kb' }));
  app.use('/api/auth', createAuthRouter({ authService, emailSender: sender }));
  app.use(
    '/api/workspace',
    createWorkspaceRouter({
      authService,
      workspaceService,
      rateLimits: opts?.rateLimits,
    }),
  );

  const server = await new Promise<http.Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const addr = server.address();
  assert.ok(addr && typeof addr === 'object');
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  async function registerAndLogin(fullName: string, email: string, password: string) {
    const signup = await authService.signup({
      fullName,
      email,
      password,
      confirmPassword: password,
      acceptTerms: true,
      acceptPrivacy: true,
    });
    assert.equal(signup.ok, true);
    const vTok = tokens.get(email.toLowerCase());
    assert.ok(vTok);
    const verified = await authService.verifyEmail({ token: vTok });
    assert.equal(verified.ok, true);

    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    assert.equal(loginRes.status, 200);
    const m = /nextrade_session=([^;]+)/.exec(loginRes.headers.get('set-cookie') ?? '');
    assert.ok(m);
    return {
      userId: signup.ok ? signup.data.user.id : '',
      cookie: `nextrade_session=${m[1]}`,
    };
  }

  return {
    db,
    authService,
    workspaceService,
    baseUrl,
    registerAndLogin,
    close: async () => {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
      await db.close();
    },
  };
}

test('Anonymous requests to all /api/workspace/* routes fail with 401', async () => {
  const ctx = await startWorkspaceTestApp();
  try {
    const endpoints: Array<{ method: string; path: string; body?: unknown }> = [
      { method: 'GET', path: '/profile' },
      { method: 'GET', path: '/portfolios' },
      { method: 'POST', path: '/portfolios', body: { name: 'Test' } },
      { method: 'GET', path: '/watchlists' },
      { method: 'GET', path: '/paper-trading/account' },
      { method: 'GET', path: '/paper-trading/orders' },
      {
        method: 'POST',
        path: '/paper-trading/orders',
        body: { symbol: 'NVDA', side: 'BUY', quantity: 1 },
      },
      { method: 'GET', path: '/paper-trading/transactions' },
      { method: 'GET', path: '/research' },
      { method: 'POST', path: '/research', body: { symbol: 'NVDA', query: 'Test' } },
      { method: 'GET', path: '/reports' },
      { method: 'GET', path: '/preferences' },
      { method: 'PATCH', path: '/preferences', body: { defaultRegion: 'US' } },
      { method: 'POST', path: '/import-legacy', body: {} },
    ];

    for (const ep of endpoints) {
      const res = await fetch(`${ctx.baseUrl}/api/workspace${ep.path}`, {
        method: ep.method,
        headers: ep.body ? { 'Content-Type': 'application/json' } : undefined,
        body: ep.body ? JSON.stringify(ep.body) : undefined,
      });
      assert.equal(res.status, 401, `Expected 401 for ${ep.method} ${ep.path}`);
    }
  } finally {
    await ctx.close();
  }
});

test('User A and User B workspaces are strictly isolated across portfolios, watchlists, paper trading, research, reports, and preferences (IDOR & SQLi safe)', async () => {
  const ctx = await startWorkspaceTestApp();
  try {
    const userA = await ctx.registerAndLogin('Alice Trader', 'alice@example.com', 'NxtVault#9042!Kx');
    const userB = await ctx.registerAndLogin('Bob Investor', 'bob@example.com', 'MktShield#8153!Qz');

    // User A creates a custom portfolio & holding
    const createPortA = await fetch(`${ctx.baseUrl}/api/workspace/portfolios`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: userA.cookie },
      body: JSON.stringify({ name: 'Alice AI Growth', baseCurrency: 'USD', initialBalanceUsd: 15000 }),
    });
    assert.equal(createPortA.status, 201);
    const portAId = ((await createPortA.json()) as { portfolio: { id: string } }).portfolio.id;

    // User B tries to read, update, modify holding, or delete User A's portfolio -> 404
    assert.equal(
      (
        await fetch(`${ctx.baseUrl}/api/workspace/portfolios/${portAId}`, {
          headers: { Cookie: userB.cookie },
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await fetch(`${ctx.baseUrl}/api/workspace/portfolios/${portAId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Cookie: userB.cookie },
          body: JSON.stringify({ name: 'Hijacked' }),
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await fetch(`${ctx.baseUrl}/api/workspace/portfolios/${portAId}/holdings/NVDA`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Cookie: userB.cookie },
          body: JSON.stringify({ quantity: 500, avgCostNative: 140 }),
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await fetch(`${ctx.baseUrl}/api/workspace/portfolios/${portAId}`, {
          method: 'DELETE',
          headers: { Cookie: userB.cookie },
        })
      ).status,
      404,
    );

    // User A creates a custom watchlist and adds MSFT
    const createWlA = await fetch(`${ctx.baseUrl}/api/workspace/watchlists`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: userA.cookie },
      body: JSON.stringify({ name: 'Alice Tech Watch' }),
    });
    assert.equal(createWlA.status, 201);
    const wlAId = ((await createWlA.json()) as { watchlist: { id: string } }).watchlist.id;

    const addItemA = await fetch(`${ctx.baseUrl}/api/workspace/watchlists/${wlAId}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: userA.cookie },
      body: JSON.stringify({ symbol: 'MSFT' }),
    });
    assert.equal(addItemA.status, 201);
    const wlItemAId = ((await addItemA.json()) as { item: { id: string } }).item.id;

    // User B cannot view, add to, delete from, or delete User A's watchlist
    assert.equal(
      (
        await fetch(`${ctx.baseUrl}/api/workspace/watchlists/${wlAId}/items`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Cookie: userB.cookie },
          body: JSON.stringify({ symbol: 'AAPL' }),
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await fetch(`${ctx.baseUrl}/api/workspace/watchlists/${wlAId}/items/${wlItemAId}`, {
          method: 'DELETE',
          headers: { Cookie: userB.cookie },
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await fetch(`${ctx.baseUrl}/api/workspace/watchlists/${wlAId}`, {
          method: 'DELETE',
          headers: { Cookie: userB.cookie },
        })
      ).status,
      404,
    );

    // User A runs AI Research and saves a Report
    const resRunA = await fetch(`${ctx.baseUrl}/api/workspace/research`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: userA.cookie },
      body: JSON.stringify({ symbol: 'NVDA', query: 'Evaluate data center margins' }),
    });
    assert.equal(resRunA.status, 201);
    const researchAId = ((await resRunA.json()) as { item: { id: string } }).item.id;

    const repCreateA = await fetch(`${ctx.baseUrl}/api/workspace/reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: userA.cookie },
      body: JSON.stringify({
        title: 'Alice NVDA Brief',
        reportType: 'research-brief',
        symbol: 'NVDA',
        content: { summary: 'Private brief' },
      }),
    });
    assert.equal(repCreateA.status, 201);
    const reportAId = ((await repCreateA.json()) as { report: { id: string } }).report.id;

    // User B sees 0 research items & 0 reports from User A, and gets 404 on direct ID access/delete
    const bResearchList = (await (
      await fetch(`${ctx.baseUrl}/api/workspace/research`, { headers: { Cookie: userB.cookie } })
    ).json()) as { items: unknown[] };
    assert.equal(bResearchList.items.length, 0);

    assert.equal(
      (
        await fetch(`${ctx.baseUrl}/api/workspace/research/${researchAId}`, {
          headers: { Cookie: userB.cookie },
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await fetch(`${ctx.baseUrl}/api/workspace/research/${researchAId}`, {
          method: 'DELETE',
          headers: { Cookie: userB.cookie },
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await fetch(`${ctx.baseUrl}/api/workspace/reports/${reportAId}`, {
          method: 'DELETE',
          headers: { Cookie: userB.cookie },
        })
      ).status,
      404,
    );

    // SQLi payload in research search/symbol filter does not break or leak foreign data
    const sqliRes = await fetch(
      `${ctx.baseUrl}/api/workspace/research?search=${encodeURIComponent("' OR '1'='1")}`,
      { headers: { Cookie: userB.cookie } },
    );
    assert.equal(sqliRes.status, 200);
    assert.equal(((await sqliRes.json()) as { items: unknown[] }).items.length, 0);

    // Preferences isolation & mass-assignment protection
    const prefUpdateA = await fetch(`${ctx.baseUrl}/api/workspace/preferences`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: userA.cookie },
      body: JSON.stringify({ defaultRegion: 'IN', defaultCurrency: 'INR' }),
    });
    assert.equal(prefUpdateA.status, 200);

    const prefB = (await (
      await fetch(`${ctx.baseUrl}/api/workspace/preferences`, { headers: { Cookie: userB.cookie } })
    ).json()) as { preferences: { defaultRegion: string; defaultCurrency: string } };
    assert.equal(prefB.preferences.defaultRegion, 'ALL');
    assert.equal(prefB.preferences.defaultCurrency, 'USD');

    const massAssignPref = await fetch(`${ctx.baseUrl}/api/workspace/preferences`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: userB.cookie },
      body: JSON.stringify({ defaultRegion: 'US', role: 'super_admin' }),
    });
    assert.equal(massAssignPref.status, 403);

    // CSRF cross-origin protection
    const csrfBlocked = await fetch(`${ctx.baseUrl}/api/workspace/portfolios`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://malicious.example',
        Cookie: userA.cookie,
      },
      body: JSON.stringify({ name: 'Cross Origin Port' }),
    });
    assert.equal(csrfBlocked.status, 403);
  } finally {
    await ctx.close();
  }
});

test('Paper trading enforces server-side pricing, atomic cash/holdings updates, insufficient guards, idempotency, and cross-user isolation', async () => {
  const ctx = await startWorkspaceTestApp();
  try {
    const userA = await ctx.registerAndLogin('Paper Alpha', 'palpha@example.com', 'NxtVault#9042!Kx');
    const userB = await ctx.registerAndLogin('Paper Beta', 'pbeta@example.com', 'MktShield#8153!Qz');

    // Initial clean paper account cash is $100,000.00
    const accA = (await (
      await fetch(`${ctx.baseUrl}/api/workspace/paper-trading/account`, {
        headers: { Cookie: userA.cookie },
      })
    ).json()) as { account: { cashBalanceUsd: number } };
    assert.equal(accA.account.cashBalanceUsd, 100000);

    // Attempt BUY exceeding cash -> 400 INSUFFICIENT_CASH & zero cash mutation
    const overBuy = await fetch(`${ctx.baseUrl}/api/workspace/paper-trading/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: userA.cookie },
      body: JSON.stringify({
        symbol: 'NVDA',
        side: 'BUY',
        quantity: 1000,
        executionPriceNative: 0.01, // Client spoofed price must be ignored!
      }),
    });
    assert.equal(overBuy.status, 400);

    // Attempt SELL exceeding held shares -> 400 INSUFFICIENT_HOLDINGS
    const overSell = await fetch(`${ctx.baseUrl}/api/workspace/paper-trading/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: userA.cookie },
      body: JSON.stringify({ symbol: 'MSFT', side: 'SELL', quantity: 5 }),
    });
    assert.equal(overSell.status, 400);

    // Valid BUY MSFT x 10 with idempotency key (client spoofed price ignored)
    const buyOrder = await fetch(`${ctx.baseUrl}/api/workspace/paper-trading/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: userA.cookie },
      body: JSON.stringify({
        symbol: 'MSFT',
        side: 'BUY',
        quantity: 10,
        clientOrderId: 'idem-msft-1',
        executionPriceNative: 1, // ignored; server uses catalog price
      }),
    });
    assert.equal(buyOrder.status, 201);
    const buyBody = (await buyOrder.json()) as {
      order: { id: string; executionPriceNative: number; totalUsdEquivalent: number };
      account: { cashBalanceUsd: number };
      deduplicated: boolean;
    };
    assert.equal(buyBody.deduplicated, false);
    assert.ok(buyBody.order.executionPriceNative > 100);
    assert.equal(
      buyBody.account.cashBalanceUsd,
      Number((100000 - buyBody.order.totalUsdEquivalent).toFixed(2)),
    );

    // Replay same clientOrderId -> deduplicated, cash unchanged
    const replayBuy = await fetch(`${ctx.baseUrl}/api/workspace/paper-trading/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: userA.cookie },
      body: JSON.stringify({
        symbol: 'MSFT',
        side: 'BUY',
        quantity: 10,
        clientOrderId: 'idem-msft-1',
      }),
    });
    assert.equal(replayBuy.status, 200);
    const replayBody = (await replayBuy.json()) as {
      order: { id: string };
      account: { cashBalanceUsd: number };
      deduplicated: boolean;
    };
    assert.equal(replayBody.deduplicated, true);
    assert.equal(replayBody.order.id, buyBody.order.id);
    assert.equal(replayBody.account.cashBalanceUsd, buyBody.account.cashBalanceUsd);

    // User B's account remains completely untouched at $100,000.00
    const accB = (await (
      await fetch(`${ctx.baseUrl}/api/workspace/paper-trading/account`, {
        headers: { Cookie: userB.cookie },
      })
    ).json()) as { account: { cashBalanceUsd: number } };
    assert.equal(accB.account.cashBalanceUsd, 100000);
  } finally {
    await ctx.close();
  }
});

test('Failing Gemini provider returns 502 without corrupting saved research history, and legacy import prevents duplicates', async () => {
  const ctx = await startWorkspaceTestApp({
    researchExecutor: async () => {
      throw new Error('Upstream Gemini timeout');
    },
  });

  try {
    const userA = await ctx.registerAndLogin('Resilient User', 'resilient@example.com', 'NxtVault#9042!Kx');

    const failRes = await fetch(`${ctx.baseUrl}/api/workspace/research`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: userA.cookie },
      body: JSON.stringify({ symbol: 'NVDA', query: 'Check margin risk' }),
    });
    assert.equal(failRes.status, 503);

    const historyAfterFail = (await (
      await fetch(`${ctx.baseUrl}/api/workspace/research`, { headers: { Cookie: userA.cookie } })
    ).json()) as { items: unknown[] };
    assert.equal(historyAfterFail.items.length, 0);

    // Legacy browser import works once and blocks duplicates
    const importRes = await fetch(`${ctx.baseUrl}/api/workspace/import-legacy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: userA.cookie },
      body: JSON.stringify({
        portfolio: {
          cashBalanceUsd: 55000,
          realizedPnlUsd: 120,
          holdings: [
            {
              symbol: 'MSFT',
              name: 'Microsoft Corporation',
              exchange: 'NASDAQ',
              region: 'US',
              currency: 'USD',
              quantity: 15,
              avgCostNative: 410,
            },
          ],
          orders: [],
        },
        watchlist: ['MSFT', 'HDFCBANK.NS'],
        defaultRegion: 'IN',
      }),
    });
    assert.equal(importRes.status, 200);
    const importBody = (await importRes.json()) as {
      importedHoldingsCount: number;
      importedWatchlistCount: number;
      importedRegion: string;
    };
    assert.equal(importBody.importedHoldingsCount, 1);
    assert.equal(importBody.importedWatchlistCount, 2);
    assert.equal(importBody.importedRegion, 'IN');

    // Duplicate import blocked with 409
    const dupImportRes = await fetch(`${ctx.baseUrl}/api/workspace/import-legacy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: userA.cookie },
      body: JSON.stringify({ watchlist: ['AAPL'] }),
    });
    assert.equal(dupImportRes.status, 409);
  } finally {
    await ctx.close();
  }
});

test('Workspace mutation and order endpoints enforce rate limiting (429)', async () => {
  const ctx = await startWorkspaceTestApp({
    rateLimits: { orderMax: 2, mutationMax: 20 },
  });
  try {
    const userA = await ctx.registerAndLogin('Rate User', 'rate@example.com', 'NxtVault#9042!Kx');

    for (let i = 0; i < 2; i++) {
      const r = await fetch(`${ctx.baseUrl}/api/workspace/paper-trading/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: userA.cookie },
        body: JSON.stringify({ symbol: 'NVDA', side: 'BUY', quantity: 1 }),
      });
      assert.equal(r.status, 201);
    }

    const limited = await fetch(`${ctx.baseUrl}/api/workspace/paper-trading/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: userA.cookie },
      body: JSON.stringify({ symbol: 'NVDA', side: 'BUY', quantity: 1 }),
    });
    assert.equal(limited.status, 429);
    assert.ok(limited.headers.get('retry-after'));
  } finally {
    await ctx.close();
  }
});
