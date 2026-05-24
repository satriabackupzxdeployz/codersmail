// ╔══════════════════════════════════════════════════════════╗
// ║  CODERSMAIL · Client Utility  (app.js)                  ║
// ║  No tokens. No secrets. All calls go through /sys-core  ║
// ╚══════════════════════════════════════════════════════════╝

;(function(w){
  // ── API bridge ──────────────────────────────────────────
  w.apiCall = async function(action, payload = {}) {
    try {
      const r = await fetch('/sys-core', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action, payload })
      });
      const data = await r.json();
      if (!r.ok && data.e) console.warn('[Codersmail API]', data.e);
      return data;
    } catch (err) {
      console.error('[Codersmail]', err);
      return { e: 'Koneksi gagal. Periksa internet.' };
    }
  };

  // ── Copy to clipboard with feedback ─────────────────────
  w.copyText = function(text, btn) {
    const doFallback = () => {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0;';
      document.body.appendChild(ta);
      ta.focus(); ta.select();
      try { document.execCommand('copy'); } catch(_) {}
      document.body.removeChild(ta);
    };
    const success = () => {
      if (!btn) return;
      const orig = btn.innerHTML;
      btn.innerHTML = '<i class="fas fa-check"></i> Tersalin!';
      btn.classList.add('copy-success');
      setTimeout(() => { btn.innerHTML = orig; btn.classList.remove('copy-success'); }, 2200);
    };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(success).catch(() => { doFallback(); success(); });
    } else {
      doFallback(); success();
    }
  };

  // ── Toast notification ───────────────────────────────────
  w.showToast = function(msg, type = 'info') {
    let el = document.getElementById('_cm_toast');
    if (!el) {
      el = document.createElement('div');
      el.id = '_cm_toast';
      el.style.cssText = `
        position:fixed;bottom:24px;left:50%;transform:translateX(-50%) translateY(80px);
        background:#1a1a1a;color:#fff;padding:12px 24px;border-radius:999px;
        font-size:.88rem;font-weight:500;z-index:99999;transition:transform .3s cubic-bezier(.34,1.56,.64,1);
        pointer-events:none;white-space:nowrap;box-shadow:0 4px 24px rgba(0,0,0,.25);
      `;
      document.body.appendChild(el);
    }
    if (type === 'error') el.style.background = '#ff3b30';
    else if (type === 'success') el.style.background = '#34c759';
    else el.style.background = '#1a1a1a';
    el.textContent = msg;
    el.style.transform = 'translateX(-50%) translateY(0)';
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.style.transform = 'translateX(-50%) translateY(80px)'; }, 2800);
  };

  // ── Auth helpers ─────────────────────────────────────────
  w.getAuth = () => {
    try { return JSON.parse(localStorage.getItem('cm_auth') || 'null'); } catch { return null; }
  };
  w.setAuth = (obj) => localStorage.setItem('cm_auth', JSON.stringify(obj));
  w.clearAuth = ()  => localStorage.removeItem('cm_auth');

})(window);
