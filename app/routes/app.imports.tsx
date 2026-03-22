import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, Link, useLoaderData, useNavigation, useLocation } from "@remix-run/react";
import { ProductSearchPicker, type ProductOption } from "../components/ProductSearchPicker";
import { useState } from "react";
import { BlockStack, Button, Card, InlineStack, Page, Text } from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { ReviewStatus } from "@prisma/client";
import { authenticate } from "../shopify.server";
import {
  commitImportJob,
  createImportJobFromCsv,
  getImportHistory,
  getImportRows,
  runImportDryRun,
} from "../lib/review-importer.server";
import prisma from "../db.server";

const MAPPABLE_FIELDS = [
  "product_gid",
  "reviewer_name",
  "rating",
  "body",
  "title",
  "submitted_at",
  "product_handle_snapshot",
  "product_title_snapshot",
  "image_url",
  "image_urls",
  "status",
  "verified_purchase",
] as const;

function readMapping(formData: FormData) {
  return {
    product_gid: String(formData.get("map_product_gid") || ""),
    reviewer_name: String(formData.get("map_reviewer_name") || ""),
    rating: String(formData.get("map_rating") || ""),
    body: String(formData.get("map_body") || ""),
    title: String(formData.get("map_title") || ""),
    submitted_at: String(formData.get("map_submitted_at") || ""),
    product_handle_snapshot: String(formData.get("map_product_handle_snapshot") || ""),
    product_title_snapshot: String(formData.get("map_product_title_snapshot") || ""),
    image_url: String(formData.get("map_image_url") || ""),
    image_urls: String(formData.get("map_image_urls") || ""),
    status: String(formData.get("map_status") || ""),
    verified_purchase: String(formData.get("map_verified_purchase") || ""),
  };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const selectedJobId = url.searchParams.get("jobId");

  const jobs = await getImportHistory(session.shop);
  const selected = selectedJobId ? jobs.find((j) => j.id === selectedJobId) : jobs[0] ?? null;
  const rows = selected ? await getImportRows(selected.id, 200) : [];

  const unresolved = rows
    .map((r: any) => ({
      row_number: r.row_number,
      loox_ref: (r.normalized_payload as any)?.loox_ref || null,
      errors: r.validation_errors as string[],
    }))
    .filter((r: any) => r.loox_ref && (r.errors || []).some((e: string) => e.includes("Unable to resolve product handle") || e.includes("product_gid is required")));

  return json({ jobs, selected, rows, unresolved });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") || "");

  if (intent === "upload_and_dry_run") {
    const csvFile = formData.get("csv_file");
    if (!(csvFile instanceof File)) {
      return json({ ok: false, error: "CSV file is required" }, { status: 400 });
    }

    const mapping = readMapping(formData);
    const defaultStatus = String(formData.get("default_import_status") || "draft");
    const csvText = await csvFile.text();

    const headerLine = (csvText.split(/\r?\n/)[0] || "").toLowerCase();
    const isLoox = ["productid", "handle", "review", "rating"].every((k) => headerLine.includes(k));
    if (isLoox) {
      if (!mapping.product_gid) mapping.product_gid = "productId";
      if (!mapping.body) mapping.body = "review";
      if (!mapping.rating) mapping.rating = "rating";
      if (!mapping.reviewer_name) mapping.reviewer_name = "full_name";
      if (!mapping.submitted_at) mapping.submitted_at = "date";
      if (!mapping.product_handle_snapshot) mapping.product_handle_snapshot = "handle";
      if (!mapping.image_url) mapping.image_url = "img";
      if (!mapping.status) mapping.status = "status";
      if (!mapping.verified_purchase) mapping.verified_purchase = "verified_purchase";
    }

    const handleToProduct: Record<string, { gid: string; title: string; handle: string }> = {};
    try {
      const res = await admin.graphql(`#graphql
        query ImportProductsByHandle {
          products(first: 250, sortKey: TITLE) { nodes { id title handle } }
        }
      `);
      const payload = await res.json();
      for (const p of payload?.data?.products?.nodes || []) {
        if (!p?.handle) continue;
        handleToProduct[String(p.handle).toLowerCase()] = { gid: p.id, title: p.title || p.handle || p.id, handle: p.handle };
      }
    } catch {}

    const savedMappingsRaw = await prisma.$queryRawUnsafe<any[]>(
      `SELECT loox_ref, target_product_gid, target_product_title, target_product_handle FROM loox_product_mappings WHERE shop_id = $1`,
      session.shop,
    ).catch(() => []);
    const savedMappings: Record<string, { gid: string; title?: string; handle?: string }> = {};
    for (const r of savedMappingsRaw || []) {
      savedMappings[r.loox_ref] = { gid: r.target_product_gid, title: r.target_product_title || "", handle: r.target_product_handle || "" };
    }

    const created = await createImportJobFromCsv({
      shopId: session.shop,
      fileName: csvFile.name,
      csvText,
      mapping,
      defaultImportStatus: defaultStatus === "published" ? ReviewStatus.published : ReviewStatus.draft,
      handleToProduct,
      savedMappings,
    });

    await runImportDryRun(created.jobId, session.shop);

    return json({ ok: true, jobId: created.jobId });
  }

  if (intent === "save_mapping") {
    const jobId = String(formData.get("job_id") || "");
    const looxRef = String(formData.get("loox_ref") || "");
    const gid = String(formData.get("target_product_gid") || "");
    const title = String(formData.get("target_product_title") || "");
    const handle = String(formData.get("target_product_handle") || "");
    if (!jobId || !looxRef || !gid) return json({ ok: false, error: "job_id, loox_ref, target_product_gid required" }, { status: 400 });

    await prisma.$executeRawUnsafe(
      `CREATE TABLE IF NOT EXISTS loox_product_mappings (
        id uuid primary key default gen_random_uuid(),
        shop_id text not null,
        loox_ref text not null,
        loox_product_id text,
        loox_handle text,
        target_product_gid text not null,
        target_product_title text,
        target_product_handle text,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        unique(shop_id, loox_ref)
      )`,
    );

    await prisma.$executeRawUnsafe(
      `INSERT INTO loox_product_mappings (id, shop_id, loox_ref, target_product_gid, target_product_title, target_product_handle, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, now(), now())
       ON CONFLICT (shop_id, loox_ref)
       DO UPDATE SET target_product_gid = EXCLUDED.target_product_gid, target_product_title = EXCLUDED.target_product_title, target_product_handle = EXCLUDED.target_product_handle, updated_at = now()`,
      session.shop,
      looxRef,
      gid,
      title,
      handle,
    );

    await runImportDryRun(jobId, session.shop);
    return json({ ok: true, remapped: true });
  }

  if (intent === "commit") {
    const jobId = String(formData.get("job_id") || "");
    if (!jobId) return json({ ok: false, error: "job_id is required" }, { status: 400 });

    const result = await commitImportJob(jobId, session.shop, admin);
    return json({ ok: true, ...result });
  }

  return json({ ok: false, error: "Unknown intent" }, { status: 400 });
};

