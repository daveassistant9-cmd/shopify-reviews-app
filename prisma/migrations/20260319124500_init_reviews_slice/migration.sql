-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('draft', 'published', 'unpublished');

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reviews" (
    "id" UUID NOT NULL,
    "shop_id" TEXT NOT NULL,
    "product_gid" TEXT NOT NULL,
    "product_handle_snapshot" TEXT,
    "product_title_snapshot" TEXT,
    "reviewer_name" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "title" TEXT,
    "body" TEXT NOT NULL,
    "status" "ReviewStatus" NOT NULL DEFAULT 'draft',
    "submitted_at" TIMESTAMP(3),
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_aggregates" (
    "id" UUID NOT NULL,
    "shop_id" TEXT NOT NULL,
    "product_gid" TEXT NOT NULL,
    "review_count_published" INTEGER NOT NULL DEFAULT 0,
    "rating_avg_published" DECIMAL(4,2) NOT NULL DEFAULT 0,
    "rating_distribution" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_aggregates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reviews_shop_id_product_gid_status_idx" ON "reviews"("shop_id", "product_gid", "status");

-- CreateIndex
CREATE INDEX "reviews_status_created_at_idx" ON "reviews"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "product_aggregates_shop_id_product_gid_key" ON "product_aggregates"("shop_id", "product_gid");

-- CreateIndex
CREATE INDEX "product_aggregates_shop_id_product_gid_idx" ON "product_aggregates"("shop_id", "product_gid");
