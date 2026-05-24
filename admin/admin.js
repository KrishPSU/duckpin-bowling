// ── Constants ────────────────────────────────────────────────────
const TIME_SLOTS = [
    { value: '0900', label: '9:00 AM' },
    { value: '1000', label: '10:00 AM' },
    { value: '1100', label: '11:00 AM' },
    { value: '1200', label: '12:00 PM' },
    { value: '1300', label: '1:00 PM' },
    { value: '1400', label: '2:00 PM' },
    { value: '1500', label: '3:00 PM' },
    { value: '1600', label: '4:00 PM' },
    { value: '1700', label: '5:00 PM' },
];
const TOTAL_LANES = 6;
const TODAY = new Date().toISOString().split('T')[0];

// ── State ────────────────────────────────────────────────────────
let allReservations = [];
let currentDate = TODAY;
let selectedLanes = {}; // { [reservationId]: laneNumber }

// ── Helpers ──────────────────────────────────────────────────────
function esc(s) {
    return String(s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function slotLabel(value) {
    const s = TIME_SLOTS.find(t => t.value === value);
    return s ? s.label : value;
}

function formatPartySize(adults, children) {
    let s = `${adults} Adult${adults !== 1 ? 's' : ''}`;
    if (children > 0) s += `, ${children} Child${children !== 1 ? 'ren' : ''}`;
    return s;
}

function formatBookedAt(ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    const h = d.getHours(), m = d.getMinutes().toString().padStart(2, '0');
    const ampm = h >= 12 ? 'PM' : 'AM';
    const timeStr = `${h % 12 || 12}:${m} ${ampm}`;
    return isToday
        ? `Today, ${timeStr}`
        : `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${timeStr}`;
}

function getCurrentSlotValue() {
    const h = new Date().getHours();
    return String(h).padStart(2, '0') + '00';
}

function occupiedLanesAt(startTime) {
    return allReservations
        .filter(r => r.start_time === startTime && r.status === 'seated' && r.lane_id)
        .map(r => parseInt(r.lane_id));
}

// ── Data ─────────────────────────────────────────────────────────
async function loadReservations(date) {
    try {
        const res = await fetch(`/api/admin/reservations?date=${date}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        allReservations = await res.json();
    } catch (err) {
        allReservations = [];
        document.getElementById('main-content').innerHTML =
            `<div class="error-msg">Failed to load reservations: ${esc(err.message)}</div>`;
        return;
    }
    render();
}

// ── Rendering ────────────────────────────────────────────────────
function render() {
    renderLaneStatus();
    renderReservations();
    updateSummary();
}

function renderLaneStatus() {
    const currentSlot = getCurrentSlotValue();
    const seatedNow = allReservations.filter(r =>
        r.start_time === currentSlot && r.status === 'seated' && r.lane_id
    );
    const occupiedMap = {};
    seatedNow.forEach(r => { occupiedMap[r.lane_id] = r; });

    let html = '';
    for (let n = 1; n <= TOTAL_LANES; n++) {
        const rsv = occupiedMap[n];
        if (rsv) {
            html += `<div class="lane-box occupied">
                <span class="lane-box-num">Lane ${n}</span>
                <span class="lane-box-status">Occupied</span>
                <span class="lane-box-party">${esc(rsv.party_name)}</span>
                <span class="lane-box-time">${slotLabel(rsv.start_time)}</span>
            </div>`;
        } else {
            html += `<div class="lane-box available">
                <span class="lane-box-num">Lane ${n}</span>
                <span class="lane-box-status">Open</span>
                <span class="lane-box-party">&nbsp;</span>
            </div>`;
        }
    }
    document.getElementById('lane-boxes').innerHTML = html;
}

function buildSlotLaneGrid(rsvs) {
    const laneMap = {};
    rsvs.filter(r => r.status === 'seated' && r.lane_id)
        .forEach(r => { laneMap[parseInt(r.lane_id)] = r; });

    const boxes = Array.from({ length: TOTAL_LANES }, (_, i) => i + 1).map(n => {
        const rsv = laneMap[n];
        return rsv
            ? `<div class="slot-lane-box occupied" title="${esc(rsv.party_name)}">
                   <span class="slot-lane-num">${n}</span>
                   <span class="slot-lane-party">${esc(rsv.party_name)}</span>
               </div>`
            : `<div class="slot-lane-box available">
                   <span class="slot-lane-num">${n}</span>
               </div>`;
    }).join('');

    return `<div class="slot-lane-mini">${boxes}</div>`;
}

function renderReservations() {
    if (allReservations.length === 0) {
        document.getElementById('main-content').innerHTML = `
            <div class="empty-state">
                <h3>All Clear</h3>
                <p>No reservations for ${currentDate === TODAY ? 'today' : currentDate}. Walk-ins are welcome!</p>
            </div>`;
        return;
    }

    const groups = {};
    TIME_SLOTS.forEach(s => { groups[s.value] = []; });
    allReservations.forEach(r => {
        if (groups[r.start_time] !== undefined) groups[r.start_time].push(r);
    });

    let html = '';
    TIME_SLOTS.forEach(slot => {
        const rsvs = groups[slot.value];
        if (rsvs.length === 0) return;
        const pendingCount = rsvs.filter(r => r.status === 'pending').length;
        html += `<div class="time-group">
            <div class="time-group-header">
                <span class="section-label">${slot.label}</span>
                ${pendingCount > 0 ? `<span class="slot-badge">${pendingCount} pending</span>` : ''}
            </div>
            ${buildSlotLaneGrid(rsvs)}
            <div class="reservations-list">
                ${rsvs.map(r => buildCard(r)).join('')}
            </div>
        </div>`;
    });

    document.getElementById('main-content').innerHTML = html || `
        <div class="empty-state">
            <h3>All Clear</h3>
            <p>No active reservations for ${currentDate === TODAY ? 'today' : currentDate}.</p>
        </div>`;
}

function buildCard(rsv) {
    const isSeated = rsv.status === 'seated';
    const laneTag = isSeated && rsv.lane_id
        ? `<span class="res-lane-tag">Lane ${rsv.lane_id}</span>`
        : `<span class="res-lane-tag" style="opacity:0.6">Unassigned</span>`;

    const actions = isSeated
        ? `<span class="seated-badge">&#10003; Seated on Lane ${rsv.lane_id || '?'}</span>`
        : `<div class="res-actions" id="actions-${esc(rsv.id)}">
            <button class="btn-action btn-seat" onclick="openLanePicker('${esc(rsv.id)}', '${esc(rsv.start_time)}')">
                &#10003;&nbsp; Seat This Party
            </button>
            <button class="btn-action btn-remove" onclick="removeReservation('${esc(rsv.id)}', '${esc(rsv.party_name)}', '${esc(rsv.start_time)}')">
                &#10007;&nbsp; No-Show
            </button>
        </div>`;

    return `<div class="reservation-card ${isSeated ? 'seated' : ''}" id="card-${esc(rsv.id)}">
        <div class="res-header ${isSeated ? 'seated-header' : ''}">
            <span class="res-name">${esc(rsv.party_name)}</span>
            ${laneTag}
        </div>
        <div class="res-body">
            <div class="res-details">
                <div class="detail-item">
                    <span class="detail-label">Party Size</span>
                    <span class="detail-value">${formatPartySize(rsv.adults, rsv.children)}</span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">Time</span>
                    <span class="detail-value">${slotLabel(rsv.start_time)}</span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">Date</span>
                    <span class="detail-value">${new Date(rsv.reservation_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</span>
                </div>
                <div class="detail-item">
                    <span class="detail-label">Seated At</span>
                    <span class="detail-value">${formatBookedAt(rsv.seated_at)}</span>
                </div>
            </div>
            ${actions}
        </div>
    </div>`;
}

function updateSummary() {
    const pending = allReservations.filter(r => r.status === 'pending').length;
    const currentSlot = getCurrentSlotValue();
    const occupiedNow = new Set(
        allReservations
            .filter(r => r.start_time === currentSlot && r.status === 'seated' && r.lane_id)
            .map(r => r.lane_id)
    ).size;

    document.getElementById('pending-summary').textContent =
        `${pending} Pending ${pending === 1 ? 'Reservation' : 'Reservations'}`;
    document.getElementById('occupied-summary').textContent =
        `${occupiedNow} of ${TOTAL_LANES} Lanes Occupied`;
}

// ── Seat a Party ──────────────────────────────────────────────────
function openLanePicker(id, startTime) {
    const actionsEl = document.getElementById(`actions-${id}`);
    if (!actionsEl) return;

    const occupied = occupiedLanesAt(startTime);
    selectedLanes[id] = null;

    const laneButtons = Array.from({ length: TOTAL_LANES }, (_, i) => i + 1).map(n => {
        const isTaken = occupied.includes(n);
        return `<button
            class="btn-lane"
            id="lane-btn-${id}-${n}"
            ${isTaken ? 'disabled' : ''}
            onclick="selectLane('${esc(id)}', ${n})"
        >${isTaken ? `Lane ${n} (Taken)` : `Lane ${n}`}</button>`;
    }).join('');

    actionsEl.innerHTML = `
        <div class="lane-picker">
            <span class="lane-picker-label">Select a lane to assign:</span>
            <div class="lane-picker-grid">${laneButtons}</div>
            <div class="lane-picker-actions">
                <button class="btn-confirm-seat" id="confirm-seat-${esc(id)}" disabled
                    onclick="confirmSeat('${esc(id)}')">
                    &#10003; Confirm &amp; Seat
                </button>
                <button class="btn-cancel-seat" onclick="cancelLanePicker('${esc(id)}', '${esc(startTime)}')">
                    Cancel
                </button>
            </div>
        </div>`;
}

function selectLane(id, laneNum) {
    selectedLanes[id] = laneNum;
    document.querySelectorAll(`[id^="lane-btn-${id}-"]`).forEach(btn => btn.classList.remove('selected'));
    const chosen = document.getElementById(`lane-btn-${id}-${laneNum}`);
    if (chosen) chosen.classList.add('selected');
    const confirmBtn = document.getElementById(`confirm-seat-${id}`);
    if (confirmBtn) confirmBtn.disabled = false;
}

function cancelLanePicker(id, startTime) {
    const actionsEl = document.getElementById(`actions-${id}`);
    if (!actionsEl) return;
    delete selectedLanes[id];
    const rsv = allReservations.find(r => r.id === id);
    const name = rsv ? esc(rsv.party_name) : '';
    const time = rsv ? esc(rsv.start_time) : esc(startTime);
    actionsEl.innerHTML = `
        <button class="btn-action btn-seat" onclick="openLanePicker('${esc(id)}', '${time}')">
            &#10003;&nbsp; Seat This Party
        </button>
        <button class="btn-action btn-remove" onclick="removeReservation('${esc(id)}', '${name}', '${time}')">
            &#10007;&nbsp; No-Show
        </button>`;
}

async function confirmSeat(id) {
    const laneId = selectedLanes[id];
    if (!laneId) return;

    const confirmBtn = document.getElementById(`confirm-seat-${id}`);
    if (confirmBtn) { confirmBtn.disabled = true; confirmBtn.textContent = 'Seating...'; }

    try {
        const res = await fetch(`/api/admin/reservations/${id}/seat`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lane_id: laneId }),
        });
        const data = await res.json();

        if (!res.ok) {
            alert(data.error || 'Could not seat party. Please try again.');
            if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.textContent = '✓ Confirm & Seat'; }
            return;
        }

        const idx = allReservations.findIndex(r => r.id === id);
        if (idx !== -1) allReservations[idx] = data;
        delete selectedLanes[id];
        render();
    } catch {
        alert('Connection error. Please try again.');
        if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.textContent = '✓ Confirm & Seat'; }
    }
}

