// Task 11 — Project Management section of the dashboard.
// Wired by dashboard.js via window.TaloraProjects.init({ getToken, onAuthError, isAdmin }).
// All data comes from the real backend: /api/projects, /api/clients, /api/projects/users.
// Frontend permission checks only control VISIBILITY; the backend enforces everything.

(function () {
    'use strict';

    var $ = function (id) { return document.getElementById(id); };
    var getToken = null;
    var onAuthError = function () { window.location.replace('login.html'); };
    var isAdmin = false;

    var projects = [];
    var clients = [];
    var editingProjectId = null;
    var loaded = false;

    var STATUS_LABELS = { NOT_STARTED: 'Not Started', IN_PROGRESS: 'In Progress', COMPLETED: 'Completed', ON_HOLD: 'On Hold' };
    var STATUS_CLASSES = { NOT_STARTED: 'st-notstarted', IN_PROGRESS: 'st-inprogress', COMPLETED: 'st-completed', ON_HOLD: 'st-onhold' };

    function authFetch(path, options) {
        var opts = options || {};
        opts.headers = Object.assign({ 'Authorization': 'Bearer ' + (getToken ? getToken() : '') }, opts.headers || {});
        return fetch(path, opts);
    }

    function setMessage(kind, msg) {
        var el = $('projMessage');
        el.className = 'form-message' + (kind ? ' ' + kind : '');
        el.textContent = msg || '';
    }
    function setFormMessage(kind, msg) {
        var el = $('projFormMessage');
        el.className = 'form-message' + (kind ? ' ' + kind : '');
        el.textContent = msg || '';
    }

    function showState(state) {
        ['projLoading', 'projError', 'projEmpty', 'projListWrap'].forEach(function (id) {
            var el = $(id);
            if (el) el.classList.add('hidden');
        });
        var el = $(state);
        if (el) el.classList.remove('hidden');
    }

    function escapeHtml(v) {
        return String(v == null ? '' : v)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function fmtDate(v) {
        if (!v) return '—';
        var d = new Date(v);
        return isNaN(d) ? String(v) : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    }

    // ---------- Load ----------
    async function loadAll() {
        showState('projLoading');
        try {
            var res = await authFetch('/api/projects');
            if (res.status === 401) return onAuthError();
            if (res.status === 403) { showState('projError'); $('projErrorText').textContent = 'You are not authorized to view projects.'; return; }
            if (!res.ok) throw new Error('server');
            var data = await res.json();
            projects = (data && data.items) || [];
            renderStats((data && data.stats) || {});
            if (!projects.length) { showState('projEmpty'); return; }
            renderList();
            setMessage('', '');
        } catch (_) {
            $('projErrorText').textContent = 'Unable to load projects. Please try again.';
            showState('projError');
        }
    }

    function renderStats(stats) {
        $('statTotal').textContent = stats.total != null ? stats.total : '—';
        $('statActive').textContent = stats.active != null ? stats.active : '—';
        $('statCompleted').textContent = stats.completed != null ? stats.completed : '—';
        $('statOnHold').textContent = stats.onHold != null ? stats.onHold : '—';
    }

    function renderList() {
        var wrap = $('projListWrap');
        wrap.innerHTML = '';
        projects.forEach(function (p) {
            var card = document.createElement('article');
            card.className = 'dash-card proj-item';
            var team = (p.teamNames || []).join(', ') || '—';
            var actions = '';
            if (isAdmin) {
                actions = '<button type="button" class="btn btn-ghost btn-sm proj-edit" data-id="' + p.id + '"><i class=\'bx bx-edit-alt\'></i> Edit</button>' +
                    '<button type="button" class="btn btn-ghost btn-sm proj-delete" data-id="' + p.id + '"><i class=\'bx bx-trash\'></i> Delete</button>';
            } else {
                actions = '<button type="button" class="btn btn-ghost btn-sm proj-status" data-id="' + p.id + '">Update Status</button>';
            }
            card.innerHTML =
                '<div class="proj-item-main">' +
                    '<span class="proj-name">' + escapeHtml(p.name) + '</span>' +
                    '<span class="proj-client"><i class=\'bx bx-buildings\'></i> ' + escapeHtml(p.clientName || '—') + '</span>' +
                    '<span class="proj-status-chip ' + (STATUS_CLASSES[p.status] || '') + '">' + escapeHtml(p.statusLabel || p.status) + '</span>' +
                    '<span class="proj-team">Team: ' + escapeHtml(team) + '</span>' +
                    '<span class="proj-date">Created: ' + escapeHtml(fmtDate(p.createdAt)) + '</span>' +
                '</div>' +
                '<div class="proj-actions">' + actions + '</div>';
            var editBtn = card.querySelector('.proj-edit');
            if (editBtn) editBtn.addEventListener('click', function () { openForm(p); });
            var delBtn = card.querySelector('.proj-delete');
            if (delBtn) delBtn.addEventListener('click', function () { deleteProject(p, card); });
            var stBtn = card.querySelector('.proj-status');
            if (stBtn) stBtn.addEventListener('click', function () { cycleStatus(p, card, stBtn); });
            wrap.appendChild(card);
        });
        showState('projListWrap');
    }

    // ---------- Team member: quick status update (only field they may change) ----------
    async function cycleStatus(p, card, btn) {
        var order = ['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'ON_HOLD'];
        var next = order[(order.indexOf(p.status) + 1) % order.length];
        btn.disabled = true;
        try {
            var res = await authFetch('/api/projects/' + p.id, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: next })
            });
            var data = await res.json().catch(function () { return {}; });
            if (res.status === 401) return onAuthError();
            if (!res.ok) { setMessage('error', data.error || 'Unable to update the project status.'); btn.disabled = false; return; }
            setMessage('success', data.message || 'Project status updated.');
            p.status = next;
            p.statusLabel = STATUS_LABELS[next];
            var chip = card.querySelector('.proj-status-chip');
            chip.className = 'proj-status-chip ' + (STATUS_CLASSES[next] || '');
            chip.textContent = STATUS_LABELS[next];
            btn.disabled = false;
            await loadAll();
        } catch (_) {
            btn.disabled = false;
            setMessage('error', 'Unable to update the project status. Please try again.');
        }
    }

    // ---------- Clients modal ----------
    function openClients() {
        var overlay = $('clientsModalOverlay');
        overlay.classList.remove('hidden');
        loadClients();
    }
    function closeClients() {
        $('clientsModalOverlay').classList.add('hidden');
    }

    async function loadClients() {
        var wrap = $('clientsList');
        wrap.innerHTML = '<div class="table-state"><span class="dash-spinner"></span> Loading clients…</div>';
        try {
            var res = await authFetch('/api/clients');
            if (res.status === 401) return onAuthError();
            if (!res.ok) throw new Error('server');
            clients = (await res.json()).items || [];
            renderClients();
            fillClientSelect();
        } catch (_) {
            wrap.innerHTML = '<div class="table-state"><i class=\'bx bx-error\'></i> Unable to load clients.</div>';
        }
    }

    function renderClients() {
        var wrap = $('clientsList');
        wrap.innerHTML = '';
        if (!clients.length) {
            wrap.innerHTML = '<div class="table-state">No clients yet. Add your first client below.</div>';
            return;
        }
        clients.forEach(function (c) {
            var row = document.createElement('div');
            row.className = 'client-row';
            row.innerHTML =
                '<div class="client-info"><span class="client-name">' + escapeHtml(c.name) + '</span>' +
                '<span class="client-sub">' + escapeHtml(c.contactEmail || '') + '</span></div>' +
                (isAdmin
                    ? '<div class="client-actions">' +
                        '<button type="button" class="btn btn-ghost btn-sm client-edit" data-id="' + c.id + '">Edit</button>' +
                        '<button type="button" class="btn btn-ghost btn-sm client-delete" data-id="' + c.id + '">Delete</button>' +
                      '</div>'
                    : '');
            if (isAdmin) {
                row.querySelector('.client-edit').addEventListener('click', function () {
                    $('clientFormName').value = c.name;
                    $('clientFormEmail').value = c.contactEmail || '';
                    $('clientFormDesc').value = c.description || '';
                    $('clientForm').dataset.editId = c.id;
                    $('clientFormTitle').textContent = 'Edit Client';
                    $('clientFormSave').textContent = 'Save Changes';
                });
                row.querySelector('.client-delete').addEventListener('click', async function () {
                    var btn = row.querySelector('.client-delete');
                    btn.disabled = true;
                    try {
                        var res = await authFetch('/api/clients/' + c.id, { method: 'DELETE' });
                        var data = await res.json().catch(function () { return {}; });
                        if (res.status === 401) return onAuthError();
                        if (!res.ok) { setClientsMessage('error', data.error || 'Unable to delete the client.'); btn.disabled = false; return; }
                        setClientsMessage('success', data.message || 'Client deleted successfully.');
                        loadClients();
                    } catch (_) { btn.disabled = false; setClientsMessage('error', 'Unable to delete the client.'); }
                });
            }
            wrap.appendChild(row);
        });
    }

    function setClientsMessage(kind, msg) {
        var el = $('clientsMessage');
        el.className = 'form-message' + (kind ? ' ' + kind : '');
        el.textContent = msg || '';
    }

    function fillClientSelect() {
        var sel = $('projClient');
        var current = sel.value;
        sel.innerHTML = '<option value="">Select client…</option>' +
            clients.map(function (c) { return '<option value="' + c.id + '">' + escapeHtml(c.name) + '</option>'; }).join('');
        if (current) sel.value = current;
    }

    async function submitClientForm(e) {
        e.preventDefault();
        var form = $('clientForm');
        var id = form.dataset.editId;
        var body = {
            name: $('clientFormName').value.trim(),
            contactEmail: $('clientFormEmail').value.trim(),
            description: $('clientFormDesc').value.trim()
        };
        if (!body.name) { setClientsMessage('error', 'Client name is required.'); return; }
        var btn = $('clientFormSave');
        btn.disabled = true;
        try {
            var res = await authFetch(id ? '/api/clients/' + id : '/api/clients', {
                method: id ? 'PATCH' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            var data = await res.json().catch(function () { return {}; });
            if (res.status === 401) return onAuthError();
            if (!res.ok) { setClientsMessage('error', data.error || 'Unable to save the client.'); return; }
            setClientsMessage('success', data.message || 'Client saved successfully.');
            form.reset();
            delete form.dataset.editId;
            $('clientFormTitle').textContent = 'Add Client';
            $('clientFormSave').textContent = 'Add Client';
            loadClients();
        } catch (_) {
            setClientsMessage('error', 'Unable to save the client. Please try again.');
        } finally {
            btn.disabled = false;
        }
    }

    // ---------- Create / edit form ----------
    async function loadTeamMembers() {
        var box = $('projTeamBoxes');
        box.innerHTML = '<span class="proj-team-loading">Loading…</span>';
        try {
            var res = await authFetch('/api/projects/users');
            if (res.status === 401) return onAuthError();
            if (!res.ok) throw new Error('server');
            var users = (await res.json()).users || [];
            box.innerHTML = users.length
                ? users.map(function (u) {
                    return '<label class="proj-team-check"><input type="checkbox" value="' + u.id + '"> ' + escapeHtml(u.fullName) + '</label>';
                }).join('')
                : '<span class="proj-team-loading">No team members available.</span>';
        } catch (_) {
            box.innerHTML = '<span class="proj-team-loading">Unable to load team members.</span>';
        }
    }

    function openForm(project) {
        editingProjectId = project ? project.id : null;
        $('projFormTitle').textContent = project ? 'Edit Project' : 'Create Project';
        $('projSaveBtn').textContent = project ? 'Save Changes' : 'Create Project';
        $('projName').value = project ? project.name : '';
        $('projDesc').value = project ? (project.description || '') : '';
        $('projStatus').value = project ? project.status : 'NOT_STARTED';
        setFormMessage('', '');
        $('projFormCard').classList.remove('hidden');
        loadClients().then(function () {
            if (project) $('projClient').value = project.clientId;
        });
        loadTeamMembers().then(function () {
            if (project) {
                // Pre-check the assigned team members (ids come from the project payload).
                (project.teamIds || []).forEach(function (id) {
                    var box = document.querySelector('#projTeamBoxes input[value="' + id + '"]');
                    if (box) box.checked = true;
                });
            }
        });
        $('projFormCard').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    function closeForm() {
        $('projFormCard').classList.add('hidden');
        $('projForm').reset();
        editingProjectId = null;
    }

    async function submitForm(e) {
        e.preventDefault();
        var name = $('projName').value.trim();
        var clientId = $('projClient').value;
        if (!name || name.length < 3) { setFormMessage('error', 'Project name must be at least 3 characters.'); return; }
        if (!clientId) { setFormMessage('error', 'Please select a client.'); return; }
        var teamMemberIds = Array.prototype.slice.call(document.querySelectorAll('#projTeamBoxes input:checked')).map(function (c) { return Number(c.value); });
        var body = {
            name: name,
            description: $('projDesc').value.trim(),
            clientId: Number(clientId),
            status: $('projStatus').value,
            teamMemberIds: teamMemberIds
        };
        var btn = $('projSaveBtn');
        btn.disabled = true;
        var original = btn.textContent;
        btn.textContent = editingProjectId ? 'Saving…' : 'Creating…';
        try {
            var res = await authFetch(editingProjectId ? '/api/projects/' + editingProjectId : '/api/projects', {
                method: editingProjectId ? 'PATCH' : 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            var data = await res.json().catch(function () { return {}; });
            if (res.status === 401) return onAuthError();
            if (!res.ok) { setFormMessage('error', data.error || 'Unable to save the project.'); return; }
            closeForm();
            setMessage('success', data.message || (editingProjectId ? 'Project updated successfully.' : 'Project created successfully.'));
            await loadAll();
        } catch (_) {
            setFormMessage('error', 'Unable to save the project. Please try again.');
        } finally {
            btn.disabled = false;
            btn.textContent = original;
        }
    }

    async function deleteProject(p, card) {
        if (!confirm('Delete project "' + p.name + '"? This cannot be undone.')) return;
        try {
            var res = await authFetch('/api/projects/' + p.id, { method: 'DELETE' });
            var data = await res.json().catch(function () { return {}; });
            if (res.status === 401) return onAuthError();
            if (res.status === 403) { setMessage('error', data.error || 'You are not authorized to delete projects.'); return; }
            if (res.status === 404) { setMessage('error', 'Project not found. Refreshing…'); await loadAll(); return; }
            if (!res.ok) throw new Error('server');
            setMessage('success', data.message || 'Project deleted successfully.');
            await loadAll();
        } catch (_) {
            setMessage('error', 'Unable to delete the project. Please try again.');
        }
    }

    function init(options) {
        getToken = options.getToken || function () { return null; };
        onAuthError = options.onAuthError || onAuthError;
        isAdmin = !!options.isAdmin;

        $('projCreateBtn').addEventListener('click', function () { openForm(null); });
        $('projFormClose').addEventListener('click', closeForm);
        $('projCancelBtn').addEventListener('click', closeForm);
        $('projForm').addEventListener('submit', submitForm);
        $('projClientsBtn').addEventListener('click', openClients);
        $('clientsModalClose').addEventListener('click', closeClients);
        $('clientsModalOverlay').addEventListener('click', function (e) {
            if (e.target === $('clientsModalOverlay')) closeClients();
        });
        $('clientForm').addEventListener('submit', submitClientForm);

        var nav = document.querySelector('.dash-nav-item[data-nav="projects"]');
        if (nav) nav.addEventListener('click', function () {
            if (!loaded) { loaded = true; loadAll(); }
        });
    }

    // Called by dashboard.js once the profile (role) is known.
    function setAdmin(admin) {
        isAdmin = !!admin;
        if (isAdmin) {
            $('projCreateBtn').classList.remove('hidden');
            $('projClientsBtn').classList.remove('hidden');
        } else {
            $('projCreateBtn').classList.add('hidden');
            $('projClientsBtn').classList.add('hidden');
        }
    }

    window.TaloraProjects = { init: init, setAdmin: setAdmin };
})();
