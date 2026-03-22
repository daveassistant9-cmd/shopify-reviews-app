import crypto from "node:crypto";
import prisma from "../db.server";
import { ReviewStatus } from "@prisma/client";
import { recomputeProductAggregate } from "./reviews.server";
import { insertMirroredMediaRows, mirrorExternalMediaToShopify } from "./review-media-mirror.server";

type ImportMapping = {
  product_gid: string;
  reviewer_name: string;
  rating: string;
  body: string;
  title?: string;
  submitted_at?: string;
  product_handle_snapshot?: string;
  product_title_snapshot?: string;
  image_url?: string;
  image_urls?: string;
  status?: string;
  verified_purchase?: string;
};

type ParsedCsv = {
  headers: string[];
  rows: Record<string, string>[];
};

type NormalizedRow = {
  loox_ref?: string | null;
  product_gid: string;
  reviewer_name: string;
  rating: number;
  body: string;
  title: string | null;
  submitted_at: string | null;
  product_handle_snapshot: string | null;
  product_title_snapshot: string | null;
  media_urls: string[];
  import_status: ReviewStatus;
  verified_purchase: boolean;
};

const REQUIRED_MAPPING: (keyof ImportMapping)[] = ["product_gid", "reviewer_name", "rating", "body"];

function parseCsv(text: string): ParsedCsv {
  const rows: string[][] = [];
  let current = "";
  let line: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === "," && !inQuotes) {
      line.push(current);
      current = "";
      continue;
    }

    if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (ch === "\r" && next === "\n") i += 1;
      line.push(current);
      if (line.some((v) => v.trim() !== "")) rows.push(line);
      line = [];
      current = "";
      continue;
    }

    current += ch;
  }

  if (current.length > 0 || line.length > 0) {
    line.push(current);
    if (line.some((v) => v.trim() !== "")) rows.push(line);
  }

  const headers = (rows[0] ?? []).map((h) => h.trim());
  const data = rows.slice(1).map((r) => {
    const out: Record<string, string> = {};
    headers.forEach((h, idx) => {
      out[h] = (r[idx] ?? "").trim();
    });
    return out;
  });

  return { headers, rows: data };
}

function normalizeBody(body: string) {
  return body.trim().replace(/\s+/g, " ");
}

function normalizeName(name: string) {
  return name.trim().toLowerCase();
}

function normalizeDate(input: string | null) {
  if (!input) return null;
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function isLooxRow(raw: Record<string, unknown>) {
  return ["productId", "handle", "review", "rating"].every((k) => raw[k] != null);
}

function mapLooxStatus(value: string): ReviewStatus {
  const v = (value || "").trim().toLowerCase();
  if (v === "published" || v === "active" || v === "approved") return ReviewStatus.published;
  if (v === "pending") return ReviewStatus.draft;
  if (v === "rejected" || v === "unapproved") return ReviewStatus.unpublished;
  return ReviewStatus.draft;
}

function parseImageUrls(single?: string, multiple?: string) {
  const out: string[] = [];
  if (single?.trim()) {
    out.push(
      ...single
        .split(/[|,]/)
        .map((v) => v.trim())
        .filter(Boolean),
    );
  }
  if (multiple?.trim()) {
    out.push(
      ...multiple
        .split(/[|,]/)
        .map((v) => v.trim())
        .filter(Boolean),
    );
  }
  return Array.from(new Set(out));
}

function fingerprintForRow(shopId: string, row: Pick<NormalizedRow, "product_gid" | "reviewer_name" | "rating" | "body" | "submitted_at">) {
  return crypto
    .createHash("sha256")
    .update([
      shopId,
      row.product_gid,
      normalizeName(row.reviewer_name),
      String(row.rating),
      normalizeBody(row.body),
      row.submitted_at ? row.submitted_at.slice(0, 10) : "",
    ].join("|"))
    .digest("hex");
}

function buildInitialStats(totalRows: number) {
  return {
    total_rows: totalRows,
    valid_rows: 0,
    invalid_rows: 0,
    duplicate_in_file: 0,
    duplicate_existing: 0,
    committed_rows: 0,
    skipped_rows: 0,
  };
}

const prismaAny = prisma as unknown as Record<string, any>;
const getJobDelegate = () => prismaAny.reviewImportJob ?? prismaAny.review_import_jobs;
const getRowDelegate = () => prismaAny.reviewImportJobRow ?? prismaAny.review_import_job_rows;

async function createImportJobRecord(data: {
  shop_id: string;
  file_name: string;
  is_dry_run: boolean;
  default_import_status: ReviewStatus;
  column_mapping: unknown;
  stats: unknown;
  error_summary: unknown;
}) {
  const delegate = getJobDelegate();
  if (delegate?.create) return delegate.create({ data });

  const rows = await prisma.$queryRawUnsafe<any[]>(
    `INSERT INTO "review_import_jobs" (id, shop_id, status, file_name, is_dry_run, default_import_status, column_mapping, stats, error_summary, created_at, updated_at)
     VALUES (gen_random_uuid(), $1, 'uploaded', $2, $3, $4::"ReviewStatus", $5::jsonb, $6::jsonb, $7::jsonb, now(), now())
     RETURNING *`,
    data.shop_id,
    data.file_name,
    data.is_dry_run,
    data.default_import_status,
    JSON.stringify(data.column_mapping),
    JSON.stringify(data.stats),
    JSON.stringify(data.error_summary),
  );
  return rows[0];
}

async function createImportRowsBulk(rows: Array<{ import_job_id: string; row_number: number; raw_payload: unknown; validation_errors: unknown }>) {
  const delegate = getRowDelegate();
  if (delegate?.createMany) return delegate.createMany({ data: rows });

  for (const row of rows) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "review_import_job_rows" (id, import_job_id, row_number, raw_payload, validation_errors, dedupe_decision, commit_decision, created_at)
       VALUES (gen_random_uuid(), $1::uuid, $2, $3::jsonb, $4::jsonb, 'unique', 'pending', now())`,
      row.import_job_id,
      row.row_number,
      JSON.stringify(row.raw_payload),
      JSON.stringify(row.validation_errors),
    );
  }
}

async function findImportJob(jobId: string, shopId: string) {
  const delegate = getJobDelegate();
  if (delegate?.findFirst) return delegate.findFirst({ where: { id: jobId, shop_id: shopId } });

  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT * FROM "review_import_jobs" WHERE id = $1::uuid AND shop_id = $2 LIMIT 1`,
    jobId,
    shopId,
  );
  return rows[0] ?? null;
}

