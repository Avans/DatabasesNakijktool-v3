# Nakijktool v3

SQL-nakijktool voor Brightspace, zonder Docker en zonder eigen server.

- **Vercel** (gratis Hobby-plan) serveert de API en het Brightspace-component. Slaapt nooit.
- **Aiven for MySQL** (gratis plan) draait de `databaas`-administratie en de zeven oefendatabases.
- **Twee cronjobs per dag** houden de Aiven-service actief, zodat die niet uitgezet wordt in vakanties.

Studenten blijven gewoon MySQL schrijven: het is een echte MySQL 8-server, dus alle
opdrachten, verwachte uitvoer en foutmeldingen werken zoals in v2.

## Wat er verandert ten opzichte van v2

| | v2 | v3 |
|---|---|---|
| Hosting | Docker op eigen host | Vercel serverless |
| Database | MySQL in Docker | Aiven MySQL |
| Nakijken | asynchroon, frontend polt | direct in de POST, uitslag meteen terug |
| Studentquery's | zelfde pool als administratie | apart account, read-only transactie, 5s limiet |
| Inzendingen | 54 MB historie | lege tabel (historie blijft in `sqlinit/`) |

De URL-vorm blijft identiek (`/assignments/:id`), dus in Brightspace verandert
alleen de hostnaam.

---

# Installatie

Eenmalig, ongeveer 30 minuten. Je hebt nodig: een Aiven-account, een Vercel-account
en de `mysql`-client op je laptop.

```bash
# mysql-client installeren
brew install mysql-client          # macOS
sudo apt install mysql-client      # Ubuntu
```

## Stap 1 — Aiven-service aanmaken

