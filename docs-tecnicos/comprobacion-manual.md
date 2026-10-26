# Comprobación manual

[← README](../README.md)

`docker compose config --quiet` valida el compose, pero no ejecuta los contenedores. Esta lista de veinte pasos comprueba a mano, en Docker
Desktop, lo que solo se ve con los contenedores en marcha. Reglas de la lista:

- Se ejecuta en PowerShell desde la raíz del repositorio, con un `.env` creado a partir de `.env.example` (ver
  «Variables del despliegue»). Ningún paso imprime el contenido del `.env`.
- Todos los comandos de Compose llevan `-f docker-compose.yml` (conviven dos archivos de Compose en la carpeta). La
  única excepción es el listado de proyectos (`docker compose ls`), que no depende de ningún archivo. La
  configuración se valida siempre con `config --quiet` (sin ese `--quiet`, Compose imprimiría los valores de las
  variables, entre ellos las contraseñas).
- `down` conserva los datos. `down -v` los **BORRA**: solo se usa en el paso 2, siempre con
  `-f docker-compose.yml -p todo-app-deploy` explícitos, y NUNCA contra el proyecto de desarrollo.
- Versión de Compose con la que se preparó la composición: v5.3.1 (Docker 29.6.2). La versión del equipo del usuario no
  se ha anotado. Con una versión anterior, `--wait` y `service_completed_successfully` podrían no comportarse igual; no
  se ha probado.

**Nota sobre `SIGTERM`.** Docker Desktop ejecuta contenedores Linux, así que parar un servicio con `stop` envía un `SIGTERM`
real al proceso principal (en Windows nativo no existe, ver «Cierre ordenado»). El paso 14 lo comprueba con el
backend: debe registrar `shutdown_started` y `shutdown_completed`, y terminar con código 0. El paso 14a comprobó esa
señal real en el backend (el `SIGTERM` real solo se comprobó en el backend); los pasos 14b, 14c y 14d (cierre
con una petición en curso, frontend y PostgreSQL) no se ejecutaron.

1. **`.env` vacío falla; con el `.env` real, la configuración es válida.** Prueba que las variables obligatorias se
   exigen y que el error no muestra valores.

   ```powershell
   New-Item $env:TEMP\vacio.env -ItemType File -Force | Out-Null
   docker compose -f docker-compose.yml --env-file $env:TEMP\vacio.env config --quiet; $LASTEXITCODE
   docker compose -f docker-compose.yml config --quiet; $LASTEXITCODE
   Remove-Item $env:TEMP\vacio.env
   ```

   Esperado: el primero termina con código distinto de 0 y un mensaje que nombra una variable obligatoria (por ejemplo
   `API_KEY` o `POSTGRES_USER`, según el orden en que Compose las evalúe), sin ningún valor. El segundo no imprime nada
   y termina con código 0.

2. **Estado inicial limpio.** Comprueba que no hay datos de pruebas anteriores y que el despliegue no se confunde con
   el desarrollo.

   ```powershell
   docker volume ls --filter name=todo_app_deploy
   docker compose ls -a
   ```

   Esperado: ningún volumen `todo_app_deploy_pgdata` y ningún proyecto `todo-app-deploy` en el listado (el proyecto de
   desarrollo, si aparece, tiene otro nombre y no se toca). Si el volumen existe de pruebas anteriores, se borra solo el
   del despliegue (esto BORRA sus datos) y se repite la comprobación:

   ```powershell
   docker compose -f docker-compose.yml -p todo-app-deploy down -v
   ```

3. **Arranque en frío sano.** Construye las imágenes, crea el volumen, migra y espera a que todo esté sano.

   ```powershell
   $inicio = Get-Date
   docker compose -f docker-compose.yml up -d --build --wait; $LASTEXITCODE
   ((Get-Date) - $inicio).TotalSeconds
   docker compose -f docker-compose.yml ps -a
   ```

   Esperado: código 0; `postgres`, `backend` y `frontend` en `healthy`; `migrate` en `Exited (0)`. Anotar el tiempo.

