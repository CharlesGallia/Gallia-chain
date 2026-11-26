// Affiche l'écran « Mouvements » de Galli.Pay pour une adresse (lecture seule : aucune clé, rien n'est signé).
// Usage : node outils/voir_historique.js <page> <adresse g1…>
const puppeteer = require("puppeteer");
const [page, adresse] = process.argv.slice(2);
(async () => {
  const nav = await puppeteer.launch({ args: ["--no-sandbox"] });
  const p = await nav.newPage();
  await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await p.evaluateOnNewDocument((a) => localStorage.setItem("galliPay.comptes.v1", JSON.stringify([{ nom: "Galli d'essai", adresse: a, json: {} }])), adresse);
  await p.goto(page + "#accueil", { waitUntil: "networkidle2" });
  await p.waitForSelector("[data-ecran=accueil]:not([hidden])");
  await p.click('[data-vers="historique"]');
  await p.waitForFunction(() => /Pain|Reçu|Envoyé|Aucun|indisponibles/.test(document.querySelector("#historique").textContent), { timeout: 30000 });
  await new Promise((r) => setTimeout(r, 1500));
  console.log((await p.$eval("#historique", (e) => e.innerText)).replace(/\n+/g, " | "));
  await p.screenshot({ path: "captures/essai-5-historique.png" });
  await nav.close();
})().catch((e) => { console.error("ERREUR :", e.message); process.exit(1); });
