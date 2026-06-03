/* ═══════════════════════════════════════════════════════════
   Dashboard de Custos — Main Application
   ═══════════════════════════════════════════════════════════ */

// ── State ────────────────────────────────────────────────────
const S = {
  months: {},           // { "2025-01": { clients, summary, month_year } }
  currentMonth: null,   // key like "2025-01"
  currentTab: 'geral',
  viewMode: 'geral',    // 'geral' | 'empresas' | 'individual'
  selectedClient: null,
  compareMode: 'carteira', // 'carteira' | 'cliente'
  compareClient: null,  // selected client object { nome, doc, ... } for comparativo
  charts: {},           // Chart.js instances keyed by canvas id
};

// ── Formatters ───────────────────────────────────────────────
const fmt = {
  brl: v => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 }).format(v),
  brlShort: v => {
    const a = Math.abs(v);
    const s = v < 0 ? '-' : '';
    if (a >= 1e6) return s + 'R$' + (a / 1e6).toFixed(2).replace('.', ',') + 'M';
    if (a >= 1e3) return s + 'R$' + (a / 1e3).toFixed(1).replace('.', ',') + 'K';
    return fmt.brl(v);
  },
  pct: v => (v * 100).toFixed(1).replace('.', ',') + '%',
  int: v => new Intl.NumberFormat('pt-BR').format(Math.round(v)),
  monthLabel: key => {
    if (!key) return '';
    const [y, m] = key.split('-');
    const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    return `${months[parseInt(m, 10) - 1]}/${y}`;
  },
};

// ── Colors ───────────────────────────────────────────────────
const C = {
  primary: '#002749',
  danger:  '#b02228',
  positive: '#059669',
  warning: '#D97706',
  muted: '#9CA3AF',
  border: '#E5E7EB',
  bg: '#F9FAFB',
  primaryAlpha: (a) => `rgba(0,39,73,${a})`,
  dangerAlpha:  (a) => `rgba(176,34,40,${a})`,
  positiveAlpha:(a) => `rgba(5,150,105,${a})`,
  warningAlpha: (a) => `rgba(217,119,6,${a})`,
  forResult: v => v >= 0 ? C.positive : C.danger,
  forResultAlpha: (v, a) => v >= 0 ? C.positiveAlpha(a) : C.dangerAlpha(a),
};

// ── Chart defaults ───────────────────────────────────────────
Chart.defaults.font.family = "'Geist', system-ui, sans-serif";
Chart.defaults.font.size = 12;
Chart.defaults.color = '#6B7280';
Chart.defaults.plugins.legend.labels.boxWidth = 10;
Chart.defaults.plugins.legend.labels.padding = 14;
Chart.defaults.plugins.tooltip.backgroundColor = '#111827';
Chart.defaults.plugins.tooltip.titleColor = '#F9FAFB';
Chart.defaults.plugins.tooltip.bodyColor = '#D1D5DB';
Chart.defaults.plugins.tooltip.padding = 10;
Chart.defaults.plugins.tooltip.cornerRadius = 8;
Chart.defaults.plugins.tooltip.displayColors = true;
Chart.defaults.plugins.tooltip.boxWidth = 8;
Chart.defaults.plugins.tooltip.boxHeight = 8;
Chart.defaults.animation.duration = 600;
Chart.defaults.animation.easing = 'easeOutQuart';

// ── Helpers ──────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const show = el => el && el.classList.remove('hidden');
const hide = el => el && el.classList.add('hidden');

function destroyChart(id) {
  if (S.charts[id]) { S.charts[id].destroy(); delete S.charts[id]; }
}

function mkChart(id, config) {
  destroyChart(id);
  const canvas = $(id);
  if (!canvas) return null;
  const chart = new Chart(canvas, config);
  S.charts[id] = chart;
  return chart;
}

function currentData() {
  return S.months[S.currentMonth] || null;
}

function getClients(data) {
  if (!data) return [];
  if (S.viewMode === 'individual' && S.selectedClient !== null) {
    return data.clients.filter((_, i) => i === S.selectedClient);
  }
  return data.clients;
}

function sortedBy(arr, key, asc = false) {
  return [...arr].sort((a, b) => asc ? a[key] - b[key] : b[key] - a[key]);
}

function topN(arr, key, n, asc = false) {
  return sortedBy(arr, key, asc).slice(0, n);
}

function avgOf(arr, key) {
  if (!arr.length) return 0;
  return arr.reduce((s, x) => s + x[key], 0) / arr.length;
}

function medianOf(arr, key) {
  const sorted = [...arr].map(x => x[key]).sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// ── Upload Flow ──────────────────────────────────────────────
let addFileObj = null;

function setupNoDataCTA() {
  $('no-data-btn').addEventListener('click', () => {
    $('add-month-modal').classList.add('open');
  });
}

async function doUpload(monthKey, fileObj, btnId, errId, onSuccess) {
  const btn = $(btnId);
  btn.classList.add('btn-loading');
  btn.disabled = true;
  hide($(errId));

  const fd = new FormData();
  fd.append('file', fileObj);
  fd.append('month_year', monthKey);

  try {
    const res = await fetch('/api/upload', { method: 'POST', body: fd });
    const json = await res.json();
    if (!res.ok || json.error) {
      showError(errId, json.error || 'Erro ao processar arquivo.');
      return;
    }

    // Fetch full data
    const dataRes = await fetch(`/api/data/${encodeURIComponent(monthKey)}`);
    const data = await dataRes.json();
    S.months[monthKey] = data;

    onSuccess(monthKey, data);
  } catch (err) {
    showError(errId, 'Erro de conexão: ' + err.message);
  } finally {
    btn.classList.remove('btn-loading');
    btn.disabled = false;
  }
}

function showError(id, msg) {
  const el = $(id);
  if (!el) return;
  el.textContent = msg;
  show(el);
}

// ── Dashboard Initialization ─────────────────────────────────
function showDashboard(monthKey) {
  S.currentMonth = monthKey;
  hide($('no-data'));
  document.querySelector('.filter-bar').style.display = '';
  document.querySelector('.nav-tabs').style.visibility = '';
  document.querySelectorAll('.tab-panel').forEach(p => p.style.display = '');
  updateMonthPills();
  updatePeriodSelect();
  populateClientSelects();
  renderCurrentTab();
}

function showEmptyState() {
  document.querySelectorAll('.tab-panel').forEach(p => p.style.display = 'none');
  document.querySelector('.filter-bar').style.display = 'none';
  document.querySelector('.nav-tabs').style.visibility = 'hidden';
  show($('no-data'));
}

function updateMonthPills() {
  const container = $('nav-month-pills');
  container.innerHTML = '';
  Object.keys(S.months).sort().forEach(key => {
    const pill = document.createElement('button');
    pill.className = 'nav-month-pill' + (key === S.currentMonth ? ' active' : '');
    pill.textContent = fmt.monthLabel(key);
    pill.addEventListener('click', () => {
      S.currentMonth = key;
      updateMonthPills();
      updatePeriodSelect();
      populateClientSelects();
      renderCurrentTab();
    });
    container.appendChild(pill);
  });
}

function updatePeriodSelect() {
  const sel = $('period-select');
  if (!sel) return;
  sel.innerHTML = '<option value="all">Todos os meses</option>';
  Object.keys(S.months).sort().forEach(key => {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = fmt.monthLabel(key);
    if (key === S.currentMonth) opt.selected = true;
    sel.appendChild(opt);
  });
}

function populateClientSelects() {
  const data = currentData();
  if (!data) return;
  const clients = data.clients;
  if (SS.filter) SS.filter.setItems(clients);
  if (SS.individual) SS.individual.setItems(clients);
}

// ── SearchSelect Component ───────────────────────────────────
const SS = {}; // SearchSelect instances

function createSearchSelect(containerId, onSelect) {
  const container = $(containerId);
  const input     = container.querySelector('.search-input');
  const dropdown  = container.querySelector('.search-dropdown');
  const clearBtn  = container.querySelector('.search-clear');

  let items       = [];
  let filtered    = [];
  let activeIdx   = -1;
  let selectedIdx = null;

  const norm = s => (s || '').toString().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
  const highlight = (text, query) => {
    if (!query) return escapeHtml(text);
    const nText = norm(text), nQuery = norm(query);
    const i = nText.indexOf(nQuery);
    if (i < 0) return escapeHtml(text);
    return escapeHtml(text.slice(0, i)) + '<mark>' + escapeHtml(text.slice(i, i + query.length)) + '</mark>' + escapeHtml(text.slice(i + query.length));
  };

  function render(query = '') {
    if (!filtered.length) {
      dropdown.innerHTML = '<div class="search-empty">Nenhum cliente encontrado</div>';
      return;
    }
    const max = 100; // limit DOM nodes
    const slice = filtered.slice(0, max);
    dropdown.innerHTML = slice.map((it, i) => {
      const real = items.indexOf(it);
      return `<div class="search-option ${i === activeIdx ? 'active' : ''}" data-idx="${real}">
        <div class="search-option-name">${highlight(it.nome, query)}</div>
        ${it.doc ? `<div class="search-option-doc">${highlight(it.doc, query)}</div>` : ''}
      </div>`;
    }).join('') + (filtered.length > max ? `<div class="search-empty">+${filtered.length - max} resultados — refine a busca</div>` : '');

    dropdown.querySelectorAll('.search-option').forEach(opt => {
      opt.addEventListener('mousedown', e => { e.preventDefault(); select(parseInt(opt.dataset.idx)); });
      opt.addEventListener('mouseenter', () => {
        const idx = parseInt(opt.dataset.idx);
        activeIdx = filtered.indexOf(items[idx]);
        dropdown.querySelectorAll('.search-option').forEach(o => o.classList.remove('active'));
        opt.classList.add('active');
      });
    });
  }

  function filter(query) {
    const q = norm(query.trim());
    filtered = q
      ? items.filter(it => norm(it.nome).includes(q) || norm(it.doc).includes(q))
      : items;
    activeIdx = filtered.length ? 0 : -1;
    render(query.trim());
  }

  function select(idx) {
    const item = items[idx];
    if (!item) return;
    selectedIdx = idx;
    input.value = item.nome + (item.doc ? ` — ${item.doc}` : '');
    clearBtn.classList.remove('hidden');
    close();
    onSelect(idx, item);
  }

  function clear() {
    input.value = '';
    selectedIdx = null;
    clearBtn.classList.add('hidden');
    filtered = items;
    activeIdx = -1;
    close();
    onSelect(null, null);
  }

  function open() {
    filter(input.value);
    dropdown.classList.remove('hidden');
  }
  function close() { dropdown.classList.add('hidden'); }

  input.addEventListener('focus', () => { input.select(); open(); });
  input.addEventListener('input', () => {
    selectedIdx = null;
    clearBtn.classList.toggle('hidden', !input.value);
    filter(input.value);
    if (dropdown.classList.contains('hidden')) open();
  });
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); activeIdx = Math.min(activeIdx + 1, filtered.length - 1); render(input.value); scrollActive(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); activeIdx = Math.max(activeIdx - 1, 0); render(input.value); scrollActive(); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIdx >= 0 && filtered[activeIdx]) select(items.indexOf(filtered[activeIdx]));
    }
    else if (e.key === 'Escape') { close(); input.blur(); }
  });

  clearBtn.addEventListener('mousedown', e => { e.preventDefault(); clear(); });

  document.addEventListener('click', e => { if (!container.contains(e.target)) close(); });

  function scrollActive() {
    const a = dropdown.querySelector('.search-option.active');
    if (a) a.scrollIntoView({ block: 'nearest' });
  }

  return {
    setItems(newItems) {
      items = newItems || [];
      filtered = items;
      activeIdx = -1;
      if (selectedIdx !== null && !items[selectedIdx]) clear();
    },
    clear,
    getSelected: () => selectedIdx,
  };
}

