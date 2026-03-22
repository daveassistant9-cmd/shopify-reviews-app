-- CreateEnum
CREATE TYPE "ReviewImportJobStatus" AS ENUM ('uploaded', 'validated', 'committed', 'failed');

-- CreateEnum
CREATE TYPE "ReviewImportDedupeDecision" AS ENUM ('unique', 'duplicate_in_file', 'duplicate_existing');

-- CreateEnum
CREATE TYPE "ReviewImportCommitDecision" AS ENUM ('pending', 'committed', 'skipped_invalid', 'skipped_duplicate_in_file', 'skipped_duplicate_existing');

-- CreateTable
CREATE TABLE "review_import_jobs" (
    "id" UUID NOT NULL,
    "shop_id" TEXT NOT NULL,
    "status" "ReviewImportJobStatus" NOT NULL DEFAULT 'uploaded',
    "file_name" TEXT NOT NULL,
    "is_dry_run" BOOLEAN NOT NULL DEFAULT true,
    "default_import_status" "ReviewStatus" NOT NULL DEFAULT 'draft',
    "column_mapping" JSONB NOT NULL,
    "stats" JSONB NOT NULL,
    "error_summary" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "review_import_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_import_job_rows" (
    "id" UUID NOT NULL,
    "import_job_id" UUID NOT NULL,
    "row_number" INTEGER NOT NULL,
    "raw_payload" JSONB NOT NULL,
    "normalized_payload" JSONB,
    "validation_errors" JSONB NOT NULL,
    "dedupe_decision" "ReviewImportDedupeDecision" NOT NULL DEFAULT 'unique',
    "commit_decision" "ReviewImportCommitDecision" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_import_job_rows_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "review_import_jobs_shop_id_created_at_idx" ON "review_import_jobs"("shop_id", "created_at");

-- CreateIndex
CREATE INDEX "review_import_job_rows_import_job_id_row_number_idx" ON "review_import_job_rows"("import_job_id", "row_number");

-- AddForeignKey
ALTER TABLE "review_import_job_rows" ADD CONSTRAINT "review_import_job_rows_import_job_id_fkey" FOREIGN KEY ("import_job_id") REFERENCES "review_import_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
