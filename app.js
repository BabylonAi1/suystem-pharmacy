// ============== التخزين والبيانات ==============
const STORAGE = {
  meds: 'pharmacy_medications',
  invoices: 'pharmacy_invoices',
};

let medications = JSON.parse(localStorage.getItem(STORAGE.meds) || '[]');
let invoices = JSON.parse(localStorage.getItem(STORAGE.invoices) || '[]');
let cart = [];
let editingMedId = null;
let currentFilter = 'all';
let currentSearch = '';

// بيانات افتراضية للعرض الأول
if (medications.length === 0) {
  medications = [
    { id: 1, name: 'باراسيتامول 500', company: 'فايزر', price: 25, qty: 120, expiry: '2027-06-15', barcode: '8901234567890' },
    { id: 2, name: 'أموكسيسيلين 250', company: 'GSK', price: 45, qty: 8, expiry: '2026-06-01', barcode: '8901234567891' },
    { id: 3, name: 'فيتامين سي 1000', company: 'باير', price: 60, qty: 200, expiry: '2026-12-20', barcode: '' },
    { id: 4, name: 'أوميبرازول 20', company: 'سانوفي', price: 35, qty: 5, expiry: '2026-05-25', barcode: '8901234567893' },
    { id: 5, name: 'ايبوبروفين 400', company: 'نوفارتس', price: 30, qty: 75, expiry: '2027-03-10', barcode: '' },
  ];
  saveMeds();
}

function saveMeds() { localStorage.setItem(STORAGE.meds, JSON.stringify(medications)); }
function saveInvoices() { localStorage.setItem(STORAGE.invoices, JSON.stringify(invoices)); }

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
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    const pageId = btn.dataset.page;
    $(pageId).classList.add('active');
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
            <button class="btn btn-ghost btn-icon" onclick="editMed(${m.id})">✏️ تعديل</button>
            <button class="btn btn-danger btn-icon" onclick="deleteMed(${m.id})">🗑️</button>
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
  const med = medications.find(m => m.id === id);
  if (med) openMedModal(med);
};

window.deleteMed = (id) => {
  const med = medications.find(m => m.id === id);
  if (!med) return;
  if (confirm(`هل تريد بالتأكيد حذف "${med.name}"؟`)) {
    medications = medications.filter(m => m.id !== id);
    saveMeds();
    renderMedications();
    toast('تم حذف الدواء بنجاح', 'success');
  }
};

$('openAddMedBtn').addEventListener('click', () => openMedModal());
$('closeMedModal').addEventListener('click', closeMedModal);
$('cancelMedBtn').addEventListener('click', closeMedModal);

$('medForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const data = {
    name: $('medName').value.trim(),
    company: $('medCompany').value.trim(),
    price: parseFloat($('medPrice').value),
    qty: parseInt($('medQty').value),
    expiry: $('medExpiry').value,
    barcode: $('medBarcode').value.trim(),
  };

  if (editingMedId) {
    const idx = medications.findIndex(m => m.id === editingMedId);
    if (idx >= 0) medications[idx] = { ...medications[idx], ...data };
    toast('تم تعديل الدواء بنجاح', 'success');
  } else {
    const newId = medications.length ? Math.max(...medications.map(m => m.id)) + 1 : 1;
    medications.push({ id: newId, ...data });
    toast('تم إضافة الدواء بنجاح', 'success');
  }

  saveMeds();
  closeMedModal();
  renderMedications();
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
  const id = parseInt($('saleMedSelect').value);
  const med = medications.find(m => m.id === id);
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
  const id = parseInt($('saleMedSelect').value);
  const qty = parseInt($('saleQty').value);
  const med = medications.find(m => m.id === id);

  if (!med) { toast('اختر دواء أولاً', 'error'); return; }
  if (!qty || qty <= 0) { toast('أدخل كمية صحيحة', 'error'); return; }
  if (qty > med.qty) { toast(`الكمية المتاحة: ${med.qty} فقط`, 'error'); return; }

  const existing = cart.find(c => c.id === id);
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

$('finishInvoiceBtn').addEventListener('click', () => {
  if (cart.length === 0) { toast('الفاتورة فارغة', 'error'); return; }

  const total = cart.reduce((s, i) => s + i.qty * i.price, 0);
  const invoice = {
    id: invoices.length ? Math.max(...invoices.map(i => i.id)) + 1 : 1001,
    date: new Date().toISOString(),
    items: [...cart],
    total,
  };
  invoices.push(invoice);

  // خصم الكميات من المخزون
  cart.forEach(item => {
    const med = medications.find(m => m.id === item.id);
    if (med) med.qty -= item.qty;
  });

  saveMeds();
  saveInvoices();
  showInvoice(invoice);
  cart = [];
  renderSalesPage();
  toast('تم إصدار الفاتورة بنجاح', 'success');
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
  const inv = invoices.find(i => i.id === id);
  if (inv) showInvoice(inv);
};

// ============== التشغيل الأول ==============
renderDashboard();
