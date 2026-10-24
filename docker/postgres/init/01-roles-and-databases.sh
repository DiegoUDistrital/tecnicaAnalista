#!/usr/bin/env bash
# Crea los roles owner, writer y reader y las bases de desarrollo y de pruebas.
# La imagen de PostgreSQL ejecuta este script SOLO cuando el volumen está vacío.
set -euo pipefail

# Defensa en profundidad: la restricción de caracteres garantiza que las URL de conexión funcionen.
# Los mensajes nombran la variable y nunca su valor.
fail() {
  echo "ERROR: $1" >&2
  exit 1
}

for name in OWNER_PASSWORD WRITER_PASSWORD READER_PASSWORD; do
  [[ "${!name:-}" =~ ^[A-Za-z0-9._~-]+$ ]] || fail "$name vacía o con caracteres no permitidos (use A-Za-z0-9._~-)."
done

for name in DB_NAME DB_NAME_TEST; do
  [[ "${!name:-}" =~ ^[a-z0-9_]{1,63}$ ]] || fail "$name inválida (1 a 63 caracteres de a-z, 0-9 y _)."
done

[[ "$DB_NAME_TEST" == *_test ]] || fail "DB_NAME_TEST debe terminar en _test."

# Las contraseñas y los nombres entran con \getenv (no por -v, para que no salgan en la lista de procesos)
# y se interpolan con la citación de psql: :'var' como literal y :"var" como identificador.
psql --username "$POSTGRES_USER" --dbname postgres --set ON_ERROR_STOP=1 <<'SQL'
\getenv owner_pw OWNER_PASSWORD
\getenv writer_pw WRITER_PASSWORD
\getenv reader_pw READER_PASSWORD
\getenv db_name DB_NAME
\getenv db_test DB_NAME_TEST

CREATE ROLE owner LOGIN PASSWORD :'owner_pw' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE writer LOGIN PASSWORD :'writer_pw' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE reader LOGIN PASSWORD :'reader_pw' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

CREATE DATABASE :"db_name" OWNER owner TEMPLATE template0 ENCODING 'UTF8';
CREATE DATABASE :"db_test" OWNER owner TEMPLATE template0 ENCODING 'UTF8';
SQL