function escapeHtml(s) {
  return (s || '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

// ── Tab Navigation ───────────────────────────────────────────
function setupTabs() {
  document.querySelectorAll('.nav-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const tab = btn.dataset.tab;
      S.currentTab = tab;
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      $(`tab-${tab}`).classList.add('active');
      renderCurrentTab();
    });
  });
}

function renderCurrentTab() {
  const data = currentData();
  if (!data) return;
  const d = $('geral-period-label');
  if (d) d.textContent = fmt.monthLabel(S.currentMonth);

  switch (S.currentTab) {
    case 'geral':        renderGeral(data); break;
    case 'rentabilidade': renderRentabilidade(data); break;
    case 'custos':       renderCustos(data); break;
    case 'alertas':      renderAlertas(data); break;
    case 'individual':   renderIndividual(data); break;
    case 'grupos':       renderGrupos(); break;
    case 'comparativo':  renderComparativo(); break;
  }
}

// ── View Mode ────────────────────────────────────────────────
function setupViewMode() {
  document.querySelectorAll('.view-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      S.viewMode = btn.dataset.view;

      const wrap = $('filter-client-wrap');
      if (S.viewMode === 'individual') {
        wrap.classList.add('visible');
      } else {
        wrap.classList.remove('visible');
      }

      renderCurrentTab();
    });
  });

  SS.filter = createSearchSelect('filter-client-search', (idx) => {
    S.selectedClient = idx;
    renderCurrentTab();
  });

  $('period-select').addEventListener('change', e => {
    if (e.target.value !== 'all') {
      S.currentMonth = e.target.value;
      updateMonthPills();
      populateClientSelects();
    }
    renderCurrentTab();
  });
}

// ── Add Month Modal ──────────────────────────────────────────
function setupAddMonth() {
  const modal  = $('add-month-modal');
  const form   = $('add-month-form');
  const drop   = $('add-file-drop');
  const input  = $('add-file-input');
  const txt    = $('add-file-text');
  const sub    = $('add-file-sub');

  $('add-month-btn').addEventListener('click', () => modal.classList.add('open'));
  $('modal-cancel').addEventListener('click', () => { modal.classList.remove('open'); addFileObj = null; });
  modal.addEventListener('click', e => { if (e.target === modal) { modal.classList.remove('open'); addFileObj = null; } });

  drop.addEventListener('click', () => input.click());
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', e => {
    e.preventDefault();
    drop.classList.remove('over');
    const f = e.dataTransfer.files[0];
    if (f) { addFileObj = f; drop.classList.add('has-file'); txt.textContent = f.name; sub.textContent = (f.size/1024).toFixed(0)+' KB'; }
  });
  input.addEventListener('change', () => {
    if (input.files[0]) { addFileObj = input.files[0]; drop.classList.add('has-file'); txt.textContent = input.files[0].name; sub.textContent = (input.files[0].size/1024).toFixed(0)+' KB'; }
  });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const monthRaw = $('add-month-input').value;
    if (!monthRaw || !addFileObj) { showError('add-month-error', 'Preencha o mês e selecione um arquivo.'); return; }
    await doUpload(monthRaw, addFileObj, 'modal-submit', 'add-month-error', (key) => {
      modal.classList.remove('open');
      addFileObj = null;
      // Reset modal form state for next time
      $('add-file-text').textContent = 'Clique para selecionar';
      $('add-file-sub').textContent = '.xlsx ou .xls';
      $('add-file-drop').classList.remove('has-file');
      $('add-month-input').value = '';
      $('add-file-input').value = '';
      showDashboard(key);
    });
  });

}

// ═══════════════════════════════════════════════════════════════
// TAB: VISÃO GERAL
// ═══════════════════════════════════════════════════════════════
function renderGeral(data) {
  renderGeralCards(data.summary, data.clients);
  renderChartComposicao(data);
  renderChartReceitaCusto(data);
  renderChartTopPos(data);
  renderChartTopNeg(data);
}

function renderGeralCards(s, clients) {
  const container = $('geral-cards');
  const lucro = s.resultado_final >= 0;
  const activeClients = clients.filter(c => c.num_atividades > 0 || c.total_custo > 0 || c.honorario > 0);

  const cards = [
    { label: 'Honorários Totais', value: fmt.brl(s.honorarios_totais), cls: 'primary', sub: 'Receita fixa do período' },
    { label: 'Extras Totais', value: fmt.brl(s.extras_totais), cls: '', sub: 'Serviços adicionais faturados' },
    { label: 'Receita Bruta', value: fmt.brl(s.receita_bruta), cls: 'primary', sub: 'Honorários + Extras' },
    { label: 'Impostos', value: fmt.brl(s.impostos), cls: '', sub: `${fmt.pct(s.impostos / (s.receita_bruta || 1))} da receita bruta` },
    { label: 'Custo Total', value: fmt.brl(s.custo_total), cls: '', sub: 'Custo fixo + operacional' },
    { label: 'Resultado Final', value: fmt.brl(s.resultado_final), cls: lucro ? 'positive' : 'negative', sub: lucro ? '✓ Carteira com lucro' : '✗ Carteira com prejuízo', badge: lucro ? { cls: 'badge-pos', txt: 'Lucro' } : { cls: 'badge-neg', txt: 'Prejuízo' } },
    { label: 'Margem % Geral', value: fmt.pct(s.margem_pct), cls: s.margem_pct >= 0.32 ? 'positive' : s.margem_pct >= 0 ? '' : 'negative', sub: 'Resultado / Honorários · meta ≥ 32%', badge: s.margem_pct >= 0.32 ? { cls: 'badge-pos', txt: '≥ 32%' } : s.margem_pct >= 0 ? { cls: 'badge-warn', txt: 'Abaixo de 32%' } : { cls: 'badge-neg', txt: 'Negativa' } },
    { label: 'Comissão Geral', value: fmt.pct(s.margem_comissao_pct || 0), cls: '', sub: `${fmt.brl(s.vlr_margem_total || 0)} · Comissão / Honorários` },
    { label: 'Nº de Atividades', value: fmt.int(s.num_atividades), cls: 'primary', sub: `${activeClients.length} clientes ativos` },
    { label: 'Custo Médio/Ativ.', value: fmt.brl(s.custo_medio_atividade), cls: '', sub: 'Custo total ÷ atividades', mono: true },
    { label: 'Clientes Positivos', value: s.clientes_positivos, cls: 'positive', sub: `${fmt.pct(s.clientes_positivos / (s.total_clientes || 1))} da carteira`, badge: { cls: 'badge-pos', txt: s.clientes_positivos + ' clientes' } },
    { label: 'Clientes Negativos', value: s.clientes_negativos, cls: 'negative', sub: `${fmt.pct(s.clientes_negativos / (s.total_clientes || 1))} da carteira`, badge: { cls: 'badge-neg', txt: s.clientes_negativos + ' clientes' } },
    { label: 'Sem Honorário', value: s.clientes_sem_honorario, cls: '', sub: 'Têm custo mas sem receita', badge: { cls: 'badge-warn', txt: 'Revisar contrato' } },
  ];

  container.innerHTML = cards.map((c, i) => `
    <div class="card" style="animation-delay:${i * 40}ms">
      <div class="card-label">${c.label}</div>
      <div class="card-value ${c.cls} ${c.mono ? 'mono' : ''}">${c.value}</div>
      ${c.badge ? `<div class="card-badge ${c.badge.cls}">${c.badge.txt}</div>` : ''}
      <div class="card-sub">${c.sub}</div>
    </div>
  `).join('');
}

