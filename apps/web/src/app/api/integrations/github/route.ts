import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { createClient } from "@/lib/supabase/server";

const STATE_COOKIE = "github_oauth_state";
const SCOPE = "repo";

function appOrigin(request: Request): string {
  const env = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  if (env) return env;
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

export async function GET(request: Request) {
  const clientId = process.env.GITHUB_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json(
      { error: "GITHUB_CLIENT_ID is not configured" },
      { status: 500 }
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const origin = appOrigin(request);
  const redirectUri = `${origin}/api/integrations/github/callback`;
  const state = randomBytes(32).toString("hex");

  const githubAuth = new URL("https://github.com/login/oauth/authorize");
  githubAuth.searchParams.set("client_id", clientId);
  githubAuth.searchParams.set("redirect_uri", redirectUri);
  githubAuth.searchParams.set("scope", SCOPE);
  githubAuth.searchParams.set("state", state);

  const res = NextResponse.redirect(githubAuth.toString());
  res.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  });
  return res;
}