async function findImportRows(importJobId: string) {
  const delegate = getRowDelegate();
  if (delegate?.findMany) {
    return delegate.findMany({ where: { import_job_id: importJobId }, orderBy: { row_number: "asc" } });
  }

  return prisma.$queryRawUnsafe<any[]>(
    `SELECT * FROM "review_import_job_rows" WHERE import_job_id = $1::uuid ORDER BY row_number ASC`,
    importJobId,
  );
}

async function updateImportRowValidation(id: string, data: { normalized_payload: unknown; validation_errors: unknown; dedupe_decision: string; commit_decision: string }) {
  const delegate = getRowDelegate();
  if (delegate?.update) return delegate.update({ where: { id }, data });

  return prisma.$executeRawUnsafe(
    `UPDATE "review_import_job_rows" SET normalized_payload = $2::jsonb, validation_errors = $3::jsonb, dedupe_decision = $4::"ReviewImportDedupeDecision", commit_decision = $5::"ReviewImportCommitDecision" WHERE id = $1::uuid`,
    id,
    JSON.stringify(data.normalized_payload),
    JSON.stringify(data.validation_errors),
    data.dedupe_decision,
    data.commit_decision,
  );
}

async function updateImportRowCommitDecision(id: string, decision: string) {
  const delegate = getRowDelegate();
  if (delegate?.update) return delegate.update({ where: { id }, data: { commit_decision: decision } });

  return prisma.$executeRawUnsafe(
    `UPDATE "review_import_job_rows" SET commit_decision = $2::"ReviewImportCommitDecision" WHERE id = $1::uuid`,
    id,
    decision,
  );
}

async function updateImportJobAfterDry(id: string, data: { status: string; is_dry_run: boolean; stats: unknown; error_summary: unknown; column_mapping: unknown }) {
  const delegate = getJobDelegate();
  if (delegate?.update) return delegate.update({ where: { id }, data });

  return prisma.$executeRawUnsafe(
    `UPDATE "review_import_jobs" SET status = $2::"ReviewImportJobStatus", is_dry_run = $3, stats = $4::jsonb, error_summary = $5::jsonb, column_mapping = $6::jsonb, updated_at = now() WHERE id = $1::uuid`,
    id,
    data.status,
    data.is_dry_run,
    JSON.stringify(data.stats),
    JSON.stringify(data.error_summary),
    JSON.stringify(data.column_mapping),
  );
}

