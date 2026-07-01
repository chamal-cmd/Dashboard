// ─── State ────────────────────────────────────────────────────────────────────

let ALL_CALLS       = [];
let filtered        = [];
let dateRange       = 'week';
let sortCol         = 'timestamp';
let sortDir         = 'desc';
let selectedId      = null;
let expandedIds     = new Set();

// Messages state
let ALL_MESSAGES    = [];
let ALL_THREADS     = [];
let FILTERED_THREADS= [];
let activeTab       = 'calls';
let msgSortCol      = 'time';
let msgSortDir      = 'desc';
let activeThreadKey = null;

// Chart instances
let chDur = null;

// ─── Range helpers ────────────────────────────────────────────────────────────
function rangeTimestamps(range) {
  const ts = d => Math.floor(d.getTime() / 1000);
  const now = new Date();
  const nowTs = ts(now);
  const clamp = t => Math.min(t, nowTs);

  if (range === 'today') {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    const end   = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
    return { from: ts(start), to: clamp(ts(end)), label_to: ts(end) };
  }
  if (range === 'week') {
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dow = today.getDay();
    const daysSinceMonday = (dow + 6) % 7;
    const monday = new Date(today); monday.setDate(today.getDate() - daysSinceMonday); monday.setHours(0,0,0,0);
    const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6); sunday.setHours(23,59,59,999);
    return { from: ts(monday), to: clamp(ts(sunday)), label_to: ts(sunday) };
  }
  if (range === 'month') {
    const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0);
    const end   = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    return { from: ts(start), to: clamp(ts(end)), label_to: ts(end) };
  }
  if (range === 'last-month') {
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0);
    const end   = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
    return { from: ts(start), to: clamp(ts(end)), label_to: ts(end) };
  }
  if (range === '3-months') {
    const start = new Date(now.getFullYear(), now.getMonth() - 2, 1, 0, 0, 0);
    const end   = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    return { from: ts(start), to: clamp(ts(end)), label_to: ts(end) };
  }
  if (range === '6-months') {
    const start = new Date(now.getFullYear(), now.getMonth() - 5, 1, 0, 0, 0);
    const end   = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    return { from: ts(start), to: clamp(ts(end)), label_to: ts(end) };
  }
  return rangeTimestamps('week');
}

function updateDateLabel(range) {
  const r = rangeTimestamps(range);
  const fmt = d => d.toLocaleDateString('en-GB', { weekday:'short', day:'numeric', month:'short', year:'numeric' });
  const names = { 'today':'Today','week':'This Week (Mon–Sun)','month':'This Month','last-month':'Last Month','3-months':'Last 3 Months','6-months':'Last 6 Months' };
  const displayEnd = r.label_to || r.to;
  document.getElementById('dr-label').textContent = `${names[range]||''} · ${fmt(new Date(r.from*1000))} → ${fmt(new Date(displayEnd*1000))}`;
}

