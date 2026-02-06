-- Bảng cấu hình “phân số/ phân lead” cho sale
-- Mục tiêu: Lưu các tham số giống Airtable:
--   - max_lead      : Số lead tối đa trong tuần
--   - ty_le_chia    : Tỷ lệ chia (trọng số)
--   - he_so         : Hệ số điều chỉnh
--   - is_active     : Có tham gia chia lead hay không
--
-- sale_id trong bảng này tương ứng với employee.ma_so_nv và customer.sale_id

CREATE TABLE IF NOT EXISTS public.sale_allocation_config (
  sale_id      bigint PRIMARY KEY,
  max_lead     integer NOT NULL DEFAULT 0,
  ty_le_chia   numeric(10,4) NOT NULL DEFAULT 1,
  he_so        numeric(10,4) NOT NULL DEFAULT 0,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamp NOT NULL DEFAULT now(),
  updated_at   timestamp NOT NULL DEFAULT now()
);

-- Gợi ý index (nếu sau này bạn filter nhiều theo is_active)
CREATE INDEX IF NOT EXISTS idx_sale_allocation_config_active
  ON public.sale_allocation_config(is_active);

-- Ví dụ insert (bạn sửa sale_id theo ma_so_nv thực tế):
-- INSERT INTO public.sale_allocation_config (sale_id, max_lead, ty_le_chia, he_so, is_active)
-- VALUES
--   (1001, 50, 3.0, -0.01, true),
--   (1002, 50, 2.5, -0.40, true);
