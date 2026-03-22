import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import {
  createReview,
  listReviewsByShop,
  validateCreateReviewInput,
} from "../lib/reviews.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const reviews = await listReviewsByShop(session.shop);
  return json({ reviews });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const body = await request.json();

  const input = {
    shopId: session.shop,
    product_gid: body.product_gid,
    product_handle_snapshot: body.product_handle_snapshot ?? null,
    product_title_snapshot: body.product_title_snapshot ?? null,
    reviewer_name: body.reviewer_name,
    rating: Number(body.rating),
    title: body.title ?? null,
    body: body.body,
    image_url: body.image_url ?? null,
    submitted_at: body.submitted_at ? new Date(body.submitted_at) : null,
  };

  const errors = validateCreateReviewInput(input);
  if (errors.length) {
    return json({ ok: false, errors }, { status: 400 });
  }

  const review = await createReview(input);

  return json({ ok: true, review });
};
