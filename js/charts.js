let costChart = null;
let memberChart = null;

function getCSSVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888';
}

const CATEGORY_COLORS = {
  bazar: '#6366f1',
  utility: '#14b8a6',
  rent: '#f59e0b',
  other: '#ec4899'
};

export function renderCostChart(ctx, byCategory) {
  const labels = Object.keys(byCategory);
  const data = Object.values(byCategory);
  const colors = labels.map((l, i) => CATEGORY_COLORS[l] || ['#3b82f6', '#84cc16', '#ef4444'][i % 3]);
  if (costChart) costChart.destroy();
  costChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: labels.map(l => l.charAt(0).toUpperCase() + l.slice(1)),
      datasets: [{ data, backgroundColor: colors, borderWidth: 0, hoverOffset: 6 }]
    },
    options: {
      plugins: {
        legend: { position: 'bottom', labels: { color: getCSSVar('--text'), boxWidth: 12, padding: 14 } }
      },
      cutout: '65%'
    }
  });
}

export function renderMemberChart(ctx, rows) {
  if (memberChart) memberChart.destroy();
  memberChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: rows.map(r => r.member.name),
      datasets: [
        { label: 'Deposit', data: rows.map(r => Math.round(r.deposit)), backgroundColor: '#6366f1', borderRadius: 6 },
        { label: 'Cost', data: rows.map(r => Math.round(r.totalOwed)), backgroundColor: '#f59e0b', borderRadius: 6 }
      ]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { labels: { color: getCSSVar('--text'), boxWidth: 12 } }
      },
      scales: {
        x: { ticks: { color: getCSSVar('--text-muted') }, grid: { display: false } },
        y: { ticks: { color: getCSSVar('--text-muted') }, grid: { color: getCSSVar('--border') }, beginAtZero: true }
      }
    }
  });
}
