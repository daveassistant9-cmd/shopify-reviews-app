import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Link, Outlet, useLoaderData, useNavigation, Form, useLocation, useSearchParams } from "@remix-run/react";
import { useState } from "react";
import {
  Badge,
  BlockStack,
  Button,
  Card,
  InlineStack,
  Modal,
  Page,
  Text,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { ReviewStatus } from "@prisma/client";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  createReview,
  listReviewsByShop,
  setReviewStatus,
  updateReviewById,
  validateCreateReviewInput,
} from "../lib/reviews.server";
import { ProductSearchPicker, type ProductOption } from "../components/ProductSearchPicker";

const productIdFromGid = (gid: string) => {
  const m = gid.match(/\/Product\/(\d+)/);
  return m?.[1] || "";
};

const parseMediaUrlsField = (raw: string) => {
  const chunks = raw
    .split(/\n|\|/)
    .map((v) => v.trim())
    .filter(Boolean);

  const out: string[] = [];
  for (const chunk of chunks) {
    if (chunk.startsWith("data:image/")) {
      out.push(chunk);
      continue;
    }
    out.push(...chunk.split(",").map((v) => v.trim()).filter(Boolean));
  }
  return out;
};


export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const productGid = url.searchParams.get("product_gid") || "";
  const productText = url.searchParams.get("product_text") || "";
  const ratingRaw = url.searchParams.get("rating") || "";
  const statusRaw = url.searchParams.get("status") || "";

  const rating = ratingRaw ? Number(ratingRaw) : undefined;
  const status = Object.values(ReviewStatus).includes(statusRaw as ReviewStatus)
    ? (statusRaw as ReviewStatus)
    : undefined;

  const reviews = await listReviewsByShop(session.shop, {
    productGid,
    productText,
    rating: Number.isInteger(rating) ? rating : undefined,
    status,
  });

  const uniqueProducts = [...new Set(reviews.map((r) => r.product_gid))];
  const aggregates = await prisma.product_aggregates.findMany({
    where: {
      shop_id: session.shop,
      product_gid: { in: uniqueProducts.length ? uniqueProducts : ["__none__"] },
    },
  });

  const aggregateByProduct = Object.fromEntries(
    aggregates.map((a) => [
      a.product_gid,
      {
        review_count_published: a.review_count_published,
        rating_avg_published: Number(a.rating_avg_published),
      },
    ]),
  );

  return json({
    reviews,
    aggregateByProduct,
    filters: { productGid, productText, rating: ratingRaw, status: statusRaw },
    adminProductBase: `https://admin.shopify.com/store/${session.shop.replace(".myshopify.com", "")}/products/`,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");

  if (intent === "create") {
    const rating = Number(formData.get("rating"));
    const input = {
      shopId: session.shop,
      product_gid: String(formData.get("product_gid") || ""),
      product_handle_snapshot: (formData.get("product_handle_snapshot") as string) || null,
      product_title_snapshot: (formData.get("product_title_snapshot") as string) || null,
      reviewer_name: String(formData.get("reviewer_name") || ""),
      rating,
      title: (formData.get("title") as string) || null,
      body: String(formData.get("body") || ""),
      media_urls: parseMediaUrlsField(String(formData.get("media_urls") || "")),
      submitted_at: formData.get("submitted_at")
        ? new Date(String(formData.get("submitted_at")))
        : null,
    };

    const errors = validateCreateReviewInput(input);
    if (errors.length) {
      return json({ ok: false, errors }, { status: 400 });
    }

    const review = await createReview(input);
    return json({ ok: true, reviewId: review.id });
  }

  if (intent === "publish" || intent === "unpublish") {
    const reviewId = String(formData.get("review_id") || "");
    const nextStatus = intent === "publish" ? ReviewStatus.published : ReviewStatus.unpublished;

    await setReviewStatus({ reviewId, shopId: session.shop, nextStatus });
    return json({ ok: true });
  }

  if (intent === "bulk_publish" || intent === "bulk_unpublish" || intent === "bulk_reassign" || intent === "bulk_archive") {
    const ids = String(formData.get("review_ids") || "")
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
    if (!ids.length) return json({ ok: false, error: "No reviews selected" }, { status: 400 });

    if (intent === "bulk_publish" || intent === "bulk_unpublish" || intent === "bulk_archive") {
      const nextStatus = intent === "bulk_publish" ? ReviewStatus.published : ReviewStatus.unpublished;
      for (const id of ids) {
        await setReviewStatus({ reviewId: id, shopId: session.shop, nextStatus });
      }
      return json({ ok: true, updated: ids.length });
    }

    if (intent === "bulk_reassign") {
      const targetGid = String(formData.get("bulk_product_gid") || "");
      const targetTitle = String(formData.get("bulk_product_title_snapshot") || "") || null;
      const targetHandle = String(formData.get("bulk_product_handle_snapshot") || "") || null;
      if (!targetGid) return json({ ok: false, error: "Target product required" }, { status: 400 });

      for (const id of ids) {
        const existing = await prisma.reviews.findFirst({ where: { id, shop_id: session.shop } });
        if (!existing) continue;
        const mediaRows = await prisma.$queryRawUnsafe<any[]>(`SELECT media_url FROM review_media WHERE review_id = $1::uuid ORDER BY sort_order ASC`, id).catch(() => []);
        await updateReviewById({
          shopId: session.shop,
          reviewId: id,
          input: {
            product_gid: targetGid,
            reviewer_name: existing.reviewer_name,
            rating: existing.rating,
            title: existing.title,
            body: existing.body,
            submitted_at: existing.submitted_at,
            product_handle_snapshot: targetHandle,
            product_title_snapshot: targetTitle,
            media_urls: mediaRows.map((m) => m.media_url),
            status: existing.status,
          },
        });
      }

      return json({ ok: true, updated: ids.length });
    }
  }

  if (intent === "edit") {
    const reviewId = String(formData.get("review_id") || "");
    const rating = Number(formData.get("rating"));
    const reviewer_name = String(formData.get("reviewer_name") || "");
    const body = String(formData.get("body") || "");
    const product_gid = String(formData.get("product_gid") || "");
    const statusRaw = String(formData.get("status") || "draft");

    const status = Object.values(ReviewStatus).includes(statusRaw as ReviewStatus)
      ? (statusRaw as ReviewStatus)
      : ReviewStatus.draft;

    if (!reviewer_name.trim() || !body.trim() || !product_gid.trim() || !Number.isInteger(rating) || rating < 1 || rating > 5) {
      return json({ ok: false, error: "Invalid edit payload" }, { status: 400 });
    }

    await updateReviewById({
      shopId: session.shop,
      reviewId,
      input: {
        product_gid,
        reviewer_name,
        rating,
        title: String(formData.get("title") || "") || null,
        body,
        submitted_at: formData.get("submitted_at") ? new Date(String(formData.get("submitted_at"))) : null,
        product_handle_snapshot: String(formData.get("product_handle_snapshot") || "") || null,
        product_title_snapshot: String(formData.get("product_title_snapshot") || "") || null,
        media_urls: parseMediaUrlsField(String(formData.get("media_urls") || "")),
        status,
      },
    });

    return json({ ok: true });
  }

  return json({ ok: false, error: "Unknown intent" }, { status: 400 });
};

const badgeTone = (status: ReviewStatus): "success" | "attention" | "info" => {
  if (status === ReviewStatus.published) return "success";
  if (status === ReviewStatus.unpublished) return "attention";
  return "info";
};

export default function ReviewsPage() {
  const { reviews, aggregateByProduct, filters, adminProductBase } = useLoaderData<typeof loader>();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const embeddedKeys = ["shop", "host", "embedded", "hmac", "timestamp", "id_token", "locale", "session"];
  const embeddedParams = Object.fromEntries(
    embeddedKeys
      .map((k) => [k, searchParams.get(k) || ""])
      .filter(([, v]) => !!v),
  );
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";

  const keepEmbeddedParams = (path: string) => {
    const current = new URLSearchParams(location.search);
    ["product_gid", "product_text", "rating", "status"].forEach((k) => current.delete(k));
    const q = current.toString();
    return q ? `${path}?${q}` : path;
  };

  const hasFilters =
    !!(filters.productGid || filters.productText || filters.rating || filters.status || searchParams.toString());

  const [createOpen, setCreateOpen] = useState(false);
  const [createMedia, setCreateMedia] = useState<string[]>([]);
  const [createUrl, setCreateUrl] = useState("");
  const [filterProduct, setFilterProduct] = useState<ProductOption | null>(null);
  const [createProduct, setCreateProduct] = useState<ProductOption | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkProduct, setBulkProduct] = useState<ProductOption | null>(null);

  const addCreateUrl = () => {
    if (!createUrl.trim()) return;
    setCreateMedia([...createMedia, createUrl.trim()]);
    setCreateUrl("");
  };

  const onCreateFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const arr = Array.from(files).slice(0, 8);
    const converted = await Promise.all(
      arr.map(
        (f) =>
          new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ""));
            reader.onerror = reject;
            reader.readAsDataURL(f);
          }),
      ),
    );
    setCreateMedia([...createMedia, ...converted.filter(Boolean)]);
  };

  return (
    <Page>
      <TitleBar title="Reviews" />
      <BlockStack gap="400">
        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">Manage reviews</Text>
              <Button variant="primary" onClick={() => setCreateOpen(true)}>Create review</Button>
            </InlineStack>
            <Form method="get">
              <BlockStack gap="300">
                {Object.entries(embeddedParams).map(([k, v]) => (
                  <input key={k} type="hidden" name={k} value={v} />
                ))}
                <InlineStack gap="300" wrap>
                  <input type="hidden" name="product_gid" value={filterProduct?.gid || ""} />
                  <input type="hidden" name="product_text" value="" />
                  <ProductSearchPicker
                    label="Filter by product"
                    value={filterProduct}
                    onChange={(p) => setFilterProduct(p)}
                  />
                  <label style={{ width: 160 }}>
                    <Text as="span" variant="bodyMd">Rating</Text>
                    <select name="rating" defaultValue={filters.rating || ""} style={{ width: "100%", padding: 8, marginTop: 6 }}>
                      <option value="">All</option><option value="1">1</option><option value="2">2</option><option value="3">3</option><option value="4">4</option><option value="5">5</option>
                    </select>
                  </label>
                  <label style={{ width: 200 }}>
                    <Text as="span" variant="bodyMd">Status</Text>
                    <select name="status" defaultValue={filters.status || ""} style={{ width: "100%", padding: 8, marginTop: 6 }}>
                      <option value="">All</option><option value="draft">draft</option><option value="published">published</option><option value="unpublished">unpublished</option>
                    </select>
                  </label>
                </InlineStack>
                <InlineStack align="end" gap="200">
                  {hasFilters && (
                    <Link to={keepEmbeddedParams("/app/reviews")} style={{ alignSelf: "center" }}>
                      Clear
                    </Link>
                  )}
                  <Button submit variant="primary" loading={busy}>Apply filters</Button>
                </InlineStack>
              </BlockStack>
            </Form>
          </BlockStack>
        </Card>

        {selectedIds.length ? (
          <Card>
            <BlockStack gap="200">
              <Text as="p" variant="bodyMd">{selectedIds.length} selected</Text>
              <InlineStack gap="200" wrap>
                <Form method="post"><input type="hidden" name="intent" value="bulk_publish" /><input type="hidden" name="review_ids" value={selectedIds.join(',')} /><Button submit>Bulk publish</Button></Form>
                <Form method="post"><input type="hidden" name="intent" value="bulk_unpublish" /><input type="hidden" name="review_ids" value={selectedIds.join(',')} /><Button submit>Bulk unpublish</Button></Form>
                <Form method="post"><input type="hidden" name="intent" value="bulk_archive" /><input type="hidden" name="review_ids" value={selectedIds.join(',')} /><Button submit tone="critical">Bulk archive</Button></Form>
              </InlineStack>
              <Form method="post">
                <input type="hidden" name="intent" value="bulk_reassign" />
                <input type="hidden" name="review_ids" value={selectedIds.join(',')} />
                <input type="hidden" name="bulk_product_gid" value={bulkProduct?.gid || ''} />
                <input type="hidden" name="bulk_product_title_snapshot" value={bulkProduct?.title || ''} />
                <input type="hidden" name="bulk_product_handle_snapshot" value={bulkProduct?.handle || ''} />
                <InlineStack gap="200" wrap>
                  <ProductSearchPicker label="Bulk reassign product" value={bulkProduct} onChange={setBulkProduct} />
                  <Button submit variant="primary">Apply product reassignment</Button>
                </InlineStack>
              </Form>
            </BlockStack>
          </Card>
        ) : null}

        <BlockStack gap="250">
          {reviews.map((review) => {
            const agg = aggregateByProduct[review.product_gid] || { review_count_published: 0, rating_avg_published: 0 };
            const productId = productIdFromGid(review.product_gid);
            const productHref = productId ? `${adminProductBase}${productId}` : undefined;

            return (
              <Card key={review.id}>
                <BlockStack gap="200">
                  <InlineStack align="space-between" blockAlign="center" wrap>
                    <InlineStack gap="200" blockAlign="center" wrap>
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(review.id)}
                        onChange={(e) => {
                          if (e.currentTarget.checked) setSelectedIds(Array.from(new Set([...selectedIds, review.id])));
                          else setSelectedIds(selectedIds.filter((id) => id !== review.id));
                        }}
                      />
                      <Text as="p" variant="headingSm">{review.reviewer_name}</Text>
                      <Badge tone={badgeTone(review.status)}>{review.status}</Badge>
                      <Text as="span" variant="bodySm" tone="subdued">{new Date(review.created_at).toLocaleDateString()}</Text>
                    </InlineStack>
                    <InlineStack gap="150" wrap>
                      <Link
                        to={`${keepEmbeddedParams(`/app/reviews/${review.id}/edit`)}`}
                        style={{
                          display: "inline-block",
                          padding: "6px 10px",
                          border: "1px solid #d1d5db",
                          borderRadius: 8,
                          textDecoration: "none",
                          color: "#111827",
                          lineHeight: 1.2,
                        }}
                      >
                        Edit
                      </Link>
                      <Form method="post"><input type="hidden" name="intent" value="publish" /><input type="hidden" name="review_id" value={review.id} /><Button size="slim" submit disabled={review.status === "published" || busy}>Publish</Button></Form>
                      <Form method="post"><input type="hidden" name="intent" value="unpublish" /><input type="hidden" name="review_id" value={review.id} /><Button size="slim" submit disabled={review.status !== "published" || busy}>Unpublish</Button></Form>
                    </InlineStack>
                  </InlineStack>

                  <InlineStack gap="300" wrap>
                    <Text as="p" variant="bodyMd">★ {review.rating}</Text>
                    {productHref ? (
                      <a href={productHref} target="_blank" rel="noreferrer">{review.product_title_snapshot || review.product_gid}</a>
                    ) : (
                      <Text as="p" variant="bodyMd">{review.product_title_snapshot || review.product_gid}</Text>
                    )}
                    <Text as="p" variant="bodySm" tone="subdued">Aggregate: {agg.rating_avg_published} ★ ({agg.review_count_published})</Text>
                  </InlineStack>

                  {review.title ? <Text as="p" variant="bodyMd">{review.title}</Text> : null}
                  <Text as="p" variant="bodyMd">{review.body}</Text>
                  {review.media?.length ? (
                    <div style={{ position: "relative", width: 64, height: 64 }}>
                      <img src={review.media[0].media_url} alt="review media" style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 8, border: "1px solid #ddd" }} />
                      {review.media.length > 1 ? (
                        <span style={{ position: "absolute", right: 4, bottom: 4, background: "rgba(15,23,42,.72)", color: "#fff", borderRadius: 8, padding: "1px 6px", fontSize: 11, fontWeight: 600 }}>
                          +{review.media.length - 1}
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                </BlockStack>
              </Card>
            );
          })}
        </BlockStack>
      </BlockStack>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Create review" primaryAction={undefined}>
        <Modal.Section>
          <Form method="post">
            <input type="hidden" name="intent" value="create" />
            <input type="hidden" name="media_urls" value={createMedia.join("\n")} />
            <BlockStack gap="300">
              <input type="hidden" name="product_gid" value={createProduct?.gid || ""} />
              <input type="hidden" name="product_handle_snapshot" value={createProduct?.handle || ""} />
              <input type="hidden" name="product_title_snapshot" value={createProduct?.title || ""} />
              <ProductSearchPicker
                label="Product"
                value={createProduct}
                onChange={(p) => setCreateProduct(p)}
              />
              <InlineStack gap="300" wrap>
                <label style={{ flex: 1, minWidth: 220 }}><Text as="span" variant="bodyMd">Reviewer name</Text><input name="reviewer_name" required style={{ width: "100%", padding: 8, marginTop: 6 }} /></label>
                <label style={{ width: 160 }}><Text as="span" variant="bodyMd">Rating (1-5)</Text><input name="rating" type="number" min={1} max={5} required style={{ width: "100%", padding: 8, marginTop: 6 }} /></label>
              </InlineStack>
              <label><Text as="span" variant="bodyMd">Title (optional)</Text><input name="title" style={{ width: "100%", padding: 8, marginTop: 6 }} /></label>
              <label><Text as="span" variant="bodyMd">Body</Text><textarea name="body" required rows={4} style={{ width: "100%", padding: 8, marginTop: 6 }} /></label>
              <Card>
                <BlockStack gap="200">
                  <Text as="h3" variant="headingSm">Media</Text>
                  <InlineStack gap="200" wrap>
                    {createMedia.map((url, idx) => (
                      <div key={`${url}-${idx}`} style={{ position: "relative" }}>
                        <img src={url} alt="media" style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 8, border: "1px solid #ddd" }} />
                        <Button size="micro" tone="critical" onClick={() => setCreateMedia(createMedia.filter((_, i) => i !== idx))}>Remove</Button>
                      </div>
                    ))}
                  </InlineStack>
                  <InlineStack gap="200" wrap>
                    <input value={createUrl} onChange={(e) => setCreateUrl(e.currentTarget.value)} placeholder="https://image-url" style={{ minWidth: 260, padding: 8 }} />
                    <Button onClick={addCreateUrl}>Add URL</Button>
                    <input type="file" accept="image/*" multiple onChange={(e) => onCreateFiles(e.currentTarget.files)} />
                  </InlineStack>
                </BlockStack>
              </Card>
              <label><Text as="span" variant="bodyMd">Submitted at (optional ISO date)</Text><input name="submitted_at" style={{ width: "100%", padding: 8, marginTop: 6 }} /></label>
              <InlineStack align="end" gap="200"><Button onClick={() => setCreateOpen(false)}>Cancel</Button><Button submit variant="primary" loading={busy}>Save as draft</Button></InlineStack>
            </BlockStack>
          </Form>
        </Modal.Section>
      </Modal>

      <Outlet />
    </Page>
  );
}
