import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { marked } from "marked";

const DIST = join(process.cwd(), "dist");
const SITE = "https://davd-gzl.github.io/MAX-Finder/";
const TOP_ROUTES = 150;

if (!existsSync(join(DIST, "index.html"))) {
  console.error("dist/ not found — run the build first");
  process.exit(1);
}

const rows = JSON.parse(readFileSync(join(DIST, "data", "tgvmax.json"), "utf8"));
let meta = { updatedAt: "" };
try {
  meta = JSON.parse(readFileSync(join(DIST, "data", "meta.json"), "utf8"));
} catch {
  meta = { updatedAt: "" };
}
const lastmod = (meta.updatedAt || new Date().toISOString()).slice(0, 10);
const dateFmt = new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "short" });
const frDate = (iso) => dateFmt.format(new Date(`${iso}T12:00:00Z`));

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

marked.use({
  renderer: {
    code(token) {
      if ((token.lang || "").trim() === "mermaid") {
        return `<details><summary>Diagram (text source)</summary><pre><code>${esc(token.text)}</code></pre></details>\n`;
      }
      return false;
    },
  },
});

const slug = (label) =>
  String(label)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const CSS = `
:root{--accent:#0f7a52;--ink:#101512;--muted:#5f6b66;--line:#dfe7e2;--soft:#f2f7f4}
*{box-sizing:border-box}
body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:var(--ink);line-height:1.6;background:#fff}
.top{border-bottom:1px solid var(--line);background:var(--soft)}
.top a{display:inline-block;padding:.7rem 1.1rem;color:var(--accent);font-weight:650;text-decoration:none}
main{max-width:780px;margin:0 auto;padding:1.6rem 1.1rem 3rem}
h1{font-size:1.55rem;line-height:1.25;letter-spacing:-0.015em;margin:0 0 .8rem}
h2{font-size:1.15rem;margin:1.8rem 0 .5rem}
h3{font-size:1rem;margin:1.3rem 0 .4rem}
p,li,dd{color:#2c3530}
a{color:var(--accent)}
img{max-width:100%}
pre{overflow-x:auto;background:var(--soft);padding: .8rem;border-radius:8px}
code{background:var(--soft);border-radius:4px;padding:.05em .3em;font-size:.92em}
pre code{background:none;padding:0}
.tablewrap{overflow-x:auto}
table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}
th,td{padding:.45rem .65rem;border-bottom:1px solid var(--line);text-align:left;white-space:nowrap}
th{font-size:.8rem;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}
.cta{display:inline-block;background:var(--accent);color:#fff;padding:.65rem 1.1rem;border-radius:9px;text-decoration:none;font-weight:650;margin:.6rem 0 1rem}
dt{font-weight:650;margin-top:.9rem}
dd{margin:.2rem 0 0}
.note{color:var(--muted);font-size:.88rem}
footer{border-top:1px solid var(--line);margin-top:2.5rem;padding-top:1rem;font-size:.85rem;color:var(--muted)}
footer a{color:var(--accent)}
.cols{columns:2;column-gap:2rem}
@media(max-width:600px){.cols{columns:1}}
`;

function pageShell({ lang, title, description, path, body, jsonld }) {
  const canonical = SITE + path;
  const blocks = (jsonld || [])
    .map((o) => `<script type="application/ld+json">${JSON.stringify(o)}</script>`)
    .join("\n    ");
  return `<!doctype html>
<html lang="${lang}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' https://ressources.data.sncf.com; worker-src 'self'; base-uri 'self'" />
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(description)}" />
    <link rel="canonical" href="${canonical}" />
    <link rel="icon" type="image/svg+xml" href="${SITE}icons/icon.svg" />
    <meta property="og:type" content="article" />
    <meta property="og:title" content="${esc(title)}" />
    <meta property="og:description" content="${esc(description)}" />
    <meta property="og:url" content="${canonical}" />
    <meta property="og:image" content="${SITE}icons/og.png" />
    <meta name="twitter:card" content="summary_large_image" />
    ${blocks}
    <style>${CSS}</style>
  </head>
  <body>
    <div class="top"><a href="${SITE}">← MAX Finder</a></div>
    <main>
${body}
      <footer>
        <p>
          Source : <a href="https://ressources.data.sncf.com/explore/dataset/tgvmax/information/">SNCF Open Data — tgvmax</a>
          (Licence Ouverte), instantané du ${esc(lastmod)}. Disponibilités indicatives, rafraîchies ~1×/jour ;
          la réservation se fait sur <a href="https://www.sncf-connect.com/">SNCF Connect</a>.
          Projet libre et indépendant, non affilié à la SNCF —
          <a href="https://github.com/davd-gzl/MAX-Finder">code source</a>.
        </p>
        <p>
          <a href="${SITE}">Rechercher un trajet</a> · <a href="${SITE}faq/">FAQ</a> ·
          <a href="${SITE}trajets/">Disponibilités par trajet</a> ·
          <a href="${SITE}docs/how-it-works.html">How it works</a>
        </p>
      </footer>
    </main>
  </body>
</html>
`;
}

