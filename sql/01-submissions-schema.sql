-- Submissions table, structure only.
--
-- v2's dump of this table is 54 MB of historical student data. v3 starts with an
-- empty table; the history stays archived in ../../sqlinit/008_databaas_submissions.sql.

USE `databaas`;

SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS `submissions`;

CREATE TABLE `submissions` (
  `userName` varchar(255) NOT NULL,
  `assignmentID` int NOT NULL,
  `query` text NOT NULL,
  `statusID` int NOT NULL,
  `message` text,
  `timestamp` datetime NOT NULL,
  `approved_percentage` int DEFAULT NULL,
  PRIMARY KEY (`userName`, `assignmentID`),
  KEY `fk_Ingeleverd_IngeleverdeOpdrachtStatus1_idx` (`statusID`),
  KEY `fk_Ingeleverd_Opdrachten1` (`assignmentID`),
  CONSTRAINT `fk_Ingeleverd_IngeleverdeOpdrachtStatus1`
    FOREIGN KEY (`statusID`) REFERENCES `submission_status` (`ID`),
  CONSTRAINT `fk_Ingeleverd_Opdrachten1`
    FOREIGN KEY (`assignmentID`) REFERENCES `assignments` (`ID`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SET FOREIGN_KEY_CHECKS = 1;
