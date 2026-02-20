import { NextResponse } from "next/server";
import { createClient } from "@/app/lib/server";

export async function GET(request: Request) {

  // ADD THIS LINE RIGHT HERE
  console.log("HIT CALLBACK:", request.url);

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const origin = url.origin;

  // where to go AFTER login
  const next = url.searchParams.get("next") || "/";

  if (!code) {
    console.log("No code, redirecting to login");
    return NextResponse.redirect(`${origin}/login`);
  }

  const supabase = await createClient();

  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    console.log("Exchange failed:", error.message);
    return NextResponse.redirect(`${origin}/login`);
  }

  console.log("Login success, redirecting to:", `${origin}${next}`);

  return NextResponse.redirect(`${origin}${next}`);
}