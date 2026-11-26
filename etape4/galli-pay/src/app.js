// Galli Pay : portefeuille et tableau de la Gallia.
// Les clés ne quittent jamais le navigateur : elles y sont rangées chiffrées par le code secret du Galli.
// Bibliothèques libres utilisées : polkadot.js (Apache-2.0), qrcode (MIT).
import { ApiPromise, WsProvider } from "@polkadot/api";
import { Keyring } from "@polkadot/keyring";
import { u8aToHex } from "@polkadot/util";
import {
  cryptoWaitReady,
  decodeAddress,
  mnemonicGenerate,
  mnemonicToMiniSecret,
  mnemonicValidate,
} from "@polkadot/util-crypto";
import { english, french } from "@polkadot/util-crypto/mnemonic/wordlists";
import QRCode from "qrcode";

const SS58 = 4450;
const DEC = 2;
const STOCKAGE = "galliPay.comptes.v1";
const WS = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
const GRAPHQL = "/graphql";

const $ = (sel) => document.querySelector(sel);
const keyring = new Keyring({ type: "sr25519", ss58Format: SS58 });
let api;
let compte = null; // { nom, adresse, json }
let desabonner = null;

// ---------- utilitaires ----------

const gallo = (unites) =>
  `${(Number(unites) / 10 ** DEC).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} GALLO`;
const enUnites = (texte) => {
  const n = Number(String(texte).replace(",", ".").trim());
  if (!Number.isFinite(n) || n <= 0) throw new Error("Montant invalide.");
  return Math.round(n * 10 ** DEC);
};
const date = (iso) => new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
const court = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const echapper = (t) => String(t).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function message(zone, texte, type = "info") {
  const el = $(zone);
  el.textContent = texte;
  el.className = `message ${type}`;
  el.hidden = !texte;
}

function adresseValide(a) {
  try {
    decodeAddress(a, false, SS58);
    return a.startsWith("g1");
  } catch {
    return false;
  }
}

