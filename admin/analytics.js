// Chart.js global defaults to match brand
Chart.defaults.font.family = "'Libre Baskerville', serif";
Chart.defaults.color = '#2C1E16';

const ACCENT_RED = '#B73225';
const PRIMARY_DARK = '#3E2723';
const BORDER_COLOR = '#D4C5B0';
const BAR_COLOR = 'rgba(183, 50, 37, 0.8)';
const BAR_HOVER = 'rgba(183, 50, 37, 1)';

// Chart instances (kept so we can destroy+recreate on range change)
let chartDow, chartSlot, chartTrend, chartSize;

// ── Clock ────────────────────────────────────────────────────────

function updateClock() {
  const now = new Date();
  document.getElementById('current-date').textContent = now.toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
  document.getElementById('current-time').textContent = now.toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit',
  });
}
updateClock();
setInterval(updateClock, 30000);

// ── Date range helpers ───────────────────────────────────────────

function toDateStr(d) {
  return d.toISOString().split('T')[0];
}

function getPresetRange(days) {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - (days - 1));
  return { from: toDateStr(from), to: toDateStr(to) };
}

let currentFrom, currentTo;

// ── Range UI ─────────────────────────────────────────────────────

document.querySelectorAll('.btn-range').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.btn-range').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const { from, to } = getPresetRange(parseInt(btn.dataset.days));
    currentFrom = from;
    currentTo = to;
    document.getElementById('from-date').value = from;
    document.getElementById('to-date').value = to;
    loadAnalytics(from, to);
  });
});

function applyCustomRange() {
  const from = document.getElementById('from-date').value;
  const to = document.getElementById('to-date').value;
  if (!from || !to || from > to) return;
  document.querySelectorAll('.btn-range').forEach(b => b.classList.remove('active'));
  currentFrom = from;
  currentTo = to;
  loadAnalytics(from, to);
}

// ── Load & render ────────────────────────────────────────────────

async function loadAnalytics(from, to) {
  try {
    const res = await fetch(`/api/admin/analytics?from=${from}&to=${to}`);
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    renderSummary(data.summary);
    renderDOW(data.byDayOfWeek);
    renderSlot(data.byTimeSlot);
    renderHeatmap(data.heatmap);
    renderTrend(data.byDate);
    renderSize(data.partySizeDistribution);
    renderDetailStats(data.summary);
  } catch (err) {
    console.error('Analytics load failed:', err);
  }
}

// ── Summary Cards ────────────────────────────────────────────────

function renderSummary(s) {
  document.getElementById('stat-total').textContent = s.confirmedReservations;
  document.getElementById('stat-utilization').textContent = s.avgUtilizationPct + '%';
  document.getElementById('stat-party-size').textContent = s.avgPartySize || '—';
  document.getElementById('stat-cancel').textContent = s.cancellationRate + '%';

  // Highlight cancellation card if rate is high
  const card = document.getElementById('stat-cancel-card');
  card.classList.toggle('stat-card-warn', s.cancellationRate >= 10);
}

function renderDetailStats(s) {
  document.getElementById('stat-bowlers').textContent = s.totalBowlers || '—';
  document.getElementById('stat-confirmed').textContent = s.confirmedReservations;
  document.getElementById('stat-cancelled').textContent = s.cancelledReservations;
  document.getElementById('stat-lead-time').textContent =
    s.avgLeadTimeDays > 0 ? s.avgLeadTimeDays + 'd' : '—';
  document.getElementById('stat-lag').textContent =
    s.avgSeatingLagMinutes > 0 ? Math.round(s.avgSeatingLagMinutes) + ' min' : '—';
}

// ── Bar chart helpers ────────────────────────────────────────────

function barOptions(xLabel) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      x: { grid: { color: BORDER_COLOR }, ticks: { font: { size: 11 } } },
      y: {
        grid: { color: BORDER_COLOR },
        beginAtZero: true,
        ticks: { precision: 0, font: { size: 11 } },
      },
    },
  };
}

// ── Day of Week chart ────────────────────────────────────────────

function renderDOW(byDOW) {
  if (chartDow) chartDow.destroy();
  chartDow = new Chart(document.getElementById('chart-dow'), {
    type: 'bar',
    data: {
      labels: byDOW.map(d => d.day),
      datasets: [{
        data: byDOW.map(d => d.count),
        backgroundColor: BAR_COLOR,
        hoverBackgroundColor: BAR_HOVER,
        borderRadius: 3,
      }],
    },
    options: barOptions('Day'),
  });
}

// ── Time Slot chart ──────────────────────────────────────────────

