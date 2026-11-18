import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SlidingWindowRateLimiter,
  isSafeRelativeRedirect,
  safeJsonLdStringify,
  sanitizeBaseUrl,
  sanitizeInternalPath,
  sanitizePortfolioState,
  sanitizeWatchlist,
  stripControlChars,
} from './security';
import { CLEAN_PAPER_TRADING_STATE } from './portfolioEngine';

test('sanitizeInternalPath blocks protocol-relative, external, and script URLs', () => {
  assert.equal(sanitizeInternalPath('//evil.example/'), '/evil.example/');
  assert.equal(sanitizeInternalPath('///evil.example/login'), '/evil.example/login');
  assert.equal(sanitizeInternalPath('https://evil.example/phish'), '/');
  assert.equal(sanitizeInternalPath('javascript:alert(1)'), '/');
  assert.equal(sanitizeInternalPath('data:text/html,hi'), '/');
  assert.equal(sanitizeInternalPath('/research#demo'), '/research#demo');
  assert.equal(sanitizeInternalPath('/app?tab=markets&region=IN'), '/app?tab=markets&region=IN');
});

test('isSafeRelativeRedirect rejects protocol-relative and control-character targets', () => {
  assert.equal(isSafeRelativeRedirect('/contact'), true);
  assert.equal(isSafeRelativeRedirect('//evil.example'), false);
  assert.equal(isSafeRelativeRedirect('https://evil.example'), false);
  assert.equal(isSafeRelativeRedirect('/foo\r\nSet-Cookie: a=b'), false);
});

test('safeJsonLdStringify escapes HTML script breakout characters', () => {
  const payload = {
    name: '</script><script>alert(1)</script>&test\u2028\u2029',
  };
  const serialized = safeJsonLdStringify(payload);
  assert.equal(serialized.includes('</script>'), false);
  assert.equal(serialized.includes('<'), false);
  assert.equal(serialized.includes('>'), false);
  assert.equal(serialized.includes('&'), false);
  assert.ok(serialized.includes('\\u003c/script\\u003e'));
});

test('sanitizeBaseUrl validates APP_URL and host/proto headers strictly', () => {
  assert.equal(
    sanitizeBaseUrl('https://nextrade.ai/', 'evil.example', 'http', 3000),
    'https://nextrade.ai',
  );
  assert.equal(
    sanitizeBaseUrl('MY_APP_URL', 'localhost:3000', 'http', 3000),
    'http://localhost:3000',
  );
  assert.equal(
    sanitizeBaseUrl(undefined, 'evil.example"\r\nX: y', 'javascript', 3000),
    'http://localhost:3000',
  );
  assert.equal(
    sanitizeBaseUrl(undefined, 'app.nextrade.ai', 'https, http', 3000),
    'https://app.nextrade.ai',
  );
});

test('stripControlChars removes CR/LF and control characters and caps length', () => {
  assert.equal(stripControlChars('Alice\r\nInjected: header\x00', 50), 'Alice Injected: header');
  assert.equal(
    stripControlChars('Line 1\r\nLine 2\x00', 50, { allowNewlines: true }),
    'Line 1\nLine 2',
  );
  assert.equal(stripControlChars('abcdef', 3), 'abc');
});

test('sanitizePortfolioState rejects corrupted NaN/negative localStorage payloads', () => {
  const corrupted = {
    cashBalanceUsd: NaN,
    realizedPnlUsd: 0,
    holdings: [],
    orders: [],
  };
  assert.deepEqual(
    sanitizePortfolioState(corrupted, CLEAN_PAPER_TRADING_STATE),
    CLEAN_PAPER_TRADING_STATE,
  );

  const negativeCash = {
    ...CLEAN_PAPER_TRADING_STATE,
    cashBalanceUsd: -50,
  };
  assert.deepEqual(
    sanitizePortfolioState(negativeCash, CLEAN_PAPER_TRADING_STATE),
    CLEAN_PAPER_TRADING_STATE,
  );

  const valid = sanitizePortfolioState(CLEAN_PAPER_TRADING_STATE, CLEAN_PAPER_TRADING_STATE);
  assert.equal(valid.holdings.length, CLEAN_PAPER_TRADING_STATE.holdings.length);
});

test('sanitizeWatchlist keeps only clean bounded uppercase ticker symbols', () => {
  const cleaned = sanitizeWatchlist(
    ['nvda', 'NVDA', '<script>', 'RELIANCE.NS', 42, '   '],
    ['NVDA'],
  );
  assert.deepEqual(cleaned, ['NVDA', 'RELIANCE.NS']);
});

test('SlidingWindowRateLimiter enforces limits, Retry-After, and bounded keys', () => {
  const limiter = new SlidingWindowRateLimiter(2, 60_000, 3);
  assert.equal(limiter.check('1.1.1.1', 1000).allowed, true);
  assert.equal(limiter.check('1.1.1.1', 2000).allowed, true);

  const blocked = limiter.check('1.1.1.1', 3000);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSeconds >= 58);

  // Window expires cleanly
  assert.equal(limiter.check('1.1.1.1', 62_000).allowed, true);

  // Bounded maxTrackedKeys does not throw when exceeded
  limiter.check('2.2.2.2', 62_000);
  limiter.check('3.3.3.3', 62_000);
  limiter.check('4.4.4.4', 62_000);
});
