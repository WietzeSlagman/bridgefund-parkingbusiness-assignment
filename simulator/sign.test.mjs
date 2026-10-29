import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { declinedRetry } from './scenario.mjs';
import { buildPayment, serializePayment, sign } from './sign.mjs';

const script = fileURLToPath(new URL('./send-webhook.mjs', import.meta.url));

function run(args, env) {
  return spawnSync(process.execPath, [script, ...args], { env, encoding: 'utf8' });
}

function envWithout(name) {
  const env = { ...process.env };
  delete env[name];
  return env;
}

test('signs with HMAC-SHA256 as hex (published test vector)', () => {
  assert.equal(
    sign('The quick brown fox jumps over the lazy dog', 'key'),
    'f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8',
  );
});

test('one changed byte in the body changes the signature', () => {
  assert.notEqual(sign('{"value":100}', 'secret'), sign('{"value":101}', 'secret'));
});

test('builds the payment body the provider sends', () => {
  assert.deepEqual(
    buildPayment({ paymentId: 'pay_1', parkingSessionId: 'ses_1', amountCents: 1500, status: 'PAID' }),
    { paymentId: 'pay_1', parkingSessionId: 'ses_1', amount: { value: 1500, currency: 'EUR' }, status: 'PAID' },
  );
});

test('serialises the payment as JSON ending in a newline', () => {
  const payment = buildPayment({ paymentId: 'pay_1', parkingSessionId: 'ses_1', amountCents: 1500, status: 'PAID' });
  const body = serializePayment(payment);
  assert.deepEqual(JSON.parse(body), payment);
  assert.ok(body.endsWith('\n'));
});

test('declined-retry: declined, paid, paid again, then the late declined retry', () => {
  let n = 0;
  const calls = declinedRetry('ses_1', 1500, () => `pay_${++n}`);
  assert.deepEqual(
    calls.map((c) => [c.payment.paymentId, c.payment.status]),
    [['pay_1', 'FAILED'], ['pay_2', 'PAID'], ['pay_2', 'PAID'], ['pay_1', 'FAILED']],
  );
  assert.ok(calls.every((c) => c.payment.parkingSessionId === 'ses_1' && c.payment.amount.value === 1500));
});

test('refuses to run without WEBHOOK_SECRET', () => {
  const res = run(['--session', 'ses_1', '--amount', '1500'], envWithout('WEBHOOK_SECRET'));
  assert.equal(res.status, 1);
  assert.match(res.stderr, /WEBHOOK_SECRET is not set/);
});

test('a legacy terminal needs no secret, because it does not sign', () => {
  const res = run(['--legacy-terminal', '--session', 'ses_1', '--amount', '15.00'], envWithout('WEBHOOK_SECRET'));
  assert.equal(res.status, 1);
  assert.match(res.stderr, /^Usage:/);
});

test('prints usage when the amount is not whole cents', () => {
  const res = run(['--session', 'ses_1', '--amount', '15.00'], { ...process.env, WEBHOOK_SECRET: 'test-secret' });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /^Usage:/);
});

test('prints usage for an unknown scenario', () => {
  const res = run(['--session', 'ses_1', '--amount', '1500', '--scenario', 'chaos'], { ...process.env, WEBHOOK_SECRET: 'test-secret' });
  assert.equal(res.status, 1);
  assert.match(res.stderr, /^Usage:/);
});
