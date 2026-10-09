# Guía de pruebas: publisher + Tiko

La mejor primera prueba completa es un **staging aislado con HTTPS**, dos servicios y cuentas designadas para pruebas. Los mocks validan el código; el navegador, los callbacks públicos y Meta deben probarse juntos. No usar producción como sandbox, ni conectar volúmenes, cookies, colas o secretos de producción a una preview. No se ha publicado nada real durante esta implementación.

## 1. Repetir las verificaciones locales

En el publisher:

```bash
npm run typecheck
npm test
npm run fixtures:media -- /tmp/tiko-meta-fixtures-nuevas
```

Necesita Node compatible con las dependencias instaladas, FFmpeg y ffprobe. El último comando crea dos JPEG cuadrados y un MP4 vertical de cinco segundos, sin personas ni material real; exige un directorio nuevo. No publica ni modifica bases. En Tiko, ejecutar desde su repositorio:

```bash
node --check server.js
node lib/publisher-review.test.js
node lib/media-access.test.js
node lib/publisher-deletion.test.js
```

Son bases temporales/en memoria. Se prueban firmas, aislamiento, idempotencia, workers, medios reales sintéticos, borrado y recuperación. No prueban permisos concedidos por Meta ni configuración de Coolify.

## 2. Preparar dos previews en Coolify

Para el alta manual por GitHub App, variables completas, montajes e inicialización antes del arranque, seguir primero [guia-coolify-manual.md](guia-coolify-manual.md).

Usar la rama `feat/meta-app-review` de cada repo, sin fusionarla a `main`. Si Coolify despliega desde remoto, publicar primero las ramas revisadas mediante el procedimiento habitual; los cambios de esta sesión siguen locales. Crear dominios distintos, por ejemplo `tiko-staging.<tu-dominio>` y `publisher-staging.<tu-dominio>`, con HTTPS válido. En las primeras pruebas usar bases nuevas y archivos sintéticos. El ensayo con una copia de datos existentes es una fase separada con workers apagados y salida hacia Meta bloqueada.

| Publisher | Tiko | Relación |
|---|---|---|
| `PUBLIC_BASE_URL` | `BASE_URL` | origen HTTPS propio de cada servicio |
| `API_KEY` | `PUBLISHER_API_KEY` | mismo secreto exclusivo de staging |
| `CONTEXT_SIGNING_SECRET` | `PUBLISHER_CONTEXT_SIGNING_SECRET` | mismo secreto, mínimo 32 caracteres |
| `EVENT_SIGNING_SECRET` | `PUBLISHER_EVENT_SIGNING_SECRET` | mismo secreto, mínimo 32 caracteres |
| — | `PUBLISHER_URL` | origen del publisher de staging |
| `EVENT_DESTINATION` | — | `https://tiko-staging.<dominio>/api/integrations/publisher/events` |
| `MEDIA_ALLOWED_HOSTS` | — | hostname exacto de Tiko de staging, sin esquema |
| `DELETION_LEDGER_PATH` y `DELETION_LEDGER_SECRET` | `TIKO_DELETION_LEDGER_PATH` y `TIKO_DELETION_LEDGER_SECRET` | registros y secretos propios, independientes entre servicios |
| — | `MEDIA_SHARE_SIGNING_SECRET` | secreto propio de Tiko, mínimo 32 caracteres |

Configurar también las variables de las apps Meta de prueba y la clave AES de 64 caracteres hexadecimales del publisher. `NODE_ENV=production` en ambos previews activa las validaciones; staging describe el destino, no el modo de Node. Tiko carga configuración mediante `lib/config.js`; scripts de Node no cargan `.env` de forma universal. No copiar secretos a la terminal de chat.

Montar data/uploads de staging separados de producción. Para cada servicio montar el registro de eliminación en **otro volumen**, por ejemplo `/deletion-ledger/events.jsonl`; no debe retroceder al restaurar SQLite/uploads. Crear el directorio con permisos para el usuario del contenedor. Para el primer despliegue vacío, usar `BOOTSTRAP_NEW_INSTALLATION=true`: los nuevos entrypoints inicializan registros y esquema sin comandos manuales. Una vez listo, cambiar a false. No usar esta opción al restaurar datos existentes. Ver la [guía manual actualizada](guia-coolify-manual.md) para los montajes y el flujo exacto.

