// Members-only guide content. Checks the caller's Supabase session and membership before returning anything.
const G = require("./_guides.js");
const SUPA = "https://ctezcrglzcjxdkagnoyy.supabase.co";
const KEY = "sb_publishable_WM7az_Nye-qOMmgWDOJRVg_vITL_Zse";
module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "private, no-store");
  const slug = String((req.query && req.query.s) || "");
  const auth = req.headers.authorization || "";
  if (!/^Bearer\s+\S+/.test(auth)) return res.status(401).json({ error: "login" });
  if (!Object.prototype.hasOwnProperty.call(G.html, slug)) return res.status(404).json({ error: "none" });
  try {
    const r = await fetch(SUPA + "/rest/v1/rpc/is_member", { method: "POST", headers: { apikey: KEY, Authorization: auth, "content-type": "application/json" }, body: "{}" });
    const ok = r.ok && (await r.json()) === true;
    if (!ok) return res.status(403).json({ error: "members only" });
  } catch (e) { return res.status(502).json({ error: "check failed" }); }
  return res.status(200).json({ slug, title: G.meta[slug].title, fields: G.meta[slug].fields, sheets: G.meta[slug].sheets, html: G.html[slug] });
};