4. **Roles, permisos, índice y ausencia de la base de pruebas.** Consulta el catálogo de la base desde dentro del
   contenedor, con el usuario administrador de la imagen (las consultas entran por la entrada estándar para no
   depender de las comillas de PowerShell).

   ```powershell
   $consultas = @(
     '\l',
     "SELECT rolname, rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls FROM pg_roles WHERE rolname IN ('owner','writer','reader') ORDER BY 1;",
     '\dt', '\dv', '\di',
     "SELECT has_table_privilege('reader','tasks','SELECT') AS reader_tasks, has_table_privilege('reader','task_counts','SELECT') AS reader_counts, (has_table_privilege('writer','tasks','SELECT') AND has_table_privilege('writer','tasks','INSERT') AND has_table_privilege('writer','tasks','UPDATE') AND has_table_privilege('writer','tasks','DELETE')) AS writer_crud, has_schema_privilege('writer','public','CREATE') AS writer_create;"
   )
   $consultas | docker compose -f docker-compose.yml exec -T postgres sh -c 'psql -U $POSTGRES_USER -d $DB_NAME'
   ```

   Esperado: aparece la base de `DB_NAME` (`todo_app` por defecto) y NINGUNA base terminada en `_test`; los tres roles
   con todos los atributos privilegiados en `f`; `\dt` lista `tasks`, `\dv` lista `task_counts` y `\di` lista
   `tasks_completed_idx`; la última consulta da `reader_tasks = f`, `reader_counts = t`, `writer_crud = t` y
   `writer_create = f`.

5. **Migración repetible.** Repite el arranque y la migración y comprueba que nada cambia.

   ```powershell
   $huella = "SELECT (SELECT count(*) FROM _prisma_migrations) AS migraciones, (SELECT md5(string_agg(relname || COALESCE(relacl::text, ''), ',' ORDER BY relname)) FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind IN ('r','v')) AS permisos;"
   $huella | docker compose -f docker-compose.yml exec -T postgres sh -c 'psql -U $POSTGRES_USER -d $DB_NAME'
   docker compose -f docker-compose.yml up -d --wait; $LASTEXITCODE
   docker compose -f docker-compose.yml run --rm --no-deps migrate
   $huella | docker compose -f docker-compose.yml exec -T postgres sh -c 'psql -U $POSTGRES_USER -d $DB_NAME'
   ```

   Esperado: el segundo comando termina con código 0 (como `migrate` ya terminó y no cambió, Compose no lo ejecuta
   otra vez; por eso el tercero lo ejecuta de forma explícita); la salida de `migrate` indica que no hay migraciones
   pendientes y termina con código 0; las dos huellas (número de migraciones y resumen de permisos) son idénticas.

6. **Una migración fallida impide arrancar el resto.** Se usa una contraseña falsa para `owner` en un archivo
   temporal; el `.env` real no se modifica ni se muestra.

   ```powershell
   docker compose -f docker-compose.yml down
   (Get-Content .env) -replace '^OWNER_PASSWORD=.*', 'OWNER_PASSWORD=contrasena-falsa-123' | Set-Content $env:TEMP\malo.env
   docker compose -f docker-compose.yml --env-file $env:TEMP\malo.env up -d --wait; $LASTEXITCODE
   docker inspect -f '{{.State.ExitCode}}' (docker compose -f docker-compose.yml ps -a -q migrate)
   docker compose -f docker-compose.yml ps -a
   docker compose -f docker-compose.yml logs --no-color migrate
   docker compose -f docker-compose.yml logs --no-color migrate | Select-String -SimpleMatch -Quiet 'contrasena-falsa-123'
   Remove-Item $env:TEMP\malo.env
   docker compose -f docker-compose.yml up -d --wait; $LASTEXITCODE
   ```

   Esperado: el primer `up` termina con código distinto de 0; el código de salida de `migrate` es distinto de 0;
   `backend` y `frontend` no arrancaron (en `ps -a` aparecen `Created` o no aparecen); el registro de `migrate` nombra
   el fallo de autenticación del rol `owner` y la búsqueda de la contraseña falsa da `False` (el registro no la
   muestra). El último `up`, con el `.env` real, termina con código 0 y deja todo sano.

