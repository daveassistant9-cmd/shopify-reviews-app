import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useLoaderData, useLocation, useNavigate, useNavigation } from "@remix-run/react";
import { useMemo, useState } from "react";
import { BlockStack, Button, Card, InlineStack, Modal, Text } from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { getReviewById, updateReviewById } from "../lib/reviews.server";
import { ProductSearchPicker, type ProductOption } from "../components/ProductSearchPicker";

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

function validate(input: { reviewer_name: string; body: string; rating: number }) {
  const errors: string[] = [];
  if (!input.reviewer_name.trim()) errors.push("reviewer_name is required");
  if (!input.body.trim()) errors.push("body is required");
  if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) {
    errors.push("rating must be an integer between 1 and 5");
  }
  return errors;
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const id = params.id;
  if (!id) throw new Response("Missing review id", { status: 400 });

  const review = await getReviewById(session.shop, id);
  if (!review) throw new Response("Review not found", { status: 404 });

  return json({ review });
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const id = params.id;
  if (!id) return json({ ok: false, error: "Missing review id" }, { status: 400 });

  const formData = await request.formData();
  const rating = Number(formData.get("rating"));

  const payload = {
    product_gid: String(formData.get("product_gid") || ""),
    reviewer_name: String(formData.get("reviewer_name") || ""),
    rating,
    title: String(formData.get("title") || "") || null,
    body: String(formData.get("body") || ""),
    submitted_at: formData.get("submitted_at") ? new Date(String(formData.get("submitted_at"))) : null,
    product_handle_snapshot: String(formData.get("product_handle_snapshot") || "") || null,
    product_title_snapshot: String(formData.get("product_title_snapshot") || "") || null,
    media_urls: parseMediaUrlsField(String(formData.get("media_urls") || "")),
    status: String(formData.get("status") || "draft") as any,
  };

  const errors = validate(payload);
  if (errors.length) return json({ ok: false, errors }, { status: 400 });

  await updateReviewById({ shopId: session.shop, reviewId: id, input: payload });
  const current = new URL(request.url);
  const q = current.search || "";
  return redirect(`/app/reviews${q}`);
};

export default function EditReviewRouteModal() {
  const { review } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const navigate = useNavigate();
  const location = useLocation();
  const busy = navigation.state !== "idle";
  const backToReviews = `/app/reviews${location.search || ""}`;

  const initialMedia = useMemo(() => (review.media?.map((m: any) => m.media_url) || []), [review.media]);
  const [mediaUrls, setMediaUrls] = useState<string[]>(initialMedia);
  const [newUrl, setNewUrl] = useState("");
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<ProductOption | null>({ gid: review.product_gid, title: review.product_title_snapshot || review.product_gid, handle: review.product_handle_snapshot || "" });

  const remove = (idx: number) => setMediaUrls(mediaUrls.filter((_, i) => i !== idx));
  const reorder = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || from >= mediaUrls.length || to >= mediaUrls.length) return;
    const copy = [...mediaUrls];
    const [item] = copy.splice(from, 1);
    copy.splice(to, 0, item);
    setMediaUrls(copy);
  };

  const addUrl = () => {
    if (!newUrl.trim()) return;
    setMediaUrls([...mediaUrls, newUrl.trim()]);
    setNewUrl("");
  };

  const onFiles = async (files: FileList | null) => {
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
    setMediaUrls([...mediaUrls, ...converted.filter(Boolean)]);
  };

  return (
    <Modal open onClose={() => navigate(backToReviews)} title="Edit review" large>
      <Modal.Section>
        <Form method="post">
          <BlockStack gap="300">
            <input type="hidden" name="status" value={review.status} />
            <input type="hidden" name="media_urls" value={mediaUrls.join("\n")} />
            <input type="hidden" name="product_gid" value={selectedProduct?.gid || ""} />
            <input type="hidden" name="product_handle_snapshot" value={selectedProduct?.handle || ""} />
            <input type="hidden" name="product_title_snapshot" value={selectedProduct?.title || ""} />

            <ProductSearchPicker label="Product" value={selectedProduct} onChange={(p) => setSelectedProduct(p)} />
            <label><Text as="span" variant="bodyMd">Reviewer name</Text><input name="reviewer_name" defaultValue={review.reviewer_name} required style={{ width: "100%", padding: 8, marginTop: 6 }} /></label>
            <label><Text as="span" variant="bodyMd">Rating (1-5)</Text><input name="rating" type="number" min={1} max={5} defaultValue={review.rating} required style={{ width: "100%", padding: 8, marginTop: 6 }} /></label>
            <label><Text as="span" variant="bodyMd">Title</Text><input name="title" defaultValue={review.title || ""} style={{ width: "100%", padding: 8, marginTop: 6 }} /></label>
            <label><Text as="span" variant="bodyMd">Body</Text><textarea name="body" defaultValue={review.body} required rows={5} style={{ width: "100%", padding: 8, marginTop: 6 }} /></label>

            <Card>
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm">Media</Text>
                <InlineStack gap="200" wrap>
                  {mediaUrls.map((url, idx) => (
                    <div
                      key={`${url}-${idx}`}
                      style={{ width: 110, padding: 6, border: dragIndex === idx ? '2px solid #6366f1' : '1px solid #ddd', borderRadius: 10, background: '#fff' }}
                      draggable
                      onDragStart={() => setDragIndex(idx)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => { if (dragIndex != null) reorder(dragIndex, idx); setDragIndex(null); }}
                      onDragEnd={() => setDragIndex(null)}
                    >
                      <img src={url} alt="review media" style={{ width: 96, height: 96, objectFit: "cover", borderRadius: 8, border: "1px solid #ddd" }} />
                      <InlineStack align="space-between" blockAlign="center">
                        <Text as="span" variant="bodySm" tone="subdued">#{idx + 1}</Text>
                        <Button size="micro" tone="critical" onClick={() => remove(idx)}>Remove</Button>
                      </InlineStack>
                    </div>
                  ))}
                </InlineStack>

                <InlineStack gap="200" wrap>
                  <input value={newUrl} onChange={(e) => setNewUrl(e.currentTarget.value)} placeholder="https://image-url" style={{ minWidth: 280, padding: 8 }} />
                  <Button onClick={addUrl}>Add URL</Button>
                  <input type="file" accept="image/*" multiple onChange={(e) => onFiles(e.currentTarget.files)} />
                </InlineStack>
              </BlockStack>
            </Card>

            <label><Text as="span" variant="bodyMd">Submitted at</Text><input name="submitted_at" defaultValue={review.submitted_at ? new Date(review.submitted_at).toISOString() : ""} style={{ width: "100%", padding: 8, marginTop: 6 }} /></label>

            <InlineStack align="end" gap="200">
              <Button onClick={() => navigate(backToReviews)}>Cancel</Button>
              <Button submit variant="primary" loading={busy}>Save</Button>
            </InlineStack>
          </BlockStack>
        </Form>
      </Modal.Section>
    </Modal>
  );
}
