-- CreateTable
CREATE TABLE "tasks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tasks_completed_idx" ON "tasks"("completed");

-- Restricciones escritas a mano (Prisma no modela CHECK). Defensa en profundidad: la API ya valida.
-- char_length cuenta puntos de código Unicode, no bytes ni grafemas.
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_title_length" CHECK (char_length("title") BETWEEN 1 AND 100);
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_title_not_blank" CHECK (btrim("title", ' ') <> '');
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_description_length" CHECK (char_length("description") <= 500);

-- Comentarios del catálogo (documentan el esquema dentro de la propia base)
COMMENT ON TABLE "tasks" IS 'Tareas de la lista de pendientes.';
COMMENT ON COLUMN "tasks"."id" IS 'Identificador UUID generado por la base de datos.';
COMMENT ON COLUMN "tasks"."title" IS 'Título de la tarea: de 1 a 100 caracteres y no formado solo por espacios.';
COMMENT ON COLUMN "tasks"."description" IS 'Descripción opcional de la tarea: hasta 500 caracteres, vacía por defecto.';
COMMENT ON COLUMN "tasks"."completed" IS 'Estado de la tarea: true si está completada, false si está pendiente.';
COMMENT ON COLUMN "tasks"."createdAt" IS 'Fecha y hora de creación, con zona horaria.';
