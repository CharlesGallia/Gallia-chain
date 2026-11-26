// Galli.Pay : portefeuille et tableau de la Gallia (interface d'après les maquettes Accueil / Services / Payer).
// Les clés ne quittent jamais le téléphone : elles y sont rangées chiffrées par le code secret du Galli.
// Bibliothèques libres utilisées : polkadot.js (Apache-2.0), qrcode (MIT), jsQR (Apache-2.0).
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
import jsQR from "jsqr";

const SS58 = 4450;
const DEC = 2;
const STOCKAGE = "galliPay.comptes.v1";
const WS = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
const GRAPHQL = "/graphql";

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const keyring = new Keyring({ type: "sr25519", ss58Format: SS58 });
let api;
let compte = null; // { nom, adresse, json }
let desabonner = null;
let destinataire = null; // { adresse, nom }
let flux = null; // caméra

// ---------- utilitaires ----------

const fmt = (unites) =>
  (Number(unites) / 10 ** DEC).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const gallo = (unites) => `${fmt(unites)} Gallo`;
const enUnites = (texte) => {
  const n = Number(String(texte).replace(",", ".").trim());
  if (!Number.isFinite(n) || n <= 0) throw new Error("Montant invalide.");
  return Math.round(n * 10 ** DEC);
};
const quand = (iso) => {
  const d = new Date(iso);
  const auj = new Date();
  const hier = new Date(Date.now() - 864e5);
  const h = d.toLocaleTimeString("fr-FR", { hour: "numeric", minute: "2-digit" }).replace(":", " h ");
  if (d.toDateString() === auj.toDateString()) return `Aujourd'hui · ${h}`;
  if (d.toDateString() === hier.toDateString()) return `Hier · ${h}`;
  return `${d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })} · ${h}`;
};
const date = (ms) => new Date(ms).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
const court = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const echapper = (t) => String(t).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const initiales = (nom) =>
  (nom || "?").replace(/[^\p{L}\p{N} _-]/gu, "").split(/[\s_-]+/).filter(Boolean).slice(0, 2).map((m) => m[0]).join("").toUpperCase() || "G";

function message(zone, texte, type = "info") {
  const el = $(zone);
  if (!el) return;
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
  const r = await fetch(GRAPHQL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query, variables }) });
  const j = await r.json();
  if (j.errors) throw new Error(j.errors[0].message);
  return j.data;
}

// ---------- comptes rangés dans le téléphone ----------

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
  return keyring.createFromUri(u8aToHex(mnemonicToMiniSecret(mots, "", liste)) + chemin);
}

/** Retrouve le chemin d'un compte existant (les portefeuilles libres utilisent souvent //0, //1, //2…). */
function retrouverPaire(phrase, adresseAttendue) {
  for (const c of ["", ...Array.from({ length: 32 }, (_, i) => `//${i}`)]) {
    const p = paireDepuisMots(phrase, c);
    if (!adresseAttendue || p.address === adresseAttendue) return p;
  }
  throw new Error("Ces 12 mots ne correspondent pas à cette adresse.");
}

