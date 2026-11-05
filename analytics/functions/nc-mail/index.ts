import { createClient } from "npm:@supabase/supabase-js@2";
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const SITE = "https://next-chapter-guides.vercel.app";
const BLOG = "https://nextchaptergide.site";
const FN = (Deno.env.get("SUPABASE_URL") || "") + "/functions/v1";
const J = { "content-type": "application/json" };

const GROUP: Record<string, string> = { A: "the people", B: "the work itself", C: "pay and hours", D: "exhaustion", L: "no single cause" };
const TEXT: Record<string, { meaning: string; first: string }> = {
  A: { meaning: "Your main problem looks like the people around the job, not the work itself. That is good news, because it can often be fixed without changing careers.", first: "Write down three specific moments that bothered you. Then ask: would a move to another team or employer in the same field fix this?" },
  B: { meaning: "Your main problem looks like the work you do every day. A better boss or more pay probably will not fix this, so a change of direction is worth exploring.", first: "Make two lists: the three tasks you enjoy most and the three you dread most. The pattern in those lists is what to look for in a new role, and what to avoid." },
  C: { meaning: "Your main problem looks like pay, hours or travel. These are often fixable without a new career, so check the easy answers before you start over.", first: "Write the pay and hours you would need to stay. Then check whether the same job elsewhere offers them." },
  D: { meaning: "Your main problem looks like tiredness that rest is not fixing. Before you make any big career decision, it is worth looking after this first.", first: "Rest comes first, and big decisions can wait. If this feeling has lasted weeks and is heavy, please talk to a doctor or counsellor. They can help in ways a career plan cannot." },
  L: { meaning: "No single cause stands out in your answers. That can mean your unhappiness is mild, mixed, or coming from somewhere other than the job.", first: "Write down, in one or two sentences, what you were feeling when you decided to take the quiz. Look at what that sentence is really about." },
};
const CARE = "Your exhaustion score was high. Please look after this first. If you have felt this way for several weeks, or it feels heavy, talk to a doctor or counsellor before you make big career decisions. A quiz cannot tell you what is behind it.";

// The four articles sent to each result group. Each is [path, link text, one-line reason].
type Art = [string, string, string];
const A_ = {
  signs: ["/2026/10/21/signs-you-need-a-career-change/", "Signs you need a career change", "It helps you tell a bad stretch from a real sign that it is time to move."] as Art,
  hate: ["/2026/10/21/i-hate-my-job-but-dont-know-what-else-to-do/", "I hate my job but don't know what else to do", "It is for the exact spot you are in: you want out, but you cannot see where to."] as Art,
  try_: ["/2026/10/21/how-to-try-a-new-career-before-quitting/", "How to try a new career before quitting", "It shows small, cheap ways to test a job before you risk anything."] as Art,
  motiv: ["/2026/10/25/how-to-stay-motivated-during-a-career-change/", "How to stay motivated during a career change", "It covers the flat, tired weeks that nobody warns you about."] as Art,
  what: ["/2026/10/19/what-career-should-i-switch-to/", "What career should I switch to?", "It gives you a way to narrow the options without guessing."] as Art,
  skills: ["/2026/10/21/transferable-skills-for-career-change/", "Transferable skills for a career change", "You have more to offer than you think, and this shows how to name it."] as Art,
  noexp: ["/2026/10/19/how-to-change-careers-with-no-experience/", "How to change careers with no experience", "It explains how people get a first chance in a field they have never worked in."] as Art,
  afford: ["/2026/10/19/how-to-afford-a-career-change/", "How to afford a career change", "It looks at money honestly, so fear of it stops running the show."] as Art,
  savings: ["/2026/10/21/how-much-savings-before-a-career-change/", "How much savings you need before a career change", "It helps you work out a safe amount for your own life."] as Art,
  entry: ["/2026/10/21/entry-level-jobs-for-career-changers/", "Entry-level jobs for career changers", "It shows where a first step can start without starting over completely."] as Art,
  plan90: ["/2026/10/22/90-day-career-change-plan/", "A 90-day career change plan", "It turns a big idea into a small plan you can follow week by week."] as Art,
};
const SEQ: Record<string, Art[]> = {
  A: [A_.signs, A_.hate, A_.try_, A_.motiv],
  B: [A_.what, A_.skills, A_.try_, A_.noexp],
  C: [A_.afford, A_.savings, A_.entry, A_.plan90],
  D: [A_.motiv, A_.signs, A_.hate, A_.plan90],
  L: [A_.hate, A_.signs, A_.what, A_.motiv],
};