function renderChartComposicao(data) {
  const s = data.summary;
  mkChart('chart-composicao', {
    type: 'doughnut',
    data: {
      labels: ['Positivos', 'Negativos', 'Sem honorário', 'Zerados'],
      datasets: [{
        data: [s.clientes_positivos, s.clientes_negativos, s.clientes_sem_honorario, s.clientes_zerados],
        backgroundColor: [C.positive, C.danger, C.warning, C.muted],
        borderWidth: 2,
        borderColor: '#fff',
        hoverOffset: 6,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '65%',
      plugins: {
        legend: { position: 'bottom' },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.label}: ${ctx.raw} cliente${ctx.raw !== 1 ? 's' : ''} (${fmt.pct(ctx.raw / s.total_clientes)})`,
          },
        },
      },
    },
  });
}

function renderChartReceitaCusto(data) {
  const s = data.summary;
  mkChart('chart-receita-custo', {
    type: 'bar',
    data: {
      labels: ['Receita Bruta', 'Impostos', 'Custo Total', 'Resultado'],
      datasets: [{
        data: [s.receita_bruta, s.impostos, s.custo_total, s.resultado_final],
        backgroundColor: [C.primaryAlpha(.85), C.dangerAlpha(.7), C.warningAlpha(.8), s.resultado_final >= 0 ? C.positiveAlpha(.85) : C.dangerAlpha(.85)],
        borderRadius: 6,
        borderSkipped: false,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false },
        tooltip: { callbacks: { label: ctx => ` ${fmt.brl(ctx.raw)}` } },
      },
      scales: {
        y: { ticks: { callback: v => fmt.brlShort(v) }, grid: { color: C.border } },
        x: { grid: { display: false } },
      },
    },
  });
}

function renderChartTopPos(data) {
  const top = sortedBy(data.clients.filter(c => c.resultado > 0), 'resultado').slice(0, 10);
  mkChart('chart-top-pos', {
    type: 'bar',
    data: {
      labels: top.map(c => truncate(c.nome, 22)),
      datasets: [{
        data: top.map(c => c.resultado),
        backgroundColor: C.positiveAlpha(.8),
        borderColor: C.positive,
        borderWidth: 1,
        borderRadius: 4,
        borderSkipped: false,
      }],
    },
    options: horizontalBarOptions('Resultado', fmt.brl),
  });
}

function renderChartTopNeg(data) {
  const top = sortedBy(data.clients.filter(c => c.resultado < 0), 'resultado', true).slice(0, 10);
  mkChart('chart-top-neg', {
    type: 'bar',
    data: {
      labels: top.map(c => truncate(c.nome, 22)),
      datasets: [{
        data: top.map(c => c.resultado),
        backgroundColor: C.dangerAlpha(.8),
        borderColor: C.danger,
        borderWidth: 1,
        borderRadius: 4,
        borderSkipped: false,
      }],
    },
    options: horizontalBarOptions('Resultado', fmt.brl),
  });
}

// ═══════════════════════════════════════════════════════════════
// TAB: RENTABILIDADE
// ═══════════════════════════════════════════════════════════════
function renderRentabilidade(data) {
  renderRankingPrejuizo(data);
  renderHonExtra(data);
  renderMargemPct(data);
  renderPosNegBalance(data);
}

function renderRankingPrejuizo(data) {
  const top = sortedBy(data.clients.filter(c => c.resultado < 0), 'resultado', true).slice(0, 20);
  mkChart('chart-ranking-prejuizo', {
    type: 'bar',
    data: {
      labels: top.map(c => truncate(c.nome, 28)),
      datasets: [{
        label: 'Resultado',
        data: top.map(c => c.resultado),
        backgroundColor: top.map(c => C.dangerAlpha(.75)),
        borderColor: C.danger,
        borderWidth: 1,
        borderRadius: 4,
        borderSkipped: false,
      }],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => {
              const c = top[ctx.dataIndex];
              return [`Resultado: ${fmt.brl(c.resultado)}`, `Custo: ${fmt.brl(c.total_custo)}`, `Atividades: ${c.num_atividades}`];
            },
          },
        },
      },
      scales: {
        x: { ticks: { callback: v => fmt.brlShort(v) }, grid: { color: C.border } },
        y: { ticks: { font: { size: 11 } }, grid: { display: false } },
      },
    },
  });
}

function renderScatter(data) {
  const clients = data.clients.filter(c => c.total_custo > 0 || c.resultado !== 0);
  const medCusto = medianOf(clients, 'total_custo');

  const pos = clients.filter(c => c.resultado >= 0);
  const neg = clients.filter(c => c.resultado < 0);

  mkChart('chart-scatter', {
    type: 'scatter',
    data: {
      datasets: [
        {
          label: 'Positivo',
          data: pos.map(c => ({ x: c.total_custo, y: c.resultado, nome: c.nome, ativ: c.num_atividades })),
          backgroundColor: C.positiveAlpha(.6),
          borderColor: C.positive,
          borderWidth: 1,
          pointRadius: 5,
          pointHoverRadius: 8,
        },
        {
          label: 'Negativo',
          data: neg.map(c => ({ x: c.total_custo, y: c.resultado, nome: c.nome, ativ: c.num_atividades })),
          backgroundColor: C.dangerAlpha(.6),
          borderColor: C.danger,
          borderWidth: 1,
          pointRadius: 5,
          pointHoverRadius: 8,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom' },
        tooltip: {
          callbacks: {
            label: ctx => {
              const d = ctx.raw;
              return [`${d.nome}`, `Custo: ${fmt.brl(d.x)}`, `Resultado: ${fmt.brl(d.y)}`, `Atividades: ${d.ativ}`];
            },
          },
        },
        annotation: {
          annotations: {
            yLine: { type: 'line', yMin: 0, yMax: 0, borderColor: C.primary, borderWidth: 1.5, borderDash: [4, 4] },
            xLine: { type: 'line', xMin: medCusto, xMax: medCusto, borderColor: C.muted, borderWidth: 1, borderDash: [3, 3] },
            q1: { type: 'label', xValue: medCusto * 0.15, yValue: Math.max(...clients.map(c => c.resultado)) * 0.8, content: 'Eficiente ✓', color: C.positiveAlpha(.6), font: { size: 10 } },
            q2: { type: 'label', xValue: medCusto * 2.2, yValue: Math.max(...clients.map(c => c.resultado)) * 0.8, content: 'Alto custo, saudável', color: C.primaryAlpha(.5), font: { size: 10 } },
            q3: { type: 'label', xValue: medCusto * 0.15, yValue: Math.min(...clients.map(c => c.resultado)) * 0.8, content: 'Deficitário', color: C.dangerAlpha(.6), font: { size: 10 } },
            q4: { type: 'label', xValue: medCusto * 2.2, yValue: Math.min(...clients.map(c => c.resultado)) * 0.8, content: 'Crítico ⚠', color: C.dangerAlpha(.8), font: { size: 10 } },
          },
        },
      },
      scales: {
        x: { title: { display: true, text: 'Custo Total (R$)' }, ticks: { callback: v => fmt.brlShort(v) }, grid: { color: C.border } },
        y: { title: { display: true, text: 'Resultado (R$)' }, ticks: { callback: v => fmt.brlShort(v) }, grid: { color: C.border } },
      },
    },
  });
}

function renderMatriz(data) {
  const clients = data.clients.filter(c => c.total_custo > 0);
  const maxVal = Math.max(...clients.map(c => Math.max(c.honorario + c.extra, c.total_custo)));

  mkChart('chart-matriz', {
    type: 'scatter',
    data: {
      datasets: [{
        label: 'Clientes',
        data: clients.map(c => ({
          x: c.honorario + c.extra,
          y: c.total_custo,
          nome: c.nome,
          res: c.resultado,
        })),
        backgroundColor: clients.map(c => c.resultado >= 0 ? C.positiveAlpha(.55) : C.dangerAlpha(.55)),
        borderColor: clients.map(c => c.resultado >= 0 ? C.positive : C.danger),
        borderWidth: 1,
        pointRadius: 5,
        pointHoverRadius: 8,
      }, {
        label: 'Break-even',
        data: [{ x: 0, y: 0 }, { x: maxVal, y: maxVal }],
        type: 'line',
        borderColor: C.primaryAlpha(.4),
        borderDash: [5, 5],
        borderWidth: 1.5,
        pointRadius: 0,
        fill: false,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          filter: ctx => ctx.datasetIndex === 0,
          callbacks: {
            label: ctx => {
              const d = ctx.raw;
              return [`${d.nome}`, `Receita: ${fmt.brl(d.x)}`, `Custo: ${fmt.brl(d.y)}`, `Resultado: ${fmt.brl(d.res)}`];
            },
          },
        },
      },
      scales: {
        x: { title: { display: true, text: 'Receita (Honorário + Extra)' }, ticks: { callback: v => fmt.brlShort(v) }, grid: { color: C.border } },
        y: { title: { display: true, text: 'Custo Total' }, ticks: { callback: v => fmt.brlShort(v) }, grid: { color: C.border } },
      },
    },
  });
}

function renderHonExtra(data) {
  const top = topN(data.clients, 'total_custo', 20);
  mkChart('chart-hon-extra', {
    type: 'bar',
    data: {
      labels: top.map(c => truncate(c.nome, 22)),
      datasets: [
        { label: 'Honorário', data: top.map(c => c.honorario), backgroundColor: C.primaryAlpha(.8), borderRadius: 4, borderSkipped: false },
        { label: 'Extra', data: top.map(c => c.extra), backgroundColor: C.dangerAlpha(.7), borderRadius: 4, borderSkipped: false },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${fmt.brl(ctx.raw)}` } } },
      scales: {
        x: { stacked: true, grid: { display: false }, ticks: { font: { size: 10 } } },
        y: { stacked: true, ticks: { callback: v => fmt.brlShort(v) }, grid: { color: C.border } },
      },
    },
  });
}

function renderMargemPct(data) {
  const top = topN(data.clients.filter(c => c.honorario > 0 && c.resultado > 0), 'percentual', 15);
  mkChart('chart-margem-pct', {
    type: 'bar',
    data: {
      labels: top.map(c => truncate(c.nome, 18)),
      datasets: [{
        data: top.map(c => c.percentual * 100),
        backgroundColor: top.map(c => c.percentual >= 0.3 ? C.positiveAlpha(.8) : C.primaryAlpha(.7)),
        borderRadius: 4,
        borderSkipped: false,
      }],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ` ${ctx.raw.toFixed(1)}%` } } },
      scales: {
        x: { ticks: { callback: v => v + '%' }, grid: { color: C.border } },
        y: { ticks: { font: { size: 11 } }, grid: { display: false } },
      },
    },
  });
}

function renderPosNegBalance(data) {
  const posSum = data.clients.filter(c => c.resultado > 0).reduce((s, c) => s + c.resultado, 0);
  const negSum = data.clients.filter(c => c.resultado < 0).reduce((s, c) => s + c.resultado, 0);

  mkChart('chart-pos-neg-balance', {
    type: 'bar',
    data: {
      labels: ['Resultado Positivos', 'Resultado Negativos', 'Saldo Líquido'],
      datasets: [{
        data: [posSum, negSum, posSum + negSum],
        backgroundColor: [C.positiveAlpha(.8), C.dangerAlpha(.8), (posSum + negSum) >= 0 ? C.positiveAlpha(.9) : C.dangerAlpha(.9)],
        borderRadius: 6,
        borderSkipped: false,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ` ${fmt.brl(ctx.raw)}` } } },
      scales: {
        y: { ticks: { callback: v => fmt.brlShort(v) }, grid: { color: C.border } },
        x: { grid: { display: false } },
      },
    },
  });
}

// ═══════════════════════════════════════════════════════════════
// TAB: CUSTOS & ATIVIDADES
// ═══════════════════════════════════════════════════════════════
function renderCustos(data) {
  renderRankingCusto(data);
  renderAtividades(data);
  renderCustoAtiv(data);
  renderConcentracaoCusto(data);
  renderConcentracaoResultado(data);
  renderCustoComp(data);
  renderHistCustoAtiv(data);
}

function classify(sortedClients, valueKey) {
  const total = sortedClients.reduce((s, c) => s + c[valueKey], 0);
  let cum = 0;
  const a = [], b = [], cArr = [];
  for (const c of sortedClients) {
    cum += c[valueKey];
    const pct = cum / total;
    if (pct <= 0.8) a.push(c);
    else if (pct <= 0.95) b.push(c);
    else cArr.push(c);
  }
  return { a, b, c: cArr, total };
}

function renderConcentracao(containerId, items, valueKey, labels) {
  const sorted = sortedBy(items, valueKey);
  const { a, b, c, total } = classify(sorted, valueKey);
  const totalClients = sorted.length;
  if (totalClients === 0 || total === 0) {
    $(containerId).innerHTML = '<div class="alert-empty">Sem dados para análise</div>';
    return;
  }
  const sum = arr => arr.reduce((s, x) => s + x[valueKey], 0);
  const aSum = sum(a), bSum = sum(b), cSum = sum(c);
  const pct = n => fmt.pct(n / totalClients);
  const pctV = n => fmt.pct(n / total);

  const aPct = a.length / totalClients;
  const bPct = b.length / totalClients;
  const cPct = c.length / totalClients;

  $(containerId).innerHTML = `
    <div class="concentracao-headline">
      <strong>${a.length} clientes</strong> (${pct(a.length)} da carteira) concentram <strong>${pctV(aSum)}</strong> ${labels.headlineMetric}.
    </div>
    <div class="concentracao-grid">
      <div class="concentracao-stat concentracao-stat-a">
        <div class="concentracao-stat-header">
          <div class="concentracao-badge concentracao-badge-a">A</div>
          <div class="concentracao-stat-label">${labels.aLabel}</div>
        </div>
        <div class="concentracao-stat-count">${a.length}<small>clientes</small></div>
        <div class="concentracao-stat-money">${fmt.brl(aSum)} <span class="concentracao-stat-money-pct">(${pctV(aSum)} ${labels.shareLabel})</span></div>
      </div>
      <div class="concentracao-stat concentracao-stat-b">
        <div class="concentracao-stat-header">
          <div class="concentracao-badge concentracao-badge-b">B</div>
          <div class="concentracao-stat-label">${labels.bLabel}</div>
        </div>
        <div class="concentracao-stat-count">${b.length}<small>clientes</small></div>
        <div class="concentracao-stat-money">${fmt.brl(bSum)} <span class="concentracao-stat-money-pct">(${pctV(bSum)} ${labels.shareLabel})</span></div>
      </div>
      <div class="concentracao-stat concentracao-stat-c">
        <div class="concentracao-stat-header">
          <div class="concentracao-badge concentracao-badge-c">C</div>
          <div class="concentracao-stat-label">${labels.cLabel}</div>
        </div>
        <div class="concentracao-stat-count">${c.length}<small>clientes</small></div>
        <div class="concentracao-stat-money">${fmt.brl(cSum)} <span class="concentracao-stat-money-pct">(${pctV(cSum)} ${labels.shareLabel})</span></div>
      </div>
    </div>
    <div class="concentracao-bar" title="Distribuição da carteira por classe">
      ${aPct > 0.04 ? `<div class="concentracao-bar-segment concentracao-bar-a" style="flex:${a.length}">${(aPct*100).toFixed(0)}%</div>` : `<div class="concentracao-bar-segment concentracao-bar-a" style="flex:${a.length}"></div>`}
      ${bPct > 0.04 ? `<div class="concentracao-bar-segment concentracao-bar-b" style="flex:${b.length}">${(bPct*100).toFixed(0)}%</div>` : `<div class="concentracao-bar-segment concentracao-bar-b" style="flex:${b.length}"></div>`}
      ${cPct > 0.04 ? `<div class="concentracao-bar-segment concentracao-bar-c" style="flex:${c.length}">${(cPct*100).toFixed(0)}%</div>` : `<div class="concentracao-bar-segment concentracao-bar-c" style="flex:${c.length}"></div>`}
    </div>
    <div class="concentracao-bar-caption">Proporção do número de clientes em cada classe</div>
  `;
}

