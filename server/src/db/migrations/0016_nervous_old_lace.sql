CREATE TABLE "eval_run_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"system_prompt_snapshot" text NOT NULL,
	"model_snapshot" text NOT NULL,
	"provider_snapshot" text NOT NULL,
	"agent_version" integer NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"recall" double precision,
	"precision" double precision,
	"citation_accuracy" double precision,
	"recall_denominator" integer DEFAULT 0 NOT NULL,
	"precision_denominator" integer DEFAULT 0 NOT NULL,
	"citation_denominator" integer DEFAULT 0 NOT NULL,
	"cases_total" integer DEFAULT 0 NOT NULL,
	"cases_ran" integer DEFAULT 0 NOT NULL,
	"duration_ms" integer,
	"cost_usd" double precision,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "batch_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "status" text DEFAULT 'failed' NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "error" text;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "matched_count" integer;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "expected_count" integer;--> statement-breakpoint
ALTER TABLE "eval_run_batches" ADD CONSTRAINT "eval_run_batches_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "eval_run_batches_agent_running_uq" ON "eval_run_batches" USING btree ("agent_id") WHERE status = 'running';--> statement-breakpoint
CREATE INDEX "eval_run_batches_ws_agent_idx" ON "eval_run_batches" USING btree ("workspace_id","agent_id","started_at");--> statement-breakpoint
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_batch_id_eval_run_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."eval_run_batches"("id") ON DELETE cascade ON UPDATE no action;