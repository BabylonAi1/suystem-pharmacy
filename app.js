// ============== إعدادات API (Cloudflare Worker + D1) ==============
// المصدر الوحيد للحقيقة (Single Source of Truth) = Cloudflare D1 عبر الـ Worker.
// localStorage يُستخدم فقط كـ cache احتياطي للعرض السريع و وضع عدم الاتصال (offline).
// ⚠️ استخدم نفس API_BASE في كل المشروع. لا تستخدم مصادر بيانات مختلفة محلياً وعلى GitHub Pages.
const API_BASE = 'https://pharmacy-api.soogxter3.workers.dev';

// ============== الحالة (Cache من الـ API) ==============
const STORAGE = {
  meds:          'pharmacy_medicines',     // cache احتياطي
  invoices:      'pharmacy_invoices',      // cache احتياطي
  migrationDone: 'pharmacy_migration_done',// علم: تمت ترقية localStorage القديم إلى D1
};

// ⚠️ لا نُحمّل من localStorage كحالة ابتدائية كي لا تطغى البيانات القديمة على D1.
// نبدأ فارغين ثم نعبئ من API. localStorage يُحدَّث بعد أول استجابة ناجحة كـ cache.
let medications = [];
let invoices    = [];
let cart = [];
let editingMedId = null;
let currentFilter = 'all';
let currentSearch = '';

function saveMeds()     { localStorage.setItem(STORAGE.meds,     JSON.stringify(medications)); }
function saveInvoices() { localStorage.setItem(STORAGE.invoices, JSON.stringify(invoices)); }

