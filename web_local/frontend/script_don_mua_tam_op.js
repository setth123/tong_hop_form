// Lấy element
const form = document.getElementById("employeeForm");
const statusEl = document.getElementById("status");
const tinhTrangEl = document.getElementById("tinh_trang");
const ngayHoanThanhEl = document.getElementById("ngay_hoan_thanh");

const API_URL = "https://unstack-cedric-nonspherically.ngrok-free.dev/backend/api/form_don_mua_tam_op";

/* 1. Bật/tắt ngày hoàn thành */
tinhTrangEl.addEventListener("change", () => {
  if (tinhTrangEl.value === "hoan_thanh") {
    ngayHoanThanhEl.disabled = false;
    ngayHoanThanhEl.required = true;
  } else {
    ngayHoanThanhEl.disabled = true;
    ngayHoanThanhEl.required = false;
    ngayHoanThanhEl.value = "";
  }
});

/* 2. Submit form */
form.addEventListener("submit", async (e) => {
  e.preventDefault();

  statusEl.textContent = "⏳ Đang lưu dữ liệu...";
  statusEl.style.color = "#555";

  const formData = new FormData(form);

  const payload = {
    ma_so_nv: Number(formData.get("ma_so_nv")),
    ho_va_ten: formData.get("ho_va_ten"),
    so_don_da_mua: Number(formData.get("so_don_da_mua")),
    tinh_trang: formData.get("tinh_trang"),
    ngay_hoan_thanh: formData.get("ngay_hoan_thanh") || null,
  };

  if (payload.tinh_trang === "hoan_thanh" && !payload.ngay_hoan_thanh) {
    statusEl.textContent = "❌ Vui lòng chọn ngày hoàn thành.";
    statusEl.style.color = "red";
    return;
  }

  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      throw new Error("Gửi dữ liệu thất bại");
    }

    // statusEl.textContent = "✅ Đã lưu thành công!";
    // statusEl.style.color = "green";
    statusEl.className = "status status--success";
    statusEl.innerHTML = "✅ Gửi dữ liệu thành công!";


    setTimeout(() => {
      form.reset();
      ngayHoanThanhEl.disabled = true;
    }, 800);

  } catch (err) {
    console.error(err);
    statusEl.textContent = "❌ Có lỗi xảy ra, vui lòng thử lại.";
    statusEl.style.color = "red";
  }
});

/* 3. Reset thủ công */
form.addEventListener("reset", () => {
  statusEl.textContent = "";
  ngayHoanThanhEl.disabled = true;
});
