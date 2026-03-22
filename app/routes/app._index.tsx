import type { LoaderFunctionArgs } from "@remix-run/node";
import {
  Page,
  Layout,
  Text,
  Card,
  BlockStack,
  Link,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export default function Index() {
  return (
    <Page>
      <TitleBar title="Reviews app" />
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                Reviews MVP
              </Text>
              <Text as="p" variant="bodyMd">
                Starter product-generation scaffolding has been removed for this slice.
              </Text>
              <Text as="p" variant="bodyMd">
                Continue to <Link url="/app/reviews">/app/reviews</Link> to create and manage reviews.
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
