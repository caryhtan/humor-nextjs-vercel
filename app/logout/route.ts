import { NextResponse } from "next/server";
import { createClient } from "@/app/lib/server";

export async function POST(request: Request) {
  const url = new URL(request.url);
  const supabase = await createClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(`${url.origin}/`);
}
