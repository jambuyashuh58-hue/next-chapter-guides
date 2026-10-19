// Builds the /blog section at deploy time from the published posts on the
// WordPress site, so WordPress stays the editor and Vercel serves the pages
// Google indexes. Run by Vercel as the build command (see vercel.json).
// No dependencies: Node 18+ (fetch, fs/promises).

import { mkdir, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const WP = "https://nextchapterguides.wpcomstaging.com";
const SITE = "https://next-chapter-guides.vercel.app";
const ROOT = process.cwd();
const OUT = path.join(ROOT, "blog");
const IMG_DIR = path.join(OUT, "img");
const AUTHOR = "Yashu Jambu";

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
.logo{display:flex;align-items:center;gap:10px;color:var(--ink);text-decoration:none;font-weight:800;font-size:1.15rem;letter-spacing:-.01em}
.logo img{width:30px;height:30px}.logo b{color:var(--cta)}
.links{display:flex;align-items:center;gap:20px;flex-wrap:wrap}
.links a{color:var(--ink);text-decoration:none;font-weight:500;font-size:.95rem}
.links a.on{color:var(--cta)}
.btn{display:inline-block;background:var(--cta);color:#fff!important;padding:10px 18px;border-radius:10px;font-weight:600;text-decoration:none;font-family:var(--ui)}
.btn:hover{background:var(--cta-h)}.btn.ghost{background:#fff;color:var(--ink)!important;border:1px solid var(--line)}
@media(max-width:760px){.links a:not(.btn){display:none}}
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
footer{background:var(--soft);padding-block:40px;font-size:.92rem;color:var(--muted)}
footer .wrap{display:flex;justify-content:space-between;gap:24px;flex-wrap:wrap}
footer a{color:var(--ink);margin-right:16px}
@media(max-width:1040px){.layout{grid-template-columns:minmax(0,1fr);gap:20px;padding-block:28px 48px}
.side{position:static;max-height:none;background:var(--soft);border-radius:12px;padding:14px 16px}
.topics,.topics-h,.side .btn{display:none}.toc{border-left:0;margin:0}.toc a{border-left:0;padding-left:0;margin-left:0}}
.list{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:28px}
.card{display:flex;flex-direction:column;background:#fff;border:1px solid var(--line);border-radius:14px;overflow:hidden;text-decoration:none;color:inherit}
.card img{aspect-ratio:16/9;object-fit:cover;width:100%;display:block}
.card .b{padding:18px 20px 22px;display:flex;flex-direction:column;gap:8px}
.card h3{font-family:var(--serif);color:var(--head);font-size:1.25rem;line-height:1.3;margin:0}
.card p{margin:0;color:var(--muted);font-size:.95rem}
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
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
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

const topbar = (on) => `<header class="top"><div class="wrap">
<a class="logo" href="/"><img src="/assets/logo.svg" alt=""><span>Next<b>Chapter.</b></span></a>
<nav class="links" aria-label="Main">
<a href="/">Home</a><a href="/#guides">Guides</a><a href="/blog"${on ? ' class="on"' : ""}>Blog</a>
<a class="btn" href="/#guide-age-calculator">Free calculator</a>
</nav></div></header>`;

const footer = () => `<footer><div class="wrap">
<div><a class="logo" href="/"><img src="/assets/logo.svg" alt=""><span>Next<b>Chapter.</b></span></a>
<p>Honest, practical help for changing careers at any age.</p></div>
<div><a href="/blog">Blog</a><a href="/#guides">Guides</a><a href="/#guide-age-calculator">Free calculator</a></div>
<p style="flex-basis:100%;margin:0">General information only, not legal, financial or career advice. © ${new Date().getUTCFullYear()} Next Chapter Guides.</p>
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
        publisher: { "@type": "Organization", name: "Next Chapter Guides", logo: { "@type": "ImageObject", url: `${SITE}/assets/logo.svg` } },
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
${topbar(true)}
<main class="wrap layout">
<aside class="side">
${toc.length ? `<h4>On this page</h4><ol class="toc">${toc.map((t) => `<li><a href="#${t.id}">${esc(t.text)}</a></li>`).join("")}</ol>` : ""}
<div class="topics-wrap"><h4 class="topics-h">Browse topics</h4><div class="topics">__TOPICS__</div></div>
<a class="btn" href="/#guide-age-calculator">Free: am I too old? →</a>
</aside>
<article>
<a class="cat" href="/blog#${cat.slug}">${esc(cat.name)}</a>
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

    built.push({ slug: p.slug, title, desc, hero, heroAlt, cat, date: p.date_gmt, modified: p.modified_gmt, page });
    if (!cats.has(cat.slug)) cats.set(cat.slug, { name: cat.name, posts: [] });
    cats.get(cat.slug).posts.push(built[built.length - 1]);
  }

  const topicsHTML = [...cats.entries()].map(([s, c]) => `<a href="/blog#${s}">${esc(c.name)}</a>`).join("");
  for (const b of built) {
    await writeFile(path.join(OUT, `${b.slug}.html`), b.page.replace("__TOPICS__", topicsHTML));
  }

  // blog index
  const card = (b) => `<a class="card" href="/blog/${b.slug}">${b.hero ? `<img src="${b.hero}" alt="${esc(b.heroAlt)}" loading="lazy">` : ""}<div class="b"><span class="cat" style="text-decoration:none">${esc(b.cat.name)}</span><h3>${esc(b.title)}</h3><p>${esc(b.desc)}</p></div></a>`;
  const indexDesc = "Honest, practical articles for changing careers at any age: finding your direction, changing careers by age, money and retraining, CVs and job search.";
  const index = `${head({
    title: "Career Change Blog | Next Chapter Guides",
    desc: indexDesc,
    canonical: `${SITE}/blog`,
    type: "website",
    jsonld: [{ "@context": "https://schema.org", "@type": "Blog", name: "Next Chapter Guides Blog", url: `${SITE}/blog`,
      blogPost: built.map((b) => ({ "@type": "BlogPosting", headline: b.title, url: `${SITE}/blog/${b.slug}`, datePublished: b.date + "Z" })) }],
  })}
${topbar(true)}
<main class="wrap">
<div class="bloghead"><span class="cat" style="text-decoration:none">The blog</span><h1>Career change, planned like a project</h1><p>${esc(indexDesc)}</p></div>
<h2 style="font-family:var(--serif);color:var(--head);font-size:1.6rem;margin:0 0 18px">Latest articles</h2>
<div class="list">${[...built].sort((a, b) => (a.date < b.date ? 1 : -1)).map(card).join("")}</div>
<div style="height:40px"></div>
${[...cats.entries()].map(([s, c]) => `<section class="group" id="${s}"><h2>${esc(c.name)}</h2><div class="list">${c.posts.map(card).join("")}</div></section>`).join("")}
</main>
${footer()}
</body></html>`;
  await writeFile(path.join(OUT, "index.html"), index);

  // sitemap.xml (home, blog, articles, guide preview pages if any)
  const urls = [
    { loc: `${SITE}/`, lastmod: new Date().toISOString() },
    { loc: `${SITE}/blog`, lastmod: new Date().toISOString() },
    ...built.map((b) => ({ loc: `${SITE}/blog/${b.slug}`, lastmod: b.modified + "Z", img: b.hero ? `${SITE}${b.hero}` : null })),
  ];
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${urls.map((u) => `  <url><loc>${u.loc}</loc><lastmod>${u.lastmod}</lastmod>${u.img ? `<image:image><image:loc>${u.img}</image:loc></image:image>` : ""}</url>`).join("\n")}
</urlset>
`;
  await writeFile(path.join(ROOT, "sitemap.xml"), sitemap);

  console.log(`Blog built: ${built.length} articles, ${downloaded.size} images, sitemap with ${urls.length} URLs.`);
}

main().catch((e) => {
  console.error("Blog build failed:", e.message);
  process.exit(1);
});
