/* Next Chapter first-party funnel tracker.
   One script for both sites: the blog (nextchaptergide.site) and the store (this site).
   Load with:  <script src="https://next-chapter-guides.vercel.app/nc.js" data-site="blog|store" defer></script>
   No cookies, no personal data: a random visitor id, the traffic source, the page and the click. */
(function () {
  try {
    var ENDPOINT = "https://ctezcrglzcjxdkagnoyy.supabase.co/functions/v1/track";
    var STORE_HOST = "next-chapter-guides.vercel.app";
    var BLOG_HOSTS = ["nextchaptergide.site", "www.nextchaptergide.site"];
    var tag = document.currentScript;
    var SITE = (tag && tag.getAttribute("data-site")) || (BLOG_HOSTS.indexOf(location.hostname) > -1 ? "blog" : "store");
    var qs = new URLSearchParams(location.search);

    /* ---- storage (never throws) ---- */
    var mem = {};
    function get(k) { try { return localStorage.getItem(k); } catch (e) { return mem[k] || null; } }
    function set(k, v) { try { localStorage.setItem(k, v); } catch (e) { mem[k] = v; } }
    function del(k) { try { localStorage.removeItem(k); } catch (e) { delete mem[k]; } }

    /* ---- opt-outs: your own visits, Do Not Track, Global Privacy Control, WordPress admins ---- */
    if (qs.get("nc_off") === "1") set("nc_off", "1");
    if (qs.get("nc_off") === "0") del("nc_off");
    if (get("nc_off") === "1") return;
    if (navigator.doNotTrack === "1" || navigator.globalPrivacyControl) return;
    if (SITE === "blog" && /(^|\s)(logged-in|admin-bar)(\s|$)/.test(document.body.className)) return;

    function rid() {
      if (window.crypto && crypto.randomUUID) return crypto.randomUUID().replace(/-/g, "");
      return (Date.now().toString(36) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)).slice(0, 32);
    }
    var okId = function (s) { return typeof s === "string" && /^[a-z0-9]{8,64}$/i.test(s); };

    /* ---- traffic source ---- */
    function classify(host) {
      if (!host) return "";
      host = host.replace(/^www\./, "").toLowerCase();
      var m = [[/(^|\.)threads\.(net|com)$/, "threads"], [/(^|\.)google\./, "google"], [/(^|\.)bing\.com$/, "bing"], [/duckduckgo\.com$/, "duckduckgo"], [/yahoo\./, "yahoo"],
        [/(^|\.)instagram\.com$/, "instagram"], [/(^|\.)(facebook|fb)\.com$|^l\.facebook\.com$/, "facebook"], [/linkedin\.com$|^lnkd\.in$/, "linkedin"],
        [/reddit\.com$/, "reddit"], [/^t\.co$|twitter\.com$|(^|\.)x\.com$/, "x"], [/youtube\.com$|^youtu\.be$/, "youtube"], [/pinterest\./, "pinterest"],
        [/whatsapp\.com$/, "whatsapp"], [/(^|\.)t\.me$|telegram/, "telegram"], [/quora\.com$/, "quora"], [/medium\.com$/, "medium"]];
      for (var i = 0; i < m.length; i++) if (m[i][0].test(host)) return m[i][1];
      return host;
    }
    var refHost = ""; try { refHost = document.referrer ? new URL(document.referrer).hostname : ""; } catch (e) {}
    var internal = refHost === STORE_HOST || BLOG_HOSTS.indexOf(refHost) > -1 || refHost === location.hostname;
    var utm = (qs.get("utm_source") || qs.get("src") || "").toLowerCase().slice(0, 60);
    var medium = (qs.get("utm_medium") || "").toLowerCase().slice(0, 60);
    var campaign = (qs.get("utm_campaign") || "").slice(0, 80);

    /* ---- post slug (blog articles only) ---- */
    var pm = location.pathname.match(/^\/\d{4}\/\d{2}\/\d{2}\/([^/]+)\/?$/);
    var postSlug = SITE === "blog" && pm ? pm[1] : null;

    /* ---- identity: visitor id travels from blog to store in the link ---- */
    var cid = get("nc_cid");
    var urlCid = qs.get("nc_cid");
    var ft = null; try { ft = JSON.parse(get("nc_ft") || "null"); } catch (e) {}
    if (okId(urlCid)) {
      cid = urlCid; set("nc_cid", cid);
      if (qs.get("nc_src")) { ft = { src: qs.get("nc_src").slice(0, 60), post: (qs.get("nc_post") || "").slice(0, 120) || null }; set("nc_ft", JSON.stringify(ft)); }
    }
    if (!okId(cid)) { cid = rid(); set("nc_cid", cid); }
    if (!ft) {
      ft = { src: utm || (internal ? "" : classify(refHost)) || "direct", post: postSlug };
      set("nc_ft", JSON.stringify(ft));
    } else if (!ft.post && postSlug) { ft.post = postSlug; set("nc_ft", JSON.stringify(ft)); }

    /* ---- session (30 minutes of quiet ends it) ---- */
    var now = Date.now(), sess = null; try { sess = JSON.parse(get("nc_sess") || "null"); } catch (e) {}
    if (!sess || now - sess.t > 30 * 60000) {
      sess = { id: rid().slice(0, 16), t: now, src: utm || (internal ? ft.src : classify(refHost)) || ft.src || "direct" };
    }
    sess.t = now; set("nc_sess", JSON.stringify(sess));

    /* ---- sending ---- */
    var queue = [], timer = null;
    function base(ev, extra) {
      var o = { event: ev, cid: cid, sid: sess.id, host: SITE, path: location.pathname, post_slug: postSlug, source: sess.src, medium: medium || null,
        campaign: campaign || null, referrer_host: refHost || null, ft_source: ft.src, ft_post: ft.post || null };
      for (var k in extra) o[k] = extra[k];
      return o;
    }
    function flush() {
      timer = null; if (!queue.length) return;
      var body = JSON.stringify({ events: queue.splice(0, 10) });
      try { if (navigator.sendBeacon && navigator.sendBeacon(ENDPOINT, new Blob([body], { type: "text/plain" }))) return; } catch (e) {}
      try { fetch(ENDPOINT, { method: "POST", body: body, headers: { "content-type": "text/plain" }, keepalive: true, mode: "cors" }); } catch (e) {}
    }
    function track(ev, extra, now_) { queue.push(base(ev, extra || {})); if (now_) flush(); else if (!timer) timer = setTimeout(flush, 800); }
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden") flush(); });
    window.NCTrack = { cid: cid, source: ft.src, track: function (ev, x) { track(ev, x); } };

    function withParams(href, extra) {
      try {
        var u = new URL(href, location.href);
        u.searchParams.set("nc_cid", cid); u.searchParams.set("nc_src", ft.src);
        if (ft.post) u.searchParams.set("nc_post", ft.post);
        for (var k in extra) u.searchParams.set(k, extra[k]);
        return u.toString();
      } catch (e) { return href; }
    }

    /* =============== BLOG =============== */
    if (SITE === "blog") {
      track("pageview");
      if (postSlug) {
        var d50 = false, d90 = false;
        var onScroll = function () {
          var el = document.querySelector(".wp-block-post-content, .entry-content, article") || document.body;
          var r = el.getBoundingClientRect(), total = r.height || 1;
          var seen = (window.innerHeight - r.top) / total;
          if (!d50 && seen >= 0.5) { d50 = true; track("scroll_50"); }
          if (!d90 && seen >= 0.9) { d90 = true; track("scroll_90"); }
          if (d50 && d90) window.removeEventListener("scroll", onScroll);
        };
        window.addEventListener("scroll", onScroll, { passive: true }); setTimeout(onScroll, 1200);
      }
      var isStoreLink = function (a) { try { return new URL(a.href, location.href).hostname === STORE_HOST; } catch (e) { return false; } };
      var decorate = function () { var as = document.querySelectorAll("a[href]"); for (var i = 0; i < as.length; i++) if (isStoreLink(as[i]) && as[i].href.indexOf("nc_cid=") < 0) as[i].href = withParams(as[i].href, {}); };
      var ctaLabel = function (a) {
        if (a.closest("header, .wp-block-template-part nav, .wp-block-navigation")) return "menu";
        if (a.closest("footer")) return "footer";
        var boxes = [].slice.call(document.querySelectorAll('div[style*="border-left:4px solid #2563EB"]'));
        var box = a.closest('div[style*="border-left:4px solid #2563EB"]');
        if (box) return "cta_box_" + (boxes.indexOf(box) + 1);
        if (a.closest(".schema-section")) return "faq";
        var hs = document.querySelectorAll("h2"), last = null;
        for (var i = 0; i < hs.length; i++) if (hs[i].compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING) last = hs[i];
        var t = last ? last.textContent.toLowerCase() : "";
        if (t.indexOf("conclusion") > -1) return "conclusion";
        return "inline";
      };
      document.addEventListener("click", function (e) {
        var a = e.target.closest && e.target.closest("a[href]"); if (!a || !isStoreLink(a)) return;
        var h = ""; try { h = new URL(a.href, location.href).hash; } catch (x) {}
        var m = h.match(/^#guide-([a-z0-9-]+)/);
        var cta = ctaLabel(a);
        a.href = withParams(a.href, { nc_cta: cta });
        track("cta_click", { cta: cta, product: m ? m[1] : null, target: (h || "store").slice(0, 100) }, true);
      }, true);
      if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", decorate); else decorate();
    }

    /* =============== STORE =============== */
    if (SITE === "store") {
      track("pageview");
      try { ["nc_cid", "nc_src", "nc_post", "nc_cta", "nc_off"].forEach(function (k) { qs.delete(k); });
        var clean = location.pathname + (qs.toString() ? "?" + qs.toString() : "") + location.hash; history.replaceState(null, "", clean); } catch (e) {}
      var lastGuide = null;
      var guideView = function () { var m = location.hash.match(/^#guide-([a-z0-9-]+)/); if (m && m[1] !== lastGuide) { lastGuide = m[1]; track("guide_view", { product: m[1] }); } if (!m) lastGuide = null; };
      guideView(); window.addEventListener("hashchange", guideView);
      var productFor = function (href) {
        try {
          var path = new URL(href).pathname, S = (typeof STORE !== "undefined") ? STORE : null; if (!S) return null;
          for (var k in S.products) if (S.products[k].checkout && new URL(S.products[k].checkout).pathname === path) return { slug: k, price: S.products[k].price };
          for (var i = 0; i < (S.bundles || []).length; i++) if (S.bundles[i].checkout && new URL(S.bundles[i].checkout).pathname === path) return { slug: "bundle-" + S.bundles[i].id, price: S.bundles[i].price };
        } catch (e) {}
        return null;
      };
      document.addEventListener("click", function (e) {
        var a = e.target.closest && e.target.closest("a[href*='lemonsqueezy.com'],a[href*='whop.com']"); if (!a) return;
        var p = productFor(a.href) || { slug: "unknown", price: null };
        var x = {}; x["checkout[custom][nc_cid]"] = cid; x["checkout[custom][nc_src]"] = ft.src; if (ft.post) x["checkout[custom][nc_post]"] = ft.post; x["checkout[custom][nc_product]"] = p.slug;
        try { var u = new URL(a.href); for (var k in x) u.searchParams.set(k, x[k]); a.href = u.toString(); } catch (er) {}
        track("buy_click", { product: p.slug, value: typeof p.price === "number" ? p.price : null, currency: "USD", target: "checkout" }, true);
      }, true);
    }
  } catch (err) { /* tracking must never break the page */ }
})();
