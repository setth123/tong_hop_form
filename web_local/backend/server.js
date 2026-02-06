const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const db = require('./db');
const { allocateSale } = require('./services/leadAllocator');
const {pushCustomerToLark} = require('./services/sync2Lark');

const app = express();
app.use(cors());
app.use(express.json());

// public uploads
app.use('/uploads', express.static('uploads'));

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueName + ext);
  }
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Chỉ cho phép upload ảnh'));
    }
  }
});
app.get("/", (req, res) => {
  console.log("called");
  res.status(200).send("Server 4000 is alive!");
});

app.get("/api/sales", async (req, res) => {
  let client;

  try {
    client = await db.connect();

    const sql = `
      SELECT DISTINCT
        s.sale_id,
        e.ho_va_ten
      FROM (
        SELECT sale_id FROM sale_allocation_cua
        UNION
        SELECT sale_id FROM sale_allocation_spc
        UNION
        SELECT sale_id FROM sale_allocation_tam_op
      ) s
      JOIN employee e
        ON e.ma_so_nv = s.sale_id
      ORDER BY e.ho_va_ten;
    `;

    const { rows } = await client.query(sql);

    return res.status(200).json(rows);

  } catch (err) {
    console.error("❌ Lỗi lấy danh sách sale:", err);

    return res.status(500).json({
      message: "Không thể lấy danh sách sale",
      error: err.message
    });

  } finally {
    if (client) client.release();
  }
});


app.post('/api/customers', upload.single('qr_zalo'), async (req, res) => {
  // Dùng transaction để:
  //  1) Chọn sale theo thuật toán phân số (có lock SKIP LOCKED)
  //  2) Insert customer kèm sale_id
  const client = await db.connect();
  try {
    
    const {
      name,
      phone,
      product_interest,
      customer_source,
      note,
      sale_id: sale_id_from_client
    } = req.body;

    const qr_zalo = req.file ? req.file.filename : null;

    await client.query('BEGIN');

    let chosen = null;
    let sale_id = null;
    if (sale_id_from_client) {
      sale_id = sale_id_from_client;

      // (optional nhưng rất nên) Lấy thêm info sale để push Lark
      const { rows } = await client.query(
        `
        SELECT
          ma_so_nv AS sale_id,
          ho_va_ten AS sale_name,
          tai_khoan_lark
        FROM employee
        WHERE ma_so_nv = $1
        `,
        [sale_id_from_client]
      );

      chosen = rows[0] || null;

    } else {
      // ❌ Chỉ phân tự động khi KHÔNG có sale_id
      chosen = await allocateSale({
        client,
        productInterest: product_interest,
        now: new Date()
      });

      sale_id = chosen?.sale_id ?? null;
    }


    // 2) Insert dữ liệu khách hàng, kèm sale_id
    const insertSql = `
      INSERT INTO customers.customer
      (name, phone, product_interest, customer_source, note, qr_zalo, sale_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING customer_id, sale_id, created_at
    `;

    const { rows } = await client.query(insertSql, [
      name,
      phone,
      product_interest,
      customer_source,
      note,
      qr_zalo,
      sale_id
    ]);

    await client.query('COMMIT');

    (async () => {
      try {
        await pushCustomerToLark({
          customer_id: rows[0].customer_id,
          name,
          phone,
          product_interest,
          customer_source,
          note,
          qr_zalo,
          sale_id,
          tk_lark: chosen?.tk_lark ?? null,
          created_at: rows[0].created_at,
          updated_at: null,
        });
        console.log('[LARK] Push success', rows[0].customer_id);
      } catch (err) {
        console.error(
          '[LARK] Push failed',
          err?.response?.data || err
        );
      }
    })();

    res.json({
      message: 'Lưu thành công',
      customer_id: rows?.[0]?.customer_id ?? null,
      assigned_sale_id: sale_id,
      assigned_sale_name: chosen?.sale_name ?? null,
      allocation_score: chosen?.score ?? null,
      allocation_remaining: chosen?.remaining ?? null,
      qr_url: qr_zalo
        ? `http://localhost:4000/uploads/${qr_zalo}`
        : null
    });

  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('INSERT/ALLOCATE ERROR:', err);
    res.status(500).json({ error: 'Lỗi khi lưu dữ liệu/ phân sale' });
  } finally {
    client.release();
  }
});

app.post("/api/form_khen", async (req, res) => {
  const { ho_va_ten, thang, so_don_khach_hang_khen } = req.body;

  // Validate cơ bản
  if (!ho_va_ten || !thang || so_don_khach_hang_khen == null) {
    return res.status(400).json({
      message: "Thiếu dữ liệu bắt buộc",
    });
  }

  try {
    const query = `
      INSERT INTO "Dev_Act_Log_LT".khen
        (ho_va_ten, thang, so_don_khach_hang_duoc_khen)
      VALUES ($1, $2, $3)
      RETURNING *;
    `;

    const values = [ho_va_ten, thang, so_don_khach_hang_khen];

    const result = await db.query(query, values);

    return res.status(201).json({
      message: "Lưu dữ liệu thành công",
      data: result.rows[0],
    });
  } catch (error) {
    console.error("Insert Dev_Act_Log_LT error:", error);

    return res.status(500).json({
      message: "Lỗi server",
    });
  }
});


