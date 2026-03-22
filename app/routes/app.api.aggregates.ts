import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import { getAggregate } from "../lib/reviews.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const productGid = url.searchParams.get("product_gid");

  if (!productGid) {
    return json({ ok: false, error: "product_gid is required" }, { status: 400 });
  }

  const aggregate = await getAggregate(session.shop, productGid);
  return json({ ok: true, aggregate });
};