// ── Remove a Reservation ──────────────────────────────────────────
async function removeReservation(id, partyName, startTime) {
    const name = partyName || (allReservations.find(r => r.id === id) || {}).party_name || 'this party';
    const time = slotLabel(startTime);
    if (!confirm(`Mark "${name}" at ${time} as a no-show?\n\nTheir slot will open for others, but the record will be kept.`)) return;

    const card = document.getElementById(`card-${id}`);
    if (card) {
        card.style.opacity = '0';
        card.style.transform = 'translateX(24px)';
    }

    try {
        const res = await fetch(`/api/admin/reservations/${id}`, { method: 'DELETE' });
        if (!res.ok) {
            const data = await res.json();
            alert(data.error || 'Could not remove reservation.');
            if (card) { card.style.opacity = ''; card.style.transform = ''; }
            return;
        }

        allReservations = allReservations.filter(r => r.id !== id);
        setTimeout(() => render(), 370);
    } catch {
        alert('Connection error. Please try again.');
        if (card) { card.style.opacity = ''; card.style.transform = ''; }
    }
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

    socket.on('reservation:new', (rsv) => {
        if (rsv.reservation_date === currentDate) {
            allReservations.push(rsv);
            render();
        }
    });

    socket.on('reservation:seated', (rsv) => {
        if (rsv.reservation_date === currentDate) {
            const idx = allReservations.findIndex(r => r.id === rsv.id);
            if (idx !== -1) allReservations[idx] = rsv;
            else allReservations.push(rsv);
            render();
        }
    });

    socket.on('reservation:removed', ({ id }) => {
        const idx = allReservations.findIndex(r => r.id === id);
        if (idx !== -1) {
            allReservations.splice(idx, 1);
            render();
        }
    });
}

// ── Boot ──────────────────────────────────────────────────────────
function init() {
    currentDate = TODAY;
    document.getElementById('admin-date').value = TODAY;

    document.getElementById('admin-date').addEventListener('change', (e) => {
        currentDate = e.target.value;
        allReservations = [];
        document.getElementById('main-content').innerHTML = '<p class="loading-msg">Loading&hellip;</p>';
        loadReservations(currentDate);
    });

    updateClock();
    setInterval(updateClock, 1000);
    setInterval(() => { if (allReservations.length > 0) render(); }, 60_000);

    initSocket();
    loadReservations(currentDate);
}

init();
