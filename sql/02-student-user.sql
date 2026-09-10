-- Restricted account used to run student queries.
--
-- Student SQL already runs inside a read-only transaction with a timeout, but a
-- separate account with SELECT-only grants and no access at all to `databaas`
-- means a student can never read or change the assignments and submissions,
-- whatever they submit.
--
-- Replace CHANGE_ME with the password you put in STUDENT_DB_PASSWORD, then run
-- this file once. On Aiven the `avnadmin` account may create users; if it is
-- refused, create the user in the Aiven console (Users tab) and run only the
-- GRANT statements below.

CREATE USER IF NOT EXISTS 'nakijk_student'@'%' IDENTIFIED BY 'CHANGE_ME';

GRANT SELECT ON `fun4all`.*             TO 'nakijk_student'@'%';
GRANT SELECT ON `muziekscholen`.*       TO 'nakijk_student'@'%';
GRANT SELECT ON `outerspace`.*          TO 'nakijk_student'@'%';
GRANT SELECT ON `studentactiviteiten`.* TO 'nakijk_student'@'%';
GRANT SELECT ON `muziekstukken`.*       TO 'nakijk_student'@'%';
GRANT SELECT ON `ruimtereis`.*          TO 'nakijk_student'@'%';
GRANT SELECT ON `employees`.*           TO 'nakijk_student'@'%';

-- Deliberately no grant on `databaas`.

FLUSH PRIVILEGES;
