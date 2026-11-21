(() => {
const $ = s => document.querySelector(s);
const eur = new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR'});
const CO2_PER_BAG = 2.5; // kg CO2e, estimation publiée par Too Good To Go
const DAYS = ['dim.','lun.','mar.','mer.','jeu.','ven.','sam.'];
const MONTHS = ['janv.','févr.','mars','avr.','mai','juin','juil.','août','sept.','oct.','nov.','déc.'];

function h(tag, attrs, ...kids){
  const el = document.createElement(tag);
  for (const [k,v] of Object.entries(attrs||{})){
    if (v==null || v===false) continue;
    if (k==='class') el.className = v; else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k==='style') el.style.cssText = v; else el.setAttribute(k, v===true?'':v);
  }
  for (const k of kids.flat()) if (k!=null && k!==false) el.append(k instanceof Node ? k : String(k));
  return el;
}
const hasMeals = p => p.repas !== null && p.repas !== undefined && p.repas !== '';
const catLabel = p => (p.categorie || 'Autre') + (p.rayon ? ' · ' + p.rayon : '');
const stars = n => '★'.repeat(n) + '☆'.repeat(5-n);
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const signed = v => (v>=0?'+':'−') + eur.format(Math.abs(v));
function localDate(d){ return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
const today = localDate(new Date());
$('#f-date').value = today; $('#k-date').value = today;

/* ---------- tabs ---------- */
const VIEWS = ['suivi','cuisiner','strategie'];
function show(v){
  if (!VIEWS.includes(v)) v = 'suivi';
  for (const x of VIEWS){ $('#v-'+x).hidden = x!==v; $('#tab-'+x).setAttribute('aria-selected', x===v); }
}
document.querySelectorAll('nav.tabs button').forEach(b => b.addEventListener('click', () => { location.hash = b.dataset.v; show(b.dataset.v); }));
window.addEventListener('hashchange', () => show(location.hash.slice(1)));
show(location.hash.slice(1));

/* ---------- Supabase ---------- */
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true } });
let ready = false;
let paniers = [], courses = [], budget = 120;

async function ensureSession(){
  const { data } = await sb.auth.getSession();
  if (data.session) return data.session;
  const { data: d2, error } = await sb.auth.signInAnonymously();
  if (error) throw error;
  return d2.session;
}
async function loadAll(){
  const [p, c, r] = await Promise.all([
    sb.from('paniers').select('*').order('date',{ascending:false}).order('created_at',{ascending:false}),
    sb.from('courses').select('*').order('date',{ascending:false}).order('created_at',{ascending:false}),
    sb.from('reglages').select('budget_hebdo').maybeSingle(),
  ]);
  if (p.error || c.error) throw p.error || c.error;
  paniers = p.data; courses = c.data;
  if (r.data) budget = num(r.data.budget_hebdo) || 120;
  if (document.activeElement !== $('#b-hebdo')) $('#b-hebdo').value = budget;
  render();
}

/* ---------- calculs ---------- */
function stats(list){
  const paid = list.reduce((a,p)=>a+num(p.prix),0);
  const val = list.reduce((a,p)=>a+(num(p.valeur)||num(p.prix)),0);
  const rated = list.filter(p=>num(p.note));
  const avg = rated.length ? rated.reduce((a,p)=>a+num(p.note),0)/rated.length : 0;
  const withMeals = list.filter(hasMeals);
  const meals = withMeals.reduce((a,p)=>a+num(p.repas),0);
  const paidMeals = withMeals.reduce((a,p)=>a+num(p.prix),0);
  return {n:list.length, paid, saved:Math.max(0,val-paid), avg, meals, perMeal: meals ? paidMeals/meals : 0};
}
function weekKey(ds){ const d = new Date((ds||'')+'T12:00:00'); if (isNaN(d)) return null; d.setDate(d.getDate()-((d.getDay()+6)%7)); return localDate(d); }
function weekLabel(k){ const d = new Date(k+'T12:00:00'); return `${d.getDate()} ${MONTHS[d.getMonth()]}`; }
function weeks(){
  const m = new Map();
  const get = k => { if (!m.has(k)) m.set(k,{k,courses:0,paniers:0}); return m.get(k); };
  for (const c of courses){ const k = weekKey(c.date); if (k) get(k).courses += num(c.montant); }
  for (const p of paniers){ const k = weekKey(p.date); if (k) get(k).paniers += num(p.prix); }
  const cur = weekKey(today);
  const list = [...m.values()].map(w => ({...w, total:w.courses+w.paniers, eco:budget-(w.courses+w.paniers), current:w.k===cur})).sort((a,b)=>b.k.localeCompare(a.k));
  const done = list.filter(w=>!w.current && w.k < cur);
  const ecoTotal = done.reduce((a,w)=>a+w.eco,0);
  return {list, done, ecoTotal, avg: done.length ? ecoTotal/done.length : 0, now: list.find(w=>w.current) || {courses:0,paniers:0,total:0,eco:budget}};
}