// ─── Load calls (all pages) ───────────────────────────────────────────────────
async function loadCalls(range) {
  const { from, to } = rangeTimestamps(range);
  const banner    = document.getElementById('api-banner');
  const badge     = document.getElementById('source-badge');
  const fetchedEl = document.getElementById('fetch-stats');
  const baseUrl   = `/aircall-proxy?path=calls&from=${from}&to=${to}&per_page=25&order=desc`;

  try {
    const allCalls = [];
    let page = 1, totalAvail = null, contactsLoaded = 0, sourceOk = true, lastReason = null;

    for (page = 1; page <= 2000; page++) {
      if (fetchedEl) { fetchedEl.classList.remove('hidden'); fetchedEl.innerHTML = `⏳ Loading calls… <strong>${allCalls.length}</strong> so far`; }
      const resp = await fetch(`${baseUrl}&page=${page}`);
      if (!resp.ok) throw new Error(`Server returned ${resp.status}`);
      const json = await resp.json();

      if (json.source !== 'aircall') { sourceOk = false; lastReason = json.reason || 'unknown'; break; }
      contactsLoaded = json.contacts_loaded || contactsLoaded;
      const pageCalls = json.calls || [];
      allCalls.push(...pageCalls);
      const meta = json.meta || {};
      if (meta.total != null) totalAvail = meta.total;
      if (!meta.next_page_link || pageCalls.length === 0) break;
    }

    if (sourceOk) {
      badge.textContent = 'Live · Aircall';
      badge.className   = 'text-xs font-semibold px-1.5 py-0.5 bg-emerald-50 text-emerald-600 rounded-md';
      banner.classList.add('hidden');
      if (fetchedEl) fetchedEl.innerHTML = `📞 <strong>${allCalls.length}</strong> call${allCalls.length!==1?'s':''} · <span class="text-emerald-600 font-medium">✓ all loaded</span>`;
    } else {
      badge.textContent = 'Demo data';
      badge.className   = 'text-xs font-semibold px-1.5 py-0.5 bg-amber-50 text-amber-600 rounded-md';
      document.getElementById('api-banner-text').textContent = `Aircall not connected — ${lastReason}`;
      banner.classList.remove('hidden');
    }
    const savedContacts = JSON.parse(localStorage.getItem('aircall_contacts') || '{}');
    return allCalls.map(c => {
      const saved = savedContacts[c.phone];
      return { ...c, timestamp: new Date(c.timestamp), contact_name: c.contact_name || saved || null };
    });
  } catch (err) {
    badge.textContent = 'Offline';
    badge.className   = 'text-xs font-semibold px-1.5 py-0.5 bg-red-50 text-red-600 rounded-md';
    document.getElementById('api-banner-text').textContent = `Cannot reach Aircall proxy: ${err.message}`;
    banner.classList.remove('hidden');
    if (fetchedEl) fetchedEl.classList.add('hidden');
    return [];
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => { updateDateLabel(dateRange); await doRefresh(); });

// ─── Date range ───────────────────────────────────────────────────────────────
function setRange(r) {
  dateRange = r;
  ['today','week','month','last-month','3-months','6-months'].forEach(x => {
    const b = document.getElementById('dr-'+x);
    if (!b) return;
    b.className = x === r
      ? 'dr-btn px-3 py-1.5 rounded-md text-sm font-medium bg-white shadow-sm text-slate-700 transition-all'
      : 'dr-btn px-3 py-1.5 rounded-md text-sm font-medium text-slate-500 hover:text-slate-700 transition-all';
  });
  updateDateLabel(r);
  if (activeTab === 'calls') doRefresh();
  else { ALL_MESSAGES = []; ALL_THREADS = []; doRefreshMessages(); }
}

function doRefreshActive() {
  const icon = document.getElementById('ri');
  icon.style.transition = 'transform .55s ease'; icon.style.transform = 'rotate(360deg)';
  setTimeout(() => { icon.style.transition=''; icon.style.transform=''; }, 600);
  if (activeTab === 'calls') doRefresh();
  else { ALL_MESSAGES = []; ALL_THREADS = []; doRefreshMessages(); }
}

function doExportActive() {
  if (activeTab === 'calls') doExport();
  else exportMessagesCSV();
}

async function doRefresh() {
  const icon = document.getElementById('ri');
  icon.style.transition = 'transform .55s ease'; icon.style.transform = 'rotate(360deg)';
  setTimeout(() => { icon.style.transition=''; icon.style.transform=''; }, 600);

  document.getElementById('loading-overlay').classList.remove('hidden');
  document.getElementById('main-content').classList.add('hidden');

  ALL_CALLS = await loadCalls(dateRange);

  const agSel = document.getElementById('f-agent');
  const prevAg = agSel.value;
  agSel.innerHTML = '<option value="">All Agents</option>';
  [...new Set(ALL_CALLS.map(c => c.agent))].sort().forEach(a => {
    const o = document.createElement('option'); o.value=a; o.textContent=a; agSel.appendChild(o);
  });
  agSel.value = prevAg;

  const lineSel = document.getElementById('f-line');
  const prevLn  = lineSel.value;
  lineSel.innerHTML = '<option value="">All Lines</option>';
  [...new Set(ALL_CALLS.map(c => c.line_name).filter(Boolean))].sort().forEach(l => {
    const o = document.createElement('option'); o.value=l; o.textContent=l; lineSel.appendChild(o);
  });
  lineSel.value = prevLn;

  document.getElementById('loading-overlay').classList.add('hidden');
  document.getElementById('main-content').classList.remove('hidden');
  applyFilters();
}

// ─── Tab Switching ────────────────────────────────────────────────────────────
function switchTab(tab) {
  activeTab = tab;
  const onCls  = 'px-5 py-3 text-sm font-medium border-b-2 border-indigo-600 text-indigo-700 -mb-px transition-colors';
  const offCls = 'px-5 py-3 text-sm font-medium border-b-2 border-transparent text-slate-500 hover:text-slate-700 -mb-px transition-colors';
  document.getElementById('tab-calls').className    = tab === 'calls'    ? onCls : offCls;
  document.getElementById('tab-messages').className = tab === 'messages' ? onCls : offCls;

  document.getElementById('calls-view').classList.toggle('hidden', tab !== 'calls');
  document.getElementById('messages-view').classList.toggle('hidden', tab !== 'messages');
  document.getElementById('detail-panel').classList.toggle('hidden', tab !== 'calls');
  document.getElementById('msg-panel').classList.add('hidden');

  const pdfBtn = document.getElementById('btn-export-pdf');
  if (pdfBtn) pdfBtn.classList.toggle('hidden', tab !== 'calls');

  if (tab === 'messages' && !ALL_MESSAGES.length) doRefreshMessages();
}

// ─── Filters ──────────────────────────────────────────────────────────────────
function clearFilters() {
  document.getElementById('f-search').value  = '';
  document.getElementById('f-agent').value   = '';
  document.getElementById('f-dir').value     = '';
  document.getElementById('f-outcome').value = '';
  document.getElementById('f-line').value    = '';
  applyFilters();
}

function applyFilters() {
  const q  = document.getElementById('f-search').value.trim().toLowerCase();
  const ag = document.getElementById('f-agent').value;
  const dr = document.getElementById('f-dir').value;
  const oc = document.getElementById('f-outcome').value;
  const ln = document.getElementById('f-line').value;

  filtered = ALL_CALLS.filter(c => {
    if (ag && c.agent !== ag) return false;
    if (dr === 'outbound-answered')   { if (c.direction !== 'outbound' || c.missed || c.voicemail) return false; }
    else if (dr === 'outbound-unanswered') { if (c.direction !== 'outbound' || (!c.missed && !c.voicemail)) return false; }
    else if (dr && c.direction !== dr) return false;
    if (oc && c.call_outcome !== oc) return false;
    if (ln && c.line_name !== ln) return false;
    if (q) {
      const hay = [c.phone, c.agent, c.contact_name||'', c.line_name||'', ...(c.key_topics||[]), ...(c.tags||[])].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  filtered.sort((a, b) => {
    let av = a[sortCol], bv = b[sortCol];
    if (sortCol === 'timestamp') { av = av instanceof Date ? av.getTime() : new Date(av).getTime(); bv = bv instanceof Date ? bv.getTime() : new Date(bv).getTime(); }
    if (sortCol === 'follow_up_required') { av = av?1:0; bv = bv?1:0; }
    if (typeof av === 'string') av = av.toLowerCase();
    if (typeof bv === 'string') bv = bv.toLowerCase();
    if (av < bv) return sortDir==='asc'?-1:1;
    if (av > bv) return sortDir==='asc'?1:-1;
    return 0;
  });

  renderKPIs(); renderCharts(); renderRepeatCallers(); renderTalkTimeDistribution(); renderTable();
}

function sortBy(col) {
  sortDir = sortCol===col ? (sortDir==='asc'?'desc':'asc') : (col==='timestamp'?'desc':'asc');
  sortCol = col;
  document.querySelectorAll('[id^="si-"]').forEach(el => { el.textContent='↕'; el.className='text-slate-300'; });
  const el = document.getElementById('si-'+col);
  if (el) { el.textContent=sortDir==='asc'?'↑':'↓'; el.className='text-indigo-500'; }
  applyFilters();
}

// ─── Count-up ─────────────────────────────────────────────────────────────────
function countUp(el, target, suffix='', dur=600) {
  const t0 = performance.now();
  (function frame(now) {
    const p = Math.min((now-t0)/dur, 1);
    const e = 1-Math.pow(1-p,3);
    el.textContent = Math.round(target*e) + suffix;
    if (p<1) requestAnimationFrame(frame);
  })(t0);
}

function fmtDur(s) { return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`; }

// ─── KPIs ─────────────────────────────────────────────────────────────────────
function renderKPIs() {
  const n        = filtered.length;
  const inb      = filtered.filter(c => c.direction === 'inbound').length;
  const outAll   = filtered.filter(c => c.direction === 'outbound');
  const outAns   = outAll.filter(c => !c.missed && !c.voicemail).length;
  const outUnans = outAll.filter(c => c.missed || c.voicemail).length;
  const totalSec = filtered.reduce((s,c) => s+c.duration, 0);
  const avgSec   = n ? Math.round(totalSec / n) : 0;
  const missedOrVm  = filtered.filter(c => c.missed || c.voicemail).length;
  const successRate = n ? Math.round(((n - missedOrVm) / n) * 100) : 0;

  countUp(document.getElementById('kpi-total'),               n);
  countUp(document.getElementById('kpi-inbound'),             inb);
  countUp(document.getElementById('kpi-outbound'),            outAns);
  countUp(document.getElementById('kpi-outbound-unanswered'), outUnans);
  countUp(document.getElementById('kpi-missed'),              missedOrVm);
  countUp(document.getElementById('kpi-ansrate'),             successRate, '%');

  const th = Math.floor(totalSec / 3600);
  const tm = Math.floor((totalSec % 3600) / 60);
  document.getElementById('kpi-talktime').textContent = `${th}h ${tm}m`;
  document.getElementById('kpi-dur').textContent = fmtDur(avgSec);

  const missed = filtered.filter(c => c.missed).length;
  const vm     = filtered.filter(c => c.voicemail).length;

  document.getElementById('kpi-total-sub').textContent               = `${inb} in · ${outAll.length} out`;
  document.getElementById('kpi-inbound-sub').textContent             = n ? `${Math.round(inb/n*100)}% of total` : '—';
  document.getElementById('kpi-outbound-sub').textContent            = outAll.length ? `${Math.round(outAns/outAll.length*100)}% of outbound` : '—';
  document.getElementById('kpi-outbound-unanswered-sub').textContent = `of ${outAll.length} total outbound`;
  document.getElementById('kpi-missed-sub').textContent              = `${missed} missed · ${vm} voicemail`;
  document.getElementById('kpi-ansrate-sub').textContent             = `${n - missedOrVm} answered of ${n} total`;
}

// ─── Charts ───────────────────────────────────────────────────────────────────
function destroyChart(ref) { if (ref) { try { ref.destroy(); } catch {} } return null; }

function renderCharts() {
  const buckets = [0,0,0,0,0];
  filtered.forEach(c => {
    const m = c.duration / 60;
    if (m < 1) buckets[0]++; else if (m < 3) buckets[1]++; else if (m < 5) buckets[2]++; else if (m < 10) buckets[3]++; else buckets[4]++;
  });
  chDur = destroyChart(chDur);
  chDur = new Chart(document.getElementById('ch-dur').getContext('2d'), {
    type: 'bar',
    data: { labels:['<1 min','1–3 min','3–5 min','5–10 min','10+ min'], datasets:[{ data:buckets, backgroundColor:['#94a3b8','#60a5fa','#6366f1','#8b5cf6','#ec4899'], borderRadius:5, borderSkipped:false }] },
    options: { plugins:{ legend:{display:false}, tooltip:{callbacks:{label:ctx=>` ${ctx.raw} calls`}} }, scales:{ x:{grid:{display:false},ticks:{font:{size:10},color:'#94a3b8'}}, y:{beginAtZero:true,ticks:{stepSize:1,precision:0,font:{size:11},color:'#94a3b8'},grid:{color:'#f1f5f9'}} }, animation:{duration:700} }
  });

  const noNameCalls = filtered.filter(c => !c.contact_name);
  const uniqueMissing = [...new Set(noNameCalls.map(c => c.phone))];
  const hint = document.getElementById('no-names-hint');
  if (hint) {
    if (uniqueMissing.length > 0) {
      hint.classList.remove('hidden');
      hint.innerHTML = `⚠ <strong>${uniqueMissing.length} unique phone number${uniqueMissing.length!==1?'s':''}</strong> (${noNameCalls.length} call${noNameCalls.length!==1?'s':''}) have no contact name. <a href="#" onclick="showMissingContacts(); return false;" class="underline font-medium">View list</a>`;
    } else { hint.classList.add('hidden'); }
  }

  const clientMap = {};
  filtered.forEach(c => {
    const key = c.contact_name || c.phone;
    if (!clientMap[key]) clientMap[key] = { name:c.contact_name, company:c.contact_company, phone:c.phone, count:0, totalDur:0, agents:{} };
    clientMap[key].count++; clientMap[key].totalDur += c.duration;
    clientMap[key].agents[c.agent] = (clientMap[key].agents[c.agent]||0) + 1;
  });
  Object.values(clientMap).forEach(cl => {
    const sorted = Object.entries(cl.agents).sort((a,b)=>b[1]-a[1]);
    cl.primaryAgent = sorted[0]?.[0] || 'Unknown'; cl.primaryAgentCalls = sorted[0]?.[1] || 0;
  });
  const topClients = Object.values(clientMap).sort((a,b)=>b.count-a.count).slice(0,8);
  const maxCC = topClients[0]?.count || 1;
  document.getElementById('top-clients').innerHTML = topClients.length
    ? topClients.map(cl => `
        <div class="flex items-center gap-3">
          <div class="w-7 h-7 rounded-full bg-indigo-50 flex items-center justify-center flex-shrink-0"><span class="text-xs font-bold text-indigo-600">${(cl.name||cl.phone||'?')[0].toUpperCase()}</span></div>
          <div class="flex-1 min-w-0">
            <div class="flex justify-between items-baseline mb-0.5"><span class="text-xs font-medium text-slate-800 truncate">${cl.name||cl.phone}</span><span class="text-xs text-slate-500 ml-2 flex-shrink-0">${cl.count} call${cl.count!==1?'s':''}</span></div>
            ${cl.company?`<div class="text-[10px] text-slate-400 truncate -mt-0.5 mb-0.5">${cl.company}</div>`:''}
            <div class="h-1.5 bg-slate-100 rounded-full overflow-hidden"><div class="h-full bg-indigo-500 rounded-full" style="width:${Math.round(cl.count/maxCC*100)}%"></div></div>
            <div class="flex justify-between items-center mt-1"><span class="text-xs text-slate-400">${fmtDur(Math.round(cl.totalDur/cl.count))} avg</span><span class="text-[10px] text-emerald-600 font-medium">👤 ${cl.primaryAgent} (${cl.primaryAgentCalls})</span></div>
          </div>
        </div>`).join('')
    : '<p class="text-xs text-slate-400">No data</p>';

}

// ─── Table helpers ────────────────────────────────────────────────────────────
const fmt = {
  time: ts => { const d=ts instanceof Date?ts:new Date(ts); return d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})+', '+d.toLocaleDateString([],{month:'short',day:'numeric'}); },
  dur:  s  => `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`,
};
function bSent(s) {
  const m={positive:'bg-emerald-50 text-emerald-700',neutral:'bg-slate-100 text-slate-600',negative:'bg-red-50 text-red-600'};
  const i={positive:'↑',neutral:'—',negative:'↓'};
  const l=s||'neutral';
  return `<span class="tag ${m[l]||m.neutral}">${i[l]||'—'} ${l[0].toUpperCase()+l.slice(1)}</span>`;
}
function bOut(o) {
  const m={resolved:'bg-emerald-50 text-emerald-700',unresolved:'bg-red-50 text-red-600','follow-up-required':'bg-amber-50 text-amber-700','sale-made':'bg-indigo-50 text-indigo-700'};
  const l={resolved:'Resolved',unresolved:'Unresolved','follow-up-required':'Follow-up','sale-made':'Sale Made'};
  return `<span class="tag ${m[o]||'bg-slate-100 text-slate-600'}">${l[o]||o}</span>`;
}
function bDir(d) {
  return d==='inbound'
    ? `<span class="flex items-center gap-1 text-xs text-slate-600"><svg class="w-3 h-3 text-sky-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3"/></svg>In</span>`
    : `<span class="flex items-center gap-1 text-xs text-slate-600"><svg class="w-3 h-3 text-violet-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18"/></svg>Out</span>`;
}

// ─── Table render ─────────────────────────────────────────────────────────────
function renderTable() {
  const tbody = document.getElementById('tbody');
  const empty = document.getElementById('tbl-empty');
  if (!filtered.length) { tbody.innerHTML=''; empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');

  tbody.innerHTML = filtered.map(c => `
    <tr class="border-b border-slate-100 hover:bg-slate-50 cursor-pointer transition-colors ${selectedId===c.id?'row-sel':''}"
        onclick="rowClick(event,'${c.id}')">
      <td class="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">${fmt.time(c.timestamp)}</td>
      <td class="px-4 py-3">
        <div class="font-medium text-slate-800 text-sm">${c.agent}</div>
        ${c.recording?'<span class="text-xs text-indigo-400">● Recording</span>':''}
      </td>
      <td class="px-4 py-3">
        ${c.contact_name?`<div class="text-sm font-medium text-slate-800">${c.contact_name}</div>${c.contact_company?`<div class="text-xs text-slate-500">${c.contact_company}</div>`:''}`:`<span class="text-xs text-slate-400">—</span>`}
        ${c.missed?'<span class="text-xs text-red-500 font-medium">Missed</span>':''}
        ${c.voicemail?'<span class="text-xs text-amber-500 font-medium">Voicemail</span>':''}
      </td>
      <td class="px-4 py-3 text-xs text-slate-500">${c.line_name||'—'}</td>
      <td class="px-4 py-3">${bDir(c.direction)}</td>
      <td class="px-4 py-3 text-sm text-slate-700 font-mono">${fmt.dur(c.duration)}</td>
      <td class="px-4 py-3 text-xs text-slate-400 font-mono">${c.wait_duration?fmt.dur(c.wait_duration):'—'}</td>
      <td class="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">${c.phone}</td>
      <td class="px-4 py-3">
        <div class="flex flex-wrap gap-1">
          ${(c.tags||[]).slice(0,2).map(t=>`<span class="tag bg-slate-100 text-slate-600">${t}</span>`).join('')}
          ${c.tags&&c.tags.length>2?`<span class="tag bg-slate-100 text-slate-400">+${c.tags.length-2}</span>`:''}
        </div>
      </td>
      <td class="px-4 py-3">${bSent(c.sentiment)}</td>
      <td class="px-4 py-3">${bOut(c.call_outcome)}</td>
      <td class="px-4 py-3">
        <button class="p-1 rounded hover:bg-slate-100 text-slate-400 transition-colors" onclick="toggleExpand(event,'${c.id}')" title="Expand">
          <svg id="ei-${c.id}" class="w-4 h-4 transition-transform ${expandedIds.has(c.id)?'rotate-180':''}" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>
        </button>
      </td>
    </tr>
    ${expandedIds.has(c.id)?`
    <tr class="bg-slate-50 border-b border-slate-100">
      <td colspan="13" class="px-6 py-4">
        <div class="grid grid-cols-4 gap-6">
          <div>
            <p class="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Call Details</p>
            <div class="space-y-1 text-xs text-slate-600">
              <div><span class="text-slate-400">Line:</span> ${c.line_name||'—'}</div>
              <div><span class="text-slate-400">Wait:</span> ${c.wait_duration?fmtDur(c.wait_duration):'—'}</div>
              <div><span class="text-slate-400">Transferred:</span> ${c.transferred?'Yes':'No'}</div>
              ${c.missed_call_reason?`<div><span class="text-slate-400">Missed reason:</span> ${c.missed_call_reason}</div>`:''}
            </div>
          </div>
          <div>
            <p class="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Summary</p>
            <p class="text-xs text-slate-600 leading-relaxed">${c.summary||'—'}</p>
          </div>
          <div>
            <p class="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Key Topics</p>
            <div class="flex flex-wrap gap-1.5">${(c.key_topics||[]).length?c.key_topics.map(t=>`<span class="tag bg-sky-50 text-sky-700">${t}</span>`).join(''):'<span class="text-xs text-slate-400">None yet</span>'}</div>
          </div>
          <div>
            <p class="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Action Items</p>
            ${(c.action_items||[]).length?`<ul class="space-y-1">${c.action_items.map(a=>`<li class="text-xs text-slate-600 flex gap-1.5"><span class="text-indigo-400">•</span>${a}</li>`).join('')}</ul>`:'<p class="text-xs text-slate-400">None yet</p>'}
          </div>
        </div>
      </td>
    </tr>`:''}
  `).join('');
}

function toggleExpand(e,id) { e.stopPropagation(); expandedIds.has(id)?expandedIds.delete(id):expandedIds.add(id); renderTable(); }
function rowClick(e,id) { if (e.target.closest('button')) return; selectedId=id; openPanel(ALL_CALLS.find(c=>c.id===id)); renderTable(); }

// ─── Detail panel ─────────────────────────────────────────────────────────────
function openPanel(c) {
  const panel = document.getElementById('detail-panel');
  panel.classList.remove('hidden');
  panel.classList.add('panel-enter');

  const pct    = Math.round((c.sentiment_score||0.5)*100);
  const barCls = (c.sentiment_score||0.5)>.6?'bg-emerald-500':(c.sentiment_score||0.5)>.4?'bg-slate-400':'bg-red-500';
  const numCls = (c.sentiment_score||0.5)>.6?'text-emerald-400':(c.sentiment_score||0.5)>.4?'text-slate-400':'text-red-400';

  document.getElementById('detail-inner').innerHTML = `
    <div class="flex items-center justify-between mb-5">
      <p class="text-sm font-semibold text-white">Call Detail</p>
      <button onclick="closePanel()" class="p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-slate-700 transition-colors">
        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
      </button>
    </div>
    <div class="bg-slate-800 rounded-xl p-4 mb-4">
      <div class="flex items-start justify-between mb-3">
        <div>
          <p class="text-white font-semibold">${c.agent}</p>
          ${c.contact_name?`<p class="text-indigo-300 text-sm font-medium">${c.contact_name}</p>${c.contact_company?`<p class="text-slate-400 text-xs">${c.contact_company}</p>`:''}`:''}
          <p class="text-slate-400 text-sm">${c.phone}</p>
          ${c.line_name?`<p class="text-slate-500 text-xs mt-0.5">Line: ${c.line_name}</p>`:''}
        </div>
        <div class="text-right">
          <p class="text-slate-300 text-xs">${fmt.time(c.timestamp)}</p>
          <p class="text-slate-400 text-xs mt-0.5">${fmt.dur(c.duration)} · ${c.direction}</p>
          ${c.wait_duration?`<p class="text-slate-500 text-xs">Wait: ${fmt.dur(c.wait_duration)}</p>`:''}
        </div>
      </div>
      <div class="flex flex-wrap gap-1.5">
        ${bSent(c.sentiment)}${bOut(c.call_outcome)}
        ${c.missed?'<span class="tag bg-red-500/20 text-red-400">Missed</span>':''}
        ${c.voicemail?'<span class="tag bg-amber-500/20 text-amber-400">Voicemail</span>':''}
        ${c.transferred?'<span class="tag bg-slate-600 text-slate-300">Transferred</span>':''}
        ${c.follow_up_required?'<span class="tag bg-amber-500/20 text-amber-400">Follow-up needed</span>':''}
      </div>
    </div>
    <div class="grid grid-cols-2 gap-3 mb-4">
      <div class="bg-slate-800 rounded-lg p-3"><p class="text-xs text-slate-500 mb-1">Duration</p><p class="text-lg font-bold text-white">${fmt.dur(c.duration)}</p></div>
      <div class="bg-slate-800 rounded-lg p-3"><p class="text-xs text-slate-500 mb-1">Wait Time</p><p class="text-lg font-bold text-white">${c.wait_duration?fmt.dur(c.wait_duration):'—'}</p></div>
    </div>
    <div class="mb-4">
      <div class="flex justify-between text-xs text-slate-500 mb-1.5"><span>Sentiment score</span><span class="${numCls} font-semibold">${pct}%</span></div>
      <div class="h-1.5 bg-slate-700 rounded-full overflow-hidden"><div class="h-full rounded-full ${barCls} transition-all duration-700" style="width:${pct}%"></div></div>
    </div>
    ${(c.tags||[]).length?`<div class="mb-4"><p class="text-xs text-slate-500 uppercase tracking-wide font-semibold mb-2">Tags</p><div class="flex flex-wrap gap-1.5">${c.tags.map(t=>`<span class="tag bg-slate-700 text-slate-300">${t}</span>`).join('')}</div></div>`:''}
    ${c.recording?`<div class="mb-4"><p class="text-xs text-slate-500 uppercase tracking-wide font-semibold mb-2">Recording</p><a href="${c.recording}" target="_blank" class="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1.5"><svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"/><path stroke-linecap="round" stroke-linejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>Play recording</a></div>`:''}
    <div class="mb-4"><p class="text-xs text-slate-500 uppercase tracking-wide font-semibold mb-2">Summary</p><div class="bg-slate-800 rounded-xl p-3"><p class="text-sm text-slate-300 leading-relaxed">${c.summary||'No summary yet.'}</p></div></div>
    ${(c.key_topics||[]).length?`<div class="mb-4"><p class="text-xs text-slate-500 uppercase tracking-wide font-semibold mb-2">Key Topics</p><div class="flex flex-wrap gap-1.5">${c.key_topics.map(t=>`<span class="tag bg-indigo-500/20 text-indigo-300">${t}</span>`).join('')}</div></div>`:''}
    ${(c.action_items||[]).length?`<div class="mb-5"><p class="text-xs text-slate-500 uppercase tracking-wide font-semibold mb-2">Action Items</p><ul class="space-y-2">${c.action_items.map(a=>`<li class="flex items-start gap-2 text-sm text-slate-300"><span class="w-5 h-5 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center text-xs flex-shrink-0 mt-0.5">✓</span>${a}</li>`).join('')}</ul></div>`:''}
    <div class="mt-6 pt-4 border-t border-slate-700 flex gap-2">
      <button onclick="openContactLookup('${c.phone}')" class="flex-1 py-2 px-3 bg-emerald-600/80 hover:bg-emerald-600 text-white text-xs font-medium rounded-lg transition-colors flex items-center justify-center gap-1.5">
        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
        Lookup Contact
      </button>
      <button onclick="openSettings()" class="flex-1 py-2 px-3 bg-slate-700 hover:bg-slate-600 text-white text-xs font-medium rounded-lg transition-colors flex items-center justify-center gap-1.5">
        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
        Settings
      </button>
    </div>
  `;
}

function closePanel() { document.getElementById('detail-panel').classList.add('hidden'); selectedId=null; renderTable(); }

// ─── Bookkeeper Performance ───────────────────────────────────────────────────
function renderBookkeepers() {
  const tbody = document.getElementById('bk-grid');
  if (!tbody) return;
  const agMap = {};
  filtered.forEach(c => {
    if (!agMap[c.agent]) agMap[c.agent] = { name:c.agent, total:0, inbound:0, outbound:0, missedVm:0, totalDur:0, clients:new Set() };
    const a = agMap[c.agent]; a.total++;
    if (c.direction==='inbound')  a.inbound++;
    if (c.direction==='outbound') a.outbound++;
    if (c.missed || c.voicemail || c.agent === 'Unanswered / Voicemail') a.missedVm++;
    a.totalDur += c.duration;
    if (c.contact_name) a.clients.add(c.contact_name); else if (c.phone) a.clients.add(c.phone);
  });
  const agents = Object.values(agMap).sort((a,b)=>b.total-a.total);
  const rowColors = ['#6366f1','#0ea5e9','#10b981','#f59e0b','#ef4444','#8b5cf6','#ec4899','#14b8a6'];
  if (!agents.length) { tbody.innerHTML = '<tr><td colspan="9" class="py-8 text-center text-xs text-slate-400">No data</td></tr>'; return; }
  tbody.innerHTML = agents.map((a, i) => {
    const avgDur  = a.total ? Math.round(a.totalDur / a.total) : 0;
    const ansRate = a.total ? Math.round(((a.total - a.missedVm) / a.total) * 100) : 0;
    const talkM   = Math.floor(a.totalDur / 60);
    const color   = rowColors[i % rowColors.length];
    const initials = a.name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
    const ansColor = ansRate >= 90 ? 'text-emerald-600' : ansRate >= 70 ? 'text-amber-500' : 'text-red-500';
    return `
      <tr class="border-b border-slate-100 hover:bg-slate-50 transition-colors">
        <td class="px-5 py-4">
          <div class="flex items-center gap-3">
            <div class="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0" style="background:${color}">${initials}</div>
            <div><p class="text-sm font-semibold text-slate-800">${a.name}</p><p class="text-xs text-slate-400">${a.clients.size} client${a.clients.size!==1?'s':''}</p></div>
          </div>
        </td>
        <td class="px-4 py-4 text-center"><span class="text-lg font-bold text-slate-900">${a.total}</span></td>
        <td class="px-4 py-4 text-center"><span class="text-sm font-semibold text-sky-600">${a.inbound}</span></td>
        <td class="px-4 py-4 text-center"><span class="text-sm font-semibold text-violet-600">${a.outbound}</span></td>
        <td class="px-4 py-4 text-center"><span class="text-sm font-semibold ${a.missedVm > 0 ? 'text-red-500' : 'text-slate-400'}">${a.missedVm}</span></td>
        <td class="px-4 py-4 text-center"><span class="text-sm font-bold ${ansColor}">${ansRate}%</span></td>
        <td class="px-4 py-4 text-center"><span class="text-sm font-mono text-slate-700">${fmtDur(avgDur)}</span></td>
        <td class="px-4 py-4 text-center"><span class="text-sm text-slate-700">${talkM}m</span></td>
        <td class="px-4 py-4 text-center"><span class="text-sm text-slate-600">${a.clients.size}</span></td>
      </tr>`;
  }).join('');
}

// ─── Repeat Callers ───────────────────────────────────────────────────────────
function renderRepeatCallers() {
  const tbody = document.getElementById('repeat-callers-body');
  if (!tbody) return;

  const phoneMap = {};
  filtered.forEach(c => {
    const key = c.phone;
    if (!phoneMap[key]) phoneMap[key] = { phone: key, contact: c.contact_name || null, company: c.contact_company || null, inbound: 0, outbound: 0, totalDur: 0, lastCall: null };
    const p = phoneMap[key];
    if (c.direction === 'inbound')  p.inbound++;
    else                            p.outbound++;
    p.totalDur += c.duration;
    const ts = new Date(c.timestamp);
    if (!p.lastCall || ts > p.lastCall) p.lastCall = ts;
  });

  const repeats = Object.values(phoneMap)
    .filter(p => (p.inbound + p.outbound) >= 3)
    .sort((a, b) => (b.inbound + b.outbound) - (a.inbound + a.outbound));

  if (!repeats.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="py-6 text-center text-xs text-slate-400">No numbers with 3+ calls this period</td></tr>';
    return;
  }

  tbody.innerHTML = repeats.map(p => {
    const total = p.inbound + p.outbound;
    const avgDur = total ? Math.round(p.totalDur / total) : 0;
    const lastFmt = p.lastCall
      ? p.lastCall.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ' ' + p.lastCall.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
      : '—';
    const unsaved = !p.contact;
    return `
      <tr class="border-b border-slate-100 hover:bg-slate-50 transition-colors">
        <td class="px-5 py-3">
          <p class="text-sm font-semibold text-slate-800">${p.contact || p.phone}</p>
          ${p.contact ? `<p class="text-xs text-slate-400">${p.phone}</p>` : `<p class="text-xs text-amber-500">⚠ not saved in contacts</p>`}
          ${p.company ? `<p class="text-xs text-slate-400">${p.company}</p>` : ''}
        </td>
        <td class="px-4 py-3 text-center"><span class="text-lg font-bold text-slate-900">${total}</span></td>
        <td class="px-4 py-3 text-center"><span class="text-sm font-semibold text-sky-600">${p.inbound}</span></td>
        <td class="px-4 py-3 text-center"><span class="text-sm font-semibold text-violet-600">${p.outbound}</span></td>
        <td class="px-4 py-3 text-center"><span class="text-sm font-mono text-slate-600">${fmtDur(avgDur)}</span></td>
        <td class="px-4 py-3 text-center text-xs text-slate-500">${lastFmt}</td>
      </tr>`;
  }).join('');
}

// ─── Talk Time Distribution ───────────────────────────────────────────────────
function renderTalkTimeDistribution() {
  const el = document.getElementById('talktime-dist');
  if (!el) return;

  const agMap = {};
  filtered.forEach(c => {
    if (!agMap[c.agent]) agMap[c.agent] = 0;
    agMap[c.agent] += c.duration;
  });

  const agents = Object.entries(agMap).sort((a, b) => b[1] - a[1]);
  if (!agents.length) { el.innerHTML = '<p class="text-xs text-slate-400 text-center py-6">No data</p>'; return; }

  const maxDur = agents[0][1] || 1;
  const colors = ['#6366f1','#0ea5e9','#10b981','#f59e0b','#ef4444','#8b5cf6','#ec4899','#14b8a6'];

  el.innerHTML = agents.map(([name, dur], i) => {
    const pct = Math.round((dur / maxDur) * 100);
    const h = Math.floor(dur / 3600);
    const m = Math.floor((dur % 3600) / 60);
    const s = dur % 60;
    const label = h > 0 ? `${h}h ${m}m` : `${m}m ${s}s`;
    const color = colors[i % colors.length];
    return `
      <div class="mb-4">
        <div class="flex justify-between text-xs mb-1">
          <span class="font-medium text-slate-700 truncate max-w-[170px]" title="${name}">${name}</span>
          <span class="text-slate-500 ml-2 shrink-0">${label}</span>
        </div>
        <div class="h-2 bg-slate-100 rounded-full overflow-hidden">
          <div class="h-full rounded-full transition-all duration-700" style="width:${pct}%;background:${color}"></div>
        </div>
      </div>`;
  }).join('');
}

// ─── CSV Export ───────────────────────────────────────────────────────────────
function doExport() {
  const esc = v => { if (v===null||v===undefined) return ''; const s=String(v); if (s.includes(',')||s.includes('"')||s.includes('\n')) return `"${s.replace(/"/g,'""')}"`; return s; };
  const fdur = s => `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;
  const label = document.getElementById('dr-label').textContent;
  const today = new Date().toLocaleDateString('en-GB');
  const lines = ['Call Activity Report',`Date Range,${label}`,`Generated,${today}`,`Total Calls,${filtered.length}`,'',[
    'Date','Time','Bookkeeper','Bookkeeper Email','Client Name','Client Company','Phone','Line','Direction',
    'Duration (mm:ss)','Duration (sec)','Wait Time (sec)','Status','Missed','Voicemail','Transferred',
    'Outcome','Follow-up Required','Tags','Notes'].map(esc).join(',')];
  filtered.forEach(c => {
    const d = c.timestamp instanceof Date ? c.timestamp : new Date(c.timestamp);
    lines.push([d.toLocaleDateString('en-GB'),d.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}),
      c.agent,c.agent_email||'',c.contact_name||'',c.contact_company||'',c.phone,c.line_name||'',c.direction,
      fdur(c.duration),c.duration,c.wait_duration||0,c.status,c.missed?'Yes':'No',c.voicemail?'Yes':'No',
      c.transferred?'Yes':'No',c.call_outcome||'',c.follow_up_required?'Yes':'No',(c.tags||[]).join('; '),(c.action_items||[]).join(' | ')].map(esc).join(','));
  });
  const csv = '﻿' + lines.join('\r\n');
  const blob = new Blob([csv],{type:'text/csv;charset=utf-8;'});
  const link = document.createElement('a'); link.href=URL.createObjectURL(blob); link.download=`call-report-${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(link); link.click(); document.body.removeChild(link);
}

// ─── PDF Export ───────────────────────────────────────────────────────────────
function doExportPDF() {
  const label = document.getElementById('dr-label').textContent;
  const today = new Date().toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'});
  const total=filtered.length, inbound=filtered.filter(c=>c.direction==='inbound').length;
  const outAll=filtered.filter(c=>c.direction==='outbound');
  const outAnswered=outAll.filter(c=>!c.missed&&!c.voicemail).length, outUnanswered=outAll.length-outAnswered;
  const missed=filtered.filter(c=>c.missed).length, answered=total-missed, ansRate=total?Math.round(answered/total*100):0;
  const totalDur=filtered.reduce((s,c)=>s+c.duration,0), avgDur=total?Math.round(totalDur/total):0;
  const followUps=filtered.filter(c=>c.follow_up_required).length;
  const agMap={}; filtered.forEach(c=>{ if(!agMap[c.agent]) agMap[c.agent]={name:c.agent,total:0,inbound:0,outAns:0,outUnans:0,missed:0,dur:0,clients:new Set()}; const a=agMap[c.agent]; a.total++; if(c.direction==='inbound')a.inbound++; if(c.direction==='outbound'&&!c.missed&&!c.voicemail)a.outAns++; if(c.direction==='outbound'&&(c.missed||c.voicemail))a.outUnans++; if(c.missed)a.missed++; a.dur+=c.duration; if(c.contact_name)a.clients.add(c.contact_name); else if(c.phone)a.clients.add(c.phone); });
  const agents=Object.values(agMap).sort((a,b)=>b.total-a.total);
  const clMap={}; filtered.forEach(c=>{ const key=c.contact_name||c.phone; if(!clMap[key])clMap[key]={name:c.contact_name||c.phone,company:c.contact_company||'',count:0,dur:0,agents:{}}; clMap[key].count++; clMap[key].dur+=c.duration; clMap[key].agents[c.agent]=(clMap[key].agents[c.agent]||0)+1; });
  const clients=Object.values(clMap).map(cl=>{ const top=Object.entries(cl.agents).sort((a,b)=>b[1]-a[1])[0]; return {...cl,primaryAgent:top?.[0]||'—',primaryCount:top?.[1]||0}; }).sort((a,b)=>b.count-a.count).slice(0,20);
  const win=window.open('','_blank');
  win.document.write(`<!DOCTYPE html><html><head><title>Call Report — ${label}</title><style>@page{size:A4;margin:1.2cm}*{box-sizing:border-box}body{font-family:-apple-system,'Segoe UI',sans-serif;color:#1e293b;margin:0;padding:0}.header{border-bottom:3px solid #4f46e5;padding-bottom:12px;margin-bottom:20px}.header h1{font-size:24px;margin:0 0 4px;color:#0f172a}.header .sub{color:#64748b;font-size:13px}h2{color:#4f46e5;font-size:15px;margin:24px 0 10px;border-bottom:1px solid #e2e8f0;padding-bottom:6px}.kpi-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:20px;page-break-inside:avoid}.kpi{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px}.kpi .label{font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:.5px;font-weight:600}.kpi .value{font-size:22px;font-weight:700;color:#0f172a;margin-top:4px}table{width:100%;border-collapse:collapse;font-size:11px;margin-top:8px}th{background:#4f46e5;color:white;text-align:left;padding:8px;font-weight:600;font-size:10px}td{padding:7px 8px;border-bottom:1px solid #e2e8f0}tr:nth-child(even)td{background:#f8fafc}.name{font-weight:600}.footer{margin-top:30px;padding-top:12px;border-top:1px solid #e2e8f0;color:#94a3b8;font-size:10px;text-align:center}.print-btn{position:fixed;top:16px;right:16px;padding:10px 20px;background:#4f46e5;color:white;border:none;border-radius:8px;font-weight:600;cursor:pointer}@media print{.print-btn{display:none}}</style></head><body>
  <button class="print-btn" onclick="window.print()">🖨 Print / Save PDF</button>
  <div class="header"><h1>📞 Call Activity Report</h1><div class="sub">Date range: <strong>${label}</strong></div><div style="color:#94a3b8;font-size:11px;margin-top:4px">Generated: ${today} · ${total} calls</div></div>
  <h2>Summary</h2><div class="kpi-grid">
    <div class="kpi"><div class="label">Total Calls</div><div class="value">${total}</div></div>
    <div class="kpi"><div class="label">Answer Rate</div><div class="value">${ansRate}%</div></div>
    <div class="kpi"><div class="label">Outbound Answered</div><div class="value">${outAnswered}</div></div>
    <div class="kpi"><div class="label">Outbound Unanswered</div><div class="value">${outUnanswered}</div></div>
    <div class="kpi"><div class="label">Inbound</div><div class="value">${inbound}</div></div>
    <div class="kpi"><div class="label">Talk Time</div><div class="value">${Math.floor(totalDur/60)}m</div></div>
    <div class="kpi"><div class="label">Avg Duration</div><div class="value">${Math.floor(avgDur/60)}:${String(avgDur%60).padStart(2,'0')}</div></div>
    <div class="kpi"><div class="label">Missed / Voicemail</div><div class="value">${missed}</div></div>
  </div>
  <h2>Bookkeeper Performance</h2><table><thead><tr><th>Bookkeeper</th><th>Total</th><th>In</th><th>Out Ans</th><th>Out Unans</th><th>Missed</th><th>Ans%</th><th>Talk</th><th>Clients</th></tr></thead><tbody>${agents.map(a=>`<tr><td class="name">${a.name}</td><td>${a.total}</td><td>${a.inbound}</td><td>${a.outAns}</td><td>${a.outUnans}</td><td>${a.missed}</td><td>${a.total?Math.round((a.total-a.missed)/a.total*100):0}%</td><td>${Math.floor(a.dur/60)}m</td><td>${a.clients.size}</td></tr>`).join('')}</tbody></table>
  <h2>Top Clients</h2><table><thead><tr><th>#</th><th>Client</th><th>Calls</th><th>Total</th><th>Avg</th><th>Primary Bookkeeper</th></tr></thead><tbody>${clients.map((cl,i)=>`<tr><td>${i+1}</td><td><div class="name">${cl.name}</div>${cl.company?`<div style="font-size:10px;color:#64748b">${cl.company}</div>`:''}</td><td>${cl.count}</td><td>${Math.floor(cl.dur/60)}m</td><td>${Math.floor((cl.dur/cl.count)/60)}:${String(Math.round((cl.dur/cl.count)%60)).padStart(2,'0')}</td><td>${cl.primaryAgent} (${cl.primaryCount})</td></tr>`).join('')}</tbody></table>
  <div style="page-break-before:always"></div><h2>Detailed Call Log</h2><table><thead><tr><th>Date/Time</th><th>Bookkeeper</th><th>Client</th><th>Phone</th><th>Dir</th><th>Duration</th><th>Status</th></tr></thead><tbody>${filtered.slice(0,200).map(c=>{ const d=c.timestamp instanceof Date?c.timestamp:new Date(c.timestamp); return `<tr><td>${d.toLocaleDateString('en-GB',{day:'2-digit',month:'short'})} ${d.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}</td><td>${c.agent}</td><td><div class="name">${c.contact_name||'—'}</div></td><td style="font-family:monospace;font-size:10px">${c.phone}</td><td>${c.direction.slice(0,3)}</td><td>${Math.floor(c.duration/60)}:${String(c.duration%60).padStart(2,'0')}</td><td>${c.missed?'Missed':c.status}</td></tr>`; }).join('')}</tbody></table>
  <div class="footer">Generated by Aircall Dashboard · ${new Date().toLocaleString('en-GB')}</div>
  <script>setTimeout(()=>window.print(),600);<\/script></body></html>`);
  win.document.close();
}

// ─── Contact Lookup ───────────────────────────────────────────────────────────
async function openContactLookup(phone) {
  const modal = document.getElementById('lookup-modal');
  const input = document.getElementById('lookup-phone');
  const results = document.getElementById('lookup-results');
  modal.classList.remove('hidden');
  input.value = phone || '';
  results.innerHTML = '';
  if (phone) await performLookup(phone);
}

async function performLookup(phone) {
  const results = document.getElementById('lookup-results');
  const input   = document.getElementById('lookup-phone');
  phone = (phone || input.value).trim();
  if (!phone) { results.innerHTML = '<p class="text-slate-400 text-sm">Enter a phone number</p>'; return; }
  results.innerHTML = '<p class="text-slate-500 text-sm">Searching Aircall contacts...</p>';
  try {
    const resp = await fetch(`/aircall-proxy?path=contacts&search=${encodeURIComponent(phone)}`);
    const data = await resp.json();
    const contacts = Array.isArray(data.contacts) ? data.contacts : [];
    const matching = contacts.filter(c => c.phone_numbers?.some(pn => pn.value.includes(phone.slice(-7))));
    if (matching.length > 0) {
      results.innerHTML = matching.map(c => `
        <div class="bg-slate-800 rounded-lg p-3 mb-2">
          <p class="font-semibold text-white">${c.name||'Unknown'}</p>
          <p class="text-xs text-slate-400 mt-1">${c.phone_numbers?.map(p=>p.value).join(', ')||'No phone'}</p>
          <button onclick="updateCallContact('${selectedId}','${c.name}')" class="mt-2 w-full py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium rounded transition-colors">Link to Current Call</button>
        </div>`).join('');
    } else {
      results.innerHTML = `<div class="bg-amber-500/10 rounded-lg p-3"><p class="text-amber-300 text-sm font-medium">No Aircall contacts found</p><p class="text-amber-200/70 text-xs mt-1">Add the contact in Aircall → Contacts, then search again.</p></div>`;
    }
  } catch (err) { results.innerHTML = `<p class="text-red-400 text-sm">Error: ${err.message}</p>`; }
}

function updateCallContact(callId, contactName) {
  const call = ALL_CALLS.find(c => c.id === callId);
  if (call) { call.contact_name = contactName; renderTable(); renderKPIs(); document.getElementById('lookup-modal').classList.add('hidden'); alert(`✓ Contact updated to: ${contactName}`); }
}
function closeLookup() { document.getElementById('lookup-modal').classList.add('hidden'); }

// ─── Settings ─────────────────────────────────────────────────────────────────
function openSettings() {
  const modal = document.getElementById('settings-modal');
  const contactsList = document.getElementById('contacts-list');
  modal.classList.remove('hidden');
  const contacts = JSON.parse(localStorage.getItem('aircall_contacts')||'{}');
  if (!Object.keys(contacts).length) { contactsList.innerHTML = '<p class="text-slate-400 text-sm py-4">No saved contacts yet.</p>'; return; }
  contactsList.innerHTML = Object.entries(contacts).map(([phone,name]) => `
    <div class="flex items-center justify-between bg-slate-700 rounded-lg p-3 mb-2">
      <div><p class="font-medium text-white text-sm">${name}</p><p class="text-xs text-slate-400">${phone}</p></div>
      <button onclick="deleteContact('${phone}')" class="px-2 py-1 bg-red-600/20 hover:bg-red-600/30 text-red-400 text-xs font-medium rounded transition-colors">Delete</button>
    </div>`).join('');
}

function addContact() {
  const phone = document.getElementById('new-phone').value.trim();
  const name  = document.getElementById('new-name').value.trim();
  if (!phone||!name) { alert('Please enter both phone number and name'); return; }
  const contacts = JSON.parse(localStorage.getItem('aircall_contacts')||'{}');
  contacts[phone] = name;
  localStorage.setItem('aircall_contacts', JSON.stringify(contacts));
  document.getElementById('new-phone').value=''; document.getElementById('new-name').value='';
  openSettings();
}

function deleteContact(phone) {
  if (!confirm(`Delete contact: ${phone}?`)) return;
  const contacts = JSON.parse(localStorage.getItem('aircall_contacts')||'{}');
  delete contacts[phone];
  localStorage.setItem('aircall_contacts', JSON.stringify(contacts));
  openSettings();
}
function closeSettings() { document.getElementById('settings-modal').classList.add('hidden'); }

// ─── Missing Contacts ─────────────────────────────────────────────────────────
function showMissingContacts() {
  const noNameCalls = filtered.filter(c => !c.contact_name);
  const byPhone = {};
  noNameCalls.forEach(c => {
    if (!byPhone[c.phone]) byPhone[c.phone] = { phone:c.phone, calls:0, lastAgent:c.agent, lastDate:c.timestamp, agents:new Set() };
    byPhone[c.phone].calls++; byPhone[c.phone].agents.add(c.agent);
    const t=c.timestamp instanceof Date?c.timestamp:new Date(c.timestamp);
    const lt=byPhone[c.phone].lastDate instanceof Date?byPhone[c.phone].lastDate:new Date(byPhone[c.phone].lastDate);
    if (t>lt) { byPhone[c.phone].lastDate=c.timestamp; byPhone[c.phone].lastAgent=c.agent; }
  });
  const list = Object.values(byPhone).sort((a,b)=>b.calls-a.calls);
  const csv = '﻿'+['Phone,Call Count,Last Call,Bookkeepers'].concat(list.map(r=>{ const d=(r.lastDate instanceof Date?r.lastDate:new Date(r.lastDate)).toLocaleDateString('en-GB'); return `"${r.phone}",${r.calls},${d},"${[...r.agents].join('; ')}"`; })).join('\r\n');
  const html = `<div class="fixed inset-0 bg-black/60 flex items-center justify-center z-50" id="missing-modal" onclick="if(event.target===this)this.remove()">
    <div class="bg-white rounded-2xl shadow-2xl w-[500px] max-h-[80vh] overflow-hidden flex flex-col">
      <div class="p-5 border-b border-slate-200 flex items-center justify-between">
        <div><h2 class="text-lg font-bold text-slate-900">Missing Contact Names</h2><p class="text-xs text-slate-500 mt-1">${list.length} numbers · ${noNameCalls.length} calls</p></div>
        <button onclick="document.getElementById('missing-modal').remove()" class="text-slate-400 hover:text-slate-600"><svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg></button>
      </div>
      <div class="p-3 bg-amber-50 border-b border-amber-100"><button onclick="downloadMissingCsv()" class="w-full py-2 bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium rounded-lg">📥 Download CSV</button></div>
      <div class="overflow-y-auto flex-1 p-4">${list.map(r=>{ const d=(r.lastDate instanceof Date?r.lastDate:new Date(r.lastDate)).toLocaleDateString('en-GB'); return `<div class="border border-slate-200 rounded-lg p-3 mb-2 hover:bg-slate-50"><div class="flex justify-between items-start"><div><p class="font-mono text-sm font-semibold text-slate-800">${r.phone}</p><p class="text-xs text-slate-500 mt-0.5">Last: ${d} by ${r.lastAgent}</p></div><span class="bg-indigo-100 text-indigo-700 text-xs font-bold px-2 py-1 rounded">${r.calls} call${r.calls!==1?'s':''}</span></div></div>`; }).join('')}</div>
    </div></div>`;
  document.body.insertAdjacentHTML('beforeend', html);
  window.__missingCsv = csv;
}

function downloadMissingCsv() {
  const blob = new Blob([window.__missingCsv||''],{type:'text/csv;charset=utf-8;'});
  const link = document.createElement('a'); link.href=URL.createObjectURL(blob); link.download=`missing-contacts-${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(link); link.click(); document.body.removeChild(link);
}

// ════════════════════════════════════════════════════════════════════════════
// MESSAGING
// ════════════════════════════════════════════════════════════════════════════

async function loadMessages(range) {
  const { from, to } = rangeTimestamps(range);
  const prog = document.getElementById('msg-progress');
  const allMsgs = [];
  for (let page = 1; page <= 200; page++) {
    if (prog) prog.textContent = `${allMsgs.length} messages loaded…`;
    const url = `/aircall-proxy?path=messages&from=${from}&to=${to}&per_page=50&order=desc&page=${page}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const json = await resp.json();
    if (json.error) throw new Error(json.error);
    const msgs = json.messages || [];
    allMsgs.push(...msgs);
    if (!json.meta?.next_page_link || msgs.length === 0) break;
  }
  return allMsgs;
}

function groupIntoThreads(messages) {
  const map = {};
  messages.forEach(m => {
    const key = m.conversation_key || `single-${m.id}`;
    if (!map[key]) {
      map[key] = { key, msgs:[], latestTs:0, latestMsg:null, agent:null, contact:null, line:m.number?.name||m.number?.digits||null, status:m.conversation?.status||'open', unread:0 };
    }
    map[key].msgs.push(m);
    if (m.created_at > map[key].latestTs) { map[key].latestTs = m.created_at; map[key].latestMsg = m; }
    if (m.user?.name) map[key].agent = m.user.name;
    if (!m.read) map[key].unread++;
    const ext = m.direction === 'inbound' ? m.from : m.to;
    if (ext) map[key].contact = ext;
  });
  Object.values(map).forEach(t => t.msgs.sort((a,b) => a.created_at - b.created_at));
  return Object.values(map).sort((a,b) => b.latestTs - a.latestTs);
}

async function doRefreshMessages() {
  document.getElementById('msg-loading').classList.remove('hidden');
  document.getElementById('messages-content').classList.add('hidden');
  document.getElementById('msg-unavailable').classList.add('hidden');
  try {
    const { from, to } = rangeTimestamps(dateRange);
    const resp = await fetch(`/aircall-messages?from=${from}&to=${to}`);
    const json = await resp.json();
    ALL_MESSAGES = json.messages || [];
    ALL_THREADS  = groupIntoThreads(ALL_MESSAGES);

    const agents = [...new Set(ALL_MESSAGES.map(m => m.user?.name).filter(Boolean))].sort();
    const agSel = document.getElementById('mf-agent');
    if (agSel) { const prev=agSel.value; agSel.innerHTML='<option value="">All Agents</option>'; agents.forEach(a=>{ const o=document.createElement('option'); o.value=a; o.textContent=a; agSel.appendChild(o); }); agSel.value=prev; }

    const lines = [...new Set(ALL_MESSAGES.map(m => m.number?.name||m.number?.digits).filter(Boolean))].sort();
    const lnSel = document.getElementById('mf-line');
    if (lnSel) { const prev=lnSel.value; lnSel.innerHTML='<option value="">All Lines</option>'; lines.forEach(l=>{ const o=document.createElement('option'); o.value=l; o.textContent=l; lnSel.appendChild(o); }); lnSel.value=prev; }

    // Update coverage banner
    const allStored = await fetch('/aircall-messages').then(r=>r.json());
    const titleEl = document.getElementById('msg-coverage-title');
    const subEl   = document.getElementById('msg-coverage-sub');
    if (titleEl) {
      const total = allStored.total || 0;
      if (total > 0) {
        const earliest = allStored.messages.reduce((min,m) => m.created_at < min ? m.created_at : min, Infinity);
        const d = new Date(earliest * 1000).toLocaleDateString('en-GB', { day:'numeric', month:'long', year:'numeric' });
        titleEl.textContent = `Messaging analytics captured from ${d} onwards (${total} message${total!==1?'s':''} stored)`;
      } else {
        titleEl.textContent = `Messaging analytics captured from ${new Date().toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'})} onwards — waiting for first message`;
      }
    }

    applyMsgFilters();
    document.getElementById('msg-loading').classList.add('hidden');
    document.getElementById('messages-content').classList.remove('hidden');
  } catch(e) {
    console.error('Messages load error:', e);
    document.getElementById('msg-loading').classList.add('hidden');
    document.getElementById('msg-unavailable').classList.remove('hidden');
  }
}

function showMsgInfo()  { document.getElementById('msg-info-modal').classList.remove('hidden'); }
function closeMsgInfo() { document.getElementById('msg-info-modal').classList.add('hidden'); }

function applyMsgFilters() {
  const q   = document.getElementById('mf-search')?.value.trim().toLowerCase() || '';
  const ag  = document.getElementById('mf-agent')?.value  || '';
  const dir = document.getElementById('mf-dir')?.value    || '';
  const ln  = document.getElementById('mf-line')?.value   || '';
  const st  = document.getElementById('mf-status')?.value || '';

  FILTERED_THREADS = ALL_THREADS.filter(t => {
    if (ag && t.agent !== ag) return false;
    if (ln && t.line !== ln)  return false;
    if (st && t.status !== st) return false;
    if (dir && !t.msgs.some(m => m.direction === dir)) return false;
    if (q) {
      const hay = [t.contact||'', t.agent||'', t.line||'', ...t.msgs.map(m=>m.content||'')].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  FILTERED_THREADS.sort((a,b) => {
    let col = msgSortCol;
    let av = col==='time' ? a.latestTs : col==='agent' ? (a.agent||'') : col==='count' ? a.msgs.length : a.latestTs;
    let bv = col==='time' ? b.latestTs : col==='agent' ? (b.agent||'') : col==='count' ? b.msgs.length : b.latestTs;
    if (typeof av==='string') av=av.toLowerCase();
    if (typeof bv==='string') bv=bv.toLowerCase();
    if (av<bv) return msgSortDir==='asc'?-1:1;
    if (av>bv) return msgSortDir==='asc'?1:-1;
    return 0;
  });

  renderMessageKPIs();
  renderMessageTable();
}

function sortMsgBy(col) {
  msgSortDir = msgSortCol===col ? (msgSortDir==='asc'?'desc':'asc') : 'desc';
  msgSortCol = col;
  document.querySelectorAll('[id^="msi-"]').forEach(el => { el.textContent='↕'; el.className='text-slate-300'; });
  const el = document.getElementById('msi-'+col);
  if (el) { el.textContent=msgSortDir==='asc'?'↑':'↓'; el.className='text-indigo-500'; }
  applyMsgFilters();
}

function clearMsgFilters() {
  ['mf-search','mf-agent','mf-dir','mf-line','mf-status'].forEach(id => { const el=document.getElementById(id); if(el) el.value=''; });
  applyMsgFilters();
}

function renderMessageKPIs() {
  const total    = ALL_MESSAGES.length;
  const inbound  = ALL_MESSAGES.filter(m => m.direction==='inbound').length;
  const outbound = ALL_MESSAGES.filter(m => m.direction==='outbound').length;
  const contacts = new Set(ALL_MESSAGES.map(m => m.direction==='inbound' ? m.from : m.to).filter(Boolean)).size;
  const threads  = ALL_THREADS.length;
  const open     = ALL_THREADS.filter(t => t.status==='open').length;

  const setN = (id,v) => { const el=document.getElementById(id); if(el) countUp(el,v); };
  const setT = (id,v) => { const el=document.getElementById(id); if(el) el.textContent=v; };

  setN('mkpi-total',    total);
  setN('mkpi-inbound',  inbound);
  setN('mkpi-outbound', outbound);
  setN('mkpi-contacts', contacts);
  setN('mkpi-threads',  threads);

  setT('mkpi-total-sub',    `${inbound} in · ${outbound} out`);
  setT('mkpi-inbound-sub',  total ? `${Math.round(inbound/total*100)}% of total` : '—');
  setT('mkpi-outbound-sub', total ? `${Math.round(outbound/total*100)}% of total` : '—');
  setT('mkpi-contacts-sub', 'unique numbers');
  setT('mkpi-threads-sub',  `${open} open · ${threads-open} closed`);
}

function renderMessageTable() {
  const tbody = document.getElementById('msg-tbody');
  const empty = document.getElementById('msg-empty');
  if (!tbody) return;

  if (!FILTERED_THREADS.length) {
    tbody.innerHTML = '';
    if (empty) empty.classList.remove('hidden');
    return;
  }
  if (empty) empty.classList.add('hidden');

  const fmtTs = ts => {
    const d = new Date(ts * 1000);
    return d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}) + ', ' + d.toLocaleDateString([],{month:'short',day:'numeric'});
  };

  tbody.innerHTML = FILTERED_THREADS.map(t => {
    const latest  = t.latestMsg || t.msgs[t.msgs.length-1];
    const preview = (latest?.content||'').slice(0,90) + ((latest?.content||'').length>90?'…':'');
    const isIn    = latest?.direction==='inbound';
    const dirIcon = isIn
      ? `<span class="flex items-center gap-1 text-xs text-sky-600"><svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3"/></svg>In</span>`
      : `<span class="flex items-center gap-1 text-xs text-violet-600"><svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18"/></svg>Out</span>`;
    const statusBadge = t.status==='open'
      ? '<span class="tag bg-emerald-50 text-emerald-700">Open</span>'
      : '<span class="tag bg-slate-100 text-slate-500">Closed</span>';
    const unreadBadge = t.unread>0
      ? `<span class="ml-1 px-1.5 py-0.5 bg-indigo-600 text-white text-[10px] font-bold rounded-full">${t.unread}</span>`
      : '';
    const sel = activeThreadKey===t.key ? 'row-sel' : '';
    return `
      <tr class="border-b border-slate-100 hover:bg-slate-50 cursor-pointer transition-colors ${sel}" onclick="openThreadPanel('${t.key}')">
        <td class="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">${fmtTs(t.latestTs)}</td>
        <td class="px-4 py-3 text-sm font-medium text-slate-800">${t.agent||'<span class="text-slate-400 font-normal">—</span>'}</td>
        <td class="px-4 py-3 text-sm font-medium text-slate-800">${t.contact||'—'}</td>
        <td class="px-4 py-3 text-xs text-slate-500">${t.line||'—'}</td>
        <td class="px-4 py-3">${dirIcon}</td>
        <td class="px-4 py-3 max-w-xs"><p class="text-xs text-slate-600 truncate">${preview||'<em class="text-slate-400">No content</em>'}</p></td>
        <td class="px-4 py-3 text-center text-xs font-semibold text-slate-700">${t.msgs.length}</td>
        <td class="px-4 py-3">${statusBadge}${unreadBadge}</td>
      </tr>`;
  }).join('');
}

function openThreadPanel(key) {
  activeThreadKey = key;
  const thread = ALL_THREADS.find(t => t.key === key);
  if (!thread) return;

  const panel = document.getElementById('msg-panel');
  panel.classList.remove('hidden');

  const fmtTs = ts => new Date(ts*1000).toLocaleString([],{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});

  document.getElementById('msg-panel-inner').innerHTML = `
    <div class="flex items-center justify-between px-4 py-4 border-b border-slate-200 bg-white">
      <div>
        <p class="text-sm font-semibold text-slate-900">${thread.contact||'Unknown Contact'}</p>
        <p class="text-xs text-slate-500 mt-0.5">${thread.line||'Unknown line'} · ${thread.msgs.length} message${thread.msgs.length!==1?'s':''}${thread.agent?' · '+thread.agent:''}</p>
      </div>
      <div class="flex items-center gap-2">
        ${thread.status==='open'?'<span class="tag bg-emerald-50 text-emerald-700">Open</span>':'<span class="tag bg-slate-100 text-slate-500">Closed</span>'}
        <button onclick="closeThreadPanel()" class="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors">
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
        </button>
      </div>
    </div>
    <div class="flex-1 overflow-y-auto px-4 py-4 space-y-3 bg-slate-50" style="min-height:0">
      ${thread.msgs.map(m => {
        const isOut = m.direction==='outbound';
        const bubbleBase = isOut ? 'bg-indigo-600 text-white ml-auto' : 'bg-white text-slate-800 border border-slate-200';
        return `
          <div class="flex flex-col ${isOut?'items-end':'items-start'}">
            <div class="max-w-[85%] px-4 py-2.5 rounded-2xl ${bubbleBase} shadow-sm">
              <p class="text-sm leading-relaxed whitespace-pre-wrap">${(m.content||'').replace(/</g,'&lt;').replace(/>/g,'&gt;') || '<em style="opacity:.6">No content</em>'}</p>
            </div>
            <div class="flex items-center gap-2 mt-1 px-1">
              ${m.user?.name&&isOut?`<span class="text-[10px] text-slate-400">${m.user.name}</span>`:''}
              <span class="text-[10px] text-slate-400">${fmtTs(m.created_at)}</span>
              ${!m.read&&!isOut?'<span class="w-1.5 h-1.5 rounded-full bg-indigo-500 inline-block" title="Unread"></span>':''}
            </div>
          </div>`;
      }).join('')}
    </div>
  `;

  // Mark as read
  thread.unread = 0;
  thread.msgs.forEach(m => { m.read = true; });
  renderMessageTable();
}

function closeThreadPanel() {
  document.getElementById('msg-panel').classList.add('hidden');
  activeThreadKey = null;
  renderMessageTable();
}

function exportMessagesCSV() {
  const esc = v => { if(v==null) return ''; const s=String(v); return s.includes(',')||s.includes('"')||s.includes('\n')?`"${s.replace(/"/g,'""')}"`:''+s; };
  const label = document.getElementById('dr-label').textContent;
  const lines = ['SMS Messages Report',`Date Range,${label}`,`Generated,${new Date().toLocaleDateString('en-GB')}`,`Total Messages,${ALL_MESSAGES.length}`,'',
    ['Date','Time','Direction','Agent','From','To','Line','Message Content','Thread Key','Status','Read'].map(esc).join(',')];
  [...ALL_MESSAGES].sort((a,b)=>b.created_at-a.created_at).forEach(m=>{
    const d=new Date(m.created_at*1000);
    lines.push([d.toLocaleDateString('en-GB'),d.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}),
      m.direction,m.user?.name||'',m.from||'',m.to||'',m.number?.name||m.number?.digits||'',
      m.content||'',m.conversation_key||'',m.conversation?.status||'',m.read?'Yes':'No'].map(esc).join(','));
  });
  const csv='﻿'+lines.join('\r\n');
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'});
  const link=document.createElement('a'); link.href=URL.createObjectURL(blob); link.download=`messages-${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(link); link.click(); document.body.removeChild(link);
}