function write(path, html) {
  const file = join(DIST, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, html);
}

const sitemapPaths = ["", "faq/", "trajets/", "docs/how-it-works.html", "docs/algorithms.html"];

const docs = [
  {
    src: "docs/how-it-works.md",
    out: "docs/how-it-works.html",
    title: "How MAX Finder works — SNCF open data, refresh cycle, privacy",
    description:
      "Where MAX Finder's TGVmax (MAX JEUNE / MAX SENIOR) availability data comes from, how often it refreshes, and why the app runs with no server and no account.",
  },
  {
    src: "docs/algorithms.md",
    out: "docs/algorithms.html",
    title: "How MAX Finder finds trains — the search algorithms, explained simply",
    description:
      "How MAX Finder filters free TGVmax (MAX JEUNE / MAX SENIOR) seats, builds connections through hubs, ranks destinations and plans multi-city tours.",
  },
];
for (const d of docs) {
  const md = readFileSync(join(process.cwd(), d.src), "utf8");
  const body = marked.parse(md);
  write(d.out, pageShell({ lang: "en", title: d.title, description: d.description, path: d.out, body }));
}

const faq = [
  {
    q: "Pourquoi SNCF Connect affiche « aucun train disponible » avec mon abonnement MAX ?",
    a: `Chaque train ne propose qu'un quota limité de places MAX. Sur les liaisons les plus demandées, ce quota part très vite et SNCF Connect affiche alors « aucun train disponible » — alors que d'autres trains, d'autres jours ou d'autres liaisons ont encore des places ouvertes. <a href="${SITE}">MAX Finder</a> liste précisément les trains où le quota MAX est encore ouvert, pour chercher là où il reste des places au lieu d'essayer au hasard.`,
  },
  {
    q: "Quand les places MAX ouvrent-elles à la réservation ?",
    a: "La réservation ouvre environ 30 jours avant le départ. La SNCF ajoute ensuite des places par vagues, parfois jusqu'à la veille du départ : un train complet aujourd'hui peut rouvrir demain, d'où l'intérêt de revérifier régulièrement.",
  },
  {
    q: "Les disponibilités affichées sont-elles en temps réel ?",
    a: "Non. MAX Finder repose sur l'open data SNCF (jeu de données « tgvmax »), un instantané publié environ une fois par jour. Les disponibilités sont donc indicatives : une place affichée peut avoir été prise depuis la publication. La référence reste SNCF Connect, où s'effectue la réservation.",
  },
  {
    q: "Quelle différence entre TGVmax, MAX JEUNE et MAX SENIOR ?",
    a: "TGVmax est l'ancien nom commercial de l'abonnement. Il existe aujourd'hui MAX JEUNE (16-27 ans, réservations gratuites 7j/7 dans la limite des places) et MAX SENIOR (60 ans et plus, du lundi au vendredi en heures creuses, hors week-ends et périodes de forte affluence).",
  },
  {
    q: "MAX SENIOR fonctionne-t-il le week-end ?",
    a: "Non : les réservations gratuites MAX SENIOR sont limitées du lundi au vendredi en heures creuses. MAX Finder affiche les places ouvertes côté open data et signale les dates de week-end lors d'une recherche MAX SENIOR ; vérifiez toujours les conditions sur SNCF Connect.",
  },
  {
    q: "Pourquoi un train affiché disponible ne l'est plus au moment de réserver ?",
    a: "Les données sont un instantané quotidien et les places MAX partent vite. Si un train vous intéresse, réservez-le rapidement sur SNCF Connect ; si le quota vient d'être épuisé, réessayez plus tard, des places sont régulièrement réinjectées.",
  },
  {
    q: "Peut-on chercher un trajet avec correspondances ?",
    a: "Oui. MAX Finder construit des itinéraires jusqu'à 6 changements via les grands nœuds (Paris, Lyon, Lille, Marseille, Bordeaux…), avec un point de passage imposé optionnel (« Via ») et un mode « étape de nuit » pour les longs trajets sur plusieurs jours.",
  },
  {
    q: "Comment partager une recherche ou un trajet ?",
    a: "Toute recherche est encodée dans l'URL de la page : le bouton Partager (ou un simple copier-coller de l'adresse) suffit pour envoyer exactement la même recherche à quelqu'un d'autre.",
  },
  {
    q: "MAX Finder est-il un site officiel SNCF ? Vend-il des billets ?",
    a: "Non et non. C'est un projet indépendant, open source (licence AGPL-3.0), qui ne vend rien et n'est pas affilié à la SNCF. Il réutilise l'open data SNCF publié sous Licence Ouverte, et renvoie vers SNCF Connect pour la réservation.",
  },
  {
    q: "Que fait MAX Finder de mes données personnelles ?",
    a: "Rien : il n'y a ni compte, ni cookie de suivi, ni serveur. Favoris, réglages et recherches restent dans le stockage local de votre navigateur.",
  },
];
const faqBody = `
<h1>FAQ — TGV Max (MAX JEUNE / MAX SENIOR) et MAX Finder</h1>
<p>
  Les questions les plus fréquentes sur la recherche de places TGV Max et sur le fonctionnement de
  <a href="${SITE}">MAX Finder</a>, l'outil libre qui affiche les trains où une place MAX JEUNE ou MAX SENIOR
  est ouverte à la réservation.
</p>
<dl>
${faq.map((f) => `  <dt>${esc(f.q)}</dt>\n  <dd>${f.a}</dd>`).join("\n")}
</dl>
`;
const faqJsonld = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: faq.map((f) => ({
    "@type": "Question",
    name: f.q,
    acceptedAnswer: { "@type": "Answer", text: f.a.replace(/<[^>]+>/g, "") },
  })),
};
write(
  "faq/index.html",
  pageShell({
    lang: "fr",
    title: "FAQ TGV Max — places MAX JEUNE / MAX SENIOR introuvables, ouverture à J-30, astuces",
    description:
      "Pourquoi « aucun train disponible » avec un abonnement MAX, quand ouvrent les réservations, données temps réel ou non : les réponses, et l'outil gratuit pour trouver les places restantes.",
    path: "faq/",
    body: faqBody,
    jsonld: [faqJsonld],
  }),
);