/* ---------- rendu suivi ---------- */
function renderStrip(){
  const s = stats(paniers);
  const month = stats(paniers.filter(p=>String(p.date||'').startsWith(today.slice(0,7))));
  const w = weeks();
  const cell = (k,v,sub,cls) => h('div',{}, h('div',{class:'k'},k), h('div',{class:'v'+(cls?' '+cls:'')},v), h('div',{class:'s'},sub));
  $('#strip').replaceChildren(
    cell('Économie vs budget', w.done.length ? signed(w.ecoTotal) : '–', w.done.length ? `${signed(w.avg)} par semaine en moyenne` : 'après ta 1re semaine complète', w.done.length ? (w.ecoTotal>=0?'pos':'neg') : ''),
    cell('Prix moyen par repas', s.meals ? eur.format(s.perMeal) : '–', s.meals ? `${s.meals} repas · ce mois-ci ${month.meals ? eur.format(month.perMeal) : '–'}` : 'indique le nombre de repas'),
    cell('Paniers sauvés', s.n, `${month.n} ce mois-ci · ≈ ${(s.n*CO2_PER_BAG).toLocaleString('fr-FR',{maximumFractionDigits:1})} kg CO₂ évités`),
    cell('Dépensé en paniers', eur.format(s.paid), `valeur annoncée ${eur.format(s.paid+s.saved)}`)
  );
}
function confirmDel(onConfirm){
  return async e => {
    const b = e.currentTarget;
    if (!b.classList.contains('arm')){ b.classList.add('arm'); b.textContent='Confirmer la suppression'; setTimeout(()=>{ if(!b.disabled){b.classList.remove('arm');b.textContent='Supprimer';} },4000); return; }
    b.disabled = true;
    try { await onConfirm(); await loadAll(); } catch { b.disabled=false; b.textContent='Échec, réessaie'; }
  };
}
function renderBudget(){
  const w = weeks(); const n = w.now;
  $('#weekNow').replaceChildren(
    'Cette semaine : ', h('b',{},eur.format(n.total)), ` dépensés sur ${eur.format(budget)}`,
    n.paniers ? ` (dont ${eur.format(n.paniers)} en paniers)` : '', ' · ',
    n.eco>=0 ? h('span',{class:'pos'},`il te reste ${eur.format(n.eco)}`) : h('span',{class:'neg'},`dépassement de ${eur.format(-n.eco)}`));
  const t = $('#weekTable');
  if (!w.list.length) t.replaceChildren(h('tr',{},h('td',{class:'muted'},'Note tes courses et tes paniers : chaque semaine apparaîtra ici.')));
  else t.replaceChildren(
    h('thead',{},h('tr',{},h('th',{},'Semaine du'),h('th',{class:'n'},'Courses'),h('th',{class:'n'},'Paniers'),h('th',{class:'n'},'Total'),h('th',{class:'n'},'Économie'))),
    h('tbody',{},...w.list.slice(0,12).map(x=>h('tr',{class:x.current?'now':null},
      h('td',{},weekLabel(x.k), x.current?h('span',{class:'small muted'},' (en cours)'):null),
      h('td',{class:'n'},eur.format(x.courses)), h('td',{class:'n'},eur.format(x.paniers)), h('td',{class:'n'},eur.format(x.total)),
      h('td',{class:'n'},h('span',{class:x.eco>=0?'pos':'neg'},signed(x.eco)))))));
  $('#courseList').replaceChildren(...(courses.length ? courses.slice(0,10).map(c=>h('div',{},
    h('span',{},`${c.date} · ${c.magasin||'Courses'}`),
    h('span',{}, eur.format(num(c.montant)), ' ', h('button',{class:'del',type:'button',onclick:confirmDel(()=>sb.from('courses').delete().eq('id',c.id).then(r=>{if(r.error)throw r.error;}))},'Supprimer')))) : [h('p',{class:'muted'},'Aucune course notée.')]));
}
function renderList(){
  $('#stores').replaceChildren(...[...new Set(paniers.map(p=>p.magasin).filter(Boolean))].map(s=>h('option',{value:s})));
  const list = $('#list');
  if (!paniers.length){ list.replaceChildren(h('div',{class:'empty'}, ready ? 'Aucun panier pour l’instant. Ajoute le premier avec le formulaire ci-dessus.' : 'Chargement…')); return; }
  list.replaceChildren(...paniers.map(p => {
    const d = new Date(p.date+'T12:00:00'); const value = num(p.valeur);
    return h('div',{class:'entry'},
      h('div',{class:'date'}, DAYS[d.getDay()], h('b',{}, d.getDate()), MONTHS[d.getMonth()]),
      h('div',{style:'min-width:0'},
        h('div',{class:'t'}, p.magasin),
        h('div',{class:'meta'}, h('span',{class:'pill'},catLabel(p)), p.heure?h('span',{},'Retrait '+p.heure):null, num(p.note)?h('span',{class:'stars',title:p.note+'/5'},stars(num(p.note))):null,
          hasMeals(p) ? h('span',{}, num(p.repas) ? `${p.repas} repas · ${eur.format(num(p.prix)/num(p.repas))}/repas` : '0 repas') : null),
        p.contenu ? h('div',{class:'cont'}, p.contenu) : null),
      h('div',{class:'price'}, h('b',{},eur.format(num(p.prix))), value>num(p.prix)?h('s',{},eur.format(value)):null,
        h('button',{class:'del',type:'button',onclick:()=>startEdit(p)},'Modifier'),
        h('button',{class:'del',type:'button',onclick:confirmDel(()=>sb.from('paniers').delete().eq('id',p.id).then(r=>{if(r.error)throw r.error;}))},'Supprimer')));
  }));
}

