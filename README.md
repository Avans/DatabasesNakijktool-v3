# Nakijktool v3

SQL-nakijktool voor Brightspace, zonder Docker en zonder eigen server.

- **Vercel** (gratis Hobby-plan) serveert de API en het Brightspace-component. Slaapt nooit.
- **Aiven for MySQL** (gratis plan) draait de `databaas`-administratie en de zeven oefendatabases.
- **Twee cronjobs per dag** houden de Aiven-service actief, zodat die niet uitgezet wordt in vakanties.

Studenten blijven gewoon MySQL schrijven: het is een echte MySQL 8-server, dus de
opdrachten, verwachte uitvoer en foutmeldingen werken zoals in v2. Op één punt is de
Aiven-server strenger dan de MySQL 5.7 uit v2 — hoofdlettergevoelige tabelnamen — zie
[Twee verschillen met de v2-server](#twee-verschillen-met-de-v2-server).

## Wat er verandert ten opzichte van v2

| | v2 | v3 |
|---|---|---|
| Hosting | Docker op eigen host | Vercel serverless |
| Database | MySQL 5.7 in Docker | Aiven MySQL 8.4 |
| Nakijken | asynchroon, frontend polt | direct in de POST, uitslag meteen terug |
| Studentquery's | zelfde pool als administratie | apart account, read-only transactie, 5s limiet |
| Inzendingen | 54 MB historie | lege tabel (historie blijft in `sqlinit/`) |
| Tabelnamen | hoofdletterongevoelig | hoofdlettergevoelig (Linux-server) |

De URL-vorm blijft identiek (`/assignments/:id`), dus in Brightspace verandert
alleen de hostnaam.

---

# Installatie

Eenmalig, ongeveer 30 minuten. Je hebt nodig: een Aiven-account, een Vercel-account,
Node 18 of nieuwer, en de `mysql`-client op je laptop.

Dit project verwacht de SQL-dumps uit het v2-project (`sqlinit/`). Zet de twee
checkouts naast elkaar, dan vindt het laadscript ze vanzelf:

```
Repos/
├── DatabasesNakijktool-v2/sqlinit/     de dumps
└── DatabasesNakijktool-v3/             dit project
```

```bash
# mysql-client installeren
brew install mysql-client          # macOS
sudo apt install mysql-client      # Ubuntu
```

Op macOS is `mysql-client` keg-only: Homebrew zet hem niet in je PATH. Zonder deze
stap krijg je `the 'mysql' client is not installed or not on PATH.` Voeg hem toe:

```bash
echo 'export PATH="/opt/homebrew/opt/mysql-client/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
mysql --version    # ter controle
```

(Op een Intel-Mac is het pad `/usr/local/opt/mysql-client/bin`.)

Installeer daarna de npm-pakketten; de controlescripts en de tests hebben ze nodig:

```bash
npm install
```

## Stap 1 — Aiven-service aanmaken

1. Ga naar [console.aiven.io](https://console.aiven.io) → **Create service** → **MySQL**.
2. Kies het **Free** plan en een regio in Europa (`google-europe-west4`, Nederland).
3. Geef de service een naam, bijvoorbeeld `nakijktool-mysql`, en maak hem aan.
4. Wacht tot de status **Running** is (een paar minuten).

Noteer van de **Overview**-pagina: `Host`, `Port`, `User` (`avnadmin`) en `Password`.
De poort is een eigen nummer per service, nooit 3306 — je hebt hem straks nog nodig.
Download daar ook het **CA Certificate** (`ca.pem`).

## Stap 2 — Databases aanmaken

Aiven staat `CREATE DATABASE` meestal toe via SQL; het laadscript uit stap 4 probeert
dat zelf. Lukt het niet, dan noemt het script precies welke databases nog ontbreken.
Je maakt ze dan aan in de console onder **Databases**:

```
databaas  fun4all  muziekscholen  outerspace
studentactiviteiten  muziekstukken  ruimtereis  employees
```

## Stap 3 — Lokale configuratie

```bash
cp .env.example .env
```

Vul `.env` met de gegevens uit stap 1:

```ini
DB_HOST=mysql-xxxxxxx-yyyyyyy.a.aivencloud.com
DB_PORT=12345
DB_USER=avnadmin
DB_PASSWORD=<wachtwoord uit de Aiven console>
DB_NAME=databaas
```

Zet het CA-certificaat ernaast als `ca.pem` in de projectmap (de scripts vinden het
dan vanzelf; het bestand staat in `.gitignore`):

```bash
cp ~/Downloads/ca.pem ca.pem
```

Verzin verder twee lange willekeurige waarden:

```bash
openssl rand -hex 32   # voor SECRET_KEY
openssl rand -hex 32   # voor CRON_SECRET
```

## Stap 4 — Database vullen

```bash
./scripts/load-database.sh
```

Dit laadt de dumps uit de `sqlinit/`-map van het v2-project in de juiste volgorde,
strip `DEFINER`-clausules (die werken niet op een managed server), maakt een **lege**
`submissions`-tabel aan en corrigeert de modelantwoorden die op een
hoofdlettergevoelige server niet meer werken. Duurt een paar minuten, vooral door de
459 opdrachten.

Het script zoekt `sqlinit/` op deze plekken, in deze volgorde: `$SQLINIT_DIR`,
`./sqlinit`, de bovenliggende map, en een broer-checkout
`DatabasesNakijktool-v2/sqlinit`. Staat het v2-project ergens anders, zet dan het
pad in `.env`:

```ini
SQLINIT_DIR=/pad/naar/DatabasesNakijktool-v2/sqlinit
```

Aan het eind zie je een telling; die hoort er zo uit te zien:

```
  assignments: 459
  regexes:     634
  connections: 7
  submissions: 0
```

## Stap 5 — Beperkt account voor studentquery's

Query's van studenten draaien onder een apart account dat alleen mag lezen in de
oefendatabases, en niets mag in `databaas`.

1. Verzin een wachtwoord en zet het in `.env` bij `STUDENT_DB_PASSWORD`.
2. Laden:

```bash
./scripts/run-sql.sh sql/02-student-user.sql
```

Het wachtwoord staat niet in het SQL-bestand: daar staat `${STUDENT_DB_PASSWORD}`,
en `run-sql.sh` vult dat bij het draaien in vanuit `.env`. Zo komt het geheim nooit
in git terecht. Wijzig je later het wachtwoord in `.env`, draai dit bestand dan
opnieuw — de `ALTER USER`-regel zet het wachtwoord dan gelijk.

Weigert Aiven `CREATE USER`? Maak de gebruiker `nakijk_student` dan aan in de console
onder **Users** en draai daarna alleen de `GRANT`-regels uit dat bestand.

Controleren of het slot dicht zit:

```bash
# moet een aantal teruggeven
mysql -h $DB_HOST -P $DB_PORT -u nakijk_student -p --ssl-ca=ca.pem \
  -e "SELECT COUNT(*) FROM fun4all.student"

# moet 'command denied' geven
mysql -h $DB_HOST -P $DB_PORT -u nakijk_student -p --ssl-ca=ca.pem \
  -e "SELECT COUNT(*) FROM databaas.assignments"
```

> Dit is een extra slot, geen enige slot: elke studentquery draait sowieso in een
> read-only transactie met een tijdslimiet, en alleen `SELECT`/`WITH` komt er langs.

## Stap 6 — Referentiequery's controleren

```bash
node scripts/verify-assignments.js
```

Draait alle 459 modelantwoorden echt uit tegen de oefendatabases. Faalt er één, dan
kan geen student die opdracht goed krijgen — dus dit is de belangrijkste controle na
het laden. "returns 0 rows" is niet altijd fout; sommige opdrachten horen leeg te zijn.

Bij een schone installatie hoort hier `All reference queries run successfully` te
staan. Het script eindigt met exitcode 1 als er iets faalt, dus het is ook bruikbaar
in een CI-stap.

### Twee verschillen met de v2-server

De Aiven-server staat strenger ingesteld dan de MySQL 5.7 uit v2. Beide verschillen
zijn opgevangen; dit staat hier zodat je de symptomen herkent.

**`sql_mode` bevat `ANSI`.** Daardoor gelden `ANSI_QUOTES` (dubbele quotes zijn
kolomnamen in plaats van tekst) en `PIPES_AS_CONCAT` (`||` plakt samen in plaats van
OR). Een gewone v2-query als `WHERE actcode = "KLS"` faalt dan met
`Unknown column 'KLS'`. `lib/db.js` zet daarom bij elke studentquery de sessie terug
op de MySQL-standaardmodus, zodat studenten schrijven wat ze gewend zijn. Wil je een
andere modus, zet dan `STUDENT_SQL_MODE` in `.env`.

**`lower_case_table_names=0`.** Op Linux zijn tabelnamen, schemanamen en aliassen
hoofdlettergevoelig; op de v2-server niet. Vijftien modelantwoorden verwezen naar
`Componist`, `Stuk`, `Niveau`, `Reis`, `Bezoek` of `Ruimtereis`, en één gebruikte
alias `B` naast `b`. Deze instelling ligt vast bij het aanmaken van de server en is
op een managed service niet te wijzigen, dus de query's zijn gecorrigeerd in
`sql/03-assignment-query-fixes.sql`. Dat bestand draait automatisch aan het eind van
`load-database.sh`, zodat een reset de correcties niet ongedaan maakt.

> Let op: dit raakt ook studenten. Wie `SELECT * FROM Componist` schrijft, krijgt nu
> `Table 'muziekstukken.Componist' doesn't exist`. Noem de tabellen in de
> opdrachtteksten dus in kleine letters, zoals ze in de database staan.

## Stap 7 — Naar Vercel

De Vercel-CLI zit als devDependency in dit project, dus `npx` volstaat:

```bash
npx vercel login
npx vercel link               # maak een nieuw project aan
```

Zet de omgevingsvariabelen. **Vergeet `DB_PORT` niet**: Aiven luistert op een eigen
poort, en zonder die variabele komt de API niet bij de database.

```bash
# alle waarden uit .env, één voor één
npx vercel env add DB_HOST production
npx vercel env add DB_PORT production
npx vercel env add DB_USER production
npx vercel env add DB_PASSWORD production
npx vercel env add DB_NAME production
npx vercel env add STUDENT_DB_USER production
npx vercel env add STUDENT_DB_PASSWORD production
npx vercel env add SECRET_KEY production
npx vercel env add CRON_SECRET production
npx vercel env add CORS_ORIGIN production

# CA-certificaat als één regel met \n erin
awk '{printf "%s\\n", $0}' ca.pem | pbcopy    # macOS: staat nu op je klembord
npx vercel env add DB_SSL_CA production       # plak het daar
```

`SQLINIT_DIR` hoeft niet mee: dat gebruikt alleen het laadscript op je laptop.

Controleer daarna wat er staat:

```bash
npx vercel env ls production
```

Deployen:

```bash
npx vercel --prod
```

Je krijgt een URL terug, bijvoorbeeld `https://db-nakijk.vercel.app`.

> Omgevingsvariabelen worden ingebakken bij de deploy. Voeg je er later een toe,
> deploy dan opnieuw — anders ziet de draaiende versie hem niet.

> De cronjobs uit `vercel.json` (11:59 en 23:59 UTC) worden pas actief na een
> **productie**-deploy. Controleer ze in het Vercel-dashboard onder **Settings → Cron Jobs**.

## Stap 8 — Testen

### Lokaal, zonder Vercel-account

`vercel dev` wil eerst een `vercel login` en een gekoppeld project. Om de API tegen
de echte Aiven-database te draaien zonder dat, is er een kleine eigen server
(`scripts/dev-server.js`) die dezelfde handlers uit `api/` laadt en de rewrites uit
`vercel.json` toepast:

```bash
npm run dev:local                  # http://localhost:3000
```

De smoke-test werkt tegen elke basis-URL, dus ook tegen die server:

```bash
./scripts/smoke-test.sh http://localhost:3000 20105
```

Losse endpoints met de hand:

```bash
curl http://localhost:3000/api/health
curl http://localhost:3000/assignments/20105
curl -X POST http://localhost:3000/assignments/116/submissions \
  -H 'Content-Type: application/json' \
  -d '{"email":"test@example.com","query":"SELECT * FROM activiteit WHERE actcode = \"KLS\""}'
```

### Met `vercel dev`

Wil je het echte Vercel-gedrag (inclusief de `crons`-configuratie):

```bash
npx vercel login
npx vercel link
npm run dev
```

### Tegen de deploy

```bash
./scripts/smoke-test.sh https://db-nakijk.vercel.app 20105
```

Vervang `20105` door een bestaand opdrachtnummer. Het script controleert de
health-check, het ophalen van een opdracht, het inleveren van een fout antwoord,
het blokkeren van `DROP TABLE`, CORS en het serveren van het component.

Ruim daarna de testinzendingen op:

```bash
./scripts/run-sql.sh -e "DELETE FROM submissions WHERE userName='smoke-test-user'"
```

## Stap 9 — Brightspace aanpassen

In je Brightspace-pagina's verandert alleen de `src` van het script:

```html
<script src="https://db-nakijk.vercel.app/datab1-component.js"></script>

<wd-datab1 aid="20105"></wd-datab1>
```

Het component leidt de API-URL af van waar het script vandaan komt, dus je hoeft
verder niets te configureren. Wil je het toch ergens anders vandaan laden:

```html
<script>window.NAKIJK_API_URL = 'https://db-nakijk.vercel.app';</script>
<script src="https://db-nakijk.vercel.app/datab1-component.js"></script>
```

Zet daarna `CORS_ORIGIN` in Vercel op je Brightspace-domein in plaats van `*`.

---

# Problemen oplossen

| Melding | Oorzaak | Oplossing |
|---|---|---|
| `the 'mysql' client is not installed or not on PATH` | Homebrew houdt `mysql-client` keg-only | PATH-regel uit [Installatie](#installatie) |
| `could not find the v2 sqlinit/ directory` | v2-checkout staat ergens anders | `SQLINIT_DIR` in `.env` |
| `CREATE DATABASE was refused` | Aiven laat het niet toe via SQL | databases aanmaken in de console (stap 2) |
| `Missing database configuration: DB_PORT` | variabele niet gezet in Vercel | `npx vercel env add DB_PORT production`, dan opnieuw deployen |
| `{"error":"Invalid assignment id"}` | opdrachtnummer kwam niet aan bij de functie | opgelost in `api/assignments/[...path].js`; opnieuw deployen |
| `{"database":"unreachable","error":"ECONNREFUSED"}` | verkeerde of ontbrekende `DB_HOST`/`DB_PORT` | waarden vergelijken met de Aiven-console |
| `Unknown column 'KLS'` | `ANSI_QUOTES` staat aan | zie [Twee verschillen](#twee-verschillen-met-de-v2-server) |
| `Table '...Componist' doesn't exist` | hoofdlettergevoelige tabelnamen | tabelnaam in kleine letters schrijven |

Een deploy nakijken zonder browser:

```bash
curl https://db-nakijk.vercel.app/api/health
npx vercel logs <deployment-url>
```

`/api/health` geeft `200` met `"database":"reachable"` als alles klopt, en anders
`503` met de reden erbij.

---

# Onderhoud

## Blijft de database wel aan staan?

Aiven zet gratis services uit die geen activiteit zien, en waarschuwt je per e-mail
voordat dat gebeurt. `api/cron/keepalive.js` draait daarom twee keer per dag een
echte query. Dat telt als activiteit, ook als er wekenlang geen student inlogt.

Controleren of dat werkt: **Vercel → Deployments → Cron Jobs**, of handmatig:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://db-nakijk.vercel.app/api/cron/keepalive
```

Zonder de juiste `Authorization`-header antwoordt het endpoint met `401`.

Wil je extra zekerheid, zet dan gratis een monitor bij [UptimeRobot](https://uptimerobot.com)
op `https://db-nakijk.vercel.app/api/health`, elk uur. Dat is meteen een storingsmelder.

## Handige commando's

```bash
npm install                               # eenmalig, en na het wisselen van branch
npm test                                  # nakijk-regels testen (geen database nodig)
npm run dev:local                         # API lokaal draaien, zonder Vercel-account
npm run load-database                     # oefendatabases (her)laden
npm run verify-assignments                # modelantwoorden controleren
./scripts/run-sql.sh -e "SELECT ..."      # los SQL-statement
./scripts/run-sql.sh bestand.sql          # SQL-bestand, met ${VAR} uit .env
npx vercel logs <deployment-url>          # logs bekijken
```

## Inzendingen bekijken

De view `resultaten_view` uit v2 bestaat nog:

```bash
./scripts/run-sql.sh -e "SELECT * FROM resultaten_view LIMIT 20"
```

Resultaten per student:

```bash
./scripts/run-sql.sh -e "
  SELECT userName, COUNT(*) AS ingeleverd,
         SUM(statusID IN (1,5)) AS goed
  FROM submissions GROUP BY userName ORDER BY goed DESC"
```

## Nieuw studiejaar

```bash
./scripts/run-sql.sh -e "TRUNCATE TABLE submissions"
```

## Oefendatabases herstellen

Heeft er iets de oefendata aangepast, dan zet `./scripts/load-database.sh` alles
terug naar de oorspronkelijke staat. Let op: dat leegt ook `submissions`.

Het script is idempotent — je kunt het zo vaak draaien als je wilt. Draai daarna
`node scripts/verify-assignments.js` om te bevestigen dat alle 459 modelantwoorden
het nog doen.

## Een opdracht aanpassen

De opdrachten staan in `databaas.assignments`, geladen uit de v2-dumps. Een
`UPDATE` met de hand verdwijnt bij de volgende `load-database.sh`. Zet correcties
daarom in `sql/03-assignment-query-fixes.sql`; dat bestand draait automatisch mee
aan het eind van het laden.

---

# Structuur

```
DatabasesNakijktool-v3/
├── api/
│   ├── assignments/[...path].js   alle drie de endpoints
│   ├── cron/keepalive.js          houdt Aiven wakker (2x per dag)
│   └── health.js                  statuscheck
├── lib/
│   ├── db.js                      connectiepools, retry, sandbox voor studentquery's
│   ├── cors.js
│   ├── models/                    Assignment, Submission, AssignmentRegex, QueryResult
│   └── services/                  nakijklogica, tokens
├── public/datab1-component.js     component voor Brightspace
├── scripts/
│   ├── load-database.sh           dumps laden en corrigeren
│   ├── run-sql.sh                 los statement of bestand, vult ${VAR} uit .env
│   ├── dev-server.js              API lokaal draaien zonder Vercel
│   ├── smoke-test.sh              end-to-end check tegen een basis-URL
│   ├── verify-assignments.js      alle 459 modelantwoorden uitvoeren
│   └── load-env.js                .env inlezen zonder extra dependency
├── sql/
│   ├── 01-submissions-schema.sql  lege submissions-tabel
│   ├── 02-student-user.sql        beperkt account (wachtwoord uit .env)
│   └── 03-assignment-query-fixes.sql  correcties op de v2-modelantwoorden
├── test/verification.test.js      nakijkregels, zonder database
├── vercel.json                    routes + cronjobs
├── .env.example
└── ca.pem                         CA van Aiven (niet in git)
```

## API

| Methode | Pad | Doel |
|---|---|---|
| GET | `/assignments/:id` | opdracht met omschrijving en verwachte uitvoer |
| GET | `/assignments/:id/submissions/:userId` | inzending van een student (204 als er nog niets is) |
| POST | `/assignments/:id/submissions` | inleveren; antwoord bevat meteen de uitslag |
| GET | `/api/health` | statuscheck |
| GET | `/api/cron/keepalive` | keep-alive; vereist `Authorization: Bearer $CRON_SECRET` |

Statuscodes in `statusId`: `0` in behandeling, `1` goedgekeurd, `2` afgewezen
(commentaar of geen `SELECT`), `3` fout resultaat, `4` verplichte constructie mist,
`5` handmatig goedgekeurd.

## Omgevingsvariabelen

| Variabele | Nodig in Vercel | Betekenis |
|---|---|---|
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | ja | Aiven-connectie; ontbreekt er één, dan zegt de API dat met naam en al |
| `DB_SSL_CA` | ja | CA-certificaat als één regel; leeg = TLS zonder verificatie |
| `STUDENT_DB_USER`, `STUDENT_DB_PASSWORD` | ja | beperkt account; leeg = terugvallen op `DB_USER` |
| `STUDENT_QUERY_TIMEOUT_MS` | optioneel | tijdslimiet per studentquery (standaard 5000) |
| `STUDENT_SQL_MODE` | optioneel | `sql_mode` voor studentquery's; standaard de MySQL-standaardmodus |
| `DB_CONNECTION_LIMIT` | optioneel | connecties per pool (standaard 3) |
| `CORS_ORIGIN` | ja | toegestane origins, komma-gescheiden of `*` |
| `SECRET_KEY` | ja | ondertekent het token bij een goedgekeurde inzending |
| `CRON_SECRET` | ja | beschermt `/api/cron/keepalive` |
| `SQLINIT_DIR` | nee | alleen lokaal: waar de v2-dumps staan |
