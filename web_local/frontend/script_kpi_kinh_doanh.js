const form = document.getElementById("kpiForm");
const statusEl = document.getElementById("status");
const API_URL = " https://hypoeutectoid-sheilah-unchipping.ngrok-free.dev/backend/api/form_kpi_kinh_doanh";


/* Submit form */
form.addEventListener("submit", async (e) => {
  e.preventDefault();

  statusEl.className = "status";
  statusEl.textContent = "⏳ Đang lưu dữ liệu...";

  const formData = new FormData(form);

  const payload = {
    ho_va_ten: formData.get("ho_va_ten"),
    phong_ban: formData.get("phong_ban"),
    kpi_thang: Number(formData.get("kpi_thang")), // KPI cần đạt
    da_dat: Number(formData.get("da_dat")),       // Đã đạt
    ngay_hoan_thanh: formData.get("ngay_hoan_thanh") || null,
  };

  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) throw new Error("Lưu dữ liệu thất bại");

    statusEl.className = "status status--success";
    statusEl.innerHTML = "✅ Đã lưu KPI kinh doanh thành công!";

    setTimeout(() => form.reset(), 800);

  } catch (err) {
    console.error(err);
    statusEl.className = "status status--error";
    statusEl.innerHTML = "❌ Có lỗi xảy ra, vui lòng thử lại.";
  }
});

/* Reset form */
form.addEventListener("reset", () => {
  statusEl.className = "status status--hidden";
  statusEl.textContent = "";
});
