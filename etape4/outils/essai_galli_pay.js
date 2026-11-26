// Essai complet de Galli.Pay sur la chaîne de TEST (comptes de test publics, aucune valeur réelle).
// Un robot utilise la page comme un Galli : créer un compte, confirmer son identité, réclamer son pain,
// envoyer des Gallo, et vérifier qu'un compte non vérifié ne peut rien recevoir.
// Le Vérificateur de test (//Alice) joue le rôle du KYC de la Titulus.
// Usage, depuis ~/gallia :
//   docker run --rm --network host -e NODE_PATH=/home/pptruser/gp/node_modules \
//     -v "$PWD/captures":/home/pptruser/captures -v "$PWD/etape4/outils":/home/pptruser/outils:ro \
//     -v "$PWD/etape4/galli-pay":/home/pptruser/gp:ro ghcr.io/puppeteer/puppeteer:23.11.1 node outils/essai_galli_pay.js
const puppeteer = require("puppeteer");
const { ApiPromise, WsProvider } = require("@polkadot/api");
const { Keyring } = require("@polkadot/keyring");
const { cryptoWaitReady, mnemonicGenerate } = require("@polkadot/util-crypto");

const PAGE = "http://127.0.0.1:8091/";
const CODE = "essai-galli-123";
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));
let ok = true;
const verifier = (label, cond) => {
  ok &&= !!cond;
  console.log(`${cond ? "  OK    " : "  ÉCHEC "}${label}`);
};

function envoyer(api, paire, tx) {
  return new Promise((resolve, reject) =>
    tx.signAndSend(paire, ({ status, dispatchError }) => {
      if (dispatchError) reject(new Error(dispatchError.toString()));
      else if (status.isInBlock) resolve();
    }).catch(reject),
  );
}

async function texte(p, sel) {
  return p.$eval(sel, (e) => e.textContent.trim());
}

async function attendreTexte(p, sel, motif, delai = 120000) {
  await p.waitForFunction(
    (s, m) => new RegExp(m).test(document.querySelector(s)?.textContent || ""),
    { timeout: delai, polling: 500 },
    sel,
    motif,
  );
  return texte(p, sel);
}