async function updateImportJobAfterCommit(id: string, data: { status: string; is_dry_run: boolean; stats: unknown }) {
  const delegate = getJobDelegate();
  if (delegate?.update) return delegate.update({ where: { id }, data });

  return prisma.$executeRawUnsafe(
    `UPDATE "review_import_jobs" SET status = $2::"ReviewImportJobStatus", is_dry_run = $3, stats = $4::jsonb, updated_at = now() WHERE id = $1::uuid`,
    id,
    data.status,
    data.is_dry_run,
    JSON.stringify(data.stats),
  );
}

export async function createImportJobFromCsv({
  shopId,
  fileName,
  csvText,
  mapping,
  defaultImportStatus,
  handleToProduct,
  savedMappings,
}: {
  shopId: string;
  fileName: string;
  csvText: string;
  mapping: ImportMapping;
  defaultImportStatus: ReviewStatus.draft | ReviewStatus.published;
  handleToProduct?: Record<string, { gid: string; title: string; handle: string }>;
  savedMappings?: Record<string, { gid: string; title?: string; handle?: string }>;
}) {
  const parsed = parseCsv(csvText);

  const job = await createImportJobRecord({
      shop_id: shopId,
      file_name: fileName,
      is_dry_run: true,
      default_import_status: defaultImportStatus,
      column_mapping: { ...mapping, __handleMap: handleToProduct || {}, __savedMappings: savedMappings || {} },
      stats: buildInitialStats(parsed.rows.length),
      error_summary: { missing_required_mappings: [] },
  });

  if (parsed.rows.length) {
    await createImportRowsBulk(parsed.rows.map((row, idx) => ({
        import_job_id: job.id,
        row_number: idx + 2,
        raw_payload: row,
        validation_errors: [],
      })));
  }

  return { jobId: job.id, headers: parsed.headers, rowCount: parsed.rows.length };
}

function normalizeFromRaw(raw: Record<string, unknown>, mapping: ImportMapping, defaultStatus: ReviewStatus): { normalized: NormalizedRow; errors: string[] } {
  const errors: string[] = [];

  for (const key of REQUIRED_MAPPING) {
    if (!mapping[key]) errors.push(`Missing mapping for ${key}`);
  }

  const loox = isLooxRow(raw);
  const handleMap = ((mapping as any).__handleMap || {}) as Record<string, { gid: string; title: string; handle: string }>;
  const savedMap = ((mapping as any).__savedMappings || {}) as Record<string, { gid: string; title?: string; handle?: string }>;

  let product_gid = String(raw[mapping.product_gid] ?? "").trim();
  const looxProductId = String(raw.productId ?? "").trim();
  const looxHandle = String(raw.handle ?? "").trim();
  const looxRef = looxProductId ? `productId:${looxProductId}` : (looxHandle ? `handle:${looxHandle.toLowerCase()}` : null);

  if (looxRef && savedMap[looxRef]?.gid) {
    product_gid = savedMap[looxRef].gid;
  }

  if (!product_gid && loox && looxProductId) {
    product_gid = `gid://shopify/Product/${looxProductId}`;
  }

  if (!product_gid && loox && looxHandle) {
    const hit = handleMap[looxHandle.toLowerCase()];
    if (hit?.gid) product_gid = hit.gid;
  }

  const reviewer_name = (
    String(raw[mapping.reviewer_name] ?? "").trim() ||
    String(raw.full_name ?? "").trim() ||
    String(raw.nickname ?? "").trim()
  );
  const ratingRaw = String(raw[mapping.rating] ?? raw.rating ?? "").trim();
  const body = String(raw[mapping.body] ?? raw.review ?? "").trim();

  const rating = Number(ratingRaw);

  if (!product_gid) {
    if (loox && looxHandle) errors.push(`Unable to resolve product handle: ${looxHandle}`);
    else errors.push("product_gid is required");
  }
  if (!reviewer_name) errors.push("reviewer_name is required");
  if (!body) errors.push("body is required");
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    errors.push("rating must be an integer between 1 and 5");
  }

  const submittedInput = (mapping.submitted_at ? String(raw[mapping.submitted_at] ?? "").trim() : "") || String(raw.date ?? "").trim();
  const submitted_at = normalizeDate(submittedInput || null);
  if (submittedInput && !submitted_at) {
    errors.push("submitted_at must be a valid date");
  }

  const media_urls = parseImageUrls(
    (mapping.image_url ? String(raw[mapping.image_url] ?? "") : "") || String(raw.img ?? ""),
    mapping.image_urls ? String(raw[mapping.image_urls] ?? "") : "",
  );
  const invalidMedia = media_urls.filter((u) => !/^https?:\/\//i.test(u) && !/^data:image\//i.test(u));
  if (invalidMedia.length) errors.push("image urls must start with http(s):// or data:image/");

  const statusRaw = (mapping.status ? String(raw[mapping.status] ?? "") : "") || String(raw.status ?? "");
  const import_status = statusRaw ? mapLooxStatus(statusRaw) : defaultStatus;
  const verifiedRaw = (mapping.verified_purchase ? String(raw[mapping.verified_purchase] ?? "") : "") || String(raw.verified_purchase ?? "");
  const verified_purchase = /^(true|1|yes|y)$/i.test(verifiedRaw.trim());

  return {
    normalized: {
      loox_ref: looxRef,
      product_gid,
      reviewer_name,
      rating: Number.isInteger(rating) ? rating : 0,
      body,
      title: (mapping.title ? String(raw[mapping.title] ?? "").trim() : "") || null,
      submitted_at,
      product_handle_snapshot: (mapping.product_handle_snapshot ? String(raw[mapping.product_handle_snapshot] ?? "").trim() : "") || (looxHandle || null),
      product_title_snapshot: (mapping.product_title_snapshot ? String(raw[mapping.product_title_snapshot] ?? "").trim() : "") || null,
      media_urls,
      import_status,
      verified_purchase,
    },
    errors,
  };
}

