// Builds the niche landing pages under public/for/ and the sitemap from one template.
// Run: node scripts/build-pages.mjs
import { writeFileSync, mkdirSync } from 'node:fs';

const SITE = 'https://lotledger-3rx.pages.dev';
const CTA = '/app/#signup';

const PAGES = [
  {
    slug: 'soap-makers',
    title: 'Lot tracking for soap makers',
    h1: 'Batch records for soap makers who sell',
    lead: 'You cure a batch for four to six weeks, cut it into forty bars, and sell them across three markets and an Etsy shop. When someone asks which batch their bar came from, you should not have to dig through a notebook.',
    pains: [
      ['Which oils, which lye, which date', 'Every lot records what went in and who supplied it. When a supplier recalls an oil, you search their lot number and see exactly which of your batches used it.'],
      ['Cure dates that keep themselves', 'Set a shelf life on each soap once. Each new batch gets its best-by filled in, and the Lots screen sorts by it so you sell the oldest bars first.'],
      ['Units on hand by product, not by guess', 'Sold 12 at Saturday market, gave 2 away, 3 came back dented. Three taps. The on-hand count for that lot is right.'],
      ['Labels that find the batch', 'Print QR labels 30 to a sheet. A customer or an inspector scans one with a phone and the lot opens.'],
    ],
    example: 'A lavender bar made on March 2 is lot FW1040. It lists olive oil (lot OL-2231 from your supplier), coconut oil, lye, and lavender essential oil lot L-311. Forty bars made, best by March 2 next year. 18 sold at markets, 12 through the shop, 10 on hand. All of that is one screen.',
  },
  {
    slug: 'candle-makers',
    title: 'Batch and lot tracking for candle makers',
    h1: 'Batch records for candle makers',
    lead: 'Wax lot, wick lot, fragrance load, pour temperature, cure time. A candle that tunnels or a wick that mushrooms is a batch problem, and you can only fix a batch problem if you know which batch it was.',
    pains: [
      ['Wax and wick lots on every batch', 'Record the wax lot number and the wick box on each batch. When a run of candles burns wrong, you know what changed.'],
      ['Fragrance by the batch', 'Inputs are free text, so "6% Vanilla Bean, lot 2251" goes on the record exactly as you wrote it on the jar.'],
      ['Know what to sell first', 'Candles do not spoil, but scent fades. Set a best-by on the product and the app flags which lots to move first.'],
      ['Wholesale and markets in one count', 'Record units out by sale, wholesale, sample or shrink. On-hand per lot stays right across every channel.'],
    ],
    example: 'A batch of 24 eight-ounce soy candles poured on October 7 is lot CL1030: wax 464 lot 2251, CD-12 wicks, 8% Fresh Linen. Nine sold, fifteen on hand. A wholesale order for 12 packs from that lot with one tap.',
  },
  {
    slug: 'jam-and-preserves',
    title: 'Lot tracking for jam, jelly and preserves',
    h1: 'Batch records for jam, jelly and preserves',
    lead: 'A water-bath batch is a lot. Cottage food rules in most states expect you to be able to say which jars came from which batch and when. A notebook works until the day you need it fast.',
    pains: [
      ['Fruit source on the record', 'Which farm, which pick date, which pectin. When a customer asks whether your strawberry jam is from local berries, the lot says so.'],
      ['Best-by that fills itself', 'Set 12 months on the product once. Every batch gets its date. The Lots screen tells you what to sell first and what is past.'],
      ['A hold button for the batch you are unsure of', 'Seal looked soft on a few jars? Put the lot on hold with a reason. It stays visible, it stays out of the count, and the reason is on the record.'],
      ['The ledger an inspector asks for', 'Export every lot and every movement as one CSV. That is the record most cottage food programs mean when they say "keep records".'],
    ],
    example: 'Strawberry jam made September 17 from 12 lb of Hill Farm berries is lot JM1030. Thirty 8 oz jars, best by September 17 next year. Fourteen sold, two opened for tasting, fourteen on hand.',
  },
  {
    slug: 'cottage-food',
    title: 'Lot numbers and batch records for cottage food',
    h1: 'Lot numbers and batch records for cottage food businesses',
    lead: 'Cottage food laws let you sell from a home kitchen. Most of them also expect you to keep production records: what you made, when, how much, and what went in. LotLedger is that record, kept on your phone instead of in a binder.',
    pains: [
      ['A lot number on every batch, assigned for you', 'Pick a prefix once. Each batch gets the next number. Write it on the label; the app keeps the rest.'],
      ['Ingredients and suppliers per batch', 'Flour from which mill, which sack, which date. Sugar, pectin, oil, whatever you use. Free text, as specific as you want.'],
      ['Units made, units out, units on hand', 'Markets, online orders, samples, waste. Each is a tap against the lot. The count is always current and you never show a customer a number you cannot back up.'],
      ['Records you can hand over', 'When a program inspector or a customer with a complaint asks, export the ledger as one spreadsheet. Every lot, every movement, dated.'],
    ],
    example: 'Michigan is one example. Its Cottage Food Law puts the product name, the ingredients, allergens, the producer\'s name and address and the home-kitchen statement on every label, and requires you to keep sales records and show them to an MDARD inspector on request. A lot number is not required on the label, but it is the only thing that ties the jar in a customer\'s hand to the record you kept.',
  },
  {
    slug: 'skincare-makers',
    title: 'Batch records for small-batch skincare',
    h1: 'Batch records for handmade skincare',
    lead: 'A tallow balm, a lip balm, a body butter. Small batches, short shelf lives, and customers who ask what is in it. The batch record is the answer to every question you will get.',
    pains: [
      ['Every ingredient lot, every batch', 'Beeswax lot, oil lot, essential oil lot, preservative lot. When one of them is recalled, you find your affected batches in one search.'],
      ['Shelf life handled', 'Set it per product. Each batch gets a best-by. Sell-soon alerts at 30 days so a jar never goes out past its date.'],
      ['Tubes, jars and tins in one count', 'A lip balm batch of 60 tubes and a cream batch of 30 jars sit side by side, each with its own on-hand number.'],
      ['QR on the jar', 'Print a label per lot. Scan it to record a sale or to show a customer the batch.'],
    ],
    example: 'A 4 oz tallow cream batch rendered and whipped on September 27 is lot TV1020: beef suet from the local butcher, olive oil lot OL-2231, beeswax lot BW-19. Thirty jars, best by March 27. Twenty-nine out, one on hand, next batch due.',
  },
];

