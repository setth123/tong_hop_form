// allocateSale.js

const EXCLUDED_STATUSES = ['Không nhấc máy', 'Sai số ĐT', 'Ngoài'];

/**
 * FIXED ROUTE (không chia số)
 * - Phào -> sale 13
 * - Gỗ tự nhiên -> sale 18
 * - Nội thất -> sale 33
 *
 * Lưu ý: key ở đây dùng dạng "không dấu" để bắt được cả có dấu/không dấu.
 */
const FIXED_SALE_BY_PRODUCT_NOACCENT = Object.freeze({
  phao: 13,
  'go tu nhien': 18,
  'noi that': 33,
});

/**
 * RULES theo sản phẩm (có chia số theo bảng config riêng)
 *
 * interests: danh sách các giá trị product_interest (đã lower/trim) được tính vào total_new.
 * -> dùng array để SPC có thể match cả "spc" và "sàn spc" (nếu data đang dùng 1 trong 2).
 */
const PRODUCT_RULES = Object.freeze({
  // Cửa
  'cửa': { table: 'public.sale_allocation_cua', interests: ['cửa'] },
  cua: { table: 'public.sale_allocation_cua', interests: ['cửa'] },

  // Tấm ốp
  'tấm ốp': { table: 'public.sale_allocation_tam_op', interests: ['tấm ốp'] },
  'tam op': { table: 'public.sale_allocation_tam_op', interests: ['tấm ốp'] },

  // SPC / Sàn SPC
  spc: { table: 'public.sale_allocation_spc', interests: ['spc', 'sàn spc'] },
  'sàn spc': { table: 'public.sale_allocation_spc', interests: ['spc', 'sàn spc'] },
  'san spc': { table: 'public.sale_allocation_spc', interests: ['spc', 'sàn spc'] },
});

/**
 * Normalize:
 * - trim
 * - lower
 * - gộp nhiều space thành 1 space
 * - tạo thêm bản no-accent (không dấu) để map alias/fixed route
 */
function normalizeText(s) {
  const base = String(s ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

  const noAccent = base
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, ''); // remove diacritics

  return { base, noAccent };
}

/**
 * @param {object} params
 * @param {import('pg').PoolClient} params.client - pg client (đang ở trong transaction)
 * @param {string} params.productInterest - ví dụ: "Cửa", "Tấm ốp", "SPC", "Phào", ...
 * @param {Date} [params.now] - thời điểm nhận lead (mặc định Date.now)
 * @returns {Promise<null | {sale_id:number, sale_name:string, score:number, total_new:number, remaining:number}>}
 */
async function allocateSale({ client, productInterest, now = new Date() }) {
  

  if (!productInterest || !String(productInterest).trim()) return null;

  const { base, noAccent } = normalizeText(productInterest);

  // =========================
  // 1) FIXED ROUTE ƯU TIÊN
  // =========================
  const fixedSaleId = FIXED_SALE_BY_PRODUCT_NOACCENT[noAccent];
  if (fixedSaleId) {
    // Lấy sale_name + check nghỉ việc
    const { rows } = await client.query(
      `
      SELECT
        ma_so_nv::bigint AS sale_id,
        ho_va_ten         AS sale_name,
        tai_khoan_lark AS tk_lark
      FROM public.employee
      WHERE ma_so_nv::bigint = $1
        AND (nghi_viec IS NULL OR TRIM(nghi_viec) = '')
      LIMIT 1;
      `,
      [fixedSaleId]
    );

    if (!rows.length) return null;

    return {
      sale_id: Number(rows[0].sale_id),
      sale_name: rows[0].sale_name,
      tk_lark: r.tk_lark,
      // fixed route -> không dùng score/total_new/remaining, set 0 cho đúng shape
      score: 0,
      total_new: 0,
      remaining: 0,
    };
  }

  // =========================
  // 2) CHIA SỐ THEO BẢNG CONFIG
  // =========================
  const rule = PRODUCT_RULES[base] ?? PRODUCT_RULES[noAccent];
  if (!rule) return null;

  // interests để count: toàn bộ đã lower/trim (vì so sánh với LOWER(TRIM(product_interest)))
  const interestNorms = rule.interests.map((x) => String(x).trim().toLowerCase());

  /**
   * Logic giống ảnh / Airtable:
   * - total_new = COUNT(DISTINCT customer_id) theo tuần hiện tại
   * - remaining = max_lead - total_new
   * - score:
   *    + nếu remaining <= 0 => 200 (MATCH ảnh: remaining = 0 cũng coi như "không chia")
   *    + nếu ty_le_chia null/0 => 200
   *    + else (total_new + he_so)/ty_le_chia
   *
   * Chọn:
   * - score nhỏ nhất
   * - tie: total_new nhỏ hơn
   * - tie: sale_id nhỏ hơn
   *
   * Concurrency:
   * - FOR UPDATE OF c SKIP LOCKED để 2 request không lock cùng 1 sale row.
   */
  const sql = `
    WITH cnt AS (
      SELECT
        sale_id,
        COUNT(DISTINCT customer_id) AS total_new
      FROM customers.customer
      WHERE LOWER(TRIM(product_interest)) = ANY($1::text[])
        AND created_at >= date_trunc('week', $2::timestamp)
        AND created_at <  date_trunc('week', $2::timestamp) + interval '1 week'
        AND (status IS NULL OR status <> ALL($3::text[]))
      GROUP BY sale_id
    )
    SELECT
      c.sale_id,
      e.ho_va_ten AS sale_name,
      e.tai_khoan_lark as tk_lark,
      COALESCE(cnt.total_new, 0)::int AS total_new,
      (c.max_lead - COALESCE(cnt.total_new, 0))::int AS remaining,
      (
        CASE
          WHEN (c.max_lead - COALESCE(cnt.total_new, 0)) <= 0 THEN 200
          WHEN c.ty_le_chia IS NULL OR c.ty_le_chia = 0 THEN 200
          ELSE (COALESCE(cnt.total_new, 0) + COALESCE(c.he_so, 0)) / c.ty_le_chia
        END
      )::float8 AS score
    FROM ${rule.table} c
    JOIN public.employee e
      ON e.ma_so_nv::bigint = c.sale_id
    LEFT JOIN cnt
      ON cnt.sale_id = c.sale_id
    WHERE COALESCE(c.is_active, true) = true
      AND (e.nghi_viec IS NULL OR TRIM(e.nghi_viec) = '')
    ORDER BY score ASC, total_new ASC, c.sale_id ASC
    LIMIT 1
    FOR UPDATE OF c SKIP LOCKED;
  `;

  const { rows } = await client.query(sql, [interestNorms, now, EXCLUDED_STATUSES]);
  if (!rows.length) return null;

  const r = rows[0];
  return {
    sale_id: Number(r.sale_id),
    sale_name: r.sale_name,
    tk_lark: rows[0].tk_lark,
    score: Number(r.score),
    total_new: Number(r.total_new),
    remaining: Number(r.remaining),
  };
}

module.exports = { allocateSale, EXCLUDED_STATUSES };