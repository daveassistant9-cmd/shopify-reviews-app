import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useLoaderData, useNavigation } from "@remix-run/react";
import { BlockStack, Box, Button, Card, InlineStack, Page, Text } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { getWidgetSettings, upsertWidgetSettings } from "../lib/widget-settings.server";

const num = (v: FormDataEntryValue | null, d: number, min?: number, max?: number) => {
  const n = Number(v);
  const safe = Number.isFinite(n) ? n : d;
  const lower = min == null ? safe : Math.max(min, safe);
  return max == null ? lower : Math.min(max, lower);
};

const bool = (v: FormDataEntryValue | null) => String(v || "") === "on";

const FONT_OPTIONS = [
  { label: "Default (Poppins)", value: "Poppins, Inter, system-ui, sans-serif" },
  { label: "Inter", value: "Inter, system-ui, sans-serif" },
  { label: "Poppins", value: "Poppins, system-ui, sans-serif" },
  { label: "Helvetica / Arial", value: "Helvetica, Arial, sans-serif" },
  { label: "Georgia", value: "Georgia, serif" },
  { label: "Times New Roman", value: '"Times New Roman", Times, serif' },
] as const;

const CORNER_OPTIONS = [
  { key: "sharp", label: "Sharp", radius: 4 },
  { key: "slight", label: "Slightly rounded", radius: 10 },
  { key: "rounded", label: "Rounded", radius: 16 },
  { key: "extra", label: "Extra rounded", radius: 24 },
] as const;

const closestCorner = (value: number) =>
  CORNER_OPTIONS.reduce((best, item) =>
    Math.abs(item.radius - value) < Math.abs(best.radius - value) ? item : best,
  CORNER_OPTIONS[1]);

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const settings = await getWidgetSettings(session.shop);
  return json({ settings });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();

  const cornerPreset = String(formData.get("corner_style") || "");
  const cornerMatch = CORNER_OPTIONS.find((o) => o.key === cornerPreset);
  const borderRadius = cornerMatch
    ? cornerMatch.radius
    : num(formData.get("border_radius_px"), 12, 0, 40);

  await upsertWidgetSettings(session.shop, {
    star_color: String(formData.get("star_color") || "#f59e0b"),
    text_color: String(formData.get("text_color") || "#111827"),
    meta_text_color: String(formData.get("meta_text_color") || "#6b7280"),
    card_bg_color: String(formData.get("card_bg_color") || "#ffffff"),
    card_border_color: String(formData.get("card_border_color") || "#e5e7eb"),
    border_radius_px: borderRadius,
    font_family: String(formData.get("font_family") || "Inter, system-ui, sans-serif"),
    heading_size_px: num(formData.get("heading_size_px"), 20, 14, 40),
    body_size_px: num(formData.get("body_size_px"), 14, 11, 24),
    meta_size_px: num(formData.get("meta_size_px"), 12, 10, 20),
    card_spacing_px: num(formData.get("card_spacing_px"), 12, 6, 30),
    desktop_columns: num(formData.get("desktop_columns"), 3, 1, 4),
    mobile_columns: num(formData.get("mobile_columns"), 2, 1, 2),
    show_verified_badge: bool(formData.get("show_verified_badge")),
    show_review_date: bool(formData.get("show_review_date")),
    show_rating_breakdown: bool(formData.get("show_rating_breakdown")),
    show_write_review_btn: bool(formData.get("show_write_review_btn")),
    write_review_label: String(formData.get("write_review_label") || "Write a review"),
    section_heading: String(formData.get("section_heading") || ""),
    empty_state_text: String(formData.get("empty_state_text") || "No reviews yet"),
    verified_badge_label: String(formData.get("verified_badge_label") || "Verified"),
    verified_badge_color: String(formData.get("verified_badge_color") || "#eef2ff"),
    verified_badge_text_color: String(formData.get("verified_badge_text_color") || "#4f46e5"),
    summary_star_size_px: num(formData.get("summary_star_size_px"), 15, 10, 28),
    summary_text_size_px: num(formData.get("summary_text_size_px"), 14, 10, 28),
    write_review_btn_font_size_px: num(formData.get("write_review_btn_font_size_px"), 14, 10, 28),
    show_review_count: bool(formData.get("show_review_count")),
    review_count_label: String(formData.get("review_count_label") || "Reviews"),
    modal_title: String(formData.get("modal_title") || "Write a review"),
    modal_subtitle: String(formData.get("modal_subtitle") || "Share your experience with this product"),
    modal_name_label: String(formData.get("modal_name_label") || "Your name"),
    modal_rating_label: String(formData.get("modal_rating_label") || "Rating"),
    modal_review_title_label: String(formData.get("modal_review_title_label") || "Review title"),
    modal_review_body_label: String(formData.get("modal_review_body_label") || "Review"),
    modal_image_label: String(formData.get("modal_image_label") || "Images (optional)"),
    modal_submit_label: String(formData.get("modal_submit_label") || "Submit review"),
    modal_success_message: String(formData.get("modal_success_message") || "Thanks! Your review was submitted for moderation."),
    modal_error_message: String(formData.get("modal_error_message") || "Failed to submit review"),
    modal_close_label: String(formData.get("modal_close_label") || "Close"),
    modal_image_helper_text: String(formData.get("modal_image_helper_text") || "You can upload up to 5 images"),
    initial_reviews_limit: num(formData.get("initial_reviews_limit"), 20, 1, 100),
    load_more_step: num(formData.get("load_more_step"), 20, 1, 100),
    load_more_label: String(formData.get("load_more_label") || "Load more reviews"),
    default_sort_mode: String(formData.get("default_sort_mode") || "image_first"),
  });

  return json({ ok: true });
};