const GUIDE = {
  slug: 'what-is-a-lot-number',
  title: 'What is a lot number, and how should a small maker assign one?',
  h1: 'What is a lot number, and how do you assign one?',
  body: `
<p>A lot number (or batch number) is a code you put on a product so you can trace it back to the batch it came from. It answers one question: <em>which batch was this?</em> From there you can find the date, the ingredients, the suppliers and how many units were made.</p>
<h2>What goes in a lot number</h2>
<p>Keep it short and unique. The simplest scheme that works: a prefix for your business and a number that goes up by one (or ten) with every batch. <code>FW1040</code>, <code>FW1050</code>, <code>FW1060</code>. Some makers encode the date (<code>240302</code> for March 2, 2024) or the product. Both work, but a plain counter never collides and never needs explaining.</p>
<h2>What the lot number points at</h2>
<p>The number is only useful if there is a record behind it. For each lot, write down the product, the date made, the units made, the ingredients with their own supplier lot numbers, the best-by date, and then every movement out: sold, sampled, wasted, returned. That record is what an inspector means by "production records" and what you need the day a supplier recalls an ingredient.</p>
<h2>Do cottage food producers need lot numbers?</h2>
<p>Most state cottage food laws do not require a lot number on the label. Most do expect you to keep records and be able to trace a product back to its batch, and many programs recommend a batch code for exactly that reason. A lot number costs nothing to add to a label and makes the record useful.</p>
<h2>Where to keep the record</h2>
<p>A notebook works until you need to search it. A spreadsheet works until it lives on one laptop. LotLedger is a batch record you open on your phone: the lot number assigns itself, the best-by fills in from the product's shelf life, and every unit out is a tap. <a href="${CTA}">Try it free for 30 days</a>, no card.</p>`,
};

