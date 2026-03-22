import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    const { admin } = await authenticate.admin(request);
    const url = new URL(request.url);
    const q = (url.searchParams.get("q") || "").trim();

    const query = q ? `title:*${q}* OR handle:*${q}*` : undefined;

    const res = await admin.graphql(
      `#graphql
        query ProductSearch($first: Int!, $query: String) {
          products(first: $first, query: $query, sortKey: TITLE) {
            nodes {
              id
              title
              handle
            }
          }
        }
      `,
      { variables: { first: 20, query } },
    );

    const payload = await res.json();
    if (payload?.errors?.length) {
      return json({ ok: false, error: payload.errors[0]?.message || "Shopify query failed", products: [] }, { status: 500 });
    }

    const products = (payload?.data?.products?.nodes || []).map((p: any) => ({
      gid: p.id,
      title: p.title || p.handle || p.id,
      handle: p.handle || "",
    }));

    return json({ ok: true, products });
  } catch (error: any) {
    return json({ ok: false, error: error?.message || "Product search failed", products: [] }, { status: 500 });
  }
};
