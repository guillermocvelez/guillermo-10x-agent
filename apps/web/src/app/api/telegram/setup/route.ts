import { NextResponse } from "next/server";

/** Public HTTPS origin for Telegram (must be :443 / allowed ports). Not localhost. */
function publicOriginForWebhook(request: Request): string {
  const fromEnv = process.env.TELEGRAM_WEBHOOK_BASE_URL?.replace(/\/+$/, "");
  if (fromEnv) {
    return fromEnv;
  }

  const forwardedHost = request.headers.get("x-forwarded-host");
  if (forwardedHost) {
    const host = forwardedHost.split(",")[0]?.trim();
    if (host) {
      const proto =
        request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || "https";
      return `${proto}://${host}`;
    }
  }

  return new URL(request.url).origin;
}

function isUnsuitableWebhookOrigin(origin: string): boolean {
  try {
    const u = new URL(origin);
    const host = u.hostname.toLowerCase();
    if (u.protocol !== "https:") return true;
    if (host === "localhost" || host === "127.0.0.1" || host === "::1") return true;
    return false;
  } catch {
    return true;
  }
}

export async function GET(request: Request) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;

  if (!token) {
    return NextResponse.json({ error: "TELEGRAM_BOT_TOKEN not set" }, { status: 500 });
  }

  const origin = publicOriginForWebhook(request);
  const webhookUrl = `${origin}/api/telegram/webhook`;

  if (!process.env.TELEGRAM_WEBHOOK_BASE_URL?.trim() && isUnsuitableWebhookOrigin(origin)) {
    return NextResponse.json(
      {
        error:
          "Telegram solo acepta webhooks HTTPS públicos (no localhost). Define TELEGRAM_WEBHOOK_BASE_URL en apps/web/.env.local con la URL base HTTPS de tu túnel (p. ej. https://abc.ngrok-free.app), reinicia `npm run dev` y vuelve a abrir esta ruta; o abre esta misma URL desde el navegador usando el dominio del túnel.",
        attemptedWebhookUrl: webhookUrl,
      },
      { status: 400 }
    );
  }

  const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: webhookUrl,
      ...(secret ? { secret_token: secret } : {}),
    }),
  });

  const data = await res.json();
  return NextResponse.json({ webhookUrl, telegram: data });
}