export async function runImportDryRun(jobId: string, shopId: string) {
  const job = await findImportJob(jobId, shopId);
  if (!job) throw new Error("Import job not found");

  const mapping = job.column_mapping as unknown as ImportMapping;
  const rows = await findImportRows(job.id);

  const existingReviews = await prisma.reviews.findMany({
    where: { shop_id: shopId },
    select: { product_gid: true, reviewer_name: true, rating: true, body: true, submitted_at: true },
  });

  const existingFp = new Set(
    existingReviews.map((r) =>
      fingerprintForRow(shopId, {
        product_gid: r.product_gid,
        reviewer_name: r.reviewer_name,
        rating: r.rating,
        body: r.body,
        submitted_at: r.submitted_at ? r.submitted_at.toISOString() : null,
      }),
    ),
  );

  const seenInFile = new Set<string>();
  const stats = buildInitialStats(rows.length);
  const errorSummary: Record<string, number> = {};

  for (const row of rows) {
    const { normalized, errors } = normalizeFromRaw(row.raw_payload as Record<string, unknown>, mapping, job.default_import_status);

    let dedupeDecision: "unique" | "duplicate_in_file" | "duplicate_existing" = "unique";

    if (!errors.length) {
      const fp = fingerprintForRow(shopId, normalized);
      if (seenInFile.has(fp)) dedupeDecision = "duplicate_in_file";
      else if (existingFp.has(fp)) dedupeDecision = "duplicate_existing";
      seenInFile.add(fp);
    }

    if (errors.length) {
      stats.invalid_rows += 1;
      for (const err of errors) errorSummary[err] = (errorSummary[err] ?? 0) + 1;
    } else {
      stats.valid_rows += 1;
    }

    if (dedupeDecision === "duplicate_in_file") stats.duplicate_in_file += 1;
    if (dedupeDecision === "duplicate_existing") stats.duplicate_existing += 1;

    await updateImportRowValidation(row.id, {
      normalized_payload: normalized,
      validation_errors: errors,
      dedupe_decision: dedupeDecision,
      commit_decision: "pending",
    });
  }

  await updateImportJobAfterDry(job.id, {
    status: "validated",
    is_dry_run: true,
    stats,
    error_summary: errorSummary,
    column_mapping: mapping,
  });

  return { stats, errorSummary };
}