app.post("/api/form_ty_le_convert", async (req, res) => {
  console.log("ádsds");
  const {
    ho_va_ten,
    team,
    ket_qua_kinh_doanh,
    kq_kinh_doanh_sp_chinh,
    ty_le_sp_chinh,
    ty_le_tong,
    kpi_thang,
    convert_rate
  } = req.body;

  // Validate cơ bản
  if (!ho_va_ten) {
    return res.status(400).json({
      message: "Thiếu họ và tên",
    });
  }

  try {
    const query = `
      INSERT INTO "Dev_Act_Log_LT".ty_le_convert (
        ho_va_ten,
        team,
        ket_qua_kinh_doanh,
        kq_kinh_doanh_sp_chinh,
        ty_le_sp_chinh,
        ty_le_tong,
        kpi_thang,
        convert_rate,
        time
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8, NOW())
      RETURNING *;
    `;


    const values = [
      ho_va_ten,
      team,
      ket_qua_kinh_doanh,
      kq_kinh_doanh_sp_chinh,
      ty_le_sp_chinh,
      ty_le_tong,
      kpi_thang,
      convert_rate
    ];

    const result = await db.query(query, values);

    return res.status(201).json({
      message: "Lưu dữ liệu ty_le_convert thành công",
      data: result.rows[0],
    });
  } catch (error) {
    // lỗi trùng theo tháng (unique index)
    if (error.code === "23505") {
      return res.status(409).json({
        message: "Nhân viên đã có dữ liệu ty_le_convert trong tháng này",
      });
    }

    console.error("Insert ty_le_convert error:", error);

    return res.status(500).json({
      message: "Lỗi server",
    });
  }
});

app.post("/api/form_don_mua_tam_op", async (req, res) => {
  const {
    ma_so_nv,
    ho_va_ten,
    so_don_da_mua,
    tinh_trang,
    ngay_hoan_thanh
  } = req.body;

  // 1. Validate cơ bản
  if (
    ma_so_nv == null ||
    !ho_va_ten ||
    so_don_da_mua == null ||
    !tinh_trang
  ) {
    return res.status(400).json({
      message: "Thiếu dữ liệu bắt buộc",
    });
  }

  // Validate nghiệp vụ
  if (
    tinh_trang === "hoan_thanh" &&
    !ngay_hoan_thanh
  ) {
    return res.status(400).json({
      message: "Thiếu ngày hoàn thành",
    });
  }

  try {
    const query = `
      INSERT INTO "Dev_Act_Log_LT".don_mua_tam_op (
        ma_so_nv,
        ho_va_ten,
        so_don_da_mua,
        tinh_trang,
        ngay_hoan_thanh
      )
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *;
    `;

    const values = [
      ma_so_nv,
      ho_va_ten,
      so_don_da_mua,
      tinh_trang,
      ngay_hoan_thanh || null
    ];

    const result = await db.query(query, values);

    return res.status(201).json({
      message: "Lưu dữ liệu đơn mua tấm ốp thành công",
      data: result.rows[0],
    });

  } catch (error) {
    console.error("Insert don_mua_tam_op error:", error);

    return res.status(500).json({
      message: "Lỗi server",
    });
  }
});

app.post("/api/form_kpi_kinh_doanh", async (req, res) => {
  const {
    ho_va_ten,
    phong_ban,
    kpi_thang,
    da_dat,
    ngay_hoan_thanh
  } = req.body;

  if (
    !ho_va_ten ||
    !phong_ban ||
    kpi_thang == null ||
    da_dat == null
  ) {
    return res.status(400).json({
      message: "Thiếu dữ liệu bắt buộc",
    });
  }

  try {
    const query = `
      INSERT INTO "Dev_Act_Log_LT".kpi_kinh_doanh
      (ho_va_ten, phong_ban, kpi_thang, da_dat, ngay_hoan_thanh)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *;
    `;


    const values = [
      ho_va_ten,
      phong_ban,
      kpi_thang,
      da_dat,
      ngay_hoan_thanh || null
    ];

    const result = await db.query(query, values);

    return res.status(201).json({
      message: "Lưu KPI kinh doanh thành công",
      data: result.rows[0],
    });

  } catch (error) {
    console.error("Insert kpi_kinh_doanh error:", error);
    return res.status(500).json({ message: "Lỗi server" });
  }
});





app.listen(4000, () => {
  console.log('Backend running on http://localhost:4000');

});