function enregistrerCompte(paire, nom, code) {
  if (code.length < 6) throw new Error("Le code secret doit faire au moins 6 caractères.");
  const liste = comptesRanges().filter((c) => c.adresse !== paire.address);
  liste.push({ nom: nom || "Mon compte", adresse: paire.address, json: paire.toJson(code) });
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

async function identiteDe(adresse) {
  const idx = await api.query.identity.identityIndexOf(adresse);
  if (idx.isNone) return null;
  const idty = await api.query.identity.identities(idx.unwrap());
  return idty.isSome ? { index: idx.unwrap().toNumber(), valeur: idty.unwrap() } : null;
}

async function peutRecevoir(adresse) {
  if ((await api.query.wot.authorizedAccounts(adresse)).isSome) return true;
  const id = await identiteDe(adresse);
  return !!id && id.valeur.status.toString() !== "Revoked";
}

async function painAReclamer(adresse) {
  const id = await identiteDe(adresse);
  if (!id) return { membre: false, montant: 0n };
  const statut = id.valeur.status.toString();
  const premier = id.valeur.data.firstEligibleUd.toJSON();
  const base = { membre: statut === "Member", statut, index: id.index };
  if (!premier) return { ...base, montant: 0n };
  let courant = (await api.query.universalDividend.currentUdIndex()).toNumber();
  const reevals = (await api.query.universalDividend.pastReevals()).toJSON();
  let total = 0n;
  for (const [index, montant] of [...reevals].reverse()) {
    const debut = Math.max(index, premier);
    total += BigInt(Math.max(courant - debut, 0)) * BigInt(montant);
    courant = debut;
    if (index <= premier) break;
  }
  return { ...base, montant: total };
}

function envoyer(paire, tx, zone) {
  return new Promise((resolve, reject) => {
    tx.signAndSend(paire, ({ status, dispatchError }) => {
      if (dispatchError) {
        let texte = dispatchError.toString();
        if (dispatchError.isModule) {
          const d = api.registry.findMetaError(dispatchError.asModule);
          texte = d.docs.join(" ") || d.name;
        } else if (dispatchError.isToken || dispatchError.isArithmetic) {
          texte = "Solde insuffisant : il doit toujours rester au moins 1,00 Gallo sur ton compte.";
        }
        reject(new Error(texte));
      } else if (status.isInBlock) {
        message(zone, "Inscrit dans un bloc…", "info");
      } else if (status.isFinalized) {
        resolve();
      }
    }).catch((e) =>
      reject(
        new Error(
          /pay some fees|balance too low/i.test(e.message)
            ? "Solde insuffisant pour cette opération."
            : e.message.includes("1010")
              ? "Transaction refusée par la chaîne."
              : e.message,
        ),
      ),
    );
  });
}

// ---------- navigation ----------

const ECRANS_SANS_COMPTE = ["bienvenue", "creer", "importer", "chiffres", "bientot"];
const ONGLET_DE = { accueil: "accueil", historique: "accueil", recevoir: "accueil", comptes: "profil", chiffres: "accueil", services: "services", bientot: "services", payer: "payer", profil: "profil" };

function afficher(ecran) {
  if (!compte && !ECRANS_SANS_COMPTE.includes(ecran)) ecran = "bienvenue";
  for (const s of $$("[data-ecran]")) s.hidden = s.dataset.ecran !== ecran;
  const onglet = ecran === "bientot" && $("#bientot-service").textContent === "RUCHE" ? "ruche" : ONGLET_DE[ecran];
  for (const b of $$("[data-onglet-bas]")) b.classList.toggle("actif", b.dataset.ongletBas === onglet);
  $(".barre").hidden = ["bienvenue", "creer", "importer"].includes(ecran) && !compte;
  if (ecran !== "payer") arreterCamera();
  if (history.replaceState) history.replaceState(null, "", `#${ecran}`);
  window.scrollTo(0, 0);
  if (ecran === "accueil") chargerAccueil();
  if (ecran === "historique") chargerHistorique("#historique", 50);
  if (ecran === "chiffres") chargerChiffres();
  if (ecran === "payer") ouvrirPayer();
  if (ecran === "recevoir") chargerRecevoir();
  if (ecran === "profil") chargerProfil();
  if (ecran === "comptes") chargerComptes();
}

function bientot(service, detail) {
  $("#bientot-service").textContent = service.toUpperCase();
  $("#bientot-detail").textContent = detail || "Ce service se prépare. Il arrivera dans Galli.Pay, tout en Gallo.";
  afficher("bientot");
}

// ---------- accueil ----------

async function chargerAccueil() {
  $("#initiales").textContent = initiales(compte.nom);
  if (desabonner) desabonner();
  desabonner = await api.query.system.account(compte.adresse, async (a) => {
    const [entier, cents] = fmt(a.data.free.toBigInt()).split(",");
    $("#solde-entier").textContent = entier;
    $("#solde-cents").textContent = `,${cents}`;
    const [p, ud, prochain] = await Promise.all([
      painAReclamer(compte.adresse),
      api.query.universalDividend.currentUd(),
      api.query.universalDividend.nextUd(),
    ]);
    $("#statut").textContent = p.membre
      ? `Galli membre · pain quotidien ${gallo(ud.toBigInt())}`
      : p.statut === "Unconfirmed" || p.statut === "Unvalidated"
        ? "Identité vérifiée : confirme-la ci-dessous"
        : p.statut
          ? `Identité : ${p.statut}`
          : "Compte non vérifié par la Titulus";
    const aReclamer = p.montant > 0n;
    $("#pain-titre").textContent = aReclamer ? "Ton pain quotidien est arrivé" : "Pain quotidien";
    $("#pain-detail").textContent = aReclamer
      ? `+${gallo(p.montant)} · créé par la Gallibra`
      : p.membre
        ? `Prochain pain le ${prochain.isSome ? date(Number(prochain.unwrap())) : "—"}`
        : "Réservé aux Gallis membres";
    $("#reclamer").hidden = !aReclamer;
    $("#form-confirmer").hidden = !["Unconfirmed", "Unvalidated"].includes(p.statut);
    $("#form-confirmer").dataset.index = p.index ?? "";
    $("#form-confirmer").dataset.statut = p.statut ?? "";
  });
  chargerHistorique("#mouvements", 3);
}

async function mouvementsDe(adresse, n) {
  const d = await graphql(
    `query($a: String!, $n: Int!) {
      transfers(first: $n, orderBy: BLOCK_NUMBER_DESC, filter: { or: [{ fromId: { equalTo: $a } }, { toId: { equalTo: $a } }] }) {
        nodes { timestamp amount fromId toId from { identity { name } } to { identity { name } } }
      }
      identities(filter: { accountId: { equalTo: $a } }) {
        nodes { udHistory(first: $n) { nodes { timestamp amount } } }
      }
    }`,
    { a: adresse, n },
  );
  const lignes = d.transfers.nodes.map((t) => {
    const recu = t.toId === adresse;
    const autre = recu ? t.fromId : t.toId;
    const nom = (recu ? t.from : t.to)?.identity?.name;
    return { quand: t.timestamp, nom: nom || court(autre), adresse: autre, detail: recu ? "Reçu" : "Envoyé", montant: recu ? BigInt(t.amount) : -BigInt(t.amount) };
  });
  for (const u of d.identities.nodes[0]?.udHistory.nodes ?? [])
    lignes.push({ quand: u.timestamp, nom: "Pain quotidien", detail: "Gallibra", montant: BigInt(u.amount), pain: true });
  return lignes.sort((a, b) => new Date(b.quand) - new Date(a.quand)).slice(0, n);
}

async function chargerHistorique(zone, n) {
  try {
    const lignes = await mouvementsDe(compte.adresse, n);
    $(zone).innerHTML = lignes.length
      ? lignes
          .map(
            (l) => `<li>
              <span class="initiales">${l.pain ? `<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 13c0-4 3-7 7-7s7 3 7 7v3H5z M5 16h14"/></svg>` : echapper(initiales(l.nom))}</span>
              <div class="quoi"><div class="nom">${echapper(l.nom)}</div><div class="quand">${quand(l.quand)} · ${l.detail}</div></div>
              <div class="montant ${l.montant > 0n ? "plus" : ""}">${l.montant > 0n ? "+" : "−"}${fmt(l.montant > 0n ? l.montant : -l.montant)}</div>
            </li>`,
          )
          .join("")
      : `<li class="vide">Aucun mouvement pour l'instant.</li>`;
  } catch (e) {
    $(zone).innerHTML = `<li class="vide">Mouvements indisponibles pour le moment.</li>`;
    console.warn(e);
  }
}

// ---------- services ----------

const ICONES = {
  Troc: "M7 7h12l-3-3M17 17H5l3 3", Shop: "M6 8h12l-1 12H7L6 8zM9 8a3 3 0 0 1 6 0",
  Exchange: "M4 12a8 8 0 0 1 14-5l2 2M20 4v5h-5M20 12a8 8 0 0 1-14 5l-2-2M4 20v-5h5",
  Map: "M12 21s-6-6-6-11a6 6 0 0 1 12 0c0 5-6 11-6 11zM12 8a2 2 0 1 1 0 4 2 2 0 0 1 0-4z",
  Food: "M4 12h16a8 8 0 0 1-16 0zM9 4c0 2 2 2 2 4M14 4c0 2 2 2 2 4", Drive: "M5 15l1.5-5h11L19 15M4 15h16v4H4zM7 19v1M17 19v1",
  Car: "M14 9a4 4 0 1 1-4-4 4 4 0 0 1 4 4zM13 12l7 7M17 16l2-2", Loc: "M4 11l8-7 8 7M6 10v10h12V10M10 20v-5h4v5",
  Hair: "M8 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM8 18a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM7.5 7.5L20 18M7.5 16.5L20 6",
  Soin: "M12 20s-7-4.5-7-10a4 4 0 0 1 7-2 4 4 0 0 1 7 2c0 5.5-7 10-7 10z", Bat: "M3 20h18M5 20V10l7-5 7 5v10M9 20v-5h6v5",
  Repair: "M15 4a4 4 0 0 0-4 5l-7 7 3 3 7-7a4 4 0 0 0 5-4l-2 2-3-1-1-3z", Job: "M4 8h16v11H4zM9 8V5h6v3M4 13h16", Task: "M5 12l4 4 10-10",
  Sphere: "M12 4a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM5 14a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM19 14a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM10 9l-3 6M14 9l3 6M8 17h8",
  LINK: "M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1", Mail: "M3 6h18v12H3zM3 6l9 7 9-7",
  Mobile: "M7 3h10v18H7zM11 18h2", WEB: "M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18",
  BRARY: "M4 5h6a2 2 0 0 1 2 2v13a2 2 0 0 0-2-2H4zM20 5h-6a2 2 0 0 0-2 2v13a2 2 0 0 1 2-2h6z",
  Neapolio: "M8 4l4 2 4-2 4 4-3 2v10H7V10L4 8z", Vota: "M5 10h14v10H5zM9 10V5h6v5M7 15h10",
};
const SEULS = { LINK: "GALLINK", Vota: "Vota Publica", Neapolio: "Neapolio" };
const GROUPES = [
  ["Échanger et trouver", ["Troc", "Shop", "Exchange", "Map"]],
  ["Au quotidien", ["Food", "Drive", "Car", "Loc"]],
  ["Prendre soin et réparer", ["Hair", "Soin", "Bat", "Repair"]],
  ["Travailler", ["Job", "Task", "Sphere"]],
  ["Se connecter", ["LINK", "Mail", "Mobile", "WEB"]],
  ["Savoir et appartenance", ["BRARY", "Neapolio", "Vota"]],
];
const nomService = (n) => (SEULS[n] ? SEULS[n] : `Galli.${n}`);

function dessinerServices(filtre = "") {
  const f = filtre.trim().toLowerCase();
  $("#groupes").innerHTML = GROUPES.map(([titre, noms]) => {
    const vus = noms.filter((n) => !f || nomService(n).toLowerCase().includes(f) || titre.toLowerCase().includes(f));
    if (!vus.length) return "";
    return `<section class="carte groupe"><h2>${titre}</h2><div class="grille-services">${vus
      .map(
        (n) => `<button class="service" data-bientot="${nomService(n)}" aria-label="${nomService(n)}">
          <span class="v"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="${ICONES[n]}"/></svg></span>
          <span class="pre">${SEULS[n] ? "&nbsp;" : "Galli."}</span><span class="nom">${SEULS[n] || n}</span></button>`,
      )
      .join("")}</div></section>`;
  }).join("") || `<p class="doux">Aucun service ne correspond.</p>`;
}

// ---------- payer ----------

function choisirOnglet(nom) {
  for (const b of $$("[data-onglet]")) b.setAttribute("aria-selected", String(b.dataset.onglet === nom));
  for (const p of $$("[data-panneau]")) p.hidden = p.dataset.panneau !== nom;
  if (nom !== "qr") arreterCamera();
}

async function ouvrirPayer() {
  message("#msg-payer", "");
  message("#msg-payer-choix", "");
  try {
    const lignes = (await mouvementsDe(compte.adresse, 30)).filter((l) => l.adresse);
    const vus = new Map();
    for (const l of lignes) if (!vus.has(l.adresse)) vus.set(l.adresse, l.nom);
    const recents = [...vus].slice(0, 4);
    $("#recents").innerHTML = recents.length
      ? recents
          .map(([a, nom]) => `<button data-payer-a="${a}" data-payer-nom="${echapper(nom)}"><span class="initiales">${echapper(initiales(nom))}</span><span>${echapper(nom)}</span></button>`)
          .join("")
      : `<p class="vide">Les Gallis que tu paies apparaîtront ici.</p>`;
  } catch {
    $("#recents").innerHTML = "";
  }
}

async function nomDe(adresse) {
  try {
    const d = await graphql(`query($a: String!) { identities(filter: { accountId: { equalTo: $a } }) { nodes { name } } }`, { a: adresse });
    return d.identities.nodes[0]?.name || null;
  } catch {
    return null;
  }
}

async function choisirDestinataire(adresse, nom, zone = "#msg-payer-choix") {
  message(zone, "");
  adresse = adresse.trim();
  if (!adresseValide(adresse)) return message(zone, "Adresse invalide.", "erreur");
  if (adresse === compte.adresse) return message(zone, "C'est ton propre compte.", "erreur");
  if (!(await peutRecevoir(adresse)))
    return message(zone, "Ce compte n'est pas celui d'un Galli vérifié par la Titulus : il ne peut pas recevoir de Gallo.", "erreur");
  destinataire = { adresse, nom: nom || (await nomDe(adresse)) || court(adresse) };
  arreterCamera();
  $("#dest-ini").textContent = initiales(destinataire.nom);
  $("#dest-nom").textContent = destinataire.nom;
  $("#form-payer").hidden = false;
  $("#montant").focus();
  $("#form-payer").scrollIntoView({ behavior: "smooth", block: "center" });
}

async function ouvrirCamera() {
  const video = $("#camera");
  try {
    flux = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
  } catch {
    return message("#msg-payer-choix", "Caméra indisponible. Utilise l'onglet Numéro ou Annuaire.", "erreur");
  }
  video.srcObject = flux;
  video.hidden = false;
  $("#ouvrir-camera").hidden = true;
  await video.play();
  const toile = document.createElement("canvas");
  const ctx = toile.getContext("2d", { willReadFrequently: true });
  const lire = () => {
    if (!flux) return;
    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      toile.width = video.videoWidth;
      toile.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);
      const code = jsQR(ctx.getImageData(0, 0, toile.width, toile.height).data, toile.width, toile.height);
      const adresse = code?.data.match(/g1[1-9A-HJ-NP-Za-km-z]{40,}/)?.[0];
      if (adresse) return choisirDestinataire(adresse);
    }
    requestAnimationFrame(lire);
  };
  lire();
}

