-- Vista de conteos por estado. Se escribe a mano: Prisma no la modela (schema.prisma solo define la tabla tasks).
-- No lleva security_invoker: se ejecuta con los privilegios de su propietario (owner), de modo que el rol reader
-- pueda leer los conteos sin tener acceso a la tabla tasks.
CREATE VIEW "task_counts" AS
SELECT "completed", COUNT(*)::int AS "total"
FROM "tasks"
GROUP BY "completed";

COMMENT ON VIEW "task_counts" IS 'Número de tareas por estado. Solo hay fila para los estados que tienen tareas.';
COMMENT ON COLUMN "task_counts"."completed" IS 'Estado: true para las tareas completadas, false para las pendientes.';
COMMENT ON COLUMN "task_counts"."total" IS 'Cantidad de tareas con ese estado, como entero de 32 bits.';
