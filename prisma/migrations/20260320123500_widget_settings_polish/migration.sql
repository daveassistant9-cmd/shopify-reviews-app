ALTER TABLE "review_widget_settings"
  ADD COLUMN IF NOT EXISTS "section_heading" TEXT NOT NULL DEFAULT 'Customer reviews',
  ADD COLUMN IF NOT EXISTS "empty_state_text" TEXT NOT NULL DEFAULT 'No reviews yet',
  ADD COLUMN IF NOT EXISTS "verified_badge_label" TEXT NOT NULL DEFAULT 'Verified';
