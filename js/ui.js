export function avatarColor(name) {
  const palette = ['#6366f1', '#14b8a6', '#f59e0b', '#ec4899', '#3b82f6', '#84cc16', '#ef4444', '#8b5cf6'];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return palette[Math.abs(hash) % palette.length];
}

export function initials(name) {
  return name.trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
}

/** Whole-taka display, e.g. ৳1,107 */
export function money(n) {
  const v = Math.round(Number(n) || 0);
  return `৳${v.toLocaleString('en-US')}`;
}

/** Two-decimal display for rates, e.g. ৳86.14 */
export function money2(n) {
  const v = Number(n) || 0;
  return `৳${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Meal counts: 8 not 8.0, but 7.5 stays 7.5 */
export function num(n) {
  const v = Number(n) || 0;
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

export function openModal(innerHTML) {
  const root = document.getElementById('modalRoot');
  root.innerHTML = `<div class="modal-backdrop" id="modalBackdrop"><div class="modal">${innerHTML}</div></div>`;
  root.querySelector('#modalBackdrop').addEventListener('click', (e) => {
    if (e.target.id === 'modalBackdrop') closeModal();
  });
}

export function closeModal() {
  const root = document.getElementById('modalRoot');
  if (root) root.innerHTML = '';
}

export function toast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast${type === 'error' ? ' toast-error' : ''}`;
  el.textContent = msg;
  const root = document.getElementById('toastRoot');
  root.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, 2600);
}
