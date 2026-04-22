# Agente personal (MVP)

Monorepo con **Next.js**, **Supabase**, **LangGraph** y **OpenRouter**. Incluye chat web, onboarding, ajustes y bot de **Telegram** (opcional).

## Requisitos previos

- **Node.js** 20 o superior (recomendado LTS).
- **npm** 10+ (incluido con Node.js 20+).
- Cuenta en **[Supabase](https://supabase.com)** (gratis).
- Cuenta en **[OpenRouter](https://openrouter.ai)** para la API del modelo (clave de API).
- *(Opcional)* Bot de Telegram creado con [@BotFather](https://t.me/BotFather) y una URL **HTTPS** pública para el webhook (en local suele usarse **ngrok** o similar).

---

## Paso 1 — Clonar e instalar dependencias

```bash
cd agents
npm install
```

---

## Paso 2 — Crear proyecto en Supabase

1. Entra en el [dashboard de Supabase](https://supabase.com/dashboard) y crea un **nuevo proyecto**.
2. Espera a que termine el aprovisionamiento.
3. En **Project Settings → API** anota:
   - **Project URL** → será `NEXT_PUBLIC_SUPABASE_URL`
   - **`anon` public** → será `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - **`service_role` secret** → será `SUPABASE_SERVICE_ROLE_KEY` (no la expongas al cliente ni la subas a repositorios públicos).

---

## Paso 3 — Aplicar el esquema SQL (tablas + RLS)

1. En Supabase, abre **SQL Editor**.
2. Abre el archivo del repo:

   `packages/db/supabase/migrations/00001_initial_schema.sql`

3. Copia **todo** el contenido y pégalo en el editor.
4. Ejecuta el script (**Run**).

5. Repite con las migraciones posteriores (en orden), si existen en tu copia del repo:

   - `packages/db/supabase/migrations/00002_user_notes.sql`
   - `packages/db/supabase/migrations/00003_scheduled_tasks.sql` (tareas `cron` + canal `scheduled` en sesiones)

Si algo falla (por ejemplo, el trigger `on_auth_user_created` en un proyecto ya modificado), revisa el mensaje de error; en la mayoría de proyectos nuevos el script aplica de una vez.

---

## Paso 4 — Configurar autenticación (email)

1. En Supabase: **Authentication → Providers** → habilita **Email** (por defecto suele estar activo).
2. **Authentication → URL configuration**:
   - **Site URL**: para desarrollo local usa `http://localhost:3000`
   - **Redirect URLs**: añade al menos:
     - `http://localhost:3000/auth/callback`
     - `http://localhost:3000/**` (o la variante que permita tu versión del dashboard para desarrollo)

Así el flujo de login/signup y el intercambio de código en `/auth/callback` funcionan en local.

   La **callback de GitHub OAuth** (`/api/integrations/github/callback`) se configura en la [OAuth App de GitHub](docs/github-integration.md), no en esta lista de Supabase.

---

## Paso 5 — Variables de entorno

Next.js carga `.env*` desde el directorio de la app **`apps/web`**, no desde la raíz del monorepo.

1. Copia el ejemplo:

   ```bash
   cp apps/web/.env.example apps/web/.env.local
   ```

   *(Si ya tienes `.env.local` en la raíz, mueve o copia ese archivo a `apps/web/.env.local`.)*

2. Edita `apps/web/.env.local` y completa:

   | Variable | Descripción |
   |----------|-------------|
   | `NEXT_PUBLIC_SUPABASE_URL` | URL del proyecto Supabase |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Clave `anon` |
   | `SUPABASE_SERVICE_ROLE_KEY` | Clave `service_role` (solo servidor; la usa la API del agente y Telegram contra Postgres) |
   | `OPENROUTER_API_KEY` | Clave de OpenRouter |
   | `TELEGRAM_BOT_TOKEN` | *(Opcional)* Token del bot |
   | `TELEGRAM_WEBHOOK_SECRET` | *(Opcional)* Secreto que Telegram enviará en cabecera; debe coincidir con el configurado al registrar el webhook |
   | `NEXT_PUBLIC_APP_URL` | *(Opcional)* Origen público de la app (p. ej. `https://tu-dominio.com`); útil para OAuth en producción |
   | `GITHUB_CLIENT_ID` | OAuth App de GitHub — ver [docs/github-integration.md](docs/github-integration.md) |
   | `GITHUB_CLIENT_SECRET` | Secreto de la OAuth App (solo servidor) |
   | `OAUTH_ENCRYPTION_KEY` | 64 caracteres hex (32 bytes) para cifrar tokens OAuth guardados en BD |

Plantilla: [apps/web/.env.example](apps/web/.env.example). Integración GitHub paso a paso: [docs/github-integration.md](docs/github-integration.md).

---

## Paso 6 — Arrancar la aplicación web

Desde la **raíz** del repo:

```bash
npm run dev
```

Por defecto Turbo ejecuta el `dev` de cada paquete; la app suele quedar en **http://localhost:3000**.

Flujo esperado:

1. **Registro** en `/signup` o **login** en `/login`.
2. **Onboarding** (perfil, agente, herramientas, revisión).
3. **Chat** en `/chat` y **ajustes** en `/settings`.

---

## Paso 7 — Probar el chat con el modelo

1. Confirma que `OPENROUTER_API_KEY` está en `apps/web/.env.local`.
2. En el onboarding, activa al menos las herramientas básicas (`get_user_preferences`, `list_enabled_tools`) si quieres probar *tool calling*.
3. Escribe un mensaje en `/chat`. Si la clave o el modelo fallan, revisa la consola del servidor (terminal donde corre `npm run dev`).

El modelo por defecto está definido en `packages/agent/src/model.ts` (OpenRouter, `openai/gpt-4o-mini`). Puedes cambiarlo ahí si lo necesitas.

---

## Paso 8 — Telegram (opcional)

Telegram **exige HTTPS** para webhooks. En local:

1. Crea el bot con BotFather y copia el token → `TELEGRAM_BOT_TOKEN` en `apps/web/.env.local`.
2. Elige un secreto aleatorio → `TELEGRAM_WEBHOOK_SECRET` (mismo valor usarás al registrar el webhook).
3. Expón tu app local con un túnel HTTPS, por ejemplo:

   ```bash
   ngrok http 3000
   ```

   Usa la URL HTTPS que te dé ngrok (p. ej. `https://abc123.ngrok-free.app`).

4. Con la app en marcha, visita en el navegador (sustituye la URL base):

   `https://2eed-2803-9810-6890-b608-4849-4c37-e3d8-d667.ngrok-free.app/api/telegram/setup`

   Eso llama a `setWebhook` de Telegram apuntando a `/api/telegram/webhook` y, si definiste secreto, lo asocia al webhook.

5. En la web, entra a **Ajustes** → **Telegram** → **Generar código de vinculación**.
6. En Telegram, envía al bot: `/link TU_CODIGO` (el código que te muestra la web).

Después de vincular, los mensajes al bot usan el mismo pipeline que el chat web.

---

## Tareas programadas (cron + recordatorio)

1. Habilita la herramienta **`schedule_cron_task`** en Ajustes (riesgo medio: la creación pide **Aprobar** en web/Telegram).
2. Define en `.env.local` de **`apps/web`** una clave secreta, por ejemplo:

   `CRON_SECRET=tu_secreto_largo_aleatorio`

3. Programa un invocador **cada minuto** (Vercel Cron, `pg_cron` + `net.http_post`, GitHub Actions, etc.) contra:

   `POST https://TU_DOMINIO/api/cron/scheduled-tasks`

   Cabeceras: `Authorization: Bearer TU_CRON_SECRET` **o** `x-cron-secret: TU_CRON_SECRET`.

4. El agente recibe un **recordatorio** unos minutos antes (por defecto **5**, configurable con `pre_notify_minutes`) y la **ejecución** en la hora del cron. Los resultados se envían por **Telegram** si la cuenta está vinculada.

---

## Comandos útiles

| Comando | Descripción |
|---------|-------------|
| `npm run dev` | Desarrollo (monorepo) |
| `npm run build` | Build de todos los paquetes que definan `build` |
| `npm run lint` | Lint |
| `cd apps/web && npx next build` | Build solo de la app Next (útil para comprobar tipos antes de desplegar) |

---

## Documentación adicional

- [docs/brief.md](docs/brief.md) — visión y brief original.
- [docs/architecture.md](docs/architecture.md) — arquitectura técnica del MVP.
- [docs/plan.md](docs/plan.md) — fases y decisiones de implementación.
- [docs/github-integration.md](docs/github-integration.md) — OAuth App de GitHub, variables de entorno y cifrado de tokens.

---

## Problemas frecuentes

- **Redirecciones infinitas o “no auth”**: revisa `Site URL` y `Redirect URLs` en Supabase y que `.env.local` esté en **`apps/web`**.
- **Errores al guardar perfil o mensajes**: confirma que ejecutaste la migración SQL y que RLS no bloquea por falta de sesión (debes estar logueado con el mismo usuario).
- **Chat sin respuesta / 500 en `/api/chat`**: `OPENROUTER_API_KEY`, cuota en OpenRouter o modelo en `model.ts`.
- **Telegram no responde**: webhook debe ser HTTPS; token y secreto correctos; visita de nuevo `/api/telegram/setup` si cambias la URL pública.

Si quieres, el siguiente paso natural es desplegar **Vercel** (o similar) para `apps/web`, definir las mismas variables de entorno en el panel del proveedor y usar la URL de producción en Supabase y en el webhook de Telegram.