function ColorControl({ label, name, value }: { label: string; name: string; value: string }) {
  return (
    <div style={{ minWidth: 220 }}>
      <Text as="p" variant="bodySm" tone="subdued">{label}</Text>
      <InlineStack align="start" gap="200" blockAlign="center">
        <input type="color" name={name} defaultValue={value} style={{ width: 42, height: 32 }} />
        <input name={name} defaultValue={value} style={{ width: 140 }} />
      </InlineStack>
    </div>
  );
}

export default function WidgetSettingsPage() {
  const { settings } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const corner = closestCorner(Number(settings.border_radius_px || 12));

  return (
    <Page>
      <TitleBar title="Widget settings" />
      <Form method="post">
        <BlockStack gap="400">
          <Card>
            <BlockStack gap="200">
              <Text as="h2" variant="headingMd">Widget customizer</Text>
              <Text as="p" variant="bodySm" tone="subdued">
                Polish your storefront reviews widget style and copy without changing widget architecture.
              </Text>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="300">
              <Text as="h3" variant="headingSm">Typography</Text>
              <InlineStack gap="400" wrap>
                <div>
                  <Text as="p" variant="bodySm">Font family</Text>
                  <select name="font_family" defaultValue={settings.font_family}>
                    {FONT_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
                <label><Text as="span" variant="bodySm">Heading size</Text><input name="heading_size_px" type="number" defaultValue={settings.heading_size_px} /></label>
                <label><Text as="span" variant="bodySm">Body size</Text><input name="body_size_px" type="number" defaultValue={settings.body_size_px} /></label>
                <label><Text as="span" variant="bodySm">Meta size</Text><input name="meta_size_px" type="number" defaultValue={settings.meta_size_px} /></label>
                <label><Text as="span" variant="bodySm">Summary star size</Text><input name="summary_star_size_px" type="number" defaultValue={settings.summary_star_size_px || 15} /></label>
                <label><Text as="span" variant="bodySm">Summary text size</Text><input name="summary_text_size_px" type="number" defaultValue={settings.summary_text_size_px || 14} /></label>
                <label><Text as="span" variant="bodySm">Write review button font size</Text><input name="write_review_btn_font_size_px" type="number" defaultValue={settings.write_review_btn_font_size_px || settings.body_size_px || 14} /></label>
              </InlineStack>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="300">
              <Text as="h3" variant="headingSm">Colors</Text>
              <InlineStack gap="300" wrap>
                <ColorControl label="Star color" name="star_color" value={settings.star_color} />
                <ColorControl label="Text color" name="text_color" value={settings.text_color} />
                <ColorControl label="Meta text color" name="meta_text_color" value={settings.meta_text_color} />
                <ColorControl label="Card background" name="card_bg_color" value={settings.card_bg_color} />
                <ColorControl label="Card border" name="card_border_color" value={settings.card_border_color} />
                <ColorControl label="Verified badge background" name="verified_badge_color" value={settings.verified_badge_color || "#eef2ff"} />
                <ColorControl label="Verified badge text" name="verified_badge_text_color" value={settings.verified_badge_text_color || "#4f46e5"} />
              </InlineStack>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="300">
              <Text as="h3" variant="headingSm">Corner style</Text>
              <input type="hidden" name="border_radius_px" value={settings.border_radius_px} />
              <InlineStack gap="300" wrap>
                {CORNER_OPTIONS.map((option) => (
                  <label key={option.key} style={{ display: "block", cursor: "pointer" }}>
                    <input
                      type="radio"
                      name="corner_style"
                      value={option.key}
                      defaultChecked={option.key === corner.key}
                      style={{ marginBottom: 8 }}
                    />
                    <Box borderColor="border" borderWidth="025" borderRadius="200" padding="200">
                      <div
                        style={{
                          width: 70,
                          height: 40,
                          border: `1px solid ${settings.card_border_color}`,
                          borderRadius: option.radius,
                          background: settings.card_bg_color,
                        }}
                      />
                      <Text as="p" variant="bodySm">{option.label}</Text>
                    </Box>
                  </label>
                ))}
              </InlineStack>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="300">
              <Text as="h3" variant="headingSm">Layout</Text>
              <InlineStack gap="300" wrap>
                <label><Text as="span" variant="bodySm">Desktop columns</Text><input name="desktop_columns" type="number" min={1} max={4} defaultValue={settings.desktop_columns} /></label>
                <label><Text as="span" variant="bodySm">Mobile columns</Text><input name="mobile_columns" type="number" min={1} max={2} defaultValue={settings.mobile_columns} /></label>
                <label><Text as="span" variant="bodySm">Card spacing</Text><input name="card_spacing_px" type="number" defaultValue={settings.card_spacing_px} /></label>
              </InlineStack>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="300">
              <Text as="h3" variant="headingSm">Review loading & sorting</Text>
              <InlineStack gap="300" wrap>
                <label><Text as="span" variant="bodySm">Initial reviews limit</Text><input name="initial_reviews_limit" type="number" min={1} max={100} defaultValue={settings.initial_reviews_limit ?? 20} /></label>
                <label><Text as="span" variant="bodySm">Load more step</Text><input name="load_more_step" type="number" min={1} max={100} defaultValue={settings.load_more_step ?? 20} /></label>
                <label><Text as="span" variant="bodySm">Load more button label</Text><input name="load_more_label" defaultValue={settings.load_more_label || "Load more reviews"} /></label>
                <div>
                  <Text as="p" variant="bodySm">Default sort mode</Text>
                  <select name="default_sort_mode" defaultValue={settings.default_sort_mode || "image_first"}>
                    <option value="image_first">Image first</option>
                    <option value="newest">Newest</option>
                    <option value="oldest">Oldest</option>
                    <option value="highest_rated">Highest rated</option>
                    <option value="lowest_rated">Lowest rated</option>
                  </select>
                </div>
              </InlineStack>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="300">
              <Text as="h3" variant="headingSm">Text / labels</Text>
              <InlineStack gap="300" wrap>
                <label><Text as="span" variant="bodySm">Section heading</Text><input name="section_heading" defaultValue={settings.section_heading} /></label>
                <label><Text as="span" variant="bodySm">Write review button label</Text><input name="write_review_label" defaultValue={settings.write_review_label} /></label>
                <label><Text as="span" variant="bodySm">Review count label (e.g. Reviews)</Text><input name="review_count_label" defaultValue={settings.review_count_label || "Reviews"} /></label>
                <label><Text as="span" variant="bodySm">Empty state text</Text><input name="empty_state_text" defaultValue={settings.empty_state_text} /></label>
                <label><Text as="span" variant="bodySm">Verified badge label</Text><input name="verified_badge_label" defaultValue={settings.verified_badge_label} /></label>
              </InlineStack>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="300">
              <Text as="h3" variant="headingSm">Write-review modal copy</Text>
              <InlineStack gap="300" wrap>
                <label><Text as="span" variant="bodySm">Modal title</Text><input name="modal_title" defaultValue={settings.modal_title || "Write a review"} /></label>
                <label><Text as="span" variant="bodySm">Modal subtitle</Text><input name="modal_subtitle" defaultValue={settings.modal_subtitle || "Share your experience with this product"} /></label>
                <label><Text as="span" variant="bodySm">Name label</Text><input name="modal_name_label" defaultValue={settings.modal_name_label || "Your name"} /></label>
                <label><Text as="span" variant="bodySm">Rating label</Text><input name="modal_rating_label" defaultValue={settings.modal_rating_label || "Rating"} /></label>
                <label><Text as="span" variant="bodySm">Review title label</Text><input name="modal_review_title_label" defaultValue={settings.modal_review_title_label || "Review title"} /></label>
                <label><Text as="span" variant="bodySm">Review body label</Text><input name="modal_review_body_label" defaultValue={settings.modal_review_body_label || "Review"} /></label>
                <label><Text as="span" variant="bodySm">Image label</Text><input name="modal_image_label" defaultValue={settings.modal_image_label || "Images (optional)"} /></label>
                <label><Text as="span" variant="bodySm">Image helper text</Text><input name="modal_image_helper_text" defaultValue={settings.modal_image_helper_text || "You can upload up to 5 images"} /></label>
                <label><Text as="span" variant="bodySm">Submit button label</Text><input name="modal_submit_label" defaultValue={settings.modal_submit_label || "Submit review"} /></label>
                <label><Text as="span" variant="bodySm">Success message</Text><input name="modal_success_message" defaultValue={settings.modal_success_message || "Thanks! Your review was submitted for moderation."} /></label>
                <label><Text as="span" variant="bodySm">Error message</Text><input name="modal_error_message" defaultValue={settings.modal_error_message || "Failed to submit review"} /></label>
                <label><Text as="span" variant="bodySm">Close label</Text><input name="modal_close_label" defaultValue={settings.modal_close_label || "Close"} /></label>
              </InlineStack>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="300">
              <Text as="h3" variant="headingSm">Display toggles</Text>
              <InlineStack gap="300" wrap>
                <label><input type="checkbox" name="show_verified_badge" defaultChecked={settings.show_verified_badge} /> Show verified badge</label>
                <label><input type="checkbox" name="show_review_date" defaultChecked={settings.show_review_date} /> Show review date</label>
                <label><input type="checkbox" name="show_rating_breakdown" defaultChecked={settings.show_rating_breakdown} /> Show rating breakdown</label>
                <label><input type="checkbox" name="show_write_review_btn" defaultChecked={settings.show_write_review_btn} /> Show write review button</label>
                <label><input type="checkbox" name="show_review_count" defaultChecked={settings.show_review_count ?? true} /> Show review count in summary</label>
              </InlineStack>
            </BlockStack>
          </Card>

          <InlineStack align="end">
            <Button submit variant="primary" loading={busy}>Save settings</Button>
          </InlineStack>
        </BlockStack>
      </Form>
    </Page>
  );
}