const byRoute = new Map();
for (const r of rows) {
  if (r.od_happy_card !== "OUI") continue;
  if (!r.origine || !r.destination || r.origine === r.destination) continue;
  const key = `${r.origine} ${r.destination}`;
  let e = byRoute.get(key);
  if (!e) {
    e = { origin: r.origine, destination: r.destination, total: 0, days: new Map() };
    byRoute.set(key, e);
  }
  e.total += 1;
  let day = e.days.get(r.date);
  if (!day) {
    day = { count: 0, first: r.heure_depart, last: r.heure_depart };
    e.days.set(r.date, day);
  }
  day.count += 1;
  if (r.heure_depart < day.first) day.first = r.heure_depart;
  if (r.heure_depart > day.last) day.last = r.heure_depart;
}

const routes = [...byRoute.values()].sort((a, b) => b.total - a.total).slice(0, TOP_ROUTES);
const slugOf = new Map();
const used = new Set();
for (const r of routes) {
  for (const label of [r.origin, r.destination]) {
    if (slugOf.has(label)) continue;
    let s = slug(label);
    while (used.has(s)) s += "-2";
    used.add(s);
    slugOf.set(label, s);
  }
}
const routePath = (r) => `trajets/${slugOf.get(r.origin)}/${slugOf.get(r.destination)}/`;
const routeSet = new Set(routes.map((r) => `${r.origin} ${r.destination}`));

