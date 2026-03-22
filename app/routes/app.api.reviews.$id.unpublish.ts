import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { ReviewStatus } from "@prisma/client";
import { authenticate } from "../shopify.server";
import { setReviewStatus } from "../lib/reviews.server";

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const reviewId = params.id;

  if (!reviewId) {
    return json({ ok: false, error: "Missing review id" }, { status: 400 });
  }

  const review = await setReviewStatus({
    reviewId,
    shopId: session.shop,
    nextStatus: ReviewStatus.unpublished,
  });

  return json({ ok: true, review });
};
