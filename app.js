(function () {
  'use strict';

  const $app = document.getElementById('app');
  const DB_NAME = 'receipt-rights';
  const PROFILE_KEY = 'rr-profile';
  const BACKUP_KEY = 'rr-last-backup';
  const MAX_IMAGE_PX = 1600;
  const MAX_PDF_BYTES = 5 * 1024 * 1024;

  // Rough "how long should it last" starting points. The user's own estimate is what's used.
  const CATEGORIES = {
    '': { label: 'Choose…', years: '' },
    phone: { label: 'Phone or tablet', years: 3 },
    computer: { label: 'Computer or laptop', years: 4 },
    tv: { label: 'TV or audio', years: 6 },
    small_appliance: { label: 'Small appliance (kettle, toaster, vacuum)', years: 3 },
    large_appliance: { label: 'Large appliance (fridge, washer, oven)', years: 8 },
    furniture: { label: 'Furniture or mattress', years: 7 },
    tools: { label: 'Tools or garden', years: 5 },
    clothing: { label: 'Clothing or shoes', years: 1 },
    other: { label: 'Other', years: '' },
  };

  // ---------- storage ----------
  let dbPromise;
  function db() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore('items', { keyPath: 'id' });
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbPromise;
  }
  async function tx(mode, fn) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const t = d.transaction('items', mode);
      const store = t.objectStore('items');
      const req = fn(store);
      t.oncomplete = () => resolve(req && req.result);
      t.onerror = () => reject(t.error);
    });
  }
  const allItems = () => tx('readonly', s => s.getAll());
  const getItem = id => tx('readonly', s => s.get(id));
  const putItem = item => tx('readwrite', s => s.put(item));
  const deleteItem = id => tx('readwrite', s => s.delete(id));
  const clearItems = () => tx('readwrite', s => s.clear());

  function loadProfile() {
    try { return JSON.parse(localStorage.getItem(PROFILE_KEY)) || {}; } catch { return {}; }
  }
  function saveProfile(p) { localStorage.setItem(PROFILE_KEY, JSON.stringify(p)); }

  // ---------- helpers ----------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function today() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function uid() {
    return (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  }
  function toast(msg) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2600);
  }
  function go(hash) { location.hash = hash; }
  function formData(form) {
    const out = {};
    for (const el of form.elements) {
      if (!el.name) continue;
      if (el.type === 'checkbox') {
        if (el.dataset.multi) { (out[el.name] = out[el.name] || []); if (el.checked) out[el.name].push(el.value); }
        else out[el.name] = el.checked;
      } else if (el.type === 'radio') {
        if (el.checked) out[el.name] = el.value;
      } else out[el.name] = el.value;
    }
    return out;
  }

  function compressImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, MAX_IMAGE_PX / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', 0.82));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(`Couldn't read ${file.name}. Try a JPEG or PNG.`)); };
      img.src = url;
    });
  }
  function readAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });
  }
  async function fileToAttachment(file) {
    if (file.type === 'application/pdf') {
      if (file.size > MAX_PDF_BYTES) throw new Error(`${file.name} is over 5 MB.`);
      return { id: uid(), kind: 'pdf', name: file.name, data: await readAsDataUrl(file) };
    }
    return { id: uid(), kind: 'image', name: file.name, data: await compressImage(file) };
  }
  function openAttachment(att) {
    if (att.kind === 'image') {
      const v = document.getElementById('viewer');
      v.querySelector('img').src = att.data;
      v.showModal();
      return;
    }
    fetch(att.data).then(r => r.blob()).then(b => window.open(URL.createObjectURL(b), '_blank'));
  }

  function warrantyPill(item) {
    const w = ACL.warrantyStatus(item, today());
    if (!w) return '<span class="pill none">No warranty recorded</span>';
    if (w.expired) return `<span class="pill off">Warranty ended ${esc(ACL.formatDate(w.ends))} — your rights may still apply</span>`;
    return `<span class="pill ok">Warranty to ${esc(ACL.formatDate(w.ends))}</span>`;
  }
  function thumb(item) {
    const img = (item.photos || []).find(p => p.kind === 'image');
    return img ? `<img class="thumb" src="${img.data}" alt="">` : '<div class="thumb"></div>';
  }
  function attachmentTiles(photos, removable) {
    return (photos || []).map(p => `
      <figure data-att="${esc(p.id)}">
        ${p.kind === 'image'
          ? `<img src="${p.data}" alt="${esc(p.name)}">`
          : `<button type="button" class="pdf" style="width:96px;height:96px">PDF<br><small>${esc(p.name.slice(0, 14))}</small></button>`}
        ${removable ? `<button type="button" class="remove" aria-label="Remove ${esc(p.name)}">✕</button>` : ''}
      </figure>`).join('');
  }
  function wireAttachmentTiles(container, photos, onRemove) {
    container.querySelectorAll('figure').forEach(fig => {
      const att = photos.find(p => p.id === fig.dataset.att);
      fig.querySelector('img, .pdf').addEventListener('click', () => openAttachment(att));
      const rm = fig.querySelector('.remove');
      if (rm) rm.addEventListener('click', () => onRemove(att.id));
    });
  }

  // ---------- views ----------
  async function viewList() {
    const items = (await allItems()).sort((a, b) => (b.purchaseDate || '').localeCompare(a.purchaseDate || ''));
    const lastBackup = localStorage.getItem(BACKUP_KEY);
    const needsBackup = items.length > 0 && (!lastBackup || (Date.now() - Number(lastBackup)) > 30 * 864e5);
    if (!items.length) {
      $app.innerHTML = `
        <div class="card empty">
          <h2>Something broke? You may have more rights than the warranty says.</h2>
          <p class="muted">Under the Australian Consumer Law, goods must last a reasonable time — even after the manufacturer's warranty runs out. Save your receipts here, and when something fails, get a claim letter that cites the law.</p>
          <p class="row" style="justify-content:center">
            <a class="btn primary" href="#/item/new">Add a receipt</a>
            <a class="btn" href="#/item/new?claim=1">Something's broken now</a>
          </p>
          <p class="muted">Everything stays on this device. Nothing is uploaded.</p>
        </div>
        ${disclaimer()}`;
      return;
    }
    $app.innerHTML = `
      ${needsBackup ? `<div class="card row spread no-print"><span>Your receipts live only on this device. Back them up so you don't lose them.</span><a class="btn" href="#/settings">Back up</a></div>` : ''}
      <div class="row spread">
        <h2>Your receipts <span class="muted">(${items.length})</span></h2>
        <a class="btn primary" href="#/item/new">Add a receipt</a>
      </div>
      <input type="search" id="search" placeholder="Search by item or store" aria-label="Search receipts">
      <div id="list" style="margin-top:12px"></div>
      ${disclaimer()}`;
    const list = document.getElementById('list');
    const render = q => {
      const needle = q.trim().toLowerCase();
      const shown = items.filter(i => !needle || `${i.name} ${i.store}`.toLowerCase().includes(needle));
      list.innerHTML = shown.map(i => `
        <div class="card item" data-id="${esc(i.id)}" tabindex="0" role="link">
          ${thumb(i)}
          <div class="meta">
            <div class="name">${esc(i.name)}</div>
            <div class="muted">${esc(i.store || 'Unknown store')} · ${i.purchaseDate ? esc(ACL.formatDate(i.purchaseDate)) : 'no date'} · ${esc(ACL.money(i.price || 0))}</div>
            <div style="margin-top:4px">${warrantyPill(i)}</div>
          </div>
        </div>`).join('') || '<p class="muted">No matches.</p>';
      list.querySelectorAll('.item').forEach(el => {
        const open = () => go(`#/item/${el.dataset.id}`);
        el.addEventListener('click', open);
        el.addEventListener('keydown', e => { if (e.key === 'Enter') open(); });
      });
    };
    document.getElementById('search').addEventListener('input', e => render(e.target.value));
    render('');
  }

  async function viewEdit(id, thenClaim) {
    const existing = id ? await getItem(id) : null;
    if (id && !existing) return go('#/');
    const item = existing || { id: uid(), photos: [], purchaseDate: today() };
    let photos = [...(item.photos || [])];
    $app.innerHTML = `
      <h2>${existing ? 'Edit receipt' : thenClaim ? 'First, tell us what you bought' : 'Add a receipt'}</h2>
      <form id="f" class="card" novalidate>
        <label for="name">What is it?</label>
        <input type="text" id="name" name="name" required placeholder="e.g. Breville kettle" value="${esc(item.name)}">
        <div class="grid2">
          <div><label for="store">Store or seller</label><input type="text" id="store" name="store" placeholder="e.g. Harvey Norman Geelong" value="${esc(item.store)}"></div>
          <div><label for="price">Price paid ($)</label><input type="number" id="price" name="price" min="0" step="0.01" inputmode="decimal" required value="${esc(item.price)}"></div>
          <div><label for="purchaseDate">Date bought</label><input type="date" id="purchaseDate" name="purchaseDate" required max="${today()}" value="${esc(item.purchaseDate)}"></div>
          <div><label for="category">Type of item</label><select id="category" name="category">${Object.entries(CATEGORIES).map(([k, c]) => `<option value="${k}" ${item.category === k ? 'selected' : ''}>${esc(c.label)}</option>`).join('')}</select></div>
          <div><label for="warrantyMonths">Manufacturer's warranty <span class="muted">(months)</span></label><input type="number" id="warrantyMonths" name="warrantyMonths" min="0" step="1" placeholder="e.g. 12" value="${esc(item.warrantyMonths)}"></div>
          <div><label for="receiptRef">Receipt or order number <span class="muted">(optional)</span></label><input type="text" id="receiptRef" name="receiptRef" value="${esc(item.receiptRef)}"></div>
        </div>
        <label for="notes">Notes <span class="muted">(optional)</span></label>
        <textarea id="notes" name="notes" placeholder="Serial number, extended warranty, where it's kept…">${esc(item.notes)}</textarea>
        <label for="files">Receipt photos or PDFs <span class="muted">(a bank statement or order email counts too)</span></label>
        <input type="file" id="files" accept="image/*,application/pdf" multiple capture="environment">
        <div class="photos" id="photos"></div>
        <p class="muted hidden" id="err" style="color:var(--bad)"></p>
        <div class="row" style="margin-top:16px">
          <button class="primary" type="submit">${thenClaim ? 'Next: the problem' : 'Save'}</button>
          <a class="btn" href="${existing ? `#/item/${esc(item.id)}` : '#/'}">Cancel</a>
        </div>
      </form>`;
    const $photos = document.getElementById('photos');
    const drawPhotos = () => {
      $photos.innerHTML = attachmentTiles(photos, true);
      wireAttachmentTiles($photos, photos, rid => { photos = photos.filter(p => p.id !== rid); drawPhotos(); });
    };
    drawPhotos();
    document.getElementById('files').addEventListener('change', async e => {
      for (const file of e.target.files) {
        try { photos.push(await fileToAttachment(file)); } catch (err) { toast(err.message); }
      }
      e.target.value = '';
      drawPhotos();
    });
    document.getElementById('f').addEventListener('submit', async e => {
      e.preventDefault();
      const d = formData(e.target);
      const problems = [];
      if (!d.name.trim()) problems.push('what the item is');
      if (d.price === '' || Number(d.price) < 0) problems.push('the price');
      if (!d.purchaseDate) problems.push('the date bought');
      const $err = document.getElementById('err');
      if (problems.length) { $err.textContent = `Please add ${problems.join(', ')}.`; $err.classList.remove('hidden'); return; }
      const saved = Object.assign({}, item, {
        name: d.name.trim(), store: d.store.trim(), price: Number(d.price), purchaseDate: d.purchaseDate,
        category: d.category, warrantyMonths: d.warrantyMonths === '' ? '' : Number(d.warrantyMonths),
        receiptRef: d.receiptRef.trim(), notes: d.notes, photos, updatedAt: Date.now(),
      });
      await putItem(saved);
      go(thenClaim ? `#/item/${saved.id}/claim` : `#/item/${saved.id}`);
    });
  }

  async function viewItem(id) {
    const item = await getItem(id);
    if (!item) return go('#/');
    const age = ACL.monthsBetween(item.purchaseDate, today());
    $app.innerHTML = `
      <p class="no-print"><a href="#/">← All receipts</a></p>
      <div class="card">
        <h2 style="margin-top:0">${esc(item.name)}</h2>
        <p class="muted" style="margin:0">${esc(item.store || 'Unknown store')} · ${esc(ACL.money(item.price || 0))}</p>
        <p style="margin:6px 0">Bought ${esc(ACL.formatDate(item.purchaseDate))} (${esc(ACL.formatAge(age))} ago)</p>
        ${warrantyPill(item)}
        ${item.receiptRef ? `<p class="muted">Receipt/order: ${esc(item.receiptRef)}</p>` : ''}
        ${item.notes ? `<p style="white-space:pre-wrap">${esc(item.notes)}</p>` : ''}
        <div class="photos" id="photos">${attachmentTiles(item.photos, false)}</div>
        <div class="row" style="margin-top:16px">
          <a class="btn primary" href="#/item/${esc(item.id)}/claim">${item.claim ? 'Review my claim' : "It's broken or faulty"}</a>
          <a class="btn" href="#/item/${esc(item.id)}/edit">Edit</a>
          <button class="danger" id="del" type="button">Delete</button>
        </div>
      </div>
      ${disclaimer()}`;
    wireAttachmentTiles(document.getElementById('photos'), item.photos || [], () => {});
    document.getElementById('del').addEventListener('click', async () => {
      if (!confirm(`Delete "${item.name}" and its photos? This can't be undone.`)) return;
      await deleteItem(item.id);
      go('#/');
    });
  }

  function radios(name, options, current) {
    return options.map(([v, label]) => `<label class="opt"><input type="radio" name="${name}" value="${v}" ${current === v ? 'checked' : ''}> <span>${label}</span></label>`).join('');
  }
  function check(name, label, current, hint) {
    return `<label class="opt"><input type="checkbox" name="${name}" ${current ? 'checked' : ''}> <span>${label}${hint ? `<br><span class="muted">${hint}</span>` : ''}</span></label>`;
  }

  async function viewClaim(id) {
    const item = await getItem(id);
    if (!item) return go('#/');
    const prev = (item.claim && item.claim.answers) || {};
    const a = Object.assign({
      sellerType: 'business', use: 'personal', faultKinds: [], stillHaveIt: 'yes', alreadyAsked: 'no',
      preferredRemedy: 'refund', easilyFixed: 'unsure', expectedYears: (CATEGORIES[item.category] || {}).years || '',
    }, prev);
    if (typeof a.stillHaveIt === 'boolean') a.stillHaveIt = a.stillHaveIt ? 'yes' : 'no';
    const kinds = new Set(a.faultKinds);
    const kindBox = (v, label, hint) => `<label class="opt"><input type="checkbox" name="faultKinds" data-multi="1" value="${v}" ${kinds.has(v) ? 'checked' : ''}> <span>${label}${hint ? `<br><span class="muted">${hint}</span>` : ''}</span></label>`;
    $app.innerHTML = `
      <p class="no-print"><a href="#/item/${esc(item.id)}">← ${esc(item.name)}</a></p>
      <h2>What's wrong with your ${esc(item.name)}?</h2>
      <form id="f" novalidate>
        <fieldset><legend>The problem</legend>
          ${kindBox('defect', 'It broke, stopped working, or wore out too soon', 'Faulty, poor quality, or not as durable as you would reasonably expect')}
          ${kindBox('safety', "It's unsafe", 'e.g. overheats, sparks, sharp edges, recalled')}
          ${kindBox('purpose', "It doesn't do what I told the seller I needed", 'You said what you needed it for, and they said (or implied) it would do it')}
          ${kindBox('description', "It's not as described or advertised", 'Different from the listing, packaging, ad or what the salesperson said')}
          ${kindBox('sample', "It's different from the display model or sample I was shown")}
          <label for="faultDescription">Describe it in a sentence or two</label>
          <textarea id="faultDescription" name="faultDescription" placeholder="e.g. After 14 months the kettle stopped heating. The light comes on but the water stays cold.">${esc(a.faultDescription)}</textarea>
        </fieldset>

        <fieldset><legend>How serious is it?</legend>
          ${check('stopsNormalUse', "It can't do its normal job any more", a.stopsNormalUse)}
          <div><strong>Could it be fixed easily and quickly?</strong>
          ${radios('easilyFixed', [['yes', 'Yes — a quick, simple fix'], ['no', 'No — not easily, or not within a reasonable time'], ['unsure', 'Not sure']], a.easilyFixed)}</div>
          ${check('wouldNotHaveBought', 'A reasonable person who knew about this problem would not have bought it', a.wouldNotHaveBought, 'This is the most common way a fault counts as a "major failure".')}
          ${check('significantDifference', 'It is significantly different from the description or sample (not just a small detail)', a.significantDifference)}
          ${check('multipleProblems', "There are several problems, or it's been repaired before and failed again", a.multipleProblems)}
        </fieldset>

        <fieldset><legend>The purchase</legend>
          <div><strong>Who did you buy it from?</strong>
          ${radios('sellerType', [['business', 'A business (shop, online store, manufacturer)'], ['private', 'A private person (e.g. Marketplace, Gumtree)'], ['auction', 'An auction run by an auctioneer']], a.sellerType)}</div>
          <div><strong>What did you buy it for?</strong>
          ${radios('use', [['personal', 'Personal or household use'], ['business', 'My business']], a.use)}</div>
          ${Number(item.price) >= ACL.BUSINESS_USE_CAP ? check('commonlyPersonal', 'Goods like this are commonly bought for personal or household use', a.commonlyPersonal) : ''}
          ${check('boughtForResale', 'I bought it to resell, or to use up in making or repairing other goods', a.boughtForResale)}
          ${check('causedByMe', 'The damage was caused by me — misuse, an accident, or using it in an unusual way', a.causedByMe)}
          ${check('toldBeforeBuying', 'The seller pointed out this exact problem before I bought it', a.toldBeforeBuying)}
          <label for="expectedYears">How many years would a reasonable person expect it to last? <span class="muted">(your estimate — price, brand and how it was marketed all matter)</span></label>
          <input type="number" id="expectedYears" name="expectedYears" min="0" step="0.5" value="${esc(a.expectedYears)}" style="max-width:140px">
          <div><strong>Do you still have it?</strong>
          ${radios('stillHaveIt', [['yes', 'Yes'], ['no', 'No — I threw it out, lost it or gave it away']], a.stillHaveIt)}</div>
        </fieldset>

        <fieldset><legend>What happens next</legend>
          <div><strong>Have you already asked the seller to fix it?</strong>
          ${radios('alreadyAsked', [['no', 'Not yet'], ['refused', 'Yes, and they refused'], ['too_slow', "Yes, but it's taking too long or they couldn't fix it"]], a.alreadyAsked)}</div>
          <div><strong>If it's a major failure, what would you like?</strong>
          ${radios('preferredRemedy', [['refund', 'A refund'], ['replacement', 'A replacement'], ['compensation', 'Keep it and get compensation for its lower value']], a.preferredRemedy)}</div>
          <label for="lossDescription">Did the fault cost you anything else? <span class="muted">(optional — e.g. spoiled food, a call-out fee, damage to other things)</span></label>
          <input type="text" id="lossDescription" name="lossDescription" value="${esc(a.lossDescription)}">
          <label for="lossAmount">About how much? <span class="muted">($, optional)</span></label>
          <input type="number" id="lossAmount" name="lossAmount" min="0" step="0.01" value="${esc(a.lossAmount)}" style="max-width:160px">
          ${check('hasFaultPhotos', 'I have photos or video of the problem to attach', a.hasFaultPhotos)}
        </fieldset>
        <p class="muted hidden" id="err" style="color:var(--bad)"></p>
        <button class="primary" type="submit">Check my rights</button>
      </form>`;
    document.getElementById('f').addEventListener('submit', async e => {
      e.preventDefault();
      const d = formData(e.target);
      if (!d.faultKinds.length) {
        const $err = document.getElementById('err');
        $err.textContent = 'Tick at least one kind of problem at the top.';
        $err.classList.remove('hidden');
        e.target.querySelector('fieldset').scrollIntoView({ behavior: 'smooth' });
        return;
      }
      d.stillHaveIt = d.stillHaveIt !== 'no';
      item.claim = { answers: d, assessedOn: today() };
      await putItem(item);
      go(`#/item/${item.id}/result`);
    });
  }

  const STRENGTH = {
    strong: ['You have a strong claim', "Based on your answers, the law is on your side. Send the letter below."],
    moderate: ['You have a claim', 'The seller is entitled to try to fix it first. The letter below asks them to.'],
    weak: ['Your claim is weak', 'You may still be able to ask, but the seller has good grounds to refuse. See why below.'],
    none: ['This probably isn\'t covered', ''],
  };

  async function viewResult(id) {
    const item = await getItem(id);
    if (!item || !item.claim) return go(`#/item/${id}/claim`);
    const a = item.claim.answers;
    const r = ACL.assess(item, a, today());
    const profile = loadProfile();
    const [title, sub] = STRENGTH[r.strength];
    const agency = ACL.AGENCIES[profile.state];
    const notes = [...r.reasons, ...r.rejectNotes, ...r.warnings];
    const letter = r.covered ? ACL.buildLetter(item, a, r, profile, today()) : '';
    $app.innerHTML = `
      <p class="no-print"><a href="#/item/${esc(item.id)}/claim">← Change my answers</a></p>
      <div class="card verdict ${r.strength} no-print">
        <h3>${esc(title)}</h3>
        ${sub ? `<p>${esc(sub)}</p>` : ''}
        ${r.covered ? `
          <p><strong>Your rights:</strong> ${r.guarantees.map(g => `${esc(g.text)} <span class="muted">(${esc(g.section)})</span>`).join('; ')}.</p>
          <p><strong>${r.major ? 'This looks like a major failure' : 'This looks like a minor failure'}.</strong>
          ${r.major ? r.majorLimbs.map(l => `Because ${esc(l.text)} <span class="muted">(${esc(l.section)})</span>.`).join(' ') : ''}</p>
          <p><strong>What to ask for:</strong> ${esc(r.remedy.explain)}</p>
          <p class="muted">The goods are ${esc(ACL.formatAge(r.ageMonths))} old. Claim against the seller, not the manufacturer — the seller can't send you away to the manufacturer.</p>` : ''}
        ${notes.length ? `<h3>Things to know</h3><ul class="tight">${notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
      </div>
      ${r.covered ? `
        ${!profile.name || !profile.state ? `<div class="card no-print row spread"><span>Add your name and state so the letter is signed and names the right agency.</span><a class="btn" href="#/settings?back=${encodeURIComponent(`#/item/${item.id}/result`)}">Add details</a></div>` : ''}
        <div class="row spread no-print"><h3>Your letter</h3><span class="muted">Click the letter to edit it</span></div>
        <pre class="letter" id="letter" contenteditable="true" spellcheck="true">${esc(letter)}</pre>
        <div class="row no-print" style="margin-top:12px">
          <button class="primary" id="copy" type="button">Copy letter</button>
          <button id="email" type="button">Open in email</button>
          <button id="print" type="button">Print or save as PDF</button>
        </div>
        <div class="card no-print" style="margin-top:16px">
          <h3 style="margin-top:0">Next steps</h3>
          <ol class="tight">
            <li>Send the letter to the store in writing (email is fine) and keep a copy. Attach your receipt.</li>
            <li>Give them until the date in the letter to reply.</li>
            <li>If they refuse or don't reply, lodge a free complaint with ${agency ? `<a href="${esc(agency.url)}" target="_blank" rel="noopener">${esc(agency.name)}</a>` : 'your state or territory consumer protection agency'}.</li>
            <li>If that doesn't resolve it, you can apply to your state's civil tribunal (e.g. VCAT or NCAT) — usually inexpensive for small claims.</li>
          </ol>
        </div>` : ''}
      ${disclaimer()}`;
    if (!r.covered) return;
    const text = () => document.getElementById('letter').innerText;
    document.getElementById('copy').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(text()); toast('Letter copied'); }
      catch { toast('Copy failed — select the letter and copy it manually'); }
    });
    document.getElementById('email').addEventListener('click', () => {
      const subject = `Claim under the Australian Consumer Law — ${item.name}`;
      const body = text().split('\n').filter(l => !l.startsWith('Subject:')).join('\n');
      location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    });
    document.getElementById('print').addEventListener('click', () => window.print());
  }

  function viewSettings(back) {
    const p = loadProfile();
    $app.innerHTML = `
      <h2>Settings</h2>
      <form id="f" class="card">
        <h3 style="margin-top:0">Your details <span class="muted">(used to sign letters)</span></h3>
        <label for="pname">Your name</label>
        <input type="text" id="pname" name="name" value="${esc(p.name)}" autocomplete="name">
        <label for="pcontact">Phone or email for the seller to reply to <span class="muted">(optional)</span></label>
        <input type="text" id="pcontact" name="contact" value="${esc(p.contact)}">
        <label for="pstate">Your state or territory</label>
        <select id="pstate" name="state"><option value="">Choose…</option>${Object.keys(ACL.AGENCIES).map(s => `<option ${p.state === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
        <div class="row" style="margin-top:16px"><button class="primary" type="submit">Save</button></div>
      </form>
      <div class="card">
        <h3 style="margin-top:0">Backup</h3>
        <p class="muted">Your receipts are stored only in this browser. Browsers can clear site data — especially Safari on iPhone if you don't open the app for a while — so download a backup now and then.</p>
        <div class="row">
          <button id="export" type="button">Download backup</button>
          <label class="btn" style="margin:0;font-weight:400">Restore from backup<input type="file" id="import" accept="application/json,.json" class="hidden"></label>
        </div>
      </div>
      <div class="card">
        <h3 style="margin-top:0">Delete everything</h3>
        <button class="danger" id="wipe" type="button">Delete all receipts and details</button>
      </div>`;
    document.getElementById('f').addEventListener('submit', e => {
      e.preventDefault();
      const d = formData(e.target);
      saveProfile({ name: d.name.trim(), contact: d.contact.trim(), state: d.state });
      toast('Saved');
      if (back && back.startsWith('#/')) go(back);
    });
    document.getElementById('export').addEventListener('click', async () => {
      const blob = new Blob([JSON.stringify({ app: 'receipt-rights', version: 1, exportedAt: new Date().toISOString(), profile: loadProfile(), items: await allItems() })], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `receipt-rights-backup-${today()}.json`;
      a.click();
      localStorage.setItem(BACKUP_KEY, String(Date.now()));
      toast('Backup downloaded');
    });
    document.getElementById('import').addEventListener('change', async e => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        if (data.app !== 'receipt-rights' || !Array.isArray(data.items)) throw new Error('not a backup');
        for (const it of data.items) if (it && it.id) await putItem(it);
        if (data.profile && !loadProfile().name) saveProfile(data.profile);
        toast(`Restored ${data.items.length} receipt${data.items.length === 1 ? '' : 's'}`);
        go('#/');
      } catch { toast("That file isn't a Receipt Rights backup"); }
    });
    document.getElementById('wipe').addEventListener('click', async () => {
      if (!confirm('Delete every receipt, photo and your details from this device? This cannot be undone.')) return;
      await clearItems();
      localStorage.removeItem(PROFILE_KEY);
      localStorage.removeItem(BACKUP_KEY);
      go('#/');
    });
  }

  function disclaimer() {
    return `<p class="disclaimer">General information about the Australian Consumer Law, not legal advice. It covers goods bought from a business, not services, and every case depends on its facts. For help, contact your state or territory consumer protection agency or a community legal centre. Your data never leaves this device.</p>`;
  }

  // ---------- router ----------
  async function route() {
    const [path, query] = (location.hash || '#/').slice(1).split('?');
    const params = new URLSearchParams(query || '');
    const parts = path.split('/').filter(Boolean);
    window.scrollTo(0, 0);
    try {
      if (parts[0] === 'settings') return viewSettings(params.get('back'));
      if (parts[0] === 'item' && parts[1] === 'new') return await viewEdit(null, params.get('claim') === '1');
      if (parts[0] === 'item' && parts[1]) {
        if (parts[2] === 'edit') return await viewEdit(parts[1], false);
        if (parts[2] === 'claim') return await viewClaim(parts[1]);
        if (parts[2] === 'result') return await viewResult(parts[1]);
        return await viewItem(parts[1]);
      }
      return await viewList();
    } catch (err) {
      $app.innerHTML = `<div class="card"><h2>Something went wrong</h2><p>${esc(err.message)}</p><a class="btn" href="#/">Back to receipts</a></div>`;
      console.error(err);
    }
  }

  document.getElementById('home-link').addEventListener('click', () => go('#/'));
  document.getElementById('settings-btn').addEventListener('click', () => go('#/settings'));
  document.getElementById('viewer').addEventListener('click', e => e.currentTarget.close());
  window.addEventListener('hashchange', route);
  route();

  if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js');
})();
