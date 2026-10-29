import { randomUUID } from 'node:crypto';
import { buildPayment } from './sign.mjs';

// The driver's first card is declined and the second one pays. The provider retries both calls, and
// the late retry of the declined attempt arrives last.
export function declinedRetry(parkingSessionId, amountCents, newId = randomUUID) {
  const declined = newId();
  const paid = newId();
  return [
    { label: 'attempt 1, declined', paymentId: declined, status: 'FAILED' },
    { label: 'attempt 2, paid', paymentId: paid, status: 'PAID' },
    { label: 'attempt 2, paid (retry)', paymentId: paid, status: 'PAID' },
    { label: 'attempt 1, declined (late retry)', paymentId: declined, status: 'FAILED' },
  ].map((call) => ({
    label: call.label,
    payment: buildPayment({ paymentId: call.paymentId, parkingSessionId, amountCents, status: call.status }),
  }));
}