1. Ga naar [console.aiven.io](https://console.aiven.io) → **Create service** → **MySQL**.
2. Kies het **Free** plan en een regio in Europa (`google-europe-west4`, Nederland).
3. Geef de service een naam, bijvoorbeeld `nakijktool-mysql`, en maak hem aan.
4. Wacht tot de status **Running** is (een paar minuten).

Noteer van de **Overview**-pagina: `Host`, `Port`, `User` (`avnadmin`) en `Password`.
Download daar ook het **CA Certificate** (`ca.pem`).

## Stap 2 — Databases aanmaken

Aiven staat `CREATE DATABASE` meestal toe via SQL, maar niet altijd. Maak ze
zekerheidshalve alvast aan in de console onder **Databases**:

```
databaas  fun4all  muziekscholen  outerspace
studentactiviteiten  muziekstukken  ruimtereis  employees
```

## Stap 3 — Lokale configuratie

```bash
cd v3
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

Zet het CA-certificaat ernaast als `v3/ca.pem` (de scripts vinden het dan vanzelf;
het bestand staat in `.gitignore`):

```bash
cp ~/Downloads/ca.pem v3/ca.pem
```

Verzin verder twee lange willekeurige waarden:

```bash
openssl rand -hex 32   # voor SECRET_KEY
openssl rand -hex 32   # voor CRON_SECRET
```

## Stap 4 — Database vullen

```bash
cd v3
./scripts/load-database.sh
```

Dit laadt de dumps uit `../sqlinit/` in de juiste volgorde, strip `DEFINER`-clausules
(die werken niet op een managed server) en maakt een **lege** `submissions`-tabel aan.
Duurt een paar minuten, vooral door de 459 opdrachten.

Aan het eind zie je een telling; die hoort er ongeveer zo uit te zien:

```
  assignments: 459
  regexes:     ...
  connections: 7
  submissions: 0
```

## Stap 5 — Beperkt account voor studentquery's

Query's van studenten draaien onder een apart account dat alleen mag lezen in de
oefendatabases, en niets mag in `databaas`.

1. Verzin een wachtwoord en zet het in `.env` bij `STUDENT_DB_PASSWORD`.
2. Zet hetzelfde wachtwoord in `sql/02-student-user.sql` op de plek van `CHANGE_ME`.
3. Laden:

```bash
./scripts/run-sql.sh sql/02-student-user.sql
```

Weigert Aiven `CREATE USER`? Maak de gebruiker `nakijk_student` dan aan in de console
onder **Users** en draai daarna alleen de `GRANT`-regels uit dat bestand.

> Dit is een extra slot, geen enige slot: elke studentquery draait sowieso in een
> read-only transactie met een tijdslimiet, en alleen `SELECT`/`WITH` komt er langs.

## Stap 6 — Referentiequery's controleren

```bash
node scripts/verify-assignments.js
```

Draait alle 459 modelantwoorden echt uit tegen de oefendatabases. Faalt er één, dan
kan geen student die opdracht goed krijgen — dus dit is de belangrijkste controle na
het laden. "returns 0 rows" is niet altijd fout; sommige opdrachten horen leeg te zijn.

## Stap 7 — Naar Vercel

```bash
npm install -g vercel     # eenmalig
cd v3
vercel login
vercel link               # maak een nieuw project aan
```

Zet de omgevingsvariabelen. Het CA-certificaat moet als één regel met `\n` erin:

```bash
# alle waarden uit .env, één voor één
vercel env add DB_HOST production
vercel env add DB_PORT production
vercel env add DB_USER production
vercel env add DB_PASSWORD production
vercel env add DB_NAME production
vercel env add STUDENT_DB_USER production
vercel env add STUDENT_DB_PASSWORD production
vercel env add SECRET_KEY production
vercel env add CRON_SECRET production

# CA-certificaat als één regel
awk '{printf "%s\\n", $0}' ca.pem | pbcopy    # macOS: staat nu op je klembord
vercel env add DB_SSL_CA production           # plak het daar
```

Deployen:

```bash
vercel --prod
```

Je krijgt een URL terug, bijvoorbeeld `https://nakijktool.vercel.app`.

> De cronjobs uit `vercel.json` (11:59 en 23:59 UTC) worden pas actief na een
> **productie**-deploy. Controleer ze in het Vercel-dashboard onder **Settings → Cron Jobs**.

## Stap 8 — Testen

```bash
./scripts/smoke-test.sh https://nakijktool.vercel.app 21601
```

Vervang `21601` door een bestaand opdrachtnummer. Het script controleert de
health-check, het ophalen van een opdracht, het inleveren van een fout antwoord,
het blokkeren van `DROP TABLE`, CORS en het serveren van het component.

Ruim daarna de testinzending op:

```bash
./scripts/run-sql.sh -e "DELETE FROM submissions WHERE userName='smoke-test-user'"
```

## Stap 9 — Brightspace aanpassen

In je Brightspace-pagina's verandert alleen de `src` van het script:

```html
<script src="https://nakijktool.vercel.app/datab1-component.js"></script>

<wd-datab1 aid="21601"></wd-datab1>
```

Het component leidt de API-URL af van waar het script vandaan komt, dus je hoeft
verder niets te configureren. Wil je het toch ergens anders vandaan laden:

```html
<script>window.NAKIJK_API_URL = 'https://nakijktool.vercel.app';</script>
<script src="https://nakijktool.vercel.app/datab1-component.js"></script>
```

Zet daarna `CORS_ORIGIN` in Vercel op je Brightspace-domein in plaats van `*`.

---

# Onderhoud

## Blijft de database wel aan staan?

Aiven zet gratis services uit die geen activiteit zien, en waarschuwt je per e-mail
voordat dat gebeurt. `api/cron/keepalive.js` draait daarom twee keer per dag een
echte query. Dat telt als activiteit, ook als er wekenlang geen student inlogt.

Controleren of dat werkt: **Vercel → Deployments → Cron Jobs**, of handmatig:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://nakijktool.vercel.app/api/cron/keepalive
```

Wil je extra zekerheid, zet dan gratis een monitor bij [UptimeRobot](https://uptimerobot.com)
op `https://nakijktool.vercel.app/api/health`, elk uur. Dat is meteen een storingsmelder.

## Handige commando's

```bash
npm test                                  # nakijk-regels testen (geen database nodig)
node scripts/verify-assignments.js        # modelantwoorden controleren
./scripts/run-sql.sh -e "SELECT ..."      # los SQL-statement
vercel logs <deployment-url>              # logs bekijken
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

---

# Structuur

```
v3/
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
├── scripts/                       laden, controleren, testen
├── sql/                           submissions-tabel, beperkt account
├── test/verification.test.js      nakijkregels, zonder database
├── vercel.json                    routes + cronjobs
└── .env.example
```

## API

| Methode | Pad | Doel |
|---|---|---|
| GET | `/assignments/:id` | opdracht met omschrijving en verwachte uitvoer |
| GET | `/assignments/:id/submissions/:userId` | inzending van een student (204 als er nog niets is) |
| POST | `/assignments/:id/submissions` | inleveren; antwoord bevat meteen de uitslag |
| GET | `/api/health` | statuscheck |

Statuscodes in `statusId`: `0` in behandeling, `1` goedgekeurd, `2` afgewezen
(commentaar of geen `SELECT`), `3` fout resultaat, `4` verplichte constructie mist,
`5` handmatig goedgekeurd.
