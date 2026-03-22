-- AlterTable
ALTER TABLE "reviews" ADD COLUMN "image_url" TEXT;

-- CreateTable
CREATE TABLE "review_widget_settings" (
  "id" UUID NOT NULL,
  "shop_id" TEXT NOT NULL,
  "star_color" TEXT NOT NULL DEFAULT '#f59e0b',
  "text_color" TEXT NOT NULL DEFAULT '#111827',
  "meta_text_color" TEXT NOT NULL DEFAULT '#6b7280',
  "card_bg_color" TEXT NOT NULL DEFAULT '#ffffff',
  "card_border_color" TEXT NOT NULL DEFAULT '#e5e7eb',
  "border_radius_px" INTEGER NOT NULL DEFAULT 12,
  "font_family" TEXT NOT NULL DEFAULT 'Inter, system-ui, sans-serif',
  "heading_size_px" INTEGER NOT NULL DEFAULT 20,
  "body_size_px" INTEGER NOT NULL DEFAULT 14,
  "meta_size_px" INTEGER NOT NULL DEFAULT 12,
  "card_spacing_px" INTEGER NOT NULL DEFAULT 12,
  "desktop_columns" INTEGER NOT NULL DEFAULT 3,
  "mobile_columns" INTEGER NOT NULL DEFAULT 2,
  "show_verified_badge" BOOLEAN NOT NULL DEFAULT true,
  "show_review_date" BOOLEAN NOT NULL DEFAULT true,
  "show_rating_breakdown" BOOLEAN NOT NULL DEFAULT true,
  "show_write_review_btn" BOOLEAN NOT NULL DEFAULT true,
  "write_review_label" TEXT NOT NULL DEFAULT 'Write a review',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "review_widget_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "review_widget_settings_shop_id_key" ON "review_widget_settings"("shop_id");