// ============== Helper: استدعاء API ==============
async function apiCall(path, options = {}) {
  const isGet = !options.method || options.method === 'GET';
  const sep = path.includes('?') ? '&' : '?';
  const url = `${API_BASE}${path}${isGet ? `${sep}_t=${Date.now()}` : ''}`;
  const method = options.method || 'GET';
  console.log(`[API] → ${method} ${url}`, options.body || '');
  let res;
  try {
    res = await fetch(url, {
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
      ...options,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
  } catch (netErr) {
    console.error(`[API] ✗ NETWORK ERROR on ${method} ${path}:`, netErr);
    throw new Error('تعذّر الاتصال بالخادم. تحقق من الإنترنت.');
  }
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    console.error(`[API] ✗ HTTP ${res.status} on ${method} ${path}:`, errBody);
    throw new Error(errBody.error || `HTTP ${res.status}`);
  }
  if (res.status === 204) { console.log(`[API] ← 204 ${method} ${path}`); return null; }
  const data = await res.json();
  console.log(`[API] ← ${res.status} ${method} ${path}`, Array.isArray(data) ? `(${data.length} rows)` : data);
  return data;
}

// ============== 🩺 دوال API للأدوية ==============
async function getMedicines()              { const d = await apiCall('/api/medicines'); return Array.isArray(d) ? d : []; }
async function addMedicine(medicine)        { return apiCall('/api/medicines', { method: 'POST', body: medicine }); }
async function updateMedicine(id, medicine) { return apiCall(`/api/medicines/${encodeURIComponent(id)}`, { method: 'PUT', body: medicine }); }
async function deleteMedicine(id)           { return apiCall(`/api/medicines/${encodeURIComponent(id)}`, { method: 'DELETE' }); }

// ============== 🧾 دوال API للفواتير ==============
async function getInvoices()              { const d = await apiCall('/api/invoices'); return Array.isArray(d) ? d : []; }
async function addInvoice(invoice)         { return apiCall('/api/invoices', { method: 'POST', body: invoice }); }
async function updateInvoice(id, invoice)  { return apiCall(`/api/invoices/${id}`, { method: 'PUT', body: invoice }); }
async function deleteInvoice(id)           { return apiCall(`/api/invoices/${id}`, { method: 'DELETE' }); }

// ============== 📊 دالة الـ Dashboard ==============
async function getDashboard() { return apiCall('/api/dashboard'); }

// ============== مزامنة الـ cache من API ==============
// مصدر الحقيقة = Cloudflare D1. localStorage يُستخدم فقط كـ fallback لو فشل الاتصال.
async function refreshMedicines({ silent = false } = {}) {
  try {
    const fresh = await getMedicines();
    medications = fresh;
    saveMeds();
    return true;
  } catch (e) {
    console.error('[REFRESH] medicines failed → using cache:', e);
    const cached = JSON.parse(localStorage.getItem(STORAGE.meds) || '[]');
    if (medications.length === 0 && cached.length) medications = cached;
    if (!silent) toast('تعذّر الاتصال — يتم عرض النسخة المحفوظة محلياً', 'error');
    return false;
  }
}

async function refreshInvoices({ silent = false } = {}) {
  try {
    const fresh = await getInvoices();
    invoices = fresh;
    saveInvoices();
    return true;
  } catch (e) {
    console.error('[REFRESH] invoices failed → using cache:', e);
    const cached = JSON.parse(localStorage.getItem(STORAGE.invoices) || '[]');
    if (invoices.length === 0 && cached.length) invoices = cached;
    if (!silent) toast('تعذّر تحميل الفواتير — يتم عرض النسخة المحفوظة محلياً', 'error');
    return false;
  }
}

// Refresh كل البيانات في طلب واحد متوازي
async function refreshAll({ silent = false } = {}) {
  console.log('[REFRESH] refreshing medicines + invoices from D1...');
  const [a, b] = await Promise.all([
    refreshMedicines({ silent }),
    refreshInvoices({ silent }),
  ]);
  return a && b;
}

// ============== 🚚 ترقية بيانات localStorage القديمة إلى D1 (مرة واحدة فقط) ==============
async function migrateLocalStorageIfNeeded() {
  if (localStorage.getItem(STORAGE.migrationDone) === 'true') return;
  console.log('[MIGRATION] checking if local data needs to be migrated to D1...');

  let migrated = 0;

  // 1) الأدوية القديمة
  try {
    const oldMeds = JSON.parse(localStorage.getItem(STORAGE.meds) || '[]');
    const remoteMeds = await getMedicines();
    if (remoteMeds.length === 0 && oldMeds.length > 0) {
      console.log(`[MIGRATION] migrating ${oldMeds.length} medicines from localStorage → D1`);
      for (const m of oldMeds) {
        try { await addMedicine({ ...m, id: undefined }); migrated++; }
        catch (e) { console.warn('[MIGRATION] med failed:', m.name, e); }
      }
    }
  } catch (e) { console.warn('[MIGRATION] medicines step skipped:', e); }

  // 2) الفواتير القديمة
  try {
    const oldInvs = JSON.parse(localStorage.getItem(STORAGE.invoices) || '[]');
    const remoteInvs = await getInvoices();
    if (remoteInvs.length === 0 && oldInvs.length > 0) {
      console.log(`[MIGRATION] migrating ${oldInvs.length} invoices from localStorage → D1`);
      for (const inv of oldInvs) {
        try {
          await addInvoice({
            id: inv.id,                 // نحافظ على رقم الفاتورة القديم
            date: inv.date,
            total: inv.total,
            items: inv.items || [],
            skipStock: true,            // لا نخصم المخزون لأنه مخصوم تاريخياً
          });
          migrated++;
        } catch (e) { console.warn('[MIGRATION] invoice failed:', inv.id, e); }
      }
    }
  } catch (e) { console.warn('[MIGRATION] invoices step skipped:', e); }

  localStorage.setItem(STORAGE.migrationDone, 'true');
  console.log(`[MIGRATION] done. Migrated ${migrated} records.`);
  if (migrated > 0) toast(`تم رفع ${migrated} سجل قديم إلى قاعدة البيانات المشتركة`, 'success');
}

// ============== أدوات مساعدة ==============
function $(id) { return document.getElementById(id); }
function fmt(n) { return Number(n).toLocaleString('ar-EG', { maximumFractionDigits: 2 }); }
function todayStr() { return new Date().toISOString().slice(0, 10); }

function daysUntil(date) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(date);
  return Math.floor((target - today) / (1000 * 60 * 60 * 24));
}

