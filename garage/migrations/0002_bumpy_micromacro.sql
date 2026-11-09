CREATE TABLE "checkout_payments" (
	"payment_id" text PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"amount" integer NOT NULL,
	"confirmed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "checkout_payment_positive" CHECK ("checkout_payments"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "checkout_requests" (
	"gate_id" text NOT NULL,
	"request_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"is_resident" boolean NOT NULL,
	"quoted_amount" integer,
	"paid_at_quote" integer,
	"response" jsonb,
	CONSTRAINT "checkout_requests_gate_id_request_id_pk" PRIMARY KEY("gate_id","request_id")
);
--> statement-breakpoint
ALTER TABLE "checkout_payments" ADD CONSTRAINT "checkout_payments_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;