function arreterCamera() {
  if (flux) for (const t of flux.getTracks()) t.stop();
  flux = null;
  const video = $("#camera");
  if (video) {
    video.hidden = true;
    video.srcObject = null;
  }
  const b = $("#ouvrir-camera");
  if (b) b.hidden = false;
}

let minuterieAnnuaire;
function chercherAnnuaire(q) {
  clearTimeout(minuterieAnnuaire);
  minuterieAnnuaire = setTimeout(async () => {
    if (q.trim().length < 2) return ($("#resultats-annuaire").innerHTML = "");
    try {
      const d = await graphql(
        `query($q: String!) { identities(first: 8, filter: { name: { includesInsensitive: $q }, status: { equalTo: \"Member\" } }) { nodes { name accountId } } }`,
        { q: q.trim() },
      );
      $("#resultats-annuaire").innerHTML = d.identities.nodes.length
        ? d.identities.nodes
            .map((i) => `<li><button class="ligne" data-payer-a="${i.accountId}" data-payer-nom="${echapper(i.name)}"><span class="initiales">${echapper(initiales(i.name))}</span><span class="quoi"><span class="nom">${echapper(i.name)}</span><span class="quand">${court(i.accountId)}</span></span></button></li>`)
            .join("")
        : `<li class="vide">Aucun Galli à ce nom.</li>`;
    } catch {
      $("#resultats-annuaire").innerHTML = `<li class="vide">Annuaire indisponible pour le moment.</li>`;
    }
  }, 250);
}

