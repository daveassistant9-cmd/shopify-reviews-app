import crypto from "node:crypto";
import prisma from "../db.server";

type AdminClient = { graphql: (query: string, init?: any) => Promise<Response> };

async function ensureMirrorTables() {
  await prisma.$executeRawUnsafe(`
    ALTER TABLE review_media
      ADD COLUMN IF NOT EXISTS shopify_file_id text,
      ADD COLUMN IF NOT EXISTS source_url text,
      ADD COLUMN IF NOT EXISTS mirror_status text,
      ADD COLUMN IF NOT EXISTS mirror_error text
  `).catch(() => {});

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS review_media_mirror_cache (
      id uuid primary key default gen_random_uuid(),
      shop_id text not null,
      source_url text not null,
      source_hash text not null,
      shopify_file_id text,
      shopify_url text,
      status text not null default 'pending',
      error text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique(shop_id, source_hash)
    )
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS review_media_mirror_failures (
      id uuid primary key default gen_random_uuid(),
      shop_id text not null,
      review_id uuid,
      source_url text not null,
      error text,
      created_at timestamptz not null default now()
    )
  `);
}

function hashUrl(url: string) {
  return crypto.createHash("sha256").update(url.trim().toLowerCase()).digest("hex");
}

async function getCached(shopId: string, sourceUrl: string) {
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT * FROM review_media_mirror_cache WHERE shop_id = $1 AND source_hash = $2 LIMIT 1`,
    shopId,
    hashUrl(sourceUrl),
  );
  return rows[0] || null;
}

async function upsertCache(shopId: string, sourceUrl: string, patch: { status: string; shopify_file_id?: string | null; shopify_url?: string | null; error?: string | null }) {
  const h = hashUrl(sourceUrl);
  await prisma.$executeRawUnsafe(
    `INSERT INTO review_media_mirror_cache (id, shop_id, source_url, source_hash, shopify_file_id, shopify_url, status, error, created_at, updated_at)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, now(), now())
     ON CONFLICT (shop_id, source_hash)
     DO UPDATE SET
      source_url = EXCLUDED.source_url,
      shopify_file_id = EXCLUDED.shopify_file_id,
      shopify_url = EXCLUDED.shopify_url,
      status = EXCLUDED.status,
      error = EXCLUDED.error,
      updated_at = now()`,
    shopId,
    sourceUrl,
    h,
    patch.shopify_file_id || null,
    patch.shopify_url || null,
    patch.status,
    patch.error || null,
  );
}

async function pollFileReady(admin: AdminClient, fileId: string, timeoutMs = 45000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const res = await admin.graphql(`#graphql
      query FileReady($id: ID!) {
        node(id: $id) {
          ... on MediaImage {
            id
            fileStatus
            image { url }
          }
        }
      }
    `, { variables: { id: fileId } });
    const payload = await res.json();
    const node = payload?.data?.node;
    const status = String(node?.fileStatus || "");
    const url = String(node?.image?.url || "");
    if (status === "READY" && url) return { fileId, url };
    if (status === "FAILED") throw new Error("Shopify file processing FAILED");
    await new Promise((r) => setTimeout(r, 1200));
  }
  throw new Error("Shopify file processing timeout");
}

async function createShopifyFile(admin: AdminClient, sourceUrl: string) {
  const res = await admin.graphql(`#graphql
    mutation MirrorFile($files: [FileCreateInput!]!) {
      fileCreate(files: $files) {
        files {
          ... on MediaImage {
            id
            fileStatus
            image { url }
          }
        }
        userErrors { field message }
      }
    }
  `, {
    variables: {
      files: [
        {
          originalSource: sourceUrl,
          contentType: "IMAGE",
        },
      ],
    },
  });
  const payload = await res.json();
  const errs = payload?.data?.fileCreate?.userErrors || [];
  if (errs.length) throw new Error(errs.map((e: any) => e.message).join("; "));

  const file = payload?.data?.fileCreate?.files?.[0];
  if (!file?.id) throw new Error("fileCreate returned no file id");
  if (file?.fileStatus === "READY" && file?.image?.url) return { fileId: file.id as string, url: file.image.url as string };
  return pollFileReady(admin, String(file.id));
}

export async function mirrorExternalMediaToShopify(args: {
  admin: AdminClient;
  shopId: string;
  sourceUrls: string[];
  reviewId?: string;
}) {
  const { admin, shopId, sourceUrls, reviewId } = args;
  await ensureMirrorTables();

  const succeeded: Array<{ sourceUrl: string; shopifyUrl: string; shopifyFileId: string }> = [];
  const failed: Array<{ sourceUrl: string; error: string }> = [];

  for (const sourceUrl of Array.from(new Set(sourceUrls.map((u) => String(u || "").trim()).filter(Boolean)))) {
    try {
      if (!/^https?:\/\//i.test(sourceUrl)) throw new Error("Only http(s) URLs can be mirrored");

      const cached = await getCached(shopId, sourceUrl);
      if (cached?.status === "ready" && cached?.shopify_url && cached?.shopify_file_id) {
        succeeded.push({ sourceUrl, shopifyUrl: cached.shopify_url, shopifyFileId: cached.shopify_file_id });
        continue;
      }

      await upsertCache(shopId, sourceUrl, { status: "pending" });
      const mirrored = await createShopifyFile(admin, sourceUrl);
      await upsertCache(shopId, sourceUrl, {
        status: "ready",
        shopify_file_id: mirrored.fileId,
        shopify_url: mirrored.url,
      });
      succeeded.push({ sourceUrl, shopifyUrl: mirrored.url, shopifyFileId: mirrored.fileId });
    } catch (e: any) {
      const msg = e?.message || "mirror failed";
      await upsertCache(shopId, sourceUrl, { status: "failed", error: msg });
      failed.push({ sourceUrl, error: msg });
      await prisma.$executeRawUnsafe(
        `INSERT INTO review_media_mirror_failures (id, shop_id, review_id, source_url, error, created_at)
         VALUES (gen_random_uuid(), $1, $2::uuid, $3, $4, now())`,
        shopId,
        reviewId || null,
        sourceUrl,
        msg,
      ).catch(() => {});
    }
  }

  return { succeeded, failed };
}

export async function insertMirroredMediaRows(args: {
  shopId: string;
  reviewId: string;
  items: Array<{ sourceUrl: string; shopifyUrl: string; shopifyFileId: string }>;
}) {
  const { shopId, reviewId, items } = args;
  await ensureMirrorTables();
  for (let i = 0; i < items.length; i += 1) {
    const m = items[i];
    await prisma.$executeRawUnsafe(
      `INSERT INTO review_media (id, review_id, shop_id, media_url, media_type, sort_order, shopify_file_id, source_url, mirror_status, mirror_error, created_at, updated_at)
       VALUES (gen_random_uuid(), $1::uuid, $2, $3, 'image', $4, $5, $6, 'ready', NULL, now(), now())`,
      reviewId,
      shopId,
      m.shopifyUrl,
      i,
      m.shopifyFileId,
      m.sourceUrl,
    );
  }
}
