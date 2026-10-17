#!/bin/sh
set -eu
password=$(cat /run/secrets/pg_agent_password)
# Provisioned values are random hex only; never echo the SQL or credentials.
case "$password" in *[!0-9a-f]*|'') exit 1;; esac
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres > /dev/null <<SQL
CREATE ROLE doon_agent LOGIN PASSWORD '$password' NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE DATABASE doon_agent_validation OWNER doon_agent;
CREATE DATABASE doon_agent_observability OWNER doon_agent;
REVOKE ALL ON DATABASE postgres FROM doon_agent;
SQL