// ---------- recevoir, profil, comptes, chiffres ----------

async function chargerRecevoir() {
  $("#mon-adresse").textContent = compte.adresse;
  $("#qr").src = await QRCode.toDataURL(compte.adresse, { margin: 1, width: 440, color: { dark: "#0D0E1B", light: "#F6F0E4" } });
}

async function chargerProfil() {
  $("#profil-nom").textContent = compte.nom;
  $("#profil-adresse").textContent = compte.adresse;
  $("#confirmer-oubli").hidden = true;
  const p = await painAReclamer(compte.adresse);
  $("#profil-statut").textContent = p.membre ? "Galli membre, vérifié par la Titulus" : p.statut ? `Identité : ${p.statut}` : "Compte non vérifié par la Titulus";
}

function chargerComptes() {
  $("#liste-comptes").innerHTML = comptesRanges()
    .map(
      (c) => `<li><button data-compte="${c.adresse}"><span class="initiales">${echapper(initiales(c.nom))}</span><span class="quoi"><span class="nom">${echapper(c.nom)}</span><br><span class="adresse">${court(c.adresse)}</span></span></button>${
        c.adresse === compte?.adresse ? `<span class="actif">ACTIF</span>` : ""
      }</li>`,
    )
    .join("");
}

async function chargerChiffres() {
  const [membres, masse, ud, prochain] = await Promise.all([
    api.query.membership.counterForMembership(),
    api.query.universalDividend.monetaryMass(),
    api.query.universalDividend.currentUd(),
    api.query.universalDividend.nextUd(),
  ]);
  $("#c-gallis").textContent = membres.toNumber().toLocaleString("fr-FR");
  $("#c-masse").textContent = gallo(masse.toBigInt());
  $("#c-pain").textContent = gallo(ud.toBigInt());
  $("#c-prochain").textContent = prochain.isSome ? date(Number(prochain.unwrap())) : "—";
  try {
    const d = await graphql(
      `query($t: Datetime!) {
        universalDividends(filter: { timestamp: { greaterThanOrEqualTo: $t } }) { nodes { amount membersCount } }
        transfers(first: 10, orderBy: BLOCK_NUMBER_DESC) { nodes { timestamp amount fromId toId from { identity { name } } to { identity { name } } } }
      }`,
      { t: new Date(new Date().setHours(0, 0, 0, 0)).toISOString() },
    );
    const pain = d.universalDividends.nodes.reduce((s, u) => s + BigInt(u.amount) * BigInt(u.membersCount), 0n);
    const merite = (pain * 3n) / 7n; // part du Trésor du mérite : 3/7 du pain créé
    $("#c-jour").textContent = gallo(pain + merite);
    $("#c-jour-detail").textContent = `pain ${fmt(pain)} · mérite ${fmt(merite)}`;
    $("#derniers").innerHTML = d.transfers.nodes.length
      ? d.transfers.nodes
          .map((t) => `<li><div class="quoi"><div class="nom">${echapper(t.from?.identity?.name || court(t.fromId))} → ${echapper(t.to?.identity?.name || court(t.toId))}</div><div class="quand">${quand(t.timestamp)}</div></div><div class="montant">${fmt(t.amount)}</div></li>`)
          .join("")
      : `<li class="vide">Aucun virement pour l'instant.</li>`;
  } catch {
    $("#c-jour").textContent = "—";
    $("#derniers").innerHTML = `<li class="vide">Indisponible pour le moment.</li>`;
  }
}

