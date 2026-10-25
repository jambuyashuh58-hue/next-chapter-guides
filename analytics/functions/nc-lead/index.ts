import { createClient } from "npm:@supabase/supabase-js@2";
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const H = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const J = { ...H, "content-type": "application/json" };
const BOT = /bot|crawl|spider|slurp|headless|lighthouse|curl|wget|python|node-fetch|go-http/i;
const LISTS = new Set(["hate-my-job", "waitlist-bundle", "waitlist-consulting"]);
const CAUSES = new Set(["A", "B", "C", "D", "L"]);
const s = (v: unknown, n = 120) => (typeof v === "string" && v ? v.slice(0, n) : null);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: H });
  if (req.method !== "POST") return new Response("ok", { headers: H });
  if (BOT.test(req.headers.get("user-agent") || "")) return new Response(JSON.stringify({ ok: true }), { headers: J });
  let b: any;
  try { const t = await req.text(); if (t.length > 2000) throw 0; b = JSON.parse(t); } catch { return new Response("bad request", { status: 400, headers: H }); }
  const email = typeof b?.email === "string" ? b.email.trim().toLowerCase() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 120) return new Response(JSON.stringify({ ok: false, error: "email" }), { status: 400, headers: J });
  const sc: Record<string, number> = {};
  for (const k of ["A", "B", "C", "D"]) { const n = Number(b?.scores?.[k]); sc[k] = Number.isInteger(n) && n >= 0 && n <= 5 ? n : 0; }
  const row = {
    email, quiz: LISTS.has(b?.quiz) ? b.quiz : "hate-my-job",
    main_cause: CAUSES.has(b?.main) ? b.main : null,
    second_cause: CAUSES.has(b?.second) ? b.second : null,
    scores: b?.scores ? sc : null, consent_tips: b?.tips === true,
    cid: s(b?.cid, 64), source: s(b?.source, 60), country: s(req.headers.get("cf-ipcountry"), 2),
  };
  const { error } = await sb.from("nc_leads").upsert(row, { onConflict: "email,quiz" });
  if (error) return new Response(JSON.stringify({ ok: false }), { status: 500, headers: J });
  return new Response(JSON.stringify({ ok: true }), { headers: J });
});
