CREATE TABLE "buildings" (
	"code" text PRIMARY KEY NOT NULL,
	"registration_limit" integer NOT NULL,
	CONSTRAINT "building_limit_nonnegative" CHECK ("buildings"."registration_limit" >= 0)
);
--> statement-breakpoint
CREATE TABLE "gate_requests" (
	"gate_id" text NOT NULL,
	"request_id" uuid NOT NULL,
	"vehicle_type" text NOT NULL,
	"is_resident" boolean NOT NULL,
	"plate" text NOT NULL,
	"session_id" uuid,
	CONSTRAINT "gate_requests_gate_id_request_id_pk" PRIMARY KEY("gate_id","request_id")
);
--> statement-breakpoint
CREATE TABLE "residents" (
	"building_code" text NOT NULL,
	"plate" text NOT NULL,
	CONSTRAINT "residents_building_code_plate_pk" PRIMARY KEY("building_code","plate")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"building_code" text NOT NULL,
	"space_number" integer NOT NULL,
	"plate" text NOT NULL,
	"vehicle_type" text NOT NULL,
	"category" text NOT NULL,
	"checked_in_at" timestamp with time zone DEFAULT now() NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "session_vehicle" CHECK ("sessions"."vehicle_type" in ('CAR','MOTOR')),
	CONSTRAINT "session_category" CHECK ("sessions"."category" in ('RESIDENT','CAR','MOTOR'))
);
--> statement-breakpoint
CREATE TABLE "spaces" (
	"building_code" text NOT NULL,
	"number" integer NOT NULL,
	"floor" integer NOT NULL,
	"category" text NOT NULL,
	CONSTRAINT "spaces_building_code_number_pk" PRIMARY KEY("building_code","number"),
	CONSTRAINT "space_category" CHECK ("spaces"."category" in ('RESIDENT','CAR','MOTOR'))
);
--> statement-breakpoint
ALTER TABLE "gate_requests" ADD CONSTRAINT "gate_requests_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "residents" ADD CONSTRAINT "residents_building_code_buildings_code_fk" FOREIGN KEY ("building_code") REFERENCES "public"."buildings"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_building_code_space_number_spaces_building_code_number_fk" FOREIGN KEY ("building_code","space_number") REFERENCES "public"."spaces"("building_code","number") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spaces" ADD CONSTRAINT "spaces_building_code_buildings_code_fk" FOREIGN KEY ("building_code") REFERENCES "public"."buildings"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "active_session_plate" ON "sessions" USING btree ("building_code","plate") WHERE "sessions"."active";--> statement-breakpoint
CREATE UNIQUE INDEX "active_session_space" ON "sessions" USING btree ("building_code","space_number") WHERE "sessions"."active";