for (const r of routes) {
  const path = routePath(r);
  const days = [...r.days.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const firstDate = days[0][0];
  const deepLink = `${SITE}?mode=od&from=${encodeURIComponent(r.origin)}&to=${encodeURIComponent(r.destination)}&date=${firstDate}`;
  const reverseKey = `${r.destination} ${r.origin}`;
  const reverse = routeSet.has(reverseKey)
    ? `${SITE}trajets/${slugOf.get(r.destination)}/${slugOf.get(r.origin)}/`
    : null;
  const siblings = routes
    .filter((o) => o.origin === r.origin && o.destination !== r.destination)
    .slice(0, 8);
  const tableRows = days
    .map(
      ([date, d]) =>
        `<tr><td>${esc(frDate(date))}</td><td>${d.count}</td><td>${esc(d.first)}</td><td>${esc(d.last)}</td></tr>`,
    )
    .join("\n");
  const body = `
<h1>Places TGV Max ${esc(r.origin)} → ${esc(r.destination)}</h1>
<p>
  <strong>${r.total}</strong> trains avec une place <strong>MAX JEUNE / MAX SENIOR</strong> ouverte à la
  réservation de ${esc(r.origin)} à ${esc(r.destination)} sur ${r.days.size} jour(s) de la fenêtre de
  réservation (~30 jours), d'après l'open data SNCF du ${esc(lastmod)}.
</p>
<p><a class="cta" href="${esc(deepLink)}">Voir ce trajet dans MAX Finder</a></p>
<div class="tablewrap">
<table>
  <thead><tr><th>Date</th><th>Trains avec place MAX</th><th>Premier départ</th><th>Dernier départ</th></tr></thead>
  <tbody>
${tableRows}
  </tbody>
</table>
</div>
<p class="note">
  Trains directs uniquement sur ce tableau ; l'application recherche aussi les correspondances (jusqu'à 6
  changements). Les places MAX sont un quota limité par train : les disponibilités changent en continu.
</p>
<h2>Bon à savoir</h2>
<dl>
  <dt>Quand réserver ?</dt>
  <dd>Les places MAX ouvrent ~30 jours avant le départ et des places sont réinjectées jusqu'à la veille.</dd>
  <dt>Ces horaires sont-ils garantis ?</dt>
  <dd>Non : instantané quotidien de l'open data SNCF, indicatif. La réservation et la confirmation se font sur SNCF Connect.</dd>
  <dt>Et dans l'autre sens ?</dt>
  <dd>${reverse ? `Voir <a href="${reverse}">${esc(r.destination)} → ${esc(r.origin)}</a>.` : `Utilisez la recherche « Trajet précis » de l'application.`}</dd>
</dl>
${
  siblings.length
    ? `<h2>Autres trajets depuis ${esc(r.origin)}</h2>\n<ul>\n${siblings
        .map((s) => `  <li><a href="${SITE}${routePath(s)}">${esc(s.origin)} → ${esc(s.destination)}</a></li>`)
        .join("\n")}\n</ul>`
    : ""
}
`;
  write(
    path + "index.html",
    pageShell({
      lang: "fr",
      title: `Train ${r.origin} → ${r.destination} avec TGV Max (MAX JEUNE / MAX SENIOR) : disponibilités`,
      description: `Dates avec des places TGV Max réservables de ${r.origin} à ${r.destination} : ${r.total} trains sur ~30 jours, mis à jour chaque jour depuis l'open data SNCF.`,
      path,
      body,
    }),
  );
  sitemapPaths.push(path);
}

const byOrigin = new Map();
for (const r of routes) {
  if (!byOrigin.has(r.origin)) byOrigin.set(r.origin, []);
  byOrigin.get(r.origin).push(r);
}
const indexBody = `
<h1>Disponibilités TGV Max par trajet</h1>
<p>
  Les ${routes.length} liaisons avec le plus de places <strong>MAX JEUNE / MAX SENIOR</strong> ouvertes à la
  réservation sur la fenêtre de ~30 jours, recalculées chaque jour depuis l'open data SNCF. Pour toute autre
  liaison, utilisez <a href="${SITE}">la recherche complète</a>.
</p>
${[...byOrigin.entries()]
  .sort((a, b) => a[0].localeCompare(b[0], "fr"))
  .map(
    ([origin, list]) => `
<h2>Depuis ${esc(origin)}</h2>
<ul class="cols">
${list
  .map((r) => `  <li><a href="${SITE}${routePath(r)}">${esc(r.destination)}</a> (${r.total} trains)</li>`)
  .join("\n")}
</ul>`,
  )
  .join("\n")}
`;
write(
  "trajets/index.html",
  pageShell({
    lang: "fr",
    title: "Disponibilités TGV Max par trajet — les liaisons avec le plus de places MAX",
    description: `Les ${routes.length} liaisons TGV Max (MAX JEUNE / MAX SENIOR) avec le plus de places réservables, mises à jour chaque jour depuis l'open data SNCF.`,
    path: "trajets/",
    body: indexBody,
  }),
);

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapPaths.map((p) => `  <url><loc>${SITE}${p}</loc><lastmod>${lastmod}</lastmod></url>`).join("\n")}
</urlset>
`;
write("sitemap.xml", sitemap);

const llms = readFileSync(join(process.cwd(), "public", "llms.txt"), "utf8");
const faqText = faq.map((f) => `## ${f.q}\n\n${f.a.replace(/<[^>]+>/g, "")}`).join("\n\n");
const llmsFull = [
  llms.trim(),
  "\n\n---\n\n# Snapshot\n",
  `Snapshot date: ${lastmod}. Records: ${rows.length}. Top routes pages: ${SITE}trajets/`,
  "\n\n---\n\n# How it works (docs/how-it-works.md)\n",
  readFileSync(join(process.cwd(), "docs", "how-it-works.md"), "utf8").trim(),
  "\n\n---\n\n# Algorithms (docs/algorithms.md)\n",
  readFileSync(join(process.cwd(), "docs", "algorithms.md"), "utf8").trim(),
  "\n\n---\n\n# FAQ (français)\n",
  faqText,
  "",
].join("\n");
writeFileSync(join(DIST, "llms-full.txt"), llmsFull);

console.log(
  `generated: 2 docs pages, faq, ${routes.length} route pages + index, sitemap (${sitemapPaths.length} URLs), llms-full.txt`,
);
