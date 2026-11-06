// Supabase Edge Function "courier-admin": lets the owner create a login from the Admin screen.
// Public sign-up stays off, so this is the only way in besides the Supabase dashboard.
// The caller's own token is checked against the database, and only an active owner who has
// signed the NDA gets through. The service key never leaves this function.
import { createClient } from "npm:@supabase/supabase-js@2.75.0";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const admin = createClient(URL_, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const LOGIN_DOMAIN = "crossroadsweddingco.shop";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: cors });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: who } = await admin.auth.getUser(token);
  if (!who?.user) return json({ error: "Sign in first." }, 401);
  const { data: m } = await admin.from("cc_members").select("role,active").eq("user_id", who.user.id).maybeSingle();
  const { data: signed } = await admin.rpc("cc_nda_ok", { u: who.user.id });
  if (m?.role !== "owner" || !m.active || !signed) return json({ error: "Only the owner can create logins." }, 403);

  const b = await req.json().catch(() => ({}));
  const username = String(b.username ?? "").trim().toLowerCase();
  const password = String(b.password ?? "");
  const role = String(b.role ?? "pending");
  const org = b.org_id ? String(b.org_id) : null;
  if (!/^[a-z0-9._]{2,40}$/.test(username)) return json({ error: "Use 2 to 40 letters, numbers, dots or underscores for the username." });
  if (password.length < 8) return json({ error: "Use a temporary password of at least 8 characters." });
  if (!["pending", "owner", "dispatcher", "driver", "client", "store"].includes(role)) return json({ error: "Unknown role." });
  if (["client", "store"].includes(role) && !org) return json({ error: "Customers and stores need a company." });

  const { data: made, error } = await admin.auth.admin.createUser({ email: `${username}@${LOGIN_DOMAIN}`, password, email_confirm: true });
  if (error || !made?.user) return json({ error: /already/i.test(error?.message ?? "") ? "That username is taken." : "Could not create the login." });
  const id = made.user.id;
  // The database triggers already made the profile and a pending member row.
  if (b.display_name) await admin.from("profiles").update({ display_name: String(b.display_name).slice(0, 40) }).eq("id", id);
  const up = await admin.from("cc_members").update({ role, org_id: ["client", "store"].includes(role) ? org : null }).eq("user_id", id);
  if (up.error) return json({ error: "The login exists but its role did not save. Set it under People." });
  return json({ id });
});
