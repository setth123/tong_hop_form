const form = document.getElementById('customerForm');
const statusEl = document.getElementById('status');

const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('qr_zalo');
const fileName = document.getElementById('fileName');
const pickFileBtn = document.getElementById('pickFileBtn');
const customerSourceEl = document.getElementById('customer_source');
const saleFieldEl = document.getElementById('saleField');
const saleSelectEl = document.getElementById('sale_id');

pickFileBtn.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', () => {
  fileName.textContent = fileInput.files?.[0]?.name || 'Chưa chọn tệp';
});

// Drag highlight
['dragenter', 'dragover'].forEach(evt => {
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropzone.classList.add('dropzone--active');
  });
});

['dragleave', 'drop'].forEach(evt => {
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropzone.classList.remove('dropzone--active');
  });
});

async function fetchSales() {
  // Giả lập API – sau này đổi URL thật
  const res = await fetch('https://hypoeutectoid-sheilah-unchipping.ngrok-free.dev/backend/api/sales');
  if (!res.ok) throw new Error('Không lấy được danh sách sale');
  return res.json();
}
customerSourceEl.addEventListener('change', async () => {
  const value = customerSourceEl.value;

  if (value === 'Ngoài') {
    saleFieldEl.style.display = 'block';
    saleSelectEl.innerHTML =
      '<option value="" selected disabled>Đang tải danh sách sale...</option>';

    try {
      const sales = await fetchSales();

      saleSelectEl.innerHTML =
        '<option value="" selected disabled>Vui lòng chọn sale</option>';

      sales.forEach(sale => {
        const option = document.createElement('option');
        option.value = sale.sale_id;
        option.textContent = sale.ho_va_ten;
        saleSelectEl.appendChild(option);
      });

      saleSelectEl.required = true;
    } catch (err) {
      saleSelectEl.innerHTML =
        '<option value="" disabled>Lỗi tải danh sách sale</option>';
    }

  } else {
    // Ẩn & reset nếu không phải "Ngoài"
    saleFieldEl.style.display = 'none';
    saleSelectEl.innerHTML = '';
    saleSelectEl.required = false;
  }
});



// Submit (kết nối backend như bạn làm)
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  statusEl.textContent = 'Đang gửi dữ liệu...';

  try {
    const formData = new FormData(form);
    // unstack-cedric-nonspherically.ngrok-free.dev/backend
    const res = await fetch('https://hypoeutectoid-sheilah-unchipping.ngrok-free.dev/backend/api/customers', {
      method: 'POST',
      body: formData
    });

    const data = await res.json();

    if (!res.ok) throw new Error(data?.message || 'Gửi thất bại');

    const saleInfo = data?.assigned_sale_name
      ? `\nSale nhận lead: ${data.assigned_sale_name} (#${data.assigned_sale_id})`
      : '\nChưa phân được sale (không tìm thấy cấu hình/team phù hợp).';

    statusEl.textContent = 'Lưu thành công.' + saleInfo;
    form.reset();
    fileName.textContent = 'Chưa chọn tệp';
  } catch (err) {
    statusEl.textContent = `Lỗi: ${err.message}`;
  }
});
