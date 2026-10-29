# Payment provider: integration notes for ParkingBusiness

From the provider's integration support team.

## 1. Payment confirmations

We send a `POST` to your webhook URL for every payment attempt at the exit. The body is JSON:

```
{
  "paymentId": "string",
  "parkingSessionId": "uuid",
  "amount": { "value": 1500, "currency": "EUR" },
  "status": "PAID" | "FAILED"
}
```

Amounts are in cents. Every payment attempt has its own `paymentId`.

## 2. Signatures

Every call carries `X-Signature`: the lowercase hex HMAC-SHA256 of the raw request body, keyed with the
secret we share with you. Reject calls whose signature does not match.

## 3. Delivery

- Delivery is at least once. If you do not answer with a 2xx within 5 seconds, we send the same call
  again, with the same `paymentId` and the same body: after 10 seconds, 1 minute, 10 minutes, 1 hour,
  and then every hour for 24 hours.
- Calls are not delivered in order. When a driver's card is declined and they pay with another card,
  you receive a `FAILED` for the first attempt and a `PAID` for the second, and a retry of the `FAILED`
  can arrive after the `PAID`.

## 4. Legacy exit terminals

Some exit terminals still run firmware older than 4.2 and cannot sign requests. They call your webhook
directly and send `X-Terminal-Compat: 1` instead of an `X-Signature`. Please accept these calls until every
terminal is upgraded (planned for Q2 2027); otherwise drivers who pay at those terminals cannot leave
the garage.

## 5. Testing

`simulator/` sends calls the way we do, including retries, declined attempts and legacy terminals.