7. **Puertos publicados.** Solo el frontend, solo en este equipo.

   ```powershell
   docker compose -f docker-compose.yml ps
   (Test-NetConnection 127.0.0.1 -Port 3001 -WarningAction SilentlyContinue).TcpTestSucceeded
   (Test-NetConnection 127.0.0.1 -Port 3000 -WarningAction SilentlyContinue).TcpTestSucceeded
   (Test-NetConnection 127.0.0.1 -Port 5432 -WarningAction SilentlyContinue).TcpTestSucceeded
   $ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notmatch '^(127|169\.254)\.' } | Select-Object -First 1).IPAddress
   (Test-NetConnection $ip -Port 3001 -WarningAction SilentlyContinue).TcpTestSucceeded
   ```

   Esperado: solo `frontend` muestra `127.0.0.1:3001->3001/tcp`; las pruebas dan `True` (3001 en 127.0.0.1), `False`
   (3000), `False` (5432) y `False` (3001 con la IP de la red local del equipo).

8. **Red interna sin salida a internet.** Prueba que la base y la API no pueden salir, y que el anfitrión no llega a
   la API.

   ```powershell
   docker network inspect todo_app_deploy_internal -f '{{.Internal}}'
   docker compose -f docker-compose.yml exec -T backend node -e "require('node:https').get('https://example.com',(r)=>{console.log('SALIDA',r.statusCode);process.exit(0)}).on('error',(e)=>{console.log('SIN SALIDA',e.code);process.exit(0)})"
   docker compose -f docker-compose.yml exec -T postgres bash -c '(echo > /dev/tcp/1.1.1.1/443) 2>/dev/null && echo SALIDA || echo SIN SALIDA'
   $idBackend = docker compose -f docker-compose.yml ps -q backend
   $ipBackend = docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' $idBackend
   (Test-NetConnection $ipBackend -Port 3000 -WarningAction SilentlyContinue).TcpTestSucceeded
   docker compose -f docker-compose.yml exec -T frontend node -e "require('node:https').get('https://example.com',(r)=>{console.log('SALIDA',r.statusCode);process.exit(0)}).on('error',(e)=>{console.log('SIN SALIDA',e.code);process.exit(0)})"
   ```

   Esperado: `true`; `SIN SALIDA` con un código de red (`ENOTFOUND`, `EAI_AGAIN` o `ENETUNREACH`) desde el backend;
   `SIN SALIDA` desde `postgres`; `False` desde el anfitrión hacia la IP interna del backend. La última línea, desde el
   frontend, SÍ muestra `SALIDA` con un código HTTP: es lo esperado y está documentado (el frontend está en `publish`).

9. **Salud de los servicios.**

   ```powershell
   docker compose -f docker-compose.yml ps -a
   docker inspect -f '{{.State.Health.Status}}' (docker compose -f docker-compose.yml ps -q postgres backend frontend)
   ```

   Esperado: el mismo estado que en el paso 3; las tres líneas de `docker inspect` dicen `healthy`.

10. **Aplicación en el navegador.** Abrir `http://127.0.0.1:3001` y también `http://localhost:3001`. Crear, completar,
    desmarcar, editar y borrar una tarea; abrir `http://127.0.0.1:3001/?filter=completed`. Esperado: sin errores
    visibles; los contadores Todas, Completadas y Pendientes son correctos tras cada acción y el filtro funciona.

    ```powershell
    Start-Process http://127.0.0.1:3001
    ```

