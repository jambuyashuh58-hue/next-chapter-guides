import { createClient } from "npm:@supabase/supabase-js@2";
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const H = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type, x-dash-key", "Access-Control-Allow-Methods": "GET, OPTIONS", "content-type": "application/json", "cache-control": "no-store" };
const eq = (a: string, b: string) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };
const IST = 330 * 60000;
const day = (t: string) => new Date(new Date(t).getTime() + IST).toISOString().slice(0, 10);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: H });
  const key = Deno.env.get("NC_DASH_KEY");
  if (!key) return new Response(JSON.stringify({ error: "not_configured" }), { status: 500, headers: H });
  if (!eq(req.headers.get("x-dash-key") || "", key)) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: H });

  const days = Math.max(0, Math.min(365, Number(new URL(req.url).searchParams.get("days") ?? 30)));
  const since = days ? new Date(Date.now() - days * 86400000).toISOString() : "1970-01-01T00:00:00Z";
  const rows: any[] = [];
  for (let from = 0; from < 60000; from += 1000) {
    const { data, error } = await sb.from("nc_events").select("*").gte("ts", since).order("ts", { ascending: true }).range(from, from + 999);
    if (error) return new Response(JSON.stringify({ error: "db" }), { status: 500, headers: H });
    rows.push(...data);
    if (data.length < 1000) break;
  }

  // per-visitor state
  type V = { src: string; post: string | null; blog: boolean; store: boolean; read50: boolean; read90: boolean; cta: boolean; guide: boolean; buy: boolean; q: Record<string, boolean>; country: string | null; device: string | null; first: string };
  const vis = new Map<string, V>();
  const get = (r: any): V => {
    let v = vis.get(r.cid);
    if (!v) { v = { src: r.ft_source || r.source || "direct", post: r.ft_post || null, blog: false, store: false, read50: false, read90: false, cta: false, guide: false, buy: false, q: {}, country: r.country, device: r.device, first: r.ts }; vis.set(r.cid, v); }
    return v;
  };
  const art = new Map<string, any>(); const A = (s: string) => { let a = art.get(s); if (!a) { a = { slug: s, views: 0, vis: new Set(), read50: new Set(), read90: new Set(), cta: new Set(), clicks: 0, ctaBy: {} as Record<string, number>, buyVis: new Set(), orders: 0, revenue: 0 }; art.set(s, a); } return a; };
  const prod = new Map<string, any>(); const P = (s: string) => { let p = prod.get(s); if (!p) { p = { product: s, views: new Set(), buys: new Set(), buyClicks: 0, orders: 0, revenue: 0 }; prod.set(s, p); } return p; };
  const daily = new Map<string, any>(); const D = (t: string) => { const k = day(t); let d = daily.get(k); if (!d) { d = { day: k, pageviews: 0, vis: new Set(), cta: 0, buy: 0, orders: 0, revenue: 0 }; daily.set(k, d); } return d; };
  const srcRev = new Map<string, { orders: number; revenue: number }>();
  const ctaTotals: Record<string, number> = {};
  const waitlist: Record<string, number> = {};
  let orders = 0, revenue = 0, free = 0, refunds = 0, refundValue = 0, unattributed = 0, lastEvent: string | null = null, lastPurchase: string | null = null;
  const currency = rows.find((r) => r.currency)?.currency || "USD";

  for (const r of rows) {
    lastEvent = r.ts;
    const d = D(r.ts);
    if (r.event === "purchase" || r.event === "free_claim" || r.event === "refund") {
      const src = r.ft_source || "unknown";
      if (r.event === "purchase") {
        orders++; revenue += Number(r.value || 0); lastPurchase = r.ts; d.orders++; d.revenue += Number(r.value || 0);
        const s = srcRev.get(src) || { orders: 0, revenue: 0 }; s.orders++; s.revenue += Number(r.value || 0); srcRev.set(src, s);
        if (!r.cid) unattributed++;
        if (r.product) { const p = P(r.product); p.orders++; p.revenue += Number(r.value || 0); }
        if (r.ft_post) { const a = A(r.ft_post); a.orders++; a.revenue += Number(r.value || 0); }
      } else if (r.event === "free_claim") free++;
      else { refunds++; refundValue += Number(r.value || 0); }
      continue;
    }
    if (!r.cid) continue;
    const v = get(r);
    d.vis.add(r.cid);
    if (r.event === "pageview") {
      d.pageviews++;
      if (r.host === "blog") { v.blog = true; if (r.post_slug) { const a = A(r.post_slug); a.views++; a.vis.add(r.cid); } }
      if (r.host === "store") { v.store = true; if (/^\/quiz\/?$/.test(r.path || "")) v.q.page = true; }
    } else if (["quiz_start", "quiz_complete", "lead", "calculator_view", "calculator_download", "options_view", "waitlist"].includes(r.event)) {
      v.q[r.event] = true;
      if (r.event === "waitlist") { const w = r.product || "waitlist"; waitlist[w] = (waitlist[w] || 0) + 1; }
    } else if (r.event === "scroll_50") { v.read50 = true; if (r.post_slug) A(r.post_slug).read50.add(r.cid); }
    else if (r.event === "scroll_90") { v.read90 = true; if (r.post_slug) A(r.post_slug).read90.add(r.cid); }
    else if (r.event === "cta_click") {
      v.cta = true; d.cta++;
      const c = r.cta || "inline"; ctaTotals[c] = (ctaTotals[c] || 0) + 1;
      if (r.post_slug) { const a = A(r.post_slug); a.cta.add(r.cid); a.clicks++; a.ctaBy[c] = (a.ctaBy[c] || 0) + 1; }
    } else if (r.event === "guide_view") { v.guide = true; if (r.product) P(r.product).views.add(r.cid); }
    else if (r.event === "buy_click") {
      v.buy = true; d.buy++;
      if (r.product) { const p = P(r.product); p.buys.add(r.cid); p.buyClicks++; }
      if (v.post) A(v.post).buyVis.add(r.cid);
    }
  }

  const V = [...vis.values()];
  const n = (f: (v: V) => boolean) => V.filter(f).length;
  const funnel = {
    blog: [
      { k: "Visited the blog", n: n((v) => v.blog) },
      { k: "Read half an article", n: n((v) => v.blog && v.read50) },
      { k: "Read to the end", n: n((v) => v.blog && v.read90) },
      { k: "Clicked a link to the store", n: n((v) => v.blog && v.cta) },
      { k: "Arrived at the store", n: n((v) => v.blog && v.cta && v.store) },
    ],
    store: [
      { k: "Visited the store", n: n((v) => v.store) },
      { k: "Opened a guide page", n: n((v) => v.store && v.guide) },
      { k: "Clicked Buy", n: n((v) => v.store && v.buy) },
      { k: "Purchased", n: orders },
    ],
  };
  // The quiz funnel: each step counts visitors who did that step. A step counts a visitor even if an earlier step was missed (for example, an ad blocker).
  const q = (k: string) => n((v) => !!v.q[k]);
  const quizFunnel = [
    { k: "Opened the quiz page", n: Math.max(q("page"), q("quiz_start")) },
    { k: "Started the quiz", n: q("quiz_start") },
    { k: "Finished the quiz", n: q("quiz_complete") },
    { k: "Left their email", n: q("lead") },
    { k: "Opened the calculator page", n: q("calculator_view") },
    { k: "Downloaded the calculator", n: q("calculator_download") },
    { k: "Saw the three options", n: q("options_view") },
    { k: "Clicked the guide or joined a waitlist", n: n((v) => !!(v.q.options_view && (v.q.waitlist || v.buy || v.guide))) },
  ];
  const quizSources = new Map<string, any>();
  for (const v of V) {
    if (!(v.q.page || v.q.quiz_start)) continue;
    const s = quizSources.get(v.src) || { source: v.src, opened: 0, started: 0, finished: 0, leads: 0, calculator: 0 };
    s.opened++; if (v.q.quiz_start) s.started++; if (v.q.quiz_complete) s.finished++; if (v.q.lead) s.leads++; if (v.q.calculator_view) s.calculator++;
    quizSources.set(v.src, s);
  }
  // Email list and queue (private tables, read with the service key).
  const mail: any = { leads: 0, unsubscribed: 0, byStep: {} as Record<string, Record<string, number>>, waiting: 0 };
  {
    const { count: lc } = await sb.from("nc_leads").select("id", { count: "exact", head: true }).eq("quiz", "hate-my-job");
    const { count: uc } = await sb.from("nc_leads").select("id", { count: "exact", head: true }).eq("quiz", "hate-my-job").not("unsubscribed_at", "is", null);
    mail.leads = lc || 0; mail.unsubscribed = uc || 0;
    const { data: qs } = await sb.from("nc_mail_queue").select("step,status").limit(20000);
    for (const r of qs || []) { const m = (mail.byStep[r.step] ||= {}); m[r.status] = (m[r.status] || 0) + 1; }
    const { count: wc } = await sb.from("nc_mail_queue").select("id", { count: "exact", head: true }).eq("status", "pending").lte("send_at", new Date().toISOString());
    mail.waiting = wc || 0;
  }
  const sources = new Map<string, any>();
  for (const v of V) {
    const s = sources.get(v.src) || { source: v.src, visitors: 0, read: 0, toStore: 0, buyers: 0 };
    s.visitors++; if (v.read50) s.read++; if (v.cta || v.store) s.toStore++; if (v.buy) s.buyers++;
    sources.set(v.src, s);
  }
  for (const [k, r] of srcRev) { const s = sources.get(k) || { source: k, visitors: 0, read: 0, toStore: 0, buyers: 0 }; s.orders = r.orders; s.revenue = r.revenue; sources.set(k, s); }
  const countBy = (f: (v: V) => string | null) => { const m: Record<string, number> = {}; for (const v of V) { const k = f(v) || "unknown"; m[k] = (m[k] || 0) + 1; } return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ k, n })); };
  const articles = [...art.values()].map((a) => ({ slug: a.slug, views: a.views, visitors: a.vis.size, read50: a.read50.size, read90: a.read90.size, ctaVisitors: a.cta.size, clicks: a.clicks, ctaBy: a.ctaBy, buyVisitors: a.buyVis.size, orders: a.orders, revenue: a.revenue })).sort((x, y) => y.visitors - x.visitors);
  const products = [...prod.values()].map((p) => ({ product: p.product, views: p.views.size, buyers: p.buys.size, buyClicks: p.buyClicks, orders: p.orders, revenue: p.revenue })).sort((x, y) => y.views - x.views);

  const recent = rows.slice(-120).reverse().map((r) => ({ ts: r.ts, event: r.event, host: r.host, path: r.path, post: r.post_slug, source: r.ft_source || r.source, cta: r.cta, product: r.product, value: r.value, country: r.country, device: r.device, who: r.cid ? r.cid.slice(-5) : "—" }));

  return new Response(JSON.stringify({
    generated: new Date().toISOString(), days, currency, events: rows.length, visitors: V.length, lastEvent, lastPurchase,
    totals: { visitors: V.length, orders, revenue, free, refunds, refundValue, unattributed, buyers: n((v) => v.buy), ctaClicks: Object.values(ctaTotals).reduce((a, b) => a + b, 0) },
    funnel, quizFunnel, quizSources: [...quizSources.values()].sort((a, b) => b.opened - a.opened), mail, waitlist, sources: [...sources.values()].sort((a, b) => b.visitors - a.visitors), ctaTotals, articles, products,
    daily: [...daily.values()].sort((a, b) => a.day.localeCompare(b.day)).map((d) => ({ day: d.day, pageviews: d.pageviews, visitors: d.vis.size, cta: d.cta, buy: d.buy, orders: d.orders, revenue: d.revenue })),
    countries: countBy((v) => v.country).slice(0, 12), devices: countBy((v) => v.device), recent,
  }), { headers: H });
});
