import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { encryptOAuthToken, upsertIntegration } from "@agents/db";

const STATE_COOKIE = "github_oauth_state";

function appOrigin(request: Request): string {
  const env = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  if (env) return env;
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

export async function GET(request: Request) {
  const key = process.env.OAUTH_ENCRYPTION_KEY;
  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  if (!key || !clientId || !clientSecret) {
    return NextResponse.redirect(
      new URL("/settings?github_error=config", appOrigin(request))
    );
  }

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieJar = await cookies();
  const cookieState = cookieJar.get(STATE_COOKIE)?.value;

  if (!code || !state || !cookieState || state !== cookieState) {
    return NextResponse.redirect(
      new URL("/settings?github_error=state", appOrigin(request))
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login", appOrigin(request)));
  }

  const origin = appOrigin(request);
  const redirectUri = `${origin}/api/integrations/github/callback`;

  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  });

  const tokenJson = (await tokenRes.json()) as {
    access_token?: string;
    scope?: string;
    error?: string;
    error_description?: string;
  };

  if (!tokenRes.ok || !tokenJson.access_token) {
    console.error("GitHub token exchange failed:", tokenJson);
    return NextResponse.redirect(
      new URL("/settings?github_error=token", appOrigin(request))
    );
  }

  const scopes = tokenJson.scope
    ? tokenJson.scope.split(/[,\s]+/).filter(Boolean)
    : [];

  let encrypted: string;
  try {
    encrypted = encryptOAuthToken(tokenJson.access_token, key);
  } catch (e) {
    console.error("Token encryption failed:", e);
    return NextResponse.redirect(
      new URL("/settings?github_error=crypto", appOrigin(request))
    );
  }

  try {
    await upsertIntegration(supabase, user.id, "github", scopes, encrypted);
  } catch (e) {
    console.error("upsertIntegration failed:", e);
    return NextResponse.redirect(
      new URL("/settings?github_error=db", appOrigin(request))
    );
  }

  const res = NextResponse.redirect(
    new URL("/settings?github=connected", appOrigin(request))
  );
  res.cookies.set(STATE_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return res;
}
