import prisma from "../db.server";

export const DEFAULT_WIDGET_SETTINGS = {
  star_color: "#f59e0b",
  text_color: "#111827",
  meta_text_color: "#6b7280",
  card_bg_color: "#ffffff",
  card_border_color: "#e5e7eb",
  border_radius_px: 12,
  font_family: "Inter, system-ui, sans-serif",
  heading_size_px: 20,
  body_size_px: 14,
  meta_size_px: 12,
  card_spacing_px: 12,
  desktop_columns: 3,
  mobile_columns: 2,
  show_verified_badge: true,
  show_review_date: true,
  show_rating_breakdown: true,
  show_write_review_btn: true,
  write_review_label: "Write a review",
  section_heading: "Customer reviews",
  empty_state_text: "No reviews yet",
  verified_badge_label: "Verified",
  verified_badge_color: "#eef2ff",
  verified_badge_text_color: "#4f46e5",
  summary_star_size_px: 15,
  summary_text_size_px: 14,
  show_review_count: true,
  modal_title: "Write a review",
  modal_subtitle: "Share your experience with this product",
  modal_name_label: "Your name",
  modal_rating_label: "Rating",
  modal_review_title_label: "Review title",
  modal_review_body_label: "Review",
  modal_image_label: "Images (optional)",
  modal_submit_label: "Submit review",
  modal_success_message: "Thanks! Your review was submitted for moderation.",
  modal_error_message: "Failed to submit review",
  modal_close_label: "Close",
  modal_image_helper_text: "You can upload up to 5 images",
  initial_reviews_limit: 20,
  load_more_step: 20,
  load_more_label: "Load more reviews",
  default_sort_mode: "image_first",
};

const prismaAny = prisma as unknown as Record<string, any>;
const getSettingsDelegate = () => prismaAny.widgetSettings ?? prismaAny.review_widget_settings;

async function ensureWidgetSettingsColumns() {
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "review_widget_settings"
      ADD COLUMN IF NOT EXISTS "section_heading" TEXT NOT NULL DEFAULT 'Customer reviews',
      ADD COLUMN IF NOT EXISTS "empty_state_text" TEXT NOT NULL DEFAULT 'No reviews yet',
      ADD COLUMN IF NOT EXISTS "verified_badge_label" TEXT NOT NULL DEFAULT 'Verified',
      ADD COLUMN IF NOT EXISTS "verified_badge_color" TEXT NOT NULL DEFAULT '#eef2ff',
      ADD COLUMN IF NOT EXISTS "verified_badge_text_color" TEXT NOT NULL DEFAULT '#4f46e5',
      ADD COLUMN IF NOT EXISTS "summary_star_size_px" INTEGER NOT NULL DEFAULT 15,
      ADD COLUMN IF NOT EXISTS "summary_text_size_px" INTEGER NOT NULL DEFAULT 14,
      ADD COLUMN IF NOT EXISTS "show_review_count" BOOLEAN NOT NULL DEFAULT true,
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
      ADD COLUMN IF NOT EXISTS "modal_image_helper_text" TEXT NOT NULL DEFAULT 'You can upload up to 5 images',
      ADD COLUMN IF NOT EXISTS "initial_reviews_limit" INTEGER NOT NULL DEFAULT 20,
      ADD COLUMN IF NOT EXISTS "load_more_step" INTEGER NOT NULL DEFAULT 20,
      ADD COLUMN IF NOT EXISTS "load_more_label" TEXT NOT NULL DEFAULT 'Load more reviews',
      ADD COLUMN IF NOT EXISTS "default_sort_mode" TEXT NOT NULL DEFAULT 'image_first'
  `);
}

export async function getWidgetSettings(shopId: string) {
  const delegate = getSettingsDelegate();
  if (delegate?.findUnique) {
    const row = await delegate.findUnique({ where: { shop_id: shopId } });
    return row ? { ...DEFAULT_WIDGET_SETTINGS, ...row } : DEFAULT_WIDGET_SETTINGS;
  }

  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT * FROM "review_widget_settings" WHERE shop_id = $1 LIMIT 1`,
    shopId,
  );
  return rows[0] ? { ...DEFAULT_WIDGET_SETTINGS, ...rows[0] } : DEFAULT_WIDGET_SETTINGS;
}