(async () => {
  await cryptoWaitReady();
  const api = await ApiPromise.create({ provider: new WsProvider("ws://127.0.0.1:9945"), noInitWarn: true });
  const kr = new Keyring({ type: "ed25519", ss58Format: 4450 });
  const alice = kr.addFromUri("//Alice"); // Vérificateur de test
  const bob = kr.addFromUri("//Bob"); // Galli membre de test
  const intrus = new Keyring({ type: "sr25519", ss58Format: 4450 }).addFromUri(mnemonicGenerate());
  console.log(`Chaîne : ${await api.rpc.system.chain()}`);

  const nav = await puppeteer.launch({ args: ["--no-sandbox"] });
  const p = await nav.newPage();
  await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  p.on("pageerror", (e) => console.log("erreur de la page :", e.message));
  const capture = (nom) => p.screenshot({ path: `captures/essai-${nom}.png`, fullPage: true });

  console.log("\n1. Créer un compte");
  await p.goto(PAGE, { waitUntil: "networkidle2" });
  await p.waitForSelector("[data-ecran=bienvenue]:not([hidden])");
  await p.click("#creer-bienvenue");
  await p.waitForSelector("#mots li");
  const nbMots = await p.$$eval("#mots li", (l) => l.length);
  verifier(`la page propose ${nbMots} mots secrets`, nbMots === 12);
  await p.click("#mots-notes");
  await p.type("#nom-creer", "Galli d'essai");
  await p.type("#code-creer", CODE);
  await p.click("#form-creer button.ivoire");
  await p.waitForSelector("[data-ecran=accueil]:not([hidden])");
  const adresse = await p.evaluate(() => JSON.parse(localStorage.getItem("galliPay.comptes.v1"))[0].adresse);
  verifier(`compte créé : ${adresse}`, adresse.startsWith("g1"));
  await attendreTexte(p, "#statut", "non vérifié");
  verifier(`statut affiché avant KYC : « ${await texte(p, "#statut")} »`, true);

  console.log("\n2. Avant la vérification, le compte ne peut rien recevoir");
  let refuse = false;
  await envoyer(api, bob, api.tx.balances.transferKeepAlive(adresse, 500)).catch(() => (refuse = true));
  verifier("un virement vers le compte non vérifié est refusé", refuse);

  console.log("\n3. Le Vérificateur (KYC Titulus) crée l'identité ; le Galli la confirme dans Galli.Pay");
  await envoyer(api, alice, api.tx.identity.createIdentity(adresse));
  await p.reload({ waitUntil: "networkidle2" });
  await p.waitForSelector("#form-confirmer:not([hidden])", { timeout: 60000 });
  await capture("1-confirmer");
  await p.type("#pseudo", `Essai${Date.now() % 100000}`);
  await p.type("#code-confirmer", CODE);
  await p.click("#form-confirmer button.ivoire");
  const msgConfirmer = await attendreTexte(p, "#msg-confirmer", "Bienvenue|rreur|refus|incorrect", 180000);
  verifier(`confirmation : « ${msgConfirmer} »`, msgConfirmer.startsWith("Bienvenue"));
  await p.reload({ waitUntil: "networkidle2" });
  const statut = await attendreTexte(p, "#statut", "Galli membre", 60000);
  verifier(`statut : « ${statut} »`, statut.startsWith("Galli membre"));

  console.log("\n4. Attendre le pain quotidien (toutes les 10 minutes sur la chaîne de test) et le réclamer");
  const indexDepart = (await api.query.universalDividend.currentUdIndex()).toNumber();
  while ((await api.query.universalDividend.currentUdIndex()).toNumber() === indexDepart) await attendre(6000);
  await p.reload({ waitUntil: "networkidle2" });
  const pain = await attendreTexte(p, "#pain-detail", "^\\+", 60000);
  verifier(`pain à réclamer affiché : ${pain}`, /[1-9]/.test(pain));
  const soldeAvant = (await texte(p, "#solde-entier")) + (await texte(p, "#solde-cents"));
  await capture("2-pain");
  await p.click("#reclamer");
  await p.type("#code-reclamer", CODE);
  await p.click("#form-reclamer button.ivoire");
  const msgPain = await attendreTexte(p, "#msg-pain", "solde|rreur|refus|incorrect", 120000);
  verifier(`réclamation : « ${msgPain} »`, msgPain.includes("solde"));
  await attendreTexte(p, "#solde-entier", "[1-9]", 60000);
  const soldeApres = (await texte(p, "#solde-entier")) + (await texte(p, "#solde-cents"));
  verifier(`solde : ${soldeAvant} → ${soldeApres}`, soldeApres !== soldeAvant);

  console.log("\n5. Envoyer des Gallo");
  const envoi = async (dest, montant) => {
    await p.click("[data-onglet-bas=payer]");
    await p.waitForSelector("[data-ecran=payer]:not([hidden])");
    await p.click("[data-onglet=numero]");
    await p.$eval("#numero", (i) => (i.value = ""));
    await p.type("#numero", dest);
    await p.click("#form-numero button");
    const choix = await Promise.race([
      p.waitForSelector("#form-payer:not([hidden])", { timeout: 30000 }).then(() => null),
      attendreTexte(p, "#msg-payer-choix", "vérifié|invalide", 30000),
    ]);
    if (choix) return choix;
    await capture(`3-payer-${montant.replace(",", "-")}`);
    await p.type("#montant", montant);
    await p.type("#code-payer", CODE);
    await p.click("#form-payer button.ivoire");
    return attendreTexte(p, "#msg-payer", "payés|vérifié|rreur|refus|incorrect|insuffisant", 120000);
  };
  // Un Galli verse 5 Gallo au Galli d'essai (il garde ainsi plus que le minimum de 1 Gallo par compte).
  await envoyer(api, bob, api.tx.balances.transferKeepAlive(adresse, 500));
  const soldeBobAvant = (await api.query.system.account(bob.address)).data.free.toBigInt();
  const m1 = await envoi(bob.address, "0,50");
  verifier(`vers un Galli vérifié : « ${m1} »`, m1.includes("payés"));
  const soldeBobApres = (await api.query.system.account(bob.address)).data.free.toBigInt();
  verifier(`le Galli destinataire a reçu ${Number(soldeBobApres - soldeBobAvant) / 100} GALLO`, soldeBobApres - soldeBobAvant === 50n);
  const m2 = await envoi(intrus.address, "0,25");
  verifier(`vers un compte non vérifié : « ${m2} »`, m2.includes("vérifié"));
  verifier("le compte non vérifié n'a rien reçu", (await api.query.system.account(intrus.address)).data.free.toBigInt() === 0n);
  await capture("4-refus");
  await p.click("[data-onglet-bas=accueil]");
  await attendreTexte(p, "#solde-entier", "[0-9]");
  console.log(`  solde final du Galli d'essai : ${await texte(p, "#solde-entier")}${await texte(p, "#solde-cents")} Gallo`);

  console.log("\n6. Historique");
  await attendre(15000); // le temps que l'indexeur range les derniers blocs
  await p.click("[data-onglet-bas=accueil]");
  await p.waitForSelector("[data-ecran=accueil]:not([hidden])");
  await p.click('[data-ecran=accueil] [data-vers="historique"]');
  const histo = await attendreTexte(p, "#historique", "Pain quotidien", 60000);
  await capture("5-historique");
  verifier("l'historique s'affiche sans erreur", !histo.includes("indisponibles"));
  verifier("l'historique montre le pain quotidien reçu", histo.includes("Pain quotidien"));
  verifier("l'historique montre l'envoi au Galli vérifié", histo.includes("Envoyé"));

  console.log(`\nRÉSULTAT : ${ok ? "tout fonctionne" : "il y a des échecs"}`);
  await nav.close();
  await api.disconnect();
  process.exit(ok ? 0 : 1);
})().catch((e) => {
  console.error("ERREUR :", e.message);
  process.exit(1);
});
