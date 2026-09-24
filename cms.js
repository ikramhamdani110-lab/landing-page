/* TALORA — Internal Content Management (CMS)
   All data flows through the real backend API:
     GET    /api/content        (Bearer token required)
     POST   /api/content
     GET    /api/content/:id
     PUT    /api/content/:id
     DELETE /api/content/:id
     POST   /api/auth/login
     GET    /api/auth/me
   Token is kept in sessionStorage and verified against the backend on load. */

(() => {
  'use strict';

  const TOKEN_KEY = 'talora_admin_token';

  const $ = (id) => document.getElementById(id);

  // ---------- state ----------
  let items = [];
  let editingId = null;   // null => create, string => edit
  let deletingId = null;
  let filters = { search: '', category: '', status: '', section: '' };
  let requestRows = [];
  let activeRequestId = null;

  // ---------- auth helpers ----------
  const getToken = () => sessionStorage.getItem(TOKEN_KEY) || '';
  const setToken = (t) => t ? sessionStorage.setItem(TOKEN_KEY, t) : sessionStorage.removeItem(TOKEN_KEY);

  function authHeaders() {
    return { 'Authorization': 'Bearer ' + getToken(), 'Content-Type': 'application/json' };
  }

  async function api(path, options = {}) {
    const res = await fetch(path, { ...options, headers: { ...authHeaders(), ...(options.headers || {}) } });
    let data = null;
    try { data = await res.json(); } catch { /* non-JSON */ }
    if (!res.ok) {
      const err = new Error((data && data.message) || 'Request failed.');
      err.status = res.status;
      throw err;
    }
    return data;
  }

  // ---------- generic UI helpers ----------
  function showAlert(kind, msg) {
    const box = $('alertBox');
    box.textContent = msg;
    box.className = 'alert ' + kind;
    box.classList.remove('hidden');
    clearTimeout(showAlert._t);
    showAlert._t = setTimeout(() => box.classList.add('hidden'), 4500);
  }

  function showFormMessage(el, kind, msg) {
    el.textContent = msg || '';
    el.className = 'form-message' + (kind === 'success' ? ' success' : '');
  }

  function setFieldError(inputEl, errorEl, msg) {
    errorEl.textContent = msg || '';
    inputEl.closest('.field').classList.toggle('invalid', !!msg);
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  // ---------- auth flow ----------
  async function initAuth() {
    if (!getToken()) return showLogin();
    try {
      const me = await api('/api/auth/me');
      enterCms(me.user);
    } catch (err) {
      setToken('');
      showLogin();
    }
  }

  function showLogin() {
    $('loginView').classList.remove('hidden');
    $('cmsView').classList.add('hidden');
  }

  function enterCms(user) {
    $('loginView').classList.add('hidden');
    $('cmsView').classList.remove('hidden');
    if (user && user.username) $('adminName').textContent = user.username;
    loadContent();
    loadRequests();
    loadSiteContent();
    loadServices();
  }

  async function handleLogin(e) {
    e.preventDefault();
    const msg = $('loginMessage');
    $('loginBtn').disabled = true;
    showFormMessage(msg, 'info', '');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: $('loginUsername').value.trim(),
          password: $('loginPassword').value
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) throw new Error(data.message || 'Sign in failed.');
      setToken(data.token);
      try {
        const me = await api('/api/auth/me');
        enterCms(me.user);
      } catch { enterCms({ username: $('loginUsername').value.trim() }); }
    } catch (err) {
      showFormMessage(msg, 'error', err.message);
    } finally {
      $('loginBtn').disabled = false;
    }
  }

  function handleLogout() {
    setToken('');
    showLogin();
    $('loginPassword').value = '';
  }

  // ---------- content list ----------
  async function loadContent() {
    showState('loading');
    try {
      const params = new URLSearchParams();
      if (filters.search) params.set('search', filters.search);
      if (filters.section) params.set('section', filters.section);
      if (filters.category) params.set('category', filters.category);
      if (filters.status) params.set('status', filters.status);
      const qs = params.toString();
      const data = await api('/api/content' + (qs ? '?' + qs : ''));
      items = Array.isArray(data.items) ? data.items : [];
      renderItems();
    } catch (err) {
      if (err.status === 401) {
        setToken('');
        showLogin();
        return;
      }
      $('errorText').textContent = err.message || 'Failed to load content.';
      showState('error');
    }
  }

  function showState(state) {
    ['loadingState', 'errorState', 'emptyState', 'tableWrap'].forEach(id => $(id).classList.add('hidden'));
    const map = { loading: 'loadingState', error: 'errorState', empty: 'emptyState', table: 'tableWrap' };
    $(map[state]).classList.remove('hidden');
  }

  function renderItems() {
    const view = items; // server already applied filters via query params
    $('countPill').textContent = view.length;
    if (view.length === 0) return showState('empty');
    showState('table');

    $('tableBody').innerHTML = view.map(it => `
      <tr data-id="${it.id}">
        <td>
          <div class="cell-title">${escapeHtml(it.title)}</div>
          <div class="cell-desc">${escapeHtml(it.description)}</div>
        </td>
        <td><span class="category-tag">${escapeHtml(it.section || 'General')}</span></td>
        <td><span class="category-tag">${escapeHtml(it.category)}</span></td>
        <td><span class="status-badge ${escapeHtml(it.status)}">${escapeHtml(it.status)}</span></td>
        <td class="cell-date">${fmtDate(it.createdAt)}</td>
        <td class="cell-date">${fmtDate(it.updatedAt)}</td>
        <td class="td-actions">
          <button class="action-btn edit" data-action="edit" title="Edit" aria-label="Edit"><i class='bx bx-edit'></i></button>
          <button class="action-btn delete" data-action="delete" title="Delete" aria-label="Delete"><i class='bx bx-trash'></i></button>
        </td>
      </tr>`).join('');

    $('contentCards').innerHTML = view.map(it => `
      <div class="content-card" data-id="${it.id}">
        <div class="cc-top">
          <span class="cc-title">${escapeHtml(it.title)}</span>
          <span class="status-badge ${escapeHtml(it.status)}">${escapeHtml(it.status)}</span>
        </div>
        <div class="cc-desc">${escapeHtml(it.description)}</div>
        <div class="cc-meta">
          <span class="category-tag">${escapeHtml(it.section || 'General')}</span>
          <span class="category-tag">${escapeHtml(it.category)}</span>
          <span class="cc-date">Created ${fmtDate(it.createdAt)}</span>
          <span class="cc-date">Updated ${fmtDate(it.updatedAt)}</span>
        </div>
        <div class="cc-actions">
          <button class="action-btn edit" data-action="edit"><i class='bx bx-edit'></i> Edit</button>
          <button class="action-btn delete" data-action="delete"><i class='bx bx-trash'></i> Delete</button>
        </div>
      </div>`).join('');
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ---------- create / edit modal ----------
  function openCreate() {
    editingId = null;
    $('modalTitle').textContent = 'Add Content';
    $('saveBtn').textContent = 'Create Content';
    $('fTitle').value = '';
    $('fDescription').value = '';
    $('fSection').value = '';
    $('fCategory').value = '';
    $('fStatus').value = 'draft';
    clearFieldErrors();
    showFormMessage($('formMessage'), 'info', '');
    $('modalOverlay').classList.remove('hidden');
    $('fTitle').focus();
  }

  async function openEdit(id) {
    editingId = id;
    $('modalTitle').textContent = 'Edit Content';
    $('saveBtn').textContent = 'Save Changes';
    showFormMessage($('formMessage'), 'info', '');
    clearFieldErrors();
    $('modalOverlay').classList.remove('hidden');
    $('saveBtn').disabled = true;
    try {
      // Load the existing record fresh from the backend
      const data = await api('/api/content/' + id);
      const it = data.item;
      $('fTitle').value = it.title;
      $('fDescription').value = it.description;
      $('fSection').value = it.section || 'General';
      $('fCategory').value = it.category;
      $('fStatus').value = it.status;
    } catch (err) {
      showFormMessage($('formMessage'), 'error', err.message || 'Failed to load this content.');
    } finally {
      $('saveBtn').disabled = false;
    }
  }

  function clearFieldErrors() {
    [['fTitle', 'eTitle'], ['fDescription', 'eDescription'], ['fSection', 'eSection'], ['fCategory', 'eCategory'], ['fStatus', 'eStatus']]
      .forEach(([f, e]) => setFieldError($(f), $(e), ''));
  }

  function validateForm() {
    clearFieldErrors();
    let ok = true;
    if (!$('fTitle').value.trim()) { setFieldError($('fTitle'), $('eTitle'), 'Title is required.'); ok = false; }
    if (!$('fDescription').value.trim()) { setFieldError($('fDescription'), $('eDescription'), 'Content / description is required.'); ok = false; }
    if (!$('fSection').value) { setFieldError($('fSection'), $('eSection'), 'Section is required.'); ok = false; }
    if (!$('fCategory').value) { setFieldError($('fCategory'), $('eCategory'), 'Category is required.'); ok = false; }
    const st = $('fStatus').value;
    if (st !== 'published' && st !== 'draft') { setFieldError($('fStatus'), $('eStatus'), 'Status must be published or draft.'); ok = false; }
    return ok;
  }

  async function handleSave(e) {
    e.preventDefault();
    if (!validateForm()) return;
    const payload = {
      title: $('fTitle').value.trim(),
      description: $('fDescription').value.trim(),
      section: $('fSection').value,
      category: $('fCategory').value,
      status: $('fStatus').value
    };
    const msg = $('formMessage');
    $('saveBtn').disabled = true;
    showFormMessage(msg, 'info', '');
    try {
      let data;
      if (editingId == null) {
        data = await api('/api/content', { method: 'POST', body: JSON.stringify(payload) });
      } else {
        data = await api('/api/content/' + editingId, { method: 'PUT', body: JSON.stringify(payload) });
      }
      closeModal();
      showAlert('success', data.message || 'Saved successfully.');
      await loadContent(); // re-fetch from the database
    } catch (err) {
      if (err.status === 401) { closeModal(); setToken(''); showLogin(); return; }
      showFormMessage(msg, 'error', err.message || 'Failed to save content.');
    } finally {
      $('saveBtn').disabled = false;
    }
  }

  function closeModal() {
    $('modalOverlay').classList.add('hidden');
    editingId = null;
  }

  // ---------- delete ----------
  function openDelete(id) {
    const it = items.find(x => String(x.id) === String(id));
    deletingId = id;
    $('deleteTitle').textContent = it ? it.title : '';
    showFormMessage($('deleteMessage'), 'info', '');
    $('deleteOverlay').classList.remove('hidden');
  }

  async function handleDelete() {
    if (deletingId == null) return;
    $('deleteConfirm').disabled = true;
    showFormMessage($('deleteMessage'), 'info', '');
    try {
      const data = await api('/api/content/' + deletingId, { method: 'DELETE' });
      closeDelete();
      showAlert('success', data.message || 'Content deleted successfully.');
      await loadContent();
    } catch (err) {
      if (err.status === 401) { closeDelete(); setToken(''); showLogin(); return; }
      showFormMessage($('deleteMessage'), 'error', err.message || 'Failed to delete content.');
    } finally {
      $('deleteConfirm').disabled = false;
      deletingId = null;
    }
  }

  function closeDelete() {
    $('deleteOverlay').classList.add('hidden');
  }

  // ---------- events ----------
  $('loginForm').addEventListener('submit', handleLogin);
  $('logoutBtn').addEventListener('click', handleLogout);

  $('addBtn').addEventListener('click', openCreate);
  $('contentForm').addEventListener('submit', handleSave);
  $('cancelBtn').addEventListener('click', closeModal);
  $('modalClose').addEventListener('click', closeModal);
  $('modalOverlay').addEventListener('click', (e) => { if (e.target === $('modalOverlay')) closeModal(); });

  $('deleteCancel').addEventListener('click', closeDelete);
  $('deleteClose').addEventListener('click', closeDelete);
  $('deleteConfirm').addEventListener('click', handleDelete);
  $('deleteOverlay').addEventListener('click', (e) => { if (e.target === $('deleteOverlay')) closeDelete(); });

  $('retryBtn').addEventListener('click', loadContent);

  $('searchInput').addEventListener('input', (e) => {
    filters.search = e.target.value.trim();
    clearTimeout(loadContent._t);
    loadContent._t = setTimeout(() => loadContent(), 300); // debounced server-side search
  });
  $('categoryFilter').addEventListener('change', (e) => { filters.category = e.target.value; loadContent(); });
  $('sectionFilter').addEventListener('change', (e) => { filters.section = e.target.value; loadContent(); });
  $('statusFilter').addEventListener('change', (e) => { filters.status = e.target.value; loadContent(); });

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const row = btn.closest('[data-id]');
    if (!row) return;
    const id = row.dataset.id;
    if (btn.dataset.action === 'edit') openEdit(id);
    if (btn.dataset.action === 'delete') openDelete(id);
  });

  document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closeModal(); closeDelete(); closeRequestModal(); closeServiceModal(); closeServiceDelete(); }
  });

  async function loadRequests() {
    try {
      const params = new URLSearchParams();
      const search = ($('requestSearchInput') || {}).value?.trim() || '';
      const status = ($('requestStatusFilter') || {}).value || '';
      if (search) params.set('search', search);
      if (status) params.set('status', status);
      const data = await api('/api/requests' + (params.toString() ? '?' + params.toString() : ''));
      requestRows = Array.isArray(data.items) ? data.items : [];
      const count = $('requestCountPill');
      if (count) count.textContent = String(data.total || requestRows.length || 0);
      renderRequests();
    } catch (err) {
      if (err.status === 401) { setToken(''); showLogin(); return; }
      showAlert('error', err.message || 'Failed to load customer requests.');
    }
  }

  function renderRequests() {
    const tbody = $('requestTableBody');
    if (!tbody) return;
    if (!requestRows.length) {
      tbody.innerHTML = `<tr><td colspan="7" class="empty-request-state">No requests match the current filters.</td></tr>`;
      return;
    }
    tbody.innerHTML = requestRows.map((item) => `
      <tr>
        <td>
          <div class="cell-title">${escapeHtml(item.customerName || 'Unknown')}</div>
          <div class="cell-desc">${escapeHtml(item.customerEmail || '—')}</div>
        </td>
        <td><span class="category-tag">${escapeHtml(item.category || 'Other')}</span></td>
        <td><div class="cell-title">${escapeHtml(item.title || 'Untitled request')}</div></td>
        <td><span class="status-badge ${escapeHtml(item.status || 'NEW')}">${escapeHtml(item.status || 'NEW')}</span></td>
        <td class="cell-date">${fmtDate(item.createdAt)}</td>
        <td class="cell-date">${fmtDate(item.updatedAt)}</td>
        <td class="td-actions"><button class="btn btn-ghost btn-sm" data-request-id="${escapeHtml(item.id)}" data-request-view="1">View</button></td>
      </tr>`).join('');
  }

  async function openRequestDetails(id) {
    const modal = $('requestModalOverlay');
    const detailBody = $('requestDetailBody');
    const statusSelect = $('requestStatusSelect');
    const msg = $('requestStatusMessage');
    if (!modal || !detailBody || !statusSelect) return;
    activeRequestId = id;
    detailBody.innerHTML = '<div class="table-state"><span class="spinner"></span> Loading request...</div>';
    modal.classList.remove('hidden');
    try {
      const data = await api('/api/requests/' + id);
      const request = data.request || data.item || {};
      detailBody.innerHTML = `
        <div class="request-detail-grid">
          <div class="request-detail-item"><span class="label">Project title</span><span class="value">${escapeHtml(request.title || '—')}</span></div>
          <div class="request-detail-item"><span class="label">Customer</span><span class="value">${escapeHtml(request.customerName || '—')}</span></div>
          <div class="request-detail-item"><span class="label">Email</span><span class="value">${escapeHtml(request.customerEmail || '—')}</span></div>
          <div class="request-detail-item"><span class="label">Company</span><span class="value">${escapeHtml(request.companyName || '—')}</span></div>
          <div class="request-detail-item"><span class="label">Category</span><span class="value">${escapeHtml(request.category || '—')}</span></div>
          <div class="request-detail-item"><span class="label">Status</span><span class="value">${escapeHtml(request.status || 'NEW')}</span></div>
          <div class="request-detail-item full"><span class="label">Description</span><span class="value">${escapeHtml(request.description || '—')}</span></div>
          <div class="request-detail-item"><span class="label">Budget</span><span class="value">${escapeHtml(request.budget || '—')}</span></div>
          <div class="request-detail-item"><span class="label">Deadline</span><span class="value">${escapeHtml(request.deadline || '—')}</span></div>
          <div class="request-detail-item full"><span class="label">Additional details</span><span class="value">${escapeHtml(request.additionalDetails || '—')}</span></div>
          <div class="request-detail-item"><span class="label">Created</span><span class="value">${fmtDate(request.createdAt)}</span></div>
          <div class="request-detail-item"><span class="label">Last updated</span><span class="value">${fmtDate(request.updatedAt)}</span></div>
        </div>`;
      statusSelect.value = request.status || 'NEW';
      showFormMessage(msg, 'info', '');
    } catch (err) {
      detailBody.innerHTML = `<div class="table-state"><i class='bx bx-error'></i> ${escapeHtml(err.message || 'Unable to load the request.')}</div>`;
    }
  }

  function closeRequestModal() {
    const modal = $('requestModalOverlay');
    if (modal) modal.classList.add('hidden');
    activeRequestId = null;
    showFormMessage($('requestStatusMessage'), 'info', '');
  }

  async function updateRequestStatusFromModal() {
    if (!activeRequestId) return;
    const msg = $('requestStatusMessage');
    const status = $('requestStatusSelect')?.value || 'NEW';
    const btn = $('requestStatusSave');
    if (btn) btn.disabled = true;
    showFormMessage(msg, 'info', '');
    try {
      const data = await api('/api/requests/' + activeRequestId + '/status', { method: 'PATCH', body: JSON.stringify({ status }) });
      showFormMessage(msg, 'success', data.message || 'Status updated successfully.');
      await loadRequests();
      const row = requestRows.find(r => String(r.id) === String(activeRequestId));
      if (row) {
        row.status = status;
        row.updatedAt = new Date().toISOString();
      }
      await openRequestDetails(activeRequestId);
    } catch (err) {
      showFormMessage(msg, 'error', err.message || 'Failed to update status.');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  // ============================================================
  // Services manager (Task 6) — /api/admin/services
  // Same auth, helpers and conventions as the content manager.
  // ============================================================
  let serviceItems = [];
  let editingServiceId = null;
  let deletingServiceId = null;

  function showServiceState(state) {
    ['serviceLoadingState', 'serviceErrorState', 'serviceEmptyState', 'serviceTableWrap'].forEach(id => $(id).classList.add('hidden'));
    const map = { loading: 'serviceLoadingState', error: 'serviceErrorState', empty: 'serviceEmptyState', table: 'serviceTableWrap' };
    $(map[state]).classList.remove('hidden');
  }

  function showServiceAlert(kind, msg) {
    const box = $('serviceAlertBox');
    box.textContent = msg;
    box.className = 'alert ' + kind;
    box.classList.remove('hidden');
    clearTimeout(showServiceAlert._t);
    showServiceAlert._t = setTimeout(() => box.classList.add('hidden'), 4500);
  }

  async function loadServices() {
    showServiceState('loading');
    try {
      const data = await api('/api/admin/services');
      serviceItems = Array.isArray(data.items) ? data.items : [];
      renderServices();
    } catch (err) {
      if (err.status === 401) { setToken(''); showLogin(); return; }
      $('serviceErrorText').textContent = err.message || 'Failed to load services.';
      showServiceState('error');
    }
  }

  function renderServices() {
    const view = serviceItems;
    $('serviceCountPill').textContent = view.length;
    if (view.length === 0) return showServiceState('empty');
    showServiceState('table');

    $('serviceTableBody').innerHTML = view.map(it => `
      <tr data-service-id="${it.id}">
        <td>
          <div class="cell-title">${escapeHtml(it.title)}</div>
          <div class="cell-desc">${escapeHtml(it.description)}</div>
        </td>
        <td>${it.icon ? `<i class='bx ${escapeHtml(it.icon)}'></i> <code>${escapeHtml(it.icon)}</code>` : '<span class="cell-date">—</span>'}</td>
        <td><span class="status-badge ${it.status === 'active' ? 'published' : 'draft'}">${escapeHtml(it.status)}</span></td>
        <td class="cell-date">${fmtDate(it.createdAt)}</td>
        <td class="cell-date">${fmtDate(it.updatedAt)}</td>
        <td class="td-actions">
          <button class="action-btn edit" data-svc-action="edit" title="Edit" aria-label="Edit"><i class='bx bx-edit'></i></button>
          <button class="action-btn delete" data-svc-action="delete" title="Delete" aria-label="Delete"><i class='bx bx-trash'></i></button>
        </td>
      </tr>`).join('');

    $('serviceCards').innerHTML = view.map(it => `
      <div class="content-card" data-service-id="${it.id}">
        <div class="cc-top">
          <span class="cc-title">${escapeHtml(it.title)}</span>
          <span class="status-badge ${it.status === 'active' ? 'published' : 'draft'}">${escapeHtml(it.status)}</span>
        </div>
        <div class="cc-desc">${escapeHtml(it.description)}</div>
        <div class="cc-meta">
          ${it.icon ? `<span class="category-tag"><i class='bx ${escapeHtml(it.icon)}'></i></span>` : ''}
          <span class="cc-date">Created ${fmtDate(it.createdAt)}</span>
          <span class="cc-date">Updated ${fmtDate(it.updatedAt)}</span>
        </div>
        <div class="cc-actions">
          <button class="action-btn edit" data-svc-action="edit"><i class='bx bx-edit'></i> Edit</button>
          <button class="action-btn delete" data-svc-action="delete"><i class='bx bx-trash'></i> Delete</button>
        </div>
      </div>`).join('');
  }

  function clearServiceFieldErrors() {
    [['sfTitle', 'seTitle'], ['sfDescription', 'seDescription'], ['sfIcon', 'seIcon'], ['sfStatus', 'seStatus']]
      .forEach(([f, e]) => setFieldError($(f), $(e), ''));
  }

  function openServiceCreate() {
    editingServiceId = null;
    $('serviceModalTitle').textContent = 'Add Service';
    $('serviceSaveBtn').textContent = 'Create Service';
    $('sfTitle').value = '';
    $('sfDescription').value = '';
    $('sfIcon').value = '';
    $('sfStatus').value = 'active';
    clearServiceFieldErrors();
    showFormMessage($('serviceFormMessage'), 'info', '');
    $('serviceModalOverlay').classList.remove('hidden');
    $('sfTitle').focus();
  }

  async function openServiceEdit(id) {
    editingServiceId = id;
    $('serviceModalTitle').textContent = 'Edit Service';
    $('serviceSaveBtn').textContent = 'Save Changes';
    showFormMessage($('serviceFormMessage'), 'info', '');
    clearServiceFieldErrors();
    $('serviceModalOverlay').classList.remove('hidden');
    $('serviceSaveBtn').disabled = true;
    try {
      // Load the existing record fresh from the backend
      const data = await api('/api/admin/services/' + id);
      const it = data.item;
      $('sfTitle').value = it.title;
      $('sfDescription').value = it.description;
      $('sfIcon').value = it.icon || '';
      $('sfStatus').value = it.status;
    } catch (err) {
      showFormMessage($('serviceFormMessage'), 'error', err.message || 'Failed to load this service.');
    } finally {
      $('serviceSaveBtn').disabled = false;
    }
  }

  function validateServiceForm() {
    clearServiceFieldErrors();
    let ok = true;
    if (!$('sfTitle').value.trim()) { setFieldError($('sfTitle'), $('seTitle'), 'Title is required.'); ok = false; }
    else if ($('sfTitle').value.trim().length > 200) { setFieldError($('sfTitle'), $('seTitle'), 'Title must be 200 characters or fewer.'); ok = false; }
    if (!$('sfDescription').value.trim()) { setFieldError($('sfDescription'), $('seDescription'), 'Description is required.'); ok = false; }
    else if ($('sfDescription').value.trim().length > 2000) { setFieldError($('sfDescription'), $('seDescription'), 'Description must be 2,000 characters or fewer.'); ok = false; }
    const st = $('sfStatus').value;
    if (st !== 'active' && st !== 'inactive') { setFieldError($('sfStatus'), $('seStatus'), 'Status must be active or inactive.'); ok = false; }
    return ok;
  }

  async function handleServiceSave(e) {
    e.preventDefault();
    if (!validateServiceForm()) return;
    const payload = {
      title: $('sfTitle').value.trim(),
      description: $('sfDescription').value.trim(),
      icon: $('sfIcon').value.trim(),
      status: $('sfStatus').value
    };
    const msg = $('serviceFormMessage');
    $('serviceSaveBtn').disabled = true;
    showFormMessage(msg, 'info', '');
    try {
      let data;
      if (editingServiceId == null) {
        data = await api('/api/admin/services', { method: 'POST', body: JSON.stringify(payload) });
      } else {
        data = await api('/api/admin/services/' + editingServiceId, { method: 'PUT', body: JSON.stringify(payload) });
      }
      closeServiceModal();
      showServiceAlert('success', data.message || 'Saved successfully.');
      await loadServices(); // re-fetch from the database
    } catch (err) {
      if (err.status === 401) { closeServiceModal(); setToken(''); showLogin(); return; }
      showFormMessage(msg, 'error', err.message || 'Failed to save service.');
    } finally {
      $('serviceSaveBtn').disabled = false;
    }
  }

  function closeServiceModal() {
    $('serviceModalOverlay').classList.add('hidden');
    editingServiceId = null;
  }

  function openServiceDelete(id) {
    const it = serviceItems.find(x => String(x.id) === String(id));
    deletingServiceId = id;
    $('serviceDeleteTitle').textContent = it ? it.title : '';
    showFormMessage($('serviceDeleteMessage'), 'info', '');
    $('serviceDeleteOverlay').classList.remove('hidden');
  }

  async function handleServiceDelete() {
    if (deletingServiceId == null) return;
    $('serviceDeleteConfirm').disabled = true;
    showFormMessage($('serviceDeleteMessage'), 'info', '');
    try {
      const data = await api('/api/admin/services/' + deletingServiceId, { method: 'DELETE' });
      closeServiceDelete();
      showServiceAlert('success', data.message || 'Service deleted successfully.');
      await loadServices();
    } catch (err) {
      if (err.status === 401) { closeServiceDelete(); setToken(''); showLogin(); return; }
      showFormMessage($('serviceDeleteMessage'), 'error', err.message || 'Failed to delete service.');
    } finally {
      $('serviceDeleteConfirm').disabled = false;
      deletingServiceId = null;
    }
  }

  function closeServiceDelete() {
    $('serviceDeleteOverlay').classList.add('hidden');
  }

  function initServices() {
    $('svcAddBtn').addEventListener('click', openServiceCreate);
    $('serviceForm').addEventListener('submit', handleServiceSave);
    $('serviceCancelBtn').addEventListener('click', closeServiceModal);
    $('serviceModalClose').addEventListener('click', closeServiceModal);
    $('serviceModalOverlay').addEventListener('click', (e) => { if (e.target === $('serviceModalOverlay')) closeServiceModal(); });

    $('serviceDeleteCancel').addEventListener('click', closeServiceDelete);
    $('serviceDeleteClose').addEventListener('click', closeServiceDelete);
    $('serviceDeleteConfirm').addEventListener('click', handleServiceDelete);
    $('serviceDeleteOverlay').addEventListener('click', (e) => { if (e.target === $('serviceDeleteOverlay')) closeServiceDelete(); });

    $('serviceRetryBtn').addEventListener('click', loadServices);

    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-svc-action]');
      if (!btn) return;
      const row = btn.closest('[data-service-id]');
      if (!row) return;
      const id = row.dataset.serviceId;
      if (btn.dataset.svcAction === 'edit') openServiceEdit(id);
      if (btn.dataset.svcAction === 'delete') openServiceDelete(id);
    });
  }

  // ---------- boot ----------
  initAuth();
  initSiteContent();
  initServices();

  // ============================================================
  // Website Content manager (per-section editing of the public site)
  // Flow: cms.html → GET/PUT /api/website-settings → database
  // ============================================================
  let siteSections = [];   // section metadata from the API
  let siteValues = {};     // current effective values
  let siteDefaults = {};   // hardcoded fallback defaults
  let editingSection = null;

  function initSiteContent() {
    $('siteForm').addEventListener('submit', handleSiteSave);
    $('siteCancelBtn').addEventListener('click', closeSiteModal);
    $('siteModalClose').addEventListener('click', closeSiteModal);
    $('siteModalOverlay').addEventListener('click', (e) => { if (e.target === $('siteModalOverlay')) closeSiteModal(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSiteModal(); });
  }

  async function loadSiteContent() {
    try {
      const data = await api('/api/website-settings');
      siteSections = Array.isArray(data.sections) ? data.sections : [];
      siteValues = data.values || {};
      siteDefaults = data.defaults || {};
      renderSiteGrid();
    } catch (err) {
      if (err.status === 401) { setToken(''); showLogin(); return; }
      showAlert('error', err.message || 'Failed to load website content.');
    }
  }

  function renderSiteGrid() {
    $('siteCountPill').textContent = siteSections.length;
    $('siteGrid').innerHTML = siteSections.map(s => {
      const count = s.fields.length;
      return `
        <div class="site-card">
          <div class="site-card-top">
            <i class='bx ${escapeHtml(s.icon || 'bx-edit')} site-card-icon'></i>
            <h3>${escapeHtml(s.label)}</h3>
          </div>
          <p class="site-card-meta">${count} editable field${count === 1 ? '' : 's'}</p>
          <button class="btn btn-ghost site-edit-btn" data-site-section="${escapeHtml(s.key)}">
            <i class='bx bx-edit'></i> Edit
          </button>
        </div>`;
    }).join('');
  }

  function fieldInput(f, value) {
    const id = 'sf_' + f.key;
    const val = value != null ? value : '';
    const common = `id="${id}" data-key="${escapeHtml(f.key)}"`;
    let input;
    if (f.type === 'list') {
      input = `<textarea ${common} rows="4" placeholder="${escapeHtml(f.help || '')}">${escapeHtml(val)}</textarea>`;
    } else {
      input = `<input type="text" ${common} value="${escapeHtml(val)}" placeholder="${escapeHtml(f.help || '')}">`;
    }
    return `
      <label class="field">
        <span>${escapeHtml(f.label)}${f.type === 'url' ? ' <em class="type-hint">link</em>' : (f.type === 'list' ? ' <em class="type-hint">list</em>' : '')}</span>
        ${input}
        ${f.help ? `<small class="field-help">${escapeHtml(f.help)}</small>` : ''}
      </label>`;
  }

  function openSiteSection(key) {
    const s = siteSections.find(x => x.key === key);
    if (!s) return;
    editingSection = s;
    $('siteModalTitle').textContent = 'Edit — ' + s.label;
    $('siteFields').innerHTML = s.fields.map(f => fieldInput(f, siteValues[f.key])).join('');
    showFormMessage($('siteFormMessage'), 'info', '');
    $('siteModalOverlay').classList.remove('hidden');
  }

  function closeSiteModal() {
    $('siteModalOverlay').classList.add('hidden');
    editingSection = null;
  }

  async function handleSiteSave(e) {
    e.preventDefault();
    if (!editingSection) return;
    const values = {};
    editingSection.fields.forEach(f => {
      const el = document.getElementById('sf_' + f.key);
      if (el) values[f.key] = el.value;
    });
    const msg = $('siteFormMessage');
    $('siteSaveBtn').disabled = true;
    showFormMessage(msg, 'info', '');
    try {
      const data = await api('/api/website-settings', { method: 'PUT', body: JSON.stringify({ values }) });
      siteValues = data.values || siteValues;
      closeSiteModal();
      showAlert('success', data.message || 'Website content saved successfully.');
    } catch (err) {
      if (err.status === 401) { closeSiteModal(); setToken(''); showLogin(); return; }
      showFormMessage(msg, 'error', err.message || 'Failed to save website content.');
    } finally {
      $('siteSaveBtn').disabled = false;
    }
  }

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-site-section]');
    if (btn) openSiteSection(btn.dataset.siteSection);
    const reqBtn = e.target.closest('[data-request-view]');
    if (reqBtn) openRequestDetails(reqBtn.dataset.requestId);
  });

  $('requestSearchInput') && $('requestSearchInput').addEventListener('input', (e) => {
    clearTimeout(loadRequests._t);
    loadRequests._t = setTimeout(() => loadRequests(), 250);
  });

  $('requestStatusFilter') && $('requestStatusFilter').addEventListener('change', () => loadRequests());
  $('requestModalClose') && $('requestModalClose').addEventListener('click', closeRequestModal);
  $('requestStatusSave') && $('requestStatusSave').addEventListener('click', updateRequestStatusFromModal);
  $('requestModalOverlay') && $('requestModalOverlay').addEventListener('click', (e) => { if (e.target === $('requestModalOverlay')) closeRequestModal(); });

  // Load the website content map when signed in (enterCms calls loadSiteContent)
})();
