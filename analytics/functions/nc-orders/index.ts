import { createClient } from "npm:@supabase/supabase-js@2";
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
async function sign(secret: string, body: string) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(body)));
}
const eq = (a: string, b: string) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("ok");
  const secret = Deno.env.get("NC_LS_SECRET");
  if (!secret) return new Response("not configured", { status: 500 });
  const raw = await req.text();
  const sig = req.headers.get("x-signature") || "";
  if (!eq(sig, await sign(secret, raw))) return new Response("bad signature", { status: 401 });
  let p: any; try { p = JSON.parse(raw); } catch { return new Response("bad json", { status: 400 }); }
  const name = p?.meta?.event_name as string;
  const cd = p?.meta?.custom_data || {};
  const a = p?.data?.attributes || {};
  if (name !== "order_created" && name !== "order_refunded") return new Response("ignored");
  const total = Number(a.total ?? 0) / 100;
  const refunded = name === "order_refunded" || a.status === "refunded";
  const event = refunded ? "refund" : total === 0 ? "free_claim" : "purchase";
  if (name === "order_created" && a.status && a.status !== "paid") return new Response("not paid, ignored");
  const row = {
    event, cid: typeof cd.nc_cid === "string" ? cd.nc_cid.slice(0, 64) : null, host: "server",
    ft_source: typeof cd.nc_src === "string" ? cd.nc_src.slice(0, 60) : null,
    ft_post: typeof cd.nc_post === "string" ? cd.nc_post.slice(0, 120) : null,
    product: (typeof cd.nc_product === "string" && cd.nc_product) ? cd.nc_product.slice(0, 60) : String(a.first_order_item?.product_name || "").slice(0, 60) || null,
    value: refunded ? Number(a.refunded_amount ?? a.total ?? 0) / 100 : total,
    currency: String(a.currency || "").slice(0, 3) || null,
    country: String(a.user_country || "").slice(0, 2) || null,
    order_id: String(p?.data?.id || ""),
  };
  const { error } = await sb.from("nc_events").upsert(row, { onConflict: "order_id,event", ignoreDuplicates: true });
  if (error) return new Response("db error", { status: 500 });
  return new Response("ok");
});