function renderSlot(bySlot) {
  if (chartSlot) chartSlot.destroy();
  chartSlot = new Chart(document.getElementById('chart-slot'), {
    type: 'bar',
    data: {
      labels: bySlot.map(s => s.slot),
      datasets: [{
        data: bySlot.map(s => s.count),
        backgroundColor: BAR_COLOR,
        hoverBackgroundColor: BAR_HOVER,
        borderRadius: 3,
      }],
    },
    options: {
      ...barOptions('Time'),
      scales: {
        x: {
          grid: { color: BORDER_COLOR },
          ticks: { font: { size: 10 }, maxRotation: 45, minRotation: 30 },
        },
        y: {
          grid: { color: BORDER_COLOR },
          beginAtZero: true,
          ticks: { precision: 0, font: { size: 11 } },
        },
      },
    },
  });
}

// ── Trend (line) chart ───────────────────────────────────────────

function renderTrend(byDate) {
  if (chartTrend) chartTrend.destroy();

  // Thin down labels when range is large
  const total = byDate.length;
  const step = total > 60 ? 7 : total > 30 ? 3 : 1;
  const labels = byDate.map((d, i) => {
    if (i % step !== 0) return '';
    const dt = new Date(d.date + 'T00:00:00');
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  });

  chartTrend = new Chart(document.getElementById('chart-trend'), {
    type: 'line',
    data: {
      labels,
      datasets: [{
        data: byDate.map(d => d.count),
        borderColor: ACCENT_RED,
        backgroundColor: 'rgba(183,50,37,0.08)',
        fill: true,
        tension: 0.3,
        pointRadius: total > 60 ? 0 : 3,
        pointHoverRadius: 5,
        borderWidth: 2,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: BORDER_COLOR }, ticks: { font: { size: 10 } } },
        y: {
          grid: { color: BORDER_COLOR },
          beginAtZero: true,
          ticks: { precision: 0, font: { size: 11 } },
        },
      },
    },
  });
}

// ── Party Size chart ─────────────────────────────────────────────

function renderSize(dist) {
  if (chartSize) chartSize.destroy();
  chartSize = new Chart(document.getElementById('chart-size'), {
    type: 'bar',
    data: {
      labels: dist.map(d => d.label + ' people'),
      datasets: [{
        data: dist.map(d => d.count),
        backgroundColor: [
          'rgba(183,50,37,0.5)',
          'rgba(183,50,37,0.7)',
          'rgba(183,50,37,0.85)',
          'rgba(183,50,37,1)',
        ],
        hoverBackgroundColor: BAR_HOVER,
        borderRadius: 3,
      }],
    },
    options: barOptions('Size'),
  });
}

// ── Heatmap ──────────────────────────────────────────────────────

const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const TIME_SLOTS = ['0900','1000','1100','1200','1300','1400','1500','1600','1700'];
const SLOT_LABELS = {
  '0900':'9 AM','1000':'10 AM','1100':'11 AM','1200':'12 PM',
  '1300':'1 PM','1400':'2 PM','1500':'3 PM','1600':'4 PM','1700':'5 PM',
};

function heatColor(pct) {
  // cream (#F4EFE6) → accent red (#B73225)
  const r = Math.round(244 + (183 - 244) * pct / 100);
  const g = Math.round(239 + (50  - 239) * pct / 100);
  const b = Math.round(230 + (37  - 230) * pct / 100);
  return `rgb(${r},${g},${b})`;
}

function renderHeatmap(heatmap) {
  // Build column labels (days)
  const colLabels = document.getElementById('heatmap-col-labels');
  colLabels.innerHTML = DOW_LABELS.map(d => `<div class="heatmap-col-label">${d}</div>`).join('');

  // Build row labels (time slots)
  const rowLabels = document.getElementById('heatmap-row-labels');
  rowLabels.innerHTML = TIME_SLOTS.map(s =>
    `<div class="heatmap-row-label">${SLOT_LABELS[s]}</div>`
  ).join('');

  // Build grid cells: row = time slot, col = day
  // Grid is defined as 7 cols × 9 rows, laid out column-major via CSS grid
  // We need to fill it row by row: for each time slot, 7 cells across days
  const grid = document.getElementById('heatmap-grid');
  let html = '';
  for (const slot of TIME_SLOTS) {
    for (let dow = 0; dow < 7; dow++) {
      const pct = (heatmap[dow] && heatmap[dow][slot]) ? heatmap[dow][slot] : 0;
      const bg = heatColor(pct);
      const textColor = pct >= 50 ? 'white' : '#2C1E16';
      const label = pct > 0 ? pct + '%' : '';
      html += `<div class="heatmap-cell" style="background:${bg};color:${textColor}" title="${DOW_LABELS[dow]} ${SLOT_LABELS[slot]}: ${pct}%">${label}</div>`;
    }
  }
  grid.innerHTML = html;
}

// ── Init ─────────────────────────────────────────────────────────

(function init() {
  const { from, to } = getPresetRange(30);
  currentFrom = from;
  currentTo = to;
  document.getElementById('from-date').value = from;
  document.getElementById('to-date').value = to;
  loadAnalytics(from, to);
})();
