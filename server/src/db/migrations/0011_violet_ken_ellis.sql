ALTER TABLE "conventions" ALTER COLUMN "repo_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "conventions" ALTER COLUMN "evidence_path" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "conventions" ALTER COLUMN "evidence_snippet" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "conventions" ALTER COLUMN "confidence" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "conventions" ADD COLUMN "category" text NOT NULL;--> statement-breakpoint
ALTER TABLE "conventions" ADD COLUMN "evidence_start_line" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "conventions" ADD COLUMN "evidence_end_line" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "conventions" ADD COLUMN "status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "conventions" ADD COLUMN "skill_id" uuid;--> statement-breakpoint
ALTER TABLE "conventions" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "conventions" ADD CONSTRAINT "conventions_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conventions_ws_repo_idx" ON "conventions" USING btree ("workspace_id","repo_id");--> statement-breakpoint
ALTER TABLE "conventions" DROP COLUMN "accepted";