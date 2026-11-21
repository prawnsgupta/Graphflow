#!/bin/sh
# Runs once, on first container start (empty data volume).
# Creates the restricted application role used for all normal app queries.
# It is NOT a superuser, does NOT own any tables and has NO BYPASSRLS,
# so PostgreSQL Row-Level Security always applies to it.
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  DO \$\$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'graphflow_app') THEN
      CREATE ROLE graphflow_app LOGIN PASSWORD '${APP_DB_PASSWORD}'
        NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
    ELSE
      ALTER ROLE graphflow_app LOGIN PASSWORD '${APP_DB_PASSWORD}'
        NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
    END IF;
  END
  \$\$;

  CREATE DATABASE graphflow_test OWNER ${POSTGRES_USER};
  GRANT CONNECT ON DATABASE graphflow TO graphflow_app;
  GRANT CONNECT ON DATABASE graphflow_test TO graphflow_app;
EOSQL
