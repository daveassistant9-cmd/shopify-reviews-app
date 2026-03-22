import crypto from "node:crypto";
import prisma from "../db.server";

type AdminClient = { graphql: (query: string, init?: any) => Promise<Response> };

type MirroredItem = {
  sourceUrl: string;
  sourceType: "external_url" | "binary_upload";
  shopifyUrl: string;
  shopifyFileId: string;
  status: "ready";
  error: null;
};

async function ensureMirrorTables() {
  await prisma.$executeRawUnsafe(`
    ALTER TABLE review_media
      ADD COLUMN IF NOT EXISTS shopify_file_id text,
      ADD COLUMN IF NOT EXISTS source_url text,
      ADD COLUMN IF NOT EXISTS source_type text,
      ADD COLUMN IF NOT EXISTS mirror_status text,
      ADD COLUMN IF NOT EXISTS upload_status text,
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

function dataUrlToBuffer(dataUrl: string) {
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) throw new Error("Invalid data URL");
  return { mimeType: m[1], buffer: Buffer.from(m[2], "base64") };
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
          ... on GenericFile {
            id
            fileStatus
            url
          }
        }
      }
    `, { variables: { id: fileId } });
    const payload = await res.json();
    const node = payload?.data?.node;
    const status = String(node?.fileStatus || "");
    const url = String(node?.image?.url || node?.url || "");
    if (status === "READY" && url) return { fileId, url };
    if (status === "FAILED") throw new Error("Shopify file processing FAILED");
    await new Promise((r) => setTimeout(r, 1200));
  }
  throw new Error("Shopify file processing timeout");
}