const page = (p) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${p.title} | LotLedger</title>
<meta name="description" content="${p.lead.slice(0, 155).replace(/"/g, '&quot;')}">
<link rel="canonical" href="${SITE}/for/${p.slug}">
<link rel="icon" href="/icon.svg">
<link rel="stylesheet" href="/app/app.css">
<style>
.hero{padding:3rem 0 1.5rem;max-width:720px}.hero h1{font-size:2rem;line-height:1.15;margin:0 0 .8rem}.hero p{font-size:1.1rem;color:var(--muted)}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:.8rem;margin:1.5rem 0}
.example{max-width:720px}.example p{color:var(--muted)}
footer{color:var(--muted);font-size:.85rem;padding:2rem 0;border-top:1px solid var(--line);margin-top:2rem}
</style>
<script src="/clarity.js" defer></script>
</head>
<body>
<header class="top"><a class="brand" href="/">Lot<span>Ledger</span></a><div class="acct" style="display:block"><a class="btn" href="/app/">Sign in</a></div></header>
<main>
<section class="hero">
  <h1>${p.h1}</h1>
  <p>${p.lead}</p>
  <p><a class="btn primary" href="${CTA}">Start free, 30 days, no card</a> &nbsp; <a class="btn" href="/">See the 30-second demo</a></p>
</section>
<section class="grid">
${p.pains.map(([h, t]) => `  <div class="card"><h2>${h}</h2><p class="muted">${t}</p></div>`).join('\n')}
</section>
<section class="card example">
  <h2>What a lot looks like</h2>
  <p>${p.example}</p>
</section>
<section>
  <h2>Pricing</h2>
  <p class="muted">$19 a month, or $149 once for a year of hosting and support (then $5 a month). Both start with 30 free days and no card. <a href="${CTA}">Start free</a>.</p>
</section>
<footer>LotLedger is a product of Proxura LLC, Michigan. <a href="/">Home</a> · <a href="/privacy.html">Privacy</a> · <a href="/terms.html">Terms</a> · theforemans2002+lotledger@gmail.com</footer>
</main>
</body>
</html>
`;

const guidePage = (g) => page({ ...g, lead: 'A lot number is the code that ties a product back to its batch record. Here is how small makers assign one and what to keep behind it.', pains: [], example: '' })
  .replace(/<section class="grid">[\s\S]*?<\/section>\n<section class="card example">[\s\S]*?<\/section>/, `<section class="card example">${g.body}</section>`);

mkdirSync('public/for', { recursive: true });
mkdirSync('public/guides', { recursive: true });
for (const p of PAGES) writeFileSync(`public/for/${p.slug}.html`, page(p));
writeFileSync(`public/guides/${GUIDE.slug}.html`, guidePage(GUIDE).replace(`<link rel="canonical" href="${SITE}/for/${GUIDE.slug}">`, `<link rel="canonical" href="${SITE}/guides/${GUIDE.slug}">`));

const urls = ['/', '/privacy.html', '/terms.html', ...PAGES.map((p) => `/for/${p.slug}`), `/guides/${GUIDE.slug}`];
writeFileSync('public/sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${SITE}${u}</loc></url>`).join('\n')}\n</urlset>\n`);
writeFileSync('public/robots.txt', `User-agent: *\nAllow: /\nDisallow: /app/\nDisallow: /api/\nSitemap: ${SITE}/sitemap.xml\n`);
console.log('built', PAGES.length + 1, 'pages, sitemap, robots');
