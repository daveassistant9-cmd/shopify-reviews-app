ALTER TABLE "review_widget_settings"
  ADD COLUMN IF NOT EXISTS "show_review_count" BOOLEAN NOT NULL DEFAULT true;
