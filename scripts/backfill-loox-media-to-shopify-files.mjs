#!/usr/bin/env node
import crypto from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function hashUrl(url) {
  return crypto.createHash('sha256').update(String(url || '').trim().toLowerCase()).digest('hex');
}

async function gql(shop, token, query, variables = {}) {
  const res = await fetch(`https://${shop}/admin/api/2026-04/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': token,
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(json).slice(0, 500)}`);
  return json;
}

async function ensureTables() {
  await prisma.$executeRawUnsafe(`
    ALTER TABLE review_media
      ADD COLUMN IF NOT EXISTS shopify_file_id text,
      ADD COLUMN IF NOT EXISTS source_url text,
      ADD COLUMN IF NOT EXISTS mirror_status text,
      ADD COLUMN IF NOT EXISTS mirror_error text
  `);

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
}

async function upsertCache(shopId, sourceUrl, patch) {
  const h = hashUrl(sourceUrl);
  await prisma.$executeRawUnsafe(
    `INSERT INTO review_media_mirror_cache (id, shop_id, source_url, source_hash, shopify_file_id, shopify_url, status, error, created_at, updated_at)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, now(), now())
     ON CONFLICT (shop_id, source_hash)
     DO UPDATE SET source_url=EXCLUDED.source_url, shopify_file_id=EXCLUDED.shopify_file_id, shopify_url=EXCLUDED.shopify_url, status=EXCLUDED.status, error=EXCLUDED.error, updated_at=now()`,
    shopId,
    sourceUrl,
    h,
    patch.fileId || null,
    patch.url || null,
    patch.status,
    patch.error || null,
  );
}

async function getCached(shopId, sourceUrl) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT * FROM review_media_mirror_cache WHERE shop_id = $1 AND source_hash = $2 LIMIT 1`,
    shopId,
    hashUrl(sourceUrl),
  );
  return rows[0] || null;
}

async function pollReady(shop, token, id, timeoutMs = 45000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const data = await gql(
      shop,
      token,
      `query($id:ID!){ node(id:$id){ ... on MediaImage { id fileStatus image { url } } } }`,
      { id },
    );
    const node = data?.data?.node;
    const status = String(node?.fileStatus || '');
    const url = String(node?.image?.url || '');
    if (status === 'READY' && url) return { id, url };
    if (status === 'FAILED') throw new Error('FAILED');
    await new Promise((r) => setTimeout(r, 1200));
  }
  throw new Error('TIMEOUT');
}

async function mirror(shopId, shop, token, sourceUrl) {
  const cached = await getCached(shopId, sourceUrl);
  if (cached?.status === 'ready' && cached?.shopify_url && cached?.shopify_file_id) {
    return { fileId: cached.shopify_file_id, url: cached.shopify_url, reused: true };
  }

  await upsertCache(shopId, sourceUrl, { status: 'pending' });
  const created = await gql(
    shop,
    token,
    `mutation($files:[FileCreateInput!]!){ fileCreate(files:$files){ files{ ... on MediaImage{ id fileStatus image{url} } } userErrors{message} } }`,
    { files: [{ originalSource: sourceUrl, contentType: 'IMAGE' }] },
  );
  const errs = created?.data?.fileCreate?.userErrors || [];
  if (errs.length) throw new Error(errs.map((e) => e.message).join('; '));
  const file = created?.data?.fileCreate?.files?.[0];
  if (!file?.id) throw new Error('NO_ID');
  const ready = file?.fileStatus === 'READY' && file?.image?.url ? { id: file.id, url: file.image.url } : await pollReady(shop, token, file.id);
  await upsertCache(shopId, sourceUrl, { status: 'ready', fileId: ready.id, url: ready.url });
  return { fileId: ready.id, url: ready.url, reused: false };
}

async function main() {
  const shopArg = process.argv.find((a) => a.startsWith('--shop='));
  if (!shopArg) throw new Error('Usage: node scripts/backfill-loox-media-to-shopify-files.mjs --shop=your-shop.myshopify.com [--limit=200]');
  const shop = shopArg.split('=')[1];
  const limitArg = process.argv.find((a) => a.startsWith('--limit='));
  const limit = Number(limitArg?.split('=')[1] || '200');

  await ensureTables();

  const session = await prisma.session.findFirst({ where: { shop, isOnline: false }, orderBy: { id: 'desc' } });
  if (!session?.accessToken) throw new Error(`No offline session token for ${shop}`);

  const rows = await prisma.$queryRawUnsafe(
    `SELECT rm.id, rm.review_id, rm.shop_id, rm.media_url
     FROM review_media rm
     WHERE rm.shop_id = $1 AND rm.media_url ILIKE 'https://images.loox.io/%'
     ORDER BY rm.created_at DESC
     LIMIT $2`,
    shop,
    limit,
  );

  let ok = 0;
  let fail = 0;
  let reused = 0;
  const processed = rows.length;
  for (const r of rows) {
    try {
      const mirrored = await mirror(shop, shop, session.accessToken, r.media_url);
      if (mirrored.reused) reused += 1;
      await prisma.$executeRawUnsafe(
        `UPDATE review_media
         SET source_url = $2, media_url = $3, shopify_file_id = $4, mirror_status='ready', mirror_error=NULL, updated_at=now()
         WHERE id = $1::uuid`,
        r.id,
        r.media_url,
        mirrored.url,
        mirrored.fileId,
      );
      ok += 1;
    } catch (e) {
      await prisma.$executeRawUnsafe(
        `UPDATE review_media
         SET source_url = COALESCE(source_url, media_url), mirror_status='failed', mirror_error=$2, updated_at=now()
         WHERE id = $1::uuid`,
        r.id,
        String(e?.message || e),
      );
      fail += 1;
    }
  }

  console.log(JSON.stringify({ shop, processed, mirrored: ok, failed: fail, reused_from_cache: reused, skipped: 0 }, null, 2));
}

main().finally(async () => {
  await prisma.$disconnect();
});
