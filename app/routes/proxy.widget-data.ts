import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import prisma from "../db.server";
import { DEFAULT_WIDGET_SETTINGS, getWidgetSettings } from "../lib/widget-settings.server";
import { createReview, validateCreateReviewInput } from "../lib/reviews.server";

function corsHeaders(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

type SortMode = "image_first" | "newest" | "oldest" | "highest_rated" | "lowest_rated";

const ALLOWED_SORTS = new Set<SortMode>(["image_first", "newest", "oldest", "highest_rated", "lowest_rated"]);

function parsePositiveInt(value: string | null, fallback: number, min: number, max: number) {
  if (value == null || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function parseSettingInt(value: unknown, fallback: number, min: number, max: number) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(min, Math.min(max, Math.floor(value)));
  }
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const parsed = Number(value.trim());
    return Math.max(min, Math.min(max, Math.floor(parsed)));
  }
  return fallback;
}

function normalizeSort(value: string | null, fallback: SortMode): SortMode {
  if (!value) return fallback;
  return ALLOWED_SORTS.has(value as SortMode) ? (value as SortMode) : fallback;
}

function buildOrderBy(sortMode: SortMode): string {
  switch (sortMode) {
    case "oldest":
      return `COALESCE(r.published_at, r.submitted_at, r.created_at) ASC, r.id ASC`;
    case "highest_rated":
      return `r.rating DESC, COALESCE(r.published_at, r.submitted_at, r.created_at) DESC, r.id DESC`;
    case "lowest_rated":
      return `r.rating ASC, COALESCE(r.published_at, r.submitted_at, r.created_at) DESC, r.id DESC`;
    case "image_first":
      return `(CASE WHEN EXISTS (SELECT 1 FROM review_media rm WHERE rm.review_id = r.id) OR r.image_url IS NOT NULL THEN 1 ELSE 0 END) DESC, COALESCE(r.published_at, r.submitted_at, r.created_at) DESC, r.id DESC`;
    case "newest":
    default:
      return `COALESCE(r.published_at, r.submitted_at, r.created_at) DESC, r.id DESC`;
  }
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const origin = request.headers.get("origin");

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders(origin) });
  }

  const shop = url.searchParams.get("shop") || "";
  const productId = url.searchParams.get("product_id") || "";
  const productGid = productId ? `gid://shopify/Product/${productId}` : "";
  const productCandidates = Array.from(new Set([productGid, productId].filter(Boolean)));

  if (!shop || !productCandidates.length) {
    return json({ ok: false, error: "shop and product_id required" }, { status: 400, headers: corsHeaders(origin) });
  }

  const settings = await getWidgetSettings(shop).catch(() => DEFAULT_WIDGET_SETTINGS);
  const defaultSortMode = normalizeSort(String(settings.default_sort_mode || "image_first"), "image_first");
  const sortMode = normalizeSort(url.searchParams.get("sort"), defaultSortMode);

  const configuredLimit = parseSettingInt(settings.initial_reviews_limit, 20, 1, 100);
  const configuredStep = parseSettingInt(settings.load_more_step, 20, 1, 100);
  const requestedLimit = parsePositiveInt(url.searchParams.get("limit"), configuredLimit, 1, 100);
  const offset = parsePositiveInt(url.searchParams.get("offset"), 0, 0, 10000);

  const orderBySql = buildOrderBy(sortMode);
  const reviewsBase = await prisma.$queryRawUnsafe<any[]>(
    `SELECT
      r.id,
      r.reviewer_name,
      r.rating,
      r.title,
      r.body,
      r.image_url,
      r.submitted_at,
      r.published_at
     FROM reviews r
     WHERE r.shop_id = $1
       AND r.product_gid = ANY($2::text[])
       AND r.status = 'published'::"ReviewStatus"
     ORDER BY ${orderBySql}
     OFFSET $3
     LIMIT $4`,
    shop,
    productCandidates,
    offset,
    requestedLimit,
  );

  const reviewIds = reviewsBase.map((r) => r.id);
  let mediaRows: any[] = [];
  if (reviewIds.length) {
    mediaRows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id, review_id, media_url, sort_order FROM "review_media" WHERE review_id = ANY($1::uuid[]) ORDER BY review_id ASC, sort_order ASC`,
      reviewIds,
    );
  }
  const mediaByReview = new Map<string, any[]>();
  for (const row of mediaRows) {
    const arr = mediaByReview.get(row.review_id) || [];
    arr.push({ id: row.id, media_url: row.media_url, sort_order: row.sort_order });
    mediaByReview.set(row.review_id, arr);
  }
  const reviews = reviewsBase.map((r) => ({ ...r, media: mediaByReview.get(r.id) || [] }));

  const aggregateRows = await prisma.product_aggregates.findMany({
    where: { shop_id: shop, product_gid: { in: productCandidates } },
  });
  const aggregate = aggregateRows[0] || null;

  const totalCount = aggregate?.review_count_published ?? reviewsBase.length;

  return json(
    {
      ok: true,
      shop,
      product_gid: productGid,
      summary: {
        average: aggregate ? Number(aggregate.rating_avg_published) : 0,
        count: totalCount,
        distribution: (aggregate?.rating_distribution as Record<string, number>) || { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
      },
      settings,
      sort_mode: sortMode,
      pagination: {
        offset,
        limit: requestedLimit,
        next_offset: offset + reviews.length,
        has_more: offset + reviews.length < totalCount,
        configured_initial_limit: configuredLimit,
        configured_load_more_step: configuredStep,
      },
      reviews,
    },
    { headers: corsHeaders(origin) },
  );
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const origin = request.headers.get("origin");
  const formData = await request.formData();

  const shop = String(formData.get("shop") || "");
  const productId = String(formData.get("product_id") || "");
  const reviewer_name = String(formData.get("reviewer_name") || "");
  const rating = Number(formData.get("rating") || 0);
  const title = String(formData.get("title") || "") || null;
  const body = String(formData.get("body") || "");

  const product_gid = productId ? `gid://shopify/Product/${productId}` : "";

  const imageFiles = formData.getAll("images");
  const media_urls: string[] = [];
  for (const image of imageFiles) {
    if (!(image instanceof File) || image.size <= 0) continue;
    if (!image.type.startsWith("image/")) {
      return json({ ok: false, error: "Only image files are allowed" }, { status: 400, headers: corsHeaders(origin) });
    }
    if (image.size > 2 * 1024 * 1024) {
      return json({ ok: false, error: "Image too large (max 2MB)" }, { status: 400, headers: corsHeaders(origin) });
    }
    const buffer = Buffer.from(await image.arrayBuffer());
    media_urls.push(`data:${image.type};base64,${buffer.toString("base64")}`);
    if (media_urls.length >= 5) break;
  }

  const input = {
    shopId: shop,
    product_gid,
    reviewer_name,
    rating,
    title,
    body,
    media_urls,
    submitted_at: new Date(),
  };

  const errors = validateCreateReviewInput(input);
  if (errors.length) {
    return json({ ok: false, error: errors.join(", ") }, { status: 400, headers: corsHeaders(origin) });
  }

  const created = await createReview(input);

  return json({ ok: true, message: "Review submitted and pending approval", reviewId: created.id, status: created.status }, { headers: corsHeaders(origin) });
};