function renderConcentracaoCusto(data) {
  const clients = data.clients.filter(c => c.total_custo > 0);
  renderConcentracao('concentracao-custo', clients, 'total_custo', {
    headlineMetric: 'de todo o custo da carteira',
    shareLabel: 'do custo',
    aLabel: 'Alto impacto',
    bLabel: 'Médio impacto',
    cLabel: 'Baixo impacto',
  });
}

function renderConcentracaoResultado(data) {
  const clients = data.clients.filter(c => c.resultado > 0);
  renderConcentracao('concentracao-resultado', clients, 'resultado', {
    headlineMetric: 'de todo o resultado positivo da carteira',
    shareLabel: 'do resultado',
    aLabel: 'Geram a maior parte do lucro',
    bLabel: 'Contribuição moderada',
    cLabel: 'Contribuição menor',
  });
}

function renderRankingCusto(data) {
  const top = topN(data.clients.filter(c => c.total_custo > 0), 'total_custo', 20);
  mkChart('chart-ranking-custo', {
    type: 'bar',
    data: {
      labels: top.map(c => truncate(c.nome, 25)),
      datasets: [{
        label: 'Custo Total',
        data: top.map(c => c.total_custo),
        backgroundColor: top.map(c => c.resultado >= 0 ? C.positiveAlpha(.75) : C.dangerAlpha(.75)),
        borderColor: top.map(c => c.resultado >= 0 ? C.positive : C.danger),
        borderWidth: 1,
        borderRadius: 4,
        borderSkipped: false,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => {
              const c = top[ctx.dataIndex];
              return [`Custo: ${fmt.brl(c.total_custo)}`, `Resultado: ${fmt.brl(c.resultado)}`, `Atividades: ${c.num_atividades}`];
            },
          },
        },
      },
      scales: {
        y: { ticks: { callback: v => fmt.brlShort(v) }, grid: { color: C.border } },
        x: { ticks: { font: { size: 10 }, maxRotation: 35 }, grid: { display: false } },
      },
    },
  });
}

function renderAtividades(data) {
  const top = topN(data.clients.filter(c => c.num_atividades > 0), 'num_atividades', 15);
  mkChart('chart-atividades', {
    type: 'bar',
    data: {
      labels: top.map(c => truncate(c.nome, 22)),
      datasets: [{
        data: top.map(c => c.num_atividades),
        backgroundColor: C.primaryAlpha(.75),
        borderRadius: 4,
        borderSkipped: false,
      }],
    },
    options: {
      ...horizontalBarOptions('Atividades', v => fmt.int(v)),
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => {
              const c = top[ctx.dataIndex];
              return [`Atividades: ${c.num_atividades}`, `Custo: ${fmt.brl(c.total_custo)}`, `Resultado: ${fmt.brl(c.resultado)}`];
            },
          },
        },
      },
    },
  });
}

function renderCustoAtiv(data) {
  const withAtiv = data.clients.filter(c => c.num_atividades > 0);
  const enriched = withAtiv.map(c => ({ ...c, custo_por_ativ: c.total_custo / c.num_atividades }));
  const top = topN(enriched, 'custo_por_ativ', 15);

  mkChart('chart-custo-ativ', {
    type: 'bar',
    data: {
      labels: top.map(c => truncate(c.nome, 22)),
      datasets: [{
        data: top.map(c => c.custo_por_ativ),
        backgroundColor: top.map(c => c.resultado >= 0 ? C.primaryAlpha(.7) : C.dangerAlpha(.7)),
        borderRadius: 4,
        borderSkipped: false,
      }],
    },
    options: {
      ...horizontalBarOptions('Custo/Atividade', fmt.brl),
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => {
              const c = top[ctx.dataIndex];
              return [`Custo/ativ: ${fmt.brl(c.custo_por_ativ)}`, `Atividades: ${c.num_atividades}`, `Resultado: ${fmt.brl(c.resultado)}`];
            },
          },
        },
      },
    },
  });
}


