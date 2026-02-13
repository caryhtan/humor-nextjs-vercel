import { NextResponse } from "next/server";
import { createClient } from "@/app/lib/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const origin = url.origin;

  // No code => treat as failed login and send to login page
  if (!code) {
    return NextResponse.redirect(`${origin}/login`);
  }

  const supabase = await createClient();

  // Exchanges the code for a session and sets auth cookies
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(`${origin}/login`);
  }

  // After successful session exchange, go to protected page
  return NextResponse.redirect(`${origin}/protected`);
}