export default function ImportsPage() {
  const { jobs, selected, rows, unresolved } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const location = useLocation();
  const busy = navigation.state !== "idle";
  const [mapTarget, setMapTarget] = useState<ProductOption | null>(null);

  const stats = (selected?.stats as Record<string, number> | undefined) ?? {};
  const keepEmbeddedParams = (path: string, params?: Record<string, string>) => {
    const current = new URLSearchParams(location.search);
    Object.entries(params || {}).forEach(([k, v]) => {
      current.set(k, v);
    });
    const q = current.toString();
    return q ? `${path}?${q}` : path;
  };


  return (
    <Page>
      <TitleBar title="Review Imports" />
      <BlockStack gap="400">
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">Upload CSV + dry run</Text>
            <Form method="post" encType="multipart/form-data">
              <input type="hidden" name="intent" value="upload_and_dry_run" />
              <BlockStack gap="300">
                <input type="file" name="csv_file" accept=".csv,text/csv" required />
                <InlineStack gap="300" wrap>
                  {MAPPABLE_FIELDS.map((field) => (
                    <label key={field} style={{ minWidth: 220, flex: 1 }}>
                      <Text as="span" variant="bodySm">Column header for {field}</Text>
                      <input
                        name={`map_${field}`}
                        defaultValue={(selected?.column_mapping as Record<string, string> | undefined)?.[field] || ""}
                        placeholder={field}
                        style={{ width: "100%", padding: 8, marginTop: 6 }}
                      />
                    </label>
                  ))}
                </InlineStack>
                <label style={{ maxWidth: 260 }}>
                  <Text as="span" variant="bodySm">Default import status</Text>
                  <select name="default_import_status" defaultValue={(selected?.default_import_status as string | undefined) || "draft"} style={{ width: "100%", padding: 8, marginTop: 6 }}>
                    <option value="draft">draft</option>
                    <option value="published">published</option>
                  </select>
                </label>
                <InlineStack align="end">
                  <Button submit variant="primary" loading={busy}>Run dry run</Button>
                </InlineStack>
              </BlockStack>
            </Form>
          </BlockStack>
        </Card>

        <Card>
          <BlockStack gap="200">
            <Text as="h2" variant="headingMd">Import history</Text>
            {jobs.length === 0 ? (
              <Text as="p" variant="bodyMd">No import jobs yet.</Text>
            ) : (
              jobs.map((job) => (
                <InlineStack key={job.id} align="space-between">
                  <Text as="span" variant="bodyMd">
                    {job.file_name} · {job.status} · {new Date(job.created_at).toLocaleString()}
                  </Text>
                  <Link to={keepEmbeddedParams("/app/imports", { jobId: job.id })}>Open</Link>
                </InlineStack>
              ))
            )}
          </BlockStack>
        </Card>

        {selected && (
          <>
            {unresolved?.length ? (
              <Card>
                <BlockStack gap="200">
                  <Text as="h2" variant="headingMd">Resolve unmapped Loox products</Text>
                  <Text as="p" variant="bodySm" tone="subdued">Map unresolved references to a Shopify product, then dry run recalculates.</Text>
                  <Form method="post">
                    <input type="hidden" name="intent" value="save_mapping" />
                    <input type="hidden" name="job_id" value={selected.id} />
                    <label>
                      <Text as="span" variant="bodySm">Loox unresolved reference</Text>
                      <select name="loox_ref" style={{ width: "100%", padding: 8, marginTop: 6 }}>
                        {unresolved.map((u: any) => <option key={`${u.row_number}-${u.loox_ref}`} value={u.loox_ref}>{u.loox_ref} (row {u.row_number})</option>)}
                      </select>
                    </label>
                    <input type="hidden" name="target_product_gid" value={mapTarget?.gid || ""} />
                    <input type="hidden" name="target_product_title" value={mapTarget?.title || ""} />
                    <input type="hidden" name="target_product_handle" value={mapTarget?.handle || ""} />
                    <ProductSearchPicker label="Map to Shopify product" value={mapTarget} onChange={setMapTarget} />
                    <InlineStack align="end"><Button submit variant="primary" loading={busy}>Save mapping + revalidate</Button></InlineStack>
                  </Form>
                </BlockStack>
              </Card>
            ) : null}
            <Card>
              <BlockStack gap="200">
                <Text as="h2" variant="headingMd">Dry run summary</Text>
                <Text as="p" variant="bodyMd">Total: {stats.total_rows ?? 0}</Text>
                <Text as="p" variant="bodyMd">Valid: {stats.valid_rows ?? 0}</Text>
                <Text as="p" variant="bodyMd">Invalid: {stats.invalid_rows ?? 0}</Text>
                <Text as="p" variant="bodyMd">Duplicate in file: {stats.duplicate_in_file ?? 0}</Text>
                <Text as="p" variant="bodyMd">Duplicate existing: {stats.duplicate_existing ?? 0}</Text>
                <Form method="post">
                  <input type="hidden" name="intent" value="commit" />
                  <input type="hidden" name="job_id" value={selected.id} />
                  <Button submit variant="primary" loading={busy} disabled={selected.status === "committed"}>
                    Commit valid rows
                  </Button>
                </Form>
              </BlockStack>
            </Card>

            <Card>
              <BlockStack gap="200">
                <Text as="h2" variant="headingMd">Row diagnostics (first 50)</Text>
                {rows.map((row) => (
                  <div key={row.id} style={{ borderTop: "1px solid #ddd", paddingTop: 8 }}>
                    <Text as="p" variant="bodySm">
                      Row {row.row_number} · dedupe={row.dedupe_decision} · commit={row.commit_decision}
                    </Text>
                    <Text as="p" variant="bodySm">errors: {JSON.stringify(row.validation_errors)}</Text>
                  </div>
                ))}
              </BlockStack>
            </Card>
          </>
        )}
      </BlockStack>
    </Page>
  );
}