function renderCustoComp(data) {
  const top = topN(data.clients.filter(c => c.total_custo > 0), 'total_custo', 15);
  mkChart('chart-custo-comp', {
    type: 'bar',
    data: {
      labels: top.map(c => truncate(c.nome, 18)),
      datasets: [
        { label: 'Custo Fixo', data: top.map(c => c.custo_fixo), backgroundColor: C.primaryAlpha(.8), borderRadius: 4, borderSkipped: false },
        { label: 'Custo Operacional', data: top.map(c => c.custo_operacional), backgroundColor: C.dangerAlpha(.7), borderRadius: 4, borderSkipped: false },
      ],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${fmt.brl(ctx.raw)}` } } },
      scales: {
        x: { stacked: true, ticks: { callback: v => fmt.brlShort(v) }, grid: { color: C.border } },
        y: { stacked: true, ticks: { font: { size: 10 } }, grid: { display: false } },
      },
    },
  });
}

function renderHistCustoAtiv(data) {
  const withAtiv = data.clients.filter(c => c.num_atividades > 0);
  const vals = withAtiv.map(c => c.total_custo / c.num_atividades);
  const max = Math.max(...vals);
  const buckets = 10;
  const size = max / buckets;
  const counts = Array(buckets).fill(0);
  vals.forEach(v => {
    const idx = Math.min(Math.floor(v / size), buckets - 1);
    counts[idx]++;
  });
  const labels = counts.map((_, i) => fmt.brlShort(i * size) + '–' + fmt.brlShort((i + 1) * size));

  mkChart('chart-hist-custo-ativ', {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Nº Clientes',
        data: counts,
        backgroundColor: C.primaryAlpha(.7),
        borderRadius: 4,
        borderSkipped: false,
        barPercentage: 0.95,
        categoryPercentage: 0.9,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { ticks: { stepSize: 1, callback: v => v }, grid: { color: C.border } },
        x: { ticks: { font: { size: 10 }, maxRotation: 30 }, grid: { display: false } },
      },
    },
  });
}

// ═══════════════════════════════════════════════════════════════
// TAB: ALERTAS
// ═══════════════════════════════════════════════════════════════
function renderAlertas(data) {
  const clients = data.clients;
  const withCost = clients.filter(c => c.num_atividades > 0);
  const avg_ativ = avgOf(clients, 'num_atividades');
  const avg_custo = avgOf(clients, 'total_custo');
  const withAtivData = clients.filter(c => c.num_atividades > 0);
  const avg_cpa = withAtivData.length ? withAtivData.reduce((s, c) => s + c.total_custo / c.num_atividades, 0) / withAtivData.length : 0;

  const alerts = {
    deficitarios: clients.filter(c => c.resultado < 0).sort((a, b) => a.resultado - b.resultado),
    sem_honorario: clients.filter(c => c.honorario === 0 && c.total_custo > 0).sort((a, b) => b.total_custo - a.total_custo),
    alto_volume: clients.filter(c => c.num_atividades > avg_ativ * 2).sort((a, b) => b.num_atividades - a.num_atividades),
    alto_cpa: withAtivData.filter(c => c.total_custo / c.num_atividades > avg_cpa * 2.5).sort((a, b) => (b.total_custo / b.num_atividades) - (a.total_custo / a.num_atividades)),
    baixa_margem: clients.filter(c => c.honorario > 0 && c.resultado >= 0 && c.percentual < 0.32).sort((a, b) => a.percentual - b.percentual),
    criticos: clients.filter(c => c.resultado < 0 && c.total_custo > avg_custo).sort((a, b) => a.resultado - b.resultado),
    revisao: clients.filter(c => c.honorario === 0 && c.extra > 0 && c.total_custo > 0),
    bons: clients.filter(c => c.resultado > 0 && c.percentual >= 0.32).sort((a, b) => b.percentual - a.percentual),
  };

  // Summary cards
  const cards = $('alert-summary-cards');
  cards.innerHTML = [
    { label: 'Clientes Críticos', value: alerts.criticos.length, cls: 'negative', badge: { cls: 'badge-neg', txt: 'Alta prioridade' } },
    { label: 'Sem Honorário', value: alerts.sem_honorario.length, cls: '', badge: { cls: 'badge-warn', txt: 'Revisar contrato' } },
    { label: 'Baixa Margem', value: alerts.baixa_margem.length, cls: '', badge: { cls: 'badge-warn', txt: '< 32%' } },
    { label: 'Clientes Saudáveis', value: alerts.bons.length, cls: 'positive', badge: { cls: 'badge-pos', txt: 'Margem ≥ 32%' } },
  ].map((c, i) => `
    <div class="card" style="animation-delay:${i * 50}ms">
      <div class="card-label">${c.label}</div>
      <div class="card-value ${c.cls}">${c.value}</div>
      <div class="card-badge ${c.badge.cls}">${c.badge.txt}</div>
    </div>
  `).join('');

  const defs = [
    { key: 'criticos', icon: '🚨', iconCls: 'alert-icon-red', title: 'Clientes Críticos', countCls: '', desc: c => `${fmt.brl(c.resultado)}`, descCls: 'neg', rule: 'Resultado negativo e custo acima da média' },
    { key: 'deficitarios', icon: '📉', iconCls: 'alert-icon-red', title: 'Deficitários', countCls: '', desc: c => `${fmt.brl(c.resultado)}`, descCls: 'neg', rule: 'Resultado menor que zero' },
    { key: 'sem_honorario', icon: '⚠️', iconCls: 'alert-icon-yellow', title: 'Sem Honorário', countCls: 'warn', desc: c => `Custo: ${fmt.brl(c.total_custo)}`, descCls: 'neg', rule: 'Têm custo mas honorário zerado' },
    { key: 'baixa_margem', icon: '⬇️', iconCls: 'alert-icon-yellow', title: 'Baixa Margem', countCls: 'warn', desc: c => `${fmt.pct(c.percentual)}`, descCls: '', rule: 'Margem < 32% (mas positivo)' },
    { key: 'alto_volume', icon: '⏱️', iconCls: 'alert-icon-blue', title: 'Alto Volume Atividades', countCls: 'info', desc: c => `${c.num_atividades} atividades`, descCls: '', rule: '> 2× a média de atividades' },
    { key: 'alto_cpa', icon: '💸', iconCls: 'alert-icon-yellow', title: 'Alto Custo/Atividade', countCls: 'warn', desc: c => `R$${(c.total_custo / c.num_atividades).toFixed(0)}/ativ`, descCls: '', rule: '> 2,5× a média do custo por atividade' },
    { key: 'bons', icon: '✅', iconCls: 'alert-icon-green', title: 'Clientes Saudáveis', countCls: 'ok', desc: c => `${fmt.pct(c.percentual)}`, descCls: '', rule: 'Resultado positivo e margem ≥ 32%' },
    { key: 'revisao', icon: '📋', iconCls: 'alert-icon-blue', title: 'Apenas Extra (sem honorário)', countCls: 'info', desc: c => `Extra: ${fmt.brl(c.extra)}`, descCls: '', rule: 'Têm extra mas honorário zerado' },
  ];

  const grid = $('alert-grid');
  grid.innerHTML = defs.map((def, gi) => {
    const list = alerts[def.key];
    const cnt = list.length;
    const cntCls = cnt === 0 ? 'zero' : def.countCls || '';
    return `
      <div class="alert-card" style="animation-delay:${gi * 60}ms">
        <div class="alert-header">
          <div class="alert-icon ${def.iconCls}">${def.icon}</div>
          <div>
            <div class="alert-title">${def.title}</div>
            <div style="font-size:11px;color:var(--text-muted);margin-top:2px">${def.rule}</div>
          </div>
          <div class="alert-count ${cntCls}">${cnt}</div>
        </div>
        <div class="alert-list">
          ${cnt === 0
            ? '<div class="alert-empty">Nenhum cliente nesta categoria</div>'
            : list.slice(0, 20).map(c => `
                <div class="alert-item" title="${c.nome}">
                  <div class="alert-item-name">${c.nome}</div>
                  <div class="alert-item-val ${def.descCls}">${def.desc(c)}</div>
                </div>
              `).join('')
          }
        </div>
      </div>`;
  }).join('');
}

// ═══════════════════════════════════════════════════════════════
// TAB: ANÁLISE INDIVIDUAL
// ═══════════════════════════════════════════════════════════════
function renderIndividual(data) {
  if (!SS.individual) {
    SS.individual = createSearchSelect('individual-search', (idx) => {
      if (idx === null) {
        hide($('individual-content'));
        show($('individual-empty'));
        $('individual-status').innerHTML = '';
        $('individual-ranks').innerHTML = '';
        return;
      }
      renderClientDetail(currentData(), idx);
    });
  }
  SS.individual.setItems(data.clients);
  show($('individual-empty'));
  hide($('individual-content'));
}

function clientStatus(c, avgCusto) {
  if (c.honorario === 0 && c.total_custo > 0) return { cls: 'status-sem-hon', txt: 'Sem Honorário' };
  if (c.resultado < 0 && c.total_custo > avgCusto) return { cls: 'status-critico', txt: 'Crítico' };
  if (c.resultado < 0) return { cls: 'status-critico', txt: 'Deficitário' };
  if (c.percentual < 0.32 && c.honorario > 0) return { cls: 'status-atencao', txt: 'Atenção — Margem abaixo de 32%' };
  if (c.percentual >= 0.32) return { cls: 'status-saudavel', txt: 'Saudável' };
  return { cls: 'status-atencao', txt: 'Atenção' };
}

function renderDiagnostic(c, all, ctx) {
  const { avgCusto, avgAtiv, avgPct, cpa, rankRes, rankCusto } = ctx;
  const avgHon = avgOf(all.filter(x => x.honorario > 0), 'honorario') || 1;
  const withAtiv = all.filter(x => x.num_atividades > 0);
  const avgCpa = withAtiv.length
    ? withAtiv.reduce((s, x) => s + x.total_custo / x.num_atividades, 0) / withAtiv.length
    : 0;
  const totalClients = all.length;
  const receita = c.honorario + c.extra;

  let status, icon, title, summary;
  const insights = [];
  const actions = [];

  // ---- Classification & narrative ----
  if (c.honorario === 0 && c.total_custo > 0) {
    status = 'sem-hon';
    icon = '⚠️';
    title = 'Cliente sem honorário registrado';
    summary = `Este cliente acumulou <strong>${fmt.brl(c.total_custo)}</strong> em custos e <strong>${c.num_atividades}</strong> atividade${c.num_atividades !== 1 ? 's' : ''} no período, mas <strong>não há honorário fixo registrado</strong>. ${c.extra > 0 ? `Recebeu apenas valores extras de <strong>${fmt.brl(c.extra)}</strong>.` : ''} Resultado: <strong style="color:${c.resultado >= 0 ? 'var(--positive)' : 'var(--danger)'}">${fmt.brl(c.resultado)}</strong>.`;
    insights.push(`Posição <span class="num">#${rankCusto}</span> em custo total (de ${totalClients} clientes)`);
    if (c.num_atividades > 0) insights.push(`Custo por atividade: <span class="num">${fmt.brl(cpa)}</span> — a equipe está alocando tempo sem contrapartida financeira`);
    if (c.extra === 0) insights.push('Nenhuma receita (honorário ou extra) — caso atípico que merece verificação imediata');
    actions.push('Verificar se há contrato vigente e cobrança ativa no sistema');
    actions.push('Confirmar se o serviço está sendo prestado por cortesia, em débito, ou se houve erro de cadastro');
    actions.push('Regularizar a precificação retroativamente, se aplicável');

  } else if (c.resultado < 0 && c.total_custo > avgCusto * 1.5) {
    status = 'critico';
    icon = '🚨';
    title = 'Cliente em situação crítica';
    summary = `Este cliente gera <strong style="color:var(--danger)">prejuízo de ${fmt.brl(c.resultado)}</strong> e tem custo <strong>${(c.total_custo / avgCusto).toFixed(1)}× acima da média</strong> da carteira (${fmt.brl(avgCusto)}). A receita de ${fmt.brl(receita)} é insuficiente para cobrir os custos de ${fmt.brl(c.total_custo)}.`;
    insights.push(`Custo total <span class="num">${fmt.brl(c.total_custo)}</span> representa <strong>${(c.total_custo / avgCusto).toFixed(1)}×</strong> a média da carteira`);
    insights.push(`Honorário de <span class="num">${fmt.brl(c.honorario)}</span> não cobre o custo operacional`);
    if (c.num_atividades > avgAtiv * 1.5) insights.push(`Volume de atividades alto: <span class="num">${c.num_atividades}</span> contra média de <span class="num">${avgAtiv.toFixed(0)}</span>`);
    if (cpa > avgCpa * 2 && c.num_atividades > 0) insights.push(`Custo por atividade muito elevado: <span class="num">${fmt.brl(cpa)}</span> (${(cpa / avgCpa).toFixed(1)}× a média)`);
    insights.push(`Rank <span class="num">#${rankRes}</span> de pior resultado entre ${totalClients} clientes`);
    actions.push('Revisar urgentemente o contrato e a tabela de honorários');
    actions.push('Quantificar o esforço real da equipe e propor reajuste significativo');
    actions.push('Avaliar se o relacionamento estratégico compensa o prejuízo recorrente');
    actions.push('Considerar desligamento se não houver acordo de reajuste');

  } else if (c.resultado < 0) {
    status = 'critico';
    icon = '📉';
    title = 'Cliente deficitário';
    summary = `Cliente com <strong style="color:var(--danger)">prejuízo de ${fmt.brl(c.resultado)}</strong> no período. A receita bruta de <strong>${fmt.brl(receita)}</strong> não foi suficiente para cobrir os custos de <strong>${fmt.brl(c.total_custo)}</strong> ${c.imposto > 0 ? `mais <strong>${fmt.brl(c.imposto)}</strong> de impostos` : ''}.`;
    insights.push(`Margem percentual <span class="num">${fmt.pct(c.percentual)}</span> — negativa`);
    if (c.honorario > 0 && c.honorario < avgHon * 0.7) insights.push(`Honorário abaixo da média: <span class="num">${fmt.brl(c.honorario)}</span> vs <span class="num">${fmt.brl(avgHon)}</span>`);
    if (c.num_atividades > avgAtiv * 1.3) insights.push(`Atividades acima da média: <span class="num">${c.num_atividades}</span> vs <span class="num">${avgAtiv.toFixed(0)}</span>`);
    insights.push(`Rank <span class="num">#${rankRes}</span> em resultado (do pior para o melhor)`);
    actions.push('Identificar a causa raiz do prejuízo: precificação inadequada ou complexidade operacional');
    actions.push('Propor reajuste do honorário no próximo ciclo de revisão');
    actions.push('Monitorar mensalmente até estabilizar em positivo');

  } else if (c.percentual < 0.32 && c.honorario > 0) {
    status = 'atencao';
    icon = '⚠️';
    title = 'Cliente com margem abaixo do saudável';
    summary = `Cliente com resultado positivo de <strong style="color:var(--positive)">${fmt.brl(c.resultado)}</strong>, porém margem de <strong>${fmt.pct(c.percentual)}</strong> — <strong>abaixo do teto saudável de 32%</strong>. Variações de custo ou redução de receita podem levar ao prejuízo.`;
    insights.push(`Margem <span class="num">${fmt.pct(c.percentual)}</span> contra a meta de <strong>32%</strong> (média positiva da carteira: <span class="num">${fmt.pct(avgPct)}</span>)`);
    if (c.total_custo > avgCusto) insights.push(`Custo total <span class="num">${fmt.brl(c.total_custo)}</span> acima da média (${fmt.brl(avgCusto)})`);
    if (c.num_atividades > avgAtiv) insights.push(`Volume de atividades alto: <span class="num">${c.num_atividades}</span>`);

  } else if (c.percentual >= 0.32) {
    status = 'saudavel';
    icon = '✅';
    title = 'Cliente saudável e rentável';
    summary = `Cliente com <strong>margem de ${fmt.pct(c.percentual)}</strong> — atinge ou supera o teto saudável de 32%. Resultado positivo de <strong style="color:var(--positive)">${fmt.brl(c.resultado)}</strong>. Honorário de ${fmt.brl(c.honorario)} cobre confortavelmente os custos de ${fmt.brl(c.total_custo)}.`;
    if (avgPct > 0) insights.push(`Margem <strong>${(c.percentual / avgPct).toFixed(1)}×</strong> a média positiva da carteira (<span class="num">${fmt.pct(avgPct)}</span>)`);
    if (c.total_custo < avgCusto) insights.push(`Custo abaixo da média: <span class="num">${fmt.brl(c.total_custo)}</span> vs <span class="num">${fmt.brl(avgCusto)}</span>`);
    insights.push(`Posição <span class="num">#${rankRes}</span> entre os melhores resultados`);

  } else {
    status = 'atencao';
    icon = '⚠️';
    title = 'Cliente rentável, mas abaixo da meta';
    summary = `Cliente com resultado positivo de <strong style="color:var(--positive)">${fmt.brl(c.resultado)}</strong> e margem de <strong>${fmt.pct(c.percentual)}</strong>, abaixo do teto saudável de 32%.`;
    insights.push(`Margem <span class="num">${fmt.pct(c.percentual)}</span> — positiva, mas abaixo da meta de 32%`);
    if (c.total_custo > avgCusto) insights.push(`Custo <span class="num">${fmt.brl(c.total_custo)}</span> acima da média, mas absorvido pela receita`);
  }

  $('individual-diagnostic').className = 'diagnostic-card status-' + status;
  $('individual-diagnostic').innerHTML = `
    <div class="diagnostic-header">
      <div class="diagnostic-icon">${icon}</div>
      <div class="diagnostic-meta">
        <div class="diagnostic-label">Diagnóstico do Cliente</div>
        <div class="diagnostic-title">${title}</div>
      </div>
    </div>
    <div class="diagnostic-summary">${summary}</div>
    ${insights.length ? `
      <div class="diagnostic-section-title">🔍 Pontos de atenção</div>
      <ul class="diagnostic-list insights">
        ${insights.map(i => `<li>${i}</li>`).join('')}
      </ul>
    ` : ''}
  `;
}

function renderClientDetail(data, idx) {
  const c = data.clients[idx];
  const all = data.clients;
  const avgCusto = avgOf(all, 'total_custo');
  const avgAtiv = avgOf(all, 'num_atividades');
  const avgPct = avgOf(all.filter(x => x.honorario > 0), 'percentual');
  const cpa = c.num_atividades > 0 ? c.total_custo / c.num_atividades : 0;
  const avgCpa = avgOf(all.filter(x => x.num_atividades > 0), 'custo_por_ativ' in c ? 'custo_por_ativ' : 'total_custo');

  // Ranks
  const byRes = sortedBy(all, 'resultado');
  const byCusto = sortedBy(all, 'total_custo');
  const rankRes = byRes.findIndex(x => x.nome === c.nome) + 1;
  const rankCusto = byCusto.findIndex(x => x.nome === c.nome) + 1;

  const status = clientStatus(c, avgCusto);
  $('individual-status').innerHTML = `<div class="client-status ${status.cls}">${status.txt}</div>`;
  $('individual-ranks').innerHTML = `Rank Resultado #${rankRes} · Rank Custo #${rankCusto} de ${all.length} clientes`;

  // Cards
  const cards = $('individual-cards');
  const cardData = [
    { label: 'Honorário', value: fmt.brl(c.honorario), cls: 'primary' },
    { label: 'Extra', value: fmt.brl(c.extra), cls: '' },
    { label: 'Impostos', value: fmt.brl(c.imposto), cls: '' },
    { label: 'Custo Fixo', value: fmt.brl(c.custo_fixo), cls: '' },
    { label: 'Custo Operacional', value: fmt.brl(c.custo_operacional), cls: '' },
    { label: 'Custo Total', value: fmt.brl(c.total_custo), cls: '' },
    { label: 'Vlr Comissão', value: fmt.brl(c.margem_col), cls: '' },
    { label: 'Resultado', value: fmt.brl(c.resultado), cls: c.resultado >= 0 ? 'positive' : 'negative' },
    { label: 'Margem %', value: fmt.pct(c.percentual), cls: c.percentual >= 0.32 ? 'positive' : c.percentual >= 0 ? '' : 'negative' },
    { label: 'Comissão %', value: fmt.pct(c.margem_pct || 0), cls: '' },
    { label: 'Nº Atividades', value: fmt.int(c.num_atividades), cls: 'primary' },
    { label: 'Custo/Atividade', value: c.num_atividades > 0 ? fmt.brl(cpa) : '—', cls: '' },
    { label: 'Rank Resultado', value: `#${rankRes}`, cls: '' },
    { label: 'Rank Custo', value: `#${rankCusto}`, cls: '' },
  ];

  cards.innerHTML = cardData.map((cd, i) => `
    <div class="card card-sm" style="animation-delay:${i * 30}ms">
      <div class="card-label">${cd.label}</div>
      <div class="card-value ${cd.cls}">${cd.value}</div>
    </div>`).join('');

  // Diagnostic written analysis
  renderDiagnostic(c, all, { avgCusto, avgAtiv, avgPct, cpa, rankRes, rankCusto });

  // Comparison vs portfolio average (didactic — actual R$ values)
  const avgHonAll = avgOf(all, 'honorario');
  const avgRes = avgOf(all, 'resultado');
  const cmpData = [
    { label: 'Honorário',       cliente: c.honorario,     media: avgHonAll },
    { label: 'Custo Total',     cliente: c.total_custo,   media: avgCusto },
    { label: 'Resultado',       cliente: c.resultado,     media: avgRes },
    { label: 'Atividades',      cliente: c.num_atividades, media: avgAtiv, isCount: true },
  ];

  mkChart('chart-individual-compare', {
    type: 'bar',
    data: {
      labels: cmpData.map(d => d.label),
      datasets: [
        {
          label: 'Este cliente',
          data: cmpData.map(d => d.cliente),
          backgroundColor: cmpData.map(d => d.cliente >= 0 ? C.primaryAlpha(.85) : C.dangerAlpha(.85)),
          borderRadius: 4, borderSkipped: false,
        },
        {
          label: 'Média da carteira',
          data: cmpData.map(d => d.media),
          backgroundColor: C.muted + '99',
          borderRadius: 4, borderSkipped: false,
        },
      ],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom' },
        tooltip: {
          callbacks: {
            label: ctx => {
              const row = cmpData[ctx.dataIndex];
              const v = ctx.raw;
              return ` ${ctx.dataset.label}: ${row.isCount ? fmt.int(v) : fmt.brl(v)}`;
            },
          },
        },
      },
      scales: {
        x: { ticks: { callback: v => fmt.brlShort(v) }, grid: { color: C.border } },
        y: { ticks: { font: { size: 12 } }, grid: { display: false } },
      },
    },
  });

  // Composition bar
  mkChart('chart-individual-bar', {
    type: 'bar',
    data: {
      labels: ['Honorário', 'Extra', 'Imposto', 'Custo Total', 'Resultado'],
      datasets: [{
        data: [c.honorario, c.extra, -c.imposto, -c.total_custo, c.resultado],
        backgroundColor: [C.primaryAlpha(.8), C.primaryAlpha(.5), C.dangerAlpha(.5), C.dangerAlpha(.7), c.resultado >= 0 ? C.positiveAlpha(.8) : C.dangerAlpha(.9)],
        borderRadius: 6,
        borderSkipped: false,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ` ${fmt.brl(ctx.raw)}` } } },
      scales: {
        y: { ticks: { callback: v => fmt.brlShort(v) }, grid: { color: C.border } },
        x: { grid: { display: false } },
      },
    },
  });

  // Position in ranking
  const top20custo = topN(all, 'total_custo', 20);
  const top20res = topN(all, 'resultado', 20);
  const allByRes = sortedBy(all, 'resultado');
  const highlighted = allByRes.slice(0, 10);
  const thisInTop10 = highlighted.findIndex(x => x.nome === c.nome);

  mkChart('chart-individual-ranking', {
    type: 'bar',
    data: {
      labels: top20res.map(x => truncate(x.nome, 20)),
      datasets: [{
        label: 'Resultado',
        data: top20res.map(x => x.resultado),
        backgroundColor: top20res.map(x => x.nome === c.nome ? C.primary : x.resultado >= 0 ? C.positiveAlpha(.5) : C.dangerAlpha(.5)),
        borderColor: top20res.map(x => x.nome === c.nome ? C.primary : 'transparent'),
        borderWidth: top20res.map(x => x.nome === c.nome ? 2 : 0),
        borderRadius: 4,
        borderSkipped: false,
      }],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ` ${fmt.brl(ctx.raw)}` } } },
      scales: {
        x: { ticks: { callback: v => fmt.brlShort(v) }, grid: { color: C.border } },
        y: { ticks: { font: { size: 10 } }, grid: { display: false } },
      },
    },
  });

  hide($('individual-empty'));
  show($('individual-content'));
}

