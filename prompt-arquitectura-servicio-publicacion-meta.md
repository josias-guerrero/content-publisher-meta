# Prompt de especificación — Servicio de publicación programada (Meta Graph API)

> Este documento está pensado para pegarse como prompt/brief a un asistente de código (o para dárselo a otro desarrollador) y que arranque la construcción del servicio con contexto completo.

## Contexto del proyecto

Necesito construir un servicio backend independiente para publicar contenido de forma programada en Instagram y Facebook usando la Meta Graph API. El servicio debe exponer una API REST para que aplicaciones cliente en distintos lenguajes (TypeScript, Java, y potencialmente otros) puedan programar publicaciones sin necesidad de implementar la lógica de Meta directamente.

**Escala actual:** 5 cuentas propias (Instagram profesional + Facebook Page vinculada), todas administradas por la misma organización. Estas cuentas tienen rol asignado dentro de la app de Meta, por lo que **no se requiere App Review de Meta por ahora** — la app opera en modo desarrollo. Esto puede cambiar en una fase futura si se conectan cuentas de terceros (ver TODO).

## Decisiones de arquitectura ya tomadas

- **Un solo servicio**, no microservicios separados. La escala (5 cuentas) no justifica la complejidad de colas distribuidas tipo Redis/BullMQ.
- **Lenguaje del servicio:** Node.js + TypeScript. Expone REST; el lenguaje interno es invisible para los consumidores (TS, Java, etc.), así que se eligió por productividad y por el buen soporte de la comunidad para llamadas HTTP asíncronas a la Graph API.
- **Base de datos:** SQLite para empezar (suficiente para este volumen), migrable a Postgres sin cambiar el diseño si crece. Pero antes de usar SQLite quiero que evalues si no es mejor usar directamente Postgres.
- **Scheduler:** un loop interno (`setInterval` o `node-cron`) que revisa la base de datos cada minuto en busca de publicaciones pendientes cuya fecha ya llegó. No se usa una cola externa.
- **Autenticación con Meta:** tokens de larga duración almacenados cifrados en la base de datos, con un job diario que los refresca antes de que expiren.

## Modelo de datos

### Tabla `accounts`
| Campo | Tipo | Notas |
|---|---|---|
| `id` | UUID | |
| `platform` | `instagram` \| `facebook` | |
| `external_id` | string | `ig-user-id` o `page-id` de Meta |
| `access_token` | string (cifrado en reposo) | token de larga duración |
| `token_expires_at` | datetime | usado por el job de refresco |

### Tabla `posts`
| Campo | Tipo | Notas |
|---|---|---|
| `id` | UUID | |
| `account_id` | FK a `accounts` | |
| `caption` | text | |
| `media_urls` | JSON array | URLs públicas de imagen/video |
| `scheduled_at` | datetime | cuándo debe publicarse |
| `status` | `pending` \| `publishing` \| `published` \| `failed` | |
| `container_id` | string, nullable | id del contenedor de Meta una vez creado |
| `error_message` | text, nullable | |

## Endpoints REST

```
POST   /accounts              → registra una cuenta (guarda token, external_id)
GET    /accounts              → lista cuentas conectadas

POST   /posts                 → programa una publicación
  body: { accountId, caption, mediaUrls[], scheduledAt }
GET    /posts?status=pending  → lista publicaciones (filtrable por status)
GET    /posts/:id             → detalle de una publicación
DELETE /posts/:id             → cancela una publicación pendiente
```

## Flujo de publicación (obligatorio, no cambiar el orden)

Meta requiere un proceso de dos pasos para publicar en Instagram/Facebook:

1. **Crear contenedor de medios**: `POST /{ig-user-id}/media` con `image_url` (o `video_url`), `caption` y `access_token`. Devuelve un `container_id`.
2. **Esperar a que el contenedor esté listo**: consultar el `status_code` del contenedor hasta que sea `FINISHED` (puede tardar segundos, especialmente en video). No intentar publicar antes de esto — produce errores.
3. **Publicar**: `POST /{ig-user-id}/media_publish` con `creation_id` (el `container_id` del paso 1) y `access_token`.