/* ---------- stratégie ---------- */
function slotOf(t){ if (!t) return null; const hh = parseInt(t.slice(0,2),10); if (hh<12) return 'Matin'; if (hh<15) return 'Midi'; if (hh<18) return 'Après-midi'; return 'Soir'; }
function group(list, key){
  const m = new Map();
  for (const p of list){ const k = key(p); if (!k) continue; if (!m.has(k)) m.set(k,[]); m.get(k).push(p); }
  return [...m].map(([k,items]) => {
    const paid = items.reduce((a,p)=>a+num(p.prix),0);
    const val = items.reduce((a,p)=>a+(num(p.valeur)||num(p.prix)),0);
    const r = items.filter(p=>num(p.note));
    const wm = items.filter(hasMeals), meals = wm.reduce((a,p)=>a+num(p.repas),0);
    return {k, n:items.length, paid, perMeal: meals ? wm.reduce((a,p)=>a+num(p.prix),0)/meals : 0, ratio: paid? val/paid : 0, note: r.length? r.reduce((a,p)=>a+num(p.note),0)/r.length : 0, low: items.filter(p=>num(p.note) && num(p.note)<=2).length};
  });
}
function bars(el, rows, fmt, max){
  if (!rows.length){ el.replaceChildren(h('p',{class:'small muted'},'Pas encore assez de paniers.')); return; }
  el.replaceChildren(...rows.map(r => h('div',{class:'bar'},
    h('span',{style:'min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap'},r.k),
    h('div',{class:'track'}, h('div',{class:'fill',style:`width:${Math.max(4,Math.min(100,r.v/max*100))}%`})),
    h('span',{class:'num'}, fmt(r)))));
}
function renderStrategy(){
  const cats = group(paniers, catLabel).sort((a,b)=>b.ratio-a.ratio);
  const order = ['Matin','Midi','Après-midi','Soir'];
  const slots = group(paniers, p=>slotOf(p.heure)).sort((a,b)=>order.indexOf(a.k)-order.indexOf(b.k));
  const stores = group(paniers, p=>p.magasin).sort((a,b)=>b.note-a.note || b.ratio-a.ratio);
  const days = group(paniers, p=>['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'][new Date(p.date+'T12:00:00').getDay()]);
  bars($('#catBars'), cats.map(c=>({...c,v:c.ratio})), r=>`×${r.ratio.toFixed(1)} · ${r.n}`, Math.max(1,...cats.map(c=>c.ratio)));
  bars($('#slotBars'), slots.map(c=>({...c,v:c.note})), r=>`${r.note.toFixed(1)}/5 · ${r.n}`, 5);
  const t = $('#storeTable');
  if (!stores.length) t.replaceChildren(h('tr',{},h('td',{class:'muted'},'Pas encore de commerce enregistré.')));
  else t.replaceChildren(
    h('thead',{},h('tr',{},h('th',{},'Commerce'),h('th',{class:'n'},'Paniers'),h('th',{class:'n'},'Note'),h('th',{class:'n'},'Valeur/€'),h('th',{class:'n'},'€/repas'),h('th',{class:'n'},'Déceptions'))),
    h('tbody',{},...stores.map(s=>h('tr',{},h('td',{},s.k),h('td',{class:'n'},s.n),h('td',{class:'n'},s.note?s.note.toFixed(1):'–'),h('td',{class:'n'},'×'+s.ratio.toFixed(1)),h('td',{class:'n'},s.perMeal?eur.format(s.perMeal):'–'),h('td',{class:'n'},s.low||'–')))));
  const ins = [];
  const add = (txt, warn) => ins.push(h('li',{},h('span',{class:'mk'+(warn?' w':'')}),h('span',{},txt)));
  if (paniers.length < 3) add('Enregistre au moins 3 paniers pour voir apparaître des tendances fiables.', true);
  else {
    const s = stats(paniers);
    add(`Pour chaque euro payé, tu récupères en moyenne ${(s.paid ? (s.paid+s.saved)/s.paid : 0).toFixed(1).replace('.',',')} € de produits.`);
    const cheapest = [...stores].filter(x=>x.perMeal).sort((a,b)=>a.perMeal-b.perMeal)[0];
    if (cheapest) add(`Le repas le moins cher : ${cheapest.k}, ${eur.format(cheapest.perMeal)} par repas.`);
    if (cats[0]) add(`Ton meilleur rapport valeur/prix : ${cats[0].k} (×${cats[0].ratio.toFixed(1)} sur ${cats[0].n} panier${cats[0].n>1?'s':''}).`);
    const best = stores.find(s=>s.n>=2) || stores[0];
    if (best && best.note>=4) add(`Commerce à garder en favori : ${best.k} (${best.note.toFixed(1)}/5).`);
    const bad = stores.filter(s=>s.note && s.note<=2.5);
    if (bad.length) add(`À éviter ou à retester avec prudence : ${bad.map(b=>b.k).join(', ')}.`, true);
    const bestSlot = [...slots].sort((a,b)=>b.note-a.note)[0];
    if (bestSlot && slots.length>1) add(`Tes paniers du créneau « ${bestSlot.k} » sont les mieux notés (${bestSlot.note.toFixed(1)}/5).`);
    const bestDay = days.filter(d=>d.n>=2).sort((a,b)=>b.note-a.note)[0];
    if (bestDay) add(`Meilleur jour pour toi : le ${bestDay.k.toLowerCase()} (${bestDay.note.toFixed(1)}/5 sur ${bestDay.n} paniers).`);
    const lowRate = paniers.filter(p=>num(p.note) && num(p.note)<=2).length / paniers.length;
    if (lowRate>0.25) add(`${Math.round(lowRate*100)} % de tes paniers sont décevants : concentre-toi sur les commerces notés 4 et plus.`, true);
  }
  $('#insights').replaceChildren(...ins);
  return {cats, slots, stores, days};
}
function render(){ renderStrip(); renderBudget(); renderList(); renderStrategy(); }
render();