// ═══════════════════════════════════════════════════════════════
// TAB: COMPARATIVO MENSAL
// ═══════════════════════════════════════════════════════════════
function getUnifiedClientList() {
  // Build deduped client list across all loaded months, keyed by doc (CNPJ/CPF) or nome
  const map = new Map();
  Object.values(S.months).forEach(month => {
    month.clients.forEach(c => {
      const key = c.doc || c.nome;
      if (!map.has(key)) map.set(key, { nome: c.nome, doc: c.doc, codigo: c.codigo });
    });
  });
  return Array.from(map.values()).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

function findClientInMonth(monthKey, ref) {
  const month = S.months[monthKey];
  if (!month) return null;
  return month.clients.find(c => (ref.doc && c.doc === ref.doc) || c.nome === ref.nome) || null;
}

function buildClientSummary(c) {
  if (!c) {
    return { honorarios_totais: 0, extras_totais: 0, receita_bruta: 0, impostos: 0, custo_total: 0, resultado_final: 0, margem_pct: 0, num_atividades: 0, custo_medio_atividade: 0, clientes_positivos: 0, clientes_negativos: 0 };
  }
  const receita = c.honorario + c.extra;
  return {
    honorarios_totais: c.honorario,
    extras_totais: c.extra,
    receita_bruta: receita,
    impostos: c.imposto,
    custo_total: c.total_custo,
    resultado_final: c.resultado,
    margem_pct: c.percentual,
    num_atividades: c.num_atividades,
    custo_medio_atividade: c.num_atividades > 0 ? c.total_custo / c.num_atividades : 0,
    clientes_positivos: c.resultado > 0 ? 1 : 0,
    clientes_negativos: c.resultado < 0 ? 1 : 0,
  };
}

// ═══════════════════════════════════════════════════════════════
// GRUPOS
// ═══════════════════════════════════════════════════════════════
function normCnpj(s) { return (s || '').toString().replace(/\D/g, ''); }
function formatCnpj(s) {
  const d = normCnpj(s);
  return d.length === 14 ? d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5') : (d || '—');
}

async function loadGroups() {
  try {
    const res = await fetch('/api/groups');
    S.groups = await res.json();
  } catch {
    S.groups = {};
  }
}

function aggregateGroup(clients) {
  return clients.reduce((a, c) => ({
    honorario: a.honorario + (c.honorario || 0),
    extra: a.extra + (c.extra || 0),
    imposto: a.imposto + (c.imposto || 0),
    total_custo: a.total_custo + (c.total_custo || 0),
    margem_col: a.margem_col + (c.margem_col || 0),
    resultado: a.resultado + (c.resultado || 0),
    num_atividades: a.num_atividades + (c.num_atividades || 0),
    count: a.count + 1,
    positivas: a.positivas + (c.resultado > 0 ? 1 : 0),
    negativas: a.negativas + (c.resultado < 0 ? 1 : 0),
  }), { honorario:0, extra:0, imposto:0, total_custo:0, margem_col:0, resultado:0, num_atividades:0, count:0, positivas:0, negativas:0 });
}

function getGroupClients(data, groupName) {
  if (!data || !S.groups || !S.groups[groupName]) return [];
  const cnpjs = new Set(S.groups[groupName].map(e => e.cnpj));
  return data.clients.filter(c => cnpjs.has(normCnpj(c.doc)));
}

function renderGrupos() {
  if (!S.groups) {
    loadGroups().then(() => renderGrupos());
    return;
  }
  const data = currentData();
  const names = Object.keys(S.groups);

  // Nenhum grupo cadastrado → empty state
  if (!names.length) {
    show($('grupos-empty'));
    hide($('grupos-overview'));
    hide($('grupos-detail'));
    return;
  }
  hide($('grupos-empty'));

  // Popula o select (uma vez por carga de grupos)
  const sel = $('grupos-select');
  if (sel.options.length <= 1) {
    names.sort().forEach(g => {
      const opt = document.createElement('option');
      opt.value = g;
      opt.textContent = `${g} (${S.groups[g].length})`;
      sel.appendChild(opt);
    });
  }

  if (sel.value) {
    hide($('grupos-overview'));
    show($('grupos-detail'));
    renderGruposDetail(data, sel.value);
  } else {
    hide($('grupos-detail'));
    show($('grupos-overview'));
    renderGruposOverview(data);
  }
}

function renderGruposOverview(data) {
  const container = $('grupos-overview');
  if (!data) {
    container.innerHTML = '<p class="grupos-empty-desc" style="text-align:center;padding:40px">Carregue um mês para ver a análise por grupo.</p>';
    return;
  }

  const rows = Object.keys(S.groups).map(g => {
    const cls = getGroupClients(data, g);
    const agg = aggregateGroup(cls);
    const pct = agg.honorario > 0 ? agg.resultado / agg.honorario : 0;
    return { grupo: g, cadastradas: S.groups[g].length, ...agg, pct };
  }).sort((a, b) => b.resultado - a.resultado);

  const tot = rows.reduce((a, r) => ({
    receita: a.receita + r.honorario + r.extra,
    custo: a.custo + r.total_custo,
    resultado: a.resultado + r.resultado,
    empresas: a.empresas + r.count,
  }), { receita:0, custo:0, resultado:0, empresas:0 });

  const grupCount = rows.length;
  const positivos = rows.filter(r => r.resultado > 0).length;
  const negativos = rows.filter(r => r.resultado < 0).length;

  const cards = [
    { label: 'Grupos', value: fmt.int(grupCount), cls: 'primary', sub: `${tot.empresas} empresas com movimento` },
    { label: 'Receita Bruta', value: fmt.brl(tot.receita), cls: 'primary', sub: 'Honorário + Extra' },
    { label: 'Custo Total', value: fmt.brl(tot.custo), cls: '', sub: '' },
    { label: 'Resultado', value: fmt.brl(tot.resultado), cls: tot.resultado >= 0 ? 'positive' : 'negative', sub: tot.resultado >= 0 ? '✓ Lucro' : '✗ Prejuízo' },
    { label: 'Grupos com Lucro', value: fmt.int(positivos), cls: 'positive', sub: `${fmt.pct(positivos / (grupCount || 1))} dos grupos` },
    { label: 'Grupos com Prejuízo', value: fmt.int(negativos), cls: 'negative', sub: `${fmt.pct(negativos / (grupCount || 1))} dos grupos` },
  ];

  container.innerHTML = `
    <div class="cards-grid">
      ${cards.map((c, i) => `
        <div class="card" style="animation-delay:${i*30}ms">
          <div class="card-label">${c.label}</div>
          <div class="card-value ${c.cls}">${c.value}</div>
          <div class="card-sub">${c.sub}</div>
        </div>`).join('')}
    </div>
    <div class="chart-card chart-full" style="margin-top:24px">
      <div class="chart-card-header">
        <div class="chart-card-title">Ranking de Grupos — ${fmt.monthLabel(S.currentMonth)}</div>
        <div class="chart-card-sub">Clique em um grupo para ver detalhes</div>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Grupo</th>
              <th class="num">Empresas</th>
              <th class="num">Honorário</th>
              <th class="num">Extra</th>
              <th class="num">Custo</th>
              <th class="num">Comissão</th>
              <th class="num">Resultado</th>
              <th class="num">Margem %</th>
              <th class="num">Ativ.</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(r => `
              <tr class="clickable" data-group="${escapeHtml(r.grupo)}">
                <td><strong>${escapeHtml(r.grupo)}</strong></td>
                <td class="num">${r.count} <span class="muted">/ ${r.cadastradas}</span></td>
                <td class="num">${fmt.brl(r.honorario)}</td>
                <td class="num">${fmt.brl(r.extra)}</td>
                <td class="num">${fmt.brl(r.total_custo)}</td>
                <td class="num">${fmt.brl(r.margem_col)}</td>
                <td class="num ${r.resultado >= 0 ? 'pos-val' : 'neg-val'}">${fmt.brl(r.resultado)}</td>
                <td class="num"><span class="pill ${r.pct >= 0.32 ? 'pos' : r.pct >= 0 ? 'warn' : 'neg'}">${fmt.pct(r.pct)}</span></td>
                <td class="num">${fmt.int(r.num_atividades)}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;

  container.querySelectorAll('tr.clickable').forEach(tr => {
    tr.addEventListener('click', () => {
      $('grupos-select').value = tr.dataset.group;
      renderGrupos();
    });
  });
}

function renderGruposDetail(data, groupName) {
  const container = $('grupos-detail');
  const empresas = S.groups[groupName] || [];

  if (!data) {
    container.innerHTML = '<p class="grupos-empty-desc" style="text-align:center;padding:40px">Carregue um mês para ver os detalhes.</p>';
    return;
  }

  const clients = getGroupClients(data, groupName);
  const agg = aggregateGroup(clients);
  const receita = agg.honorario + agg.extra;
  const pct = agg.honorario > 0 ? agg.resultado / agg.honorario : 0;
  const cpa = agg.num_atividades > 0 ? agg.total_custo / agg.num_atividades : 0;
  const comissaoPct = agg.honorario > 0 ? agg.margem_col / agg.honorario : 0;
  const matched = new Set(clients.map(c => normCnpj(c.doc)));

  const cards = [
    { label: 'Empresas no Grupo', value: fmt.int(empresas.length), cls: 'primary', sub: `${clients.length} com movimento no mês` },
    { label: 'Honorário Total', value: fmt.brl(agg.honorario), cls: 'primary', sub: '' },
    { label: 'Extra Total', value: fmt.brl(agg.extra), cls: '', sub: '' },
    { label: 'Receita Bruta', value: fmt.brl(receita), cls: 'primary', sub: 'Honorário + Extra' },
    { label: 'Custo Total', value: fmt.brl(agg.total_custo), cls: '', sub: '' },
    { label: 'Comissão', value: fmt.brl(agg.margem_col), cls: '', sub: agg.honorario > 0 ? `${fmt.pct(comissaoPct)} do honorário` : '' },
    { label: 'Imposto', value: fmt.brl(agg.imposto), cls: '', sub: '' },
    { label: 'Resultado Final', value: fmt.brl(agg.resultado), cls: agg.resultado >= 0 ? 'positive' : 'negative', sub: agg.resultado >= 0 ? '✓ Grupo com lucro' : '✗ Grupo com prejuízo' },
    { label: 'Margem %', value: fmt.pct(pct), cls: pct >= 0.32 ? 'positive' : pct >= 0 ? '' : 'negative', sub: 'Resultado / Honorários · meta ≥ 32%' },
    { label: 'Atividades', value: fmt.int(agg.num_atividades), cls: 'primary', sub: '' },
    { label: 'Custo/Atividade', value: agg.num_atividades > 0 ? fmt.brl(cpa) : '—', cls: '', sub: '' },
    { label: 'Positivas / Negativas', value: `${agg.positivas} / ${agg.negativas}`, cls: '', sub: 'Empresas no mês' },
  ];

  const rows = empresas.map(e => {
    const c = clients.find(cl => normCnpj(cl.doc) === e.cnpj);
    return { ...e, client: c };
  }).sort((a, b) => (b.client?.resultado ?? -Infinity) - (a.client?.resultado ?? -Infinity));

  container.innerHTML = `
    <div class="cards-grid">
      ${cards.map((c, i) => `
        <div class="card" style="animation-delay:${i*30}ms">
          <div class="card-label">${c.label}</div>
          <div class="card-value ${c.cls}">${c.value}</div>
          <div class="card-sub">${c.sub}</div>
        </div>`).join('')}
    </div>
    <div class="chart-card chart-full" style="margin-top:24px">
      <div class="chart-card-header">
        <div class="chart-card-title">Empresas do ${escapeHtml(groupName)}</div>
        <div class="chart-card-sub">${clients.length} de ${empresas.length} empresas com movimento em ${fmt.monthLabel(S.currentMonth)}</div>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Empresa</th>
              <th>CNPJ</th>
              <th>Cidade</th>
              <th class="num">Honorário</th>
              <th class="num">Custo</th>
              <th class="num">Comissão</th>
              <th class="num">Resultado</th>
              <th class="num">Margem %</th>
              <th class="num">Ativ.</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(r => {
              const c = r.client;
              if (!c) return `
                <tr>
                  <td><span class="muted">${escapeHtml(r.empresa)}</span></td>
                  <td class="muted">${escapeHtml(formatCnpj(r.cnpj))}</td>
                  <td class="muted">${escapeHtml(r.cidade || '—')}</td>
                  <td colspan="6" class="muted">sem movimento no mês</td>
                </tr>`;
              return `
                <tr>
                  <td>${escapeHtml(c.nome)}</td>
                  <td class="muted">${escapeHtml(formatCnpj(r.cnpj))}</td>
                  <td class="muted">${escapeHtml(r.cidade || '—')}</td>
                  <td class="num">${fmt.brl(c.honorario)}</td>
                  <td class="num">${fmt.brl(c.total_custo)}</td>
                  <td class="num">${fmt.brl(c.margem_col)}</td>
                  <td class="num ${c.resultado >= 0 ? 'pos-val' : 'neg-val'}">${fmt.brl(c.resultado)}</td>
                  <td class="num"><span class="pill ${c.percentual >= 0.32 ? 'pos' : c.percentual >= 0 ? 'warn' : 'neg'}">${fmt.pct(c.percentual)}</span></td>
                  <td class="num">${c.num_atividades}</td>
                </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

function setupGrupos() {
  const openModal = () => $('grupos-upload-modal').classList.add('open');
  const closeModal = () => $('grupos-upload-modal').classList.remove('open');

  $('grupos-import-btn').addEventListener('click', openModal);
  $('grupos-empty-btn').addEventListener('click', openModal);
  $('grupos-modal-cancel').addEventListener('click', closeModal);
  $('grupos-upload-modal').addEventListener('click', e => {
    if (e.target.id === 'grupos-upload-modal') closeModal();
  });

  let fileObj = null;
  const drop = $('grupos-file-drop');
  const input = $('grupos-file-input');
  const setFile = f => {
    fileObj = f;
    $('grupos-file-text').textContent = f.name;
    $('grupos-file-sub').textContent = (f.size / 1024).toFixed(0) + ' KB';
    drop.classList.add('has-file');
  };
  drop.addEventListener('click', () => input.click());
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', e => {
    e.preventDefault();
    drop.classList.remove('over');
    if (e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]);
  });
  input.addEventListener('change', () => { if (input.files[0]) setFile(input.files[0]); });

  $('grupos-upload-form').addEventListener('submit', async e => {
    e.preventDefault();
    if (!fileObj) return showError('grupos-upload-error', 'Selecione um arquivo.');
    const btn = $('grupos-modal-submit');
    btn.classList.add('btn-loading');
    btn.disabled = true;
    hide($('grupos-upload-error'));
    const fd = new FormData();
    fd.append('file', fileObj);
    try {
      const res = await fetch('/api/groups/upload', { method: 'POST', body: fd });
      const json = await res.json();
      if (!res.ok || json.error) return showError('grupos-upload-error', json.error || 'Erro');
      closeModal();
      fileObj = null;
      $('grupos-file-text').textContent = 'Clique para selecionar';
      $('grupos-file-sub').textContent = 'colunas: GRUPO - EMPRESA · CNPJ · CIDADE';
      drop.classList.remove('has-file');
      input.value = '';
      S.groups = null;
      $('grupos-select').innerHTML = '<option value="">Todos os grupos (visão geral)</option>';
      renderGrupos();
    } catch (err) {
      showError('grupos-upload-error', 'Erro: ' + err.message);
    } finally {
      btn.classList.remove('btn-loading');
      btn.disabled = false;
    }
  });

  $('grupos-select').addEventListener('change', () => renderGrupos());
}

