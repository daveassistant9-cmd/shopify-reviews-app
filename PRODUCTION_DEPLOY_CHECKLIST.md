# Production Deploy Checklist (Custom Distribution Only)

## Hosting Choice: Render (Web Service + Managed Postgres)

This app is deployed as a private/custom app for your own stores only (no public app listing).

---

## 0) One-time prerequisites

- Shopify Partner account has the app (`aethra-reviews`)
- Production domain prepared (example: `https://reviews.yourdomain.com`)
- Render account + project ready
- Render Postgres instance created

---

## 1) Final production config files

### `shopify.app.production.toml`
Set these values before deploy:

- `application_url = "https://YOUR_PROD_DOMAIN"`
- webhook URIs to full prod URLs
- `[auth].redirect_urls` to full prod URLs
- `[app_proxy].url = "https://YOUR_PROD_DOMAIN/proxy/widget-data"`

### `app/shopify.server.ts`
- distribution is set to `AppDistribution.SingleMerchant`

### `app/routes/healthz.ts`
- health endpoint for uptime probes and DB connectivity

---

## 2) Production env vars

Required:

- `SHOPIFY_API_KEY`
- `SHOPIFY_API_SECRET`
- `SCOPES=read_products`
- `SHOPIFY_APP_URL=https://YOUR_PROD_DOMAIN`
- `DATABASE_URL=postgresql://...` (Render Postgres, SSL enabled)
- `NODE_ENV=production`
- `PORT=3000`

Optional:

- `SHOP_CUSTOM_DOMAIN` (only if you explicitly use a custom shop domain flow)

---

## 3) Deploy sequence (exact)

Run from repo root (`shopify-reviews-app`):

```bash
npm ci
cp .env.production.example .env.production
# fill env values locally

# validate build
npm run build

# apply schema to production DB
DATABASE_URL="postgresql://..." npm run setup

# switch to production Shopify app config
shopify app config use shopify.app.production.toml

# deploy Shopify app config + extension
npm run deploy
```

Render service settings:

- Build command: `npm ci && npm run build`
- Start command: `npm run docker-start`
- Health check path: `/healthz`
- Auto deploy: ON

---

## 4) Custom distribution install flow (private stores only)

1. In Shopify Partner Dashboard → your app → Distribution
2. Ensure app uses **Custom distribution**
3. Generate install link
4. Open link for each owned store and approve install

Manual merchant-side actions per store (unavoidable):

1. Install app from custom link
2. Theme Editor → product template → enable **Reviews widget** app block
3. Save theme

---

## 5) Post-deploy validation checklist

### Embedded admin
- App opens in Shopify Admin iframe without auth loop
- No repeated OAuth prompts

### App proxy
- `https://{store}/apps/aethra-reviews?shop={store}&product_id={id}` returns JSON

### Storefront widget
- Widget renders on product page
- Ratings/count/review cards visible
- No console fetch/CORS errors

### Review submit flow
- "Write review" modal opens
- Submit succeeds
- Review appears in moderation/admin list

### Image/media flow
- Image upload works
- Media persists and displays on widget cards/lightbox

### Loox-imported reviews
- Import file upload/validate/commit works
- Dedupe behavior is correct

### DB and runtime
- `GET /healthz` returns `{ ok: true, db: "ok" }`
- No Prisma connection errors in logs

---

## 6) Rollback plan

If deployment fails:

1. Revert to previous Render deploy
2. Keep current DB unchanged (no destructive rollback)
3. Verify `/healthz`
4. Re-test app proxy + storefront widget

---

## 7) Known execution blockers

- Real production domain value still needed in `shopify.app.production.toml`
- Render project/env vars must be entered in your Render account
- Custom install link generation/approval must be done from your Shopify Partner/store owner session
