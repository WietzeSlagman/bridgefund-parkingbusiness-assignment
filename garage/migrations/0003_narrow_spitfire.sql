-- PB-04 did not retain quote ordering. Do not guess the current quote on upgrade.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM checkout_requests r JOIN sessions s ON s.id=r.session_id WHERE s.active AND r.quoted_amount IS NOT NULL) THEN
    RAISE EXCEPTION 'Active checkout amounts require operator resolution before PB-05 migration';
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "checkout_requests" ADD COLUMN "superseded" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "current_amount" integer;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "session_current_amount_positive" CHECK ("sessions"."current_amount" is null or "sessions"."current_amount" > 0);