11. **Archivos estáticos y cabecera `Host`.** Prueba que los estáticos del servidor independiente se sirven y que una
    escritura con un `Host` ajeno se rechaza.

    ```powershell
    $html = (curl.exe -s http://127.0.0.1:3001/) -join "`n"
    $ruta = [regex]::Match($html, '/_next/static/[^"]+\.(js|css)').Value
    curl.exe -s -o NUL -w "%{http_code}`n" "http://127.0.0.1:3001$ruta"
    curl.exe -s -o NUL -w "%{http_code}`n" -H "Host: 127.0.0.1:3001" http://127.0.0.1:3001/
    curl.exe -s -o NUL -w "%{http_code}`n" -X POST -H "Host: otro.example" -H "Content-Type: application/json" -d "{}" http://127.0.0.1:3001/api/tasks
    ```

    Esperado: `200`, `200` y `403`.

12. **Cupo compartido.** Primero se lee el valor efectivo; después se baja el cupo con un archivo temporal para ver el
    429 sin lanzar cientos de peticiones.

    ```powershell
    docker compose -f docker-compose.yml exec -T backend printenv RATE_LIMIT_MAX RATE_LIMIT_POST_MAX
    Get-Content .env | Where-Object { $_ -notmatch '^(RATE_LIMIT_MAX|RATE_LIMIT_POST_MAX|RATE_LIMIT_AUTH_FAILURES_MAX)=' } | Set-Content $env:TEMP\cupo.env
    Add-Content $env:TEMP\cupo.env 'RATE_LIMIT_MAX=10'
    Add-Content $env:TEMP\cupo.env 'RATE_LIMIT_POST_MAX=5'
    Add-Content $env:TEMP\cupo.env 'RATE_LIMIT_AUTH_FAILURES_MAX=5'
    docker compose -f docker-compose.yml --env-file $env:TEMP\cupo.env up -d --wait; $LASTEXITCODE
    1..12 | ForEach-Object { curl.exe -s -o NUL -w "%{http_code}`n" http://127.0.0.1:3001/api/tasks }
    curl.exe -s -o NUL -w "%{http_code}`n" -H "X-Forwarded-For: 203.0.113.9" http://127.0.0.1:3001/api/tasks
    Remove-Item $env:TEMP\cupo.env
    docker compose -f docker-compose.yml up -d --wait; $LASTEXITCODE
    docker compose -f docker-compose.yml exec -T backend printenv RATE_LIMIT_MAX RATE_LIMIT_POST_MAX
    ```

    Esperado: la primera lectura da `1000` y `200` si el `.env` no define los cupos (si da `100` y `20`, el `.env` es
    una copia literal de `.env.example` y manda sobre los de demostración: anotarlo, es el comportamiento
    documentado); con el cupo reducido, las doce peticiones empiezan con `200` y las últimas dan `429`; la petición con
    otra cabecera `X-Forwarded-For` TAMBIÉN da `429`: es el cupo único compartido por diseño, no un fallo, y la
    cabecera enviada no cambia el resultado. Al restaurar, `backend` se recrea y su contador se reinicia; la última
    lectura vuelve al valor inicial.

13. **API key mal puesta.** Se simula un frontend con una key equivocada y se comprueba el bloqueo y su recuperación.

    ```powershell
    1..12 | ForEach-Object { docker compose -f docker-compose.yml exec -T frontend node -e "fetch('http://backend:3000/api/tasks',{headers:{Authorization:'Bearer clave-falsa'}}).then((r)=>console.log(r.status))" }
    curl.exe -s -o NUL -w "%{http_code}`n" http://127.0.0.1:3001/api/tasks
    docker compose -f docker-compose.yml up -d --force-recreate backend
    curl.exe -s -o NUL -w "%{http_code}`n" http://127.0.0.1:3001/api/tasks
    ```

    Esperado: diez respuestas `401` (con el valor por defecto de `RATE_LIMIT_AUTH_FAILURES_MAX`, 10) y después `429`;
    la interfaz (segunda línea) también recibe `429`, porque el backend solo ve la IP del frontend y la bloquea
    entera; tras recrear el backend, el contador se reinicia y la tercera línea da `200`. Rotar la key: generar una
    nueva con `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`, ponerla en `API_KEY`
    del `.env` y ejecutar:

    ```powershell
    docker compose -f docker-compose.yml up -d --force-recreate backend frontend
    ```

    Esperado: la aplicación vuelve a funcionar (`http://127.0.0.1:3001`) con la key nueva en los dos servicios a la vez.

14. **`SIGTERM` real.** Cuatro paradas, una por servicio, con el subcomando `stop` (envía `SIGTERM`).

    (a) Backend en reposo:

    ```powershell
    $idBackend = docker compose -f docker-compose.yml ps -q backend
    Measure-Command { docker compose -f docker-compose.yml stop backend } | Select-Object TotalSeconds
    docker compose -f docker-compose.yml logs --no-color backend
    docker inspect -f '{{.State.ExitCode}} {{.State.OOMKilled}}' $idBackend
    ```

    Esperado: la parada tarda menos de 10 s (`SHUTDOWN_TIMEOUT_MS`); el registro contiene `shutdown_started` y
    `shutdown_completed`; `docker inspect` da `0 false`.

    (b) Con una petición en curso. En una terminal, abrir una conexión que envía las cabeceras de un `POST` con
    `Content-Length: 100` y solo una parte del cuerpo, y la deja abierta (la key se lee dentro del contenedor y no se
    imprime):

    ```powershell
    docker compose -f docker-compose.yml up -d --wait backend
    docker compose -f docker-compose.yml exec -T backend node -e "const s=require('node:net').connect(3000,'127.0.0.1',()=>{s.write('POST /api/tasks HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer '+process.env.API_KEY+'\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n{');console.log('ABIERTO')});s.on('close',()=>{console.log('CERRADO');process.exit(0)})"
    ```

    En otra terminal, mientras la primera sigue abierta:

    ```powershell
    $idBackend = docker compose -f docker-compose.yml ps -q backend
    docker compose -f docker-compose.yml stop backend
    docker compose -f docker-compose.yml logs --no-color backend
    docker inspect -f '{{.State.ExitCode}}' $idBackend
    ```

    Esperado (según «Cierre ordenado»): una petición que no termina agota el plazo de 10 s (`SHUTDOWN_TIMEOUT_MS`):
    el registro contiene `shutdown_started` y `shutdown_timeout`, el código de salida es `1` (no `137`: el cierre
    forzado ocurre antes de los 20 s de `stop_grace_period`) y la primera terminal imprime `CERRADO`. Si el
    contenedor responde y cierra la conexión sin llegar al plazo, o si no se puede simular, se anota lo observado
    («no simulable» y por qué).

    (c) Frontend:

    ```powershell
    docker compose -f docker-compose.yml up -d --wait
    $idFrontend = docker compose -f docker-compose.yml ps -q frontend
    docker compose -f docker-compose.yml stop frontend
    docker inspect -f '{{.State.ExitCode}}' $idFrontend
    ```

    Esperado: `143` (128 + 15) es la limitación conocida del servidor de Next (ver «Plazos de cierre»); si da `0`, se
    anota. Lo que no puede pasar es `137` (cierre forzado).

    (d) PostgreSQL:

    ```powershell
    docker compose -f docker-compose.yml up -d --wait
    $idPostgres = docker compose -f docker-compose.yml ps -q postgres
    docker compose -f docker-compose.yml stop postgres
    docker inspect -f '{{.State.ExitCode}}' $idPostgres
    docker compose -f docker-compose.yml up -d --wait
    ```

    Esperado: `0` (cierre rápido de su imagen); el último `up` deja todo sano otra vez.

15. **Persistencia de los datos.** Crear una tarea en la interfaz (`http://127.0.0.1:3001`) y reiniciar sin `-v`.

    ```powershell
    docker compose -f docker-compose.yml down
    docker compose -f docker-compose.yml up -d --wait; $LASTEXITCODE
    docker compose -f docker-compose.yml logs --no-color postgres | Select-String 'Skipping initialization|CREATE ROLE'
    ```

    Esperado: la tarea sigue en la interfaz; el filtro del registro muestra solo la línea que indica que se omite la
    inicialización (el directorio de datos ya contiene una base) y ninguna línea `CREATE ROLE`.

16. **Sin secretos en imágenes ni en registros.** Primero las imágenes, con archivos centinela que coinciden con
    `.env.*` (no se toca ningún `.env` real):

    ```powershell
    Set-Content backend\.env.centinela 'CENTINELA_8f3a1c'
    Set-Content frontend\.env.centinela 'CENTINELA_8f3a1c'
    docker compose -f docker-compose.yml build --no-cache backend frontend migrate
    docker run --rm --entrypoint sh todo-app-deploy-backend -c "grep -r --exclude-dir=proc --exclude-dir=sys CENTINELA_8f3a1c / 2>/dev/null; ls -a /app"
    docker run --rm --entrypoint sh todo-app-deploy-migrate -c "grep -r --exclude-dir=proc --exclude-dir=sys CENTINELA_8f3a1c / 2>/dev/null; ls -a /app"
    docker run --rm --entrypoint sh todo-app-deploy-frontend -c "grep -r --exclude-dir=proc --exclude-dir=sys CENTINELA_8f3a1c / 2>/dev/null; ls -a /app"
    docker history --no-trunc todo-app-deploy-backend | Select-String CENTINELA_8f3a1c
    docker history --no-trunc todo-app-deploy-migrate | Select-String CENTINELA_8f3a1c
    docker history --no-trunc todo-app-deploy-frontend | Select-String CENTINELA_8f3a1c
    Remove-Item backend\.env.centinela, frontend\.env.centinela
    ```

    Después los registros: se guardan en un archivo temporal y se busca cada secreto del `.env` sin imprimirlo; solo
    se escribe el nombre si aparece.

    ```powershell
    docker compose -f docker-compose.yml up -d --wait
    docker compose -f docker-compose.yml logs --no-color > $env:TEMP\logs.txt
    $lineas = Get-Content .env
    foreach ($nombre in 'API_KEY', 'POSTGRES_PASSWORD', 'OWNER_PASSWORD', 'WRITER_PASSWORD', 'READER_PASSWORD') {
      $linea = $lineas | Where-Object { $_ -like "$nombre=*" } | Select-Object -First 1
      $valor = $linea.Substring($nombre.Length + 1)
      if (Select-String -Path $env:TEMP\logs.txt -SimpleMatch -Pattern $valor -Quiet) { "FUGA: $nombre" }
    }
    Remove-Item $env:TEMP\logs.txt
    ```

    Esperado: ninguna coincidencia con `CENTINELA_8f3a1c` (ni en los archivos ni en el historial), `ls -a /app` sin
    ningún `.env` en las tres imágenes, y ningún «FUGA». Riesgo residual que se anota: `docker inspect` de un
    contenedor en marcha muestra sus variables a quien tenga acceso al socket de Docker, que equivale a ser
    administrador del equipo.

17. **Usuario sin privilegios.**

    ```powershell
    docker compose -f docker-compose.yml run --rm --no-deps --entrypoint id backend -u
    docker compose -f docker-compose.yml run --rm --no-deps --entrypoint id frontend -u
    docker compose -f docker-compose.yml run --rm --no-deps --entrypoint id migrate -u
    docker compose -f docker-compose.yml exec -T backend sh -c 'grep ^Uid /proc/1/status'
    docker compose -f docker-compose.yml exec -T frontend sh -c 'grep ^Uid /proc/1/status'
    ```

    Esperado: `10001` en las tres primeras líneas; en las dos últimas, `Uid:` seguido de `10001` cuatro veces.

18. **Finales de línea del script de inicio.**

    ```powershell
    git check-attr eol docker/postgres/init/01-roles-and-databases.sh
    docker compose -f docker-compose.yml exec -T postgres sh -c 'grep -c -P \\r /docker-entrypoint-initdb.d/01-roles-and-databases.sh'
    ```

    Esperado: `eol: lf`; el recuento de retornos de carro dentro del contenedor es `0`. El arranque en frío del paso 3
    ya demuestra que el script se ejecutó (los roles y la base existen).

19. **Salud con la base caída.** Prueba la limitación documentada: el backend no consulta la base en su salud y el
    frontend sí.

    ```powershell
    docker compose -f docker-compose.yml stop postgres
    Start-Sleep -Seconds 120
    docker compose -f docker-compose.yml ps -a
    curl.exe -s -o NUL -w "%{http_code}`n" http://127.0.0.1:3001/api/tasks
    docker compose -f docker-compose.yml start postgres
    Start-Sleep -Seconds 120
    docker compose -f docker-compose.yml ps -a
    curl.exe -s -o NUL -w "%{http_code}`n" http://127.0.0.1:3001/api/tasks
    ```

    Esperado: con la base parada, `frontend` pasa a `unhealthy` (no se reinicia) y `backend` sigue `healthy`; la
    petición da `500` con un cuerpo genérico, sin detalles. Tras arrancar de nuevo la base, en unos minutos todo vuelve
    a `healthy` y la petición da `200`.

20. **Reconstrucción y limpieza.**

    ```powershell
    docker compose -f docker-compose.yml up -d --build --wait; $LASTEXITCODE
    docker compose -f docker-compose.yml ps -a
    docker compose -f docker-compose.yml down
    ```

    Esperado: código 0 y todo sano; `migrate` sigue en `Exited (0)` (si nada cambió, Compose no lo ejecuta de nuevo; se
    puede forzar con el comando del paso 5); los datos siguen. El `down` final conserva los datos. Reinicio completo
    opcional (BORRA los datos del despliegue; nunca contra el proyecto de desarrollo):

    ```powershell
    docker compose -f docker-compose.yml -p todo-app-deploy down -v
    ```

**Tabla de resultados.** Columna «Resultado»: `cumple` (el paso se comprobó completo), `parcial` (solo una parte; la
observación dice cuál), `no ejecutado` o `no cumple`. La observación recoge lo medido (tiempos, códigos, el valor
efectivo de los cupos).

| Paso | Qué se comprueba | Resultado | Observación |
| --- | --- | --- | --- |
| 1 | `.env` vacío falla; `.env` real válido | cumple | Ejecutado el 2026-10-26 por el usuario en Docker Desktop; sin observaciones. |
| 2 | Estado inicial limpio | no ejecutado | Queda como lista de verificación para quien despliegue. |
| 3 | Arranque en frío sano | cumple | Ejecutado el 2026-10-26; sin observaciones. Tiempo no anotado. |
| 4 | Roles, permisos, índice, sin base de pruebas | parcial | Solo la lista de bases (`\l`): aparece la base de desarrollo y ninguna base de pruebas. Roles, permisos, catálogo e índice no se ejecutaron. |
| 5 | Migración repetible | no ejecutado | Queda como lista de verificación para quien despliegue. |
| 6 | Migración fallida impide arrancar el resto | no ejecutado | Queda como lista de verificación para quien despliegue. |
| 7 | Puertos publicados | parcial | Comprobado en 127.0.0.1. La prueba con la IP de la red local no se ejecutó. |
| 8 | Red interna sin salida | no ejecutado | Queda como lista de verificación para quien despliegue. |
| 9 | Salud de los servicios | no ejecutado | Queda como lista de verificación para quien despliegue. |
| 10 | Aplicación en el navegador | cumple | Ejecutado el 2026-10-26; sin observaciones. |
| 11 | Estáticos y cabecera `Host` | parcial | Solo la respuesta `403` con `Host` ajeno. Los estáticos y el `Host` correcto no se ejecutaron. |
| 12 | Cupo compartido | no ejecutado | Queda como lista de verificación para quien despliegue. |
| 13 | API key mal puesta y rotación | no ejecutado | Queda como lista de verificación para quien despliegue. |
| 14 | `SIGTERM` real (backend, frontend, base) | parcial | Solo 14a (backend en reposo): `shutdown_started` y `shutdown_completed`, código de salida 0 y `OOMKilled` falso. Los pasos 14b, 14c y 14d no se ejecutaron. |
| 15 | Persistencia de los datos | cumple | Ejecutado el 2026-10-26; sin observaciones. |
| 16 | Sin secretos en imágenes ni registros | no ejecutado | Queda como lista de verificación para quien despliegue. |
| 17 | Usuario sin privilegios | parcial | Solo la parte `run --rm` con `id -u`. Las comprobaciones con los servicios en marcha (`/proc/1/status`) no se ejecutaron. |
| 18 | Finales de línea del script de inicio | no ejecutado | Queda como lista de verificación para quien despliegue. |
| 19 | Salud con la base caída | no ejecutado | Queda como lista de verificación para quien despliegue. |
| 20 | Reconstrucción y limpieza | parcial | Solo el `down` final, sin `-v`. La reconstrucción con `up -d --build --wait` no se ejecutó. |

**Cobertura de la comprobación (2026-10-26).** El usuario ejecutó en Docker Desktop 10 de los 20 pasos, total o
parcialmente: los pasos 1, 3, 10 y 15 completos, y los pasos 4, 7, 11, 14, 17 y 20 solo en parte. Los 10 pasos
restantes (2, 5, 6, 8, 9, 12, 13, 16, 18 y 19) no se ejecutaron y quedan como lista de verificación para quien
despliegue.
