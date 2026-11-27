ALTER TABLE "agent_skills" ADD COLUMN IF NOT EXISTS "web_safe_scan_passed" boolean DEFAULT true NOT NULL;