const STEPS = ["welcome", "calc1", "calc2", "blog1", "blog2", "blog3", "blog4", "offer"];
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

type Lead = { id: number; email: string; main_cause: string | null; second_cause: string | null; cid: string | null; token: string; ts: string };
function link(base: string, path: string, lead: Lead, src: string) {
  const u = new URL(path, base);
  u.searchParams.set("src", src);
  if (lead.cid) u.searchParams.set("nc_cid", lead.cid);
  return u.toString();
}

function build(step: string, lead: Lead): { subject: string; paras: string[]; button?: [string, string]; ps?: string } {
  const cause = lead.main_cause && TEXT[lead.main_cause] ? lead.main_cause : "L";
  const tx = TEXT[cause];
  const calc = link(SITE, "/calculator", lead, "email-" + step);
  const blogIx = step.startsWith("blog") ? Number(step.slice(4)) - 1 : -1;
  switch (step) {
    case "welcome": {
      const paras = [
        "Hi, it's Yashu from Next Chapter Guides. Thank you for taking the quiz. Here is your result, so you have it in your inbox.",
        "<b>Your main cause: " + esc(GROUP[cause]) + ".</b> " + esc(tx.meaning),
        "<b>Your first move (about 10 minutes):</b> " + esc(tx.first),
      ];
      return { subject: "Your result: " + GROUP[cause], paras: paras.concat(["Over the next few weeks I will send you a free calculator and a few of my best articles. Nothing to buy and nothing to do. If one of them helps, great. If not, you can unsubscribe with one click at the bottom of any email."]), ps: "Want to answer the quiz again? <a href=\"" + link(SITE, "/quiz", lead, "email-welcome") + "\">Retake it</a> any time." };
    }
    case "calc1":
      return { subject: "A free calculator: is it too late for you?", paras: [
        "Hi, it's Yashu. When people tell me they hate their job, the next thing they say is usually: &ldquo;But am I too old to start over?&rdquo;",
        "I made a free calculator for exactly that worry. It counts how many working years you really have left, compares them with how long people usually stay in a job, and names the real age worries so you can answer each one.",
        "You can do it in one sitting with a pen. Free. No payment and no extra sign-up.",
      ], button: ["Get the free calculator", calc] };
    case "calc2":
      return { subject: "Did you get the calculator?", paras: [
        "Hi, it's Yashu again. This is just a gentle second nudge, in case my last email got buried.",
        "The Career Change Age Calculator is still free. A worry is easier to carry once it is written down and answered, so it stops going round in your head.",
        "If you have already got it, thank you, and you can ignore this one.",
      ], button: ["Get the free calculator", calc] };
    case "blog1": case "blog2": case "blog3": case "blog4": {
      const art = SEQ[cause][blogIx];
      const intros = [
        "Hi, it's Yashu. No calculator or sign-up this time, just one article I wrote that fits where you are.",
        "Hi, it's Yashu. Here is another article that matches your quiz result.",
        "Hi, it's Yashu. Here is one more that I think fits you.",
        "Hi, it's Yashu. Here is the last article in this short set.",
      ];
      return { subject: art[1], paras: [
        intros[blogIx],
        "<b>" + esc(art[1]) + "</b>. " + esc(art[2]),
        "Read it when you have ten quiet minutes. There is nothing to buy on this page.",
      ], button: ["Read the article", link(BLOG, art[0], lead, "email-" + step)] };
    }
    case "offer":
      return { subject: "If you want more help, here are your options", paras: [
        "Hi, it's Yashu. It has been a month since you took the quiz. I hope the articles and the calculator were useful.",
        "I have given you the free parts first on purpose. If you want more help now, there are three ways to go. You can pick one or none, and the free articles stay free either way.",
        "<b>1. The Career Clarity Workbook ($24).</b> A guide for the question &ldquo;what would I do instead?&rdquo; It is the best place to start.",
        "<b>2. The Complete Career Change Program ($97).</b> The whole set of guides plus a 12-week plan. It is not open yet, and you can join the list to hear when it is.",
        "<b>3. Guided help ($150, or 3 payments of $55).</b> Two calls a week for 12 weeks. There are only 3 places a month, and you can join the list for the next opening.",
      ], button: ["See the three options", link(SITE, "/choose", lead, "email-offer")], ps: "This is the only email like this I send. If you would rather not hear about paid help, you will not miss anything: just keep reading the free articles at " + BLOG + "." };
  }
  throw new Error("step");
}

