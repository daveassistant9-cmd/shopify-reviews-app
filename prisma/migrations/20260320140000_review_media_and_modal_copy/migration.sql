CREATE TABLE IF NOT EXISTS "review_media" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "review_id" UUID NOT NULL,
  "shop_id" TEXT NOT NULL,
  "media_url" TEXT NOT NULL,
  "media_type" TEXT NOT NULL DEFAULT 'image',
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "review_media_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "reviews"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "review_media_review_id_sort_order_idx" ON "review_media" ("review_id", "sort_order");
CREATE INDEX IF NOT EXISTS "review_media_shop_id_idx" ON "review_media" ("shop_id");

ALTER TABLE "review_widget_settings"
  ADD COLUMN IF NOT EXISTS "modal_title" TEXT NOT NULL DEFAULT 'Write a review',
  ADD COLUMN IF NOT EXISTS "modal_subtitle" TEXT NOT NULL DEFAULT 'Share your experience with this product',
  ADD COLUMN IF NOT EXISTS "modal_name_label" TEXT NOT NULL DEFAULT 'Your name',
  ADD COLUMN IF NOT EXISTS "modal_rating_label" TEXT NOT NULL DEFAULT 'Rating',
  ADD COLUMN IF NOT EXISTS "modal_review_title_label" TEXT NOT NULL DEFAULT 'Review title',
  ADD COLUMN IF NOT EXISTS "modal_review_body_label" TEXT NOT NULL DEFAULT 'Review',
  ADD COLUMN IF NOT EXISTS "modal_image_label" TEXT NOT NULL DEFAULT 'Images (optional)',
  ADD COLUMN IF NOT EXISTS "modal_submit_label" TEXT NOT NULL DEFAULT 'Submit review',
  ADD COLUMN IF NOT EXISTS "modal_success_message" TEXT NOT NULL DEFAULT 'Thanks! Your review was submitted for moderation.',
  ADD COLUMN IF NOT EXISTS "modal_error_message" TEXT NOT NULL DEFAULT 'Failed to submit review',
  ADD COLUMN IF NOT EXISTS "modal_close_label" TEXT NOT NULL DEFAULT 'Close',
  ADD COLUMN IF NOT EXISTS "modal_image_helper_text" TEXT NOT NULL DEFAULT 'You can upload up to 5 images';