function renderComparativo() {
  const container = $('compare-content');
  const headerEl = $('compare-header');
  const keys = Object.keys(S.months).sort();

  if (keys.length < 2) {
    headerEl.style.display = 'none';
    container.innerHTML = `
      <div class="chart-card">
        <div class="compare-empty">
          <div class="compare-empty-icon">📊</div>
          <div class="compare-empty-title">Adicione mais meses</div>
          <div class="compare-empty-desc">Para ver o comparativo mensal, carregue planilhas de pelo menos 2 meses diferentes usando o botão "+ Mês" no topo.</div>
        </div>
      </div>`;
    return;
  }

  // Show header + setup if needed
  headerEl.style.display = 'flex';
  setupCompareHeader();

  // Decide if we render by carteira or by individual client
  const byClient = S.compareMode === 'cliente' && S.compareClient;
  $('compare-title').textContent = byClient
    ? `Comparativo Mensal — ${S.compareClient.nome}`
    : 'Comparativo Mensal — Carteira Inteira';

  if (S.compareMode === 'cliente' && !S.compareClient) {
    container.innerHTML = `
      <div class="chart-card">
        <div class="compare-empty">
          <div class="compare-empty-icon">🔎</div>
          <div class="compare-empty-title">Selecione um cliente</div>
          <div class="compare-empty-desc">Use o campo de busca acima para escolher uma empresa e ver sua evolução mês a mês.</div>
        </div>
      </div>`;
    return;
  }

  // Build summaries — either aggregated or per-client across months
  const summaries = keys.map(k => {
    if (byClient) {
      const c = findClientInMonth(k, S.compareClient);
      return { key: k, label: fmt.monthLabel(k), present: !!c, ...buildClientSummary(c) };
    }
    return { key: k, label: fmt.monthLabel(k), present: true, ...S.months[k].summary };
  });

  // Banner with context info
  let banner = '';
  if (byClient) {
    const monthsPresent = summaries.filter(s => s.present).length;
    const totalRes = summaries.reduce((s, x) => s + (x.present ? x.resultado_final : 0), 0);
    banner = `<div class="compare-context-banner">
      <strong>${S.compareClient.nome}</strong>${S.compareClient.doc ? ` <span class="text-muted">(${S.compareClient.doc})</span>` : ''} —
      presente em <strong>${monthsPresent}</strong> de <strong>${keys.length}</strong> meses · Resultado acumulado:
      <strong style="color:${totalRes >= 0 ? 'var(--positive)' : 'var(--danger)'}">${fmt.brl(totalRes)}</strong>
    </div>`;
  }

  const posNegSection = byClient ? '' : `
    <div class="chart-card">
      <div class="chart-card-header"><div class="chart-card-title">Clientes Positivos vs Negativos</div></div>
      <div class="chart-wrap" style="height:280px"><canvas id="cmp-pos-neg"></canvas></div>
    </div>`;

  container.innerHTML = banner + `
    <div class="charts-grid" style="margin-bottom:24px">
      <div class="chart-card chart-full">
        <div class="chart-card-header"><div class="chart-card-title">Resultado ${byClient ? 'do Cliente' : 'Final'} por Mês</div></div>
        <div class="chart-wrap" style="height:280px"><canvas id="cmp-resultado"></canvas></div>
      </div>
    </div>
    <div class="charts-grid">
      <div class="chart-card">
        <div class="chart-card-header"><div class="chart-card-title">Receita vs Custo</div></div>
        <div class="chart-wrap" style="height:280px"><canvas id="cmp-receita-custo"></canvas></div>
      </div>
      <div class="chart-card">
        <div class="chart-card-header"><div class="chart-card-title">Margem % por Mês</div></div>
        <div class="chart-wrap" style="height:280px"><canvas id="cmp-margem"></canvas></div>
      </div>
    </div>
    <div class="charts-grid">
      <div class="chart-card">
        <div class="chart-card-header"><div class="chart-card-title">Honorário${byClient ? '' : 's'} vs Extra${byClient ? '' : 's'}</div></div>
        <div class="chart-wrap" style="height:280px"><canvas id="cmp-hon-extra"></canvas></div>
      </div>
      ${posNegSection || `
      <div class="chart-card">
        <div class="chart-card-header"><div class="chart-card-title">Nº de Atividades</div></div>
        <div class="chart-wrap" style="height:280px"><canvas id="cmp-atividades-side"></canvas></div>
      </div>`}
    </div>
    ${byClient ? '' : `
    <div class="charts-grid">
      <div class="chart-card">
        <div class="chart-card-header"><div class="chart-card-title">Nº de Atividades</div></div>
        <div class="chart-wrap" style="height:280px"><canvas id="cmp-atividades"></canvas></div>
      </div>
      <div class="chart-card">
        <div class="chart-card-header"><div class="chart-card-title">Custo Médio por Atividade</div></div>
        <div class="chart-wrap" style="height:280px"><canvas id="cmp-cpa"></canvas></div>
      </div>
    </div>`}`;

  // Delay to let DOM settle
  requestAnimationFrame(() => {
    const labels = summaries.map(s => s.label);
    const lineOpts = (label, color, fmt2) => ({
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ` ${fmt2(ctx.raw)}` } } },
      scales: {
        y: { ticks: { callback: v => fmt2(v) }, grid: { color: C.border } },
        x: { grid: { display: false } },
      },
    });

    mkChart('cmp-resultado', {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          data: summaries.map(s => s.resultado_final),
          backgroundColor: summaries.map(s => s.resultado_final >= 0 ? C.positiveAlpha(.8) : C.dangerAlpha(.8)),
          borderRadius: 6, borderSkipped: false,
        }],
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ` ${fmt.brl(ctx.raw)}` } } }, scales: { y: { ticks: { callback: v => fmt.brlShort(v) }, grid: { color: C.border } }, x: { grid: { display: false } } } },
    });

    mkChart('cmp-receita-custo', {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: 'Receita Bruta', data: summaries.map(s => s.receita_bruta), borderColor: C.primary, backgroundColor: C.primaryAlpha(.08), fill: true, tension: 0.3, pointRadius: 5, borderWidth: 2 },
          { label: 'Custo Total', data: summaries.map(s => s.custo_total), borderColor: C.danger, backgroundColor: C.dangerAlpha(.05), fill: false, tension: 0.3, pointRadius: 5, borderWidth: 2 },
        ],
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${fmt.brl(ctx.raw)}` } } }, scales: { y: { ticks: { callback: v => fmt.brlShort(v) }, grid: { color: C.border } }, x: { grid: { display: false } } } },
    });

    mkChart('cmp-margem', {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Margem %',
          data: summaries.map(s => s.margem_pct * 100),
          borderColor: summaries.every(s => s.margem_pct >= 0) ? C.positive : C.danger,
          backgroundColor: C.positiveAlpha(.08),
          fill: true, tension: 0.3, pointRadius: 5, borderWidth: 2,
          pointBackgroundColor: summaries.map(s => s.margem_pct >= 0 ? C.positive : C.danger),
        }],
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ` ${ctx.raw.toFixed(1)}%` } } }, scales: { y: { ticks: { callback: v => v.toFixed(1) + '%' }, grid: { color: C.border } }, x: { grid: { display: false } } } },
    });

    mkChart('cmp-hon-extra', {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'Honorários', data: summaries.map(s => s.honorarios_totais), backgroundColor: C.primaryAlpha(.8), borderRadius: 4, borderSkipped: false },
          { label: 'Extras', data: summaries.map(s => s.extras_totais), backgroundColor: C.dangerAlpha(.7), borderRadius: 4, borderSkipped: false },
        ],
      },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${fmt.brl(ctx.raw)}` } } }, scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, ticks: { callback: v => fmt.brlShort(v) }, grid: { color: C.border } } } },
    });

    if (!byClient) {
      mkChart('cmp-pos-neg', {
        type: 'bar',
        data: {
          labels,
          datasets: [
            { label: 'Positivos', data: summaries.map(s => s.clientes_positivos), backgroundColor: C.positiveAlpha(.8), borderRadius: 4, borderSkipped: false },
            { label: 'Negativos', data: summaries.map(s => s.clientes_negativos), backgroundColor: C.dangerAlpha(.7), borderRadius: 4, borderSkipped: false },
          ],
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } }, scales: { x: { stacked: false, grid: { display: false } }, y: { ticks: { stepSize: 5 }, grid: { color: C.border } } } },
      });

      mkChart('cmp-atividades', {
        type: 'bar',
        data: {
          labels,
          datasets: [{ data: summaries.map(s => s.num_atividades), backgroundColor: C.primaryAlpha(.75), borderRadius: 4, borderSkipped: false }],
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ` ${fmt.int(ctx.raw)} atividades` } } }, scales: { y: { ticks: { callback: v => fmt.int(v) }, grid: { color: C.border } }, x: { grid: { display: false } } } },
      });

      mkChart('cmp-cpa', {
        type: 'line',
        data: {
          labels,
          datasets: [{ data: summaries.map(s => s.custo_medio_atividade), borderColor: C.warning, backgroundColor: C.warningAlpha(.08), fill: true, tension: 0.3, pointRadius: 5, borderWidth: 2 }],
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ` ${fmt.brl(ctx.raw)}` } } }, scales: { y: { ticks: { callback: v => fmt.brlShort(v) }, grid: { color: C.border } }, x: { grid: { display: false } } } },
      });
    } else {
      // For individual client: show activities chart instead of pos-neg
      mkChart('cmp-atividades-side', {
        type: 'bar',
        data: {
          labels,
          datasets: [{ data: summaries.map(s => s.num_atividades), backgroundColor: C.primaryAlpha(.75), borderRadius: 4, borderSkipped: false }],
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ` ${fmt.int(ctx.raw)} atividades` } } }, scales: { y: { ticks: { callback: v => fmt.int(v) }, grid: { color: C.border } }, x: { grid: { display: false } } } },
      });
    }
  });
}

