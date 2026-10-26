-- Consultas SQL pedidas por la prueba técnica. Los comentarios no llevan punto y coma: el test las separa por sentencia.

-- Consulta 1: tareas filtradas por estado (completed = true o false), de la más reciente a la más antigua. Está parametrizada ($1), igual que en la API, por lo que psql -f no la ejecuta tal cual: abra psql en el contenedor y use \bind (consulte docs-tecnicos/backend.md, sección Consultas SQL).
SELECT id, title, description, completed, "createdAt" FROM tasks WHERE completed = $1 ORDER BY "createdAt" DESC, id ASC;

-- Consulta 2: cantidad de tareas por estado (completadas y pendientes). No lleva parámetros y se puede pegar tal cual en psql.
SELECT completed, COUNT(*)::int AS total FROM tasks GROUP BY completed ORDER BY completed;