export async function commitImportJob(jobId: string, shopId: string, admin?: { graphql: (query: string, init?: any) => Promise<Response> }) {
  const job = await findImportJob(jobId, shopId);
  if (!job) throw new Error("Import job not found");

  const rows = await findImportRows(job.id);

  const touchedProducts = new Set<string>();
  let committed = 0;
  let skipped = 0;

  for (const row of rows) {
    const errors = row.validation_errors as unknown as string[];
    const dedupe = row.dedupe_decision;
    const normalized = row.normalized_payload as unknown as NormalizedRow | null;

    if (errors.length > 0) {
      skipped += 1;
      await updateImportRowCommitDecision(row.id, "skipped_invalid");
      continue;
    }

    if (dedupe === "duplicate_in_file") {
      skipped += 1;
      await updateImportRowCommitDecision(row.id, "skipped_duplicate_in_file");
      continue;
    }

    if (dedupe === "duplicate_existing") {
      skipped += 1;
      await updateImportRowCommitDecision(row.id, "skipped_duplicate_existing");
      continue;
    }

    if (!normalized) {
      skipped += 1;
      await updateImportRowCommitDecision(row.id, "skipped_invalid");
      continue;
    }

    const created = await prisma.reviews.create({
      data: {
        shop_id: shopId,
        product_gid: normalized.product_gid,
        product_handle_snapshot: normalized.product_handle_snapshot,
        product_title_snapshot: normalized.product_title_snapshot,
        reviewer_name: normalized.reviewer_name,
        rating: normalized.rating,
        title: normalized.title,
        body: normalized.body,
        image_url: null,
        status: normalized.import_status,
        submitted_at: normalized.submitted_at ? new Date(normalized.submitted_at) : null,
        published_at: normalized.import_status === ReviewStatus.published ? new Date() : null,
      },
      select: { id: true },
    });

    if (normalized.media_urls.length) {
      if (!admin) {
        await prisma.$executeRawUnsafe(`
          CREATE TABLE IF NOT EXISTS review_media_mirror_failures (
            id uuid primary key default gen_random_uuid(),
            shop_id text not null,
            review_id uuid,
            source_url text not null,
            error text,
            created_at timestamptz not null default now()
          )
        `).catch(() => {});
        for (const sourceUrl of normalized.media_urls) {
          await prisma.$executeRawUnsafe(
            `INSERT INTO review_media_mirror_failures (id, shop_id, review_id, source_url, error, created_at)
             VALUES (gen_random_uuid(), $1, $2::uuid, $3, $4, now())`,
            shopId,
            created.id,
            sourceUrl,
            "admin client missing for mirror",
          ).catch(() => {});
        }
      } else {
        const mirrored = await mirrorExternalMediaToShopify({
          admin,
          shopId,
          sourceUrls: normalized.media_urls,
          reviewId: created.id,
        });

        if (mirrored.succeeded.length) {
          await insertMirroredMediaRows({ shopId, reviewId: created.id, items: mirrored.succeeded });
          await prisma.reviews.update({ where: { id: created.id }, data: { image_url: mirrored.succeeded[0].shopifyUrl } });
        }
      }
    }

    touchedProducts.add(normalized.product_gid);
    committed += 1;

    await updateImportRowCommitDecision(row.id, "committed");
  }

  if (touchedProducts.size) {
    const hasPublished = rows.some((r) => {
      const n = r.normalized_payload as any;
      return n?.import_status === ReviewStatus.published;
    });
    if (hasPublished) {
      for (const productGid of touchedProducts) {
        await recomputeProductAggregate({ shopId, productGid });
      }
    }
  }

  const previousStats = (job.stats as Record<string, unknown>) || {};
  await updateImportJobAfterCommit(job.id, {
    status: "committed",
    is_dry_run: false,
    stats: {
      ...previousStats,
      committed_rows: committed,
      skipped_rows: skipped,
    },
  });

  return { committed, skipped, touchedProducts: Array.from(touchedProducts) };
}

export async function getImportHistory(shopId: string) {
  const p = prisma as unknown as Record<string, any>;
  const delegate = p.reviewImportJob ?? p.review_import_jobs;

  if (delegate?.findMany) {
    return delegate.findMany({
      where: { shop_id: shopId },
      orderBy: { created_at: "desc" },
      take: 20,
    });
  }

  const keys = Object.keys(p).filter((k) => /import|review/i.test(k));
  console.error("[importer] missing ReviewImportJob delegate, using SQL fallback", { keys });

  return prisma.$queryRaw`
    SELECT id, shop_id, status, file_name, is_dry_run, default_import_status, column_mapping, stats, error_summary, created_at, updated_at
    FROM "review_import_jobs"
    WHERE shop_id = ${shopId}
    ORDER BY created_at DESC
    LIMIT 20
  `;
}

export async function getImportRows(jobId: string, limit = 100) {
  const p = prisma as unknown as Record<string, any>;
  const delegate = p.reviewImportJobRow ?? p.review_import_job_rows;

  if (delegate?.findMany) {
    return delegate.findMany({
      where: { import_job_id: jobId },
      orderBy: { row_number: "asc" },
      take: limit,
    });
  }

  const keys = Object.keys(p).filter((k) => /import|review/i.test(k));
  console.error("[importer] missing ReviewImportJobRow delegate, using SQL fallback", { keys });

  return prisma.$queryRaw`
    SELECT id, import_job_id, row_number, raw_payload, normalized_payload, validation_errors, dedupe_decision, commit_decision, created_at
    FROM "review_import_job_rows"
    WHERE import_job_id = ${jobId}::uuid
    ORDER BY row_number ASC
    LIMIT ${limit}
  `;
}
