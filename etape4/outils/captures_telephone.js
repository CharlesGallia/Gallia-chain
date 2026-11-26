// Captures de Galli.Pay au format téléphone (390 × 844, écran Retina), écran par écran.
// Crée d'abord un compte jetable dans le navigateur de capture (rien n'est envoyé à la chaîne).
// Usage, depuis ~/gallia :
//   docker run --rm --network host -v "$PWD/captures":/home/pptruser/captures -v "$PWD/etape4/outils":/home/pptruser/outils:ro \
//     ghcr.io/puppeteer/puppeteer:23.11.1 node outils/captures_telephone.js https://pay.gallia.space/
const puppeteer = require("puppeteer");
const PAGE = process.argv[2] || "https://pay.gallia.space/";
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const nav = await puppeteer.launch({ args: ["--no-sandbox"] });
  const p = await nav.newPage();
  await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  p.on("pageerror", (e) => console.log("erreur de la page :", e.message));
  const capture = async (nom) => {
    await attendre(2500);
    await p.screenshot({ path: `captures/telephone-${nom}.png` });
    console.log(`capture : telephone-${nom}.png`);
  };

  await p.goto(PAGE, { waitUntil: "networkidle2" });
  await p.waitForSelector("[data-ecran=bienvenue]:not([hidden])");
  await capture("0-bienvenue");

  await p.click("#creer-bienvenue");
  await p.waitForSelector("#mots li");
  await p.evaluate(() => document.querySelectorAll("#mots li").forEach((e) => (e.style.filter = "blur(7px)")));
  await capture("1-creer");
  await p.click("#mots-notes");
  await p.type("#nom-creer", "Charles Pourlier");
  await p.type("#code-creer", "capture-123456");
  await p.click("#form-creer button.ivoire");
  await p.waitForSelector("[data-ecran=accueil]:not([hidden])");
  await capture("2-accueil");

  for (const [nom, selecteur] of [
    ["3-services", "[data-onglet-bas=services]"],
    ["4-payer", "[data-onglet-bas=payer]"],
    ["6-ruche", "[data-onglet-bas=ruche]"],
    ["7-profil", "[data-onglet-bas=profil]"],
  ]) {
    await p.click(selecteur);
    await capture(nom);
  }
  await p.click("[data-onglet-bas=services]");
  await attendre(800);
  await p.click('[data-bientot="Galli.Food"]');
  await capture("5-bientot");
  await p.click("[data-onglet-bas=accueil]");
  await attendre(500);
  await p.click('.actions [data-vers="recevoir"]');
  await capture("8-recevoir");
  await nav.close();
})().catch((e) => {
  console.error("ERREUR :", e.message);
  process.exit(1);
});