function setupCompareHeader() {
  // Idempotent setup — only attach listeners once
  if ($('compare-header').dataset.wired === '1') {
    // Just refresh client list if more months were loaded
    if (SS.compare) SS.compare.setItems(getUnifiedClientList());
    return;
  }
  $('compare-header').dataset.wired = '1';

  // Mode buttons
  document.querySelectorAll('.compare-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.compare-mode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      S.compareMode = btn.dataset.mode;
      $('compare-client-search').style.display = S.compareMode === 'cliente' ? '' : 'none';
      if (S.compareMode === 'carteira') S.compareClient = null;
      renderComparativo();
    });
  });

  // Searchable client selector for comparativo
  SS.compare = createSearchSelect('compare-client-search', (idx, item) => {
    S.compareClient = item;
    renderComparativo();
  });
  SS.compare.setItems(getUnifiedClientList());
}

// ── Shared chart option factories ────────────────────────────
function horizontalBarOptions(metricLabel, fmtFn) {
  return {
    indexAxis: 'y',
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: { callbacks: { label: ctx => ` ${metricLabel}: ${fmtFn(ctx.raw)}` } },
    },
    scales: {
      x: { ticks: { callback: v => fmtFn(v) }, grid: { color: C.border } },
      y: { ticks: { font: { size: 11 } }, grid: { display: false } },
    },
  };
}

function truncate(str, len) {
  return str.length > len ? str.slice(0, len - 1) + '…' : str;
}

// ═══════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════
async function loadPersistedMonths() {
  try {
    const res = await fetch('/api/all');
    const all = await res.json();
    const keys = Object.keys(all).sort();
    if (!keys.length) {
      showEmptyState();
      return;
    }
    S.months = all;
    showDashboard(keys[keys.length - 1]);  // open on most recent
  } catch (err) {
    console.error('Falha ao carregar meses persistidos:', err);
    showEmptyState();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  setupNoDataCTA();
  setupTabs();
  setupViewMode();
  setupAddMonth();
  setupGrupos();
  loadPersistedMonths();
});
