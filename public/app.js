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

  function fmt(cents) {
    var v = (cents / 100).toFixed(2);
    var parts = v.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return '¥' + parts.join('.');
  }

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
  // 自定义输入弹窗（替代原生 prompt）
  function inputDialog(title, placeholder, defaultValue, isText) {
    return new Promise(function (resolve) {
      var mask = document.createElement('div');
      mask.className = 'modal-mask';
      mask.style.cssText = 'z-index:9999;';
      var typeAttr = isText ? 'type="text"' : 'type="number" step="0.01" min="0.01"';
      var phAttr = placeholder ? ' placeholder="' + esc(placeholder) + '"' : '';
      mask.innerHTML =
        '<div class="modal" style="max-width:340px;padding:24px;">' +
        '<div style="font-size:16px;font-weight:700;margin-bottom:14px;">' + esc(title) + '</div>' +
        '<input ' + typeAttr + ' id="id-input" value="' + esc(String(defaultValue == null ? '' : defaultValue)) + '"' + phAttr + ' style="margin-bottom:14px;">' +
        '<div style="display:flex;gap:10px;">' +
        '<button type="button" class="btn ghost" style="flex:1;" id="id-cancel">取消</button>' +
        '<button type="button" class="btn primary" style="flex:1;" id="id-ok">确定</button>' +
        '</div></div>';
      document.body.appendChild(mask);
      var input = mask.querySelector('#id-input');
      input.focus();
      input.select();
      var done = function (val) {
        if (mask.parentNode) mask.parentNode.removeChild(mask);
        resolve(val);
      };
      mask.querySelector('#id-ok').onclick = function () { done(input.value); };
      mask.querySelector('#id-cancel').onclick = function () { done(null); };
      input.addEventListener('keydown', function (e) { if (e.key === 'Enter') done(input.value); });
      mask.addEventListener('click', function (e) { if (e.target === mask) done(null); });
    });
  }

  // 自定义确认弹窗（替代原生 confirm，视觉统一）
  function confirmDialog(msg) {
    return new Promise(function (resolve) {
      var mask = document.createElement('div');
      mask.className = 'modal-mask';
      mask.style.cssText = 'z-index:9999;';
      mask.innerHTML =
        '<div class="modal" style="max-width:340px;padding:24px;text-align:center;">' +
        '<div style="font-size:34px;margin-bottom:10px;">🤔</div>' +
        '<div style="font-size:15px;margin-bottom:18px;line-height:1.6;">' + msg + '</div>' +
        '<div style="display:flex;gap:10px;">' +
        '<button type="button" class="btn ghost" style="flex:1;" id="cf-cancel">取消</button>' +
        '<button type="button" class="btn danger" style="flex:1;" id="cf-ok">确定</button>' +
        '</div></div>';
      document.body.appendChild(mask);
      var done = function (val) {
        if (mask.parentNode) mask.parentNode.removeChild(mask);
        resolve(val);
      };
      mask.querySelector('#cf-ok').onclick = function () { done(true); };
      mask.querySelector('#cf-cancel').onclick = function () { done(false); };
      mask.addEventListener('click', function (e) { if (e.target === mask) done(false); });
    });
  }

  function toast(msg) {
    var el = $('#toast');
    // 识别成功/错误类型，加图标
    var icon = '';
    var isErr = /失败|错误|异常|无法|请先|不存在|频繁/.test(msg);
    var isOk = /成功|已保存|已删除|已复制|已更新/.test(msg);
    if (isErr) icon = '⚠️ ';
    else if (isOk) icon = '✅ ';
    el.textContent = icon + msg;
    el.classList.remove('hidden');
    el.classList.toggle('toast-err', isErr);
    el.classList.toggle('toast-ok', isOk);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.add('hidden'); }, 2400);
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
    // 预填上次用户名
    var ru = localStorage.getItem('jz_remember_user');
    var lu = $('#login-username');
    if (ru && lu && !lu.value) lu.value = ru;
    // 动态问候
    var sub = document.querySelector('.login-card .sub');
    if (sub) {
      var h = new Date().getHours();
      var greet = h < 6 ? '夜深了 🌙' : h < 12 ? '早上好 ☀️' : h < 18 ? '下午好 🌤️' : '晚上好 🌙';
      sub.textContent = greet + ' · 多账本 · 预算管理 · 统计报表';
    }
  }

  function doLogin(username, password) {
    $('#login-hint').textContent = '';
    api('/auth/login', { method: 'POST', body: { username: username, password: password } })
      .then(function (data) {
        state.token = data.token;
        localStorage.setItem('jz_token', data.token);
        if (data.user) {
          localStorage.setItem('jz_username', data.user.username || '');
          localStorage.setItem('jz_nickname', data.user.nickname || '');
          localStorage.setItem('jz_remember_user', data.user.username || '');
        }
        // 登录成功过渡：卡片淡出 → 主界面淡入
        var lv = $('#login-view');
        if (lv && !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)) {
          lv.style.transition = 'opacity .35s ease';
          lv.style.opacity = '0';
          setTimeout(function () { bootApp(); }, 320);
        } else {
          bootApp();
        }
      })
      .catch(function (e) {
        $('#login-hint').textContent = e.message;
        var card = $('#login-view .login-card');
        if (card) {
          card.classList.remove('shake');
          void card.offsetWidth;
          card.classList.add('shake');
          setTimeout(function () { card.classList.remove('shake'); }, 500);
        }
      });
  }

  function doRegister(username, password, nickname) {
    $('#login-hint').textContent = '';
    api('/auth/register', { method: 'POST', body: { username: username, password: password, nickname: nickname } })
      .then(function (data) {
        state.token = data.token;
        localStorage.setItem('jz_token', data.token);
        if (data.user) {
          localStorage.setItem('jz_username', data.user.username || '');
          localStorage.setItem('jz_nickname', data.user.nickname || '');
          localStorage.setItem('jz_remember_user', data.user.username || '');
        }
        bootApp();
      })
      .catch(function (e) { $('#login-hint').textContent = e.message; });
  }

  // ================= 启动 =================
  function setFooter() {
    var fv = $('#footer-version');
    if (fv) fv.textContent = 'v1.0 · ' + new Date().getFullYear();
  }

  function hideSplash() {
    var sp = document.getElementById('splash');
    if (sp) { sp.classList.add('hide'); setTimeout(function () { sp.remove(); }, 600); }
  }

  async function bootApp() {
    hideSplash();
    setFooter();
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
      hideSplash();
      showLogin();
    }
  }

  // ================= 用户菜单（个人中心 / 模型） =================
  function switchPmPanel(name) {
    var isProfile = name === 'profile';
    $('#pm-tab-profile').classList.toggle('active', isProfile);
    $('#pm-tab-models').classList.toggle('active', !isProfile);
    $('#pm-panel-profile').classList.toggle('hidden', !isProfile);
    $('#pm-panel-models').classList.toggle('hidden', isProfile);
    $('#pm-title').textContent = isProfile ? '个人中心' : '模型';
    if (!isProfile) loadAiSettings();
  }

  function openProfile() {
    var u = state.user || {};
    $('#profile-username').textContent = u.username || '';
    $('#profile-created').textContent = u.created_at ? u.created_at.slice(0, 10) : '';
    $('#profile-stats').textContent = (state.ledgers ? state.ledgers.length : 0) + ' 账本 · ' + (state.categories ? state.categories.length : 0) + ' 分类';
    $('#profile-nickname').value = u.nickname || '';
    $('#profile-old-password').value = '';
    $('#profile-new-password').value = '';
    $('#profile-confirm-password').value = '';
    // 头像卡
    var av = $('#pm-avatar');
    var initial = (u.nickname || u.username || '?').charAt(0).toUpperCase();
    if (av) av.textContent = initial;
    var nm = $('#pm-user-name');
    if (nm) nm.textContent = (u.nickname || u.username || '未命名') + (u.nickname ? ' 👋' : '');
    var sub = $('#pm-user-sub');
    if (sub) sub.textContent = (u.username || '') + ' · 加入于 ' + (u.created_at ? u.created_at.slice(0, 10) : '—');
    $('#profile-modal').classList.remove('hidden');
    switchPmPanel('profile');
  }

  function closeProfile() {
    $('#profile-modal').classList.add('hidden');
  }

  // ================= AI 设置（多供应商） =================
  var aiProviders = [];
  var aiExpandedId = null; // 当前展开的供应商卡片（声明在 renderAiProviderList 前）

  function loadAiSettings() {
    return api('/ai/providers').then(function (data) {
      aiProviders = data.providers || [];
      renderAiProviderList();
      renderAiModelSelect();
      return data;
    }).catch(function () { return null; });
  }

  function renderAiProviderList() {
    var box = $('#ai-provider-list');
    if (!box) return;
    if (!aiProviders.length) {
      box.innerHTML = '<div class="pm-empty">还没有配置模型供应商<br>点击下方「＋ 添加供应商」开始</div>';
      $('#ai-key-hint').textContent = '支持 DeepSeek / OpenAI / 自定义接口，每个供应商可配多个模型';
      return;
    }
    var html = [];
    aiProviders.forEach(function (p) {
      var src = p.source === 'user' ? '我的' : p.source === 'file' ? '配置' : '环境';
      var dot = p.api_key_set ? 'ok' : 'missing';
      var expanded = aiExpandedId === p.id;
      html.push('<div class="pm-provider-item">');
      html.push(
        '<div class="pm-provider-row" data-ai-toggle="' + p.id + '">' +
        '<span class="pm-key-dot ' + dot + '" title="' + (p.api_key_set ? 'API Key 已配置' : '缺少 API Key') + '"></span>' +
        '<div class="pm-provider-main">' +
        '<div class="pm-provider-name">' + esc(p.name) + ' <span class="muted">(' + src + ')</span>' + (p.enabled ? '' : ' <span class="muted">已停用</span>') + '</div>' +
        '<div class="pm-provider-meta">' + esc(p.provider) + (p.base_url ? ' · ' + esc(p.base_url) : '') + ' · ' + (p.models || []).length + ' 个模型</div>' +
        '</div>' +
        '<div class="pm-row-actions">' +
        (p.source === 'user'
          ? '<button type="button" class="btn danger sm" data-ai-del="' + p.id + '">删除</button>'
          : '<span class="muted sm">只读</span>') +
        '</div>' +
        '</div>'
      );
      if (expanded) {
        html.push(renderProviderCard(p));
      }
      html.push('</div>');
    });
    box.innerHTML = html.join('');
    // 行点击展开/收起
    box.querySelectorAll('[data-ai-toggle]').forEach(function (r) {
      r.onclick = function () {
        var id = r.dataset.aiToggle;
        aiExpandedId = aiExpandedId === id ? null : id;
        renderAiProviderList();
      };
    });
    // 删除
    box.querySelectorAll('[data-ai-del]').forEach(function (b) {
      b.onclick = function (e) {
        e.stopPropagation();
        confirmDialog('确定删除该供应商吗？').then(function (ok) {
          if (!ok) return;
          var id = b.dataset.aiDel.replace('db:', '');
          api('/ai/providers/' + id, { method: 'DELETE' }).then(function () {
            toast('已删除');
            if (aiExpandedId === b.dataset.aiDel) aiExpandedId = null;
            loadAiSettings();
          }).catch(function (e) { toast(e.message); });
        });
      };
    });
    // 展开卡片内事件
    var expanded = aiExpandedId ? aiProviders.filter(function (p) { return p.id === aiExpandedId; })[0] : null;
    if (expanded) bindProviderCard(expanded);
  }

  // 渲染一个供应商的展开编辑卡片（DSH 风格：API Key + baseURL + 模型编辑器）
  function renderProviderCard(p) {
    var s = '';
    s += '<div class="pm-provider-card">';
    s += '<div class="pm-card-label">供应商</div>';
    s += '<div class="pm-model-inputs">' +
      '<input type="text" data-pf="name" value="' + esc(p.name) + '" placeholder="显示名称">' +
      '<select data-pf="provider">' +
      '<option value="deepseek"' + (p.provider === 'deepseek' ? ' selected' : '') + '>DeepSeek</option>' +
      '<option value="openai"' + (p.provider === 'openai' ? ' selected' : '') + '>OpenAI</option>' +
      '<option value="custom"' + (p.provider === 'custom' ? ' selected' : '') + '>自定义（OpenAI 兼容）</option>' +
      '</select>' +
      '<input type="text" data-pf="base_url" value="' + esc(p.base_url || '') + '" placeholder="接口地址（Base URL）">' +
      '</div>';
    s += '<div class="pm-card-label">API 密钥</div>';
    s += '<div class="pm-model-inputs">' +
      '<input type="password" data-pf="api_key" placeholder="' + (p.api_key_set ? '留空=不修改（当前 ' + esc(p.api_key_masked) + '）' : '请输入 API Key') + '" autocomplete="off">' +
      '</div>';
    s += '<div class="pm-card-label">模型列表</div>';
    s += '<div class="pm-model-inputs" data-model-rows>' +
      (p.models || []).map(function (m) {
        return '<div class="pm-model-row"><input type="text" data-model-id value="' + esc(m) + '" placeholder="模型 ID（如 deepseek-chat）"><button type="button" class="btn ghost sm" data-model-del>✕</button></div>';
      }).join('') +
      '</div>';
    s += '<div style="display:flex;gap:8px">' +
      '<button type="button" class="btn ghost sm" data-model-add>＋ 添加模型</button>' +
      '<button type="button" class="btn ghost sm" data-probe title="向接口询问可用模型">获取模型</button>' +
      '</div>';
    s += '<div class="pm-probe-hint" data-probe-hint></div>';
    s += '<div class="pm-card-btns">' +
      '<button type="button" class="btn primary" data-ai-save>应用</button>' +
      '<button type="button" class="btn ghost" data-ai-cancel>收起</button>' +
      '</div>';
    s += '</div>';
    return s;
  }

  // 绑定展开卡片内的事件（渲染后调用）
  function bindProviderCard(p) {
    var card = document.querySelector('.pm-provider-card');
    if (!card) return;
    // 添加模型
    card.querySelector('[data-model-add]').onclick = function () {
      var rows = card.querySelector('[data-model-rows]');
      var div = document.createElement('div');
      div.className = 'pm-model-row';
      div.innerHTML = '<input type="text" data-model-id placeholder="模型 ID（如 deepseek-chat）"><button type="button" class="btn ghost sm" data-model-del>✕</button>';
      rows.appendChild(div);
      div.querySelector('[data-model-del]').onclick = function () { div.remove(); };
    };
    // 删除模型
    card.querySelectorAll('[data-model-del]').forEach(function (b) {
      b.onclick = function () { b.closest('.pm-model-row').remove(); };
    });
    // 获取模型：向当前端点探测（需 API Key）
    card.querySelector('[data-probe]').onclick = function () {
      var key = card.querySelector('[data-pf="api_key"]').value.trim() || p.api_key;
      var url = (card.querySelector('[data-pf="base_url"]').value.trim() || '').replace(/\/$/, '');
      var hint = card.querySelector('[data-probe-hint]');
      if (!key) { hint.textContent = '请先填写 API Key 再获取模型'; return; }
      if (!url) {
        var prov = card.querySelector('[data-pf="provider"]').value;
        url = prov === 'deepseek' ? 'https://api.deepseek.com' : prov === 'openai' ? 'https://api.openai.com/v1' : '';
        if (!url) { hint.textContent = '自定义接口请先填写 Base URL'; return; }
      }
      hint.textContent = '正在获取模型…';
      fetch(url + '/models', {
        headers: { Authorization: 'Bearer ' + key },
      }).then(function (r) { return r.json(); }).then(function (data) {
        var list = (data && data.data) || [];
        if (!list.length) { hint.textContent = '未获取到模型列表'; return; }
        var ids = list.map(function (m) { return m.id; });
        var rows = card.querySelector('[data-model-rows]');
        rows.innerHTML = '';
        ids.forEach(function (mid) {
          var div = document.createElement('div');
          div.className = 'pm-model-row';
          div.innerHTML = '<input type="text" data-model-id value="' + esc(mid) + '"><button type="button" class="btn ghost sm" data-model-del>✕</button>';
          rows.appendChild(div);
          div.querySelector('[data-model-del]').onclick = function () { div.remove(); };
        });
        hint.textContent = '已获取 ' + ids.length + ' 个模型，可删减后点「应用」';
      }).catch(function (e) {
        hint.textContent = '获取失败：' + (e.message || '网络错误');
      });
    };
    // 保存（应用）
    card.querySelector('[data-ai-save]').onclick = function () {
      var models = Array.prototype.map.call(card.querySelectorAll('[data-model-id]'), function (inp) {
        return inp.value.trim();
      }).filter(Boolean);
      var body = {
        name: card.querySelector('[data-pf="name"]').value.trim() || p.name,
        provider: card.querySelector('[data-pf="provider"]').value,
        base_url: card.querySelector('[data-pf="base_url"]').value.trim(),
        api_key: card.querySelector('[data-pf="api_key"]').value.trim(),
        models: models,
        enabled: p.enabled,
      };
      var req = p.source === 'user'
        ? api('/ai/providers/' + p.id.replace('db:', ''), { method: 'PUT', body: body })
        : api('/ai/providers', { method: 'POST', body: body });
      req.then(function () {
        toast('已应用');
        aiExpandedId = null;
        loadAiSettings();
      }).catch(function (e) { toast(e.message); });
    };
    // 收起
    card.querySelector('[data-ai-cancel]').onclick = function () {
      aiExpandedId = null;
      renderAiProviderList();
    };
  }

  // DSH 风格新增：在列表头部渲染一个"新增供应商"卡片
  function openAiProviderForm() {
    var box = $('#ai-provider-list');
    var card = document.createElement('div');
    card.className = 'pm-provider-card';
    card.id = 'pm-new-card';
    card.innerHTML =
      '<div class="pm-card-label">新增供应商</div>' +
      '<div class="pm-model-inputs">' +
      '<input type="text" data-pf="name" placeholder="显示名称（如：我的 DeepSeek）">' +
      '<select data-pf="provider">' +
      '<option value="deepseek">DeepSeek</option>' +
      '<option value="openai">OpenAI</option>' +
      '<option value="custom">自定义（OpenAI 兼容）</option>' +
      '</select>' +
      '<input type="text" data-pf="base_url" placeholder="接口地址（选预设可留空）">' +
      '<input type="password" data-pf="api_key" placeholder="API Key" autocomplete="off">' +
      '</div>' +
      '<div class="pm-card-label">模型列表</div>' +
      '<div class="pm-model-inputs" data-model-rows>' +
      '<div class="pm-model-row"><input type="text" data-model-id placeholder="模型 ID（如 deepseek-chat）"><button type="button" class="btn ghost sm" data-model-del>✕</button></div>' +
      '</div>' +
      '<div style="display:flex;gap:8px">' +
      '<button type="button" class="btn ghost sm" data-model-add>＋ 添加模型</button>' +
      '<button type="button" class="btn ghost sm" data-probe>获取模型</button>' +
      '</div>' +
      '<div class="pm-probe-hint" data-probe-hint></div>' +
      '<div class="pm-card-btns">' +
      '<button type="button" class="btn primary" data-ai-save>保存</button>' +
      '<button type="button" class="btn ghost" data-ai-cancel>取消</button>' +
      '</div>';
    var old = document.getElementById('pm-new-card');
    if (old) old.remove();
    box.insertBefore(card, box.firstChild);
    // 复用卡片事件绑定（p = 空对象）
    bindNewProviderCard(card);
  }

  function bindNewProviderCard(card) {
    card.querySelector('[data-model-add]').onclick = function () {
      var rows = card.querySelector('[data-model-rows]');
      var div = document.createElement('div');
      div.className = 'pm-model-row';
      div.innerHTML = '<input type="text" data-model-id placeholder="模型 ID"><button type="button" class="btn ghost sm" data-model-del>✕</button>';
      rows.appendChild(div);
      div.querySelector('[data-model-del]').onclick = function () { div.remove(); };
    };
    card.querySelectorAll('[data-model-del]').forEach(function (b) {
      b.onclick = function () { b.closest('.pm-model-row').remove(); };
    });
    card.querySelector('[data-probe]').onclick = function () {
      var key = card.querySelector('[data-pf="api_key"]').value.trim();
      var url = card.querySelector('[data-pf="base_url"]').value.trim().replace(/\/$/, '');
      var hint = card.querySelector('[data-probe-hint]');
      var prov = card.querySelector('[data-pf="provider"]').value;
      if (!key) { hint.textContent = '请先填写 API Key 再获取模型'; return; }
      if (!url) {
        url = prov === 'deepseek' ? 'https://api.deepseek.com' : prov === 'openai' ? 'https://api.openai.com/v1' : '';
        if (!url) { hint.textContent = '自定义接口请先填写 Base URL'; return; }
      }
      hint.textContent = '正在获取模型…';
      fetch(url + '/models', { headers: { Authorization: 'Bearer ' + key } })
        .then(function (r) { return r.json(); }).then(function (data) {
          var list = (data && data.data) || [];
          if (!list.length) { hint.textContent = '未获取到模型列表'; return; }
          var rows = card.querySelector('[data-model-rows]');
          rows.innerHTML = '';
          list.forEach(function (m) {
            var div = document.createElement('div');
            div.className = 'pm-model-row';
            div.innerHTML = '<input type="text" data-model-id value="' + esc(m.id) + '"><button type="button" class="btn ghost sm" data-model-del>✕</button>';
            rows.appendChild(div);
            div.querySelector('[data-model-del]').onclick = function () { div.remove(); };
          });
          hint.textContent = '已获取 ' + list.length + ' 个模型，可删减后保存';
        }).catch(function (e) { hint.textContent = '获取失败：' + (e.message || '网络错误'); });
    };
    card.querySelector('[data-ai-save]').onclick = function () {
      var models = Array.prototype.map.call(card.querySelectorAll('[data-model-id]'), function (inp) {
        return inp.value.trim();
      }).filter(Boolean);
      var body = {
        name: card.querySelector('[data-pf="name"]').value.trim(),
        provider: card.querySelector('[data-pf="provider"]').value,
        base_url: card.querySelector('[data-pf="base_url"]').value.trim(),
        api_key: card.querySelector('[data-pf="api_key"]').value.trim(),
        models: models,
        enabled: true,
      };
      api('/ai/providers', { method: 'POST', body: body })
        .then(function () {
          toast('已保存');
          loadAiSettings();
        }).catch(function (e) { toast(e.message); });
    };
    card.querySelector('[data-ai-cancel]').onclick = function () { card.remove(); };
  }

  function renderAiModelSelect() {
    var sel = $('#ai-model-select');
    if (!sel) return;
    var prev = sel.value;
    sel.innerHTML = '';
    var opts = [];
    aiProviders.forEach(function (p) {
      if (!p.enabled) return;
      (p.models || []).forEach(function (m) {
        opts.push({ value: p.id + '::' + m, label: p.name + ' · ' + m });
      });
    });
    if (!opts.length) {
      var opt = document.createElement('option');
      opt.value = '';
      opt.textContent = '（未配置模型）';
      sel.appendChild(opt);
      return;
    }
    opts.forEach(function (o) {
      var opt = document.createElement('option');
      opt.value = o.value;
      opt.textContent = o.label;
      sel.appendChild(opt);
    });
    if (prev && opts.some(function (o) { return o.value === prev; })) sel.value = prev;
    var tip = document.querySelector('.ai-chat-tips');
    if (tip) {
      var anyKey = aiProviders.some(function (p) { return p.enabled && p.api_key_set; });
      tip.textContent = anyKey
        ? '模型可随时切换；直接说「今天午饭 25 块」即可 AI 记账'
        : '提示：先去「个人中心 → AI 设置」添加供应商并填写 Key';
    }
  }

  // ================= AI 聊天（多轮上下文） =================
  var aiHistory = []; // [{role:'user'|'assistant', content}]

  // AI 文本 → HTML（转义 + 换行 + 简易列表）
  function aiTextHtml(text) {
    var html = esc(text)
      .replace(/\n/g, '<br>')
      .replace(/^(?:\s*[-*]\s+)(.+)$/gm, '<div style="padding-left:14px;position:relative;">• $1</div>');
    return html;
  }

  function appendAiMsg(role, text) {
    var list = $('#ai-chat-list');
    var div = document.createElement('div');
    div.className = 'ai-msg ' + (role === 'user' ? 'ai-user' : 'ai-bot');
    // 头像
    var av = document.createElement('div');
    av.className = 'ai-avatar ' + (role === 'user' ? 'ai-avatar-user' : 'ai-avatar-bot');
    av.textContent = role === 'user' ? '我' : '🤖';
    div.appendChild(av);
    var bubble = document.createElement('div');
    bubble.className = 'ai-bubble';
    bubble.innerHTML = aiTextHtml(text);
    // 时间戳 + 双击复制
    var now = new Date();
    bubble.title = '双击复制 · ' + now.toLocaleTimeString();
    // 长回复折叠（>600 字符，bot 消息）
    if (role === 'bot' && text.length > 600) {
      bubble.classList.add('ai-long');
      var toggle = document.createElement('div');
      toggle.className = 'ai-more';
      toggle.textContent = '展开全文 ↓';
      toggle.onclick = function (e) {
        e.stopPropagation();
        bubble.classList.toggle('ai-expanded');
        toggle.textContent = bubble.classList.contains('ai-expanded') ? '收起 ↑' : '展开全文 ↓';
      };
      bubble.appendChild(toggle);
    }
    bubble.addEventListener('dblclick', function () {
      var raw = text.replace(/<[^>]*>/g, '');
      var ta = document.createElement('textarea');
      ta.value = raw;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); toast('已复制'); } catch (e) {}
      document.body.removeChild(ta);
    });
    div.appendChild(bubble);
    list.appendChild(div);
    list.scrollTop = list.scrollHeight;
  }

  function clearAiChat() {
    aiHistory = [];
    var list = $('#ai-chat-list');
    list.innerHTML = '';
    appendAiMsg('bot', '你好！我是 AI 记账助手 🤖<br>对话已清空。可以直接说「今天午饭花了 25 块」帮你记账，也可以问我「这个月花了多少」。<br><br><span style="opacity:.75;font-size:12px;">玩法：📖 账单故事 · 🎁 本周盲盒 · 💰 攒钱模拟</span>');
    updateAiCount();
  }

  function updateAiCount() {
    var el = $('#ai-count');
    if (el) el.textContent = aiHistory.length ? '已记住 ' + Math.ceil(aiHistory.length / 2) + ' 轮对话' : '新对话';
  }

  // ================= 玩法：账单故事 / 盲盒周报 / 攒钱模拟 =================
  function aiAskWith(prompt) {
    // 用当前模型把 prompt 发给 AI，返回 Promise(reply)
    var sel = $('#ai-model-select');
    var mv = sel ? sel.value : '';
    var providerId = null, model = null;
    if (mv && mv.indexOf('::') > 0) { providerId = mv.split('::')[0]; model = mv.split('::')[1]; }
    return api('/ai/chat', {
      method: 'POST',
      body: { message: prompt, ledger_id: state.currentLedgerId, provider_id: providerId, model: model, messages: [] },
    }).then(function (d) { return (d && d.reply) || '（无回复）'; });
  }

  // 📖 账单故事：拉上月/本月数据 → AI 生成叙事
  function playStory() {
    var sb = $('#ai-play-story');
    if (sb) { sb.disabled = true; sb.textContent = '⏳ 生成中…'; }
    var fin = function () { if (sb) { sb.disabled = false; sb.textContent = '📖 账单故事'; } };
    appendAiMsg('user', '📖 生成我的账单故事');
    appendAiMsg('bot', '正在整理你的账单数据…');
    var last = $('#ai-chat-list .ai-msg:last-child .ai-bubble');
    var month = currentMonthStr();
    // 生成上月的故事
    var d = new Date();
    var prev = new Date(d.getFullYear(), d.getMonth() - 1, 1);
    var prevMonth = prev.getFullYear() + '-' + String(prev.getMonth() + 1).padStart(2, '0');
    api('/stats/story-data?ledger_id=' + state.currentLedgerId + '&month=' + prevMonth)
      .then(function (data) {
        if (!data || !data.expense && !data.income) {
          pendingMsg(last, '这个月还没有记账数据，先去记几笔再来生成故事吧 📝');
          return;
        }
        var prompt = buildStoryPrompt(prevMonth, data);
        pendingMsg(last, '📖 正在写你的账单故事…');
        return aiAskWith(prompt);
      })
      .then(function (reply) {
        if (reply) pendingMsg(last, reply);
        fin();
      })
      .catch(function (e) { pendingMsg(last, '生成失败：' + e.message); fin(); });
  }

  function buildStoryPrompt(month, data) {
    var topCats = (data.top_categories || []).map(function (c) { return c.icon + c.name + ' ' + (c.amount / 100).toFixed(0) + '元(' + c.count + '笔)'; }).join('、');
    var lines = [
      '请根据以下我的上月（' + month + '）记账数据，写一封温暖、有趣、有生活感的"个人账单故事信"（300字以内，用中文，第一人称"我"）。',
      '要提到具体数字和细节，像朋友聊天一样自然，可以带一点幽默和鼓励。',
      '数据：',
      '总收入 ' + (data.income / 100).toFixed(0) + ' 元，总支出 ' + (data.expense / 100).toFixed(0) + ' 元，共 ' + data.record_count + ' 笔。',
      '日均支出 ' + (data.avg_daily_expense / 100).toFixed(0) + ' 元，有消费的天数 ' + data.spend_days + '/' + data.total_days + ' 天。',
      data.top_categories.length ? '支出分类 Top：' + topCats + '。' : '',
      data.peak_day ? '花钱最多的一天是 ' + data.peak_day.date + '，花了 ' + (data.peak_day.amount / 100).toFixed(0) + ' 元。' : '',
      data.most_expense ? '单笔最大支出：' + (data.most_expense.note || '无备注') + '（' + (data.most_expense.icon || '') + data.most_expense.category + '）' + (data.most_expense.amount / 100).toFixed(0) + ' 元，' + data.most_expense.date + '。' : '',
      '开头可以写"亲爱的记账人"，结尾给一句鼓励。不要出现"AI""模型"等字眼。',
    ];
    return lines.filter(Boolean).join('\n');
  }

  // 🎁 本周盲盒：拉周报数据 → AI 解读成"盲盒卡"
  function playBlind() {
    var bb = $('#ai-play-blind');
    if (bb) { bb.disabled = true; bb.textContent = '⏳ 开盒中…'; }
    var finb = function () { if (bb) { bb.disabled = false; bb.textContent = '🎁 本周盲盒'; } };
    appendAiMsg('user', '🎁 打开本周盲盒');
    appendAiMsg('bot', '正在准备本周盲盒…');
    var last = $('#ai-chat-list .ai-msg:last-child .ai-bubble');
    api('/stats/weekly-review?ledger_id=' + state.currentLedgerId)
      .then(function (data) {
        if (!data || !data.total_expense) {
          pendingMsg(last, '本周还没记账，盲盒是空的 🎁 记几笔再来开！');
          return;
        }
        var prompt = buildBlindPrompt(data);
        pendingMsg(last, '🎁 正在打开本周盲盒…');
        return aiAskWith(prompt);
      })
      .then(function (reply) {
        if (reply) pendingMsg(last, reply);
        finb();
      })
      .catch(function (e) { pendingMsg(last, '盲盒失败：' + e.message); finb(); });
  }

  function buildBlindPrompt(data) {
    var lines = [
      '这是一份我本周的消费盲盒数据（' + data.week + '），请把它包装成一张有趣好玩的"盲盒开箱卡"（200字内，中文，俏皮一点）：',
      '本周总支出 ' + (data.total_expense / 100).toFixed(0) + ' 元，共 ' + data.record_count + ' 笔。',
      data.most ? '最贵一单：' + (data.most.note || data.most.category) + ' ' + (data.most.amount / 100).toFixed(0) + ' 元（' + data.most.date + '）。' : '',
      data.cheapest ? '最便宜一单：' + (data.cheapest.note || data.cheapest.category) + ' ' + (data.cheapest.amount / 100).toFixed(2) + ' 元。' : '',
      data.peak_day ? '花钱最多的一天：' + data.peak_day.date + '，' + (data.peak_day.amount / 100).toFixed(0) + ' 元。' : '',
      data.top_category ? '出现最多的是：' + data.top_category.icon + data.top_category.name + '（' + data.top_category.count + '次）。' : '',
      '格式：开头"本周盲盒 🎁"，中间列亮点，结尾一句吐槽或鼓励。',
    ];
    return lines.filter(Boolean).join('\n');
  }

  // 💰 攒钱模拟：提示用户输入假设，AI 计算
  function playSave() {
    appendAiMsg('user', '💰 打开攒钱模拟器');
    appendAiMsg('bot', '告诉我你的"攒钱计划"，比如：<br>「每天少喝一杯 20 元的咖啡，想攒 5000 元去旅行」<br>或「每月省下 500 元，多久能攒 2 万？」');
    // 聚焦输入框，提示输入攒钱计划
    var input = $('#ai-chat-input');
    input.value = '';
    input.placeholder = '输入你的攒钱计划，如：每天少喝一杯20元咖啡，想攒5000元…';
    input.focus();
  }

  function pendingMsg(el, text) {
    if (!el) return;
    el.textContent = '';
    el.innerHTML = aiTextHtml(text);
  }

  var aiSending = false;
  function sendAiMessage() {
    if (aiSending) { toast('AI 正在回复，请稍候…'); return; }
    var input = $('#ai-chat-input');
    var text = input.value.trim();
    if (!text) return;
    input.value = '';
    input.style.height = 'auto';
    appendAiMsg('user', text);
    appendAiMsg('bot', '<span class="ai-thinking"><i></i><i></i><i></i></span>');
    aiSending = true;
    var sendBtn0 = $('#ai-send');
    if (sendBtn0) { sendBtn0.disabled = true; sendBtn0.textContent = '…'; }
    // 60 秒超时保护
    var timeoutId = setTimeout(function () {
      if (aiSending) {
        pendingMsg(pending, '⏱️ 请求超时（60秒），请重试');
        aiSending = false;
        if (sendBtn0) { sendBtn0.disabled = false; sendBtn0.textContent = '➤ 发送'; }
      }
    }, 60000);
    var _finalize = function () { clearTimeout(timeoutId); };

    var sel = $('#ai-model-select');
    var mv = sel ? sel.value : '';
    var providerId = null, model = null;
    if (mv && mv.indexOf('::') > 0) {
      providerId = mv.split('::')[0];
      model = mv.split('::')[1];
    }
    var last = $('#ai-chat-list .ai-msg:last-child .ai-bubble');
    var pending = last;
    api('/ai/chat', {
      method: 'POST',
      body: { message: text, ledger_id: state.currentLedgerId, provider_id: providerId, model: model, messages: aiHistory },
    })
      .then(function (data) {
        pending.textContent = '';
        pending.innerHTML = aiTextHtml(data.reply || '完成');
        // 记录到上下文历史（用户 + 助手）
        aiHistory.push({ role: 'user', content: text });
        aiHistory.push({ role: 'assistant', content: data.reply || '完成' });
        updateAiCount();
        if (data.tool_results && data.tool_results.length) {
          var acted = data.tool_results.filter(function (t) { return t.name === 'add_record'; });
          if (acted.length) {
            loadRecords(); if (state.user) refreshAll();
            // 视觉反馈：在回复后追加记账确认标记
            var mark = document.createElement('div');
            mark.className = 'ai-record-mark';
            mark.textContent = '✅ 已为你记入 ' + acted.length + ' 笔';
            pending.appendChild(mark);
          }
        }
      })
      .catch(function (e) {
        pending.textContent = '';
        pending.innerHTML = aiTextHtml(e.message);
      })
      .finally(function () {
        if (typeof _finalize === 'function') _finalize();
        aiSending = false;
        var sendBtn = $('#ai-send');
        if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = '➤ 发送'; }
      });
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
    // 动态页面标题
    var cur = null;
    state.ledgers.forEach(function (l) { if (l.id === state.currentLedgerId) cur = l; });
    document.title = cur ? '📒 ' + cur.name + ' · 记账本' : '记账本';
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
        // 选中后聚焦备注（快速记账）
        if (state.selectedCategoryId) {
          setTimeout(function () { var n = $('#record-note'); if (n) n.focus(); }, 50);
        }
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
    var btn = $('#record-submit');
    var orig = btn.textContent;
    btn.disabled = true;
    btn.innerHTML = '<span class="btn-spin"></span> 保存中…';
    var p = isEdit
      ? api('/records/' + state.editingRecordId, { method: 'PUT', body: body })
      : api('/records', { method: 'POST', body: body });
    p.then(function () {
      toast(isEdit ? '已保存修改' : '已记一笔 ✅');
      resetRecordForm();
      loadRecords();
    }).catch(function (err) {
      toast(err.message);
    }).finally(function () {
      btn.disabled = false;
      btn.textContent = orig;
    });
  }

  function loadRecords() {
    var box = $('#record-list');
    // 有筛选时显示清除按钮
    var clearBtn = $('#btn-clear-filter');
    if (clearBtn) {
      var hasFilter = $('#filter-month').value || $('#filter-type').value || $('#filter-category').value || $('#filter-keyword').value.trim();
      clearBtn.classList.toggle('hidden', !hasFilter);
    }
    if (box && !box.querySelector('.record-item')) {
      box.innerHTML = '<div class="skeleton-list">' +
        '<div class="sk-item"><div class="sk-icon"></div><div class="sk-lines"><div class="sk-line w60"></div><div class="sk-line w30"></div></div><div class="sk-amt"></div></div>' +
        '<div class="sk-item"><div class="sk-icon"></div><div class="sk-lines"><div class="sk-line w60"></div><div class="sk-line w30"></div></div><div class="sk-amt"></div></div>' +
        '<div class="sk-item"><div class="sk-icon"></div><div class="sk-lines"><div class="sk-line w60"></div><div class="sk-line w30"></div></div><div class="sk-amt"></div></div>' +
        '</div>';
    }
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
      // 月份小计（仅当月筛选时）+ 今日支出
      if (month) {
        api('/stats/summary?ledger_id=' + state.currentLedgerId + '&month=' + month).then(function (s) {
          var box = $('#record-list');
          if (!box) return;
          var old = box.querySelector('.record-month-total');
          if (old) old.remove();
          var el = document.createElement('div');
          el.className = 'record-month-total';
          var todayStr = new Date().toISOString().slice(0, 10);
          var todaySpent = 0;
          state.lastItems.forEach(function (r) {
            if (r.record_date === todayStr && r.type === 'expense') todaySpent += r.amount;
          });
          el.textContent = '📅 本月支出 ' + fmt(s.expense) + ' · 收入 ' + fmt(s.income) + (todaySpent ? ' · 今日支出 ' + fmt(todaySpent) : '');
          box.insertBefore(el, box.firstChild);
        }).catch(function () {});
      }
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
        toast('CSV 已导出 📄');
      })
      .catch(function (e) { toast(e.message); });
  }

  function renderRecordList() {
    var box = $('#record-list');
    if (state.lastItems.length === 0) {
      box.innerHTML = '<div class="empty empty-records">暂无记录，记一笔吧 📝<br><button type="button" class="btn primary sm" style="margin-top:10px;" id="empty-go-record">去记一笔 →</button></div>';
      var goBtn = box.querySelector('#empty-go-record');
      if (goBtn) goBtn.onclick = function () {
        $('#record-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
        $('#record-amount').focus();
      };
    } else {
      var html = [];
      var lastDate = '';
      state.lastItems.forEach(function (r) {
        // 按日期分组：新日期插入分组标题
        if (r.record_date !== lastDate) {
          lastDate = r.record_date;
          html.push('<div class="record-date-group">' + esc(lastDate) + '</div>');
        }
        var icon = r.category_icon || '📌';
        var name = r.category_name || '未分类';
        var cls = r.type === 'income' ? 'income' : 'expense';
        html.push(
          '<div class="record-item">' +
          '<div class="r-icon ' + cls + '">' + esc(icon) + '</div>' +
          '<div class="r-main">' +
          '<div class="r-name">' + esc(name) + (r.note ? ' · ' + esc(r.note) : '') + '</div>' +
          '<div class="r-note"><span class="r-dot ' + cls + '"></span>' + (r.type === 'income' ? '收入' : '支出') + '</div>' +
          '</div>' +
          '<div class="r-amount ' + cls + '" title="点击复制金额" style="cursor:pointer;">' + (r.type === 'income' ? '+' : '-') + fmt(r.amount) + '</div>' +
          '<div class="r-actions">' +
          '<button type="button" class="btn ghost sm" data-act="edit" data-id="' + r.id + '" title="编辑">✏️<span class="txt"> 编辑</span></button>' +
          '<button type="button" class="btn danger sm" data-act="del" data-id="' + r.id + '" title="删除">🗑️<span class="txt"> 删</span></button>' +
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
      box.querySelectorAll('.r-amount').forEach(function (el) {
        el.addEventListener('click', function () {
          var raw = el.textContent.replace(/[^0-9.\-]/g, '');
          var ta = document.createElement('textarea');
          ta.value = raw;
          document.body.appendChild(ta);
          ta.select();
          try { document.execCommand('copy'); toast('已复制金额 ' + raw); } catch (e) {}
          document.body.removeChild(ta);
        });
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
    confirmDialog('确定删除这条记录吗？').then(function (ok) {
      if (!ok) return;
      api('/records/' + id, { method: 'DELETE' }).then(function () {
        toast('已删除');
        loadRecords();
      }).catch(function (e) { toast(e.message); });
    });
  }

  function renderTypeToggle() {
    document.querySelectorAll('.type-toggle button').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.type === state.recordType);
    });
    // 表单类型 class（金额框边框联动）
    var form = document.getElementById('record-form');
    if (form) {
      form.classList.toggle('record-form-expense', state.recordType === 'expense');
      form.classList.toggle('record-form-income', state.recordType === 'income');
    }
  }

  // ================= 统计 =================
  // 大数缩写（统计卡）
  function fmtBig(cents) {
    var v = cents / 100;
    if (v >= 100000000) return (v / 100000000).toFixed(1) + ' 亿';
    if (v >= 10000) return (v / 10000).toFixed(1) + ' 万';
    return fmt(cents);
  }

  // 数字滚动动画（尊重系统减少动态效果）
  function animateNum(el, target) {
    if (!el) return;
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { el.textContent = fmt(target); return; }
    var from = 0, dur = 600, start = null;
    function step(ts) {
      if (!start) start = ts;
      var p = Math.min(1, (ts - start) / dur);
      p = 1 - Math.pow(1 - p, 3); // easeOutCubic
      el.textContent = fmt(Math.round(from + (target - from) * p));
      if (p < 1) requestAnimationFrame(step);
      else {
        el.textContent = fmtBig(target);
        el.title = '完整金额: ' + fmt(target);
        el.style.cursor = 'help';
      }
    }
    requestAnimationFrame(step);
  }

  var trendView = 'bar'; // bar | line
  function renderStats() {
    var month = $('#stats-month').value || currentMonthStr();
    // 非本月时显示"本月"按钮
    var todayBtn = $('#stats-month-today');
    if (todayBtn) todayBtn.classList.toggle('hidden', month === currentMonthStr());
    // 加载占位
    var trendEl = $('#chart-trend');
    if (trendEl && !trendEl.innerHTML) trendEl.innerHTML = '<div class="empty">加载中…</div>';
    Promise.all([
      api('/stats/summary?ledger_id=' + state.currentLedgerId + '&month=' + month),
      api('/stats/monthly?ledger_id=' + state.currentLedgerId + '&months=12'),
      api('/stats/by-category?ledger_id=' + state.currentLedgerId + '&month=' + month + '&type=expense'),
      api('/stats/daily?ledger_id=' + state.currentLedgerId + '&month=' + month),
    ]).then(function (rs) {
      var summary = rs[0], monthly = rs[1], byCat = rs[2], daily = rs[3];
      if (!summary.expense && !summary.income && !summary.record_count) {
        $('#stat-income').textContent = '—';
        $('#stat-expense').textContent = '—';
        $('#stat-net').textContent = '—';
        $('#stat-count').textContent = '本月无记录';
      } else {
        animateNum($('#stat-income'), summary.income);
        animateNum($('#stat-expense'), summary.expense);
        animateNum($('#stat-net'), summary.net);
        $('#stat-count').textContent = summary.record_count + ' 笔';
      }
      // 结余卡点击循环显示（结余→支出→收入）
      var netEl = $('#stat-net');
      if (netEl && !netEl.dataset.bound) {
        netEl.dataset.bound = '1';
        var mode = 'net';
        netEl.title = '点击切换：结余 / 支出 / 收入';
        netEl.style.cursor = 'pointer';
        netEl.addEventListener('click', function () {
          mode = mode === 'net' ? 'expense' : mode === 'expense' ? 'income' : 'net';
          if (mode === 'net') { netEl.textContent = fmtBig(summary.net); netEl.className = 'value'; }
          else if (mode === 'expense') { netEl.textContent = fmtBig(summary.expense); netEl.className = 'value expense'; }
          else { netEl.textContent = fmtBig(summary.income); netEl.className = 'value income'; }
        });
      }
      // 环比（与上月对比）
      function deltaPct(cur, prev) {
        if (!prev || prev <= 0) return null;
        return Math.round((cur - prev) / prev * 100);
      }
      var prevM = monthly.length >= 2 ? monthly[monthly.length - 2] : null;
      var dIn = deltaPct(summary.income, prevM ? prevM.income : 0);
      var dOut = deltaPct(summary.expense, prevM ? prevM.expense : 0);
      function deltaHtml(d, upIsBad) {
        if (d === null) return '';
        var up = d >= 0;
        var good = upIsBad ? !up : up;
        var color = good ? 'var(--income)' : 'var(--expense)';
        var arrow = up ? '▲' : '▼';
        return ' <span style="font-size:11px;color:' + color + '">' + arrow + ' ' + Math.abs(d) + '%</span>';
      }
      var inHint = $('#stat-income').parentNode.querySelector('.hint');
      var outHint = $('#stat-expense').parentNode.querySelector('.hint');
      if (inHint) inHint.innerHTML = '环比上月' + deltaHtml(dIn, false);
      if (outHint) outHint.innerHTML = '环比上月' + deltaHtml(dOut, true);
      var budgetEl = $('#stat-budget');
      if (summary.budget) {
        var pct = summary.budget_pct || 0;
        budgetEl.textContent = fmt(summary.budget_spent) + ' / ' + fmt(summary.budget) + '（' + pct + '%）';
        budgetEl.className = 'value' + (pct > 100 ? ' expense' : (pct > 80 ? '' : ''));
        // 迷你进度条
        var mini = budgetEl.parentNode.querySelector('.stat-mini-bar');
        if (!mini) {
          mini = document.createElement('div');
          mini.className = 'stat-mini-bar';
          budgetEl.parentNode.appendChild(mini);
        }
        mini.innerHTML = '<i style="width:' + Math.min(100, pct) + '%;background:' + (pct > 100 ? 'var(--expense)' : pct > 80 ? 'var(--amber)' : 'var(--primary)') + '"></i>';
      } else {
        budgetEl.textContent = '未设置';
        budgetEl.className = 'value';
        var mini2 = budgetEl.parentNode.querySelector('.stat-mini-bar');
        if (mini2) mini2.remove();
      }
      trendChart(monthly);
      pieChart(byCat);
      dailyChart(daily);
    }).catch(function (e) { toast(e.message); });
  }

  function isDarkTheme() {
    var theme = localStorage.getItem('jz_theme') || 'system';
    if (theme === 'dark') return true;
    if (theme === 'light') return false;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  function chartBase(el) {
    if (typeof echarts === 'undefined') {
      el.innerHTML = '<div class="empty empty-chart">图表库未加载（请检查 vendor/echarts.min.js）</div>';
      return null;
    }
    return echarts.init(el, null, { renderer: 'canvas' });
  }

  // 图表文字颜色（跟随主题）
  function chartTextColor() {
    return isDarkTheme() ? '#c9c2b6' : '#33302b';
  }
  function chartAxisColor() {
    return isDarkTheme() ? '#4a463e' : '#e5e9f0';
  }

  function trendChart(monthly) {
    var el = $('#chart-trend');
    if (!state.charts.trend) {
      var chart = chartBase(el);
      if (!chart) return;
      state.charts.trend = chart;
    }
    var tc = chartTextColor(), ac = chartAxisColor();
    state.charts.trend.setOption({
      textStyle: { color: tc },
      tooltip: { trigger: 'axis', valueFormatter: function (v) { return '¥' + (v / 100).toFixed(2); }, backgroundColor: isDarkTheme() ? '#2a2f3a' : '#fff', borderColor: 'rgba(0,0,0,.08)', textStyle: { color: tc, fontSize: 12 }, extraCssText: 'box-shadow:0 6px 20px rgba(0,0,0,.12);border-radius:10px;padding:8px 12px;' },
      legend: { data: ['收入', '支出'], textStyle: { color: tc } },
      grid: { left: 60, right: 20, top: 40, bottom: 30 },
      xAxis: { type: 'category', data: monthly.map(function (m) { return m.month.slice(2); }), axisLabel: { color: tc }, axisLine: { lineStyle: { color: ac } } },
      yAxis: { type: 'value', axisLabel: { color: tc }, splitLine: { lineStyle: { color: ac } } },
      series: trendView === 'line'
        ? [
            { name: '收入', type: 'line', data: monthly.map(function (m) { return m.income; }), smooth: true, symbolSize: 7, lineStyle: { width: 3, color: '#16a34a' }, itemStyle: { color: '#16a34a' }, areaStyle: { opacity: .12, color: '#16a34a' } },
            { name: '支出', type: 'line', data: monthly.map(function (m) { return m.expense; }), smooth: true, symbolSize: 7, lineStyle: { width: 3, color: '#dc2626' }, itemStyle: { color: '#dc2626' }, areaStyle: { opacity: .1, color: '#dc2626' } },
          ]
        : [
            { name: '收入', type: 'bar', data: monthly.map(function (m) { return m.income; }), barMaxWidth: 16,
              itemStyle: { borderRadius: [5,5,0,0], color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{offset:0,color:'#4ade80'},{offset:1,color:'#16a34a'}] } },
              emphasis: { itemStyle: { shadowBlur: 8, shadowColor: 'rgba(34,197,94,.35)' } } },
            { name: '支出', type: 'bar', data: monthly.map(function (m) { return m.expense; }), barMaxWidth: 16,
              itemStyle: { borderRadius: [5,5,0,0], color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{offset:0,color:'#f87171'},{offset:1,color:'#dc2626'}] } },
              emphasis: { itemStyle: { shadowBlur: 8, shadowColor: 'rgba(244,101,107,.35)' } },
              markLine: { symbol: 'none', lineStyle: { type: 'dashed', color: 'rgba(244,101,107,.5)' }, label: { formatter: '月均支出', color: '#8b96ab', fontSize: 10 }, data: [{ type: 'average' }] } },
          ],
    }, true);
  }

  function pieChart(byCat) {
    var el = $('#chart-pie');
    // 空数据：显示引导
    if (!byCat || byCat.length === 0) {
      if (state.charts.pie) { state.charts.pie.dispose(); state.charts.pie = null; }
      el.innerHTML = '<div class="empty empty-chart">本月暂无支出，先去记一笔吧 💸</div>';
      var tl = $('#pie-top-list');
      if (tl) tl.innerHTML = '';
      return;
    }
    // Top 分类进度列表
    var tl = $('#pie-top-list');
    if (tl) {
      var maxAmt = byCat[0] ? byCat[0].amount : 1;
      tl.innerHTML = byCat.map(function (c) {
        var pct = maxAmt > 0 ? Math.round(c.amount / maxAmt * 100) : 0;
        return '<div class="pie-top-item">' +
          '<span class="pt-icon">' + esc(c.category_icon || '📌') + '</span>' +
          '<span class="pt-name">' + esc(c.category_name || '未分类') + '</span>' +
          '<span class="pt-bar"><i style="width:' + pct + '%"></i></span>' +
          '<span class="pt-val">' + fmt(c.amount) + '</span>' +
          '</div>';
      }).join('');
    }
    if (!state.charts.pie) {
      var chart = chartBase(el);
      if (!chart) return;
      state.charts.pie = chart;
    }
    var data = byCat.map(function (c) {
      return { name: (c.category_icon || '') + ' ' + (c.category_name || '未分类'), value: c.amount };
    });
    var tc = chartTextColor();
    state.charts.pie.setOption({
      textStyle: { color: tc },
      tooltip: { trigger: 'item', valueFormatter: function (v) { return '¥' + (v / 100).toFixed(2); }, backgroundColor: isDarkTheme() ? '#2a2f3a' : '#fff', borderColor: 'rgba(0,0,0,.08)', textStyle: { color: tc, fontSize: 12 }, extraCssText: 'box-shadow:0 6px 20px rgba(0,0,0,.12);border-radius:10px;padding:8px 12px;' },
      legend: { type: 'scroll', bottom: 0, textStyle: { color: tc } },
      title: {
        text: '总支出',
        subtext: '¥' + (byCat.reduce(function (s, c) { return s + c.amount; }, 0) / 100).toFixed(2),
        left: 'center',
        top: '38%',
        textStyle: { fontSize: 13, color: tc, fontWeight: 'normal' },
        subtextStyle: { fontSize: 15, color: tc, fontWeight: 'bold' },
      },
      series: [{
        type: 'pie',
        radius: ['40%', '70%'],
        center: ['50%', '45%'],
        data: data,
        label: { formatter: '{b}\n{d}%', color: tc },
        itemStyle: { borderRadius: 6, borderColor: '#fff', borderWidth: 2 },
        emphasis: { scaleSize: 6, itemStyle: { shadowBlur: 14, shadowColor: 'rgba(0,0,0,.25)' } },
        animationType: 'scale',
        animationEasing: 'elasticOut',
        animationDuration: 900,
        startAngle: 90,
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
    var tc = chartTextColor(), ac = chartAxisColor();
    // 当月汇总
    var sumIn = daily.reduce(function (s, d) { return s + d.income; }, 0);
    var sumOut = daily.reduce(function (s, d) { return s + d.expense; }, 0);
    state.charts.daily.setOption({
      textStyle: { color: tc },
      title: {
        text: '收入 ' + fmt(sumIn) + ' · 支出 ' + fmt(sumOut),
        left: 'center', top: 2,
        textStyle: { fontSize: 12, color: tc, fontWeight: 'normal' },
      },
      tooltip: { trigger: 'axis', valueFormatter: function (v) { return '¥' + (v / 100).toFixed(2); }, backgroundColor: isDarkTheme() ? '#2a2f3a' : '#fff', borderColor: 'rgba(0,0,0,.08)', textStyle: { color: tc, fontSize: 12 }, extraCssText: 'box-shadow:0 6px 20px rgba(0,0,0,.12);border-radius:10px;padding:8px 12px;' },
      legend: { data: ['收入', '支出'], textStyle: { color: tc }, top: 18 },
      grid: { left: 60, right: 20, top: 46, bottom: 30 },
      xAxis: { type: 'category', data: daily.map(function (d) { return Number(d.day.slice(8)); }), axisLabel: { color: tc }, axisLine: { lineStyle: { color: ac } } },
      yAxis: { type: 'value', axisLabel: { color: tc }, splitLine: { lineStyle: { color: ac } } },
      series: [
        { name: '收入', type: 'bar', data: daily.map(function (d) { return d.income; }), barMaxWidth: 10,
          itemStyle: { borderRadius: [4,4,0,0], color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{offset:0,color:'#4ade80'},{offset:1,color:'#16a34a'}] } },
          emphasis: { itemStyle: { shadowBlur: 8, shadowColor: 'rgba(34,197,94,.35)' } } },
        { name: '支出', type: 'bar', data: daily.map(function (d) { return d.expense; }), barMaxWidth: 10,
          itemStyle: { borderRadius: [4,4,0,0], color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{offset:0,color:'#f87171'},{offset:1,color:'#dc2626'}] } },
          emphasis: { itemStyle: { shadowBlur: 8, shadowColor: 'rgba(244,101,107,.35)' } } },
      ],
    }, true);
    // 点击柱子 → 切到记账页并筛选该日
    var c = state.charts.daily;
    if (c) {
      c.off('click');
      c.on('click', function (params) {
        if (params && params.dataIndex != null) {
          var day = Number(String(daily[params.dataIndex].day).slice(8));
          var month = daily[params.dataIndex].day.slice(0, 7);
          $('#filter-month').value = month;
          $('#filter-keyword').value = month + '-' + String(day).padStart(2, '0');
          state.recordPage = 1;
          loadRecords();
          switchTab('record');
        }
      });
    }
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
        var ringColor = cls === 'over' ? 'var(--expense)' : cls === 'warn' ? 'var(--amber)' : 'var(--primary)';
        var ringPct = Math.min(100, pct);
        var circum = 2 * Math.PI * 40;
        var dash = circum * ringPct / 100;
        html.push(
          '<div class="budget-overall-card' + (cls === 'over' ? ' over-budget' : '') + '">' +
          '<div class="budget-ring" style="--ring-color:' + ringColor + '">' +
          '<svg viewBox="0 0 100 100" width="88" height="88">' +
          '<circle cx="50" cy="50" r="40" fill="none" stroke="var(--soft-bg-2)" stroke-width="9"/>' +
          '<circle cx="50" cy="50" r="40" fill="none" stroke="var(--ring-color)" stroke-width="9" stroke-linecap="round" stroke-dasharray="' + dash + ' ' + circum + '" transform="rotate(-90 50 50)"/>' +
          '</svg>' +
          '<div class="ring-text">' + pctText + '</div>' +
          '</div>' +
          '<div class="budget-ring-main">' +
          '<div class="b-info">已支出 ' + fmt(data.overall.spent) + ' / 预算 ' + fmt(data.overall.amount) + '</div>' +
          (data.overall.remaining >= 0 ? '<div class="b-info ok">✅ 剩余 ' + fmt(data.overall.remaining) + '</div>' : '<div class="b-info over">⚠️ 已超支 ' + fmt(-data.overall.remaining) + '</div>') +
          '<div class="budget-ring-actions">' +
          '<button type="button" class="btn ghost sm" data-act="edit-overall">调整</button>' +
          '<button type="button" class="btn danger sm" data-act="del" data-id="' + data.overall.id + '">删</button>' +
          '</div>' +
          '</div>' +
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
          inputDialog('调整本月总预算（元）', '金额', (data.overall.amount / 100).toFixed(2)).then(function (v) {
            if (v === null || v === '') return;
            saveBudget(null, v, data.month);
          });
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
        listBox.innerHTML = '<div class="empty empty-budget">尚未设置分类预算</div>';
      } else {
        var html2 = [];
        data.items.forEach(function (it) {
          var pct = it.amount > 0 ? Math.round((it.spent / it.amount) * 100) : 0;
          var cls = pct > 100 ? 'over' : (pct > 80 ? 'warn' : '');
          html2.push(
            '<div class="budget-item' + (cls === 'over' ? ' budget-over' : '') + '">' +
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
              inputDialog('调整预算（元）', '金额', (Number(btn.dataset.amount) / 100).toFixed(2)).then(function (v) {
                if (v === null || v === '') return;
                saveBudget(Number(btn.dataset.cat), v, data.month);
              });
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
    confirmDialog('确定删除该预算吗？').then(function (ok) {
      if (!ok) return;
      api('/budgets/' + id, { method: 'DELETE' }).then(function () {
        toast('已删除');
        renderBudget();
      }).catch(function (e) { toast(e.message); });
    });
  }

  // ================= 账本 =================
  function renderLedgers() {
    var box = $('#ledger-list');
    if (state.ledgers.length === 0) {
      box.innerHTML = '<div class="empty empty-ledgers">还没有账本，先创建一个吧</div>';
      return;
    }
    var html = [];
    state.ledgers.forEach(function (l) {
      var isCurrent = l.id === state.currentLedgerId;
      html.push(
        '<div class="ledger-item' + (isCurrent ? ' current' : '') + '">' +
        '<div class="l-icon">📒</div>' +
        '<div class="l-main">' +
        '<div class="l-name">' + esc(l.name) + (isCurrent ? ' <span class="l-badge">当前</span>' : '') + '</div>' +
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
    inputDialog('账本新名称', '输入名称', l.name, true).then(function (name) {
      if (name === null || !name.trim()) return;
      api('/ledgers/' + id, { method: 'PUT', body: { name: name.trim() } }).then(function () {
        toast('已重命名');
        refreshAll();
      }).catch(function (e) { toast(e.message); });
    });
  }

  function deleteLedger(id) {
    confirmDialog('确定删除该账本吗？<br>其所有记录和预算将一并删除！').then(function (ok) {
      if (!ok) return;
      api('/ledgers/' + id, { method: 'DELETE' }).then(function () {
        toast('账本已删除');
        refreshAll();
      }).catch(function (e) { toast(e.message); });
    });
  }

  function refreshAfterLedgerChange() {
    var main = document.querySelector('main');
    if (main) { main.style.opacity = '0'; main.style.transition = 'opacity .25s ease'; }
    var activeTab = document.querySelector('.tabs button.active');
    api('/auth/me').then(function (me) {
      state.user = me.user;
      state.ledgers = me.ledgers;
      state.currentLedgerId = me.user.current_ledger_id || (me.ledgers[0] ? me.ledgers[0].id : null);
      renderHeader();
      switchTab(activeTab ? activeTab.dataset.tab : 'record');
      if (main) main.style.opacity = '1';
    }).catch(function () { if (main) main.style.opacity = '1'; });
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
        box.innerHTML = '<div class="empty empty-categories">暂无分类</div>';
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
    inputDialog('分类新名称', '输入名称', c.name, true).then(function (name) {
      if (name === null || !name.trim()) return;
      inputDialog('分类图标（emoji，可留空）', '输入 emoji', c.icon || '', true).then(function (icon) {
        if (icon === null) return;
        api('/categories/' + id, { method: 'PUT', body: { name: name.trim(), icon: icon } }).then(function () {
          toast('已保存');
          return loadCategories();
        }).then(function () {
          renderCategoryPicker();
          fillCategoryFilter();
          fillBudgetCategory();
          renderCategories();
        }).catch(function (e) { toast(e.message); });
      });
    });
  }

  function deleteCategory(id) {
    confirmDialog('确定删除该分类吗？').then(function (ok) {
      if (!ok) return;
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
    });
  }

  // ================= 主题切换 =================
  function applyTheme(theme) {
    // theme: 'dark' | 'light' | 'system'
    var root = document.documentElement;
    if (theme === 'system') {
      root.removeAttribute('data-theme');
      $('#btn-theme').textContent = window.matchMedia('(prefers-color-scheme: dark)').matches ? '🌙' : '☀️';
    } else if (theme === 'dark') {
      root.setAttribute('data-theme', 'dark');
      $('#btn-theme').textContent = '☀️';
    } else {
      root.setAttribute('data-theme', 'light');
      $('#btn-theme').textContent = '🌙';
    }
    localStorage.setItem('jz_theme', theme || 'system');
    // 刷新图表配色（若已渲染）
    Object.keys(state.charts).forEach(function (k) {
      if (state.charts[k]) {
        state.charts[k].dispose();
        state.charts[k] = null;
      }
    });
    var activeTab = document.querySelector('.tabs button.active');
    if (activeTab && activeTab.dataset.tab === 'stats') renderStats();
    // 通知背景粒子切换配色
    try { window.dispatchEvent(new Event('jz-theme-change')); } catch (e) {}
  }

  function initTheme() {
    var saved = localStorage.getItem('jz_theme') || 'system';
    applyTheme(saved);
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
    } else if (name === 'ai') {
      loadAiSettings();
      if (!$('#ai-chat-input').value) $('#ai-chat-input').focus();
    }
  }

  // ================= 事件绑定 =================
  function bindEvents() {
    // 登录/注册
    function switchLoginForm(showLoginForm) {
      var lf = $('#login-form'), rf = $('#register-form');
      var hide = showLoginForm ? rf : lf;
      var show = showLoginForm ? lf : rf;
      // 动画：先淡出当前，再淡入目标
      hide.style.opacity = '0';
      hide.style.transform = 'translateY(6px)';
      setTimeout(function () {
        hide.classList.add('hidden');
        show.classList.remove('hidden');
        show.style.opacity = '0';
        show.style.transform = 'translateY(6px)';
        requestAnimationFrame(function () {
          show.style.transition = 'opacity .25s ease, transform .25s ease';
          show.style.opacity = '1';
          show.style.transform = 'translateY(0)';
        });
      }, 140);
    }
    $('#tab-login').onclick = function () {
      $('#tab-login').classList.add('active');
      $('#tab-register').classList.remove('active');
      $('#login-hint').textContent = '';
      switchLoginForm(true);
    };
    $('#tab-register').onclick = function () {
      $('#tab-register').classList.add('active');
      $('#tab-login').classList.remove('active');
      $('#login-hint').textContent = '';
      switchLoginForm(false);
    };
    var loginBtn = $('#login-form .btn');
    var regBtn = $('#register-form .btn');
    $('#login-form').onsubmit = function (e) {
      e.preventDefault();
      if (loginBtn.disabled) return;
      loginBtn.disabled = true;
      loginBtn.textContent = '登录中…';
      doLogin($('#login-username').value.trim(), $('#login-password').value);
      setTimeout(function () { loginBtn.disabled = false; loginBtn.textContent = '登 录'; }, 1500);
    };
    $('#register-form').onsubmit = function (e) {
      e.preventDefault();
      if (regBtn.disabled) return;
      regBtn.disabled = true;
      regBtn.textContent = '注册中…';
      doRegister($('#reg-username').value.trim(), $('#reg-password').value, $('#reg-nickname').value.trim());
      setTimeout(function () { regBtn.disabled = false; regBtn.textContent = '注 册'; }, 1500);
    };

    // 密码可见切换
    document.querySelectorAll('.pw-toggle').forEach(function (btn) {
      btn.onclick = function () {
        var target = document.getElementById(btn.dataset.target);
        if (!target) return;
        var show = target.type === 'password';
        target.type = show ? 'text' : 'password';
        btn.textContent = show ? '🙈' : '👁';
      };
    });

    // 个人中心
    // 主题切换
    $('#btn-theme').onclick = function () {
      var cur = localStorage.getItem('jz_theme') || 'system';
      var next = cur === 'dark' ? 'light' : cur === 'light' ? 'system' : 'dark';
      applyTheme(next);
    };

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

    // 用户菜单：个人中心 / 模型 切换
    $('#pm-tab-profile').onclick = function () { switchPmPanel('profile'); };
    $('#pm-tab-models').onclick = function () { switchPmPanel('models'); };

    // 模型面板：新增供应商
    $('#ai-add-provider').onclick = function () { openAiProviderForm(); };

    // AI 聊天
    $('#ai-send').onclick = sendAiMessage;
    $('#ai-clear-chat').onclick = function () {
      if (aiHistory.length === 0) { toast('对话已是空的'); return; }
      confirmDialog('确定清空当前对话吗？').then(function (ok) { if (ok) clearAiChat(); });
    };
    $('#ai-play-story').onclick = playStory;
    $('#ai-play-blind').onclick = playBlind;
    $('#ai-play-save').onclick = playSave;
    // 模型状态点（选中模型时亮起）
    var ms = $('#ai-model-status');
    var mvSel = $('#ai-model-select');
    if (ms && mvSel) {
      var upd = function () {
        if (mvSel.value) { ms.textContent = '就绪'; ms.title = '当前模型: ' + mvSel.value; }
        else { ms.textContent = '未配置'; ms.title = '请先在个人中心配置模型'; ms.style.color = 'var(--expense)'; }
      };
      mvSel.addEventListener('change', upd);
      setTimeout(upd, 800);
    }
    var aiInput = $('#ai-chat-input');
    // placeholder 轮播提示
    var aiHints = [
      '说点什么…（如：昨天打车花了 18 元）',
      '试试：帮我分析这周的消费',
      '试试：上个月哪个分类花最多？',
      '试试：今天午饭花了 25 块',
    ];
    var hintIdx = 0;
    setInterval(function () {
      if (aiInput && !aiInput.value && !aiSending) {
        hintIdx = (hintIdx + 1) % aiHints.length;
        aiInput.placeholder = aiHints[hintIdx];
      }
    }, 6000);
    var aiAutoGrow = function () {
      aiInput.style.height = 'auto';
      aiInput.style.height = Math.min(120, aiInput.scrollHeight) + 'px';
    };
    aiInput.addEventListener('input', aiAutoGrow);
    aiInput.onkeydown = function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendAiMessage(); }
      else if (e.key === 'Enter' && e.shiftKey) { setTimeout(aiAutoGrow, 0); }
    };

    // 返回顶部
    var btt = $('#back-to-top');
    window.addEventListener('scroll', function () {
      if (!btt) return;
      btt.classList.toggle('hidden', window.scrollY < 300);
    }, { passive: true });
    if (btt) btt.onclick = function () { window.scrollTo({ top: 0, behavior: 'smooth' }); };

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
    // 备注字数
    var noteInput = $('#record-note');
    if (noteInput) {
      var noteCount = $('#note-count');
      noteInput.addEventListener('input', function () {
        if (noteCount) noteCount.textContent = noteInput.value.length + '/100';
      });
    }
    // 密码强度提示
    var pwInput = $('#reg-password');
    if (pwInput) {
      pwInput.addEventListener('input', function () {
        var v = pwInput.value;
        var meter = $('#pw-meter'), fill = $('#pw-fill');
        if (!meter || !fill) return;
        if (!v) { meter.classList.add('hidden'); return; }
        meter.classList.remove('hidden');
        var score = 0;
        if (v.length >= 6) score++;
        if (v.length >= 10) score++;
        if (/[A-Z]/.test(v) && /[a-z]/.test(v)) score++;
        if (/[0-9]/.test(v)) score++;
        if (/[^A-Za-z0-9]/.test(v)) score++;
        var pct = Math.min(100, score * 20);
        fill.style.width = pct + '%';
        fill.className = 'pw-fill pw-' + (score <= 1 ? 'weak' : score <= 3 ? 'mid' : 'strong');
      });
    }
    // Ctrl+Enter 快捷保存（记账页焦点时）
    document.addEventListener('keydown', function (e) {
      if (e.ctrlKey && e.key === 'Enter') {
        var active = document.querySelector('.tabs button.active');
        if (active && active.dataset.tab === 'record') {
          e.preventDefault();
          var form = $('#record-form');
          if (form && !form.classList.contains('hidden')) form.requestSubmit();
        }
      }
    });

    // 快捷金额：点击填充金额框
    document.querySelectorAll('.quick-amounts button').forEach(function (b) {
      b.onclick = function () {
        var amt = $('#record-amount');
        amt.value = b.dataset.amt;
        amt.focus();
      };
    });
    $('#record-cancel').onclick = resetRecordForm;

    // 明细筛选
    $('#filter-month').onchange = function () { state.recordPage = 1; loadRecords(); };
    // 清除筛选
    $('#btn-clear-filter').onclick = function () {
      $('#filter-month').value = '';
      $('#filter-type').value = '';
      $('#filter-category').value = '';
      $('#filter-keyword').value = '';
      state.recordPage = 1;
      loadRecords();
    };
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
    function shiftMonth(delta) {
      var v = $('#stats-month').value;
      if (!v) v = currentMonthStr();
      var d = new Date(v + '-01');
      d.setMonth(d.getMonth() + delta);
      $('#stats-month').value = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
      renderStats();
    }
    $('#stats-month-prev').onclick = function () { shiftMonth(-1); };
    $('#stats-month-next').onclick = function () { shiftMonth(1); };
    $('#stats-month-today').onclick = function () {
      $('#stats-month').value = currentMonthStr();
      renderStats();
    };
    $('#trend-bar').onclick = function () {
      trendView = 'bar';
      $('#trend-bar').classList.add('active');
      $('#trend-line').classList.remove('active');
      renderStats();
    };
    $('#trend-line').onclick = function () {
      trendView = 'line';
      $('#trend-line').classList.add('active');
      $('#trend-bar').classList.remove('active');
      renderStats();
    };
    // 预算月份
    $('#budget-month').onchange = renderBudget;
    function shiftBudgetMonth(delta) {
      var v = $('#budget-month').value;
      if (!v) v = currentMonthStr();
      var d = new Date(v + '-01');
      d.setMonth(d.getMonth() + delta);
      $('#budget-month').value = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
      renderBudget();
    }
    $('#budget-month-prev').onclick = function () { shiftBudgetMonth(-1); };
    $('#budget-month-next').onclick = function () { shiftBudgetMonth(1); };
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
  initTheme();
  updateAiCount();
  if (state.token) {
    bootApp();
  } else {
    showLogin();
  }
})();