async function createShopifyFileFromOriginalSource(admin: AdminClient, originalSource: string) {
  const res = await admin.graphql(`#graphql
    mutation MirrorFile($files: [FileCreateInput!]!) {
      fileCreate(files: $files) {
        files {
          ... on MediaImage {
            id
            fileStatus
            image { url }
          }
          ... on GenericFile {
            id
            fileStatus
            url
          }
        }
        userErrors { field message }
      }
    }
  `, {
    variables: {
      files: [
        {
          originalSource,
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
  const directUrl = String(file?.image?.url || file?.url || "");
  if (file?.fileStatus === "READY" && directUrl) return { fileId: file.id as string, url: directUrl };
  return pollFileReady(admin, String(file.id));
}

async function stagedUploadAndCreateFile(admin: AdminClient, input: { filename: string; mimeType: string; bytes: Buffer }) {
  const staged = await admin.graphql(`#graphql
    mutation staged($input:[StagedUploadInput!]!){
      stagedUploadsCreate(input:$input){
        stagedTargets{ url resourceUrl parameters{ name value } }
        userErrors{ field message }
      }
    }
  `, {
    variables: {
      input: [
        {
          filename: input.filename,
          mimeType: input.mimeType,
          fileSize: String(input.bytes.byteLength),
          httpMethod: "POST",
          resource: "FILE",
        },
      ],
    },
  });
  const stagedPayload = await staged.json();
  const stageErrors = stagedPayload?.data?.stagedUploadsCreate?.userErrors || [];
  if (stageErrors.length) throw new Error(stageErrors.map((e: any) => e.message).join("; "));

  const target = stagedPayload?.data?.stagedUploadsCreate?.stagedTargets?.[0];
  if (!target?.url || !target?.resourceUrl) throw new Error("staged upload target missing");

  const fd = new FormData();
  for (const p of target.parameters || []) fd.append(p.name, p.value);
  fd.append("file", new Blob([input.bytes], { type: input.mimeType }), input.filename);

  const uploadRes = await fetch(target.url, { method: "POST", body: fd });
  if (!uploadRes.ok) throw new Error(`staged upload failed: HTTP ${uploadRes.status}`);

  return createShopifyFileFromOriginalSource(admin, String(target.resourceUrl));
}

async function offlineAdminClientForShop(shopId: string): Promise<AdminClient> {
  const row = await prisma.session.findFirst({ where: { shop: shopId, isOnline: false }, orderBy: { id: "desc" } });
  if (!row?.accessToken) throw new Error(`No offline token for ${shopId}`);

  return {
    graphql: async (query: string, init?: any) => {
      return fetch(`https://${shopId}/admin/api/2026-04/graphql.json`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": row.accessToken,
        },
        body: JSON.stringify({ query, ...(init || {}) }),
      }) as any;
    },
  };
}

async function getAdminClient(shopId: string, admin?: AdminClient) {
  return admin || offlineAdminClientForShop(shopId);
}

export async function ingestMediaToShopify(args: {
  shopId: string;
  admin?: AdminClient;
  reviewId?: string;
  externalUrls?: string[];
  dataUrls?: string[];
  maxItems?: number;
}) {
  const { shopId } = args;
  const maxItems = Math.max(1, Math.min(10, args.maxItems || 5));
  await ensureMirrorTables();
  const admin = await getAdminClient(shopId, args.admin);

  const external = Array.from(new Set((args.externalUrls || []).map((u) => String(u || "").trim()).filter(Boolean)));
  const dataUrls = Array.from(new Set((args.dataUrls || []).map((u) => String(u || "").trim()).filter(Boolean)));

  const queue: Array<{ sourceType: "external_url" | "binary_upload"; sourceUrl: string }> = [
    ...external.map((u) => ({ sourceType: "external_url" as const, sourceUrl: u })),
    ...dataUrls.map((u) => ({ sourceType: "binary_upload" as const, sourceUrl: u })),
  ].slice(0, maxItems);

  const succeeded: MirroredItem[] = [];
  const failed: Array<{ sourceUrl: string; sourceType: "external_url" | "binary_upload"; error: string }> = [];

  for (const item of queue) {
    try {
      const cacheKey = item.sourceType === "external_url" ? item.sourceUrl : `datahash:${hashUrl(item.sourceUrl)}`;
      const cached = await getCached(shopId, cacheKey);
      if (cached?.status === "ready" && cached?.shopify_url && cached?.shopify_file_id) {
        succeeded.push({
          sourceUrl: item.sourceUrl,
          sourceType: item.sourceType,
          shopifyUrl: cached.shopify_url,
          shopifyFileId: cached.shopify_file_id,
          status: "ready",
          error: null,
        });
        continue;
      }

      await upsertCache(shopId, cacheKey, { status: "pending" });

      let mirrored: { fileId: string; url: string };
      if (item.sourceType === "external_url") {
        if (!/^https?:\/\//i.test(item.sourceUrl)) throw new Error("Only http(s) external URLs are supported");
        mirrored = await createShopifyFileFromOriginalSource(admin, item.sourceUrl);
      } else {
        const parsed = dataUrlToBuffer(item.sourceUrl);
        if (!/^image\//i.test(parsed.mimeType)) throw new Error("Only image uploads are supported");
        if (parsed.buffer.byteLength > 8 * 1024 * 1024) throw new Error("Image too large (max 8MB)");
        mirrored = await stagedUploadAndCreateFile(admin, {
          filename: `review-${hashUrl(item.sourceUrl).slice(0, 12)}.jpg`,
          mimeType: parsed.mimeType,
          bytes: parsed.buffer,
        });
      }

      await upsertCache(shopId, cacheKey, {
        status: "ready",
        shopify_file_id: mirrored.fileId,
        shopify_url: mirrored.url,
      });

      succeeded.push({
        sourceUrl: item.sourceUrl,
        sourceType: item.sourceType,
        shopifyUrl: mirrored.url,
        shopifyFileId: mirrored.fileId,
        status: "ready",
        error: null,
      });
    } catch (e: any) {
      const msg = e?.message || "ingestion failed";
      const cacheKey = item.sourceType === "external_url" ? item.sourceUrl : `datahash:${hashUrl(item.sourceUrl)}`;
      await upsertCache(shopId, cacheKey, { status: "failed", error: msg });
      failed.push({ sourceUrl: item.sourceUrl, sourceType: item.sourceType, error: msg });
      await prisma.$executeRawUnsafe(
        `INSERT INTO review_media_mirror_failures (id, shop_id, review_id, source_url, error, created_at)
         VALUES (gen_random_uuid(), $1, $2::uuid, $3, $4, now())`,
        shopId,
        args.reviewId || null,
        item.sourceUrl,
        msg,
      ).catch(() => {});
    }
  }

  return { succeeded, failed };
}

export async function insertMirroredMediaRows(args: {
  shopId: string;
  reviewId: string;
  items: Array<{ sourceUrl: string; sourceType?: string; shopifyUrl: string; shopifyFileId: string; status?: string; error?: string | null }>;
}) {
  const { shopId, reviewId, items } = args;
  await ensureMirrorTables();
  for (let i = 0; i < items.length; i += 1) {
    const m = items[i];
    await prisma.$executeRawUnsafe(
      `INSERT INTO review_media (id, review_id, shop_id, media_url, media_type, sort_order, shopify_file_id, source_url, source_type, mirror_status, upload_status, mirror_error, created_at, updated_at)
       VALUES (gen_random_uuid(), $1::uuid, $2, $3, 'image', $4, $5, $6, $7, $8, $8, $9, now(), now())`,
      reviewId,
      shopId,
      m.shopifyUrl,
      i,
      m.shopifyFileId,
      m.sourceUrl,
      m.sourceType || "external_url",
      m.status || "ready",
      m.error || null,
    );
  }
}

export async function mirrorExternalMediaToShopify(args: {
  admin: AdminClient;
  shopId: string;
  sourceUrls: string[];
  reviewId?: string;
}) {
  return ingestMediaToShopify({
    admin: args.admin,
    shopId: args.shopId,
    sourceUrls: args.sourceUrls,
    reviewId: args.reviewId,
    maxItems: 10,
  });
}
