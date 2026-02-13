"use client";

import { createClient } from "@/app/lib/browser";

export default function LoginPage() {
  const supabase = createClient();

  const signIn = async () => {
    const redirectTo = `${window.location.origin}/auth/callback`; // EXACT

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });

    if (error) {
      alert(error.message);
      return;
    }
    window.location.href = data.url;
  };

  return (
    <main style={{ padding: 24 }}>
      <h1>Login</h1>
      <button onClick={signIn}>Sign in with Google</button>
      <p style={{ marginTop: 12 }}>
        After login you should return to <code>/auth/callback</code>.
      </p>
    </main>
  );
}
