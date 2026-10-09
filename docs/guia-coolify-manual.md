# Despliegue manual de staging con GitHub App y respaldos externos

Esta guía reemplaza el manifiesto automatizado descartado. No se crearon aplicaciones, volúmenes ni despliegues en Coolify durante la inspección. Se verificó Coolify 4.4.2, el proyecto Tiko con entorno staging y los DNS `staging.tikocloud.com` / `publisher-staging.tikocloud.com`. Verificar nuevamente antes del despliegue. La rama de esta entrega es `feat/meta-app-review` en ambos repositorios; el despliegue y la validación real siguen pendientes.

## 1. Decisión de almacenamiento

Para la primera integración recomiendo **SQLite y medios activos en volúmenes persistentes locales, más respaldos en un bucket privado fuera del VPS**. Esto mantiene el flujo implementado y permite probar Meta sin introducir otra migración de almacenamiento.

| Uso del bucket | Estado actual | ¿Cambiar código ahora? |
|---|---|---|
| Destino de backups gestionados por Coolify | Configuración de infraestructura | No cambia la aplicación; configurar copias consistentes y restauración |
| Biblioteca activa de imágenes y videos | Tiko escribe/lee archivos locales y genera derivados locales | Sí: implementar un backend de objetos y migrar referencias |
| Guardar el archivo SQLite activo dentro de S3 | No es un sistema de archivos compatible para este uso | No hacerlo; subir solamente copias consistentes |
| Réplica externa de registros de eliminación | El registro activo es un archivo local independiente | Configurar réplica actual y recuperación independiente; no restaurarlo desde un backup antiguo |

Un bucket de medios activos no sustituye un respaldo con historial: un borrado accidental puede afectar al original. Un MinIO en el mismo VPS tampoco protege por sí solo contra perder ese VPS.

La ruta actual `/publisher-media/:token` lee originales/portadas del disco, comprueba vencimiento y sirve GET/HEAD/Range. El publisher rechaza redirecciones. Una futura integración S3 puede mantener esta URL estable y transmitir los objetos privados desde Tiko; devolver simplemente un 302 a S3 no es compatible con la inspección actual. Tampoco se deben guardar URLs S3 firmadas de corta duración al programar una publicación para meses después. AWS S3 limita sus URLs firmadas con SDK a un máximo de siete días y las credenciales temporales pueden acortarlo. [AWS](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html).

## 2. GitHub App: acceso a los dos repositorios

1. Seleccionar la rama `feat/meta-app-review` de ambos repositorios y comprobar que contiene `ops/entrypoint.sh` y los scripts de backup antes del build.
2. En Coolify, entrar a Sources y conectar/configurar la GitHub App.
3. Instalar la app en el propietario de los repositorios y darle acceso a **Selected repositories**: `content-publisher-meta` y `tiko-andres` (ajustar al propietario/nombre real si cambió).
4. Dentro de Tiko → staging, crear dos recursos **Private Repository (with GitHub App)** usando esa integración.
5. Elegir Dockerfile, directorio `/`, archivo `/Dockerfile`, rama `feat/meta-app-review`; desactivar Auto Deploy inicialmente.

| Recurso | Repositorio | Puerto interno | Dominio |
|---|---|---|---|
| publisher-staging | content-publisher-meta | 3000 | https://publisher-staging.tikocloud.com |
| tiko-staging | tiko-andres | 3005 | https://staging.tikocloud.com |

No publicar puertos adicionales al host si el proxy de Coolify ya dirige el tráfico. En el formulario de dominio indicar el puerto interno si esa pantalla lo requiere; las variables BASE_URL/PUBLIC_BASE_URL son los orígenes públicos HTTPS sin `:3000`/`:3005`.

