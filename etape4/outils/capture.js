// Capture d écran d une page (navigateur sans écran, Puppeteer). Usage, depuis ~/gallia :
// docker run --rm --network host -v "$PWD/captures":/home/pptruser/captures -v "$PWD/etape4/outils":/home/pptruser/outils:ro \
//   ghcr.io/puppeteer/puppeteer:23.11.1 node outils/capture.js <url> captures/<nom>.png [attente_ms] [clic] [éléments_à_flouter]
const puppeteer = require("puppeteer");
(async () => {
  const [url, out, attente, clic] = process.argv.slice(2);
  const b = await puppeteer.launch({ args: ["--no-sandbox"] });
  const p = await b.newPage();
  await p.setViewport({ width: 1280, height: 1000 });
  p.on("console", (m) => console.log("console:", m.type(), m.text().slice(0, 300)));
  p.on("pageerror", (e) => console.log("erreur:", e.message.slice(0, 300)));
  await p.goto(url, { waitUntil: "networkidle2" });
  await new Promise((r) => setTimeout(r, Number(attente || 6000)));
  if (clic) { await p.click(clic); await new Promise((r) => setTimeout(r, 4000)); }
  if (process.argv[6]) await p.evaluate((s) => document.querySelectorAll(s).forEach((e) => (e.style.filter = "blur(7px)")), process.argv[6]);
  await p.screenshot({ path: out, fullPage: true });
  await b.close();
})();
