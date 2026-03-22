import type { HeadersFunction, LoaderFunctionArgs } from "@remix-run/node";
import { Link, Outlet, useLoaderData, useLocation, useRouteError } from "@remix-run/react";
import { boundary } from "@shopify/shopify-app-remix/server";
import { AppProvider } from "@shopify/shopify-app-remix/react";
import { NavMenu } from "@shopify/app-bridge-react";
import polarisStyles from "@shopify/polaris/build/esm/styles.css?url";

import { authenticate } from "../shopify.server";

export const links = () => [{ rel: "stylesheet", href: polarisStyles }];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  const url = new URL(request.url);
  const p = new URLSearchParams();
  ["shop", "host", "embedded", "hmac", "timestamp", "id_token", "session", "locale"].forEach((k) => {
    const v = url.searchParams.get(k);
    if (v) p.set(k, v);
  });

  return { apiKey: process.env.SHOPIFY_API_KEY || "", embeddedQuery: p.toString() };
};

export default function App() {
  const { apiKey, embeddedQuery } = useLoaderData<typeof loader>();
  const location = useLocation();
  const qs = location.search || (embeddedQuery ? `?${embeddedQuery}` : "");
  const withEmbeddedParams = (path: string) => `${path}${qs}`;

  return (
    <AppProvider isEmbeddedApp apiKey={apiKey}>
      <NavMenu>
        <Link to={withEmbeddedParams("/app")} rel="home">
          Home
        </Link>
        <Link to={withEmbeddedParams("/app/reviews")}>Reviews</Link>
        <Link to={withEmbeddedParams("/app/imports")}>Imports</Link>
        <Link to={withEmbeddedParams("/app/widget-settings")}>Widget settings</Link>
        <Link to={withEmbeddedParams("/app/additional")}>Additional page</Link>
      </NavMenu>
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs Remix to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
