// Supabase Edge Function "push": sends Web Push alerts for Crossroads Private Line.
//   GET  -> { publicKey }   (VAPID public key the page subscribes with)
//   POST { type: 'message'|'call'|'missed', id }  (called by a database trigger)
// The VAPID key pair is generated on first run and kept in public.push_config
// (RLS on, no policies: only this function's service role can read it).
// JWT verification stays ON: the trigger forwards the sender's own token, the page sends the user's.
// Requests carry only a row id; everything else is read from the database, and
// stale rows are ignored, so a forged request can't send arbitrary alerts.
import { createClient } from "npm:@supabase/supabase-js@2.75.0";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});
const SUBJECT = "https://crossroadsweddingco.shop/messaging/";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json",
};

/* ---------- Web Push crypto (RFC 8291 aes128gcm + RFC 8292 VAPID), WebCrypto only ---------- */
const enc = new TextEncoder();
export const b64u = (b: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const unb64u = (s: string) =>
  Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));
export const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};
export async function hmac(key: Uint8Array, data: Uint8Array) {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, data));
}

export async function encryptPayload(p256dh: string, authSecret: string, payload: string) {
  const uaPub = unb64u(p256dh);
  const auth = unb64u(authSecret);
  const as = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]) as CryptoKeyPair;
  const asPub = new Uint8Array(await crypto.subtle.exportKey("raw", as.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPub, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, as.privateKey, 256));
  const prkKey = await hmac(auth, shared);
  const ikm = (await hmac(prkKey, concat(enc.encode("WebPush: info\0"), uaPub, asPub, new Uint8Array([1])))).slice(0, 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concat(enc.encode("Content-Encoding: aes128gcm\0"), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, concat(enc.encode("Content-Encoding: nonce\0"), new Uint8Array([1])))).slice(0, 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, concat(enc.encode(payload), new Uint8Array([2]))),
  );
  const header = new Uint8Array(21 + asPub.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPub.length;
  header.set(asPub, 21);
  return concat(header, ct);
}

let vapid: { pub: string; key: CryptoKey } | null = null;
async function getVapid() {
  if (vapid) return vapid;
  let { data } = await sb.from("push_config").select("value").eq("key", "vapid").maybeSingle();
  if (!data) {
    const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]) as CryptoKeyPair;
    const jwk = await crypto.subtle.exportKey("jwk", kp.privateKey);
    await sb.from("push_config").upsert({ key: "vapid", value: jwk }, { onConflict: "key", ignoreDuplicates: true });
    ({ data } = await sb.from("push_config").select("value").eq("key", "vapid").single());
  }
  const j = data!.value as JsonWebKey;
  const key = await crypto.subtle.importKey(
    "jwk", { kty: "EC", crv: "P-256", x: j.x, y: j.y, d: j.d, ext: true },
    { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"],
  );
  vapid = { pub: b64u(concat(new Uint8Array([4]), unb64u(j.x!), unb64u(j.y!))), key };
  return vapid;
}

export async function vapidAuth(endpoint: string, key: CryptoKey, pub: string) {
  const h = b64u(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const c = b64u(enc.encode(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: SUBJECT,
  })));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(`${h}.${c}`));
  return `vapid t=${h}.${c}.${b64u(sig)}, k=${pub}`;
}

type Sub = { id: number; endpoint: string; p256dh: string; auth: string };
async function send(s: Sub, payload: string, ttl: number) {
  const v = await getVapid();
  const r = await fetch(s.endpoint, {
    method: "POST",
    headers: {
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: String(ttl),
      Urgency: "high",
      Authorization: await vapidAuth(s.endpoint, v.key, v.pub),
    },
    body: await encryptPayload(s.p256dh, s.auth, payload),
  });
  if (r.status === 404 || r.status === 410) await sb.from("push_subscriptions").delete().eq("id", s.id);
  else if (!r.ok) console.error("push failed", r.status, await r.text());
  return r.status;
}

const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: cors });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method === "GET") return json({ publicKey: (await getVapid()).pub });

  const { type, id } = await req.json().catch(() => ({} as Record<string, unknown>));
  const now = Date.now();
  let to: string, from: string, ttl = 86400;
  let note: { title: string; body: string; tag: string; url: string; call?: boolean };

  if (type === "message") {
    const { data: m } = await sb.from("messages").select("sender,recipient,created_at").eq("id", id).maybeSingle();
    if (!m || now - Date.parse(m.created_at) > 60_000) return json({ skipped: true });
    to = m.recipient; from = m.sender;
    note = { title: "", body: "New message", tag: `msg-${from}`, url: `./?with=${from}` };
  } else if (type === "call" || type === "missed") {
    const { data: c } = await sb.from("calls").select("*").eq("id", id).maybeSingle();
    if (!c) return json({ skipped: true });
    const kind = c.kind === "video" ? "video" : "voice";
    to = c.callee; from = c.caller;
    if (type === "call") {
      if (c.status !== "ringing" || now - Date.parse(c.started_at) > 45_000) return json({ skipped: true });
      ttl = 40;
      note = { title: "", body: `Incoming ${kind} call`, tag: `call-${c.id}`, url: `./?with=${from}&call=${c.id}`, call: true };
    } else {
      if (c.status !== "missed" || now - Date.parse(c.ended_at ?? c.started_at) > 120_000) return json({ skipped: true });
      note = { title: "", body: `Missed ${kind} call`, tag: `call-${c.id}`, url: `./?with=${from}` };
    }
  } else return json({ error: "bad request" }, 400);

  const { data: p } = await sb.from("profiles").select("display_name").eq("id", from).maybeSingle();
  note.title = p?.display_name ?? "Private line";
  const { data: subs } = await sb.from("push_subscriptions").select("id,endpoint,p256dh,auth").eq("user_id", to);
  const results = await Promise.allSettled((subs ?? []).map((s: Sub) => send(s, JSON.stringify(note), ttl)));
  return json({ sent: results.filter((r) => r.status === "fulfilled").length, of: subs?.length ?? 0 });
});
