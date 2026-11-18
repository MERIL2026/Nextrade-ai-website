import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluatePasswordStrength,
  normalizeEmail,
  validateEmailAddress,
  validateFullName,
} from './authValidation';

test('normalizeEmail trims, strips control chars, and lowercases', () => {
  assert.equal(normalizeEmail('  Aarav.Mehta@Example.COM \n'), 'aarav.mehta@example.com');
  assert.equal(normalizeEmail(123), '');
});

test('validateEmailAddress enforces valid domain formatting', () => {
  assert.equal(validateEmailAddress('analyst@nextrade.ai').valid, true);
  assert.equal(validateEmailAddress('invalid-email').valid, false);
  assert.equal(validateEmailAddress('missing@tld').valid, false);
});

test('validateFullName normalizes whitespace and rejects too-short strings', () => {
  const ok = validateFullName('  Riya   Sharma ');
  assert.equal(ok.valid, true);
  assert.equal(ok.cleaned, 'Riya Sharma');

  assert.equal(validateFullName('A').valid, false);
  assert.equal(validateFullName(null).valid, false);
});

test('evaluatePasswordStrength enforces length, character classes, common list, and identity checks', () => {
  const shortPw = evaluatePasswordStrength('Ab1!xyz');
  assert.equal(shortPw.valid, false);
  assert.equal(shortPw.checks.minLength, false);

  const missingSymbol = evaluatePasswordStrength('StrongPass123');
  assert.equal(missingSymbol.valid, false);
  assert.equal(missingSymbol.checks.hasSpecial, false);

  const commonPw = evaluatePasswordStrength('Password123!');
  assert.equal(commonPw.valid, false);
  assert.equal(commonPw.checks.notCommon, false);

  const identityPw = evaluatePasswordStrength('MyAaravPass99!', {
    fullName: 'Aarav Mehta',
    email: 'aarav@example.com',
  });
  assert.equal(identityPw.valid, false);
  assert.equal(identityPw.checks.notCommon, false);

  const strong = evaluatePasswordStrength('QuantumLedger#2026!', {
    fullName: 'Aarav Mehta',
    email: 'aarav@example.com',
  });
  assert.equal(strong.valid, true);
  assert.equal(strong.label, 'Strong');
  assert.equal(strong.score, 4);
});
