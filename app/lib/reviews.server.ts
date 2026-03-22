import prisma from "../db.server";
import { ReviewStatus } from "@prisma/client";

const prismaAny = prisma as unknown as Record<string, any>;

async function attachMediaRows<T extends { id: string; shop_id: string }>(reviews: T[]) {
  if (!reviews.length) return reviews.map((r) => ({ ...r, media: [] as any[] }));
  const ids = reviews.map((r) => r.id);
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT id, review_id, shop_id, media_url, media_type, sort_order, created_at, updated_at
     FROM "review_media"
     WHERE review_id = ANY($1::uuid[])
     ORDER BY review_id ASC, sort_order ASC`,
    ids,
  );
  const byReview = new Map<string, any[]>();
  for (const row of rows) {
    const arr = byReview.get(row.review_id) || [];
    arr.push(row);
    byReview.set(row.review_id, arr);
  }
  return reviews.map((r) => ({ ...r, media: byReview.get(r.id) || [] }));
}

export type CreateReviewInput = {
  shopId: string;
  product_gid: string;
  product_handle_snapshot?: string | null;
  product_title_snapshot?: string | null;
  reviewer_name: string;
  rating: number;
  title?: string | null;
  body: string;
  image_url?: string | null;
  media_urls?: string[];
  submitted_at?: Date | null;
};

export function validateCreateReviewInput(input: CreateReviewInput) {
  const errors: string[] = [];

  if (!input.product_gid?.trim()) errors.push("product_gid is required");
  if (!input.reviewer_name?.trim()) errors.push("reviewer_name is required");
  if (!input.body?.trim()) errors.push("body is required");
  if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) {
    errors.push("rating must be an integer between 1 and 5");
  }

  return errors;
}

export async function createReview(input: CreateReviewInput) {
  const mediaUrls = (input.media_urls || []).filter(Boolean);
  const firstImage = input.image_url ?? mediaUrls[0] ?? null;

  const review = await prisma.reviews.create({
    data: {
      shop_id: input.shopId,
      product_gid: input.product_gid,
      product_handle_snapshot: input.product_handle_snapshot ?? null,
      product_title_snapshot: input.product_title_snapshot ?? null,
      reviewer_name: input.reviewer_name,
      rating: input.rating,
      title: input.title ?? null,
      body: input.body,
      image_url: firstImage,
      status: ReviewStatus.draft,
      submitted_at: input.submitted_at ?? null,
    },
  });

  if (mediaUrls.length) {
    const reviewMediaDelegate = prismaAny.reviewMedia;
    if (reviewMediaDelegate?.createMany) {
      await reviewMediaDelegate.createMany({
        data: mediaUrls.map((url, idx) => ({
          review_id: review.id,
          shop_id: input.shopId,
          media_url: url,
          media_type: "image",
          sort_order: idx,
        })),
      });
    } else {
      for (let idx = 0; idx < mediaUrls.length; idx += 1) {
        await prisma.$executeRawUnsafe(
          `INSERT INTO "review_media" (id, review_id, shop_id, media_url, media_type, sort_order, created_at, updated_at)
           VALUES (gen_random_uuid(), $1::uuid, $2, $3, 'image', $4, now(), now())`,
          review.id,
          input.shopId,
          mediaUrls[idx],
          idx,
        );
      }
    }
  }

  const [withMedia] = await attachMediaRows([{ ...review, shop_id: input.shopId } as any]);
  return withMedia;
}

export async function setReviewStatus({
  reviewId,
  shopId,
  nextStatus,
}: {
  reviewId: string;
  shopId: string;
  nextStatus: ReviewStatus.published | ReviewStatus.unpublished;
}) {
  const existing = await prisma.reviews.findFirst({
    where: { id: reviewId, shop_id: shopId },
  });

  if (!existing) {
    throw new Error("Review not found");
  }

  if (nextStatus === ReviewStatus.published) {
    if (![ReviewStatus.draft, ReviewStatus.unpublished].includes(existing.status)) {
      throw new Error(`Invalid transition: ${existing.status} -> ${nextStatus}`);
    }
  }

  if (nextStatus === ReviewStatus.unpublished) {
    if (existing.status !== ReviewStatus.published) {
      throw new Error(`Invalid transition: ${existing.status} -> ${nextStatus}`);
    }
  }

  const updated = await prisma.reviews.update({
    where: { id: reviewId },
    data: {
      status: nextStatus,
      published_at: nextStatus === ReviewStatus.published ? new Date() : null,
    },
  });

  await recomputeProductAggregate({
    shopId,
    productGid: existing.product_gid,
  });

  return updated;
}

export async function recomputeProductAggregate({
  shopId,
  productGid,
}: {
  shopId: string;
  productGid: string;
}) {
  const published = await prisma.reviews.findMany({
    where: {
      shop_id: shopId,
      product_gid: productGid,
      status: ReviewStatus.published,
    },
    select: { rating: true },
  });

  const count = published.length;
  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } as Record<number, number>;

  let sum = 0;
  for (const row of published) {
    distribution[row.rating] += 1;
    sum += row.rating;
  }

  const avg = count > 0 ? Number((sum / count).toFixed(2)) : 0;

  return prisma.product_aggregates.upsert({
    where: {
      shop_id_product_gid: {
        shop_id: shopId,
        product_gid: productGid,
      },
    },
    update: {
      review_count_published: count,
      rating_avg_published: avg,
      rating_distribution: distribution,
    },
    create: {
      shop_id: shopId,
      product_gid: productGid,
      review_count_published: count,
      rating_avg_published: avg,
      rating_distribution: distribution,
    },
  });
}

export async function listReviewsByShop(
  shopId: string,
  filters?: {
    productGid?: string;
    productText?: string;
    rating?: number;
    status?: ReviewStatus;
  },
) {
  const where: any = { shop_id: shopId };

  if (filters?.productGid?.trim()) {
    where.product_gid = { contains: filters.productGid.trim(), mode: "insensitive" };
  }

  if (filters?.productText?.trim()) {
    const q = filters.productText.trim();
    where.OR = [
      { product_title_snapshot: { contains: q, mode: "insensitive" } },
      { product_handle_snapshot: { contains: q, mode: "insensitive" } },
    ];
  }

  if (typeof filters?.rating === "number" && Number.isInteger(filters.rating) && filters.rating >= 1 && filters.rating <= 5) {
    where.rating = filters.rating;
  }

  if (filters?.status && Object.values(ReviewStatus).includes(filters.status)) {
    where.status = filters.status;
  }

  const base = await prisma.reviews.findMany({
    where,
    orderBy: [{ created_at: "desc" }],
  });
  return attachMediaRows(base as any);
}

export async function getAggregate(shopId: string, productGid: string) {
  return prisma.product_aggregates.findUnique({
    where: {
      shop_id_product_gid: {
        shop_id: shopId,
        product_gid: productGid,
      },
    },
  });
}

export async function getReviewById(shopId: string, reviewId: string) {
  const base = await prisma.reviews.findFirst({
    where: { id: reviewId, shop_id: shopId },
  });
  if (!base) return null;
  const [withMedia] = await attachMediaRows([base as any]);
  return withMedia as any;
}

export async function updateReviewById({
  shopId,
  reviewId,
  input,
}: {
  shopId: string;
  reviewId: string;
  input: {
    product_gid: string;
    reviewer_name: string;
    rating: number;
    title?: string | null;
    body: string;
    submitted_at?: Date | null;
    product_handle_snapshot?: string | null;
    product_title_snapshot?: string | null;
    media_urls?: string[];
    status: ReviewStatus;
  };
}) {
  const existing = await getReviewById(shopId, reviewId);
  if (!existing) throw new Error("Review not found");

  const mediaUrls = (input.media_urls || []).filter(Boolean);

  const updated = await prisma.reviews.update({
    where: { id: reviewId },
    data: {
      product_gid: input.product_gid,
      reviewer_name: input.reviewer_name,
      rating: input.rating,
      title: input.title ?? null,
      body: input.body,
      image_url: mediaUrls[0] ?? existing.image_url ?? null,
      submitted_at: input.submitted_at ?? null,
      product_handle_snapshot: input.product_handle_snapshot ?? null,
      product_title_snapshot: input.product_title_snapshot ?? null,
      status: input.status,
      published_at: input.status === ReviewStatus.published ? (existing.published_at ?? new Date()) : null,
    },
  });

  if (input.media_urls) {
    const reviewMediaDelegate = prismaAny.reviewMedia;
    if (reviewMediaDelegate?.deleteMany && reviewMediaDelegate?.createMany) {
      await reviewMediaDelegate.deleteMany({ where: { review_id: reviewId } });
      if (mediaUrls.length) {
        await reviewMediaDelegate.createMany({
          data: mediaUrls.map((url, idx) => ({
            review_id: reviewId,
            shop_id: shopId,
            media_url: url,
            media_type: "image",
            sort_order: idx,
          })),
        });
      }
    } else {
      await prisma.$executeRawUnsafe(`DELETE FROM "review_media" WHERE review_id = $1::uuid`, reviewId);
      for (let idx = 0; idx < mediaUrls.length; idx += 1) {
        await prisma.$executeRawUnsafe(
          `INSERT INTO "review_media" (id, review_id, shop_id, media_url, media_type, sort_order, created_at, updated_at)
           VALUES (gen_random_uuid(), $1::uuid, $2, $3, 'image', $4, now(), now())`,
          reviewId,
          shopId,
          mediaUrls[idx],
          idx,
        );
      }
    }
  }

  const productsToRecompute = new Set<string>();
  const wasPublished = existing.status === ReviewStatus.published;
  const isPublished = input.status === ReviewStatus.published;

  if (wasPublished || isPublished) {
    productsToRecompute.add(existing.product_gid);
    productsToRecompute.add(input.product_gid);
  }

  for (const productGid of productsToRecompute) {
    await recomputeProductAggregate({ shopId, productGid });
  }

  return updated;
}
