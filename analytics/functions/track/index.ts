import { createClient } from "npm:@supabase/supabase-js@2";
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const H = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const J = { ...H, "content-type": "application/json" };
const OK = new Set(["pageview", "scroll_50", "scroll_90", "cta_click", "guide_view", "buy_click"]);
const HOSTS = new Set(["blog", "store"]);
const BOT = /bot|crawl|spider|slurp|headless|preview|lighthouse|facebookexternalhit|monitor|curl|wget|python|node-fetch|go-http/i;
const s = (v: unknown, n = 120) => (typeof v === "string" && v ? v.slice(0, n) : null);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: H });
  if (req.method !== "POST") return new Response("ok", { headers: H });
  const ua = req.headers.get("user-agent") || "";
  if (BOT.test(ua)) return new Response(JSON.stringify({ ok: true, skipped: "bot" }), { headers: J });
  let body: any;
  try { body = JSON.parse(await req.text()); } catch { return new Response("bad request", { status: 400, headers: H }); }
  const list = Array.isArray(body?.events) ? body.events.slice(0, 10) : [];
  const country = s(req.headers.get("cf-ipcountry"), 2);
  const device = /mobile|android|iphone|ipad/i.test(ua) ? "mobile" : "desktop";
  const rows = list
    .filter((e: any) => e && OK.has(e.event) && typeof e.cid === "string" && e.cid.length >= 8)
    .map((e: any) => ({
      event: e.event, cid: s(e.cid, 64), sid: s(e.sid, 64),
      host: HOSTS.has(e.host) ? e.host : null,
      path: s(e.path, 200), post_slug: s(e.post_slug), source: s(e.source, 60), medium: s(e.medium, 60),
      campaign: s(e.campaign, 80), referrer_host: s(e.referrer_host, 100),
      ft_source: s(e.ft_source, 60), ft_post: s(e.ft_post),
      product: s(e.product, 60), cta: s(e.cta, 60), target: s(e.target, 200),
      value: typeof e.value === "number" && isFinite(e.value) ? e.value : null,
      currency: s(e.currency, 3), country, device,
    }));
  if (rows.length) {
    const { error } = await sb.from("nc_events").insert(rows);
    if (error) return new Response(JSON.stringify({ ok: false }), { status: 500, headers: J });
  }
  return new Response(JSON.stringify({ ok: true, n: rows.length }), { headers: J });
});