Las credenciales de GitHub App viven en **Sources de Coolify**, no en los `.env` de Tiko/publisher. Coolify administra App ID, claves y webhooks de esa integración. No necesitas un PAT en el contenedor. [Guía de GitHub App](https://coolify.io/docs/applications/sources/github/app).

## 3. Crear secretos exclusivos de staging

Los secretos de esta instalación ya están generados. Guardarlos en un gestor de secretos; no subirlos a Git. Para otra instalación, usar el generador con una carpeta de salida nueva.

El generador `npm run env:staging` crea siete secretos independientes, comparte correctamente los tres pares entre servicios y escribe `publisher.env` y `tiko.env` con permisos 0600 en `.secrets/staging/` (excluido de Git y Docker). No sobrescribe una carpeta existente ni rota claves por accidente. En esta entrega ya se ejecutó localmente; usa esos archivos para copiar las variables a Coolify, sin regenerarlos salvo que quieras un entorno nuevo. Completa los campos de Meta. La contraseña del administrador se establece al crear su usuario en Tiko, no por variable de entorno.

Tres pares deben coincidir entre servicios:

| Publisher | Tiko | Valor |
|---|---|---|
| API_KEY | PUBLISHER_API_KEY | mismo secreto API de staging |
| CONTEXT_SIGNING_SECRET | PUBLISHER_CONTEXT_SIGNING_SECRET | mismo secreto de contexto de staging |
| EVENT_SIGNING_SECRET | PUBLISHER_EVENT_SIGNING_SECRET | mismo secreto de eventos de staging |

Los demás secretos son distintos. No copiar las claves de producción ni su base para el primer ensayo. Si después ensayas restauración de datos cifrados existentes, necesitarás custodiar las claves correspondientes a esa copia; cambiar la clave AES no descifra tokens antiguos.

## 4. Variables del publisher

Pegar en Environment Variables del recurso **publisher-staging**. Sustituir cada `REEMPLAZAR_...`. Marcar variables para **runtime**, no para build. `NODE_ENV=production` activa validaciones de seguridad incluso en staging.

```dotenv
NODE_ENV=production
HOST=0.0.0.0
PORT=3000
DATABASE_PATH=/app/data/publisher.db
PUBLIC_BASE_URL=https://publisher-staging.tikocloud.com

API_KEY=REEMPLAZAR_SECRETO_API_STAGING
CONTEXT_SIGNING_SECRET=REEMPLAZAR_SECRETO_CONTEXTO_STAGING
EVENT_SIGNING_SECRET=REEMPLAZAR_SECRETO_EVENTOS_STAGING
EVENT_DESTINATION=https://staging.tikocloud.com/api/integrations/publisher/events

TOKEN_ENCRYPTION_KEY=REEMPLAZAR_CLAVE_AES_64_HEXADECIMALES
TOKEN_ENCRYPTION_KEY_ID=v1
TOKEN_PREVIOUS_KEYS={}

META_INSTAGRAM_APP_ID=REEMPLAZAR_ID_APP_INSTAGRAM
META_INSTAGRAM_APP_SECRET=REEMPLAZAR_SECRET_APP_INSTAGRAM
META_FACEBOOK_APP_ID=REEMPLAZAR_ID_APP_FACEBOOK
META_FACEBOOK_APP_SECRET=REEMPLAZAR_SECRET_APP_FACEBOOK
META_GRAPH_API_VERSION=REEMPLAZAR_VERSION_GRAPH_CONFIRMADA
META_HTTP_TIMEOUT_MS=15000

MEDIA_ALLOWED_HOSTS=staging.tikocloud.com
MEDIA_MAX_BYTES=268435456
WORKERS_ENABLED=false
VERIFIED_FORMATS=
TRUST_PROXY=
LOG_LEVEL=info
STAGING_ONLY=true

DELETION_LEDGER_PATH=/deletion-ledger/events.jsonl
DELETION_LEDGER_SECRET=REEMPLAZAR_SECRETO_REGISTRO_PUBLISHER
```

`META_GRAPH_API_VERSION` debe tener forma `vNN.0`, elegida entre las versiones soportadas por tus productos y confirmada en el panel. El valor heredado `v21.0` no certifica soporte actual. Instagram App ID/Secret son obligatorios en el código actual incluso para arrancar; configurar una app válida de pruebas. Si Facebook se probará después, **omitir** sus dos variables por ahora. No confundir el App ID general con el ID específico que el producto Instagram Login indique.

Dejar TRUST_PROXY vacío hasta identificar los proxies reales; no poner `true` o `*`. WORKERS_ENABLED=false y VERIFIED_FORMATS vacío impiden empezar a publicar durante el montaje. No hay variables de bucket necesarias para respaldos administrados por Coolify.

## 5. Variables de Tiko

Pegar en Environment Variables del recurso **tiko-staging**, también solo runtime:

```dotenv
NODE_ENV=production
PORT=3005
BASE_URL=https://staging.tikocloud.com

PUBLISHER_URL=https://publisher-staging.tikocloud.com
PUBLISHER_API_KEY=REEMPLAZAR_MISMO_SECRETO_API_STAGING
PUBLISHER_CONTEXT_SIGNING_SECRET=REEMPLAZAR_MISMO_SECRETO_CONTEXTO_STAGING
PUBLISHER_EVENT_SIGNING_SECRET=REEMPLAZAR_MISMO_SECRETO_EVENTOS_STAGING

MEDIA_SHARE_SIGNING_SECRET=REEMPLAZAR_SECRETO_ENLACES_STAGING
TIKO_DELETION_LEDGER_PATH=/deletion-ledger/events.jsonl
TIKO_DELETION_LEDGER_SECRET=REEMPLAZAR_SECRETO_REGISTRO_TIKO

RESPALDO_CARPETA=false
GOOGLE_CLIENT_ID=
GOOGLE_API_KEY=
OPENAI_API_KEY=
```

RESPALDO_CARPETA controla el mecanismo local histórico de copias de archivos, no los backups de Coolify ni un bucket. Dejarlo apagado si centralizas respaldos en Coolify. Las integraciones Google/OpenAI no hacen falta para las pruebas de publicación; se habilitan después con sus propias credenciales. Tiko usa `/app/data/tiko.db` y `/app/uploads` por código, no mediante DATABASE_PATH. Los App Secrets de Meta van en el publisher, no en Tiko.

## 6. Volúmenes y primer arranque automático

Ya hay entrypoints en ambos Dockerfiles. Para una instalación NUEVA, con volúmenes vacíos, definir `BOOTSTRAP_NEW_INSTALLATION=true`. El publisher crea el registro y migra su base nueva; Tiko crea su registro y luego su servidor inicializa las tablas. El proceso conserva un marcador durable de instalación. Un reinicio no reinicializa nada, y la ausencia/corrupción de un registro existente bloquea el arranque aunque la variable siga en true. Después del primer arranque correcto, cambiarla a false en Coolify.

Usar **volúmenes Docker nombrados nuevos**, sin Source Path del host, montados en los siguientes destinos. Coolify puede prefijar los nombres; deben ser distintos en cada recurso:

| Aplicación | Volumen sugerido | Destination Path |
|---|---|---|
| publisher-staging | publisher-staging-data | /app/data |
| publisher-staging | publisher-staging-ledger | /deletion-ledger |
| publisher-staging | publisher-staging-backups | /backups |
| publisher-staging | publisher-staging-ledger-replica | /deletion-replica |
| tiko-staging | tiko-staging-data | /app/data |
| tiko-staging | tiko-staging-uploads | /app/uploads |
| tiko-staging | tiko-staging-ledger | /deletion-ledger |
| tiko-staging | tiko-staging-backups | /backups |
| tiko-staging | tiko-staging-ledger-replica | /deletion-replica |

Las imágenes crean esos directorios con permisos para sus usuarios antes de montar los volúmenes nuevos. Si prefieres bind mounts, debes configurar su propietario/permisos en el host; no se reparan permisos de rutas existentes automáticamente. Nunca reutilizar montajes de producción.

Agregar en ambos recursos:

```dotenv
BOOTSTRAP_NEW_INSTALLATION=true
BACKUP_DIRECTORY=/backups
DELETION_REPLICA_DIRECTORY=/deletion-replica
```

Desplegar desde la rama publicada. Comprobar `/health` en publisher y `/login` en Tiko. En la terminal del publisher ejecutar `npm run check:staging`. Para bases ya existentes, el entrypoint verifica el registro y no migra automáticamente: las migraciones siguen siendo una acción de mantenimiento respaldada, `npm run db:migrate`. Si se pierden los volúmenes, restaurarlos; no activar el modo de instalación nueva para reemplazar un entorno perdido.

Ya no necesitas crear archivos de secretos en `/root`, ejecutar contenedores de mantenimiento ni inicializar registros manualmente para el primer staging vacío. La clave API de Coolify no interviene en este flujo.

## 7. Credenciales y callbacks de Meta

Usar preferentemente apps y activos dedicados para el ensayo destructivo. Si decides utilizar las apps actuales, revisar su configuración antes de tocar callbacks: añadir un redirect OAuth no equivale a poder configurar dos destinos independientes para desautorización o eliminación. No reemplazar callbacks activos de producción.

| Producto / función | URL de staging |
|---|---|
| Instagram OAuth | https://publisher-staging.tikocloud.com/auth/instagram/callback |
| Facebook OAuth | https://publisher-staging.tikocloud.com/auth/facebook/callback |
| Instagram desautorización | https://publisher-staging.tikocloud.com/meta/instagram/deauthorize |
| Facebook desautorización | https://publisher-staging.tikocloud.com/meta/facebook/deauthorize |
| Instagram eliminación | https://publisher-staging.tikocloud.com/meta/instagram/data-deletion |
| Facebook eliminación | https://publisher-staging.tikocloud.com/meta/facebook/data-deletion |
| Privacidad | https://staging.tikocloud.com/privacidad |
| Instrucciones de eliminación | https://staging.tikocloud.com/eliminacion-de-datos |

Configurar las URLs y roles que admita cada producto del panel de Meta; no todas las casillas son universales. Se necesita una cuenta Instagram profesional controlada por ti, Business para cubrir Stories en esta implementación; para Facebook, una página de prueba con un usuario que pueda publicar. Aceptar las invitaciones/roles de prueba correspondientes. Iniciar OAuth desde Tiko: los tokens de usuario/página se obtienen en ese flujo, no se copian como variables del servidor. No necesitas poner contraseñas de Instagram/Facebook en `.env`.

La evidencia final para App Review debe corresponder a la app que se presentará. Una prueba exitosa en otra app no demuestra el uso de permisos en ella. Ver [configuración Meta](meta-setup.md) y [guía de pruebas](guia-pruebas.md).

## 8. Bucket externo: configuración recomendada para respaldos

Elegir un proveedor S3 compatible externo al VPS. Para este primer despliegue importa más tener una restauración comprobada que cambiar el proveedor de almacenamiento activo. Crear un bucket privado de staging; producción tendrá otro destino/credenciales. No habilitar acceso público para respaldos.

En **S3 Storage** del equipo de Coolify agregar los siguientes datos del proveedor:

| Dato | De dónde sale |
|---|---|
| Name | nombre descriptivo: tiko-staging-backups |
| Bucket | nombre exacto del bucket privado |
| Endpoint | endpoint S3 HTTPS indicado por el proveedor, sin añadir el nombre del bucket salvo que su integración lo exija |
| Region | región indicada por el proveedor |
| Access Key | credencial limitada al bucket/prefijo de respaldo |
| Secret Key | secreto correspondiente |

Conceder las operaciones necesarias de listar, leer, escribir y eliminar respaldos dentro del alcance asignado; la limpieza de retención necesita poder borrar. Validar la conexión en Coolify. No usar credenciales maestras de toda la cuenta. **Estas credenciales van en Coolify, no en el `.env` de Tiko/publisher.** [S3 Storage](https://coolify.io/docs/core/s3-storage/overview).

Después entrar a **Persistent Storage → montaje → Backups**, crear calendario y seleccionar el destino S3. Coolify soporta archivos de respaldo de montajes, retención local/remota y la opción de detener contenedores durante el archivo. Las rutas exactas de navegación pueden variar con la versión. [Respaldos de montajes](https://coolify.io/docs/core/persistent-storage/storage-mounts/backups).

Para SQLite embebido en estas aplicaciones, elegir una estrategia consistente:

- **Sencilla con mantenimiento:** pausar las aplicaciones implicadas y respaldar bases, uploads y derivados durante la misma ventana. La opción de Coolify que detiene contenedores protege el montaje que está archivando, pero no garantiza una instantánea atómica entre distintos calendarios/montajes; mantener la pausa durante el conjunto si se requiere coherencia estricta.
- **Sin pausa prolongada:** generar una copia SQLite con su API de backup y después transferirla al bucket mediante un job, coordinando cambios en los medios. Los comandos implementados `npm run backup` (publisher) y `node scripts/backup.js` (Tiko) crean estas copias. Tiko incluye los originales referenciados por la copia de la base y omite derivados regenerables; un archivo ausente o detectado como cambiante invalida ese intento. Se ejecutan mediante Scheduled Tasks de Coolify, no por agregar las variables. No copiar solo el `.db` vivo con `cp` o `tar`. [SQLite Backup API](https://www.sqlite.org/backup.html).

Empezar con una copia diaria de staging y ejecutar una restauración. Para producción elegir frecuencia según pérdida de trabajo tolerable; una propuesta inicial sería bases cada hora y archivos diariamente, pero requiere el job consistente y puede perder archivos recientes si su copia es menos frecuente. Acordar retención con la política de eliminación antes de fijar días de conservación o bloqueos inmutables.

Los registros de eliminación necesitan una réplica externa actual, separada del conjunto que se restaura. Una copia diaria puede perder solicitudes recientes: no considerar resuelta la recuperación contra pérdida completa del VPS hasta configurar y probar esa réplica. Al recuperar una base antigua, usar el registro de eliminación más reciente; no su versión del día de la base. Versionado del bucket no elimina versiones previas de datos personales: incluirlas en el procedimiento de retención/borrado.

Guardar claves AES, claves de firma de registros y secretos necesarios en un gestor independiente. El backup de la instancia Coolify es adicional: conservar también su APP_KEY para recuperar secretos, y no confundirlo con el backup de las aplicaciones. [Recuperación de Coolify](https://coolify.io/docs/core/backup-and-recovery/instance-backup).

## 9. Si quieres el bucket como biblioteca activa ahora

Eso sí implica una entrega de código: interfaz de almacenamiento local/S3, cargas al bucket, referencias por objeto, descargas autorizadas con GET/HEAD/Range, extracción temporal de miniaturas/portadas, objetos inmutables durante programación, borrado de originales/derivados/versiones, y una migración que preserve IDs y archivos compartidos. El bucket debe permanecer privado; la app otorga el acceso temporal.

No agregar variables inventadas como S3_BUCKET esperando que el código cambie de comportamiento. Los nombres y credenciales del futuro backend S3 se definirían al implementarlo. Mi recomendación para llegar a las pruebas actuales es **backups externos ahora; biblioteca activa S3 como cambio separado** si el volumen de medios o las necesidades de varios servidores lo justifican.

## 10. Primer recorrido

Crear el usuario de prueba y dos clientes, asignar publisher_memberships explícitamente como indica [guia-pruebas.md](guia-pruebas.md), cargar archivos sintéticos y verificar aislamiento. Conectar Meta y hacer diagnóstico. Solo después habilitar un formato de staging y sus workers para la primera publicación real autorizada. No dar por terminada la configuración solo porque ambos contenedores estén verdes.

## 11. Calendarios que debes configurar en Coolify

1. **Scheduled Tasks del publisher:** `npm run backup`, por ejemplo `0 * * * *`.
2. **Scheduled Tasks de Tiko:** `node scripts/backup.js`, por ejemplo `10 * * * *`.
3. **Backups del volumen `/backups` de cada recurso:** subir a tu destino S3 después de completarse el job; el margen debe superar el tiempo observado del respaldo. No archivar mientras se ejecuta el job: comprobar que no existe `/backups/.backup.lock`. Directorios `.partial-*` no son restauraciones válidas.
4. **Backups de `/deletion-replica`** hacia un destino separado. Cada job copia primero el registro firmado actual a ese volumen. Esto tiene una ventana de pérdida igual al intervalo de copia/subida; no se afirma replicación continua ni pérdida cero. El registro local `/deletion-ledger` continúa siendo el autoritativo.
5. Configurar avisos de fallos, espacio disponible y retención en S3. Por defecto el script no elimina snapshots locales; opcionalmente `BACKUP_KEEP=7` conserva los últimos siete snapshots completos locales de cada servicio. Configúralo solo tras verificar subidas y definir la retención. No poda registros de eliminación. La retención de archivos S3 de Coolify es independiente de esta limpieza local.

Para comprobar una copia descargada: `node ops/verify-backup.cjs RUTA_DEL_SNAPSHOT`. Verifica manifiesto, tamaños, hashes e integridad SQLite sin restaurar ni publicar. No sustituye el ensayo de restauración en un recurso desechable. La copia de cada servicio es consistente dentro del alcance indicado, no una transacción distribuida simultánea entre Tiko, publisher y Meta.

Asignaciones explícitas de clientes, desde la terminal de Tiko en Coolify:

```bash
node scripts/assign-publisher-membership.js --list
node scripts/assign-publisher-membership.js ID_USUARIO ID_CLIENTE ID_AGENCIA --dry-run
node scripts/assign-publisher-membership.js ID_USUARIO ID_CLIENTE ID_AGENCIA --apply
```

El comando comprueba usuario/cliente existentes y rechaza cambiar una agencia ya asignada. No infiere propietarios por nombre ni concede acceso global a todos los usuarios.
