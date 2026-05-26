// ── State ────────────────────────────────────────────────────────
let announcements = [];
let editingId = null;
let deletingId = null;
const selectedColor = { create: null, edit: null };

// ── Helpers ──────────────────────────────────────────────────────
function esc(s) {
    return String(s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const COLOR_CLASS = { grey: 'ann-grey', yellow: 'ann-yellow', red: 'ann-red', green: 'ann-green' };

// ── Load & Render ─────────────────────────────────────────────────
async function loadAnnouncements() {
    try {
        const res = await fetch('/api/admin/announcements');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        announcements = await res.json();
    } catch (err) {
        document.getElementById('ann-list').innerHTML =
            `<div class="error-msg">Failed to load announcements: ${esc(err.message)}</div>`;
        return;
    }
    renderAnnouncements();
}

function renderAnnouncements() {
    const listEl = document.getElementById('ann-list');
    if (announcements.length === 0) {
        listEl.innerHTML = `<div class="empty-state">
            <h3>No Announcements</h3>
            <p>Use the + button below to post your first announcement.</p>
        </div>`;
        return;
    }
    listEl.innerHTML = announcements.map(buildMgmtCard).join('');
}

function buildMgmtCard(ann) {
    const colorClass = COLOR_CLASS[ann.color] || 'ann-grey';
    return `<div class="ann-mgmt-card ${colorClass}" id="ann-card-${esc(ann.id)}">
        <div class="ann-mgmt-header">
            <span class="ann-mgmt-title">${esc(ann.header)}</span>
            <div class="ann-mgmt-btns">
                <button class="btn-edit-ann" onclick="openEditModal('${esc(ann.id)}')">Edit</button>
                <button class="btn-delete-ann" onclick="openDeleteModal('${esc(ann.id)}')">Delete</button>
            </div>
        </div>
        <div class="ann-card-body">${esc(ann.content)}</div>
    </div>`;
}

// ── Color Selection ───────────────────────────────────────────────
function selectColor(mode, color) {
    selectedColor[mode] = color;
    const containerId = mode === 'create' ? 'create-swatches' : 'edit-swatches';
    document.getElementById(containerId).querySelectorAll('.color-swatch').forEach(s => {
        s.classList.toggle('selected', s.dataset.color === color);
    });
}

// ── Create Modal ──────────────────────────────────────────────────
function openAnnouncementModal() {
    document.getElementById('ann-header').value = '';
    document.getElementById('ann-content').value = '';
    selectedColor.create = null;
    document.getElementById('create-swatches').querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
    const errorEl = document.getElementById('create-modal-error');
    errorEl.style.display = 'none';
    const btn = document.getElementById('post-announce-btn');
    btn.disabled = false;
    btn.textContent = 'Post Announcement';
    document.getElementById('announcement-modal').classList.add('open');
    document.getElementById('ann-header').focus();
}

function closeAnnouncementModal() {
    document.getElementById('announcement-modal').classList.remove('open');
}

function handleCreateOverlayClick(e) {
    if (e.target === document.getElementById('announcement-modal')) closeAnnouncementModal();
}

async function submitAnnouncement() {
    const header  = document.getElementById('ann-header').value.trim();
    const content = document.getElementById('ann-content').value.trim();
    const errorEl = document.getElementById('create-modal-error');
    errorEl.style.display = 'none';

    if (!header) {
        errorEl.textContent = 'Please enter a title for your announcement.';
        errorEl.style.display = 'block';
        return;
    }
    if (!content) {
        errorEl.textContent = 'Please enter a message.';
        errorEl.style.display = 'block';
        return;
    }
    if (!selectedColor.create) {
        errorEl.textContent = 'Please choose a background color.';
        errorEl.style.display = 'block';
        return;
    }

    const btn = document.getElementById('post-announce-btn');
    btn.disabled = true;
    btn.textContent = 'Posting...';

    try {
        const res = await fetch('/api/admin/announcements', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ header, content, color: selectedColor.create }),
        });
        const data = await res.json();
        if (!res.ok) {
            errorEl.textContent = data.error || 'Could not post announcement. Please try again.';
            errorEl.style.display = 'block';
            btn.disabled = false;
            btn.textContent = 'Post Announcement';
            return;
        }
        closeAnnouncementModal();
        announcements.unshift(data);
        renderAnnouncements();
        showAdminToast('Announcement posted!');
    } catch {
        errorEl.textContent = 'Connection error. Please try again.';
        errorEl.style.display = 'block';
        btn.disabled = false;
        btn.textContent = 'Post Announcement';
    }
}

// ── Edit Modal ────────────────────────────────────────────────────
function openEditModal(id) {
    const ann = announcements.find(a => a.id === id);
    if (!ann) return;
    editingId = id;

    document.getElementById('edit-ann-header').value = ann.header;
    document.getElementById('edit-ann-content').value = ann.content;
    selectedColor.edit = ann.color;

    document.getElementById('edit-swatches').querySelectorAll('.color-swatch').forEach(s => {
        s.classList.toggle('selected', s.dataset.color === ann.color);
    });

    const errorEl = document.getElementById('edit-modal-error');
    errorEl.style.display = 'none';
    const btn = document.getElementById('save-edit-btn');
    btn.disabled = false;
    btn.textContent = 'Save Changes';

    document.getElementById('edit-modal').classList.add('open');
    document.getElementById('edit-ann-header').focus();
}

