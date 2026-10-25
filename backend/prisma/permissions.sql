-- Permisos por rol. Lo ejecuta el rol owner DESPUÉS de cada migración (comando: npm run db:deploy).
--
-- Es idempotente y fija el estado final por nombre de objeto: primero revoca y luego concede, así que da igual
-- lo que hubiera antes. Va en una sola transacción: si una sentencia falla, no queda ningún cambio parcial.
-- No contiene secretos y nunca concede «a todo el esquema»: cada objeto se nombra expresamente.
-- Si una migración futura añade una tabla o una vista, hay que ampliar este archivo (revocar y conceder por nombre).
--
-- Estado final:
--   PUBLIC: sin privilegios en la base ni en el esquema public.
--   writer: CONNECT en la base, USAGE en public y SELECT, INSERT, UPDATE y DELETE sobre tasks.
--   reader: CONNECT en la base, USAGE en public y SELECT sobre la vista task_counts.
--   La tabla de control de Prisma (_prisma_migrations) solo la usa owner.

BEGIN;

-- Base de datos: se usa current_database() para que el script sirva para la base de desarrollo y la de pruebas.
DO $$
BEGIN
  EXECUTE format('REVOKE ALL ON DATABASE %I FROM PUBLIC, writer, reader', current_database());
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO writer, reader', current_database());
END
$$;

-- Esquema public: solo se puede usar (no crear objetos).
REVOKE ALL ON SCHEMA public FROM PUBLIC, writer, reader;
GRANT USAGE ON SCHEMA public TO writer, reader;

-- Tablas y vistas: se revoca todo por nombre y se concede solo lo necesario.
REVOKE ALL ON TABLE tasks, task_counts, _prisma_migrations FROM PUBLIC, writer, reader;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE tasks TO writer;
GRANT SELECT ON TABLE task_counts TO reader;

-- Funciones que cree owner en el futuro: PostgreSQL las hace ejecutables por PUBLIC por defecto; se quita.
ALTER DEFAULT PRIVILEGES REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

COMMIT;