Conservar `WORKERS_ENABLED=false`, `VERIFIED_FORMATS=` y `STAGING_ONLY=true` en el publisher. Arrancar ambos servicios. Nunca inicializar un registro vacío para hacer arrancar una restauración: recuperar el registro independiente existente. Ajustar timeouts del proxy para descargas/inspección secuencial de carruseles; máximo 60 s de descarga y 15 s de ffprobe por archivo. Empezar con archivos pequeños.

## 3. Crear el escenario mínimo

Crear en Tiko un usuario administrador de prueba y dos clientes, A y B. Asignar explícitamente sus membresías en la base de staging, usando los IDs reales creados allí. No inferir agencia por nombres, correo o handle. Ejemplo de estructura SQL (reemplazar valores):

```sql
INSERT INTO publisher_memberships(user_id,agency_id,client_id)
VALUES ('ID_USUARIO_PRUEBA','AGENCIA_PRUEBA','ID_CLIENTE_A');
```

Agregar otra membresía para el cliente B y crear un segundo usuario con acceso **solo** a B para probar aislamiento. Cada usuario que deba ver medios necesita su membresía; diseñadores además conservan la restricción por piezas asignadas. El alta histórica de clientes no asigna agencias automáticamente. Si la lista aparece vacía, comprobar membresías antes de relajar permisos.

Subir los tres archivos sintéticos al cliente A. Crear una pieza con un archivo y otra pieza que comparta ese archivo: servirá para probar preservación al eliminar. Para probar una eliminación con archivo exclusivo, subir también un archivo no reutilizado.

En el publisher ejecutar:

```bash
npm run check:staging
```

Resultado: `ok: true`. Verifica configuración local, ffprobe, integridad/migración, registros y cola mapeada. **No verifica por sí solo** el aislamiento real de volúmenes, accesibilidad pública, panel de Meta ni permisos. Confirmar esos puntos en Coolify.

## 4. Probar acceso antes de publicar

| Acción | Resultado esperado |
|---|---|
| Abrir `/privacidad` y `/eliminacion-de-datos` sin sesión | páginas públicas legibles |
| Abrir `/uploads/<archivo>` en incógnito | 404, sin contenido |
| Abrir enlace de un cliente y después sus medios | se ven los archivos de sus piezas; cookie de alcance con expiración |
| Usar esa cookie para otro cliente o un medio no compartido | 404 |
| Abrir enlace de diseñador | solo medios de piezas asignadas; reasignar invalida acceso a la pieza anterior |
| Rotar/revocar token de enlace | cookie antigua pierde acceso |
| Abrir una URL opaca `/publisher-media/<token>` válida | permite descargar el medio hasta su vencimiento; sin abrir el resto de la biblioteca |
| Pedir API privada del publisher sin clave/contexto | rechazo |
| Usuario B pide cuenta/post/media de A por ID | rechazo, aunque conozca el ID |

Purgar cualquier caché externa previa de `/uploads` al promover el cambio; un servidor no puede retirar una copia ya descargada por terceros. La ruta ahora usa `private, no-store`.

## 5. Conectar Meta y ejecutar diagnóstico sin publicar

Configurar los redirects y callbacks de los **productos/apps correctos**, usando las URLs de staging de [OAuth](meta-setup.md) y [eliminación](data-deletion.md). Confirmar versión de Graph soportada en el panel. No asumir que una misma configuración cubre Instagram Login y Facebook Login. Los usuarios de prueba deben tener los roles y activos aptos que Meta permita para esa app.

Desde Tiko, conectar primero Instagram y seleccionar explícitamente el activo. Repetir con Facebook y seleccionar la página. Confirmar que cancelar consentimiento, rechazar permisos requeridos o repetir el callback no crea una conexión utilizable. Ejecutar **diagnóstico** desde la UI: comprueba identidad y acceso, sin publicar. Alternativa CLI: `scripts/meta-evidence.ts --diagnostic ACCOUNT_ID` con las variables `TEST_*` descritas en [App Review](app-review.md).

