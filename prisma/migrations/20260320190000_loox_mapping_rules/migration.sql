CREATE TABLE IF NOT EXISTS "loox_product_mappings" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "shop_id" TEXT NOT NULL,
  "loox_ref" TEXT NOT NULL,
  "loox_product_id" TEXT,
  "loox_handle" TEXT,
  "target_product_gid" TEXT NOT NULL,
  "target_product_title" TEXT,
  "target_product_handle" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE("shop_id", "loox_ref")
);
CREATE INDEX IF NOT EXISTS "loox_product_mappings_shop_idx" ON "loox_product_mappings" ("shop_id");
