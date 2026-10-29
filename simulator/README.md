# Payment provider simulator

Sends payment confirmations to your API the way the payment provider does (see
`docs/payment-provider.md`): a JSON body, signed in the `X-Signature` header with the hex HMAC-SHA256
of the raw body.

```bash
npm install
export WEBHOOK_SECRET=<the secret your API uses to verify payment calls>

# one confirmation
node send-webhook.mjs --session <parkingSessionId> --amount 1500

# the provider retrying the same call three times
node send-webhook.mjs --session <parkingSessionId> --amount 1500 --times 3

# a failed payment
node send-webhook.mjs --session <parkingSessionId> --amount 1500 --status FAILED

# a declined card, then a successful one, with retries arriving out of order
node send-webhook.mjs --session <parkingSessionId> --amount 1500 --scenario declined-retry

# an exit terminal on old firmware, which cannot sign (see the provider's notes, section 4)
node send-webhook.mjs --session <parkingSessionId> --amount 1500 --legacy-terminal
```

Options: `--url` (default `http://localhost:3000/webhooks/payments`), `--payment-id` (default: a new
UUID per run), `--times` (default 1). Amounts are in cents.
