import { redirect } from "next/navigation";
import { createClient } from "@/app/lib/server";

export default async function ProtectedPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();

  if (!data.user) redirect("/login");

  return (
    <main style={{ padding: 24 }}>
      <h1>Protected Route ✅</h1>
      <p>You are signed in as: {data.user.email}</p>
      <p>This is the gated UI required by Assignment 3.</p>
      <form action="/logout" method="post">
        <button type="submit">Sign out</button>
      </form>
    </main>
  );
}
