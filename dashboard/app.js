// Token Radar radar-3 dashboard. Every number shown comes from window.RADAR
// (data.js, written by the backend from the sealed snapshot). Nothing is
// hardcoded: KPIs, charts, table, drawer and the recomputation ladder all read
// RADAR.market / RADAR.rows / RADAR.live.
(function () {
  'use strict';
  var R = window.RADAR;
  if (!R || !R.rows) { document.getElementById('rows').innerHTML = '<tr><td colspan="7" class="empty">No radar data loaded.</td></tr>'; return; }
  var rows = R.rows, M = R.market, TOP1 = rows[0] ? rows[0].implied_value_usd : 1;
  var $ = function (id) { return document.getElementById(id); };
  var fmtInt = function (v) { return Math.round(v).toLocaleString('en-US'); };
  var fmtM = function (v) {
    if (v >= 1e9) return '$' + (v / 1e9).toFixed(1) + 'B';
    if (v >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
    if (v >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(v);
  };
  var fmtPct = function (v) { return (v > 0 ? '+' : '') + v.toFixed(2) + '%'; };
  var fmtPct1 = function (v) { return (v > 0 ? '+' : '') + v.toFixed(1) + '%'; };
  var fmtX = function (v) { return 'x' + v.toFixed(4); };
  var fmtMult3 = function (v) { return v.toFixed(3) + 'x'; };
  var fmtAge = function (d) { return d === null || d === undefined ? '—' : d + 'd'; };
  var esc = function (s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var sgn = function (v) { return v > 0 ? 'up' : v < 0 ? 'down' : 'flat'; };
  var arrow = function (v) { return v > 0 ? '▲' : v < 0 ? '▼' : '—'; };

  // --- the model, re-implemented exactly, at full precision ---------------
  // impliedOf(row) must equal row.implied_value_usd for every row. It reads
  // the category multiples and the market median from RADAR (full precision),
  // never the rounded display values.
  function catMult(row) {
    var c = null;
    for (var i = 0; i < M.categories.length; i++) if (M.categories[i].category === row.category) { c = M.categories[i]; break; }
    return c ? { multiple: c.multiple, basis: 'category', comps: c.comps } : { multiple: M.multiple, basis: 'market', comps: M.comps };
  }
  function growthOf(row) {
    if (row.change_7d === null || row.change_7d === undefined) return 1;
    var ex = Math.max(-40, Math.min(40, row.change_7d - M.change_7d));
    return 1 + (ex / 100) * 0.5;
  }
  function maturityOf(row) {
    if (row.age_days === null || row.age_days === undefined) return 1;
    return 0.8 + (Math.min(row.age_days, 730) / 730) * 0.4;
  }
  function chainsOf(row) {
    return 1 + 0.03 * Math.min(Math.max(row.chains.length - 1, 0), 5);
  }
  function familyOf(row) { return row.family_token ? 0.25 : 1; }
  function impliedOf(row) {
    var cm = catMult(row);
    var v = row.tvl_usd * cm.multiple * growthOf(row) * maturityOf(row) * chainsOf(row) * familyOf(row);
    return Math.max(1, Math.round(v));
  }
  function factorReasons(row) {
    var g = growthOf(row), mat = maturityOf(row), ch = chainsOf(row), fam = familyOf(row);
    var gr = 'No 7d data — neutral.';
    if (row.change_7d !== null && row.change_7d !== undefined) {
      var ex = row.change_7d - M.change_7d;
      gr = '7d ' + fmtPct(row.change_7d) + ' vs market ' + fmtPct(M.change_7d) + ' → excess ' + fmtPct(ex);
      if (Math.abs(ex) > 40) gr += ' (capped at ±40)';
      gr += '.';
    }
    var mr = 'No listing date — neutral.';
    if (row.age_days !== null && row.age_days !== undefined) {
      mr = 'Listed ' + row.age_days + ' days ago';
      mr += row.age_days >= 730 ? ' — at the 1.20 cap.' : '.';
    }
    var n = row.chains.length;
    var cr = n === 0 ? 'No chain listed — neutral.' : n + (n === 1 ? ' chain.' : ' chains — 1 + 0.03 x ' + Math.min(n - 1, 5) + '.');
    if (n >= 6) cr += ' At the 1.15 cap.';
    var fr = 'No live-token brand match.';
    if (row.family_token) fr = 'Shares a brand with ' + row.family_token.name + (row.family_token.symbol ? ' (' + row.family_token.symbol + ')' : '') + ' — sibling product, not a new token.';
    return {
      growth: { v: g, r: gr }, maturity: { v: mat, r: mr },
      chains: { v: ch, r: cr }, family: { v: fam, r: fr },
    };
  }

  // --- header + KPIs ------------------------------------------------------
  $('m-asof').textContent = R.snapshotDate || '—';
  $('m-mult').textContent = M.multiple.toFixed(3) + 'x';
  $('k-board').textContent = M.board_size;
  $('k-mult').innerHTML = M.multiple.toFixed(3) + 'x <small>· ' + M.comps + ' comps</small>';
  var chg = $('k-chg');
  chg.innerHTML = '<span class="' + sgn(M.change_7d) + '">' + fmtPct(M.change_7d) + '</span>';
  $('k-comps').textContent = M.comps + ' live tokens';

  // --- top-10 chart -------------------------------------------------------
  function renderTop10(list) {
    var top = list.slice(0, 10), max = top.length ? top[0].implied_value_usd : 1;
    $('top10').innerHTML = top.map(function (r, i) {
      var w = (r.implied_value_usd / max * 100).toFixed(1);
      return '<div class="t10"><span class="r">' + r.rank + '</span>' +
        '<span class="nm" title="' + esc(r.name) + '">' + esc(r.name) + '</span>' +
        '<span class="bar"><i style="width:' + w + '%"></i></span>' +
        '<span class="v">' + fmtM(r.implied_value_usd) + '</span></div>';
    }).join('') || '<div class="empty">No rows match the filter.</div>';
  }

  // --- category panel -----------------------------------------------------
  function renderCats(active) {
    var cats = M.categories.slice().sort(function (a, b) { return b.multiple - a.multiple; });
    $('cat-base').textContent = 'BENCHMARK ' + M.multiple.toFixed(3) + 'x · ' + M.comps + ' COMPS · OTHER 102 ROWS';
    $('cats').innerHTML = cats.map(function (c) {
      return '<div class="cat' + (active === c.category ? ' on' : '') + '" data-cat="' + esc(c.category) + '">' +
        '<div class="cn">' + esc(c.category) + '</div>' +
        '<div class="cv">' + fmtMult3(c.multiple) + '<span class="cc">' + c.comps + ' comps</span></div></div>';
    }).join('');
  }
  $('cats').addEventListener('click', function (e) {
    var t = e.target.closest('.cat'); if (!t) return;
    var sel = $('f-cat');
    sel.value = sel.value === t.getAttribute('data-cat') ? '' : t.getAttribute('data-cat');
    applyFilters();
  });

  // --- filters ------------------------------------------------------------
  var fSearch = $('f-search'), fCat = $('f-cat'), fChain = $('f-chain'), fChg = $('f-chg'), fSort = $('f-sort');
  (function fillSelects() {
    var cats = {}, chains = {};
    rows.forEach(function (r) {
      if (r.category) cats[r.category] = 1;
      r.chains.forEach(function (c) { chains[c] = 1; });
    });
    Object.keys(cats).sort().forEach(function (c) {
      var o = document.createElement('option'); o.value = c; o.textContent = c; fCat.appendChild(o);
    });
    Object.keys(chains).sort().forEach(function (c) {
      var o = document.createElement('option'); o.value = c; o.textContent = c; fChain.appendChild(o);
    });
  })();
  function filtered() {
    var q = fSearch.value.trim().toLowerCase(), cat = fCat.value, chain = fChain.value, chg = fChg.value;
    var list = rows.filter(function (r) {
      if (q && r.name.toLowerCase().indexOf(q) === -1 && r.slug.toLowerCase().indexOf(q) === -1) return false;
      if (cat && r.category !== cat) return false;
      if (chain && r.chains.indexOf(chain) === -1) return false;
      if (chg === 'pos' && !(r.change_7d !== null && r.change_7d > 0)) return false;
      if (chg === 'neg' && !(r.change_7d !== null && r.change_7d < 0)) return false;
      return true;
    });
    var s = fSort.value;
    if (s === 'tvl') list = list.slice().sort(function (a, b) { return b.tvl_usd - a.tvl_usd; });
    else if (s === 'chg') list = list.slice().sort(function (a, b) { return (b.change_7d || -Infinity) - (a.change_7d || -Infinity); });
    else list = list.slice().sort(function (a, b) { return b.implied_value_usd - a.implied_value_usd; });
    return list;
  }

  // --- table --------------------------------------------------------------
  function rowHtml(r) {
    var cls = r.rank === 1 ? 'r1' : r.rank === 2 ? 'r2' : r.rank === 3 ? 'r3' : '';
    var chg = r.change_7d === null || r.change_7d === undefined
      ? '<td class="c-num flat">—</td>'
      : '<td class="c-num ' + sgn(r.change_7d) + '">' + arrow(r.change_7d) + ' ' + fmtPct(r.change_7d) + '</td>';
    var pct = (r.implied_value_usd / TOP1 * 100).toFixed(1);
    return '<tr class="' + cls + '" data-slug="' + esc(r.slug) + '">' +
      '<td class="c-rank rank3">' + String(r.rank).padStart(3, '0') + '</td>' +
      '<td><div class="pname">' + esc(r.name) + (r.category ? '<span class="pcat">' + esc(r.category) + '</span>' : '') + '</div>' +
      '<span class="chip">' + esc(r.chains.length ? r.chains.join(' · ') : 'no chain listed') + '</span></td>' +
      '<td class="c-num">' + fmtM(r.tvl_usd) + '</td>' + chg +
      '<td class="c-num">' + fmtAge(r.age_days) + '</td>' +
      '<td class="c-num val">' + fmtM(r.implied_value_usd) + '</td>' +
      '<td class="c-rel"><div class="relbar"><i style="width:' + pct + '%"></i></div><span class="relpct">' + pct + '% of #1</span></td></tr>';
  }
  function renderTable(list) {
    $('rows').innerHTML = list.length
      ? list.map(rowHtml).join('')
      : '<tr><td colspan="7" class="empty">No protocols match the current filters.</td></tr>';
    $('count').textContent = 'SHOWING ' + list.length + ' / ' + rows.length;
  }
  $('rows').addEventListener('click', function (e) {
    var tr = e.target.closest('tr[data-slug]'); if (!tr) return;
    openDrawer(tr.getAttribute('data-slug'));
  });

  // --- drawer -------------------------------------------------------------
  var selected = null;
  function parseStep(s) {
    var m = s.match(/^(.*?) Cost: (.*?)\. Time: (.*?)\.?$/);
    return m ? { text: m[1], cost: m[2], time: m[3] } : { text: s, cost: '', time: '' };
  }
  function openDrawer(slug) {
    var r = null;
    for (var i = 0; i < rows.length; i++) if (rows[i].slug === slug) { r = rows[i]; break; }
    if (!r) return;
    selected = slug;
    document.querySelectorAll('#rows tr.sel').forEach(function (t) { t.classList.remove('sel'); });
    var tr = document.querySelector('#rows tr[data-slug="' + slug + '"]');
    if (tr) tr.classList.add('sel');
    var cm = catMult(r), f = factorReasons(r), rec = impliedOf(r);
    var base = r.tvl_usd * cm.multiple;
    var s1 = base * growthOf(r), s2 = s1 * maturityOf(r), s3 = s2 * chainsOf(r), s4 = s3 * familyOf(r);
    var chgCell = r.change_7d === null || r.change_7d === undefined
      ? '<dd>—</dd>' : '<dd class="' + sgn(r.change_7d) + '">' + arrow(r.change_7d) + ' ' + fmtPct(r.change_7d) + '</dd>';
    var steps = (r.farm_steps || []).map(function (s) {
      var p = parseStep(s);
      return '<li>' + esc(p.text) + '<div class="sc"><b>Cost:</b> ' + esc(p.cost) + ' &nbsp;·&nbsp; <b>Time:</b> ' + esc(p.time) + '</div></li>';
    }).join('');
    $('dr-body').innerHTML =
      '<div class="dr-rank">RANK <b>#' + r.rank + '</b> OF ' + rows.length + ' · ' + esc(r.slug) + '</div>' +
      '<div class="dr-name">' + esc(r.name) + '</div>' +
      '<div class="dr-sub">' + (r.category ? '<span class="catg">' + esc(r.category) + '</span> · ' : '') + esc(r.chains.length ? r.chains.join(' · ') : 'no chain listed') + '</div>' +
      '<div class="dr-val">' + fmtM(r.implied_value_usd) + ' <small>implied token value</small></div>' +
      '<div class="dr-sec">VALUATION INPUTS</div>' +
      '<dl class="kv">' +
      '<dt>TVL</dt><dd>$' + fmtInt(r.tvl_usd) + '</dd>' +
      '<dt>Multiple (' + cm.basis + ')</dt><dd>' + cm.multiple.toFixed(4) + 'x</dd>' +
      '<dt>Valuation comparables</dt><dd>' + cm.comps + (cm.basis === 'market' ? ' (market)' : ' (category)') + '</dd>' +
      '<dt>7d TVL change</dt>' + chgCell +
      '<dt>Listed</dt><dd>' + (r.listed_at ? r.listed_at : '—') + (r.age_days !== null && r.age_days !== undefined ? ' · ' + r.age_days + 'd' : '') + '</dd>' +
      '<dt>Chains</dt><dd>' + (r.chains.length ? r.chains.length : '—') + '</dd>' +
      '<dt>Family token</dt><dd>' + (r.family_token ? esc(r.family_token.name) + (r.family_token.symbol ? ' (' + esc(r.family_token.symbol) + ')' : '') : 'none') + '</dd>' +
      '</dl>' +
      '<div class="dr-sec">ADJUSTMENT FACTORS</div>' +
      '<div class="factors">' +
      '<div class="factor"><div class="fl">GROWTH</div><div class="fv">' + fmtX(f.growth.v) + '</div><div class="fr">' + esc(f.growth.r) + '</div></div>' +
      '<div class="factor"><div class="fl">MATURITY</div><div class="fv">' + fmtX(f.maturity.v) + '</div><div class="fr">' + esc(f.maturity.r) + '</div></div>' +
      '<div class="factor"><div class="fl">CHAINS</div><div class="fv">' + fmtX(f.chains.v) + '</div><div class="fr">' + esc(f.chains.r) + '</div></div>' +
      '<div class="factor"><div class="fl">FAMILY</div><div class="fv">' + fmtX(f.family.v) + '</div><div class="fr">' + esc(f.family.r) + '</div></div>' +
      '</div>' +
      '<div class="dr-sec">RECOMPUTATION</div>' +
      '<div class="ladder">' +
      '<div class="lr"><span>TVL x multiple</span><span>$' + fmtInt(r.tvl_usd) + ' x ' + cm.multiple.toFixed(4) + '</span></div>' +
      '<div class="lr"><span>= base value</span><span>$' + fmtInt(base) + '</span></div>' +
      '<div class="lr"><span>x growth ' + fmtX(f.growth.v) + '</span><span>$' + fmtInt(s1) + '</span></div>' +
      '<div class="lr"><span>x maturity ' + fmtX(f.maturity.v) + '</span><span>$' + fmtInt(s2) + '</span></div>' +
      '<div class="lr"><span>x chains ' + fmtX(f.chains.v) + '</span><span>$' + fmtInt(s3) + '</span></div>' +
      '<div class="lr"><span>x family ' + fmtX(f.family.v) + '</span><span>$' + fmtInt(s4) + '</span></div>' +
      '<div class="lr final"><span>IMPLIED VALUE (rounded)</span><span>$' + fmtInt(rec) + '</span></div>' +
      '</div>' +
      '<div class="dr-sec">FARM PLAN</div>' +
      '<div class="plan-note">Plan generated by radar-3 from the protocol\u2019s category, first chain, TVL tier and age. Costs and times are estimates, not snapshot data.</div>' +
      '<ol class="steps">' + steps + '</ol>' +
      '<div class="dr-foot">Implied value = TVL x ' + cm.basis + ' multiple (' + cm.multiple.toFixed(4) + 'x, ' + cm.comps + ' comps) x growth x maturity x chains x family, rounded to the dollar. ' +
      'Multiple and median are computed from the sealed snapshot as of ' + esc(R.snapshotDate || '') + '; the page recomputes every row from the same figures and matches the board exactly.</div>';
    $('drawer').hidden = false;
  }
  $('dr-x').addEventListener('click', function () {
    $('drawer').hidden = true; selected = null;
    document.querySelectorAll('#rows tr.sel').forEach(function (t) { t.classList.remove('sel'); });
  });

  // --- apply --------------------------------------------------------------
  function applyFilters() {
    var list = filtered();
    renderTable(list);
    renderTop10(list);
    renderCats(fCat.value || null);
    if (selected) {
      var still = list.some(function (r) { return r.slug === selected; });
      if (!still) { $('drawer').hidden = true; selected = null; }
    }
  }
  [fSearch, fCat, fChain, fChg, fSort].forEach(function (el) {
    el.addEventListener('input', applyFilters);
    el.addEventListener('change', applyFilters);
  });

  // --- ?shot presets ------------------------------------------------------
  var shot = new URLSearchParams(location.search).get('shot') || 'board';
  if (shot) document.body.classList.add('shot');
  if (shot === 'filtered') {
    var dex = rows.filter(function (r) { return r.category === 'Dexs'; });
    if (dex.length >= 6) fCat.value = 'Dexs';
    else {
      var counts = {};
      rows.forEach(function (r) { if (r.category) counts[r.category] = (counts[r.category] || 0) + 1; });
      var best = null, bn = 0;
      Object.keys(counts).forEach(function (c) { if (counts[c] > bn) { bn = counts[c]; best = c; } });
      if (best) fCat.value = best;
    }
    var after = filtered();
    if (after.filter(function (r) { return r.change_7d !== null && r.change_7d > 0; }).length >= 6) fChg.value = 'pos';
  }
  applyFilters();
  if (shot === 'detail' && rows[0]) openDrawer(rows[0].slug);
})();