**Detalle importante:** el contenedor expira si no se publica dentro de 24 horas de creado. Por eso el contenedor solo debe crearse cuando la publicación esté próxima a su `scheduled_at`, no al momento de programarla — el loop del scheduler ya cubre esto naturalmente al revisar solo publicaciones cuya fecha ya llegó.

## Job de refresco de tokens

Un cron separado (una vez al día) debe:
1. Buscar cuentas cuyo `token_expires_at` esté a menos de 7 días.
2. Llamar al endpoint de refresco de token de larga duración de Meta.
3. Actualizar `access_token` y `token_expires_at` en la base de datos.

## Qué construir primero (orden sugerido)

1. Estructura base del proyecto Node/TypeScript (Express o Fastify).
2. Modelo de datos y migraciones (SQLite).
3. Endpoints de `accounts` (sin OAuth todavía — insertar tokens manualmente para las 5 cuentas propias).
4. Endpoints de `posts` (crear, listar, cancelar).
5. Función `publishPost()` con el flujo de tres pasos de Meta.
6. Loop del scheduler que llama a `publishPost()`.
7. Job de refresco de tokens.
8. Pruebas end-to-end con una de las 5 cuentas reales.

---

## TODO para fases futuras (no implementar todavía)

Estas son las cosas que quedan pendientes intencionalmente porque no se necesitan a la escala actual, pero que hay que tener en mente para no bloquear el crecimiento del proyecto:

- [ ] **Flujo OAuth para conectar cuentas de terceros.** Ahora mismo los tokens se insertan manualmente porque las 5 cuentas son propias. Si el servicio va a permitir que otras personas/organizaciones conecten sus propias cuentas de Instagram/Facebook, hay que construir el flujo de autorización OAuth completo (login con Facebook, selección de página/cuenta de Instagram, guardado de token).
- [ ] **App Review de Meta.** Necesario en el momento en que se agreguen cuentas sin rol en la app. Implica: grabar el screencast de demostración, completar verificación empresarial (Business Verification) si la app se hace pública, y solicitar los permisos `instagram_business_basic` e `instagram_business_content_publish` formalmente.
- [ ] **Rate limiting y manejo de cuotas de Meta.** A mayor escala (más cuentas, más publicaciones), hay que validar cuotas antes de encolar publicaciones masivas y manejar el header de rate limit de Meta para no ser bloqueado.
- [ ] **Manejo robusto de errores de la Graph API**, en particular el error 9007 (contenedor no listo) con reintentos y backoff, y manejo de tokens revocados por el usuario (marcar cuenta como desconectada en vez de reintentar indefinidamente).
- [ ] **Migración de SQLite a Postgres** si el volumen de cuentas/publicaciones crece más allá de lo que un solo archivo puede manejar cómodamente.
- [ ] **Cifrado de tokens en reposo** con una solución real de gestión de secretos (no solo cifrado simple en la base de datos) si el proyecto pasa a producción con datos de terceros.
- [ ] **Observabilidad**: logs estructurados, alertas cuando una publicación falla o un token está por expirar, dashboard básico de estado.
- [ ] **Webhooks de Meta** si más adelante se necesita reaccionar a eventos en tiempo real (comentarios, menciones) en vez de solo publicar.
- [ ] **Autenticación de la propia API REST** (API keys o JWT) para que los clientes en TypeScript/Java no llamen al servicio sin autenticarse — no cubierto en el diseño actual porque todo corre en la misma organización, pero es necesario antes de exponer el servicio más ampliamente.
- [ ] **Soporte para Reels/Stories/carruseles**, que tienen parámetros y límites distintos a las publicaciones de feed simples cubiertas en el diseño inicial.

---

*Este documento resume decisiones de arquitectura conversadas y sirve como punto de partida. Actualízalo a medida que el proyecto avance de fase (cuentas propias → cuentas de terceros → producción pública).*