Antes de continuar deben funcionar: popup/callback, selección, lista filtrada por cliente y diagnóstico. Si falla algo, guardar solo código de error, hora, plataforma y `requestId`; no copiar tokens ni URLs de callback con `code`/`state`.

## 6. Primera publicación real, acotada

Usar únicamente activos designados y autorización del titular. En **staging** habilitar inicialmente `VERIFIED_FORMATS=instagram.photo` y luego `WORKERS_ENABLED=true`. Esto permite obtener evidencia del formato; **no** lo habilita ni lo certifica en producción.

1. Programar un JPEG del cliente A para cinco minutos después, con texto identificable de prueba.
2. Confirmar un único ID local y estado `pending`. Repetir la misma intención/reintentar tras simular pérdida de respuesta: debe conservar ese ID.
3. Observar `publishing` y finalmente `published`, con ID remoto. Abrir la publicación en Instagram y comprobar cuenta, contenido y formato. Un contenedor `FINISHED` no basta.
4. Programar otra pieza y cancelarla antes de su hora: debe quedar `cancelled` y no aparecer en Meta.
5. Una cancelación cuando ya publica debe informar conflicto; no ocultarlo ni crear otra publicación.

Si aparece `reconciling`, no reprogramar ni resetear la fila: comprobar primero si Meta publicó. Ver [cola y recuperación](operations.md).

## 7. Ampliar la matriz y probar fallos

Habilitar en staging un formato adicional cada vez, según [media-formats.md](media-formats.md). Completar Instagram foto, carrusel ordenado, reel con portada, reel con fotograma, story imagen/video; Facebook foto, múltiples fotos, video, reel y story imagen/video. Registrar resultado por formato y App ID. Meta puede rechazar formatos/permisos aunque las pruebas locales pasen.

Probar además: medio inaccesible, archivo modificado después de programar, tipo de archivo falso, duración/códec/tamaño inválidos, cuenta sin elegibilidad, usuario B con ID ajeno, sesión expirada, permiso parcial y desconexión. En cada error comprobar que no se haya creado contenido remoto inesperado.

Para resiliencia, solo en staging: detener Tiko durante la entrega de eventos y recuperarlo (outbox debe reintentar); interrumpir el worker durante una operación y reiniciarlo (resultado incierto no se publica otra vez); intentar dos ejecuciones de worker contra el mismo job (un único resultado remoto). Capturar IDs locales/remotos y contar publicaciones reales, no solo respuestas HTTP.

## 8. Ensayar eliminación y restauración

Usar una conexión creada exclusivamente para este ensayo. Seguir [data-deletion.md](data-deletion.md): callback firmado → registro durable → cancelación de pendientes → manifiesto de Tiko → revisión de compartidos y respaldos → limpieza → comprobante firmado → cierre del publisher. Los scripts muestran un plan antes de eliminar; no ejecutar `apply` sobre bases reales para experimentar.

Antes del borrado obtener una copia consistente de SQLite/uploads de staging. Después restaurar esa copia **manteniendo los registros de eliminación actuales**, con workers apagados. Arrancar: deben reaplicarse las eliminaciones antes de aceptar tráfico. Verificar credenciales vacías/revocadas, medios exclusivos ausentes, compartidos conservados y otra cuenta sin cambios. Probar también registro faltante/corrupto: el arranque debe fallar. No modificar registros válidos fuera de este entorno desechable.

## 9. Evidencia y criterio de salida

Por cada prueba registrar: ambiente, commit, fecha UTC, App ID/proveedor, versión Graph, caso/permiso, resultado esperado/real, `requestId`/trace ID si existe y IDs local/remoto. No guardar secretos. Revisar el uso de permisos en el panel de Meta y preparar el screencast/usuario revisor según [app-review.md](app-review.md).

Pasar a producción requiere la matriz real aprobada, restauración ensayada, asignaciones históricas verificadas y decisiones de privacidad/retención/infraestructura cerradas. Las automatizaciones locales no sustituyen estas pruebas. Para guiar la primera sesión bastan las dos URLs de staging, confirmación de sus volúmenes independientes y qué cuentas/páginas de prueba se usarán; los secretos se configuran en Coolify.