async function graphql(query, variables = {}) {
  const r = await fetch(GRAPHQL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const j = await r.json();
  if (j.errors) throw new Error(j.errors[0].message);
  return j.data;
}

// ---------- comptes rangés dans le navigateur ----------

const comptesRanges = () => {
  try {
    return JSON.parse(localStorage.getItem(STOCKAGE) || "[]");
  } catch {
    return [];
  }
};
const rangerComptes = (liste) => localStorage.setItem(STOCKAGE, JSON.stringify(liste));

function listeDeMots(phrase) {
  const mots = phrase.trim().toLowerCase().split(/\s+/);
  if (mots.every((m) => french.includes(m))) return french;
  if (mots.every((m) => english.includes(m))) return english;
  return null;
}

/** Paire de clés à partir des 12 mots (français ou anglais) et d'un chemin (ex. « //2 »). */
function paireDepuisMots(phrase, chemin = "") {
  const mots = phrase.trim().toLowerCase().split(/\s+/).join(" ");
  const liste = listeDeMots(mots);
  if (!liste || !mnemonicValidate(mots, liste)) throw new Error("Ces mots ne forment pas une phrase secrète valide.");
  const graine = u8aToHex(mnemonicToMiniSecret(mots, "", liste));
  return keyring.createFromUri(graine + chemin);
}

/** Retrouve le chemin d'un compte existant (les portefeuilles libres utilisent souvent //0, //1, //2…). */
function retrouverPaire(phrase, adresseAttendue) {
  const chemins = ["", ...Array.from({ length: 32 }, (_, i) => `//${i}`)];
  for (const c of chemins) {
    const p = paireDepuisMots(phrase, c);
    if (!adresseAttendue || p.address === adresseAttendue) return p;
  }
  throw new Error("Ces 12 mots ne correspondent pas à cette adresse.");
}

function enregistrerCompte(paire, nom, code) {
  if (code.length < 6) throw new Error("Le code secret doit faire au moins 6 caractères.");
  const json = paire.toJson(code);
  const liste = comptesRanges().filter((c) => c.adresse !== paire.address);
  liste.push({ nom: nom || "Mon compte", adresse: paire.address, json });
  rangerComptes(liste);
  return liste.at(-1);
}

function deverrouiller(code) {
  const paire = keyring.createFromJson(compte.json);
  try {
    paire.decodePkcs8(code);
  } catch {
    throw new Error("Code secret incorrect.");
  }
  return paire;
}

// ---------- lecture de la chaîne ----------

async function peutRecevoir(adresse) {
  if ((await api.query.wot.authorizedAccounts(adresse)).isSome) return true;
  const idx = await api.query.identity.identityIndexOf(adresse);
  if (idx.isNone) return false;
  const idty = await api.query.identity.identities(idx.unwrap());
  return idty.isSome && idty.unwrap().status.toString() !== "Revoked";
}

async function painAReclamer(adresse) {
  const idx = await api.query.identity.identityIndexOf(adresse);
  if (idx.isNone) return { membre: false, montant: 0n };
  const index = idx.unwrap().toNumber();
  const idty = (await api.query.identity.identities(idx.unwrap())).unwrap();
  const premier = idty.data.firstEligibleUd.toJSON();
  const statut = idty.status.toString();
  if (!premier) return { membre: statut === "Member", statut, index, montant: 0n };
  let courant = (await api.query.universalDividend.currentUdIndex()).toNumber();
  const reevals = (await api.query.universalDividend.pastReevals()).toJSON();
  let total = 0n;
  for (const [index, montant] of [...reevals].reverse()) {
    const debut = Math.max(index, premier);
    total += BigInt(Math.max(courant - debut, 0)) * BigInt(montant);
    courant = debut;
    if (index <= premier) break;
  }
  return { membre: statut === "Member", statut, index, montant: total };
}

function envoyer(paire, tx, zone) {
  return new Promise((resolve, reject) => {
    tx.signAndSend(paire, ({ status, dispatchError }) => {
      if (dispatchError) {
        let texte = dispatchError.toString();
        if (dispatchError.isModule) {
          const d = api.registry.findMetaError(dispatchError.asModule);
          texte = d.docs.join(" ") || d.name;
        }
        reject(new Error(texte));
      } else if (status.isInBlock) {
        message(zone, "Inscrit dans un bloc…", "info");
      } else if (status.isFinalized) {
        resolve();
      }
    }).catch((e) => reject(new Error(e.message.includes("1010") ? "Transaction refusée par la chaîne." : e.message)));
  });
}

// ---------- écrans ----------

function afficher(ecran) {
  for (const s of document.querySelectorAll("[data-ecran]")) s.hidden = s.dataset.ecran !== ecran;
  for (const b of document.querySelectorAll("nav [data-vers]")) b.classList.toggle("actif", b.dataset.vers === ecran);
  if (ecran === "portefeuille") ouvrirPortefeuille();
  if (ecran === "chiffres") chargerChiffres();
}

function ouvrirPortefeuille() {
  const liste = comptesRanges();
  if (!compte && liste.length) compte = liste[0];
  $("#sans-compte").hidden = !!compte;
  $("#avec-compte").hidden = !compte;
  if (compte) chargerCompte();
}

async function chargerCompte() {
  const choix = $("#choix-compte");
  choix.innerHTML = comptesRanges()
    .map((c) => `<option value="${c.adresse}" ${c.adresse === compte.adresse ? "selected" : ""}>${echapper(c.nom)} · ${court(c.adresse)}</option>`)
    .join("");
  $("#mon-adresse").textContent = compte.adresse;
  $("#qr").src = await QRCode.toDataURL(compte.adresse, { margin: 1, width: 220, color: { dark: "#0D0E1B", light: "#F6F0E4" } });
  if (desabonner) desabonner();
  desabonner = await api.query.system.account(compte.adresse, async (a) => {
    $("#solde").textContent = gallo(a.data.free.toBigInt());
    const p = await painAReclamer(compte.adresse);
    $("#pain").textContent = gallo(p.montant);
    $("#statut").textContent = p.membre ? "Galli membre" : p.statut ? `Identité : ${p.statut}` : "Compte non vérifié";
    $("#reclamer").disabled = p.montant === 0n;
    $("#form-confirmer").hidden = !["Unconfirmed", "Unvalidated"].includes(p.statut);
    $("#form-confirmer").dataset.index = p.index ?? "";
    $("#form-confirmer").dataset.statut = p.statut ?? "";
  });
  chargerHistorique();
}

async function chargerHistorique() {
  const zone = $("#historique");
  try {
    const d = await graphql(
      `query($a: String!) {
        transfers(first: 30, orderBy: BLOCK_NUMBER_DESC,
          filter: { or: [{ fromId: { equalTo: $a } }, { toId: { equalTo: $a } }] }) {
          nodes { timestamp amount fromId toId }
        }
        udHistories(first: 30, orderBy: BLOCK_NUMBER_DESC,
          filter: { identity: { accountId: { equalTo: $a } } }) {
          nodes { timestamp amount }
        }
      }`,
      { a: compte.adresse },
    );
    const lignes = d.transfers.nodes.map((t) => ({
      quand: t.timestamp,
      texte: t.toId === compte.adresse ? `Reçu de ${court(t.fromId)}` : `Envoyé à ${court(t.toId)}`,
      montant: t.toId === compte.adresse ? BigInt(t.amount) : -BigInt(t.amount),
    }));
    for (const u of d.udHistories.nodes)
      lignes.push({ quand: u.timestamp, texte: "Pain quotidien", montant: BigInt(u.amount) });
    lignes.sort((a, b) => new Date(b.quand) - new Date(a.quand));
    zone.innerHTML = lignes.length
      ? lignes
          .slice(0, 30)
          .map((l) => `<li><span>${date(l.quand)}</span><span>${l.texte}</span><b class="${l.montant < 0n ? "moins" : "plus"}">${l.montant < 0n ? "−" : "+"} ${gallo(l.montant < 0n ? -l.montant : l.montant)}</b></li>`)
          .join("")
      : `<li class="vide">Aucun mouvement pour l'instant.</li>`;
  } catch (e) {
    zone.innerHTML = `<li class="vide">Historique indisponible (${echapper(e.message)}).</li>`;
  }
}

async function chargerChiffres() {
  const [membres, masse, ud, prochain, debutJour] = await Promise.all([
    api.query.membership.counterForMembership(),
    api.query.universalDividend.monetaryMass(),
    api.query.universalDividend.currentUd(),
    api.query.universalDividend.nextUd(),
    Promise.resolve(new Date(new Date().setHours(0, 0, 0, 0)).toISOString()),
  ]);
  $("#c-gallis").textContent = membres.toNumber().toLocaleString("fr-FR");
  $("#c-masse").textContent = gallo(masse.toBigInt());
  $("#c-pain").textContent = gallo(ud.toBigInt());
  $("#c-prochain").textContent = prochain.isSome ? date(Number(prochain.unwrap())) : "—";
  try {
    const d = await graphql(
      `query($t: Datetime!) {
        universalDividends(filter: { timestamp: { greaterThanOrEqualTo: $t } }) { nodes { amount membersCount } }
        transfers(first: 10, orderBy: BLOCK_NUMBER_DESC) { nodes { timestamp amount fromId toId } }
      }`,
      { t: debutJour },
    );
    const pain = d.universalDividends.nodes.reduce((s, u) => s + BigInt(u.amount) * BigInt(u.membersCount), 0n);
    const merite = (pain * 3n) / 7n; // part du Trésor du mérite : 3/7 du pain créé
    $("#c-jour").textContent = gallo(pain + merite);
    $("#c-jour-detail").textContent = `pain ${gallo(pain)} · mérite ${gallo(merite)}`;
    $("#derniers").innerHTML = d.transfers.nodes.length
      ? d.transfers.nodes
          .map((t) => `<li><span>${date(t.timestamp)}</span><span>${court(t.fromId)} → ${court(t.toId)}</span><b>${gallo(t.amount)}</b></li>`)
          .join("")
      : `<li class="vide">Aucun virement pour l'instant.</li>`;
  } catch (e) {
    $("#c-jour").textContent = "—";
    $("#derniers").innerHTML = `<li class="vide">Indisponible (${echapper(e.message)}).</li>`;
  }
}

async function chercherCompte(e) {
  e.preventDefault();
  const a = $("#recherche").value.trim();
  const zone = $("#resultat-recherche");
  if (!adresseValide(a)) return (zone.innerHTML = `<p class="message erreur">Adresse invalide.</p>`);
  const [compteChaine, p, ok] = await Promise.all([api.query.system.account(a), painAReclamer(a), peutRecevoir(a)]);
  zone.innerHTML = `<p><b>${gallo(compteChaine.data.free.toBigInt())}</b> · ${
    p.membre ? "Galli membre" : ok ? "compte vérifié" : "compte non vérifié"
  } · pain à réclamer ${gallo(p.montant)}</p>`;
}

// ---------- actions ----------

function brancher() {
  for (const b of document.querySelectorAll("[data-vers]")) b.addEventListener("click", () => afficher(b.dataset.vers));

  $("#creer").addEventListener("click", () => {
    const mots = mnemonicGenerate(12, french);
    $("#mots").innerHTML = mots.split(" ").map((m, i) => `<li><small>${i + 1}</small>${m}</li>`).join("");
    $("#form-creer").dataset.mots = mots;
    afficher("creer");
  });

  $("#form-creer").addEventListener("submit", (e) => {
    e.preventDefault();
    try {
      if (!$("#mots-notes").checked) throw new Error("Note d'abord tes 12 mots sur papier.");
      const paire = paireDepuisMots(e.target.dataset.mots);
      compte = enregistrerCompte(paire, $("#nom-creer").value, $("#code-creer").value);
      e.target.reset();
      delete e.target.dataset.mots;
      $("#mots").innerHTML = "";
      afficher("portefeuille");
    } catch (err) {
      message("#msg-creer", err.message, "erreur");
    }
  });

  $("#form-importer").addEventListener("submit", (e) => {
    e.preventDefault();
    try {
      const attendue = $("#adresse-importer").value.trim();
      if (attendue && !adresseValide(attendue)) throw new Error("Adresse invalide.");
      const paire = retrouverPaire($("#mots-importer").value, attendue || null);
      compte = enregistrerCompte(paire, $("#nom-importer").value, $("#code-importer").value);
      e.target.reset();
      afficher("portefeuille");
    } catch (err) {
      message("#msg-importer", err.message, "erreur");
    }
  });

  $("#choix-compte").addEventListener("change", (e) => {
    compte = comptesRanges().find((c) => c.adresse === e.target.value);
    chargerCompte();
  });

  $("#copier").addEventListener("click", async () => {
    await navigator.clipboard.writeText(compte.adresse);
    message("#msg-recevoir", "Adresse copiée.", "ok");
  });

  $("#reclamer").addEventListener("click", async () => {
    const code = prompt("Ton code secret Galli Pay :");
    if (!code) return;
    try {
      const paire = deverrouiller(code);
      message("#msg-pain", "Réclamation en cours…", "info");
      await envoyer(paire, api.tx.universalDividend.claimUds(), "#msg-pain");
      message("#msg-pain", "Ton pain quotidien est sur ton solde.", "ok");
      chargerHistorique();
    } catch (err) {
      message("#msg-pain", err.message, "erreur");
    }
  });

  $("#form-confirmer").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const paire = deverrouiller($("#code-confirmer").value);
      if (e.target.dataset.statut === "Unconfirmed") {
        message("#msg-confirmer", "Confirmation de ton identité…", "info");
        await envoyer(paire, api.tx.identity.confirmIdentity($("#pseudo").value.trim()), "#msg-confirmer");
      }
      message("#msg-confirmer", "Entrée dans la Gallia…", "info");
      await envoyer(paire, api.tx.wot.claimMembership(Number(e.target.dataset.index)), "#msg-confirmer");
      message("#msg-confirmer", "Bienvenue dans la Gallia : tu es Galli membre.", "ok");
      e.target.reset();
    } catch (err) {
      message("#msg-confirmer", err.message, "erreur");
    }
  });

  $("#form-envoyer").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const dest = $("#dest").value.trim();
      if (!adresseValide(dest)) throw new Error("Adresse du destinataire invalide.");
      if (dest === compte.adresse) throw new Error("C'est ton propre compte.");
      const montant = enUnites($("#montant").value);
      if (!(await peutRecevoir(dest)))
        throw new Error("Ce compte n'est pas celui d'un Galli vérifié par la Titulus : il ne peut pas recevoir de Gallo.");
      const paire = deverrouiller($("#code-envoyer").value);
      message("#msg-envoyer", "Envoi en cours…", "info");
      await envoyer(paire, api.tx.balances.transferKeepAlive(dest, montant), "#msg-envoyer");
      message("#msg-envoyer", `${gallo(montant)} envoyés.`, "ok");
      e.target.reset();
      chargerHistorique();
    } catch (err) {
      message("#msg-envoyer", err.message, "erreur");
    }
  });

  $("#oublier").addEventListener("click", () => {
    if (!confirm("Retirer ce compte de ce navigateur ? Sans tes 12 mots, il serait perdu.")) return;
    rangerComptes(comptesRanges().filter((c) => c.adresse !== compte.adresse));
    compte = null;
    afficher("portefeuille");
  });

  $("#form-recherche").addEventListener("submit", chercherCompte);
}

async function demarrer() {
  brancher();
  await cryptoWaitReady();
  message("#etat", "Connexion à la chaîne Gallia…", "info");
  api = await ApiPromise.create({ provider: new WsProvider(WS), noInitWarn: true });
  const nom = (await api.rpc.system.chain()).toString();
  message("#etat", "", "info");
  $("#chaine").textContent = nom;
  afficher(location.hash === "#chiffres" ? "chiffres" : "portefeuille");
}

demarrer().catch((e) => message("#etat", `Impossible de joindre la chaîne : ${e.message}`, "erreur"));
