import { useEffect, useMemo, useState } from "react";
import { useLocation } from "@remix-run/react";
import { Text } from "@shopify/polaris";

type ProductOption = { gid: string; title: string; handle: string };

export function ProductSearchPicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: ProductOption | null;
  onChange: (p: ProductOption | null) => void;
}) {
  const [q, setQ] = useState(value?.title || "");
  const location = useLocation();
  const [items, setItems] = useState<ProductOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [refreshSeq, setRefreshSeq] = useState(0);

  const selectedLabel = useMemo(() => {
    if (!value) return "";
    return `${value.title}${value.handle ? ` (${value.handle})` : ""}`;
  }, [value]);

  useEffect(() => {
    const term = q.trim();
    let alive = true;
    const t = setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const current = new URLSearchParams(location.search);
        current.set("q", term);
        const res = await fetch(`/app/api/products/search?${current.toString()}`);
        const text = await res.text();
        let data: any = null;
        try {
          data = JSON.parse(text);
        } catch {
          throw new Error("Product search endpoint returned non-JSON response");
        }
        if (!res.ok || !data?.ok) throw new Error(data?.error || `HTTP ${res.status}`);
        if (alive) setItems(data.products || []);
      } catch (e: any) {
        if (alive) {
          setItems([]);
          setError(e?.message || "Product search failed");
        }
      } finally {
        if (alive) setLoading(false);
      }
    }, 250);

    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q, location.search, refreshSeq]);

  return (
    <div style={{ position: "relative", minWidth: 320 }}>
      <Text as="span" variant="bodyMd">{label}</Text>
      <input
        value={q}
        onFocus={() => {
          setOpen(true);
          setRefreshSeq((n) => n + 1);
        }}
        onChange={(e) => {
          setQ(e.currentTarget.value);
          setOpen(true);
        }}
        placeholder="Search Shopify products..."
        style={{ width: "100%", padding: 8, marginTop: 6 }}
      />
      <input type="hidden" value={value?.gid || ""} readOnly />

      {selectedLabel ? <Text as="p" variant="bodySm" tone="subdued">Selected: {selectedLabel}</Text> : null}
      {error ? <Text as="p" variant="bodySm" tone="critical">{error}</Text> : null}

      {open ? (
        <div style={{ position: "absolute", zIndex: 40, background: "#fff", border: "1px solid #ddd", borderRadius: 8, width: "100%", marginTop: 4, maxHeight: 240, overflow: "auto" }}>
          {loading ? <div style={{ padding: 8 }}>Loading…</div> : null}
          {!loading && items.length === 0 ? <div style={{ padding: 8 }}>No Shopify products found</div> : null}
          {!loading && items.map((p) => (
            <button
              type="button"
              key={p.gid}
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(p);
                setQ(p.title);
                setOpen(false);
              }}
              style={{ display: "block", width: "100%", textAlign: "left", padding: 8, border: 0, background: "#fff", cursor: "pointer" }}
            >
              <div style={{ fontWeight: 600 }}>{p.title}</div>
              <div style={{ color: "#6b7280", fontSize: 12 }}>{p.handle}</div>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export type { ProductOption };
