# Mission Gallo : construire la chaîne de la Gallia

Tu travailles pour Charles Pourlier, fondateur de GIFTER et de la Gallia. Il ne sait pas coder.
Explique-lui chaque étape en français simple, en quelques phrases, sans jargon.
À la fin de chaque étape, arrête-toi, résume ce qui marche et demande son feu vert avant la suivante.

## Règles absolues

- Ne demande jamais à Charles de te donner une clé, un jeton, un mot de passe ou une phrase secrète dans la conversation.
  Quand il en faut une, dis-lui exactement dans quel fichier ou quelle commande la coller lui-même.
- Ne lis, n'affiche, ne recopie jamais une clé ou une phrase secrète.
- Aucun secret dans Git : toutes les clés vont dans des fichiers `.env` ou dans le trousseau du nœud, listés dans `.gitignore`.
- Le dépôt GitHub `CharlesGallia/gallia-chain` est public : le code doit pouvoir être relu par tous.
- Sauvegarde : avant toute action qui efface des données de la chaîne, demande l'accord de Charles.

## Le serveur

- VPS Hostinger KVM 4 : 4 processeurs, 16 Go de mémoire, 200 Go de disque, Ubuntu 24.04 (srv766467.hstgr.cloud).
- n8n est déjà installé et fait tourner GALL.IA : ne l'arrête pas, ne modifie pas ses conteneurs, ses volumes ni ses ports.
  Avant d'installer quoi que ce soit, liste les conteneurs et ports déjà utilisés et choisis des ports libres.
- Mets en place une sauvegarde automatique chaque nuit des données de la chaîne et de l'indexeur.

## Ce qu'est le Gallo

Monnaie de la Gallia, inspirée de la Ğ1 et construite à partir du logiciel libre Duniter v2
(https://git.duniter.org/nodes/rust/duniter-v2s).

- Nom de la chaîne : Gallia. Nom de la monnaie : Gallo. Symbole : GALLO. Deux décimales.
- La Gallibra est le nom de la création monétaire : elle crée les Gallo.
- Le pain quotidien : chaque Galli membre reçoit chaque jour la même part (dividende universel de Duniter).
  Valeur de départ : 1 Gallo par jour (soit 100 en unités de base, avec deux décimales). Croissance de la masse : environ 10 % par an (réévaluation de la Ğ1, à garder par défaut).
- Pas de parrains obligatoires : l'identité est vérifiée par le KYC de la Titulus.
  Un compte « Vérificateur Titulus » de la Gallia certifie chaque Galli vérifié.
  Le nombre de certifications nécessaires pour devenir membre doit donc pouvoir tomber à 1,
  et la règle de distance de la toile de confiance doit être adaptée ou désactivée. Étudie comment le faire dans Duniter v2.
- Circulation libre entre tous les comptes, sans plafond.

## Étapes

### Étape 1 : préparer le serveur
- Mettre à jour Ubuntu, installer Docker, Docker Compose, Git et la CLI GitHub (`gh`).
- Connexion GitHub : lance `gh auth login` en mode navigateur ; Charles valide le code sur son téléphone.
- Cloner `CharlesGallia/gallia-chain` dans `~/gallia`.

### Étape 2 : faire tourner Duniter v2 tel quel
- Lancer un nœud de test Duniter v2 avec l'image Docker officielle (réseau de développement local).
- Vérifier que des blocs sont produits et que le dividende universel est bien versé à un compte membre de test.
- Montrer à Charles le résultat en clair (« le compte de test a reçu son pain quotidien »).

### Étape 3 : créer la chaîne Gallia
- Partir du code source de duniter-v2s (copie dans le dépôt, licence d'origine conservée).
- Créer un runtime et une spécification de chaîne « gallia » : nom, symbole, décimales, dividende de départ,
  règle d'adhésion par le compte Vérificateur Titulus (1 certification).
- Bloc zéro : comptes du Trésor de la Gallia, du Vérificateur Titulus, et les premiers Gallis fondateurs
  (Charles fournira la liste ; leurs clés publiques seulement).
- Lancer la chaîne sur ce serveur et vérifier le pain quotidien.

### Étape 4 : voir et utiliser les Gallo
- Installer l'indexeur de Duniter v2 pour l'historique des transactions.
- Une page web simple (sur ce serveur) : solde d'un compte, historique, nombre de Gallis, Gallo créés aujourd'hui.
- Un portefeuille de test : créer un compte, recevoir, envoyer des Gallo. S'appuyer sur les portefeuilles libres de la Ğ1 (Ğecko, G1nkgo) si c'est plus rapide.

### Étape 5 : le service de la Gallia (à côté de la chaîne)
Un petit service (Node.js ou Python) qui :
- reçoit du site de la Titulus la confirmation qu'un KYC est validé et fait certifier le Galli par le compte Vérificateur ;
- verse le mérite depuis le compte du Trésor (entraide, savoir, tâches de la Vota Publica, Lignée sur 3 niveaux basée sur l'activité des filleuls, jamais sur les inscriptions) ;
- chaque matin, met à jour le solde Gallo de chaque Titulus via l'API Passcreator (Charles collera lui-même la clé API dans le `.env`).

### Étape 6 : ouvrir le réseau
- Documenter comment un Galli fait tourner un nœud chez lui ou sur un VPS (objectif : 3 à 5 nœuds dans plusieurs pays).
- Publier un README clair en français et inviter la communauté Duniter à relire le code avant les premiers vrais Gallo.

## Pour plus tard (ne pas faire maintenant)
Ruche (coffrer, part du miel, niveaux Butineuse / Ouvrière / Reine), NFT des symboles Cœur, Couronne de laurier et Abeille,
paiement chez les commerçants par QR code, inscription du mérite directement dans les règles de la chaîne.

## Références
- Document « Le Gallo — monnaie de la Gallia » (règles complètes) : https://claude.ai/artifact/DEVoZLsuNkELWBmJYMH5sD
- Duniter v2 : https://git.duniter.org/nodes/rust/duniter-v2s
- Forum Duniter : https://forum.duniter.org
