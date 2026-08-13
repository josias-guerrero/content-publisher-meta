# Content Publisher API

<!--toc:start-->

- [Content Publisher API](#content-publisher-api)
  - [Requisitos](#requisitos)
  - [Configuración Local](#configuración-local)
  - [Correr el Servidor](#correr-el-servidor)
  - [Autenticación con API Key](#autenticación-con-api-key)
    - [Cabecera](#cabecera)
    - [Ejemplo con cURL](#ejemplo-con-curl)
    - [Errores de autenticación](#errores-de-autenticación)
  - [Endpoints](#endpoints)
    - [`GET /health`](#get-health)
    - [`POST /accounts`](#post-accounts)
    - [`GET /accounts`](#get-accounts)
    - [`POST /posts`](#post-posts)
    - [`GET /posts`](#get-posts)
    - [`GET /posts/:id`](#get-postsid)
    - [`DELETE /posts/:id`](#delete-postsid)
  - [Ciclo de vida de una publicación](#ciclo-de-vida-de-una-publicación)
  - [Cómo obtener un token para probar la publicación](#cómo-obtener-un-token-para-probar-la-publicación)
  - [Flujo de uso rápido (consulta interna)](#flujo-de-uso-rápido-consulta-interna)
  - [Testing](#testing)
  - [Troubleshooting](#troubleshooting)

<!--toc:end-->

Microservicio privado para programar y publicar contenido en Instagram y Facebook usando Meta Graph API.

## Requisitos

- Bun v1.0+ (o Node.js 20+)
- SQLite3

## Configuración Local

1. Instalar dependencias

   ```bash
   bun install
   ```

2. Configurar variables de entorno

   Copia el archivo `.env.example` a `.env` y llena los valores.

   | Variable                 | Descripción                                                                                                         |
   | ------------------------ | ------------------------------------------------------------------------------------------------------------------- |
   | `HOST`                   | Interfaz donde escucha el servidor (por defecto `127.0.0.1`)                                                        |
   | `PORT`                   | Puerto (por defecto `3000`)                                                                                         |
   | `API_KEY`                | **Obligatoria para producción.** Llave secreta que protege todos los endpoints. Recomendado: `openssl rand -hex 16` |
   | `DATABASE_PATH`          | Ruta del archivo SQLite (por defecto `./data/publisher.db`)                                                         |
   | `TOKEN_ENCRYPTION_KEY`   | Llave AES-256-GCM en **hex de exactamente 64 caracteres (32 bytes)**: `openssl rand -hex 32`                        |
   | `META_APP_ID`            | ID de tu app en Meta for Developers                                                                                 |
   | `META_APP_SECRET`        | Secret de tu app en Meta for Developers                                                                             |
   | `META_GRAPH_API_VERSION` | Versión de la Graph API (por defecto `v21.0`)                                                                       |

3. Correr migraciones de Base de Datos

   ```bash
   bunx drizzle-kit push
   ```

   _Nota: `drizzle-kit push` aplica los cambios a SQLite directamente._

## Correr el Servidor

```bash
# Desarrollo
bun run --watch src/server.ts

# Producción
bun run src/server.ts
```

El servidor estará escuchando en `http://127.0.0.1:3000`.

## Autenticación con API Key

Todos los endpoints están protegidos por una API Key. El único endpoint que **no** la requiere es `GET /health`.

### Cabecera

Incluye la llave en cada request usando la cabecera `X-API-Key`:

```
X-API-Key: <tu-api-key>
```

### Ejemplo con cURL

```bash
curl -H "X-API-Key: $API_KEY" http://127.0.0.1:3000/accounts
```

### Errores de autenticación

Si la cabecera falta o el valor es incorrecto, la API responde:

```http
HTTP/1.1 401 Unauthorized
Content-Type: application/json

{"error": "Unauthorized: Invalid or missing X-API-Key"}
```

> **⚠️ Seguridad**: Si `API_KEY` está vacía en `.env`, el servidor arranca en **modo inseguro** (todos los endpoints quedan abiertos) y lo advierte en el log. No expongas el servidor sin definir una API Key.

## Endpoints

Todas las peticiones requieren la cabecera `X-API-Key` (excepto `/health`).

### `GET /health`

Verificación de vida del servicio. No requiere API Key.

```bash
curl http://127.0.0.1:3000/health
```

```json
{ "status": "ok", "version": "1.0.0" }
```

### `POST /accounts`

Registra una cuenta de Instagram o Facebook. El token de acceso se **cifra** (AES-256-GCM) antes de guardarse en la base de datos.

```bash
curl -X POST http://127.0.0.1:3000/accounts \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "platform": "instagram",
    "externalId": "17841400000000000",
    "accessToken": "EAAG...token-de-usuario...",
    "tokenExpiresAt": 4102444800
  }'
```

**Body**

| Campo            | Tipo                          | Obligatorio | Descripción                                                 |
| ---------------- | ----------------------------- | ----------- | ----------------------------------------------------------- |
| `platform`       | `"instagram"` \| `"facebook"` | ✅          | Plataforma de destino                                       |
| `externalId`     | `string`                      | ✅          | ID numérico del Instagram Business / Facebook Page          |
| `accessToken`    | `string`                      | ✅          | User Access Token (largo plazo) con permisos de publicación |
| `tokenExpiresAt` | `number`                      | ✅          | Timestamp Unix de expiración del token                      |

**Respuesta `201 Created`**

```json
{ "id": "5ce2946d-5c66-4350-9d96-ae72afa37383" }
```

### `GET /accounts`

Lista las cuentas registradas. **Nunca** devuelve el token de acceso.

```bash
curl http://127.0.0.1:3000/accounts -H "X-API-Key: $API_KEY"
```

```json
{
  "accounts": [
    {
      "id": "5ce2946d-5c66-4350-9d96-ae72afa37383",
      "platform": "instagram",
      "external_id": "17841400000000000",
      "token_expires_at": 4102444800,
      "created_at": 1786549559
    }
  ]
}
```

### `POST /posts`

Programa una publicación. La publica el scheduler automáticamente cuando vence `scheduledAt`.

```bash
curl -X POST http://127.0.0.1:3000/posts \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "accountId": "5ce2946d-5c66-4350-9d96-ae72afa37383",
    "mediaUrls": ["https://cdn.ejemplo.com/imagen.jpg"],
    "caption": "Mi post",
    "scheduledAt": 1786553162
  }'
```

**Body**

| Campo         | Tipo              | Obligatorio | Descripción                                                 |
| ------------- | ----------------- | ----------- | ----------------------------------------------------------- |
| `accountId`   | `string` (UUID)   | ✅          | ID de una cuenta registrada                                 |
| `mediaUrls`   | `string[]` (URLs) | ✅          | Mínimo 1 URL pública de imagen o video (`.mp4` = Reels)     |
| `caption`     | `string`          | ❌          | Texto de la publicación                                     |
| `scheduledAt` | `number`          | ✅          | Timestamp Unix futuro. Debe ser mayor que el momento actual |

**Respuesta `201 Created`**

```json
{ "id": "b6b0ad0c-fc40-48eb-b2ae-18674726a9a9" }
```

**Errores comunes** (`400 Bad Request`)

```json
{ "error": "scheduledAt must be in the future" }
```

```json
{
  "error": "[\n  {\n    \"code\": \"invalid_format\",\n    \"path\": [\"mediaUrls\", 0],\n    \"message\": \"Invalid URL\"\n  }\n]"
}
```

### `GET /posts`

Lista publicaciones con filtros opcionales.

```bash
# Con API Key
curl "http://127.0.0.1:3000/posts?status=pending&limit=20&offset=0" \
  -H "X-API-Key: $API_KEY"
```

**Query params**

| Param    | Tipo                                                 | Por defecto | Descripción          |
| -------- | ---------------------------------------------------- | ----------- | -------------------- |
| `status` | `pending` \| `publishing` \| `published` \| `failed` | —           | Filtra por estado    |
| `limit`  | `number`                                             | `20`        | Máximo de resultados |
| `offset` | `number`                                             | `0`         | Paginación           |

**Respuesta `200 OK`**

```json
{
  "posts": [
    {
      "id": "b6b0ad0c-fc40-48eb-b2ae-18674726a9a9",
      "account_id": "5ce2946d-5c66-4350-9d96-ae72afa37383",
      "caption": "Mi post",
      "media_urls": ["https://cdn.ejemplo.com/imagen.jpg"],
      "scheduled_at": 1786553162,
      "status": "pending",
      "container_id": null,
      "error_message": null,
      "created_at": 1786549562,
      "updated_at": 1786549562
    }
  ]
}
```

### `GET /posts/:id`

Detalle de una publicación.

```bash
curl http://127.0.0.1:3000/posts/b6b0ad0c-fc40-48eb-b2ae-18674726a9a9 \
  -H "X-API-Key: $API_KEY"
```

**Respuesta `200 OK`**: misma estructura que cada elemento de `GET /posts`.

**Errores**

- `404 Not Found`: `{ "error": "Post not found" }`
- `400 Bad Request`: el `id` no es un UUID válido

### `DELETE /posts/:id`

Cancela una publicación **pendiente**.

```bash
curl -X DELETE http://127.0.0.1:3000/posts/b6b0ad0c-fc40-48eb-b2ae-18674726a9a9 \
  -H "X-API-Key: $API_KEY"
```

**Respuesta `200 OK`**

```json
{ "success": true }
```

El post queda marcado como `failed` con `error_message: "cancelled by user"`.

**Errores** (`400 Bad Request`)

```json
{ "error": "Post not found" }
```

```json
{ "error": "Only pending posts can be cancelled" }
```

## Ciclo de vida de una publicación

```
POST /posts (status: pending)
        │
        ▼
Scheduler (cada minuto) detecta posts con scheduled_at <= ahora
        │
        ▼
publishing  ──► createMediaContainer (POST /{igUserId}/media)
        │           │
        │           ▼
        │     getContainerStatus (polling, hasta 30s)
        │           │  FINISHED
        │           ▼
        └──► publishContainer (POST /{igUserId}/media_publish)
                     │
                     ▼
               published
```

Si algo falla en cualquier paso (token inválido, media no lista, timeout), el post pasa a `failed` con el detalle del error en `error_message`.

Además, un job diario (09:00) renueva automáticamente los tokens que expiran en menos de 7 días usando `META_APP_ID` y `META_APP_SECRET`.

## Cómo obtener un token para probar la publicación

1. En [Meta for Developers](https://developers.facebook.com) abre tu app (**Add product → Instagram**).
2. Conecta tu cuenta de **Instagram Business** (o Facebook Page) y otorga `instagram_basic` + `instagram_content_publish` (IG) o `pages_manage_posts` (FB).
3. Genera un **User Access Token** de larga duración (Graph API Explorer o Business Integrations).
4. Obtén tu ID numérico de Instagram Business / Facebook Page (`GET /me/accounts` con el mismo token).
5. Registra la cuenta con `POST /accounts` usando ese ID y token.
6. Programa un post con `mediaUrls` apuntando a **archivos accesibles públicamente**.

## Flujo de uso rápido (consulta interna)

```bash
export API_KEY=$(grep '^API_KEY=' .env | cut -d= -f2-)

# 1. Health
curl http://127.0.0.1:3000/health

# 2. Registrar cuenta
curl -X POST http://127.0.0.1:3000/accounts \
  -H "X-API-Key: $API_KEY" -H "Content-Type: application/json" \
  -d '{"platform":"instagram","externalId":"<IG_ID>","accessToken":"<TOKEN>","tokenExpiresAt":4102444800}'

# 3. Programar post (en 1 minuto)
curl -X POST http://127.0.0.1:3000/posts \
  -H "X-API-Key: $API_KEY" -H "Content-Type: application/json" \
  -d "{\"accountId\":\"<ACCOUNT_ID>\",\"mediaUrls\":[\"https://cdn.ejemplo.com/img.jpg\"],\"caption\":\"Hola\",\"scheduledAt\":$(($(date +%s)+60))}"

# 4. Monitorear
curl "http://127.0.0.1:3000/posts?status=pending" -H "X-API-Key: $API_KEY"
curl "http://127.0.0.1:3000/posts?status=failed"  -H "X-API-Key: $API_KEY"
```

## Testing

```bash
npx vitest run
```

## Troubleshooting

| Síntoma                                                  | Causa probable                                                             |
| -------------------------------------------------------- | -------------------------------------------------------------------------- |
| `TOKEN_ENCRYPTION_KEY must be exactly 64 hex characters` | La llave no tiene exactamente 64 caracteres hex (`openssl rand -hex 32`)   |
| `401 Unauthorized`                                       | `X-API-Key` ausente o incorrecta, o `API_KEY` no coincide                  |
| `Invalid OAuth access token` al publicar                 | El token de la cuenta no es válido o expiró (revísalo con `GET /accounts`) |
| Post atascado en `pending`                               | `scheduledAt` aún no vence; el scheduler corre cada minuto                 |
| `OAuthException 190`                                     | Token inválido o sin permisos de publicación en la app                     |
