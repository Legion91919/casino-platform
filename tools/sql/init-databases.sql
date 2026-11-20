-- Used by docker-compose (pg-platform): one database and one owner role per service (ADR-0002).
-- Owner roles are NOLOGIN; migrations run as the owner via SET ROLE. Real environments create
-- login roles with vault-issued, short-lived credentials.
CREATE ROLE pitboss_owner NOLOGIN;   CREATE DATABASE pitboss   OWNER pitboss_owner;
CREATE ROLE dealer_owner NOLOGIN;    CREATE DATABASE dealer    OWNER dealer_owner;
CREATE ROLE comps_owner NOLOGIN;     CREATE DATABASE comps     OWNER comps_owner;
CREATE ROLE countroom_owner NOLOGIN; CREATE DATABASE countroom OWNER countroom_owner;
CREATE ROLE backstage_owner NOLOGIN; CREATE DATABASE backstage OWNER backstage_owner;
