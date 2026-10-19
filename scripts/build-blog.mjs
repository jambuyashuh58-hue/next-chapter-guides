// Builds the /blog section at deploy time from the published posts on the
// WordPress site, so WordPress stays the editor and Vercel serves the pages
// Google indexes. Run by Vercel as the build command (see vercel.json).
// No dependencies: Node 18+ (fetch, fs/promises).

import { mkdir, writeFile, readFile, readdir, rm, cp } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const WP = "https://nextchapterguides.wpcomstaging.com";
const SITE = "https://next-chapter-guides.vercel.app";
const ROOT = process.cwd();
const OUT = path.join(ROOT, "blog");
const IMG_DIR = path.join(OUT, "img");
const AUTHOR = "Yashu Jambu";
const BRAND = { name: "Next Chapter Guides", logo: "/assets/logo.svg", icon: "/favicon.svg", iconType: "image/svg+xml" };

// ---------- helpers ----------
const esc = (s = "") =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const decode = (s = "") =>
  String(s)
    .replace(/&#8217;|&rsquo;/g, "’").replace(/&#8216;|&lsquo;/g, "‘")
    .replace(/&#8220;|&ldquo;/g, "“").replace(/&#8221;|&rdquo;/g, "”")
    .replace(/&#8211;|&ndash;/g, "–").replace(/&#8212;|&mdash;/g, "—")
    .replace(/&#038;|&amp;/g, "&").replace(/&#8230;|&hellip;/g, "…")
    .replace(/&nbsp;/g, " ").replace(/&#039;|&#39;/g, "'").replace(/&quot;/g, '"');
const strip = (s = "") => decode(String(s).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
const slugify = (s) =>
  strip(s).toLowerCase().replace(/[’'"“”]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70);
const fmtDate = (d) =>
  new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });

async function getJSON(url) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": "next-chapter-guides-build" } });
      if (!r.ok) throw new Error(`${r.status} ${url}`);
      return { data: await r.json(), headers: r.headers };
    } catch (e) {
      if (i === 2) throw e;
      await new Promise((res) => setTimeout(res, 1500));
    }
  }
}

const downloaded = new Map(); // remote url -> local path
async function localImage(src) {
  if (!src) return src;
  let clean = src.replace(/&amp;/g, "&");
  if (clean.startsWith("//")) clean = "https:" + clean;
  // Photon/CDN copies (i0.wp.com/host/path?resize=...) -> original file
  clean = clean.replace(/^https?:\/\/i[0-3]\.wp\.com\//, "https://");
  clean = clean.split("?")[0];
  if (!/^https?:\/\//.test(clean)) return src;
  if (downloaded.has(clean)) return downloaded.get(clean);
  const base = path.basename(new URL(clean).pathname).replace(/[^a-zA-Z0-9._-]/g, "-");
  const local = `/blog/img/${base}`;
  const r = await fetch(clean);
  if (!r.ok) throw new Error(`image ${r.status} ${clean}`);
  await writeFile(path.join(IMG_DIR, base), Buffer.from(await r.arrayBuffer()));
  downloaded.set(clean, local);
  return local;
}

async function rewriteContent(html, postLinks) {
  let out = html;
  // images: download, point locally, drop srcset/sizes
  const imgs = [...out.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
  for (const tag of imgs) {
    const src = (tag.match(/\ssrc="([^"]+)"/) || [])[1];
    const local = await localImage(src);
    let t = tag
      .replace(/\s(srcset|sizes|data-[a-z-]+|title)="[^"]*"/g, "")
      .replace(/\ssrc="[^"]+"/, ` src="${local}"`);
    if (!/\sloading=/.test(t)) t = t.replace(/<img/, '<img loading="lazy" decoding="async"');
    out = out.split(tag).join(t);
  }
  // store links -> same site
  out = out.replace(/https?:\/\/next-chapter-guides\.vercel\.app\/?/g, "/");
  // links to other WordPress posts -> /blog/<slug>
  out = out.replace(/https?:\/\/nextchapterguides\.wpcomstaging\.com\/(?:\d{4}\/\d{2}\/\d{2}\/)?([a-z0-9-]+)\/?(?=["#])/g,
    (m, slug) => (postLinks.has(slug) ? `/blog/${slug}` : m));
  // category, about and home links on the WordPress site -> same pages here
  out = out
    .replace(/https?:\/\/nextchapterguides\.wpcomstaging\.com\/category\/([a-z0-9-]+)\/?(?=["#])/g, "/blog/category/$1")
    .replace(/https?:\/\/nextchapterguides\.wpcomstaging\.com\/about\/?(?=["#])/g, "/blog/about")
    .replace(/https?:\/\/nextchapterguides\.wpcomstaging\.com\/?(?=["#])/g, "/blog")
    .replace(/href="\/category\/([a-z0-9-]+)\/?"/g, 'href="/blog/category/$1"')
    .replace(/href="\/about\/?"/g, 'href="/blog/about"');
  // ids on h2 for the table of contents
  const toc = [];
  const used = new Set();
  out = out.replace(/<h2(\s[^>]*)?>([\s\S]*?)<\/h2>/g, (m, attrs = "", inner) => {
    let id = (attrs.match(/\sid="([^"]+)"/) || [])[1] || slugify(inner) || "section";
    while (used.has(id)) id += "-2";
    used.add(id);
    toc.push({ id, text: strip(inner) });
    const cleanAttrs = attrs.replace(/\sid="[^"]*"/, "");
    return `<h2 id="${id}"${cleanAttrs}>${inner}</h2>`;
  });
  return { html: out, toc };
}

function faqFrom(html) {
  const sec = (html.match(/<section class="schema-section">([\s\S]*?)<\/section>/) || [])[1];
  if (!sec) return [];
  const items = [];
  const re = /<h3[^>]*>([\s\S]*?)<\/h3>\s*<div>([\s\S]*?)<\/div>\s*<\/div>/g;
  let m;
  while ((m = re.exec(sec))) items.push({ q: strip(m[1]), a: strip(m[2]) });
  return items;
}

// ---------- shared layout ----------
const CSS = `
:root{--ink:#0F1E3D;--text:#333333;--head:#2b2b2b;--muted:#5B6478;--line:#D7DEEA;--soft:#EFF5FF;--cta:#2563EB;--cta-h:#1D4ED8;--teal:#0F766E;--mint:#E6F6F3;--bg:#FFFFFF;
--ui:"Inter",ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;--serif:Georgia,"Times New Roman",serif;color-scheme:light}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--text);font-family:var(--ui);line-height:1.6}
a{color:var(--cta)}img{max-width:100%;height:auto}
.wrap{max-width:1200px;margin:0 auto;padding-inline:20px}
.top{border-bottom:1px solid var(--line);background:#fff;position:sticky;top:0;z-index:10}
.top .wrap{display:flex;align-items:center;justify-content:space-between;gap:16px;padding-block:14px}
.logo{display:flex;align-items:center;gap:12px;color:var(--ink);text-decoration:none;font-weight:800;font-size:24px;line-height:1.3;letter-spacing:-.01em}
.logo img{width:40px;height:40px;border-radius:8px}
.links{display:flex;align-items:center;gap:24px;flex-wrap:wrap}
.links a{color:var(--ink);text-decoration:none;font-weight:400;font-size:15px}.links .btn{padding:12px 22px}
.links a.on{color:var(--cta)}
.btn{display:inline-block;background:var(--cta);color:#fff!important;padding:10px 18px;border-radius:10px;font-weight:600;text-decoration:none;font-family:var(--ui)}
.btn:hover{background:var(--cta-h)}.btn.ghost{background:#fff;color:var(--ink)!important;border:1px solid var(--line)}
@media(max-width:900px){.links a:not(.btn){display:none}.logo{font-size:20px}}
.layout{display:grid;grid-template-columns:250px minmax(0,860px);gap:48px;justify-content:center;padding-block:48px 64px}
.side{position:sticky;top:90px;align-self:start;max-height:calc(100vh - 110px);overflow:auto;scrollbar-width:none;font-size:.9rem}
.side h4{font-size:.72rem;letter-spacing:.12em;text-transform:uppercase;color:var(--teal);margin:0 0 10px}
.toc{list-style:none;margin:0 0 28px;padding:0;border-left:2px solid var(--line)}
.toc a{display:block;padding:6px 0 6px 12px;margin-left:-2px;border-left:2px solid transparent;color:var(--muted);text-decoration:none;line-height:1.35}
.toc a.on{color:var(--cta);border-left-color:var(--cta);font-weight:600}
.topics{display:flex;flex-direction:column;gap:6px;margin-bottom:24px}
.topics a{background:var(--soft);color:var(--ink);text-decoration:none;padding:7px 10px;border-radius:8px}
.side .btn{display:block;text-align:center;font-size:.88rem}
.cat{font-size:.78rem;letter-spacing:.12em;text-transform:uppercase;color:var(--teal);font-weight:700;text-decoration:underline}
h1.title{font-family:var(--serif);color:var(--head);font-size:clamp(2.1rem,4.4vw,3rem);line-height:1.15;margin:.35em 0 .4em;font-weight:700;text-wrap:balance}
.by{color:var(--muted);font-size:.92rem;margin-bottom:28px}
.hero{width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:14px;margin-bottom:32px;display:block}
.content{font-family:var(--serif);font-size:18px;line-height:1.75;color:var(--text)}
.content p,.content li,.content td,.content th,.content blockquote{font-family:var(--serif);color:var(--text)}
.content h2,.content h3{font-family:var(--serif);color:var(--head);font-weight:700;line-height:1.25;text-wrap:balance;scroll-margin-top:90px}
.content h2{font-size:1.8rem;margin:2.2em 0 .6em}.content h3{font-size:1.3rem;margin:1.7em 0 .5em}
.content blockquote{margin:1.6em 0;padding:4px 0 4px 22px;border-left:4px solid var(--teal);font-style:italic}
.content table{display:block;overflow-x:auto;max-width:100%}
.content img{border-radius:12px}
.content div[style*="border-left:4px"] a,.content div[style*="border-left:4px"] p{font-family:var(--ui)}
.endcta{background:var(--soft);border-radius:14px;padding:28px;margin-top:40px}
.endcta h2{font-family:var(--serif);color:var(--ink);margin:0 0 8px;font-size:1.5rem}
.endcta p{margin:0 0 18px;color:var(--muted)}.endcta .row{display:flex;gap:10px;flex-wrap:wrap}
footer{background:var(--soft);padding-block:48px;font-size:.95rem;color:var(--ink)}
footer .wrap{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;flex-wrap:wrap}
footer p{margin:6px 0 0}.flogo{font-weight:800;font-size:1.25rem;color:var(--ink);text-decoration:none}
.flinks{display:flex;gap:22px;flex-wrap:wrap}.flinks a{color:var(--ink)}
footer .fine{flex-basis:100%;color:var(--muted);font-size:.85rem;margin-top:12px}
@media(max-width:1040px){.layout{grid-template-columns:minmax(0,1fr);gap:20px;padding-block:28px 48px}
.side{position:static;max-height:none;background:var(--soft);border-radius:12px;padding:14px 16px}
.topics,.topics-h,.side .btn{display:none}.toc{border-left:0;margin:0}.toc a{border-left:0;padding-left:0;margin-left:0}}
.list{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:48px 24px}
@media(max-width:900px){.list{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:600px){.list{grid-template-columns:minmax(0,1fr)}}
.card{display:flex;flex-direction:column;text-decoration:none;color:inherit}
.card img{aspect-ratio:4/3;object-fit:cover;width:100%;display:block}
.card .b{padding-top:20px;display:flex;flex-direction:column;gap:14px}
.card h3{font-family:var(--ui);color:var(--cta);font-size:1.25rem;font-weight:600;line-height:1.3;margin:0}
.card:hover h3{text-decoration:underline}
.card p{margin:0;color:var(--ink);font-size:.95rem;line-height:1.7}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
.pagehead{padding-block:48px 8px}.pagehead h1{font-family:var(--serif);color:var(--head);font-size:clamp(2rem,4vw,2.8rem);margin:.2em 0 .3em}.pagehead p{color:var(--muted);margin:0}
.page{max-width:860px;margin:0 auto;padding-block:40px 64px}
.page .wp-block-group.has-background{padding:44px 36px;border-radius:14px;margin:0 0 32px}
.page .has-theme-2-background-color{background:var(--soft)}.page .has-teal-color{color:var(--teal)}
.page .has-small-font-size{font-size:.85rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase}
.page .has-medium-font-size{font-size:1.15rem}.page h1,.page h2,.page h3{color:var(--ink);line-height:1.2}
.page h1{font-size:clamp(2rem,4vw,2.8rem)}.page p,.page li{font-size:17px;line-height:1.7}
.page .wp-block-buttons{display:flex;gap:12px;flex-wrap:wrap;margin-top:20px}
.page .wp-block-button__link{display:inline-block;background:var(--cta);color:#fff;padding:12px 22px;border-radius:10px;font-weight:600;text-decoration:none}
.page .is-style-outline .wp-block-button__link{background:transparent;color:var(--cta);border:2px solid var(--cta)}
.bloghead{padding-block:56px 32px;max-width:760px}
.bloghead h1{font-family:var(--serif);color:var(--head);font-size:clamp(2.2rem,4.6vw,3.2rem);line-height:1.1;margin:.2em 0 .4em}
.bloghead p{color:var(--muted);font-size:1.1rem;margin:0}
.group{padding-block:12px 40px}.group h2{font-family:var(--serif);color:var(--head);font-size:1.6rem;margin:0 0 18px;scroll-margin-top:90px}
`;

const head = ({ title, desc, canonical, image, type = "article", jsonld = [] }) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${canonical}">
<link rel="icon" href="${BRAND.icon}" type="${BRAND.iconType}">
<link rel="apple-touch-icon" href="${BRAND.icon}">
<meta name="robots" content="index, follow, max-image-preview:large">
<meta property="og:type" content="${type}">
<meta property="og:site_name" content="Next Chapter Guides">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${canonical}">
${image ? `<meta property="og:image" content="${SITE}${image}">` : `<meta property="og:image" content="${SITE}/og-image.jpg">`}
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#2563EB">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap">
<style>${CSS}</style>
${jsonld.map((j) => `<script type="application/ld+json">${JSON.stringify(j).replace(/</g, "\\u003c")}</script>`).join("\n")}
</head>
<body>`;

const NAV = [
  ["Blog", "/blog"],
  ["By age", "/blog/category/changing-careers-by-age"],
  ["Teachers & nurses", "/blog/category/teachers-and-nurses"],
  ["Guides", "/#guides"],
  ["About", "/blog/about"],
];
const topbar = (on = "") => `<header class="top"><div class="wrap">
<a class="logo" href="/blog"><img src="${BRAND.logo}" alt="" width="40" height="40"><span>${BRAND.name}</span></a>
<nav class="links" aria-label="Main">
${NAV.map(([t, h]) => `<a href="${h}"${on === h ? ' class="on"' : ""}>${esc(t)}</a>`).join("")}
<a class="btn" href="/#guide-age-calculator">Free calculator</a>
</nav></div></header>`;

const footer = () => `<footer><div class="wrap">
<div><a class="flogo" href="/blog">${BRAND.name}</a>
<p>Honest, practical help for changing careers at any age.</p></div>
<nav class="flinks"><a href="/blog">Blog</a><a href="/#guides">Guides</a><a href="/#guide-age-calculator">Free calculator</a><a href="https://www.threads.com/@yashujambu" rel="noopener" target="_blank">Threads @yashujambu</a></nav>
<p class="fine">Articles give general information, not financial, legal or medical advice. © ${new Date().getUTCFullYear()} ${BRAND.name}.</p>
</div></footer>`;
const TOC_JS = `<script>(function(){var l=[].slice.call(document.querySelectorAll('.toc a'));if(!l.length)return;
var h=l.map(function(a){return document.getElementById(a.getAttribute('href').slice(1))});
function u(){var y=window.scrollY+120,i=0;h.forEach(function(e,k){if(e&&e.offsetTop<=y)i=k});l.forEach(function(a,k){a.classList.toggle('on',k===i)})}
window.addEventListener('scroll',u,{passive:true});u();})();</script>`;

// ---------- build ----------
async function main() {
  // fetch every published post (paged)
  const posts = [];
  for (let page = 1; page < 20; page++) {
    const { data, headers } = await getJSON(
      `${WP}/wp-json/wp/v2/posts?status=publish&per_page=50&page=${page}&_embed=wp:featuredmedia,wp:term`
    );
    posts.push(...data);
    const total = Number(headers.get("x-wp-totalpages") || 1);
    if (page >= total) break;
  }
  if (!posts.length) throw new Error("No published posts returned from WordPress – keeping the previous deployment.");

  if (existsSync(OUT)) await rm(OUT, { recursive: true, force: true });
  await mkdir(IMG_DIR, { recursive: true });

  // site logo and icon from WordPress (keeps the current look if they fail)
  try {
    const { data: site } = await getJSON(`${WP}/wp-json/?_fields=name,site_logo,site_icon_url`);
    if (site.name) BRAND.name = decode(site.name);
    if (site.site_logo) {
      const { data: m } = await getJSON(`${WP}/wp-json/wp/v2/media/${site.site_logo}?_fields=source_url`);
      if (m.source_url) BRAND.logo = await localImage(m.source_url);
    }
    if (site.site_icon_url) {
      BRAND.icon = await localImage(site.site_icon_url);
      BRAND.iconType = BRAND.icon.endsWith(".png") ? "image/png" : BRAND.icon.endsWith(".svg") ? "image/svg+xml" : "image/jpeg";
    }
  } catch (e) {
    console.warn("Brand assets skipped:", e.message);
  }

  const postLinks = new Set(posts.map((p) => p.slug));
  const cats = new Map(); // slug -> {name, posts:[]}
  const built = [];

  for (const p of posts) {
    const title = decode(p.title.rendered);
    const meta = p.meta || {};
    const seoTitle = decode(meta.jetpack_seo_html_title || title);
    const desc = decode(meta.advanced_seo_description || strip(p.excerpt.rendered)).slice(0, 300);
    const terms = (p._embedded?.["wp:term"] || []).flat().filter((t) => t.taxonomy === "category");
    const cat = terms[0] ? { name: decode(terms[0].name), slug: terms[0].slug } : { name: "Career change", slug: "career-change" };
    const fm = p._embedded?.["wp:featuredmedia"]?.[0];
    const hero = fm?.source_url ? await localImage(fm.source_url) : null;
    const heroAlt = fm?.alt_text || title;
    const { html, toc } = await rewriteContent(p.content.rendered, postLinks);
    const faqs = faqFrom(p.content.rendered);
    const url = `${SITE}/blog/${p.slug}`;

    const jsonld = [
      {
        "@context": "https://schema.org",
        "@type": "Article",
        headline: title,
        description: desc,
        image: hero ? [`${SITE}${hero}`] : undefined,
        datePublished: p.date_gmt + "Z",
        dateModified: p.modified_gmt + "Z",
        author: { "@type": "Person", name: AUTHOR },
        publisher: { "@type": "Organization", name: "Next Chapter Guides", logo: { "@type": "ImageObject", url: `${SITE}${BRAND.logo}` } },
        mainEntityOfPage: url,
      },
      {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: `${SITE}/` },
          { "@type": "ListItem", position: 2, name: "Blog", item: `${SITE}/blog` },
          { "@type": "ListItem", position: 3, name: title, item: url },
        ],
      },
    ];
    if (faqs.length)
      jsonld.push({
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: faqs.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
      });

    const page = `${head({ title: seoTitle, desc, canonical: url, image: hero, jsonld })}
${topbar("/blog")}
<main class="wrap layout">
<aside class="side">
${toc.length ? `<h4>On this page</h4><ol class="toc">${toc.map((t) => `<li><a href="#${t.id}">${esc(t.text)}</a></li>`).join("")}</ol>` : ""}
<div class="topics-wrap"><h4 class="topics-h">Browse topics</h4><div class="topics">__TOPICS__</div></div>
<a class="btn" href="/#guide-age-calculator">Free: am I too old? →</a>
</aside>
<article>
<a class="cat" href="/blog/category/${cat.slug}">${esc(cat.name)}</a>
<h1 class="title">${esc(title)}</h1>
<div class="by">By ${AUTHOR} · <time datetime="${p.date_gmt}Z">${fmtDate(p.date_gmt + "Z")}</time></div>
${hero ? `<img class="hero" src="${hero}" alt="${esc(heroAlt)}" fetchpriority="high">` : ""}
<div class="content">
${html}
</div>
<section class="endcta">
<h2>Planning a career change?</h2>
<p>Start with the free “Is it too late?” calculator, then pick the guide for your next step.</p>
<div class="row"><a class="btn" href="/#guide-age-calculator">Try the free calculator</a><a class="btn ghost" href="/#guides">See all guides</a></div>
</section>
</article>
</main>
${footer()}
${TOC_JS}
</body></html>`;

    const short = (() => { const w = strip(p.excerpt.rendered).split(" "); return w.length > 18 ? w.slice(0, 18).join(" ") + "…" : w.join(" "); })();
    built.push({ slug: p.slug, title, desc, short, hero, heroAlt, cat, date: p.date_gmt, modified: p.modified_gmt, page });
    if (!cats.has(cat.slug)) cats.set(cat.slug, { name: cat.name, posts: [] });
    cats.get(cat.slug).posts.push(built[built.length - 1]);
  }

  // every WordPress category gets a page, even before it has articles
  try {
    const { data: allCats } = await getJSON(`${WP}/wp-json/wp/v2/categories?per_page=100&hide_empty=false&_fields=slug,name`);
    for (const c of allCats) if (c.slug !== "uncategorized" && !cats.has(c.slug)) cats.set(c.slug, { name: decode(c.name), posts: [] });
  } catch (e) {
    console.warn("Category list skipped:", e.message);
  }
  const topicsHTML = [...cats.entries()].map(([s, c]) => `<a href="/blog/category/${s}">${esc(c.name)}</a>`).join("");
  for (const b of built) {
    await writeFile(path.join(OUT, `${b.slug}.html`), b.page.replace("__TOPICS__", topicsHTML));
  }

  // blog index
  const card = (b) => `<a class="card" href="/blog/${b.slug}">${b.hero ? `<img src="${b.hero}" alt="${esc(b.heroAlt)}" loading="lazy">` : ""}<div class="b"><h3>${esc(b.title)}</h3><p>${esc(b.short)}</p></div></a>`;
  const indexDesc = "Honest, practical articles for changing careers at any age: finding your direction, changing careers by age, money and retraining, CVs and job search.";
  const index = `${head({
    title: "Career Change Blog | Next Chapter Guides",
    desc: indexDesc,
    canonical: `${SITE}/blog`,
    type: "website",
    jsonld: [{ "@context": "https://schema.org", "@type": "Blog", name: "Next Chapter Guides Blog", url: `${SITE}/blog`,
      blogPost: built.map((b) => ({ "@type": "BlogPosting", headline: b.title, url: `${SITE}/blog/${b.slug}`, datePublished: b.date + "Z" })) }],
  })}
${topbar("/blog")}
<main class="wrap" style="padding-block:56px 72px">
<h1 class="sr">${BRAND.name} blog</h1>
<div class="list">${[...built].sort((a, b) => (a.date < b.date ? 1 : -1)).map(card).join("")}</div>
</main>
${footer()}
</body></html>`;
  await writeFile(path.join(OUT, "index.html"), index);

  // category pages
  await mkdir(path.join(OUT, "category"), { recursive: true });
  for (const [cs, c] of cats) {
    const cdesc = `Articles about ${c.name.toLowerCase()} from ${BRAND.name}: practical, honest help for changing careers.`;
    const html = `${head({ title: `${c.name} | ${BRAND.name}`, desc: cdesc, canonical: `${SITE}/blog/category/${cs}`, type: "website" })}
${topbar(`/blog/category/${cs}`)}
<main class="wrap" style="padding-bottom:72px">
<div class="pagehead"><span class="cat" style="text-decoration:none">Topic</span><h1>${esc(c.name)}</h1></div>
${c.posts.length ? "" : `<p style="margin-top:24px;color:var(--muted)">New articles on this topic are on the way. Meanwhile, <a href="/blog">see all articles</a> or <a href="/#guides">browse the guides</a>.</p>`}
<div class="list" style="margin-top:32px">${[...c.posts].sort((a, b) => (a.date < b.date ? 1 : -1)).map(card).join("")}</div>
</main>
${footer()}
</body></html>`;
    await writeFile(path.join(OUT, "category", `${cs}.html`), html);
  }

  // About page from WordPress
  let aboutOk = false;
  try {
    const { data } = await getJSON(`${WP}/wp-json/wp/v2/pages?slug=about&_fields=title,content,excerpt,modified_gmt`);
    if (data[0]) {
      const { html } = await rewriteContent(data[0].content.rendered, postLinks);
      const adesc = strip(data[0].excerpt?.rendered || "").slice(0, 160) || `About ${BRAND.name}: who writes it and how the articles are checked.`;
      const page = `${head({ title: `About | ${BRAND.name}`, desc: adesc, canonical: `${SITE}/blog/about`, type: "website" })}
${topbar("/blog/about")}
<main class="wrap"><div class="page">${html}</div></main>
${footer()}
</body></html>`;
      await writeFile(path.join(OUT, "about.html"), page);
      aboutOk = true;
    }
  } catch (e) {
    console.warn("About page skipped:", e.message);
  }

  // sitemap.xml (home, blog, articles, guide preview pages if any)
  const urls = [
    { loc: `${SITE}/`, lastmod: new Date().toISOString() },
    { loc: `${SITE}/blog`, lastmod: new Date().toISOString() },
    ...(aboutOk ? [{ loc: `${SITE}/blog/about`, lastmod: new Date().toISOString() }] : []),
    ...[...cats.keys()].map((cs) => ({ loc: `${SITE}/blog/category/${cs}`, lastmod: new Date().toISOString() })),
    ...built.map((b) => ({ loc: `${SITE}/blog/${b.slug}`, lastmod: b.modified + "Z", img: b.hero ? `${SITE}${b.hero}` : null })),
  ];
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${urls.map((u) => `  <url><loc>${u.loc}</loc><lastmod>${u.lastmod}</lastmod>${u.img ? `<image:image><image:loc>${u.img}</image:loc></image:image>` : ""}</url>`).join("\n")}
</urlset>
`;
  await writeFile(path.join(ROOT, "sitemap.xml"), sitemap);

  // menu/About links use long topic names (e.g. changing-careers-by-age);
  // point them at the real category slugs (e.g. by-age)
  const alias = new Map();
  for (const [cs, c] of cats) alias.set(slugify(c.name), cs);
  const fixLinks = (html) =>
    html.replace(/\/blog\/category\/([a-z0-9-]+)/g, (m, slug) => (cats.has(slug) ? m : alias.has(slug) ? `/blog/category/${alias.get(slug)}` : "/blog"));
  const walk = async (dir) => {
    for (const ent of await readdir(dir, { withFileTypes: true })) {
      const f = path.join(dir, ent.name);
      if (ent.isDirectory()) { if (ent.name !== "img") await walk(f); }
      else if (f.endsWith(".html")) await writeFile(f, fixLinks(await readFile(f, "utf8")));
    }
  };
  await walk(OUT);

  // Vercel serves the "public" folder once a build command is set:
  // copy the whole static site (with the new blog and sitemap) into it.
  const PUB = path.join(ROOT, "public");
  if (existsSync(PUB)) await rm(PUB, { recursive: true, force: true });
  await mkdir(PUB);
  const skip = new Set([".git", ".github", ".gitignore", ".vercel", "public", "scripts", "node_modules", "README.md", "NEWSLETTER-SETUP.md", "vercel.json"]);
  for (const name of await readdir(ROOT)) {
    if (skip.has(name)) continue;
    await cp(path.join(ROOT, name), path.join(PUB, name), { recursive: true });
  }

  console.log(`Blog built: ${built.length} articles, ${downloaded.size} images, sitemap with ${urls.length} URLs.`);
}

main().catch((e) => {
  console.error("Blog build failed:", e.message);
  process.exit(1);
});