function render(step: string, lead: Lead) {
  const b = build(step, lead);
  const cause = lead.main_cause || "L";
  const paras = b.paras.slice();
  const unsub = SITE + "/unsubscribe?t=" + lead.token;
  const addr = Deno.env.get("MAIL_ADDRESS") || "";
  const btn = b.button ? '<p style="margin:24px 0"><a href="' + b.button[1] + '" style="display:inline-block;background:#2563EB;color:#fff;padding:12px 20px;border-radius:8px;font-weight:600;text-decoration:none">' + esc(b.button[0]) + "</a></p>" : "";
  const html = '<div style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.6;color:#0F1E3D;max-width:560px;margin:0 auto;padding:8px">' +
    paras.map((p) => '<p style="margin:0 0 16px">' + p + "</p>").join("") + btn +
    (b.ps ? '<p style="margin:0 0 16px">P.S. ' + b.ps + "</p>" : "") +
    '<p style="margin:24px 0 0">Yashu</p>' +
    '<hr style="border:0;border-top:1px solid #D7DEEA;margin:28px 0 14px">' +
    '<p style="font-size:12px;line-height:1.5;color:#5B6478;margin:0">You are getting this because you took the quiz at Next Chapter Guides and ticked the box for these emails. <a href="' + unsub + '" style="color:#5B6478">Unsubscribe</a> with one click.' + (addr ? "<br>" + esc(addr) : "") + "</p></div>";
  const text = paras.map((p) => p.replace(/<[^>]+>/g, "").replace(/&ldquo;|&rdquo;/g, '"').replace(/&amp;/g, "&")).join("\n\n") +
    (b.button ? "\n\n" + b.button[0] + ": " + b.button[1] : "") + (b.ps ? "\n\nP.S. " + b.ps.replace(/<[^>]+>/g, "") : "") + "\n\nYashu\n\n--\nUnsubscribe: " + unsub;
  return { subject: b.subject, html, text, unsub, cause };
}

async function sendMail(to: string, m: ReturnType<typeof render>, token: string) {
  const key = Deno.env.get("RESEND_API_KEY"), from = Deno.env.get("MAIL_FROM");
  if (!key || !from) return { ok: false, noProvider: true, err: "no provider" };
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST", headers: { Authorization: "Bearer " + key, "content-type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject: m.subject, html: m.html, text: m.text, reply_to: Deno.env.get("MAIL_REPLY_TO") || undefined,
      headers: { "List-Unsubscribe": "<" + FN + "/nc-unsub?t=" + token + ">", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } }),
  });
  if (!r.ok) return { ok: false, err: (r.status + " " + (await r.text())).slice(0, 200) };
  return { ok: true };
}

