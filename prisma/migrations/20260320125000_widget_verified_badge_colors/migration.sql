ALTER TABLE "review_widget_settings"
  ADD COLUMN IF NOT EXISTS "verified_badge_color" TEXT NOT NULL DEFAULT '#eef2ff',
  ADD COLUMN IF NOT EXISTS "verified_badge_text_color" TEXT NOT NULL DEFAULT '#4f46e5';
