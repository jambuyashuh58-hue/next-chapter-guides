import { createClient } from "npm:@supabase/supabase-js@2";
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const H = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "content-type": "application/json" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// One-click unsubscribe. Accepts POST only (mail apps send POST; the /unsubscribe page sends POST too), so link scanners that only GET cannot unsubscribe anyone.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: H });
  if (req.method !== "POST") return new Response(JSON.stringify({ ok: false }), { status: 405, headers: H });
  const t = new URL(req.url).searchParams.get("t") || "";
  if (!UUID.test(t)) return new Response(JSON.stringify({ ok: false }), { status: 400, headers: H });
  const { data, error } = await sb.from("nc_leads").select("id,email").eq("token", t);
  if (error) return new Response(JSON.stringify({ ok: false }), { status: 500, headers: H });
  if (!data?.length) return new Response(JSON.stringify({ ok: true }), { headers: H });
  // Unsubscribe the person from everything: every list on this email address.
  const email = data[0].email;
  const now = new Date().toISOString();
  await sb.from("nc_leads").update({ unsubscribed_at: now }).eq("email", email).is("unsubscribed_at", null);
  await sb.from("nc_mail_queue").update({ status: "skipped", note: "unsubscribed" })
    .in("lead_id", (await sb.from("nc_leads").select("id").eq("email", email)).data?.map((r: any) => r.id) || [])
    .eq("status", "pending");
  return new Response(JSON.stringify({ ok: true }), { headers: H });
});
