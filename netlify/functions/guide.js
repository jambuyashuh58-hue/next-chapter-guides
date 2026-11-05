// Netlify version of api/guide.js: members-only guide content. Checks the caller's Supabase session and membership first.
const G = require("../../api/_guides.js");
const SUPA = "https://ctezcrglzcjxdkagnoyy.supabase.co";
const KEY = "sb_publishable_WM7az_Nye-qOMmgWDOJRVg_vITL_Zse";
const H = { "content-type": "application/json", "cache-control": "private, no-store" };
const out = (code, obj) => ({ statusCode: code, headers: H, body: JSON.stringify(obj) });
exports.handler = async (event) => {
  const slug = String((event.queryStringParameters && event.queryStringParameters.s) || "");
  const auth = (event.headers && (event.headers.authorization || event.headers.Authorization)) || "";
  if (!/^Bearer\s+\S+/.test(auth)) return out(401, { error: "login" });
  if (!Object.prototype.hasOwnProperty.call(G.html, slug)) return out(404, { error: "none" });
  try {
    const r = await fetch(SUPA + "/rest/v1/rpc/is_member", { method: "POST", headers: { apikey: KEY, Authorization: auth, "content-type": "application/json" }, body: "{}" });
    const ok = r.ok && (await r.json()) === true;
    if (!ok) return out(403, { error: "members only" });
  } catch (e) { return out(502, { error: "check failed" }); }
  return out(200, { slug, title: G.meta[slug].title, fields: G.meta[slug].fields, sheets: G.meta[slug].sheets, html: G.html[slug] });
};