export async function upsertWidgetSettings(shopId: string, input: Partial<typeof DEFAULT_WIDGET_SETTINGS>) {
  const delegate = getSettingsDelegate();
  const merged = { ...DEFAULT_WIDGET_SETTINGS, ...input };

  await ensureWidgetSettingsColumns();

  if (delegate?.upsert) {
    try {
      return await delegate.upsert({
        where: { shop_id: shopId },
        update: input,
        create: {
          shop_id: shopId,
          ...merged,
        },
      });
    } catch (error) {
      const msg = String((error as Error)?.message || "");
      if (!msg.includes("Unknown argument") && !msg.includes("section_heading") && !msg.includes("empty_state_text") && !msg.includes("verified_badge_label") && !msg.includes("verified_badge_color") && !msg.includes("verified_badge_text_color") && !msg.includes("summary_star_size_px") && !msg.includes("summary_text_size_px") && !msg.includes("show_review_count") && !msg.includes("modal_") && !msg.includes("initial_reviews_limit") && !msg.includes("load_more_step") && !msg.includes("load_more_label") && !msg.includes("default_sort_mode")) {
        throw error;
      }
    }
  }

  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `INSERT INTO "review_widget_settings" (
        id, shop_id, star_color, text_color, meta_text_color, card_bg_color, card_border_color,
        border_radius_px, font_family, heading_size_px, body_size_px, meta_size_px, card_spacing_px,
        desktop_columns, mobile_columns, show_verified_badge, show_review_date, show_rating_breakdown,
        show_write_review_btn, write_review_label, section_heading, empty_state_text, verified_badge_label,
        verified_badge_color, verified_badge_text_color, summary_star_size_px, summary_text_size_px, show_review_count,
        modal_title, modal_subtitle, modal_name_label, modal_rating_label, modal_review_title_label, modal_review_body_label,
        modal_image_label, modal_submit_label, modal_success_message, modal_error_message, modal_close_label, modal_image_helper_text,
        initial_reviews_limit, load_more_step, load_more_label, default_sort_mode,
        created_at, updated_at
      ) VALUES (
        gen_random_uuid(), $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10, $11, $12,
        $13, $14, $15, $16, $17,
        $18, $19, $20, $21, $22,
        $23, $24, $25, $26, $27,
        $28, $29, $30, $31, $32, $33,
        $34, $35, $36, $37, $38, $39,
        $40, $41, $42, $43,
        now(), now()
      )
      ON CONFLICT (shop_id) DO UPDATE SET
        star_color = EXCLUDED.star_color,
        text_color = EXCLUDED.text_color,
        meta_text_color = EXCLUDED.meta_text_color,
        card_bg_color = EXCLUDED.card_bg_color,
        card_border_color = EXCLUDED.card_border_color,
        border_radius_px = EXCLUDED.border_radius_px,
        font_family = EXCLUDED.font_family,
        heading_size_px = EXCLUDED.heading_size_px,
        body_size_px = EXCLUDED.body_size_px,
        meta_size_px = EXCLUDED.meta_size_px,
        card_spacing_px = EXCLUDED.card_spacing_px,
        desktop_columns = EXCLUDED.desktop_columns,
        mobile_columns = EXCLUDED.mobile_columns,
        show_verified_badge = EXCLUDED.show_verified_badge,
        show_review_date = EXCLUDED.show_review_date,
        show_rating_breakdown = EXCLUDED.show_rating_breakdown,
        show_write_review_btn = EXCLUDED.show_write_review_btn,
        write_review_label = EXCLUDED.write_review_label,
        section_heading = EXCLUDED.section_heading,
        empty_state_text = EXCLUDED.empty_state_text,
        verified_badge_label = EXCLUDED.verified_badge_label,
        verified_badge_color = EXCLUDED.verified_badge_color,
        verified_badge_text_color = EXCLUDED.verified_badge_text_color,
        summary_star_size_px = EXCLUDED.summary_star_size_px,
        summary_text_size_px = EXCLUDED.summary_text_size_px,
        show_review_count = EXCLUDED.show_review_count,
        modal_title = EXCLUDED.modal_title,
        modal_subtitle = EXCLUDED.modal_subtitle,
        modal_name_label = EXCLUDED.modal_name_label,
        modal_rating_label = EXCLUDED.modal_rating_label,
        modal_review_title_label = EXCLUDED.modal_review_title_label,
        modal_review_body_label = EXCLUDED.modal_review_body_label,
        modal_image_label = EXCLUDED.modal_image_label,
        modal_submit_label = EXCLUDED.modal_submit_label,
        modal_success_message = EXCLUDED.modal_success_message,
        modal_error_message = EXCLUDED.modal_error_message,
        modal_close_label = EXCLUDED.modal_close_label,
        modal_image_helper_text = EXCLUDED.modal_image_helper_text,
        initial_reviews_limit = EXCLUDED.initial_reviews_limit,
        load_more_step = EXCLUDED.load_more_step,
        load_more_label = EXCLUDED.load_more_label,
        default_sort_mode = EXCLUDED.default_sort_mode,
        updated_at = now()
      RETURNING *`,
      shopId,
      merged.star_color,
      merged.text_color,
      merged.meta_text_color,
      merged.card_bg_color,
      merged.card_border_color,
      merged.border_radius_px,
      merged.font_family,
      merged.heading_size_px,
      merged.body_size_px,
      merged.meta_size_px,
      merged.card_spacing_px,
      merged.desktop_columns,
      merged.mobile_columns,
      merged.show_verified_badge,
      merged.show_review_date,
      merged.show_rating_breakdown,
      merged.show_write_review_btn,
      merged.write_review_label,
      merged.section_heading,
      merged.empty_state_text,
      merged.verified_badge_label,
      merged.verified_badge_color,
      merged.verified_badge_text_color,
      merged.summary_star_size_px,
      merged.summary_text_size_px,
      merged.show_review_count,
      merged.modal_title,
      merged.modal_subtitle,
      merged.modal_name_label,
      merged.modal_rating_label,
      merged.modal_review_title_label,
      merged.modal_review_body_label,
      merged.modal_image_label,
      merged.modal_submit_label,
      merged.modal_success_message,
      merged.modal_error_message,
      merged.modal_close_label,
      merged.modal_image_helper_text,
      merged.initial_reviews_limit,
      merged.load_more_step,
      merged.load_more_label,
      merged.default_sort_mode,
    );

    return rows[0];
  } catch (error) {
    throw new Error(
      `Widget settings save failed in strict mode. Required columns must exist and be writable (including summary_star_size_px/summary_text_size_px). Root error: ${String((error as Error)?.message || error)}`,
    );
  }
}
