"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/app/lib/browser";
import styles from "./login.module.css";

export default function LoginPage() {
  const [supabase] = useState(() => createClient());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // If already logged in, we can optionally show a hint or redirect later.
  // Keeping it simple: just show UI.
  useEffect(() => {
    setErr(null);
  }, []);

  async function signInWithGoogle() {
    setBusy(true);
    setErr(null);

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo:
          typeof window !== "undefined"
            ? `${window.location.origin}/auth/callback`
            : undefined,
      },
    });

    if (error) setErr(error.message);
    setBusy(false);
  }

  return (
    <main className={styles.page}>
      <div className={styles.bgCloud} />
      <div className={styles.card}>
        <div className={styles.headerRow}>
          <div>
            <h1 className={styles.title}>Login</h1>
            <p className={styles.subtitle}>
              Sign in to vote and generate captions.
            </p>
          </div>

          <Link className={styles.backLink} href="/">
            ← Back
          </Link>
        </div>

        <button
          className={styles.googleBtn}
          onClick={signInWithGoogle}
          disabled={busy}
        >
          <span className={styles.googleIcon} aria-hidden="true">
            G
          </span>
          <span>{busy ? "Opening Google…" : "Sign in with Google"}</span>
        </button>

        {err && <div className={styles.error}>{err}</div>}

        <div className={styles.note}>
          By signing in, you’ll be able to vote on captions and use the pipeline.
        </div>
      </div>
    </main>
  );
}