function toast(message, type = 'success') {
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = message;
  $('toastContainer').appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity 0.4s'; }, 2500);
  setTimeout(() => t.remove(), 3000);
}

// ============== التنقل بين الصفحات ==============
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    const pageId = btn.dataset.page;
    $(pageId).classList.add('active');
    // مزامنة كل البيانات من D1 عند كل تنقّل لرؤية تحديثات الأجهزة الأخرى
    await refreshAll({ silent: true });
    if (pageId === 'dashboard') renderDashboard();
    if (pageId === 'medications') renderMedications();
    if (pageId === 'sales') renderSalesPage();
    if (pageId === 'alerts') renderAlerts();
    if (pageId === 'reports') renderReports();
    if (pageId === 'invoices') renderInvoices();
  });
});

// ============== لوحة التحكم ==============
function renderDashboard() {
  const today = todayStr();
  const todaySales = invoices.filter(inv => inv.date.startsWith(today));
  const dailyTotal = todaySales.reduce((sum, inv) => sum + inv.total, 0);
  const expiringSoon = medications.filter(m => {
    const d = daysUntil(m.expiry);
    return d >= 0 && d <= 30;
  });

  $('statMedicationsCount').textContent = fmt(medications.length);
  $('statExpiringSoon').textContent = fmt(expiringSoon.length);
  $('statDailySales').textContent = fmt(dailyTotal) + ' ج.م';
  $('statInvoicesCount').textContent = fmt(invoices.length);

  $('todayDate').textContent = new Date().toLocaleDateString('ar-EG', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  // أحدث المبيعات
  const recentBox = $('recentSales');
  const recent = invoices.slice(-5).reverse();
  if (recent.length === 0) {
    recentBox.innerHTML = '<p class="empty-state">لا توجد مبيعات بعد</p>';
  } else {
    recentBox.innerHTML = recent.map(inv => `
      <div class="recent-item">
        <div class="info">
          <strong>فاتورة #${inv.id}</strong>
          <span>${inv.items.length} منتجات · ${new Date(inv.date).toLocaleString('ar-EG')}</span>
        </div>
        <div class="amount">${fmt(inv.total)} ج.م</div>
      </div>
    `).join('');
  }

  // تنبيهات على لوحة التحكم
  const alertsBox = $('dashboardAlerts');
  const lowStock = medications.filter(m => m.qty > 0 && m.qty <= 10);
  const allAlerts = [
    ...expiringSoon.map(m => ({ med: m, type: 'warn', label: `ينتهي خلال ${daysUntil(m.expiry)} يوم` })),
    ...lowStock.map(m => ({ med: m, type: 'danger', label: `الكمية المتاحة: ${m.qty}` })),
  ].slice(0, 5);

  if (allAlerts.length === 0) {
    alertsBox.innerHTML = '<p class="empty-state">لا توجد تنبيهات حالياً</p>';
  } else {
    alertsBox.innerHTML = allAlerts.map(a => `
      <div class="recent-item ${a.type}">
        <div class="info">
          <strong>${a.med.name}</strong>
          <span>${a.med.company}</span>
        </div>
        <div class="amount">${a.label}</div>
      </div>
    `).join('');
  }

  // عداد التنبيهات
  const totalAlerts = expiringSoon.length + lowStock.length;
  const badge = $('alertsBadge');
  badge.textContent = totalAlerts;
  badge.dataset.empty = totalAlerts === 0;
}

// ============== إدارة الأدوية ==============
function getMedStatus(m) {
  const days = daysUntil(m.expiry);
  if (m.qty === 0) return { class: 'status-danger', label: 'نفد المخزون' };
  if (days < 0) return { class: 'status-danger', label: 'منتهي' };
  if (days <= 30) return { class: 'status-warn', label: 'قارب على الانتهاء' };
  if (m.qty <= 10) return { class: 'status-warn', label: 'مخزون منخفض' };
  return { class: 'status-ok', label: 'متوفر' };
}

function renderMedications() {
  const search = currentSearch.toLowerCase();
  let filtered = medications.filter(m => {
    const matchSearch = !search || m.name.toLowerCase().includes(search) ||
      m.company.toLowerCase().includes(search) || (m.barcode || '').includes(search);
    return matchSearch;
  });

  if (currentFilter === 'low') filtered = filtered.filter(m => m.qty <= 10);
  if (currentFilter === 'expiring') filtered = filtered.filter(m => {
    const d = daysUntil(m.expiry);
    return d >= 0 && d <= 30;
  });

  const body = $('medicationsBody');
  if (filtered.length === 0) {
    body.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:30px;color:var(--text-light)">لا توجد أدوية مطابقة</td></tr>';
    return;
  }

  body.innerHTML = filtered.map(m => {
    const status = getMedStatus(m);
    return `
      <tr>
        <td><strong>${m.name}</strong></td>
        <td>${m.company}</td>
        <td>${fmt(m.price)} ج.م</td>
        <td>${fmt(m.qty)}</td>
        <td>${new Date(m.expiry).toLocaleDateString('ar-EG')}</td>
        <td>${m.barcode || '—'}</td>
        <td><span class="status-tag ${status.class}">${status.label}</span></td>
        <td>
          <div class="actions">
            <button class="btn btn-ghost btn-icon" onclick="editMed('${String(m.id).replace(/'/g, "\\'")}')">✏️ تعديل</button>
            <button class="btn btn-danger btn-icon" onclick="deleteMed('${String(m.id).replace(/'/g, "\\'")}')">🗑️</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function openMedModal(med = null) {
  editingMedId = med ? med.id : null;
  $('medModalTitle').textContent = med ? 'تعديل دواء' : 'إضافة دواء جديد';
  $('medName').value = med ? med.name : '';
  $('medCompany').value = med ? med.company : '';
  $('medPrice').value = med ? med.price : '';
  $('medQty').value = med ? med.qty : '';
  $('medExpiry').value = med ? med.expiry : '';
  $('medBarcode').value = med ? (med.barcode || '') : '';
  $('medModal').classList.add('active');
}

function closeMedModal() {
  $('medModal').classList.remove('active');
  editingMedId = null;
}

window.editMed = (id) => {
  const med = medications.find(m => String(m.id) === String(id));
  if (med) openMedModal(med);
};

window.deleteMed = async (id) => {
  const med = medications.find(m => String(m.id) === String(id));
  if (!med) return;
  if (!confirm(`هل تريد بالتأكيد حذف "${med.name}"؟`)) return;
  try {
    await deleteMedicine(id);
    await refreshAll({ silent: true });
    renderMedications();
    renderDashboard();
    toast('تم حذف الدواء بنجاح', 'success');
  } catch (e) {
    console.error('[DELETE MED] failed:', e);
    toast('فشل حذف الدواء — تحقق من الاتصال', 'error');
  }
};

$('openAddMedBtn').addEventListener('click', () => openMedModal());
$('closeMedModal').addEventListener('click', closeMedModal);
$('cancelMedBtn').addEventListener('click', closeMedModal);

$('medForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = {
    name: $('medName').value.trim(),
    company: $('medCompany').value.trim(),
    price: parseFloat($('medPrice').value),
    qty: parseInt($('medQty').value),
    expiry: $('medExpiry').value,
    barcode: $('medBarcode').value.trim(),
  };

  try {
    if (editingMedId) {
      await updateMedicine(editingMedId, data);
      toast('تم تعديل الدواء بنجاح', 'success');
    } else {
      await addMedicine(data);
      toast('تم إضافة الدواء بنجاح', 'success');
    }
    await refreshAll({ silent: true });
    closeMedModal();
    renderMedications();
    renderDashboard();
  } catch (err) {
    console.error('[SAVE MED] failed:', err);
    toast('فشل حفظ الدواء — تحقق من الاتصال', 'error');
  }
});

$('searchMed').addEventListener('input', (e) => {
  currentSearch = e.target.value;
  renderMedications();
});

document.querySelectorAll('.pill').forEach(p => {
  p.addEventListener('click', () => {
    document.querySelectorAll('.pill').forEach(x => x.classList.remove('active'));
    p.classList.add('active');
    currentFilter = p.dataset.filter;
    renderMedications();
  });
});

// ============== المبيعات ==============
function renderSalesPage() {
  const select = $('saleMedSelect');
  const available = medications.filter(m => m.qty > 0);
  select.innerHTML = '<option value="">-- اختر دواء --</option>' +
    available.map(m => `<option value="${m.id}">${m.name} (${m.qty} متاح - ${fmt(m.price)} ج.م)</option>`).join('');
  $('saleQty').value = 1;
  $('saleUnitPrice').value = '';
  $('saleTotal').value = '';
  renderCart();
}

function updateSaleTotal() {
  const id = $('saleMedSelect').value;
  const med = medications.find(m => String(m.id) === String(id));
  const qty = parseInt($('saleQty').value) || 0;
  if (med) {
    $('saleUnitPrice').value = fmt(med.price) + ' ج.م';
    $('saleTotal').value = fmt(med.price * qty) + ' ج.م';
  } else {
    $('saleUnitPrice').value = '';
    $('saleTotal').value = '';
  }
}

$('saleMedSelect').addEventListener('change', updateSaleTotal);
$('saleQty').addEventListener('input', updateSaleTotal);

$('addToCartBtn').addEventListener('click', () => {
  const id = $('saleMedSelect').value;
  const qty = parseInt($('saleQty').value);
  const med = medications.find(m => String(m.id) === String(id));

  if (!med) { toast('اختر دواء أولاً', 'error'); return; }
  if (!qty || qty <= 0) { toast('أدخل كمية صحيحة', 'error'); return; }
  if (qty > med.qty) { toast(`الكمية المتاحة: ${med.qty} فقط`, 'error'); return; }

  const existing = cart.find(c => String(c.id) === String(id));
  if (existing) {
    if (existing.qty + qty > med.qty) {
      toast(`الكمية الإجمالية تتجاوز المخزون`, 'error');
      return;
    }
    existing.qty += qty;
  } else {
    cart.push({ id: med.id, name: med.name, price: med.price, qty });
  }

  renderCart();
  $('saleQty').value = 1;
  $('saleMedSelect').value = '';
  updateSaleTotal();
  toast('تم إضافة المنتج للفاتورة', 'success');
});

function renderCart() {
  const box = $('cartList');
  if (cart.length === 0) {
    box.innerHTML = '<p class="empty-state">الفاتورة فارغة</p>';
    $('cartTotal').textContent = '0 ج.م';
    return;
  }
  box.innerHTML = cart.map((item, i) => `
    <div class="cart-item">
      <div class="item-info">
        <strong>${item.name}</strong>
        <span>${item.qty} × ${fmt(item.price)} ج.م</span>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <div class="item-price">${fmt(item.qty * item.price)} ج.م</div>
        <button class="remove-btn" onclick="removeFromCart(${i})">×</button>
      </div>
    </div>
  `).join('');
  const total = cart.reduce((s, i) => s + i.qty * i.price, 0);
  $('cartTotal').textContent = fmt(total) + ' ج.م';
}

window.removeFromCart = (i) => {
  cart.splice(i, 1);
  renderCart();
};

$('finishInvoiceBtn').addEventListener('click', async () => {
  if (cart.length === 0) { toast('الفاتورة فارغة', 'error'); return; }

  const total = cart.reduce((s, i) => s + i.qty * i.price, 0);
  const payload = {
    date: new Date().toISOString(),
    items: cart.map(it => ({ id: it.id, name: it.name, price: it.price, qty: it.qty })),
    total,
  };

  let created;
  try {
    // إنشاء الفاتورة في D1 — الـ Worker يخصم المخزون تلقائياً ويولّد رقم الفاتورة
    created = await addInvoice(payload);
  } catch (e) {
    console.error('[INVOICE] create failed:', e);
    toast('فشل إصدار الفاتورة: ' + (e.message || 'تحقق من الاتصال'), 'error');
    return;
  }

  // إعادة جلب البيانات من D1 لتعكس الواقع الجديد
  await refreshAll({ silent: true });
  showInvoice(created);
  cart = [];
  renderSalesPage();
  toast(`تم إصدار الفاتورة #${created.id} بنجاح`, 'success');
});

function showInvoice(inv) {
  const content = `
    <h4>صيدليتي</h4>
    <p style="text-align:center;font-size:13px;color:var(--text-light)">فاتورة بيع</p>
    <div class="invoice-meta">
      <span>فاتورة رقم: #${inv.id}</span>
      <span>${new Date(inv.date).toLocaleString('ar-EG')}</span>
    </div>
    ${inv.items.map(i => `
      <div class="invoice-line">
        <span>${i.name} × ${i.qty}</span>
        <span>${fmt(i.qty * i.price)} ج.م</span>
      </div>
    `).join('')}
    <div class="invoice-total">
      <span>الإجمالي</span>
      <span>${fmt(inv.total)} ج.م</span>
    </div>
    <p style="text-align:center;margin-top:14px;font-size:12px;color:var(--text-light)">شكراً لزيارتكم</p>
  `;
  $('invoiceContent').innerHTML = content;
  $('invoiceModal').classList.add('active');
}

$('closeInvoiceModal').addEventListener('click', () => $('invoiceModal').classList.remove('active'));
$('closeInvoiceBtn').addEventListener('click', () => $('invoiceModal').classList.remove('active'));
$('printInvoiceBtn').addEventListener('click', () => window.print());

// ============== التنبيهات ==============
function renderAlerts() {
  const expiring = medications.filter(m => {
    const d = daysUntil(m.expiry);
    return d >= 0 && d <= 30;
  }).sort((a, b) => daysUntil(a.expiry) - daysUntil(b.expiry));

  const lowStock = medications.filter(m => m.qty > 0 && m.qty <= 10)
    .sort((a, b) => a.qty - b.qty);

  const expBox = $('expiringAlerts');
  if (expiring.length === 0) {
    expBox.innerHTML = '<p class="empty-state">لا توجد أدوية قاربت على الانتهاء</p>';
  } else {
    expBox.innerHTML = expiring.map(m => {
      const d = daysUntil(m.expiry);
      return `
        <div class="alert-item warning">
          <div class="alert-info">
            <strong>${m.name}</strong>
            <span>${m.company} · الكمية: ${m.qty}</span>
          </div>
          <div class="alert-value">${d === 0 ? 'ينتهي اليوم' : `${d} يوم`}</div>
        </div>
      `;
    }).join('');
  }

  const lowBox = $('lowStockAlerts');
  if (lowStock.length === 0) {
    lowBox.innerHTML = '<p class="empty-state">لا توجد أدوية بمخزون منخفض</p>';
  } else {
    lowBox.innerHTML = lowStock.map(m => `
      <div class="alert-item danger">
        <div class="alert-info">
          <strong>${m.name}</strong>
          <span>${m.company}</span>
        </div>
        <div class="alert-value">متبقي: ${m.qty}</div>
      </div>
    `).join('');
  }
}

// ============== التقارير ==============
function renderReports() {
  const today = todayStr();
  const todayInvoices = invoices.filter(inv => inv.date.startsWith(today));
  const dailyProfit = todayInvoices.reduce((s, i) => s + i.total, 0);
  $('dailyProfit').textContent = fmt(dailyProfit) + ' ج.م';
  $('dailyProfitDate').textContent = `إيرادات يوم ${new Date().toLocaleDateString('ar-EG')} · ${todayInvoices.length} فاتورة`;

  // الدواء الأكثر مبيعاً
  const salesMap = {};
  invoices.forEach(inv => {
    inv.items.forEach(item => {
      if (!salesMap[item.id]) salesMap[item.id] = { name: item.name, qty: 0, revenue: 0 };
      salesMap[item.id].qty += item.qty;
      salesMap[item.id].revenue += item.qty * item.price;
    });
  });

  const sortedSales = Object.values(salesMap).sort((a, b) => b.qty - a.qty);
  if (sortedSales.length > 0) {
    const top = sortedSales[0];
    $('topMedication').textContent = top.name;
    $('topMedicationStats').textContent = `تم بيع ${top.qty} وحدة بإيراد ${fmt(top.revenue)} ج.م`;
  } else {
    $('topMedication').textContent = 'لا يوجد';
    $('topMedicationStats').textContent = 'لم يتم تسجيل مبيعات بعد';
  }

  // الأدوية المنتهية من المخزن
  const outOfStock = medications.filter(m => m.qty === 0);
  const outBox = $('outOfStockList');
  if (outOfStock.length === 0) {
    outBox.innerHTML = '<p class="empty-state">جميع الأدوية متوفرة في المخزون</p>';
  } else {
    outBox.innerHTML = outOfStock.map(m => `
      <div class="alert-item danger">
        <div class="alert-info">
          <strong>${m.name}</strong>
          <span>${m.company}</span>
        </div>
        <div class="alert-value">نفد المخزون</div>
      </div>
    `).join('');
  }

  // جدول مبيعات الأدوية
  const reportBody = $('salesReportBody');
  if (sortedSales.length === 0) {
    reportBody.innerHTML = '<tr><td colspan="3" style="text-align:center;padding:24px;color:var(--text-light)">لا توجد بيانات مبيعات</td></tr>';
  } else {
    reportBody.innerHTML = sortedSales.map(s => `
      <tr>
        <td><strong>${s.name}</strong></td>
        <td>${fmt(s.qty)}</td>
        <td>${fmt(s.revenue)} ج.م</td>
      </tr>
    `).join('');
  }
}

// ============== الفواتير ==============
function renderInvoices() {
  const body = $('invoicesBody');
  if (invoices.length === 0) {
    body.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:30px;color:var(--text-light)">لا توجد فواتير</td></tr>';
    return;
  }
  body.innerHTML = invoices.slice().reverse().map(inv => `
    <tr>
      <td><strong>#${inv.id}</strong></td>
      <td>${new Date(inv.date).toLocaleString('ar-EG')}</td>
      <td>${inv.items.length}</td>
      <td><strong>${fmt(inv.total)} ج.م</strong></td>
      <td>
        <button class="btn btn-ghost btn-icon" onclick="viewInvoice(${inv.id})">👁️ عرض</button>
      </td>
    </tr>
  `).join('');
}

window.viewInvoice = (id) => {
  const inv = invoices.find(i => String(i.id) === String(id));
  if (inv) showInvoice(inv);
};

// ============== التشغيل الأول ==============
// 1) عرض فوري من cache (إن وُجد) كي لا تظهر الشاشة فارغة لحظات.
// 2) ترقية بيانات localStorage القديمة إلى D1 (مرة واحدة فقط، إن لزم).
// 3) جلب أحدث البيانات من D1 — هذا هو مصدر الحقيقة.
(function showCacheImmediately() {
  try {
    const m = JSON.parse(localStorage.getItem(STORAGE.meds) || '[]');
    const i = JSON.parse(localStorage.getItem(STORAGE.invoices) || '[]');
    if (m.length) medications = m;
    if (i.length) invoices    = i;
  } catch (_) { /* ignore */ }
  renderDashboard();
})();

(async () => {
  console.log('[BOOT] API_BASE =', API_BASE);
  try {
    await migrateLocalStorageIfNeeded();
  } catch (e) { console.warn('[BOOT] migration step failed:', e); }
  const ok = await refreshAll({ silent: true });
  console.log('[BOOT] initial refresh ok =', ok, '| medicines:', medications.length, '| invoices:', invoices.length);
  renderDashboard();
})();
