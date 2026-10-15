'use strict';

(() => {
  const byId = (id) => document.getElementById(id);
  const ui = {
    form: byId('session-form'), employee: byId('employee-select'), login: byId('login-button'),
    session: byId('session-status'), error: byId('page-error'), refresh: byId('refresh-button'),
    search: byId('search-input'), filter: byId('status-select'), list: byId('suggestions-list'),
    count: byId('suggestions-count'), suggestionTime: byId('suggestions-observed'),
    orderTime: byId('orders-observed'), orderStatus: byId('orders-status'),
    tableWrap: byId('orders-table-wrap'), ordersBody: byId('orders-body'), more: byId('load-more-button'),
    suggestedMetric: byId('metric-suggested'), staleMetric: byId('metric-stale'), orderMetric: byId('metric-orders'),
    dialog: byId('order-dialog'), detail: byId('order-detail'), closeDialog: byId('close-dialog-button'),
  };
  const state = {
    generation: 0, controller: new AbortController(), me: null, suggestions: [], orders: [],
    nextCursor: null, busy: false, loadingMore: false, suggestionsReady: false, ordersReady: false,
    suggestionError: '', detailGeneration: 0,
  };
  const timeFormat = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
  const numberFormat = new Intl.NumberFormat('zh-CN');

  function element(tag, className, content) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (content !== undefined) node.textContent = String(content);
    return node;
  }

  function text(value, fallback = '—') {
    return value === null || value === undefined || value === '' ? fallback : String(value);
  }

  function time(value) {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : timeFormat.format(date);
  }

  function date(value) {
    if (!value) return '未提供';
    return /^\d{4}-\d{2}-\d{2}(?:T|$)/.test(String(value)) ? String(value).slice(0, 10) : text(value);
  }

  function empty(title, description, error = false) {
    const node = element('div', `empty-state${error ? ' is-error' : ''}`);
    const symbol = element('span', 'empty-symbol', error ? '!' : '↗');
    symbol.setAttribute('aria-hidden', 'true');
    node.append(symbol, element('h3', '', title), element('p', '', description));
    return node;
  }

  function beginGeneration() {
    state.controller.abort();
    state.controller = new AbortController();
    state.generation += 1;
    state.detailGeneration += 1;
    if (ui.dialog.open) ui.dialog.close();
    ui.detail.replaceChildren();
    return state.generation;
  }

  const isCurrent = (generation) => generation === state.generation;

  async function request(path, options = {}) {
    let response;
    try {
      response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...options, signal: state.controller.signal });
    } catch (error) {
      if (error.name === 'AbortError') throw error;
      throw new Error('暂时无法连接验证服务，请稍后重试。');
    }
    if (!response.ok) {
      if (response.status === 401) throw new Error('查看会话已失效，请重新选择模拟员工并进入查看。');
      if (response.status === 403 || response.status === 404) throw new Error('该记录不存在或不在当前员工的查看范围内。');
      if (response.status === 429) throw new Error('请求过于频繁，请稍后再试。');
      throw new Error(`验证服务暂时无法完成请求（${response.status}），请稍后重试。`);
    }
    try {
      return await response.json();
    } catch {
      throw new Error('返回数据格式不符合 P1 接口约定。');
    }
  }

  function updateControls() {
    ui.login.disabled = state.busy;
    ui.login.textContent = state.busy ? '正在读取…' : '进入查看';
    ui.refresh.disabled = !state.me || state.busy;
    ui.more.disabled = state.busy || state.loadingMore;
    ui.more.textContent = state.loadingMore ? '正在加载…' : '加载更多订单';
    ui.more.hidden = !state.me || !state.nextCursor;
    ui.list.setAttribute('aria-busy', String(state.busy));
  }

  function clearData() {
    state.suggestions = [];
    state.orders = [];
    state.nextCursor = null;
    state.suggestionsReady = false;
    state.ordersReady = false;
    state.suggestionError = '';
    state.loadingMore = false;
    ui.error.hidden = true;
    ui.error.textContent = '';
    ui.search.value = '';
    ui.filter.value = 'all';
    ui.ordersBody.replaceChildren();
    ui.tableWrap.hidden = true;
    ui.orderStatus.hidden = false;
    ui.orderStatus.classList.remove('is-error');
    ui.orderStatus.textContent = '进入查看后获取订单';
    ui.orderTime.textContent = '建议依据来自这些只读记录';
    ui.suggestionTime.textContent = '进入查看后获取建议';
    ui.count.textContent = '仅搜索已读取的建议';
    ui.suggestedMetric.textContent = '—';
    ui.staleMetric.textContent = '—';
    ui.orderMetric.textContent = '—';
    ui.list.replaceChildren(empty('从选择模拟员工开始', '进入后，这里会展示该员工授权范围内的建议。'));
  }

  function changeIdentity() {
    beginGeneration();
    state.me = null;
    state.busy = false;
    clearData();
    ui.session.classList.remove('is-active');
    ui.session.textContent = '已清空之前的查看内容。点击“进入查看”读取所选员工的数据。';
    updateControls();
  }

  function renderSuggestions() {
    if (!state.suggestionsReady) {
      if (state.suggestionError) ui.list.replaceChildren(empty('建议读取失败', state.suggestionError, true));
      return;
    }
    const query = ui.search.value.trim().toLocaleLowerCase('zh-CN');
    const selectedStatus = ui.filter.value;
    const filtered = state.suggestions.filter((item) => {
      if (selectedStatus !== 'all' && item.status !== selectedStatus) return false;
      const fields = [item.title, item.source?.orderNo, item.source?.customer, item.assigneeName];
      if (item.status !== 'stale') fields.push(item.reason, item.suggestedAction);
      return !query || fields.map((field) => text(field, '')).join(' ').toLocaleLowerCase('zh-CN').includes(query);
    });
    ui.count.textContent = `显示 ${filtered.length} / ${state.suggestions.length} 条已读取建议`;
    ui.suggestedMetric.textContent = numberFormat.format(state.suggestions.filter((item) => item.status === 'suggested').length);
    ui.staleMetric.textContent = numberFormat.format(state.suggestions.filter((item) => item.status === 'stale').length);
    if (!filtered.length) {
      ui.list.replaceChildren(empty(state.suggestions.length ? '没有匹配的建议' : '当前没有跟进建议', state.suggestions.length ? '尝试调整关键词或状态筛选。' : '当前模拟员工的授权范围内暂无建议。'));
      return;
    }
    ui.list.replaceChildren(...filtered.map(suggestionCard));
  }

  function suggestionCard(item) {
    const stale = item.status === 'stale';
    const card = element('article', `suggestion-card${stale ? ' stale-card' : ''}`);
    const main = element('div', 'card-main');
    const top = element('div', 'card-top');
    const identity = element('div', 'order-identity');
    identity.append(element('strong', '', text(item.source?.orderNo, '未关联订单')), element('span', '', text(item.source?.customer)));
    top.append(identity, element('span', `status-pill${stale ? ' is-stale' : ''}`, stale ? '来源已更新' : '建议 / 可查看'));
    main.append(top, element('h3', '', text(item.title, '跟进建议')));
    if (stale) {
      main.append(element('p', 'stale-message', '来源已更新，需重新生成'));
    } else {
      main.append(element('p', 'suggestion-reason', text(item.reason, '暂无建议说明')));
      const action = element('div', 'action-box');
      action.append(element('span', 'action-label', '建议下一步'), element('p', 'action-copy', text(item.suggestedAction, '暂无建议操作')));
      main.append(action);
    }
    const meta = element('div', 'card-meta');
    meta.append(element('span', '', `来源版本 ${text(item.source?.version)}`), element('span', '', `生成于 ${time(item.createdAt)}`));
    main.append(meta, element('p', 'run-id', `运行记录 ${text(item.runId)}`));
    const footer = element('div', 'card-footer');
    footer.append(element('span', 'assignee', `跟进人：${text(item.assigneeName)}`));
    if (item.source?.id) {
      const button = element('button', 'button button-link', '查看关联订单 →');
      button.type = 'button';
      button.addEventListener('click', () => showOrder(item.source.id));
      footer.append(button);
    }
    card.append(main, footer);
    return card;
  }

  function renderOrders() {
    ui.ordersBody.replaceChildren(...state.orders.map((order) => {
      const row = element('tr');
      const identity = element('td');
      identity.append(element('strong', '', text(order.orderNo)), element('div', 'table-subline', text(order.customer)));
      const version = element('td');
      version.append(element('span', 'version-tag', `v${text(order.version)}`));
      row.append(identity, element('td', '', typeof order.quantity === 'number' ? numberFormat.format(order.quantity) : text(order.quantity)), element('td', '', date(order.requestedDate)), element('td', '', date(order.plannedDate)), element('td', '', text(order.stage)), version);
      return row;
    }));
    ui.tableWrap.hidden = !state.orders.length;
    ui.orderStatus.hidden = Boolean(state.orders.length);
    ui.orderStatus.textContent = '当前模拟员工的授权范围内暂无订单。';
    ui.orderStatus.classList.remove('is-error');
    ui.orderMetric.textContent = numberFormat.format(state.orders.length);
    updateControls();
  }

  async function loadSuggestions(generation) {
    try {
      const data = await request('/api/suggestions');
      if (!isCurrent(generation)) return;
      if (!data || !Array.isArray(data.items) || data.synthetic !== true) throw new Error('返回数据格式不符合合成建议接口约定。');
      state.suggestions = data.items;
      state.suggestionsReady = true;
      ui.suggestionTime.textContent = `读取于 ${time(data.observedAt)} · 北京时间`;
      renderSuggestions();
    } catch (error) {
      if (!isCurrent(generation) || error.name === 'AbortError') return;
      state.suggestionError = error.message;
      ui.suggestionTime.textContent = '建议尚未成功读取';
      renderSuggestions();
    }
  }

  async function loadOrders(generation, cursor = null) {
    try {
      const path = `/api/orders?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const data = await request(path);
      if (!isCurrent(generation)) return;
      if (!data || !Array.isArray(data.items)) throw new Error('返回数据格式不符合订单接口约定。');
      const orders = cursor ? [...state.orders, ...data.items] : data.items;
      state.orders = [...new Map(orders.map((order) => [order.id, order])).values()];
      state.ordersReady = true;
      state.nextCursor = data.nextCursor || null;
      ui.orderTime.textContent = `最近一页读取于 ${time(data.observedAt)} · 北京时间`;
      renderOrders();
    } catch (error) {
      if (!isCurrent(generation) || error.name === 'AbortError') return;
      ui.orderStatus.hidden = false;
      ui.orderStatus.classList.add('is-error');
      ui.orderStatus.textContent = error.message;
    }
  }

  async function readCurrentIdentity(createSession) {
    const selectedEmployee = ui.employee.value;
    const generation = beginGeneration();
    state.me = null;
    state.busy = true;
    clearData();
    ui.session.classList.remove('is-active');
    ui.session.textContent = '正在确认模拟身份并读取授权数据…';
    ui.list.replaceChildren(empty('正在读取建议', '正在获取当前模拟员工的建议与来源。'));
    ui.orderStatus.textContent = '正在读取合成订单…';
    updateControls();
    try {
      if (createSession) {
        await request('/api/demo-session', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ employeeId: selectedEmployee }),
        });
      }
      if (!isCurrent(generation)) return;
      const me = await request('/api/me');
      if (!isCurrent(generation)) return;
      if (!me || me.synthetic !== true || me.id !== selectedEmployee) throw new Error('模拟身份校验未通过，请重新进入查看。');
      state.me = me;
      ui.session.textContent = `当前查看：${text(me.name)} · ${text(me.role)} · 合成身份`;
      ui.session.classList.add('is-active');
      await Promise.all([loadSuggestions(generation), loadOrders(generation)]);
    } catch (error) {
      if (!isCurrent(generation) || error.name === 'AbortError') return;
      state.me = null;
      ui.error.textContent = error.message;
      ui.error.hidden = false;
      ui.session.textContent = '身份未就绪，请重新进入查看。';
      ui.session.classList.remove('is-active');
      ui.list.replaceChildren(empty('暂时无法读取建议', '确认模拟身份后重试。', true));
      ui.orderStatus.textContent = '模拟身份未就绪';
    } finally {
      if (isCurrent(generation)) {
        state.busy = false;
        updateControls();
      }
    }
  }

  async function showOrder(id) {
    if (!state.me) return;
    const generation = state.generation;
    const detailGeneration = ++state.detailGeneration;
    ui.detail.replaceChildren(element('p', 'observed', '正在读取关联订单…'));
    if (!ui.dialog.open) ui.dialog.showModal();
    try {
      const order = await request(`/api/orders/${encodeURIComponent(id)}`);
      if (!isCurrent(generation) || detailGeneration !== state.detailGeneration) return;
      if (!order || order.id !== id) throw new Error('返回的订单来源不匹配。');
      const grid = element('dl', 'detail-grid');
      const fields = [
        ['订单数量', typeof order.quantity === 'number' ? numberFormat.format(order.quantity) : text(order.quantity)],
        ['当前阶段', text(order.stage)], ['要求交期', date(order.requestedDate)], ['计划交期', date(order.plannedDate)],
        ['承诺交期', date(order.promisedDate)], ['承诺确认', order.promiseConfirmed === true ? '已确认' : order.promiseConfirmed === false ? '未确认' : '未提供'],
        ['来源版本', `v${text(order.version)}`], ['来源记录', text(order.id)],
      ];
      for (const [label, value] of fields) {
        const pair = element('div');
        pair.append(element('dt', '', label), element('dd', '', value));
        grid.append(pair);
      }
      ui.detail.replaceChildren(element('p', 'detail-identity', text(order.orderNo)), element('p', 'detail-customer', text(order.customer)), grid, element('p', 'detail-observed', `读取于 ${time(order.observedAt)} · 北京时间`));
    } catch (error) {
      if (!isCurrent(generation) || detailGeneration !== state.detailGeneration || error.name === 'AbortError') return;
      ui.detail.replaceChildren(element('p', 'is-error', error.message));
    }
  }

  ui.employee.addEventListener('change', changeIdentity);
  ui.form.addEventListener('submit', (event) => { event.preventDefault(); readCurrentIdentity(true); });
  ui.refresh.addEventListener('click', () => { if (state.me && !state.busy) readCurrentIdentity(false); });
  ui.search.addEventListener('input', renderSuggestions);
  ui.filter.addEventListener('change', renderSuggestions);
  ui.more.addEventListener('click', async () => {
    if (!state.me || !state.nextCursor || state.loadingMore || state.busy) return;
    const generation = state.generation;
    state.loadingMore = true;
    updateControls();
    await loadOrders(generation, state.nextCursor);
    if (isCurrent(generation)) { state.loadingMore = false; updateControls(); }
  });
  ui.closeDialog.addEventListener('click', () => ui.dialog.close());
  ui.dialog.addEventListener('close', () => { state.detailGeneration += 1; ui.detail.replaceChildren(); });
})();
