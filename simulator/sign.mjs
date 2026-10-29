import { createHmac } from 'node:crypto';

// The provider signs the exact bytes it sends: the hex HMAC-SHA256 of the raw request body.
export function sign(rawBody, secret) {
  return createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
}

export function buildPayment({ paymentId, parkingSessionId, amountCents, status }) {
  return {
    paymentId,
    parkingSessionId,
    amount: { value: amountCents, currency: 'EUR' },
    status,
  };
}

// The body as the provider puts it on the wire.
export function serializePayment(payment) {
  return `${JSON.stringify(payment, null, 2)}\n`;
}