function closeEditModal() {
    document.getElementById('edit-modal').classList.remove('open');
    editingId = null;
}

function handleEditOverlayClick(e) {
    if (e.target === document.getElementById('edit-modal')) closeEditModal();
}

async function submitEdit() {
    const header  = document.getElementById('edit-ann-header').value.trim();
    const content = document.getElementById('edit-ann-content').value.trim();
    const errorEl = document.getElementById('edit-modal-error');
    errorEl.style.display = 'none';

    if (!header) {
        errorEl.textContent = 'Please enter a title.';
        errorEl.style.display = 'block';
        return;
    }
    if (!content) {
        errorEl.textContent = 'Please enter a message.';
        errorEl.style.display = 'block';
        return;
    }
    if (!selectedColor.edit) {
        errorEl.textContent = 'Please choose a background color.';
        errorEl.style.display = 'block';
        return;
    }

    const btn = document.getElementById('save-edit-btn');
    btn.disabled = true;
    btn.textContent = 'Saving...';

    try {
        const res = await fetch(`/api/admin/announcements/${editingId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ header, content, color: selectedColor.edit }),
        });
        const data = await res.json();
        if (!res.ok) {
            errorEl.textContent = data.error || 'Could not save changes. Please try again.';
            errorEl.style.display = 'block';
            btn.disabled = false;
            btn.textContent = 'Save Changes';
            return;
        }
        const idx = announcements.findIndex(a => a.id === editingId);
        if (idx !== -1) announcements[idx] = data;
        closeEditModal();
        renderAnnouncements();
        showAdminToast('Announcement updated!');
    } catch {
        errorEl.textContent = 'Connection error. Please try again.';
        errorEl.style.display = 'block';
        btn.disabled = false;
        btn.textContent = 'Save Changes';
    }
}

// ── Delete Modal ──────────────────────────────────────────────────
function openDeleteModal(id) {
    deletingId = id;
    const btn = document.getElementById('confirm-delete-btn');
    btn.disabled = false;
    btn.textContent = 'Yes, Delete It';
    document.getElementById('delete-modal').classList.add('open');
}

function closeDeleteModal() {
    document.getElementById('delete-modal').classList.remove('open');
    deletingId = null;
}

function handleDeleteOverlayClick(e) {
    if (e.target === document.getElementById('delete-modal')) closeDeleteModal();
}

async function confirmDelete() {
    if (!deletingId) return;
    const btn = document.getElementById('confirm-delete-btn');
    btn.disabled = true;
    btn.textContent = 'Deleting...';

    try {
        const res = await fetch(`/api/admin/announcements/${deletingId}/hide`, { method: 'PATCH' });
        if (!res.ok) {
            const data = await res.json();
            alert(data.error || 'Could not delete announcement.');
            btn.disabled = false;
            btn.textContent = 'Yes, Delete It';
            return;
        }
        announcements = announcements.filter(a => a.id !== deletingId);
        closeDeleteModal();
        renderAnnouncements();
        showAdminToast('Announcement deleted.');
    } catch {
        alert('Connection error. Please try again.');
        btn.disabled = false;
        btn.textContent = 'Yes, Delete It';
    }
}

// ── Toast ─────────────────────────────────────────────────────────
let adminToastTimer = null;
function showAdminToast(msg) {
    const el = document.getElementById('admin-toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(adminToastTimer);
    adminToastTimer = setTimeout(() => el.classList.remove('show'), 3500);
}

// ── Clock ─────────────────────────────────────────────────────────
function updateClock() {
    const now = new Date();
    const h = now.getHours(), m = now.getMinutes().toString().padStart(2, '0');
    const ampm = h >= 12 ? 'PM' : 'AM';
    document.getElementById('current-time').textContent = `${h % 12 || 12}:${m} ${ampm}`;

    const days   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const months = ['January','February','March','April','May','June','July',
                    'August','September','October','November','December'];
    document.getElementById('current-date').textContent =
        `${days[now.getDay()]}, ${months[now.getMonth()]} ${now.getDate()}, ${now.getFullYear()}`;
}

// ── Socket.IO ─────────────────────────────────────────────────────
function initSocket() {
    const socket = io();

    socket.on('announcement:new', (ann) => {
        if (announcements.find(a => a.id === ann.id)) return;
        announcements.unshift(ann);
        renderAnnouncements();
    });

    socket.on('announcement:updated', (ann) => {
        const idx = announcements.findIndex(a => a.id === ann.id);
        if (idx !== -1) {
            announcements[idx] = ann;
            renderAnnouncements();
        }
    });

    socket.on('announcement:hidden', ({ id }) => {
        announcements = announcements.filter(a => a.id !== id);
        renderAnnouncements();
    });
}

// ── Keyboard ─────────────────────────────────────────────────────
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closeAnnouncementModal();
        closeEditModal();
        closeDeleteModal();
    }
});

// ── Boot ──────────────────────────────────────────────────────────
function init() {
    updateClock();
    setInterval(updateClock, 1000);
    initSocket();
    loadAnnouncements();
}

init();
