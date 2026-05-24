// ╔══════════════════════════════════════════════════════════╗
// ║           CODERSMAIL · Backend API Handler               ║
// ║    All sensitive operations run server-side only         ║
// ╚══════════════════════════════════════════════════════════╝

export const config = { runtime: 'nodejs' };

const DB     = () => process.env.FIREBASE_DB_URL;
const TG_BOT = () => process.env.TELEGRAM_BOT_TOKEN;
const TG_ID  = () => process.env.TELEGRAM_OWNER_ID;
const G_ID   = () => process.env.GOOGLE_CLIENT_ID;

// ─── Firebase helpers ───────────────────────────────────────
async function fbGet(path) {
  const r = await fetch(`${DB()}${path}.json`);
  return r.ok ? r.json() : null;
}
async function fbSet(path, data) {
  await fetch(`${DB()}${path}.json`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  });
}
async function fbDel(path) {
  await fetch(`${DB()}${path}.json`, { method: 'DELETE' });
}

// ─── Telegram: upload file and return permanent URL ─────────
async function tgUploadPhoto(base64Data, caption) {
  const buf  = Buffer.from(base64Data.split(',')[1], 'base64');
  const blob = new Blob([buf], { type: 'image/jpeg' });
  const fd   = new FormData();
  fd.append('chat_id', TG_ID());
  fd.append('photo',   blob, 'upload.jpg');
  fd.append('caption', caption || 'Codersmail Upload');

  const r    = await fetch(`https://api.telegram.org/bot${TG_BOT()}/sendPhoto`, { method: 'POST', body: fd });
  const json = await r.json();
  if (!json.ok) throw new Error('Telegram upload failed');

  // Get largest photo size file_id
  const photos  = json.result.photo;
  const fileId  = photos[photos.length - 1].file_id;

  // Resolve permanent file path via getFile
  const fr   = await fetch(`https://api.telegram.org/bot${TG_BOT()}/getFile?file_id=${fileId}`);
  const fjson = await fr.json();
  const path = fjson.result.file_path; // e.g. photos/file_xxx.jpg

  // Return permanent CDN URL
  return `https://api.telegram.org/file/bot${TG_BOT()}/${path}`;
}

// ─── Telegram: send text message to owner ───────────────────
async function tgSendText(text) {
  await fetch(`https://api.telegram.org/bot${TG_BOT()}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: TG_ID(), text, parse_mode: 'HTML' })
  });
}

// ─── Google ID Token verify (backend only) ──────────────────
async function verifyGoogleToken(idToken) {
  const r = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`);
  const data = await r.json();
  if (data.error) throw new Error('Invalid Google token');
  if (data.aud !== G_ID()) throw new Error('Token audience mismatch');
  return data; // { sub, email, name, picture, ... }
}

// ─── Username validation ─────────────────────────────────────
function validUsername(u) {
  return /^[a-zA-Z0-9_]{3,20}$/.test(u);
}

// ─── CORS headers ────────────────────────────────────────────
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