/* ---------- formulaires ---------- */
const isSuper = c => c === 'Supermarché';
function syncRayon(){ $('#rayonField').hidden = !isSuper($('#f-cat').value); }
$('#f-cat').addEventListener('change', syncRayon);
let editingId = null;
function resetForm(){
  editingId = null;
  ['#f-store','#f-price','#f-value','#f-time','#f-content','#f-meals'].forEach(s=>$(s).value='');
  $('#f-date').value = today; $('#f-note').value = '4'; syncRayon();
  $('#formTitle').textContent = 'Ajouter un panier';
  $('#addBtn').textContent = 'Enregistrer le panier';
  $('#cancelEdit').hidden = true;
}
function startEdit(p){
  editingId = p.id;
  $('#f-date').value = p.date; $('#f-store').value = p.magasin; $('#f-cat').value = p.categorie || 'Autre';
  if (p.rayon) $('#f-rayon').value = p.rayon; syncRayon();
  $('#f-price').value = p.prix; $('#f-value').value = num(p.valeur) || ''; $('#f-time').value = p.heure || '';
  $('#f-note').value = String(p.note || 4); $('#f-meals').value = hasMeals(p) ? p.repas : ''; $('#f-content').value = p.contenu || '';
  $('#formTitle').textContent = 'Modifier le panier';
  $('#addBtn').textContent = 'Mettre à jour';
  $('#cancelEdit').hidden = false; $('#addMsg').textContent = '';
  $('#addPanel').scrollIntoView({behavior:'smooth', block:'start'});
}
$('#cancelEdit').addEventListener('click', () => { resetForm(); $('#addMsg').textContent = ''; });
$('#addForm').addEventListener('submit', async e => {
  e.preventDefault(); if (!ready) return;
  $('#addBtn').disabled = true; $('#addMsg').textContent = 'Enregistrement…';
  const row = {
    date: $('#f-date').value, magasin: $('#f-store').value.trim(), categorie: $('#f-cat').value,
    rayon: isSuper($('#f-cat').value) ? $('#f-rayon').value : '',
    prix: num($('#f-price').value), valeur: num($('#f-value').value), heure: $('#f-time').value || '',
    note: num($('#f-note').value), repas: $('#f-meals').value === '' ? null : Math.round(num($('#f-meals').value)), contenu: $('#f-content').value.trim() };
  const wasEdit = !!editingId;
  const { error } = wasEdit ? await sb.from('paniers').update(row).eq('id', editingId) : await sb.from('paniers').insert(row);
  $('#addBtn').disabled = false;
  if (error){ $('#addMsg').textContent = 'Impossible d’enregistrer. Vérifie ta connexion et réessaie.'; return; }
  resetForm();
  $('#addMsg').textContent = wasEdit ? 'Panier mis à jour.' : 'Panier enregistré.';
  loadAll();
});
$('#courseForm').addEventListener('submit', async e => {
  e.preventDefault(); if (!ready) return;
  $('#courseBtn').disabled = true; $('#courseMsg').textContent = 'Enregistrement…';
  const { error } = await sb.from('courses').insert({ date: $('#k-date').value, montant: num($('#k-amount').value), magasin: $('#k-store').value.trim() });
  $('#courseBtn').disabled = false;
  if (error){ $('#courseMsg').textContent = 'Impossible d’enregistrer. Vérifie ta connexion et réessaie.'; return; }
  $('#courseMsg').textContent = 'Courses enregistrées.'; $('#k-amount').value=''; $('#k-store').value='';
  loadAll();
});
$('#b-hebdo').addEventListener('change', async e => {
  const v = num(e.target.value); if (!v || !ready) return;
  budget = v; render();
  const { data: { user } } = await sb.auth.getUser();
  await sb.from('reglages').upsert({ user_id: user.id, budget_hebdo: v, updated_at: new Date().toISOString() });
});

