// TALORA — Customer Dashboard logic (Task 5).
// All data comes from the real backend; the token in sessionStorage is only the
// credential — every screen below is rendered from the server's response.
(function () {
    'use strict';

    var TOKEN_KEY = 'talora_user_token';
    var $ = function (id) { return document.getElementById(id); };

    var elLoading = $('dashLoading');
    var elGuest = $('dashGuest');
    var elContent = $('dashContent');
    var viewMode = $('viewMode');
    var editMode = $('editMode');
    var editMessage = $('editMessage');

    function getToken() { try { return sessionStorage.getItem(TOKEN_KEY); } catch (_) { return null; } }
    function clearToken() { try { sessionStorage.removeItem(TOKEN_KEY); } catch (_) { } }
    function goToLogin() {
        clearToken();
        window.location.replace('login.html');
    }

    function formatDate(v) {
        if (!v) return '—';
        var d = new Date(v);
        return isNaN(d) ? String(v) : d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
    }

    function signupTypeLabel(v) {
        var s = String(v || '').toLowerCase();
        if (s === 'project') return 'Start a Project';
        if (s === 'talent') return 'Join TALORA';
        return s || '—';
    }

    var currentUser = null;

    function renderUser(u) {
        currentUser = u;
        $('dashName').textContent = u.fullName || '—';
        $('pName').textContent = u.fullName || '—';
        $('pEmail').textContent = u.email || '—';
        $('pSince').textContent = formatDate(u.createdAt);
        $('pSignupType').textContent = signupTypeLabel(u.signupType);
        $('pRole').textContent = u.role || 'user';
    }

    // ---- Initial load: GET /api/user/profile with the bearer token ----
    async function loadProfile() {
        var token = getToken();
        if (!token) { showGuest(); return; }
        try {
            var res = await fetch('/api/user/profile', { headers: { 'Authorization': 'Bearer ' + token } });
            if (res.status === 401 || res.status === 403) return goToLogin(); // invalid/expired/revoked token
            if (!res.ok) throw new Error('server');
            var data = await res.json();
            if (!data || !data.user) throw new Error('shape');
            elLoading.classList.add('hidden');
            elContent.classList.remove('hidden');
            renderUser(data.user);
        } catch (_) {
            elLoading.classList.add('hidden');
            showGuest();
        }
    }

    function showGuest() {
        elLoading.classList.add('hidden');
        elContent.classList.add('hidden');
        elGuest.classList.remove('hidden');
    }

    // ---- Edit mode ----
    function openEdit() {
        if (!currentUser) return;
        $('editName').value = currentUser.fullName || '';
        $('editEmail').value = currentUser.email || '';
        editMessage.className = 'form-message';
        editMessage.textContent = '';
        $('fName').classList.remove('invalid');
        $('fEmail').classList.remove('invalid');
        viewMode.classList.add('hidden');
        editMode.classList.remove('hidden');
        $('editName').focus();
    }

    function closeEdit() {
        editMode.classList.add('hidden');
        viewMode.classList.remove('hidden');
    }

    editMode.addEventListener('submit', async function (e) {
        e.preventDefault();
        var name = $('editName').value.trim();
        var email = $('editEmail').value.trim();
        var nameOk = name.length >= 2 && name.length <= 100;
        var emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
        $('fName').classList.toggle('invalid', !nameOk);
        $('fEmail').classList.toggle('invalid', !emailOk);
        if (!nameOk || !emailOk) {
            editMessage.className = 'form-message error';
            editMessage.textContent = 'Please correct the highlighted fields and try again.';
            return;
        }

        var btn = $('saveBtn');
        btn.disabled = true; btn.textContent = 'Saving…';
        try {
            var res = await fetch('/api/user/profile', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + getToken() },
                body: JSON.stringify({ fullName: name, email: email })
            });
            if (res.status === 401 || res.status === 403) return goToLogin(); // token expired/revoked mid-session
            var data = await res.json().catch(function () { return {}; });
            if (res.ok && data.user) {
                renderUser(data.user);
                closeEdit();
                editMessage.className = 'form-message';
            } else {
                editMessage.className = 'form-message error';
                editMessage.textContent = data.error || 'Unable to update your profile. Please try again.';
            }
        } catch (_) {
            editMessage.className = 'form-message error';
            editMessage.textContent = 'Unable to update your profile. Please try again.';
        } finally {
            btn.disabled = false; btn.textContent = 'Save Changes';
        }
    });

    // ---- Logout: revoke the token server-side, then clear local state ----
    $('logoutBtn').addEventListener('click', async function () {
        var token = getToken();
        try {
            if (token) {
                await fetch('/api/auth/logout', { method: 'POST', headers: { 'Authorization': 'Bearer ' + token } });
            }
        } catch (_) { /* best-effort */ }
        goToLogin();
    });

    // ---- Navigation / sidebar ----
    var sidebar = $('dashSidebar');
    var backdrop = $('sidebarBackdrop');
    $('sidebarOpen').addEventListener('click', function () { sidebar.classList.add('open'); backdrop.classList.add('show'); });
    $('sidebarClose').addEventListener('click', closeSidebar);
    backdrop.addEventListener('click', closeSidebar);
    function closeSidebar() { sidebar.classList.remove('open'); backdrop.classList.remove('show'); }

    document.querySelectorAll('.dash-nav-item').forEach(function (item) {
        item.addEventListener('click', function () {
            document.querySelectorAll('.dash-nav-item').forEach(function (i) { i.classList.remove('active'); });
            item.classList.add('active');
            $('topbarTitle').textContent = item.textContent.trim();
            closeSidebar();
        });
    });

    $('editBtn').addEventListener('click', openEdit);
    $('cancelBtn').addEventListener('click', closeEdit);

    loadProfile();
})();
