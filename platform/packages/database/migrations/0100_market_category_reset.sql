-- Reset legacy market categories to the new taxonomy default
UPDATE market_agents SET category = 'other' WHERE category IS NULL OR category NOT IN (
  'data-analytics', 'product-manager', 'new-media', 'marketing', 'coding',
  'designer', 'user-research', 'hr-finance', 'other'
);
--> statement-breakpoint
UPDATE market_skills SET category = 'other' WHERE category IS NULL OR category NOT IN (
  'data-analytics', 'product-planning', 'content-creation', 'marketing', 'ops-analytics',
  'design-creation', 'research-insight', 'report-writing', 'deep-thinking', 'other'
);
--> statement-breakpoint
UPDATE market_mcps SET category = 'other' WHERE category IS NULL OR category NOT IN (
  'data-storage', 'collaboration', 'info-fetch', 'coding', 'business-system',
  'user-feedback', 'design-assets', 'project-management', 'other'
);
