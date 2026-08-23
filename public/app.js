(function () {
  'use strict';

  // ================= 状态 =================
  var state = {
    token: localStorage.getItem('jz_token') || '',
    user: null,
    ledgers: [],
    currentLedgerId: null,
    categories: [],
    recordType: 'expense',
    selectedCategoryId: null,
    recordPage: 1,
    recordPageSize: 20,
    recordTotal: 0,
    lastItems: [],
    editingRecordId: null,
    charts: { trend: null, pie: null, daily: null },
  };

  // ================= 工具 =================
  function $(sel) { return document.querySelector(sel); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fmt(cents) { return '¥' + (cents / 100).toFixed(2); }

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function currentMonthStr() {
    var d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1);
  }

  function monthLabel(m) {
    if (!m) return '';
    return m.slice(0, 4) + '年' + Number(m.slice(5)) + '月';
  }

  var toastTimer = null;
  function toast(msg) {
    var el = $('#toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.add('hidden'); }, 2200);
  }

  async function api(path, opts) {
    opts = opts || {};
    var headers = { 'Content-Type': 'application/json' };
    if (state.token) headers['Authorization'] = 'Bearer ' + state.token;
    var resp;
    try {
      resp = await fetch('/api' + path, {
        method: opts.method || 'GET',
        headers: headers,
        body: opts.body ? JSON.stringify(opts.body) : undefined,
      });
    } catch (e) {
      throw new Error('网络错误，请确认服务已启动');
    }
    var data = null;
    try { data = await resp.json(); } catch (e) { data = null; }
    if (resp.status === 401) {
      logoutLocal();
      throw new Error((data && data.error) || '登录已失效');
    }
    if (!resp.ok) throw new Error((data && data.error) || ('请求失败 ' + resp.status));
    return data;
  }

  function logoutLocal() {
    state.token = '';
    state.user = null;
    localStorage.removeItem('jz_token');
    $('#app-view').classList.add('hidden');
    $('#login-view').classList.remove('hidden');
  }

  // ================= 登录 / 注册 =================
  function showLogin() {
    $('#app-view').classList.add('hidden');
    $('#login-view').classList.remove('hidden');
  }

  function doLogin(username, password) {
    $('#login-hint').textContent = '';
    api('/auth/login', { method: 'POST', body: { username: username, password: password } })
      .then(function (data) {
        state.token = data.token;
        localStorage.setItem('jz_token', data.token);
        bootApp();
      })
      .catch(function (e) { $('#login-hint').textContent = e.message; });
  }

  function doRegister(username, password, nickname) {
    $('#login-hint').textContent = '';
    api('/auth/register', { method: 'POST', body: { username: username, password: password, nickname: nickname } })
      .then(function (data) {
        state.token = data.token;
        localStorage.setItem('jz_token', data.token);
        bootApp();
      })
      .catch(function (e) { $('#login-hint').textContent = e.message; });
  }

  // ================= 启动 =================
  async function bootApp() {
    try {
      var me = await api('/auth/me');
      state.user = me.user;
      state.ledgers = me.ledgers;
      state.currentLedgerId = me.user.current_ledger_id || (me.ledgers[0] ? me.ledgers[0].id : null);
      $('#login-view').classList.add('hidden');
      $('#app-view').classList.remove('hidden');
      renderHeader();
      await loadCategories();
      renderCategoryPicker();
      $('#filter-month').value = currentMonthStr();
      $('#stats-month').value = currentMonthStr();
      $('#budget-month').value = currentMonthStr();
      switchTab('record');
    } catch (e) {
      showLogin();
    }
  }

  // ================= 个人中心 =================
  function openProfile() {
    var u = state.user || {};
    $('#profile-username').textContent = u.username || '';
    $('#profile-created').textContent = u.created_at ? u.created_at.slice(0, 10) : '';
    $('#profile-nickname').value = u.nickname || '';
    $('#profile-old-password').value = '';
    $('#profile-new-password').value = '';
    $('#profile-confirm-password').value = '';
    $('#profile-modal').classList.remove('hidden');
  }

  function closeProfile() {
    $('#profile-modal').classList.add('hidden');
  }

  function saveNickname() {
    var nickname = $('#profile-nickname').value.trim();
    if (!nickname) { toast('昵称不能为空'); return; }
    api('/auth/me', { method: 'PUT', body: { nickname: nickname } })
      .then(function (data) {
        state.user = data.user;
        renderHeader();
        toast('昵称已更新');
      })
      .catch(function (e) { toast(e.message); });
  }

  function changePassword() {
    var oldPwd = $('#profile-old-password').value;
    var newPwd = $('#profile-new-password').value;
    var confirmPwd = $('#profile-confirm-password').value;
    if (!oldPwd) { toast('请输入原密码'); return; }
    if (newPwd.length < 6) { toast('新密码至少 6 位'); return; }
    if (newPwd !== confirmPwd) { toast('两次输入的新密码不一致'); return; }
    api('/auth/password', { method: 'PUT', body: { old_password: oldPwd, new_password: newPwd } })
      .then(function () {
        toast('密码已修改，请重新登录');
        setTimeout(function () {
          state.token = '';
          state.user = null;
          localStorage.removeItem('jz_token');
          $('#app-view').classList.add('hidden');
          $('#login-view').classList.remove('hidden');
          $('#login-password').value = '';
        }, 1200);
      })
      .catch(function (e) { toast(e.message); });
  }

  function renderHeader() {
    $('#user-nickname').textContent = state.user.nickname || state.user.username;
    var sel = $('#ledger-select');
    sel.innerHTML = '';
    state.ledgers.forEach(function (l) {
      var opt = document.createElement('option');
      opt.value = l.id;
      opt.textContent = l.name + (l.id === state.currentLedgerId ? '（当前）' : '');
      sel.appendChild(opt);
    });
    sel.value = String(state.currentLedgerId);
  }

  // ================= 分类 =================
  async function loadCategories() {
    state.categories = await api('/categories');
  }

  function renderCategoryPicker() {
    var box = $('#category-picker');
    box.innerHTML = '';
    var list = state.categories.filter(function (c) { return c.type === state.recordType; });
    list.forEach(function (c) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cat-btn' + (c.id === state.selectedCategoryId ? ' selected' : '');
      btn.innerHTML = '<span class="ic">' + esc(c.icon) + '</span><span>' + esc(c.name) + '</span>';
      btn.onclick = function () {
        state.selectedCategoryId = (state.selectedCategoryId === c.id) ? null : c.id;
        renderCategoryPicker();
      };
      box.appendChild(btn);
    });
  }

  function fillCategoryFilter() {
    var sel = $('#filter-category');
    sel.innerHTML = '<option value="">全部分类</option>';
    state.categories.forEach(function (c) {
      var opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = (c.type === 'expense' ? '支·' : '收·') + c.name;
      sel.appendChild(opt);
    });
  }

  function fillBudgetCategory() {
    var sel = $('#budget-category');
    sel.innerHTML = '';
    var list = state.categories.filter(function (c) { return c.type === 'expense'; });
    list.forEach(function (c) {
      var opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.icon + ' ' + c.name;
      sel.appendChild(opt);
    });
  }

  // ================= 记账 =================
  function resetRecordForm() {
    state.editingRecordId = null;
    state.selectedCategoryId = null;
    $('#record-form').reset();
    $('#record-date').value = todayStr();
    $('#record-form-title').textContent = '记一笔';
    $('#record-submit').textContent = '保存';
    $('#record-cancel').classList.add('hidden');
    renderCategoryPicker();
  }

  function readRecordForm() {
    var amount = Number($('#record-amount').value);
    return {
      type: state.recordType,
      amount: amount,
      category_id: state.selectedCategoryId,
      note: $('#record-note').value,
      record_date: $('#record-date').value || todayStr(),
      ledger_id: state.currentLedgerId,
    };
  }

  function submitRecord(e) {
    e.preventDefault();
    var body = readRecordForm();
    if (!isFinite(body.amount) || body.amount <= 0) { toast('请输入金额'); return; }
    if (!body.category_id) { toast('请选择分类'); return; }
    var isEdit = !!state.editingRecordId;
    var p = isEdit
      ? api('/records/' + state.editingRecordId, { method: 'PUT', body: body })
      : api('/records', { method: 'POST', body: body });
    p.then(function () {
      toast(isEdit ? '已保存修改' : '已记一笔');
      resetRecordForm();
      loadRecords();
    }).catch(function (e) { toast(e.message); });
  }

  function loadRecords() {
    var month = $('#filter-month').value || '';
    var from = month ? month + '-01' : '';
    var to = month ? month + '-31' : '';
    var params = [
      'ledger_id=' + state.currentLedgerId,
      'page=' + state.recordPage,
      'pageSize=' + state.recordPageSize,
    ];
    if (from) params.push('from=' + from);
    if (to) params.push('to=' + to);
    var type = $('#filter-type').value;
    if (type) params.push('type=' + type);
    var cat = $('#filter-category').value;
    if (cat) params.push('category_id=' + cat);
    var kw = $('#filter-keyword').value.trim();
    if (kw) params.push('keyword=' + encodeURIComponent(kw));

    api('/records?' + params.join('&')).then(function (data) {
      state.recordTotal = data.total;
      state.lastItems = data.items;
      renderRecordList();
    }).catch(function (e) { toast(e.message); });
  }

  // 按当前筛选条件导出 CSV
  function exportRecords() {
    var month = $('#filter-month').value || '';
    var from = month ? month + '-01' : '';
    var to = month ? month + '-31' : '';
    var params = ['ledger_id=' + state.currentLedgerId];
    if (from) params.push('from=' + from);
    if (to) params.push('to=' + to);
    var type = $('#filter-type').value;
    if (type) params.push('type=' + type);
    var cat = $('#filter-category').value;
    if (cat) params.push('category_id=' + cat);
    var kw = $('#filter-keyword').value.trim();
    if (kw) params.push('keyword=' + encodeURIComponent(kw));
    var headers = { 'Authorization': 'Bearer ' + state.token };
    fetch('/api/records/export?' + params.join('&'), { headers: headers })
      .then(function (resp) {
        if (!resp.ok) return resp.json().then(function (d) { throw new Error((d && d.error) || '导出失败'); });
        return resp.blob();
      })
      .then(function (blob) {
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'jizhang-' + (month || 'all') + '.csv';
        document.body.appendChild(a);
        a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      })
      .catch(function (e) { toast(e.message); });
  }

  function renderRecordList() {
    var box = $('#record-list');
    if (state.lastItems.length === 0) {
      box.innerHTML = '<div class="empty">暂无记录，记一笔吧 📝</div>';
    } else {
      var html = [];
      state.lastItems.forEach(function (r) {
        var icon = r.category_icon || '📌';
        var name = r.category_name || '未分类';
        var cls = r.type === 'income' ? 'income' : 'expense';
        html.push(
          '<div class="record-item">' +
          '<div class="r-icon">' + esc(icon) + '</div>' +
          '<div class="r-main">' +
          '<div class="r-name">' + esc(name) + (r.note ? ' · ' + esc(r.note) : '') + '</div>' +
          '<div class="r-note">' + (r.type === 'income' ? '收入' : '支出') + '</div>' +
          '</div>' +
          '<div class="r-date">' + esc(r.record_date) + '</div>' +
          '<div class="r-amount ' + cls + '">' + (r.type === 'income' ? '+' : '-') + fmt(r.amount) + '</div>' +
          '<div class="r-actions">' +
          '<button type="button" class="btn ghost sm" data-act="edit" data-id="' + r.id + '">编辑</button>' +
          '<button type="button" class="btn danger sm" data-act="del" data-id="' + r.id + '">删</button>' +
          '</div></div>'
        );
      });
      box.innerHTML = html.join('');
      box.querySelectorAll('button[data-act]').forEach(function (btn) {
        btn.onclick = function () {
          if (btn.dataset.act === 'edit') editRecord(Number(btn.dataset.id));
          else deleteRecord(Number(btn.dataset.id));
        };
      });
    }
    var totalPages = Math.max(1, Math.ceil(state.recordTotal / state.recordPageSize));
    $('#page-info').textContent = '第 ' + state.recordPage + '/' + totalPages + ' 页 · 共 ' + state.recordTotal + ' 条';
    $('#page-prev').disabled = state.recordPage <= 1;
    $('#page-next').disabled = state.recordPage >= totalPages;
  }

  function editRecord(id) {
    var r = null;
    state.lastItems.forEach(function (x) { if (x.id === id) r = x; });
    if (!r) return;
    state.editingRecordId = id;
    state.recordType = r.type;
    state.selectedCategoryId = r.category_id;
    $('#record-date').value = r.record_date;
    $('#record-amount').value = (r.amount / 100).toFixed(2);
    $('#record-note').value = r.note;
    $('#record-form-title').textContent = '编辑记录 #' + id;
    $('#record-submit').textContent = '保存修改';
    $('#record-cancel').classList.remove('hidden');
    renderTypeToggle();
    renderCategoryPicker();
    $('#record-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function deleteRecord(id) {
    if (!confirm('确定删除这条记录吗？')) return;
    api('/records/' + id, { method: 'DELETE' }).then(function () {
      toast('已删除');
      loadRecords();
    }).catch(function (e) { toast(e.message); });
  }

  function renderTypeToggle() {
    document.querySelectorAll('.type-toggle button').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.type === state.recordType);
    });
  }

  // ================= 统计 =================
  function renderStats() {
    var month = $('#stats-month').value || currentMonthStr();
    Promise.all([
      api('/stats/summary?ledger_id=' + state.currentLedgerId + '&month=' + month),
      api('/stats/monthly?ledger_id=' + state.currentLedgerId + '&months=12'),
      api('/stats/by-category?ledger_id=' + state.currentLedgerId + '&month=' + month + '&type=expense'),
      api('/stats/daily?ledger_id=' + state.currentLedgerId + '&month=' + month),
    ]).then(function (rs) {
      var summary = rs[0], monthly = rs[1], byCat = rs[2], daily = rs[3];
      $('#stat-income').textContent = fmt(summary.income);
      $('#stat-expense').textContent = fmt(summary.expense);
      $('#stat-net').textContent = fmt(summary.net);
      $('#stat-count').textContent = summary.record_count + ' 笔';
      var budgetEl = $('#stat-budget');
      if (summary.budget) {
        var pct = summary.budget_pct || 0;
        budgetEl.textContent = fmt(summary.budget_spent) + ' / ' + fmt(summary.budget) + '（' + pct + '%）';
        budgetEl.className = 'value' + (pct > 100 ? ' expense' : (pct > 80 ? '' : ''));
      } else {
        budgetEl.textContent = '未设置';
        budgetEl.className = 'value';
      }
      trendChart(monthly);
      pieChart(byCat);
      dailyChart(daily);
    }).catch(function (e) { toast(e.message); });
  }

  function chartBase(el) {
    if (typeof echarts === 'undefined') {
      el.innerHTML = '<div class="empty">图表库未加载（请检查 vendor/echarts.min.js）</div>';
      return null;
    }
    return echarts.init(el);
  }

  function trendChart(monthly) {
    var el = $('#chart-trend');
    if (!state.charts.trend) {
      var chart = chartBase(el);
      if (!chart) return;
      state.charts.trend = chart;
    }
    state.charts.trend.setOption({
      tooltip: { trigger: 'axis', valueFormatter: function (v) { return '¥' + (v / 100).toFixed(2); } },
      legend: { data: ['收入', '支出'] },
      grid: { left: 60, right: 20, top: 40, bottom: 30 },
      xAxis: { type: 'category', data: monthly.map(function (m) { return m.month.slice(2); }) },
      yAxis: { type: 'value' },
      series: [
        { name: '收入', type: 'bar', data: monthly.map(function (m) { return m.income; }), itemStyle: { color: '#16a34a' }, barMaxWidth: 16 },
        { name: '支出', type: 'bar', data: monthly.map(function (m) { return m.expense; }), itemStyle: { color: '#dc2626' }, barMaxWidth: 16 },
      ],
    }, true);
  }

  function pieChart(byCat) {
    var el = $('#chart-pie');
    if (!state.charts.pie) {
      var chart = chartBase(el);
      if (!chart) return;
      state.charts.pie = chart;
    }
    var data = byCat.map(function (c) {
      return { name: (c.category_icon || '') + ' ' + (c.category_name || '未分类'), value: c.amount };
    });
    state.charts.pie.setOption({
      tooltip: { trigger: 'item', valueFormatter: function (v) { return '¥' + (v / 100).toFixed(2); } },
      legend: { type: 'scroll', bottom: 0 },
      series: [{
        type: 'pie',
        radius: ['38%', '68%'],
        center: ['50%', '45%'],
        data: data,
        label: { formatter: '{b}\n{d}%' },
      }],
    }, true);
  }

  function dailyChart(daily) {
    var el = $('#chart-daily');
    if (!state.charts.daily) {
      var chart = chartBase(el);
      if (!chart) return;
      state.charts.daily = chart;
    }
    state.charts.daily.setOption({
      tooltip: { trigger: 'axis', valueFormatter: function (v) { return '¥' + (v / 100).toFixed(2); } },
      legend: { data: ['收入', '支出'] },
      grid: { left: 60, right: 20, top: 40, bottom: 30 },
      xAxis: { type: 'category', data: daily.map(function (d) { return Number(d.day.slice(8)); }) },
      yAxis: { type: 'value' },
      series: [
        { name: '收入', type: 'bar', data: daily.map(function (d) { return d.income; }), itemStyle: { color: '#16a34a' }, barMaxWidth: 10 },
        { name: '支出', type: 'bar', data: daily.map(function (d) { return d.expense; }), itemStyle: { color: '#dc2626' }, barMaxWidth: 10 },
      ],
    }, true);
  }

  // ================= 预算 =================
  function renderBudget() {
    var month = $('#budget-month').value || currentMonthStr();
    api('/budgets?ledger_id=' + state.currentLedgerId + '&month=' + month).then(function (data) {
      var box = $('#budget-overall');
      var html = [];
      html.push('<h3>' + esc(monthLabel(data.month)) + ' 总预算</h3>');
      if (data.overall) {
        var pct = data.overall.amount > 0 ? Math.round((data.overall.spent / data.overall.amount) * 100) : 0;
        var cls = pct > 100 ? 'over' : (pct > 80 ? 'warn' : '');
        var pctText = data.overall.amount > 0 ? pct + '%' : '--';
        html.push(
          '<div class="budget-item">' +
          '<div class="b-main">' +
          '<div class="progress ' + cls + '"><div style="width:' + Math.min(100, pct) + '%"></div></div>' +
          '<div class="b-info">已支出 ' + fmt(data.overall.spent) + ' / 预算 ' + fmt(data.overall.amount) + '（' + pctText + '）' +
          (data.overall.remaining >= 0 ? '，剩余 ' + fmt(data.overall.remaining) : '，已超支 ' + fmt(-data.overall.remaining)) + '</div>' +
          '</div>' +
          '<button type="button" class="btn ghost sm" data-act="edit-overall">调整</button>' +
          '<button type="button" class="btn danger sm" data-act="del" data-id="' + data.overall.id + '">删</button>' +
          '</div>'
        );
      } else {
        html.push(
          '<div class="inline-form" style="margin-bottom:8px">' +
          '<input type="number" id="overall-amount" placeholder="本月总预算金额（元）" min="0.01" step="0.01">' +
          '<button type="button" class="btn primary" id="btn-set-overall">设置总预算</button>' +
          '</div>'
        );
      }
      box.innerHTML = html.join('');
      var editBtn = box.querySelector('[data-act="edit-overall"]');
      if (editBtn) {
        editBtn.onclick = function () {
          var v = prompt('调整本月总预算（元）', (data.overall.amount / 100).toFixed(2));
          if (v === null) return;
          saveBudget(null, v, data.month);
        };
      }
      var delBtn = box.querySelector('[data-act="del"]');
      if (delBtn) {
        delBtn.onclick = function () { deleteBudget(Number(delBtn.dataset.id)); };
      }
      var setBtn = box.querySelector('#btn-set-overall');
      if (setBtn) {
        setBtn.onclick = function () { saveBudget(null, $('#overall-amount').value, data.month); };
      }

      var listBox = $('#budget-list');
      if (data.items.length === 0) {
        listBox.innerHTML = '<div class="empty">尚未设置分类预算</div>';
      } else {
        var html2 = [];
        data.items.forEach(function (it) {
          var pct = it.amount > 0 ? Math.round((it.spent / it.amount) * 100) : 0;
          var cls = pct > 100 ? 'over' : (pct > 80 ? 'warn' : '');
          html2.push(
            '<div class="budget-item">' +
            '<div class="b-icon">' + esc(it.category_icon || '📌') + '</div>' +
            '<div class="b-main">' +
            '<div class="b-name">' + esc(it.category_name) + '</div>' +
            '<div class="progress ' + cls + '"><div style="width:' + Math.min(100, pct) + '%"></div></div>' +
            '<div class="b-info">已花 ' + fmt(it.spent) + ' / ' + fmt(it.amount) + '（' + pct + '%）' +
            (it.remaining >= 0 ? '，剩 ' + fmt(it.remaining) : '，超支 ' + fmt(-it.remaining)) + '</div>' +
            '</div>' +
            '<button type="button" class="btn ghost sm" data-act="edit" data-id="' + it.id + '" data-cat="' + it.category_id + '" data-amount="' + it.amount + '">调整</button>' +
            '<button type="button" class="btn danger sm" data-act="del" data-id="' + it.id + '">删</button>' +
            '</div>'
          );
        });
        listBox.innerHTML = html2.join('');
        listBox.querySelectorAll('button[data-act]').forEach(function (btn) {
          btn.onclick = function () {
            if (btn.dataset.act === 'edit') {
              var v = prompt('调整预算（元）', (Number(btn.dataset.amount) / 100).toFixed(2));
              if (v !== null) saveBudget(Number(btn.dataset.cat), v, data.month);
            } else {
              deleteBudget(Number(btn.dataset.id));
            }
          };
        });
      }
      fillBudgetCategory();
    }).catch(function (e) { toast(e.message); });
  }

  function saveBudget(categoryId, amountYuan, month) {
    var amount = Number(amountYuan);
    if (!isFinite(amount) || amount <= 0) { toast('请输入有效金额'); return; }
    var body = { ledger_id: state.currentLedgerId, month: month, amount: amount };
    if (categoryId) body.category_id = categoryId;
    var p = api('/budgets', { method: 'PUT', body: body });
    p.then(function () {
      toast('预算已保存');
      renderBudget();
    }).catch(function (e) { toast(e.message); });
  }

  function deleteBudget(id) {
    if (!confirm('确定删除该预算吗？')) return;
    api('/budgets/' + id, { method: 'DELETE' }).then(function () {
      toast('已删除');
      renderBudget();
    }).catch(function (e) { toast(e.message); });
  }

  // ================= 账本 =================
  function renderLedgers() {
    var box = $('#ledger-list');
    if (state.ledgers.length === 0) {
      box.innerHTML = '<div class="empty">还没有账本，先创建一个吧</div>';
      return;
    }
    var html = [];
    state.ledgers.forEach(function (l) {
      var isCurrent = l.id === state.currentLedgerId;
      html.push(
        '<div class="ledger-item">' +
        '<div class="l-main">' +
        '<div class="l-name">' + esc(l.name) + (isCurrent ? ' <span class="muted">（当前）</span>' : '') + '</div>' +
        '<div class="l-meta">' + (l.record_count || 0) + ' 条记录 · ' + (l.currency || 'CNY') + (l.description ? ' · ' + esc(l.description) : '') + '</div>' +
        '</div>' +
        (isCurrent
          ? '<button type="button" class="btn ghost sm" data-act="rename" data-id="' + l.id + '">重命名</button>'
          : '<button type="button" class="btn primary sm" data-act="activate" data-id="' + l.id + '">设为当前</button>' +
            '<button type="button" class="btn danger sm" data-act="del" data-id="' + l.id + '">删除</button>') +
        '</div>'
      );
    });
    box.innerHTML = html.join('');
    box.querySelectorAll('button[data-act]').forEach(function (btn) {
      btn.onclick = function () {
        var id = Number(btn.dataset.id);
        if (btn.dataset.act === 'activate') activateLedger(id);
        else if (btn.dataset.act === 'rename') renameLedger(id);
        else deleteLedger(id);
      };
    });
  }

  function activateLedger(id) {
    api('/ledgers/' + id + '/activate', { method: 'POST' }).then(function () {
      state.currentLedgerId = id;
      toast('已切换到当前账本');
      refreshAfterLedgerChange();
    }).catch(function (e) { toast(e.message); });
  }

  function renameLedger(id) {
    var l = null;
    state.ledgers.forEach(function (x) { if (x.id === id) l = x; });
    if (!l) return;
    var name = prompt('账本新名称', l.name);
    if (name === null || !name.trim()) return;
    api('/ledgers/' + id, { method: 'PUT', body: { name: name.trim() } }).then(function () {
      toast('已重命名');
      refreshAll();
    }).catch(function (e) { toast(e.message); });
  }

  function deleteLedger(id) {
    if (!confirm('确定删除该账本吗？其所有记录和预算将一并删除！')) return;
    api('/ledgers/' + id, { method: 'DELETE' }).then(function () {
      toast('账本已删除');
      refreshAll();
    }).catch(function (e) { toast(e.message); });
  }

  function refreshAfterLedgerChange() {
    var activeTab = document.querySelector('.tabs button.active');
    api('/auth/me').then(function (me) {
      state.user = me.user;
      state.ledgers = me.ledgers;
      state.currentLedgerId = me.user.current_ledger_id || (me.ledgers[0] ? me.ledgers[0].id : null);
      renderHeader();
      switchTab(activeTab ? activeTab.dataset.tab : 'record');
    }).catch(function () {});
  }

  function refreshAll() {
    var activeTab = document.querySelector('.tabs button.active');
    api('/auth/me').then(function (me) {
      state.user = me.user;
      state.ledgers = me.ledgers;
      state.currentLedgerId = me.user.current_ledger_id || (me.ledgers[0] ? me.ledgers[0].id : null);
      renderHeader();
      return loadCategories();
    }).then(function () {
      renderCategoryPicker();
      fillCategoryFilter();
      switchTab(activeTab ? activeTab.dataset.tab : 'record');
    }).catch(function () {});
  }

  // ================= 分类管理 =================
  function renderCategories() {
    ['expense', 'income'].forEach(function (type) {
      var box = $('#cat-' + type);
      var list = state.categories.filter(function (c) { return c.type === type; });
      if (list.length === 0) {
        box.innerHTML = '<div class="empty">暂无分类</div>';
        return;
      }
      var html = [];
      list.forEach(function (c) {
        html.push(
          '<div class="cat-item">' +
          '<span class="c-icon">' + esc(c.icon) + '</span>' +
          '<span class="c-name">' + esc(c.name) + '</span>' +
          '<button type="button" class="btn ghost sm" data-act="rename" data-id="' + c.id + '">改名</button>' +
          '<button type="button" class="btn danger sm" data-act="del" data-id="' + c.id + '">删</button>' +
          '</div>'
        );
      });
      box.innerHTML = html.join('');
      box.querySelectorAll('button[data-act]').forEach(function (btn) {
        btn.onclick = function () {
          var id = Number(btn.dataset.id);
          if (btn.dataset.act === 'rename') renameCategory(id);
          else deleteCategory(id);
        };
      });
    });
  }

  function renameCategory(id) {
    var c = null;
    state.categories.forEach(function (x) { if (x.id === id) c = x; });
    if (!c) return;
    var name = prompt('分类新名称', c.name);
    if (name === null || !name.trim()) return;
    var icon = prompt('分类图标（emoji，可留空）', c.icon || '');
    api('/categories/' + id, { method: 'PUT', body: { name: name.trim(), icon: icon } }).then(function () {
      toast('已保存');
      return loadCategories();
    }).then(function () {
      renderCategoryPicker();
      fillCategoryFilter();
      fillBudgetCategory();
      renderCategories();
    }).catch(function (e) { toast(e.message); });
  }

  function deleteCategory(id) {
    if (!confirm('确定删除该分类吗？')) return;
    api('/categories/' + id, { method: 'DELETE' }).then(function () {
      toast('已删除');
      return loadCategories();
    }).then(function () {
      renderCategoryPicker();
      fillCategoryFilter();
      fillBudgetCategory();
      renderCategories();
      loadRecords();
    }).catch(function (e) { toast(e.message); });
  }

  // ================= Tab 切换 =================
  function switchTab(name) {
    document.querySelectorAll('.tabs button').forEach(function (b) {
      b.classList.toggle('active', b.dataset.tab === name);
    });
    document.querySelectorAll('.tab-pane').forEach(function (p) {
      p.classList.toggle('active', p.id === 'tab-' + name);
    });
    if (name === 'record') {
      fillCategoryFilter();
      state.recordPage = 1;
      loadRecords();
    } else if (name === 'stats') {
      renderStats();
    } else if (name === 'budget') {
      renderBudget();
    } else if (name === 'ledger') {
      renderLedgers();
      renderCategories();
    }
  }

  // ================= 事件绑定 =================
  function bindEvents() {
    // 登录/注册
    $('#tab-login').onclick = function () {
      $('#tab-login').classList.add('active');
      $('#tab-register').classList.remove('active');
      $('#login-form').classList.remove('hidden');
      $('#register-form').classList.add('hidden');
      $('#login-hint').textContent = '';
    };
    $('#tab-register').onclick = function () {
      $('#tab-register').classList.add('active');
      $('#tab-login').classList.remove('active');
      $('#register-form').classList.remove('hidden');
      $('#login-form').classList.add('hidden');
      $('#login-hint').textContent = '';
    };
    $('#login-form').onsubmit = function (e) {
      e.preventDefault();
      doLogin($('#login-username').value.trim(), $('#login-password').value);
    };
    $('#register-form').onsubmit = function (e) {
      e.preventDefault();
      doRegister($('#reg-username').value.trim(), $('#reg-password').value, $('#reg-nickname').value.trim());
    };

    // 个人中心
    $('#user-nickname').onclick = openProfile;
    $('#user-nickname').onkeydown = function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openProfile(); }
    };
    $('#profile-close').onclick = closeProfile;
    $('#profile-modal').onclick = function (e) { if (e.target === this) closeProfile(); };
    $('#profile-save-nickname').onclick = saveNickname;
    $('#profile-save-password').onclick = changePassword;
    $('#profile-nickname').onkeydown = function (e) { if (e.key === 'Enter') saveNickname(); };
    $('#profile-confirm-password').onkeydown = function (e) { if (e.key === 'Enter') changePassword(); };
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeProfile(); });

    // 退出
    $('#btn-logout').onclick = function () {
      api('/auth/logout', { method: 'POST' }).catch(function () {});
      logoutLocal();
    };

    // Tab 切换
    document.querySelectorAll('.tabs button').forEach(function (b) {
      b.onclick = function () { switchTab(b.dataset.tab); };
    });

    // 账本切换
    $('#ledger-select').onchange = function () {
      var id = Number(this.value);
      if (id === state.currentLedgerId) return;
      activateLedger(id);
    };

    // 重命名当前账本（顶部快捷按钮）
    $('#btn-rename-ledger').onclick = function () {
      if (!state.currentLedgerId) { toast('请先选择账本'); return; }
      renameLedger(state.currentLedgerId);
    };

    // 记账表单
    document.querySelectorAll('.type-toggle button').forEach(function (b) {
      b.onclick = function () {
        state.recordType = b.dataset.type;
        state.selectedCategoryId = null;
        renderTypeToggle();
        renderCategoryPicker();
      };
    });
    $('#record-form').onsubmit = submitRecord;
    $('#record-cancel').onclick = resetRecordForm;

    // 明细筛选
    $('#filter-month').onchange = function () { state.recordPage = 1; loadRecords(); };
    $('#filter-type').onchange = function () { state.recordPage = 1; loadRecords(); };
    $('#filter-category').onchange = function () { state.recordPage = 1; loadRecords(); };
    $('#filter-keyword').oninput = debounce(function () { state.recordPage = 1; loadRecords(); }, 400);
  $('#btn-export').onclick = exportRecords;
    $('#page-prev').onclick = function () { if (state.recordPage > 1) { state.recordPage--; loadRecords(); } };
    $('#page-next').onclick = function () {
      var totalPages = Math.max(1, Math.ceil(state.recordTotal / state.recordPageSize));
      if (state.recordPage < totalPages) { state.recordPage++; loadRecords(); }
    };

    // 统计月份
    $('#stats-month').onchange = renderStats;
    // 预算月份
    $('#budget-month').onchange = renderBudget;
    $('#budget-form').onsubmit = function (e) {
      e.preventDefault();
      var cat = Number($('#budget-category').value);
      var amount = $('#budget-amount').value;
      if (!cat) { toast('请选择分类'); return; }
      saveBudget(cat, amount, $('#budget-month').value || currentMonthStr());
      $('#budget-amount').value = '';
    };

    // 新建账本
    $('#ledger-form').onsubmit = function (e) {
      e.preventDefault();
      var name = $('#ledger-name').value.trim();
      if (!name) { toast('请输入账本名称'); return; }
      api('/ledgers', { method: 'POST', body: { name: name } }).then(function () {
        $('#ledger-name').value = '';
        toast('账本已创建');
        return refreshAll();
      }).catch(function (err) { toast(err.message); });
    };

    // 新增分类
    $('#cat-form').onsubmit = function (e) {
      e.preventDefault();
      var name = $('#cat-name').value.trim();
      if (!name) { toast('请输入分类名称'); return; }
      api('/categories', {
        method: 'POST',
        body: { name: name, type: $('#cat-type').value, icon: $('#cat-icon').value.trim() || '📌' },
      }).then(function () {
        $('#cat-name').value = '';
        $('#cat-icon').value = '';
        toast('分类已添加');
        return loadCategories();
      }).then(function () {
        renderCategoryPicker();
        fillCategoryFilter();
        fillBudgetCategory();
        renderCategories();
      }).catch(function (err) { toast(err.message); });
    };

    window.addEventListener('resize', function () {
      Object.keys(state.charts).forEach(function (k) {
        if (state.charts[k]) state.charts[k].resize();
      });
    });
  }

  function debounce(fn, ms) {
    var t = null;
    return function () {
      clearTimeout(t);
      t = setTimeout(fn, ms);
    };
  }

  // ================= 启动 =================
  bindEvents();
  if (state.token) {
    bootApp();
  } else {
    showLogin();
  }
})();
