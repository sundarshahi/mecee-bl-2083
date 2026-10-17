// MECEE-BL 2083 reminders: stores push subscriptions + reminder settings, and every 15 minutes
// sends the reminders that fell due, using the same daily plan as the app (remPlan in src/template.html).
// Also keeps an optional online copy of progress under a secret code.

const DAY = 864e5;
const MAX_BACKUP = 900_000; // bytes; D1 values must stay under 1 MB

export default {
  async fetch(req, env) {
    const origin = req.headers.get("Origin") || "";
    const allowed = env.ALLOWED_ORIGINS.split(",").includes(origin) ? origin : "";
    const cors = {"Access-Control-Allow-Origin": allowed || "null", "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "content-type", "Vary": "Origin"};
    if (req.method === "OPTIONS") return new Response(null, {status: 204, headers: cors});
    const json = (body, status = 200) => new Response(JSON.stringify(body), {status, headers: {...cors, "content-type": "application/json"}});
    if (!allowed) return json({error: "origin not allowed"}, 403);
    const url = new URL(req.url);
    try {
      if (req.method === "GET" && url.pathname === "/key") return json({key: env.VAPID_PUBLIC});

      if (req.method === "POST" && url.pathname === "/subscribe") {
        const {subscription: s, settings} = await req.json();
        if (!s?.endpoint?.startsWith("https://") || !s.keys?.p256dh || !s.keys?.auth) return json({error: "bad subscription"}, 400);
        const id = crypto.randomUUID();
        await env.DB.prepare(`INSERT INTO subs (id, endpoint, p256dh, auth, settings, updated) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
          ON CONFLICT(endpoint) DO UPDATE SET p256dh = ?3, auth = ?4, settings = ?5, updated = ?6`)
          .bind(id, s.endpoint, s.keys.p256dh, s.keys.auth, JSON.stringify(cleanSettings(settings)), Date.now()).run();
        const row = await env.DB.prepare("SELECT id FROM subs WHERE endpoint = ?1").bind(s.endpoint).first();
        return json({id: row.id});
      }
      if (req.method === "POST" && url.pathname === "/settings") {
        const {id, settings} = await req.json();
        const r = await env.DB.prepare("UPDATE subs SET settings = ?2, updated = ?3 WHERE id = ?1").bind(String(id), JSON.stringify(cleanSettings(settings)), Date.now()).run();
        return json({ok: r.meta.changes === 1}, r.meta.changes === 1 ? 200 : 404);
      }
      if (req.method === "POST" && url.pathname === "/unsubscribe") {
        const {id} = await req.json();
        await env.DB.prepare("DELETE FROM subs WHERE id = ?1").bind(String(id)).run();
        return json({ok: true});
      }
      if (req.method === "POST" && url.pathname === "/test") {
        const {id} = await req.json();
        const row = await env.DB.prepare("SELECT * FROM subs WHERE id = ?1").bind(String(id)).first();
        if (!row) return json({error: "not found"}, 404);
        const status = await sendPush(env, row, {title: "Reminders are on", body: "You'll get your study plan here, even when the app is closed.", tag: "hello"});
        return json({status});
      }

      // online copy of progress: the code is a long random secret the phone generates
      const m = url.pathname.match(/^\/backup\/([A-Za-z0-9_-]{24,64})$/);
      if (m && req.method === "POST") {
        const body = await req.text();
        if (body.length > MAX_BACKUP) return json({error: "too large"}, 413);
        JSON.parse(body);
        await env.DB.prepare(`INSERT INTO backups (code, data, updated) VALUES (?1, ?2, ?3) ON CONFLICT(code) DO UPDATE SET data = ?2, updated = ?3`).bind(m[1], body, Date.now()).run();
        return json({ok: true});
      }
      if (m && req.method === "GET") {
        const row = await env.DB.prepare("SELECT data, updated FROM backups WHERE code = ?1").bind(m[1]).first();
        return row ? json({updated: row.updated, data: JSON.parse(row.data)}) : json({error: "not found"}, 404);
      }
      if (m && req.method === "DELETE") {
        await env.DB.prepare("DELETE FROM backups WHERE code = ?1").bind(m[1]).run();
        return json({ok: true});
      }
      return json({error: "not found"}, 404);
    } catch (e) {
      return json({error: "bad request"}, 400);
    }
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(runReminders(env));
  }
};

/* ── settings: keep only known fields ── */
function cleanSettings(s = {}) {
  const t = v => (/^\d\d:\d\d$/.test(v) ? v : null);
  const b = v => v === true;
  return {
    from: t(s.from) || "06:30", until: t(s.until) || "21:30", paperTime: t(s.paperTime) || "11:00",
    study: b(s.study), series: b(s.series), water: b(s.water), move: b(s.move), sleep: b(s.sleep),
    examDate: /^\d{4}-\d\d-\d\d$/.test(s.examDate || "") ? s.examDate : "",
    examName: String(s.examName || "your exam").slice(0, 30),
    tz: typeof s.tz === "string" && s.tz.length < 64 ? s.tz : "Asia/Kathmandu"
  };
}

/* ── the daily plan: same rules as remPlan() in the app ── */
const hm = t => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
function remPlan(R, dateStr) {
  const out = [], a = hm(R.from), z = hm(R.until);
  const d = R.examDate ? Math.round((new Date(R.examDate) - new Date(dateStr)) / DAY) : 99;
  const add = (min, id, title, body) => { if (min >= a - 30 && min <= z + 60) out.push({id, min, title, body}); };
  if (d === 0) { add(a, "examday", "Exam day", "Light notes only. Eat breakfast, take your admit card, reach the hall early. Answer what you know first."); return out; }
  if (d < 0) return out;
  if (R.study) {
    add(a, "review", "Morning review", "Start with Review due and confident mistakes. Fixing yesterday's misses first makes them stick.");
    add(Math.max(a + 90, hm("08:00")), "study1", "Study block", "A 20-question smart session on your weakest high-mark unit.");
    add(hm("14:30"), "study2", "Study block", "Another smart session. Mixed units train you to spot what each question needs.");
    add(hm("19:00"), "study3", "Evening block", "Repeated questions or a half paper, then read the notes for what you missed.");
  }
  if (R.series && d >= 3 && d % 2 === 1) add(hm(R.paperTime) - 15, "series", `Series exam at ${R.paperTime}`, `Sit a full 3-hour paper from ${R.paperTime}. Set a phone alarm too if your phone is on silent.`);
  if (R.water) for (let m = a + 60; m <= z - 60; m += 120) add(m, "water" + m, "Drink a glass of water", "Even mild dehydration lowers attention and memory (Adan, 2012).");
  if (R.move) { add(hm("10:00"), "move1", "Walk for 20 minutes", "A brisk walk or stairs. About 20 minutes of exercise improves attention and memory afterwards; very short bursts do not (Chang et al., 2012)."); add(hm("16:30"), "move2", "Walk for 20 minutes", "Walk, skip or climb stairs, then come back for one more session."); }
  if (R.sleep) { add(z, "sleep", "Wind down", "Stop studying now. 7–9 hours of sleep turns today's practice into memory."); if (d === 1) add(hm("20:00"), "eve", "Exam tomorrow", "Pack admit card, pencils and ID. No new chapters. Sleep early."); }
  return out;
}

/* ── cron: send what fell due in the last 15 minutes, once per reminder per day ── */
async function runReminders(env) {
  const {results} = await env.DB.prepare("SELECT * FROM subs").all();
  const now = new Date();
  for (const row of results) {
    const R = JSON.parse(row.settings);
    const local = localParts(now, R.tz);
    const fired = JSON.parse(row.fired || "{}");
    const ids = fired.d === local.date ? fired.ids : [];
    const due = remPlan(R, local.date).filter(r => r.min <= local.min && r.min > local.min - 15 && !ids.includes(r.id));
    if (!due.length) continue;
    for (const r of due) {
      const status = await sendPush(env, row, {title: r.title, body: r.body, tag: r.id.replace(/\d+$/, "")});
      if (status === 404 || status === 410) { await env.DB.prepare("DELETE FROM subs WHERE id = ?1").bind(row.id).run(); break; }
      ids.push(r.id);
    }
    await env.DB.prepare("UPDATE subs SET fired = ?2 WHERE id = ?1").bind(row.id, JSON.stringify({d: local.date, ids})).run();
  }
}
function localParts(date, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23"}).formatToParts(date).map(x => [x.type, x.value]));
  return {date: `${p.year}-${p.month}-${p.day}`, min: +p.hour * 60 + +p.minute};
}

/* ── Web Push: VAPID (RFC 8292) + aes128gcm payload encryption (RFC 8291), WebCrypto only ── */
const enc = new TextEncoder();
const b64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), c => c.charCodeAt(0));
const concat = (...a) => { const out = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let o = 0; for (const x of a) { out.set(x, o); o += x.length; } return out; };
async function hmac(key, data) {
  const k = await crypto.subtle.importKey("raw", key, {name: "HMAC", hash: "SHA-256"}, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, data));
}
async function vapidAuth(env, endpoint) {
  const aud = new URL(endpoint).origin;
  const header = b64u(enc.encode(JSON.stringify({typ: "JWT", alg: "ES256"})));
  const claims = b64u(enc.encode(JSON.stringify({aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: env.VAPID_SUBJECT})));
  const key = await crypto.subtle.importKey("jwk", JSON.parse(env.VAPID_PRIVATE_JWK), {name: "ECDSA", namedCurve: "P-256"}, false, ["sign"]);
  const sig = await crypto.subtle.sign({name: "ECDSA", hash: "SHA-256"}, key, enc.encode(`${header}.${claims}`));
  return `vapid t=${header}.${claims}.${b64u(sig)}, k=${env.VAPID_PUBLIC}`;
}
async function encrypt(payload, p256dh, authSecret) {
  const uaPublic = unb64u(p256dh), auth = unb64u(authSecret);
  const as = await crypto.subtle.generateKey({name: "ECDH", namedCurve: "P-256"}, true, ["deriveBits"]);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", as.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, {name: "ECDH", namedCurve: "P-256"}, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({name: "ECDH", public: uaKey}, as.privateKey, 256));
  const prkKey = await hmac(auth, ecdh);
  const ikm = await hmac(prkKey, concat(enc.encode("WebPush: info\0"), uaPublic, asPublic, new Uint8Array([1])));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concat(enc.encode("Content-Encoding: aes128gcm\0"), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, concat(enc.encode("Content-Encoding: nonce\0"), new Uint8Array([1])))).slice(0, 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({name: "AES-GCM", iv: nonce}, key, concat(enc.encode(payload), new Uint8Array([2]))));
  const header = new Uint8Array(21); header.set(salt, 0); new DataView(header.buffer).setUint32(16, 4096); header[20] = asPublic.length;
  return concat(header, asPublic, cipher);
}
async function sendPush(env, row, msg) {
  const body = await encrypt(JSON.stringify(msg), row.p256dh, row.auth);
  const res = await fetch(row.endpoint, {method: "POST", headers: {
    "Authorization": await vapidAuth(env, row.endpoint), "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream",
    "TTL": "3600", "Urgency": "high", "Topic": msg.tag.slice(0, 32)
  }, body});
  return res.status;
}
