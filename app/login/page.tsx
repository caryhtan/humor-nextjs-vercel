"use client";

import { createClient } from "@/app/lib/browser";

export default function LoginPage() {
  const supabase = createClient();

  const signIn = async () => {
    const redirectTo = `${window.location.origin}/auth/callback`;

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });

    if (error) alert(error.message);
  };

  return (
    <main style={{ padding: 24 }}>
      <h1>Login</h1>
      <button onClick={signIn}>Sign in with Google</button>
    </main>
  );
}