// ════════════════════════════════════════════════════════════
export default async function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).set(corsHeaders()).send('');
  }
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  // Apply CORS
  Object.entries(corsHeaders()).forEach(([k, v]) => res.setHeader(k, v));

  let body;
  try {
    body = req.body;
    if (typeof body === 'string') body = JSON.parse(body);
  } catch {
    return res.status(400).json({ e: 'Invalid JSON' });
  }

  const { action, payload = {} } = body;

  try {

    // ── REGISTER ─────────────────────────────────────────────
    if (action === 'REGISTER') {
      const { username, password } = payload;
      if (!validUsername(username))
        return res.status(400).json({ e: 'Username hanya boleh huruf, angka, underscore (3-20 karakter)' });
      if (!password || password.length < 6)
        return res.status(400).json({ e: 'Password minimal 6 karakter' });

      const existing = await fbGet(`/users/${username}`);
      if (existing) return res.status(400).json({ e: 'Username sudah digunakan' });

      await fbSet(`/users/${username}`, {
        pw:      password,
        pic:     'https://api.dicebear.com/7.x/initials/svg?seed=' + username,
        email:   username + '@coders.dev',
        urlngl:  `${payload.host || ''}/${username}`,
        created: Date.now(),
        googleUid: null
      });

      return res.json({ ok: true });
    }

    // ── LOGIN ─────────────────────────────────────────────────
    if (action === 'LOGIN') {
      const { username, password } = payload;
      const u = await fbGet(`/users/${username}`);
      if (!u || u.pw !== password)
        return res.status(400).json({ e: 'Username atau password salah' });
      return res.json({ ok: true, email: u.email || username + '@coders.dev' });
    }

    // ── GOOGLE AUTH ───────────────────────────────────────────
    if (action === 'GOOGLE_AUTH') {
      const { idToken } = payload;
      let gUser;
      try {
        gUser = await verifyGoogleToken(idToken);
      } catch (err) {
        return res.status(401).json({ e: 'Token Google tidak valid' });
      }

      // Try find existing account linked to this Google UID
      const allUsers = await fbGet('/users') || {};
      let linkedUsername = null;
      for (const [uname, data] of Object.entries(allUsers)) {
        if (data.googleUid === gUser.sub) { linkedUsername = uname; break; }
      }

      if (linkedUsername) {
        // Existing Google user → login
        return res.json({
          ok:       true,
          username: linkedUsername,
          email:    allUsers[linkedUsername].email,
          newUser:  false
        });
      }

      // New Google user → need to pick username
      return res.json({
        ok:        true,
        newUser:   true,
        googleUid: gUser.sub,
        name:      gUser.name,
        picture:   gUser.picture,
        email:     gUser.email
      });
    }

    // ── GOOGLE REGISTER (link account) ───────────────────────
    if (action === 'GOOGLE_REGISTER') {
      const { username, googleUid, picture, name } = payload;
      if (!validUsername(username))
        return res.status(400).json({ e: 'Username tidak valid' });

      const existing = await fbGet(`/users/${username}`);
      if (existing) return res.status(400).json({ e: 'Username sudah digunakan' });

      // Upload Google avatar to Telegram for permanent URL
      let picUrl = picture || `https://api.dicebear.com/7.x/initials/svg?seed=${username}`;
      if (picture && picture.startsWith('https://')) {
        try {
          // Download Google pic then re-upload to Telegram
          const imgRes = await fetch(picture);
          const imgBuf = await imgRes.arrayBuffer();
          const base64  = Buffer.from(imgBuf).toString('base64');
          const b64full = `data:image/jpeg;base64,${base64}`;
          picUrl = await tgUploadPhoto(b64full, `Profile: ${username} (Google)`);
        } catch (_) { /* keep original Google URL as fallback */ }
      }

      await fbSet(`/users/${username}`, {
        pw:        null,
        pic:       picUrl,
        email:     username + '@coders.dev',
        urlngl:    `${payload.host || ''}/${username}`,
        created:   Date.now(),
        googleUid: googleUid,
        displayName: name
      });

      return res.json({ ok: true, email: username + '@coders.dev' });
    }

    // ── GET_DATA (dashboard) ──────────────────────────────────
    if (action === 'GET_DATA') {
      const { username } = payload;
      const u = await fbGet(`/users/${username}`);
      if (!u) return res.status(404).json({ e: 'User tidak ditemukan' });
      const m = await fbGet(`/messages/${username}`) || {};
      return res.json({
        pic:      u.pic,
        email:    u.email || username + '@coders.dev',
        urlngl:   u.urlngl,
        messages: m
      });
    }

    // ── GET_PROFILE (public send page) ───────────────────────
    if (action === 'GET_PROFILE') {
      const { username } = payload;
      // Validate: only serve real registered users
      const u = await fbGet(`/users/${username}`);
      if (!u) return res.status(404).json({ e: 'User tidak ditemukan' });
      return res.json({
        pic:         u.pic,
        displayName: u.displayName || username,
        email:       u.email || username + '@coders.dev'
      });
    }

    // ── CHECK_USER (validate username exists) ─────────────────
    if (action === 'CHECK_USER') {
      const u = await fbGet(`/users/${payload.username}`);
      return res.json({ exists: !!u });
    }

    // ── UPDATE_PIC ────────────────────────────────────────────
    if (action === 'UPDATE_PIC') {
      const { username, pic } = payload;
      if (!pic || !pic.startsWith('data:image'))
        return res.status(400).json({ e: 'File tidak valid' });

      // Upload to Telegram, get permanent URL
      const permanentUrl = await tgUploadPhoto(pic, `Profile update: ${username}`);
      await fbSet(`/users/${username}/pic`, permanentUrl);
      return res.json({ ok: true, url: permanentUrl });
    }

    // ── SEND_MSG ──────────────────────────────────────────────
    if (action === 'SEND_MSG') {
      const { to, sender, text, media } = payload;

      // Validate recipient exists
      const recipient = await fbGet(`/users/${to}`);
      if (!recipient) return res.status(404).json({ e: 'Penerima tidak ditemukan' });

      let mediaUrl = null;

      // If media attached: upload to Telegram, store permanent URL
      if (media && media.startsWith('data:image')) {
        const cap = `📩 Pesan untuk <b>${to}</b>\nDari: ${sender}\n\n${text}`;
        mediaUrl = await tgUploadPhoto(media, cap);

        // Also notify owner with photo
        try {
          const capFull = `📩 <b>Pesan Baru - Codersmail</b>\nUntuk: <b>${to}</b>\nDari: ${sender}\n\n${text}`;
          const buf2  = Buffer.from(media.split(',')[1], 'base64');
          const blob2 = new Blob([buf2], { type: 'image/jpeg' });
          const fd2   = new FormData();
          fd2.append('chat_id', TG_ID());
          fd2.append('photo', blob2, 'msg.jpg');
          fd2.append('caption', capFull);
          fd2.append('parse_mode', 'HTML');
          await fetch(`https://api.telegram.org/bot${TG_BOT()}/sendPhoto`, { method: 'POST', body: fd2 });
        } catch (_) {}
      } else {
        // Text-only Telegram notification
        try {
          await tgSendText(`📩 <b>Pesan Baru - Codersmail</b>\nUntuk: <b>${to}</b>\nDari: ${sender}\n\n${text}`);
        } catch (_) {}
      }

      const msgId = Date.now();
      const d     = new Date();
      const ts    = d.toLocaleString('id-ID', {
        hour: '2-digit', minute: '2-digit',
        day: '2-digit', month: 'short', year: 'numeric'
      });

      const msg = { id: msgId, sender, text, media: mediaUrl, timestamp: ts, read: false };
      await fbSet(`/messages/${to}/${msgId}`, msg);

      return res.json({ ok: true });
    }

    // ── READ_MSG ──────────────────────────────────────────────
    if (action === 'READ_MSG') {
      await fbSet(`/messages/${payload.username}/${payload.id}/read`, true);
      return res.json({ ok: true });
    }

    // ── DELETE_MSG ────────────────────────────────────────────
    if (action === 'DELETE_MSG') {
      await fbDel(`/messages/${payload.username}/${payload.id}`);
      return res.json({ ok: true });
    }

    // ── DELETE_ACC ────────────────────────────────────────────
    if (action === 'DELETE_ACC') {
      await fbDel(`/users/${payload.username}`);
      await fbDel(`/messages/${payload.username}`);
      return res.json({ ok: true });
    }

    // ── CHANGE_PASSWORD ───────────────────────────────────────
    if (action === 'CHANGE_PASSWORD') {
      const { username, oldPw, newPw } = payload;
      const u = await fbGet(`/users/${username}`);
      if (!u || u.pw !== oldPw) return res.status(400).json({ e: 'Password lama salah' });
      if (newPw.length < 6)    return res.status(400).json({ e: 'Password baru minimal 6 karakter' });
      await fbSet(`/users/${username}/pw`, newPw);
      return res.json({ ok: true });
    }

    return res.status(400).json({ e: 'Action tidak dikenal' });

  } catch (err) {
    console.error('[CODERSMAIL ERROR]', err.message);
    return res.status(500).json({ e: 'Server error. Coba lagi.' });
  }
}
