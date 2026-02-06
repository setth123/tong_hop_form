const form = document.getElementById("convertForm");
const statusEl = document.getElementById("status");

// 🔥 GIỐNG HỆT KHEN: URL TUYỆT ĐỐI
const API_URL =
  "https://unstack-cedric-nonspherically.ngrok-free.dev/backend/api/form_ty_le_convert";


form.addEventListener("submit", async (e) => {
  e.preventDefault();

  statusEl.textContent = "Đang gửi dữ liệu...";
  statusEl.style.color = "#555";

  const payload = {
    ho_va_ten: document.getElementById("ho_va_ten").value,
    team: document.getElementById("team").value,
    ket_qua_kinh_doanh: Number(document.getElementById("ket_qua_kinh_doanh").value),
    kq_kinh_doanh_sp_chinh: Number(document.getElementById("kq_sp_chinh").value),
    ty_le_sp_chinh: Number(document.getElementById("ty_le_sp_chinh").value),
    ty_le_tong: Number(document.getElementById("ty_le_tong").value),
    kpi_thang: Number(document.getElementById("kpi_thang").value),
    convert_rate: Number(document.getElementById("convert_rate").value)
  };

  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      throw new Error("Gửi dữ liệu thất bại");
    }

    statusEl.textContent = "✅ Gửi dữ liệu thành công!";
    statusEl.style.color = "green";
    form.reset();

  } catch (err) {
    console.error(err);
    statusEl.textContent = "❌ Có lỗi xảy ra, vui lòng thử lại.";
    statusEl.style.color = "red";
  }
});
