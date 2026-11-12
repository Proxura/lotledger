/* LotLedger app. Plain JS, no build step. Talks to /api/*. */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const state = { me: null, products: [], lots: [], orders: [], view: 'lots' };

async function api(path, opts = {}) {
  const res = await fetch(path, { headers: { 'content-type': 'application/json' }, credentials: 'same-origin', ...opts, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json() : await res.text();
  if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { status: res.status, data });
  return data;
}
function toast(msg, bad = false) { const t = $('#toast'); t.textContent = msg; t.className = 'toast' + (bad ? ' bad' : ''); t.hidden = false; clearTimeout(t._t); t._t = setTimeout(() => (t.hidden = true), 3200); }
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = () => new Date().toISOString().slice(0, 10);
const fmtDate = (d) => (d ? new Date(d + (d.length === 10 ? 'T00:00:00' : '')).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '');

/* ---------- dialog helper: returns form values or null ---------- */
function dialog(title, fieldsHtml, submitLabel = 'Save') {
  return new Promise((resolve) => {
    const dlg = $('#dlg'); const form = $('#dlg-form');
    form.innerHTML = `<h2>${esc(title)}</h2>${fieldsHtml}<p class="err" id="dlg-err"></p><div class="dlg-actions"><button type="button" id="dlg-cancel">Cancel</button><button class="primary" type="submit">${esc(submitLabel)}</button></div>`;
    const done = (v) => { dlg.close(); resolve(v); };
    $('#dlg-cancel', form).onclick = () => done(null);
    form.onsubmit = (e) => { e.preventDefault(); const fd = new FormData(form); done(Object.fromEntries(fd.entries())); };
    dlg.onclose = () => resolve(null);
    dlg.showModal();
    const first = form.querySelector('input,select,textarea'); if (first) first.focus();
  });
}

/* ---------- auth ---------- */
async function boot() {
  const m = location.hash.match(/[#&]lot=([^&]+)/); if (m) state.deepLot = decodeURIComponent(m[1]);
  state.me = await api('/api/me');
  if (!state.me.signedIn) return showAuth();
  $('#auth').hidden = true; $('#nav').hidden = false;
  $('#acct').hidden = false; $('#acct').textContent = `${state.me.account.name} · ${planLabel()}`;
  const q = new URLSearchParams(location.search);
  if (q.get('paid') === '1') {
    const sid = q.get('session_id') || '';
    history.replaceState(null, '', '/app/'); state.view = 'account';
    (async () => {
      try { const r = await api(`/api/billing/confirm?session_id=${encodeURIComponent(sid)}`); toast(r.paid ? 'Payment received. Thank you.' : 'Payment is still processing. Refresh in a minute.'); }
      catch (e) { toast(e.message, true); }
      state.me = await api('/api/me'); $('#acct').textContent = `${state.me.account.name} · ${planLabel()}`; renderAccount();
    })();
  }
  await Promise.all([loadProducts(), loadLots()]);
  if (state.deepLot) { await show('scan'); $('#scan-form input[name=code]').value = state.deepLot; lookupCode(state.deepLot); return; }
  show(state.view);
}
function planLabel() {
  const a = state.me.account; if (!a) return '';
  if (a.plan === 'trial') { const days = Math.max(0, Math.ceil((new Date(a.trial_ends_at) - Date.now()) / 86400000)); return days ? `trial, ${days} day${days === 1 ? '' : 's'} left` : 'trial ended'; }
  return a.plan;
}
function showAuth() {
  $('#auth').hidden = false; $('#nav').hidden = true; $('#acct').hidden = true; $$('.view').forEach((v) => (v.hidden = true));
  const signup = location.hash === '#signup';
  $('#auth-title').textContent = signup ? 'Create your account' : 'Sign in';
  $('#auth-form [name=business]').parentElement.hidden = !signup;
  $('#auth-form button').textContent = signup ? 'Start free trial' : 'Sign in';
  $('#auth-switch').innerHTML = signup ? 'Already have an account? <a href="#signin">Sign in</a>.' : 'New here? <a href="#signup">Create an account</a>. Free for 30 days, no card.';
}
window.addEventListener('hashchange', () => { if (!state.me?.signedIn) showAuth(); });
$('#auth-form').addEventListener('submit', async (e) => {
  e.preventDefault(); $('#auth-err').textContent = '';
  const fd = Object.fromEntries(new FormData(e.target).entries());
  try { await api(location.hash === '#signup' ? '/api/auth/signup' : '/api/auth/login', { method: 'POST', body: fd }); location.hash = ''; await boot(); }
  catch (err) { $('#auth-err').textContent = err.message; }
});
$('#btn-logout').onclick = async () => { await api('/api/auth/logout', { method: 'POST' }); location.reload(); };

/* ---------- navigation ---------- */
$$('#nav button').forEach((b) => (b.onclick = () => show(b.dataset.view)));
async function show(view) {
  state.view = view;
  $$('#nav button').forEach((b) => b.classList.toggle('on', b.dataset.view === view));
  $$('.view').forEach((v) => (v.hidden = v.id !== `view-${view}`));
  if (view === 'lots') { await loadLots(); renderLots(); }
  if (view === 'products') { await loadProducts(); renderProducts(); }
  if (view === 'orders') { await loadOrders(); renderOrders(); }
  if (view === 'account') renderAccount();
  if (view !== 'scan') stopScan();
}

/* ---------- products ---------- */
async function loadProducts() { state.products = (await api('/api/products')).products; const rm = $('#btn-sample-remove'); if (rm) rm.hidden = !state.products.some((p) => p.sample); }
async function loadSample() {
  try {
    await api('/api/sample', { method: 'POST' });
    toast('Sample data loaded. Remove it any time from Account.');
    await Promise.all([loadProducts(), loadLots(), loadOrders()]); renderProducts(); renderLots(); renderOrders();
  } catch (e) { toast(e.message, true); }
}
$('#btn-sample-remove').onclick = async () => {
  if (!confirm('Remove the sample products, lots and orders? Your own records stay.')) return;
  try { await api('/api/sample', { method: 'DELETE' }); toast('Sample data removed'); await Promise.all([loadProducts(), loadLots(), loadOrders()]); renderProducts(); renderLots(); renderOrders(); } catch (e) { toast(e.message, true); }
};
function renderProducts() {
  const el = $('#products-list');
  if (!state.products.length) { el.innerHTML = '<div class="empty">Add your first product. A product is anything you make in batches.<br><button class="small" id="btn-sample-load" style="margin-top:.6rem">Or load sample data to look around</button></div>'; $('#btn-sample-load').onclick = loadSample; return; }
  el.innerHTML = state.products.map((p) => `<div class="item">
    <div><div class="t">${esc(p.name)}${p.components ? '<span class="tag">kit</span>' : ''}${p.active ? '' : '<span class="tag">archived</span>'}</div>
    <div class="s">${p.components ? `Packs as ${esc(kitText(p).replace(/\n/g, ', '))}` : `${p.active_lots} active lot${p.active_lots === 1 ? '' : 's'} · ${p.units_on_hand} ${esc(p.unit_label)}${p.units_on_hand === 1 ? '' : 's'} on hand${p.shelf_life_days ? ` · best by ${p.shelf_life_days} days after made` : ''}`}</div></div>
    <div class="actions"><button class="small" data-edit="${p.id}">Edit</button>${p.components ? '' : `<button class="small" data-lot-for="${p.id}">Log batch</button>`}</div></div>`).join('');
  $$('[data-edit]', el).forEach((b) => (b.onclick = () => editProduct(state.products.find((p) => p.id === b.dataset.edit))));
  $$('[data-lot-for]', el).forEach((b) => (b.onclick = () => newLot(b.dataset.lotFor)));
}
const productFields = (p = {}) => `
  <label>Name <input name="name" required value="${esc(p.name || '')}" placeholder="Fresh Milled Flour"></label>
  <label>Unit (bag, jar, tube, loaf) <input name="unit_label" value="${esc(p.unit_label || 'unit')}"></label>
  <label>Shelf life in days (optional; fills best-by automatically) <input name="shelf_life_days" type="number" min="1" max="3650" value="${p.shelf_life_days ?? ''}"></label>
  <label>Storefront id (optional). The id your website uses for this product, so the availability feed can match it <input name="storefront_id" maxlength="60" value="${esc(p.storefront_id || '')}"></label>
  <label>Next batch date (optional). Shown on your site while this is sold out <input name="next_batch_at" type="date" value="${esc(p.next_batch_at || '')}"></label>
  <label>Kit contents (optional). One line per part, like "2 x Lavender Bar Soap". A kit has no lots of its own; packing one takes the parts from their lots. <textarea name="kit" rows="3" placeholder="2 x Lavender Bar Soap&#10;1 x Strawberry Jam">${esc(kitText(p))}</textarea></label>`;
function kitText(p) {
  if (!p || !p.components) return '';
  let comps = []; try { comps = JSON.parse(p.components); } catch { return ''; }
  return comps.map((c) => { const q = state.products.find((x) => x.id === c.product_id); return `${c.units} x ${q ? q.name : '?'}`; }).join('\n');
}
$('#btn-new-product').onclick = async () => {
  const v = await dialog('New product', productFields(), 'Add'); if (!v) return;
  try { await api('/api/products', { method: 'POST', body: { ...v, shelf_life_days: v.shelf_life_days ? Number(v.shelf_life_days) : null } }); toast('Product added'); await loadProducts(); renderProducts(); } catch (e) { toast(e.message, true); }
};
async function editProduct(p) {
  const v = await dialog('Edit product', productFields(p) + `<label><span>Status</span><select name="active"><option value="1" ${p.active ? 'selected' : ''}>Active</option><option value="0" ${!p.active ? 'selected' : ''}>Archived</option></select></label>`); if (!v) return;
  try { await api('/api/products', { method: 'PATCH', body: { id: p.id, name: v.name, unit_label: v.unit_label, shelf_life_days: v.shelf_life_days ? Number(v.shelf_life_days) : null, active: v.active === '1', kit: v.kit || '', storefront_id: v.storefront_id || '', next_batch_at: v.next_batch_at || '' } }); toast('Saved'); await loadProducts(); renderProducts(); } catch (e) { toast(e.message, true); }
}

/* ---------- lots ---------- */
async function loadLots() { const r = await api(`/api/lots?status=${encodeURIComponent($('#lot-filter').value)}`); state.lots = r.lots; }
$('#lot-filter').onchange = async () => { await loadLots(); renderLots(); };
function renderLots() {
  const lots = state.lots;
  const active = lots.filter((l) => l.status === 'active');
  const soon = lots.filter((l) => l.sell_soon && l.status === 'active').length;
  const expired = lots.filter((l) => l.expired && l.status === 'active').length;
  const onHand = active.reduce((n, l) => n + l.units_left, 0);
  $('#kpis').innerHTML = `<div class="kpi"><b>${active.length}</b>active lots</div><div class="kpi"><b>${onHand}</b>units on hand</div><div class="kpi ${soon ? 'warn' : ''}"><b>${soon}</b>sell soon (30 days)</div><div class="kpi ${expired ? 'bad' : ''}"><b>${expired}</b>past best-by</div>`;
  const el = $('#lots-list');
  if (!lots.length) { el.innerHTML = `<div class="empty">${state.products.length ? 'No lots here yet. Log a batch when you make one.' : 'Add a product first, then log your first batch.<br><button class="small" id="btn-sample-load" style="margin-top:.6rem">Or load sample data to look around</button>'}</div>`; const b = $('#btn-sample-load'); if (b) b.onclick = loadSample; return; }
  el.innerHTML = lots.map((l) => {
    const pct = l.units_made ? Math.round((l.units_left / l.units_made) * 100) : 0;
    const tag = l.status === 'hold' ? '<span class="tag bad">on hold</span>' : l.status === 'sold_out' ? '<span class="tag">sold out</span>' : l.status === 'retired' ? '<span class="tag">retired</span>' : l.expired ? '<span class="tag bad">past best-by</span>' : l.sell_soon ? '<span class="tag warn">sell soon</span>' : '<span class="tag ok">good</span>';
    return `<div class="item">
      <div><div class="t">${esc(l.code)} · ${esc(l.product_name)}${tag}</div>
      <div class="s">Made ${fmtDate(l.made_at)}${l.best_by ? ` · best by ${fmtDate(l.best_by)}` : ''} · ${l.units_left} of ${l.units_made} ${esc(l.unit_label)}${l.units_made === 1 ? '' : 's'} left${l.unit_size ? ` · ${esc(l.unit_size)}` : ''}${l.supplier ? ` · from ${esc(l.supplier)}` : ''}</div></div>
      <div class="actions"><button class="small primary" data-move="${l.id}">Units out</button><button class="small" data-open="${l.id}">Details</button></div>
      <div class="bar"><i style="width:${pct}%"></i></div></div>`;
  }).join('');
  $$('[data-move]', el).forEach((b) => (b.onclick = () => moveUnits(state.lots.find((l) => l.id === b.dataset.move))));
  $$('[data-open]', el).forEach((b) => (b.onclick = () => lotDetails(b.dataset.open)));
}
$('#btn-new-lot').onclick = () => newLot();
async function newLot(productId) {
  if (!state.products.filter((p) => p.active && !p.components).length) { toast('Add a product first', true); return show('products'); }
  const opts = state.products.filter((p) => p.active && !p.components).map((p) => `<option value="${p.id}" ${p.id === productId ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
  const v = await dialog('Log a batch', `
    <label>Product <select name="product_id">${opts}</select></label>
    <label>Made on <input name="made_at" type="date" value="${today()}" required></label>
    <label>Units made <input name="units_made" type="number" min="0" required inputmode="numeric"></label>
    <label>Unit size (2 lb, 4 oz) <input name="unit_size"></label>
    <label>Best by (leave blank to use the product's shelf life) <input name="best_by" type="date"></label>
    <label>Lot code (leave blank to number it automatically) <input name="code" style="text-transform:uppercase"></label>
    <label>Supplier / source <input name="supplier"></label>
    <label>What went in <textarea name="inputs" placeholder="50 lb organic hard red wheat, Lot 2211 from Janie's Mill"></textarea></label>
    <label>Notes <textarea name="notes"></textarea></label>`, 'Log batch');
  if (!v) return;
  try { const r = await api('/api/lots', { method: 'POST', body: { ...v, units_made: Number(v.units_made) } }); toast(`Logged ${r.code}`); await loadLots(); renderLots(); await loadProducts(); } catch (e) { toast(e.message, true); }
}
async function moveUnits(l) {
  const v = await dialog(`${l.code}: units out`, `
    <p class="muted small">${l.units_left} ${esc(l.unit_label)}${l.units_left === 1 ? '' : 's'} left in this lot.</p>
    <label>What happened <select name="kind"><option value="sale">Online sale</option><option value="market">Market sale</option><option value="sample">Sample or gift</option><option value="shrink">Shrink, damage, personal use</option><option value="return">Returned to stock</option><option value="recount">Recount (enter what is physically on hand)</option></select></label>
    <label>Units <input name="units" type="number" min="1" required inputmode="numeric"></label>
    <label>Order or note (optional) <input name="note"></label>`, 'Record');
  if (!v) return;
  try { await api(`/api/lots/${l.id}`, { method: 'PATCH', body: { move: { kind: v.kind, units: Number(v.units), note: v.note, order_ref: v.kind === 'sale' ? v.note : '' } } }); toast('Recorded'); await loadLots(); renderLots(); } catch (e) { toast(e.message, true); }
}
async function lotDetails(id) {
  const { lot, moves } = await api(`/api/lots/${id}`);
  const hist = moves.length ? moves.map((m) => `<div class="s">${fmtDate(m.created_at.slice(0, 10))} · ${esc(m.kind)} · ${m.units > 0 ? '-' : '+'}${Math.abs(m.units)}${m.note ? ` · ${esc(m.note)}` : ''}</div>`).join('') : '<div class="s">No movements yet.</div>';
  const v = await dialog(`${lot.code} · ${lot.product_name}`, `
    <label>Best by <input name="best_by" type="date" value="${lot.best_by || ''}"></label>
    <label>Unit size <input name="unit_size" value="${esc(lot.unit_size || '')}"></label>
    <label>Supplier / source <input name="supplier" value="${esc(lot.supplier || '')}"></label>
    <label>What went in <textarea name="inputs">${esc(lot.inputs || '')}</textarea></label>
    <label>Notes <textarea name="notes">${esc(lot.notes || '')}</textarea></label>
    <label>Status <select name="status">${['active', 'sold_out', 'hold', 'retired'].map((s) => `<option value="${s}" ${lot.status === s ? 'selected' : ''}>${s.replace('_', ' ')}</option>`).join('')}</select></label>
    <label>Hold reason (if on hold) <input name="hold_reason" value="${esc(lot.hold_reason || '')}"></label>
    <p><a class="btn-link" href="/app/label?code=${encodeURIComponent(lot.code)}" target="_blank" rel="noopener">Print labels for this lot</a></p>
    <h2 style="margin-top:.6rem">History</h2>${hist}`);
  if (!v) return;
  try { await api(`/api/lots/${id}`, { method: 'PATCH', body: v }); toast('Saved'); await loadLots(); renderLots(); } catch (e) { toast(e.message, true); }
}


/* ---------- scan ---------- */
let scanStream = null, scanTimer = null, scanBusy = false, lastScan = '';
function stopScan() {
  if (scanTimer) { cancelAnimationFrame(scanTimer); scanTimer = null; }
  if (scanStream) { scanStream.getTracks().forEach((t) => t.stop()); scanStream = null; }
  const v = $('#scan-video'); if (v) { v.hidden = true; v.srcObject = null; }
  const b = $('#btn-scan-toggle'); if (b) b.textContent = 'Start camera';
}
async function startScan() {
  const video = $('#scan-video'), status = $('#scan-status');
  try {
    scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
  } catch (e) { status.textContent = 'Camera not available here. Type the code below instead.'; return; }
  video.srcObject = scanStream; video.hidden = false; await video.play();
  $('#btn-scan-toggle').textContent = 'Stop camera';
  status.textContent = 'Looking for a code...';
  const canvas = $('#scan-canvas'), ctx = canvas.getContext('2d', { willReadFrequently: true });
  const native = 'BarcodeDetector' in window ? new BarcodeDetector({ formats: ['qr_code', 'code_128'] }) : null;
  const tick = async () => {
    if (!scanStream) return;
    if (video.readyState >= 2 && !scanBusy) {
      scanBusy = true;
      try {
        let text = null;
        if (native) { const codes = await native.detect(video); if (codes.length) text = codes[0].rawValue; }
        else if (window.jsQR) {
          canvas.width = video.videoWidth; canvas.height = video.videoHeight; ctx.drawImage(video, 0, 0);
          const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const q = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' }); if (q) text = q.data;
        }
        if (text && text !== lastScan) { lastScan = text; setTimeout(() => (lastScan = ''), 4000); await lookupCode(text); }
      } catch (e) { /* keep scanning */ }
      scanBusy = false;
    }
    scanTimer = requestAnimationFrame(tick);
  };
  tick();
}
$('#btn-scan-toggle').onclick = () => (scanStream ? stopScan() : startScan());
$('#scan-form').onsubmit = (e) => { e.preventDefault(); const c = $('#scan-form input[name=code]').value; if (c.trim()) lookupCode(c); };
async function lookupCode(raw) {
  const status = $('#scan-status'), out = $('#scan-result');
  status.textContent = `Looking up ${raw.trim()}...`;
  const r = await api(`/api/lots/lookup?code=${encodeURIComponent(raw)}`);
  if (!r.found) { status.textContent = `No lot with code ${r.code} in this account.`; out.innerHTML = ''; return; }
  const l = r.lot; status.textContent = `Found ${l.code}.`;
  if (navigator.vibrate) navigator.vibrate(60);
  const tag = l.status === 'hold' ? '<span class="tag bad">on hold</span>' : l.status === 'sold_out' ? '<span class="tag">sold out</span>' : l.status === 'retired' ? '<span class="tag">retired</span>' : '<span class="tag ok">active</span>';
  out.innerHTML = `<div class="item">
    <div><div class="t">${esc(l.code)} · ${esc(l.product_name)}${tag}</div>
    <div class="s">Made ${fmtDate(l.made_at)}${l.best_by ? ` · best by ${fmtDate(l.best_by)}` : ''} · ${l.units_left} of ${l.units_made} ${esc(l.unit_label)}${l.units_made === 1 ? '' : 's'} left${l.unit_size ? ` · ${esc(l.unit_size)}` : ''}</div></div>
    <div class="actions"><button class="small primary" id="scan-move">Units out</button><button class="small" id="scan-open">Details</button></div></div>`;
  $('#scan-move').onclick = () => moveUnits(l).then(() => lookupCode(l.code));
  $('#scan-open').onclick = () => lotDetails(l.id).then(() => lookupCode(l.code));
}

/* ---------- orders / shipping ---------- */
async function loadOrders() { state.orders = (await api('/api/orders?status=all')).orders; }
function renderOrders() {
  const el = $('#orders-list');
  const open = state.orders.filter((o) => o.status === 'open');
  if (!state.orders.length) { el.innerHTML = '<div class="empty">No orders yet. Import a store export or add one by hand.</div>'; return; }
  el.innerHTML = state.orders.map((o) => {
    const packed = o.packed ? JSON.parse(o.packed) : null;
    const lots = packed ? packed.map((a) => `${esc(a.lot_code)} ×${a.units}`).join(', ') : '';
    return `<div class="item">
    <div><div class="t">${esc(o.order_ref)} · ${esc(o.customer_name)}<span class="tag ${o.status === 'open' ? 'warn' : o.status === 'shipped' ? 'ok' : ''}">${esc(o.status)}</span>${o.weight_oz ? '' : '<span class="tag bad">needs weight</span>'}${packed ? '<span class="tag ok">packed</span>' : o.status !== 'shipped' ? '<span class="tag">not packed</span>' : ''}</div>
    <div class="s">${esc(o.line1)}${o.line2 ? ', ' + esc(o.line2) : ''}, ${esc(o.city)}, ${esc(o.state)} ${esc(o.zip)}${o.items ? ' · ' + esc(o.items) : ''}${o.weight_oz ? ` · ${o.weight_oz} oz` : ''}${o.tracking ? ` · ${o.carrier ? esc(o.carrier.toUpperCase()) + ' ' : ''}${esc(o.tracking)}` : ''}</div>
    ${lots ? `<div class="s">From lots: ${lots}</div>` : ''}</div>
    <div class="actions">${packed ? `<button class="small" data-unpack="${o.id}">Unpack</button>` : `<button class="small primary" data-pack="${o.id}">Pack</button>`}<button class="small" data-weight="${o.id}">Weight</button>${o.status !== 'shipped' ? `<button class="small" data-ship="${o.id}">Mark shipped</button>` : ''}${o.status === 'exported' ? `<button class="small" data-reopen="${o.id}">Reopen</button>` : ''}</div></div>`;
  }).join('');
  $$('[data-pack]', el).forEach((b) => (b.onclick = () => packOrder(state.orders.find((o) => o.id === b.dataset.pack))));
  $$('[data-unpack]', el).forEach((b) => (b.onclick = () => unpackOrder(state.orders.find((o) => o.id === b.dataset.unpack))));
  $('#btn-pirate').disabled = !open.length;
}
async function packOrder(o, itemsText) {
  const items = itemsText ?? o.items ?? '';
  try {
    const r = await api('/api/orders/pack', { method: 'POST', body: { id: o.id, items } });
    toast(`Packed from ${r.packed.map((a) => a.lot_code).join(', ')}`);
    await Promise.all([loadOrders(), loadLots()]); renderOrders();
  } catch (e) {
    // Unmatched product or short stock: let them fix the items line and go again.
    const v = await dialog(`${o.order_ref}: pack`, `<p class="err">${esc(e.message)}</p>
      <label>Items, one per line or comma separated, like "2 x Fresh Milled Flour" <textarea name="items" rows="3">${esc(items)}</textarea></label>
      <p class="hint">Oldest lot goes first. If a line is short, nothing is taken from any lot.</p>`, 'Pack');
    if (v) return packOrder(o, v.items);
  }
}
async function unpackOrder(o) {
  if (!confirm(`Put ${o.order_ref}'s units back on their lots?`)) return;
  try { await api('/api/orders/pack', { method: 'POST', body: { id: o.id, undo: true } }); toast('Units put back'); await Promise.all([loadOrders(), loadLots()]); renderOrders(); } catch (e) { toast(e.message, true); }
}
async function setWeight(o) {
  const v = await dialog(`${o.order_ref}: package`, `
    <label>Weight (oz) <input name="weight_oz" type="number" step="0.1" min="0.1" required value="${o.weight_oz ?? ''}"></label>
    <div class="row gap"><label>Length (in) <input name="length_in" type="number" step="0.1" value="${o.length_in ?? ''}"></label><label>Width <input name="width_in" type="number" step="0.1" value="${o.width_in ?? ''}"></label><label>Height <input name="height_in" type="number" step="0.1" value="${o.height_in ?? ''}"></label></div>`);
  if (!v) return;
  try { await api('/api/orders', { method: 'PATCH', body: { id: o.id, ...v } }); await loadOrders(); renderOrders(); } catch (e) { toast(e.message, true); }
}
async function markShipped(id) {
  const v = await dialog('Mark shipped', `<label>Tracking number (optional) <input name="tracking"></label>`, 'Shipped');
  if (!v) return;
  try { await api('/api/orders', { method: 'PATCH', body: { id, status: 'shipped', tracking: v.tracking } }); await loadOrders(); renderOrders(); } catch (e) { toast(e.message, true); }
}
$('#btn-new-order').onclick = async () => {
  const v = await dialog('New order', `
    <label>Order ref <input name="order_ref" required></label>
    <label>Name <input name="customer_name" required></label>
    <label>Email <input name="email" type="email"></label>
    <label>Address <input name="line1" required></label>
    <label>Apt / unit <input name="line2"></label>
    <div class="row gap"><label>City <input name="city" required></label><label>State <input name="state" required maxlength="2"></label><label>Zip <input name="zip" required></label></div>
    <label>Items <input name="items"></label>
    <label>Weight (oz) <input name="weight_oz" type="number" step="0.1"></label>`, 'Add');
  if (!v) return;
  try { await api('/api/orders', { method: 'POST', body: v }); toast('Order added'); await loadOrders(); renderOrders(); } catch (e) { toast(e.message, true); }
};
$('#btn-import-orders').onclick = () => pickFile(async (text) => {
  try { const r = await api('/api/orders', { method: 'POST', body: { csv: text } }); toast(`Imported ${r.inserted} order${r.inserted === 1 ? '' : 's'}${r.skipped.length ? `, skipped ${r.skipped.length}` : ''}`); await loadOrders(); renderOrders(); } catch (e) { toast(e.message, true); }
});
$('#btn-pirate').onclick = async () => {
  const pre = await api('/api/export/pirateship?dry=1');
  if (!pre.ready) { toast(pre.left.length ? `Nothing ready: ${pre.left.map((l) => `${l.order_ref} (${l.problem})`).join(', ')}` : 'No open orders', true); return; }
  if (pre.left.length && !confirm(`${pre.ready} ready. ${pre.left.length} will be left out: ${pre.left.map((l) => `${l.order_ref} (${l.problem})`).join(', ')}. Continue?`)) return;
  location.href = '/api/export/pirateship';
  setTimeout(async () => { await loadOrders(); renderOrders(); }, 1500);
};

/* ---------- account ---------- */
function renderAccount() {
  const a = state.me.account;
  $('#plan-line').textContent = a.plan === 'trial' ? `Free trial: ${planLabel()}. Everything you enter stays if the trial ends; adding new records needs a plan.` : `Current plan: ${({ lifetime: 'Solo lifetime', monthly: 'Solo', connected: 'Connected', house: 'Connected (house account)', free: 'ended, read-only' })[a.plan] || a.plan}.`;
  const f = $('#acct-form'); f.name.value = a.name; f.lot_prefix.value = a.lot_prefix; f.lot_next.value = a.lot_next; f.lot_step.value = a.lot_step;
  $('#connect-gate').hidden = ['connected', 'house', 'trial'].includes(a.plan);
  const o = location.origin;
  $('#url-in-stripe').textContent = `${o}/api/in/stripe/${a.inbound_token}`;
  $('#url-in-shopify').textContent = `${o}/api/in/shopify/${a.inbound_token}`;
  $('#url-avail').textContent = `${o}/api/public/${a.public_token}/availability`;
  const first = state.lots && state.lots[0];
  $('#url-lot-example').textContent = `${o}/l/${a.public_token}/${first ? first.code : 'LOT1000'}`;
  $('#public-line-form').public_line.value = a.public_line || '';
  $('#stripe-key-state').textContent = a.has_stripe_read_key ? 'A key is saved. Paste a new one to replace it, or leave blank.' : 'No key saved.';
}
$$('[data-copy]').forEach((b) => (b.onclick = async () => { try { await navigator.clipboard.writeText($('#' + b.dataset.copy).textContent); toast('Copied'); } catch { toast('Select the link and copy it', true); } }));
$('#btn-rotate-inbound').onclick = async () => {
  if (!confirm('Rotate the inbound links? Every webhook that uses the old link stops working until you paste the new one.')) return;
  try { const r = await api('/api/account', { method: 'PATCH', body: { rotate: 'inbound' } }); state.me.account = r.account; renderAccount(); toast('New links. Update Stripe and Shopify.'); } catch (e) { toast(e.message, true); }
};
$('#public-line-form').onsubmit = async (e) => { e.preventDefault(); try { const r = await api('/api/account', { method: 'PATCH', body: { public_line: e.target.public_line.value } }); state.me.account = r.account; toast('Saved'); } catch (err) { toast(err.message, true); } };
$('#stripe-key-form').onsubmit = async (e) => { e.preventDefault(); const k = e.target.stripe_read_key.value; try { const r = await api('/api/account', { method: 'PATCH', body: { stripe_read_key: k } }); state.me.account = r.account; e.target.stripe_read_key.value = ''; renderAccount(); toast(k ? 'Key saved' : 'Key removed'); } catch (err) { toast(err.message, true); } };
$('#acct-form').onsubmit = async (e) => { e.preventDefault(); const v = Object.fromEntries(new FormData(e.target).entries()); try { const r = await api('/api/account', { method: 'PATCH', body: { ...v, lot_next: Number(v.lot_next), lot_step: Number(v.lot_step) } }); state.me.account = r.account; toast('Saved'); $('#acct').textContent = `${r.account.name} · ${planLabel()}`; } catch (err) { toast(err.message, true); } };
let stripeJs = null, embedded = null;
function loadStripeJs() {
  if (window.Stripe) return Promise.resolve();
  if (stripeJs) return stripeJs;
  stripeJs = new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://js.stripe.com/v3/'; s.onload = res; s.onerror = () => rej(new Error('Could not load the card form. Check your connection and try again.')); document.head.appendChild(s); });
  return stripeJs;
}
async function openCheckout(plan) {
  try {
    const cfg = await api('/api/billing/config');
    if (!cfg.configured) { toast('Billing is not switched on yet. Your trial keeps running.', true); return; }
    await loadStripeJs();
    const r = await api('/api/billing/checkout', { method: 'POST', body: { plan } });
    if (embedded) { embedded.destroy(); embedded = null; }
    $('#checkout-title').textContent = plan === 'lifetime' ? 'LotLedger Solo lifetime, $149 once' : plan === 'connected' ? 'LotLedger Connected, $39 a month' : 'LotLedger Solo, $19 a month';
    $('#checkout-wrap').hidden = false;
    const stripe = Stripe(cfg.publishableKey);
    embedded = await stripe.initEmbeddedCheckout({ clientSecret: r.clientSecret });
    embedded.mount('#checkout-host');
    $('#checkout-wrap').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) { toast(e.message, true); }
}
$$('[data-plan]').forEach((b) => (b.onclick = () => openCheckout(b.dataset.plan)));
$('#btn-checkout-close').onclick = () => { if (embedded) { embedded.destroy(); embedded = null; } $('#checkout-wrap').hidden = true; };
$('#btn-restore').onclick = () => pickFile(async (text) => {
  try { const data = JSON.parse(text); const r = await api('/api/backup', { method: 'POST', body: data }); toast(`Imported ${r.lots_seen} lots, ${r.products_created} new products`); await loadProducts(); } catch (e) { toast(e.message.includes('JSON') ? 'That file is not JSON' : e.message, true); }
});
function pickFile(cb) { const f = $('#file'); f.value = ''; f.onchange = () => { const file = f.files[0]; if (!file) return; file.text().then(cb); }; f.click(); }

boot().catch((e) => { console.error(e); showAuth(); });
window.addEventListener('hashchange', async () => {
  const m = location.hash.match(/[#&]lot=([^&]+)/); if (!m || !state.me?.signedIn) return;
  const code = decodeURIComponent(m[1]); await show('scan'); $('#scan-form input[name=code]').value = code; lookupCode(code);
});
