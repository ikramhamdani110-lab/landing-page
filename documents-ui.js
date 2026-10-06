// Task 10 — Documents section of the dashboard.
// Driven by dashboard.js via initDocuments({ authFetch, showPanelHook }); all requests
// go through the same bearer-token authFetch used by Customer Requests. Real backend
// calls only: POST /api/documents (multipart), GET /api/documents, DELETE /api/documents/:id.

(function () {
    'use strict';

    var $ = function (id) { return document.getElementById(id); };
    var getToken = null;
    var onAuthError = null;
    var loaded = false;

    function authFetch(path, options) {
        var opts = options || {};
        opts.headers = Object.assign({ 'Authorization': 'Bearer ' + (getToken ? getToken() : '') }, opts.headers || {});
        return fetch(path, opts);
    }

    var ACCEPTED = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'png', 'jpg', 'jpeg'];
    var MAX_MB = 10;

    function setDocMessage(kind, msg) {
        var el = $('docMessage');
        el.className = 'form-message' + (kind ? ' ' + kind : '');
        el.textContent = msg || '';
    }
    function setListMessage(kind, msg) {
        var el = $('docListMessage');
        el.className = 'form-message' + (kind ? ' ' + kind : '');
        el.textContent = msg || '';
    }

    function showDocState(state) {
        ['docLoading', 'docError', 'docEmpty', 'docListWrap'].forEach(function (id) {
            var el = $(id);
            if (el) el.classList.add('hidden');
        });
        var el = $(state);
        if (el) el.classList.remove('hidden');
    }

    function formatSize(bytes) {
        if (!Number.isFinite(bytes) || bytes <= 0) return '—';
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    }

    function typeLabel(doc) {
        var ext = (doc.originalFilename || '').split('.').pop().toUpperCase();
        return ext + ' · ' + formatSize(doc.size);
    }

    function escapeHtml(v) {
        return String(v == null ? '' : v)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    async function loadDocuments() {
        showDocState('docLoading');
        try {
            var res = await authFetch('/api/documents');
            if (res.status === 401 || res.status === 403) { showDocState('docError'); $('docErrorText').textContent = 'You must be authenticated to view documents.'; return; }
            if (!res.ok) throw new Error('server');
            var data = await res.json();
            var items = (data && data.items) || [];
            if (!items.length) { showDocState('docEmpty'); return; }
            renderList(items);
        } catch (_) {
            $('docErrorText').textContent = 'Failed to load documents. Please try again.';
            showDocState('docError');
        }
    }

    function renderList(items) {
        var wrap = $('docListWrap');
        wrap.innerHTML = '';
        items.forEach(function (doc) {
            var card = document.createElement('article');
            card.className = 'dash-card doc-item';
            var created = doc.createdAt ? new Date(doc.createdAt) : null;
            card.innerHTML =
                '<div class="doc-item-main">' +
                    '<i class=\'bx bx-file-blank doc-icon\'></i>' +
                    '<div class="doc-meta">' +
                        '<span class="doc-name">' + escapeHtml(doc.originalFilename) + '</span>' +
                        '<span class="doc-sub">' + escapeHtml(typeLabel(doc)) +
                        (created ? ' · Uploaded: ' + created.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : '') +
                        '</span>' +
                    '</div>' +
                '</div>' +
                '<button type="button" class="btn btn-ghost btn-sm doc-delete" data-id="' + doc.id + '"><i class=\'bx bx-trash\'></i> Delete</button>';
            card.querySelector('.doc-delete').addEventListener('click', function () { deleteDocument(doc, card); });
            wrap.appendChild(card);
        });
        showDocState('docListWrap');
    }

    async function deleteDocument(doc, card) {
        var btn = card.querySelector('.doc-delete');
        btn.disabled = true;
        setListMessage('', '');
        try {
            var res = await authFetch('/api/documents/' + doc.id, { method: 'DELETE' });
            var data = await res.json().catch(function () { return {}; });
            if (res.status === 401) { setListMessage('error', 'You must be authenticated to delete documents.'); btn.disabled = false; return; }
            if (res.status === 403) { setListMessage('error', 'You are not authorized to delete this document.'); btn.disabled = false; return; }
            if (res.status === 404) { setListMessage('error', 'Document not found. Refreshing…'); await loadDocuments(); return; }
            if (!res.ok) throw new Error('server');
            card.remove();
            setListMessage('success', data.message || 'Document deleted successfully.');
            var wrap = $('docListWrap');
            if (!wrap.querySelector('.doc-item')) showDocState('docEmpty');
        } catch (_) {
            btn.disabled = false;
            setListMessage('error', 'Failed to delete document. Please try again.');
        }
    }

    // ---- Upload flow ----
    function onFileChosen() {
        var input = $('docFile');
        var btn = $('docUploadBtn');
        var sel = $('docSelected');
        setDocMessage('', '');
        var f = input.files && input.files[0];
        btn.disabled = !f;
        sel.classList.toggle('hidden', !f);
        if (!f) { $('docSelectedName').textContent = ''; return; }
        $('docSelectedName').textContent = f.name + ' (' + formatSize(f.size) + ')';
        var ext = f.name.split('.').pop().toLowerCase();
        if (ACCEPTED.indexOf(ext) === -1) {
            setDocMessage('error', 'This file type is not supported. Allowed: PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX, TXT, PNG, JPG, JPEG.');
            btn.disabled = true;
            return;
        }
        if (f.size > MAX_MB * 1024 * 1024) {
            setDocMessage('error', 'The file is too large. Maximum size is ' + MAX_MB + ' MB.');
            btn.disabled = true;
            return;
        }
    }

    async function onUpload(e) {
        e.preventDefault();
        var input = $('docFile');
        var btn = $('docUploadBtn');
        var f = input.files && input.files[0];
        if (!f) { setDocMessage('error', 'Please choose a file to upload.'); return; }
        if (!getToken) return;

        btn.disabled = true;
        btn.innerHTML = '<span class="dash-spinner dash-spinner-inline"></span> Uploading…';
        setDocMessage('', '');
        try {
            var fd = new FormData();
            fd.append('file', f, f.name);
            var res = await authFetch('/api/documents', { method: 'POST', body: fd });
            var data = await res.json().catch(function () { return {}; });
            if (res.status === 401) setDocMessage('error', 'You must be authenticated to upload documents.');
            else if (res.status === 413) setDocMessage('error', data.message || 'The file is too large.');
            else if (res.status === 415) setDocMessage('error', data.message || 'This file type is not supported.');
            else if (res.status === 400) setDocMessage('error', data.message || 'Upload failed. Please try again.');
            else if (!res.ok) setDocMessage('error', 'Upload failed. Please try again.');
            else {
                setDocMessage('success', data.message || 'Document uploaded successfully.');
                input.value = '';
                $('docSelected').classList.add('hidden');
                $('docSelectedName').textContent = '';
                loaded = false; // force a fresh list fetch
            }
        } catch (_) {
            setDocMessage('error', 'Upload failed. Please try again.');
        }
        btn.innerHTML = '<i class=\'bx bx-upload\'></i> Upload';
        onFileChosen();
        if (!loaded) { loaded = true; loadDocuments(); }
    }

    function init(options) {
        getToken = options.getToken || function () { return null; };
        onAuthError = options.onAuthError || function () { window.location.replace('login.html'); };
        $('docUploadForm').addEventListener('submit', onUpload);
        $('docFile').addEventListener('change', onFileChosen);
        $('docRefreshBtn').addEventListener('click', function () { loadDocuments(); });
        // Lazy-load the list the first time the panel is opened (nav click or hash nav).
        var docNav = document.querySelector('.dash-nav-item[data-nav="documents"]');
        if (docNav) docNav.addEventListener('click', function () {
            if (!loaded) { loaded = true; loadDocuments(); }
        });
    }

    window.TaloraDocuments = { init: init };
})();
