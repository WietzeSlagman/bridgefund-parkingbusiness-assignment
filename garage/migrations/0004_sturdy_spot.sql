ALTER TABLE "sessions" DROP CONSTRAINT "session_current_amount_positive";--> statement-breakpoint
ALTER TABLE "checkout_requests" ADD COLUMN "is_current" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Existing PB-05 installations may have an open session amount. Transfer it
-- only when a single eligible request unambiguously represents that amount.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM sessions s
    WHERE s.active AND s.current_amount IS NOT NULL AND
      (SELECT count(*) FROM checkout_requests r
       WHERE r.session_id = s.id AND NOT r.superseded AND r.response IS NULL
         AND r.quoted_amount = s.current_amount
         AND r.paid_at_quote = (SELECT coalesce(sum(p.amount), 0) FROM checkout_payments p WHERE p.session_id = s.id)) <> 1
  ) THEN
    RAISE EXCEPTION 'Cannot identify current checkout request; operator investigation required';
  END IF;
END $$;--> statement-breakpoint
UPDATE checkout_requests r SET is_current = true
FROM sessions s
WHERE s.id = r.session_id AND s.active AND s.current_amount IS NOT NULL
  AND NOT r.superseded AND r.response IS NULL AND r.quoted_amount = s.current_amount
  AND r.paid_at_quote = (SELECT coalesce(sum(p.amount), 0) FROM checkout_payments p WHERE p.session_id = s.id);--> statement-breakpoint
CREATE UNIQUE INDEX "checkout_current_session" ON "checkout_requests" USING btree ("session_id") WHERE "checkout_requests"."is_current";--> statement-breakpoint
ALTER TABLE "sessions" DROP COLUMN "current_amount";--> statement-breakpoint
ALTER TABLE "checkout_requests" ADD CONSTRAINT "checkout_current_valid" CHECK (not "checkout_requests"."is_current" or ("checkout_requests"."quoted_amount" is not null and "checkout_requests"."quoted_amount" > 0 and "checkout_requests"."paid_at_quote" is not null and "checkout_requests"."paid_at_quote" >= 0 and not "checkout_requests"."superseded" and "checkout_requests"."response" is null));
