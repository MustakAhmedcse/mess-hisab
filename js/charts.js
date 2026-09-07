let breakdownChart = null;
let dueChart = null;

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';
}

const TYPE_COLORS = {
  Bazar: '#6366f1',
  Internet: '#14b8a6',
  Electricity: '#f59e0b',
  Water: '#3b82f6',
  Gas: '#ec4899',
  Other: '#84cc16'
};

const FALLBACK = ['#8b5cf6', '#ef4444', '#0ea5e9', '#a3e635'];

/** Doughnut: Bazar vs each kind of extra cost. */
export function renderBreakdownChart(ctx, byType) {
  const labels = Object.keys(byType).filter((k) => Number(byType[k]) > 0);
  if (breakdownChart) breakdownChart.destroy();
  breakdownChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data: labels.map((l) => byType[l]),
        backgroundColor: labels.map((l, i) => TYPE_COLORS[l] || FALLBACK[i % FALLBACK.length]),
        borderWidth: 0,
        hoverOffset: 6
      }]
    },
    options: {
      plugins: { legend: { position: 'bottom', labels: { color: cssVar('--text'), boxWidth: 12, padding: 14 } } },
      cutout: '65%'
    }
  });
}

/** Bars: what each member has deposited vs what they actually owe so far. */
export function renderDueChart(ctx, rows) {
  if (dueChart) dueChart.destroy();
  dueChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: rows.map((r) => r.member.name),
      datasets: [
        { label: 'Deposit', data: rows.map((r) => Math.round(r.deposit)), backgroundColor: '#6366f1', borderRadius: 6 },
        { label: 'Per Head Cost', data: rows.map((r) => Math.round(r.perHeadCost)), backgroundColor: '#f59e0b', borderRadius: 6 }
      ]
    },
    options: {
      responsive: true,
      plugins: { legend: { labels: { color: cssVar('--text'), boxWidth: 12 } } },
      scales: {
        x: { ticks: { color: cssVar('--text-muted') }, grid: { display: false } },
        y: { ticks: { color: cssVar('--text-muted') }, grid: { color: cssVar('--border') }, beginAtZero: true }
      }
    }
  });
}
