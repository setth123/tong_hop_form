
  const form = document.getElementById("orderForm");
  const statusEl = document.getElementById("status");
  const resetBtn = document.getElementById("resetBtn");

  const API_URL = "https://unstack-cedric-nonspherically.ngrok-free.dev/backend/api/form_khen"; // 🔥 đổi thành API của bạn

  // 1. Gửi dữ liệu
  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    statusEl.textContent = "Đang gửi dữ liệu...";
    statusEl.style.color = "#555";

    const formData = new FormData(form);

    // Chuyển FormData -> Object
    const payload = {
      ho_va_ten: formData.get("full_name"),
      thang: formData.get("order_date"),
      so_don_khach_hang_khen: Number(formData.get("order_count")),
    };

    try {
      const res = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        throw new Error("Gửi dữ liệu thất bại");
      }

      statusEl.textContent = "✅ Gửi dữ liệu thành công!";
      statusEl.style.color = "green";

      // 👉 reset sau khi gửi thành công
      form.reset();

    } catch (err) {
      console.error(err);
      statusEl.textContent = "❌ Có lỗi xảy ra, vui lòng thử lại.";
      statusEl.style.color = "red";
    }
  });

  // 2. Reset form thủ công
  resetBtn.addEventListener("click", () => {
    form.reset();
    statusEl.textContent = "";
  });