/* ---------- Claude (via la fonction Supabase) ---------- */
function errCopy(code){
  return ({
    limite:'Limite du jour atteinte (5 demandes). Réessaie demain.',
    image:'Cette photo n’est pas acceptée. Essaie une autre image.',
    vide:'Ajoute une photo ou décris tes produits.',
    cle_manquante:'Les recettes ne sont pas encore activées sur ce serveur.',
    lecture:'La réponse n’a pas pu être lue. Réessaie.',
  })[code] ?? 'Claude n’a pas pu répondre. Réessaie dans un moment.';
}
async function callClaude(body){
  const { data, error } = await sb.functions.invoke('recettes', { body });
  if (error){
    let code = 'autre';
    try { code = (await error.context.json()).error || code; } catch {}
    throw { code };
  }
  return data;
}
function resize(file){
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const max = 1280, k = Math.min(1, max/Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width*k); c.height = Math.round(img.height*k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve({ media_type: 'image/jpeg', data: c.toDataURL('image/jpeg', 0.82).split(',')[1] });
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}
let files = [];
function setFiles(list){
  files = [...list].filter(f=>/^image\//.test(f.type)).slice(0,3);
  $('#thumbs').replaceChildren(...files.map(f=>h('img',{src:URL.createObjectURL(f),alt:'Photo du panier'})));
}
$('#photo').addEventListener('change', e => setFiles(e.target.files));
const drop = $('#drop');
['dragover','dragenter'].forEach(t=>drop.addEventListener(t,e=>{e.preventDefault();drop.classList.add('over');}));
['dragleave','drop'].forEach(t=>drop.addEventListener(t,e=>{e.preventDefault();drop.classList.remove('over');}));
drop.addEventListener('drop', e => setFiles(e.dataTransfer.files));

$('#cookBtn').addEventListener('click', async () => {
  const out = $('#cookOut'); const extra = $('#c-extra').value.trim();
  if (!ready) return;
  if (!files.length && !extra){ $('#cookMsg').textContent = errCopy('vide'); return; }
  $('#cookBtn').disabled = true; $('#cookMsg').textContent = '';
  out.replaceChildren(h('div',{class:'thinking'},h('span',{class:'dot'}),'Claude regarde ton panier… (souvent 10 à 40 secondes)'));
  try {
    const images = await Promise.all(files.map(resize));
    const r = await callClaude({ mode:'recettes', images, extra, pantry:$('#c-pantry').value.trim(), people:$('#c-people').value, time:$('#c-time').value });
    const prods = Array.isArray(r?.produits) ? r.produits : [];
    const recs = Array.isArray(r?.recettes) ? r.recettes : [];
    const cons = Array.isArray(r?.conservation) ? r.conservation : [];
    out.replaceChildren(
      prods.length ? h('div',{class:'panel'},h('h3',{},'Produits reconnus'),h('div',{class:'chips'},...prods.map(p=>h('span',{class:'chip'},String(p))))) : null,
      h('div',{class:'recipes'},...recs.map(x=>h('article',{class:'recipe'},
        h('h3',{},String(x.titre||'Recette')),
        h('div',{class:'meta'},[x.temps,x.difficulte].filter(Boolean).join(' · ')),
        Array.isArray(x.utilise)&&x.utilise.length ? h('div',{class:'chips'},...x.utilise.map(u=>h('span',{class:'pill ex'},String(u)))) : null,
        h('strong',{class:'small'},'Ingrédients'), h('ul',{},...(x.ingredients||[]).map(i=>h('li',{},String(i)))),
        h('strong',{class:'small'},'Étapes'), h('ol',{},...(x.etapes||[]).map(i=>h('li',{},String(i)))),
        x.astuce ? h('div',{class:'tip'},'Astuce : ', String(x.astuce)) : null))),
      cons.length ? h('div',{class:'panel'},h('h3',{},'Conservation'),h('ul',{class:'insights'},...cons.map(c=>h('li',{},h('span',{class:'mk'}),h('span',{},String(c)))))) : null);
  } catch (e) { out.replaceChildren(); $('#cookMsg').textContent = errCopy(e?.code); }
  finally { $('#cookBtn').disabled = false; }
});

$('#adviceBtn').addEventListener('click', async () => {
  const out = $('#advice');
  if (!ready) return;
  if (paniers.length < 3){ out.textContent = 'Enregistre au moins 3 paniers pour des conseils utiles.'; return; }
  const g = renderStrategy(), s = stats(paniers), wk = weeks();
  const resume = {
    budgetCoursesHebdo: budget, economieVsBudgetTotale: +wk.ecoTotal.toFixed(2), economieMoyenneParSemaine: +wk.avg.toFixed(2), semainesCompletes: wk.done.length,
    paniers: s.n, depensePaniers: +s.paid.toFixed(2), noteMoyenne: +s.avg.toFixed(2), repasSauves: s.meals, prixMoyenParRepas: +s.perMeal.toFixed(2),
    parType: g.cats.map(c=>({type:c.k,n:c.n,valeurParEuro:+c.ratio.toFixed(2),note:+c.note.toFixed(1)})),
    parCreneau: g.slots.map(c=>({creneau:c.k,n:c.n,note:+c.note.toFixed(1)})),
    parJour: g.days.map(c=>({jour:c.k,n:c.n,note:+c.note.toFixed(1)})),
    parCommerce: g.stores.slice(0,15).map(c=>({n:c.n,note:+c.note.toFixed(1),valeurParEuro:+c.ratio.toFixed(2),deceptions:c.low,commerce:c.k}))
  };
  const btn = $('#adviceBtn'); btn.disabled = true;
  out.replaceChildren(h('span',{class:'thinking'},h('span',{class:'dot'}),'Analyse en cours…'));
  try { const r = await callClaude({ mode:'conseils', resume }); out.textContent = r.texte || ''; }
  catch (e) { out.textContent = errCopy(e?.code); }
  finally { btn.disabled = false; }
});

/* ---------- démarrage ---------- */
(async () => {
  try {
    await ensureSession();
    ready = true;
    await loadAll();
    $('#sync').textContent = 'Synchronisé';
  } catch (e) {
    $('#sync').textContent = 'Connexion au serveur impossible. Vérifie ta connexion internet.';
    $('#list').replaceChildren(h('div',{class:'empty'},'Les données n’ont pas pu être chargées.'));
  }
})();
})();