Deno.serve(async (req) => {
  const u = new URL(req.url);
  // Preview: ?preview=<step>&cause=B&key=<dash key> returns the subject and text of an email, without sending.
  if (u.searchParams.has("preview")) {
    if (u.searchParams.get("key") !== Deno.env.get("NC_DASH_KEY")) return new Response("no", { status: 401 });
    const step = u.searchParams.get("preview")!, cause = u.searchParams.get("cause") || "B";
    if (!STEPS.includes(step)) return new Response("bad step", { status: 400 });
    const lead: Lead = { id: 0, email: "x@example.com", main_cause: cause, second_cause: null, cid: "preview", token: "00000000-0000-0000-0000-000000000000", ts: new Date().toISOString() };
    const m = render(step, lead);
    return new Response(JSON.stringify({ subject: m.subject, text: m.text, html: u.searchParams.get("html") ? m.html : undefined }, null, 1), { headers: J });
  }
  const now = new Date();
  const { data: due, error } = await sb.from("nc_mail_queue").select("id,lead_id,step,send_at,tries").eq("status", "pending").lte("send_at", now.toISOString()).order("send_at").limit(25);
  if (error) return new Response(JSON.stringify({ ok: false, error: error.message }), { status: 500, headers: J });
  const out = { sent: 0, skipped: 0, failed: 0, waiting: 0 };
  for (const q of due || []) {
    const { data: lead } = await sb.from("nc_leads").select("id,email,main_cause,second_cause,cid,token,ts,unsubscribed_at,consent_tips,scores").eq("id", q.lead_id).single();
    const skip = async (note: string) => { await sb.from("nc_mail_queue").update({ status: "skipped", note }).eq("id", q.id).eq("status", "pending"); out.skipped++; };
    if (!lead || lead.unsubscribed_at || !lead.consent_tips) { await skip("no consent or unsubscribed"); continue; }
    if (q.step === "calc1" || q.step === "calc2") {
      if (q.step === "calc1" && now.getTime() - new Date(q.send_at).getTime() > 48 * 3600e3) { await skip("too late"); continue; }
      if (lead.cid) {
        const { count } = await sb.from("nc_events").select("id", { count: "exact", head: true }).eq("cid", lead.cid).eq("event", "calculator_view").gte("ts", lead.ts);
        if (count) { await skip("already viewed the calculator"); continue; }
      }
    }
    if (q.step === "offer" && lead.cid) {
      const { count } = await sb.from("nc_events").select("id", { count: "exact", head: true }).eq("cid", lead.cid).in("event", ["purchase", "order"]);
      if (count) { await skip("already bought"); continue; }
    }
    // Claim the row first so overlapping runs cannot send it twice.
    const { data: claimed } = await sb.from("nc_mail_queue").update({ status: "sent", sent_at: now.toISOString() }).eq("id", q.id).eq("status", "pending").select("id");
    if (!claimed?.length) continue;
    const m = render(q.step, lead as Lead);
    if (q.step === "welcome" && lead.main_cause !== "D" && (lead.scores as any)?.D >= 3) {
      m.html = m.html.replace("<p style=\"margin:0 0 16px\">Over the next", '<p style="margin:0 0 16px"><b>A note on tiredness:</b> ' + esc(CARE) + "</p><p style=\"margin:0 0 16px\">Over the next");
      m.text = m.text.replace("Over the next", "A note on tiredness: " + CARE + "\n\nOver the next");
    }
    const r = await sendMail(lead.email, m, lead.token);
    if (r.ok) { out.sent++; continue; }
    if ((r as any).noProvider) { await sb.from("nc_mail_queue").update({ status: "pending", sent_at: null, note: "waiting for mail provider" }).eq("id", q.id); out.waiting++; break; }
    const tries = (q.tries || 0) + 1;
    if (tries >= 3) { await sb.from("nc_mail_queue").update({ status: "failed", tries, note: r.err }).eq("id", q.id); out.failed++; }
    else { await sb.from("nc_mail_queue").update({ status: "pending", sent_at: null, tries, send_at: new Date(now.getTime() + 15 * 60e3).toISOString(), note: r.err }).eq("id", q.id); out.failed++; }
  }
  return new Response(JSON.stringify({ ok: true, ...out }), { headers: J });
});