// ---------- actions ----------

function nouveauxMots() {
  const mots = mnemonicGenerate(12, french);
  $("#mots").innerHTML = mots.split(" ").map((m, i) => `<li><small>${i + 1}</small>${m}</li>`).join("");
  $("#form-creer").dataset.mots = mots;
  afficher("creer");
}

function brancher() {
  document.addEventListener("click", (e) => {
    const vers = e.target.closest("[data-vers]");
    if (vers) return afficher(vers.dataset.vers);
    const b = e.target.closest("[data-bientot]");
    if (b) return bientot(b.dataset.bientot, b.dataset.detail);
    const payerA = e.target.closest("[data-payer-a]");
    if (payerA) return choisirDestinataire(payerA.dataset.payerA, payerA.dataset.payerNom);
    const c = e.target.closest("[data-compte]");
    if (c) {
      compte = comptesRanges().find((x) => x.adresse === c.dataset.compte);
      return afficher("accueil");
    }
    const o = e.target.closest("[data-onglet]");
    if (o) return choisirOnglet(o.dataset.onglet);
  });

  $("#creer").addEventListener("click", nouveauxMots);
  $("#creer-bienvenue").addEventListener("click", nouveauxMots);

  $("#form-creer").addEventListener("submit", (e) => {
    e.preventDefault();
    try {
      if (!$("#mots-notes").checked) throw new Error("Note d'abord tes 12 mots sur papier.");
      compte = enregistrerCompte(paireDepuisMots(e.target.dataset.mots), $("#nom-creer").value, $("#code-creer").value);
      e.target.reset();
      delete e.target.dataset.mots;
      $("#mots").innerHTML = "";
      afficher("accueil");
    } catch (err) {
      message("#msg-creer", err.message, "erreur");
    }
  });

  $("#form-importer").addEventListener("submit", (e) => {
    e.preventDefault();
    try {
      const attendue = $("#adresse-importer").value.trim();
      if (attendue && !adresseValide(attendue)) throw new Error("Adresse invalide.");
      compte = enregistrerCompte(retrouverPaire($("#mots-importer").value, attendue || null), $("#nom-importer").value, $("#code-importer").value);
      e.target.reset();
      afficher("accueil");
    } catch (err) {
      message("#msg-importer", err.message, "erreur");
    }
  });

  $("#form-chercher").addEventListener("submit", (e) => {
    e.preventDefault();
    const q = $("#chercher").value.trim();
    if (!q) return;
    if (adresseValide(q)) {
      afficher("payer");
      return choisirDestinataire(q);
    }
    if (GROUPES.some(([, n]) => n.some((s) => nomService(s).toLowerCase().includes(q.toLowerCase())))) {
      afficher("services");
      $("#filtre-services").value = q;
      return dessinerServices(q);
    }
    afficher("payer");
    choisirOnglet("annuaire");
    $("#annuaire").value = q;
    chercherAnnuaire(q);
  });

  $("#filtre-services").addEventListener("input", (e) => dessinerServices(e.target.value));
  $("#annuaire").addEventListener("input", (e) => chercherAnnuaire(e.target.value));
  $("#ouvrir-camera").addEventListener("click", ouvrirCamera);
  $("#form-numero").addEventListener("submit", (e) => {
    e.preventDefault();
    choisirDestinataire($("#numero").value);
  });

  $("#reclamer").addEventListener("click", () => {
    $("#form-reclamer").hidden = false;
    $("#code-reclamer").focus();
  });
  $("#annuler-reclamer").addEventListener("click", () => ($("#form-reclamer").hidden = true));
  $("#form-reclamer").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const paire = deverrouiller($("#code-reclamer").value);
      e.target.reset();
      e.target.hidden = true;
      message("#msg-pain", "Réclamation en cours…", "info");
      await envoyer(paire, api.tx.universalDividend.claimUds(), "#msg-pain");
      message("#msg-pain", "Ton pain quotidien est sur ton solde.", "ok");
      chargerHistorique("#mouvements", 3);
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

  $("#form-payer").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      if (!destinataire) throw new Error("Choisis d'abord à qui payer.");
      const montant = enUnites($("#montant").value);
      if (!(await peutRecevoir(destinataire.adresse)))
        throw new Error("Ce compte n'est pas celui d'un Galli vérifié par la Titulus : il ne peut pas recevoir de Gallo.");
      const paire = deverrouiller($("#code-payer").value);
      message("#msg-payer", "Paiement en cours…", "info");
      await envoyer(paire, api.tx.balances.transferKeepAlive(destinataire.adresse, montant), "#msg-payer");
      message("#msg-payer", `${gallo(montant)} payés à ${destinataire.nom}.`, "ok");
      e.target.reset();
      e.target.hidden = true;
      destinataire = null;
    } catch (err) {
      message("#msg-payer", err.message, "erreur");
    }
  });

  $("#copier").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(compte.adresse);
      message("#msg-recevoir", "Adresse copiée.", "ok");
    } catch {
      message("#msg-recevoir", "Copie impossible : sélectionne l'adresse ci-dessus.", "erreur");
    }
  });

  $("#oublier").addEventListener("click", () => ($("#confirmer-oubli").hidden = false));
  $("#oubli-non").addEventListener("click", () => ($("#confirmer-oubli").hidden = true));
  $("#oubli-oui").addEventListener("click", () => {
    rangerComptes(comptesRanges().filter((c) => c.adresse !== compte.adresse));
    compte = comptesRanges()[0] || null;
    afficher(compte ? "accueil" : "bienvenue");
  });
}

async function demarrer() {
  brancher();
  window.addEventListener("hashchange", () => {
    const e = location.hash.slice(1);
    if (api && $(`[data-ecran="${e}"]`) && $(`[data-ecran="${e}"]`).hidden) afficher(e);
  });
  dessinerServices();
  compte = comptesRanges()[0] || null;
  await cryptoWaitReady();
  message("#etat", "Connexion à la chaîne Gallia…", "info");
  api = await ApiPromise.create({ provider: new WsProvider(WS), noInitWarn: true });
  message("#etat", "");
  const demande = location.hash.slice(1);
  afficher($(`[data-ecran="${demande}"]`) ? demande : compte ? "accueil" : "bienvenue");
}

demarrer().catch((e) => message("#etat", `Impossible de joindre la chaîne : ${e.message}`, "erreur"));
