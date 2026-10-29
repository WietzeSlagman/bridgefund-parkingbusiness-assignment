#!/usr/bin/env node
// Sends payment confirmations to your API, the way the payment provider would.
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { declinedRetry } from './scenario.mjs';
import { buildPayment, serializePayment, sign } from './sign.mjs';

// Exit terminals on firmware older than 4.2 (docs/payment-provider.md, section 4).
const LEGACY_HEADER = 'X-Terminal-Compat';
const SCENARIOS = ['declined-retry'];

const USAGE =
  'Usage: node send-webhook.mjs --session <parkingSessionId> --amount <cents> ' +
  '[--status PAID|FAILED] [--payment-id <id>] [--times <n>] [--scenario declined-retry] ' +
  '[--legacy-terminal] [--url <url>]';

const { values } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://localhost:3000/webhooks/payments' },
    session: { type: 'string' },
    amount: { type: 'string' },
    status: { type: 'string', default: 'PAID' },
    'payment-id': { type: 'string' },
    times: { type: 'string', default: '1' },
    scenario: { type: 'string' },
    'legacy-terminal': { type: 'boolean', default: false },
  },
});

const legacy = values['legacy-terminal'];
const secret = process.env.WEBHOOK_SECRET;
if (!secret && !legacy) {
  console.error('WEBHOOK_SECRET is not set. Export the secret your API uses to verify payment calls, then run this again.');
  process.exit(1);
}

// Digits only: "15.00" is rejected rather than read as 15 cents.
const wholeNumber = /^\d+$/;
if (
  !values.session ||
  !wholeNumber.test(values.amount ?? '') ||
  !wholeNumber.test(values.times) ||
  Number(values.times) < 1 ||
  (values.scenario !== undefined && !SCENARIOS.includes(values.scenario))
) {
  console.error(USAGE);
  process.exit(1);
}
const amountCents = Number(values.amount);

let calls;
if (values.scenario === 'declined-retry') {
  calls = declinedRetry(values.session, amountCents);
} else {
  // The provider retries until it gets a 2xx, so --times sends the identical call again.
  const payment = buildPayment({
    paymentId: values['payment-id'] ?? randomUUID(),
    parkingSessionId: values.session,
    amountCents,
    status: values.status,
  });
  calls = Array.from({ length: Number(values.times) }, (_, i) => ({ label: `attempt ${i + 1}`, payment }));
}

const { default: axios } = await import('axios');

for (const call of calls) {
  const body = serializePayment(call.payment);
  const headers = legacy
    ? { 'Content-Type': 'application/json', [LEGACY_HEADER]: '1' }
    : { 'Content-Type': 'application/json', 'X-Signature': sign(body, secret) };
  const label = legacy ? `${call.label}, legacy terminal` : call.label;
  try {
    const res = await axios.post(values.url, body, {
      headers,
      transformRequest: [(data) => data],
      validateStatus: () => true,
    });
    console.log(`${label}: HTTP ${res.status}`);
  } catch (err) {
    console.error(`${label}: ${err.message}`);
    process.exitCode = 1;
  }
  if (calls.length > 1) await sleep(150);
}

if (values.scenario === 'declined-retry') {
  console.log(`Expected: session ${values.session} ends up paid, by attempt 2.`);
}
