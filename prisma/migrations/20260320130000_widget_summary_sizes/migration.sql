ALTER TABLE "review_widget_settings"
  ADD COLUMN IF NOT EXISTS "summary_star_size_px" INTEGER NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS "summary_text_size_px" INTEGER NOT NULL DEFAULT 14;
