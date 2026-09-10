-- Corrections to the v2 reference queries in `databaas.assignments`.
--
-- Aiven runs MySQL on Linux with lower_case_table_names=0, so table names,
-- schema names and table aliases are case-sensitive. v2's server was not, and a
-- number of reference queries carry mixed-case identifiers (`Componist`,
-- `Stuk`, `Niveau`, `Reis`, `Bezoek`, `Ruimtereis`, alias `B`) that no longer
-- resolve. One query also holds a soft hyphen (U+00AD) instead of a real hyphen
-- in a date literal, a copy-paste artefact that MySQL rejects as a DATETIME.
--
-- lower_case_table_names is fixed when the server is initialised and cannot be
-- changed on a managed service, so the queries are corrected instead.
--
-- Run after loading the dumps; load-database.sh does this automatically. Safe to
-- run more than once.

USE `databaas`;

-- 511: 'Componist' -> 'componist'
UPDATE assignments SET query = 'SELECT c.naam, s.titel FROM stuk s INNER JOIN componist c ON s.componistId = c.componistId' WHERE ID = 511;

-- 513: '\xad' -> '-'
UPDATE assignments SET query = 'SELECT c.naam, plaatsnaam FROM componist c LEFT JOIN muziekschool m ON c.schoolid = m.schoolid WHERE geboortedatum >= ''1900-01-01''' WHERE ID = 513;

-- 514: 'Componist' -> 'componist', 'Niveau' -> 'niveau'
UPDATE assignments SET query = 'SELECT s.stuknr, s.titel, c.naam, n.omschrijving FROM stuk s INNER JOIN componist c ON s.componistId = c.componistId INNER JOIN niveau n ON s.niveaucode = n.niveaucode' WHERE ID = 514;

-- 515: 'FROM Stuk b' -> 'FROM stuk b'
UPDATE assignments SET query = 'SELECT b.componistId, b.titel FROM stuk b INNER JOIN stuk o ON b.stuknrOrigineel = o.stuknr WHERE o.genrenaam = ''klassiek''' WHERE ID = 515;

-- 517: 'FROM Niveau n' -> 'FROM niveau n', 'JOIN Stuk s' -> 'JOIN stuk s'
UPDATE assignments SET query = 'SELECT n.omschrijving, n.niveaucode, COUNT(*) AS aantal FROM niveau n INNER JOIN stuk s ON n.niveaucode = s.niveaucode GROUP BY n.omschrijving' WHERE ID = 517;

-- 706: 'AS B' -> 'AS b'
UPDATE assignments SET query = 'SELECT reisnr, vertrekdatum, reisduur FROM reis AS r WHERE reisnr IN (SELECT reisnr FROM bezoek AS b JOIN hemelobject AS h ON b.objectnaam = h.objectnaam WHERE satellietVan = ''Mars'');' WHERE ID = 706;

-- 707: 'FROM Reis AS r' -> 'FROM reis AS r', 'FROM Bezoek' -> 'FROM bezoek'
UPDATE assignments SET query = 'SELECT reisnr FROM reis AS r WHERE 1 = (SELECT COUNT(DISTINCT objectnaam) FROM bezoek WHERE reisnr = r.reisnr);' WHERE ID = 707;

-- 1426: 'Componist' -> 'componist'
UPDATE assignments SET query = 'SELECT naam, titel, speelduur FROM stuk INNER JOIN componist ON stuk.componistId = componist.componistId ORDER BY naam, titel;' WHERE ID = 1426;

-- 1427: 'Componist' -> 'componist'
UPDATE assignments SET query = 'SELECT RIGHT(naam, length(naam) - INSTR(naam, '' '')) as Achternaam, titel FROM stuk INNER JOIN componist ON stuk.componistId = componist.componistId ORDER BY naam, titel;' WHERE ID = 1427;

-- 1428: 'Componist' -> 'componist'
UPDATE assignments SET query = 'SELECT SUBSTRING(naam, INSTR(naam, '' '') + 1) AS Achternaam, titel FROM stuk INNER JOIN componist ON stuk.componistId = componist.componistId ORDER BY achternaam , titel;' WHERE ID = 1428;

-- 1511: 'Ruimtereis.telefoon' -> 'ruimtereis.telefoon'
UPDATE assignments SET query = 'SELECT telefoonnr FROM ruimtereis.telefoon WHERE klantnr IS NULL;' WHERE ID = 1511;

-- 20419: 'Ruimtereis.telefoon' -> 'ruimtereis.telefoon'
UPDATE assignments SET query = 'SELECT telefoonnr FROM ruimtereis.telefoon WHERE klantnr IS NULL;' WHERE ID = 20419;

-- 20908: 'Componist' -> 'componist'
UPDATE assignments SET query = 'SELECT naam, titel, speelduur FROM stuk INNER JOIN componist ON stuk.componistId = componist.componistId ORDER BY naam, titel;' WHERE ID = 20908;

-- 20909: 'Componist' -> 'componist'
UPDATE assignments SET query = 'SELECT RIGHT(naam, length(naam) - INSTR(naam, '' '')) as Achternaam, titel FROM stuk INNER JOIN componist ON stuk.componistId = componist.componistId ORDER BY naam, titel;' WHERE ID = 20909;

-- 20910: 'Componist' -> 'componist'
UPDATE assignments SET query = 'SELECT SUBSTRING(naam, INSTR(naam, '' '') + 1) AS Achternaam, titel FROM stuk INNER JOIN componist ON stuk.componistId = componist.componistId ORDER BY achternaam , titel;' WHERE ID = 20910;
