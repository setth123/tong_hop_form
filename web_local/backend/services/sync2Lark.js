const LARK_BASE = "https://open.larksuite.com/open-apis";
const appId = "cli_a7f9d8a100789010";
const appSecret = "kQ4Cj6chrTIhDaTrNU5qKi32nhSzxnWI";
const baseId = "E0WIbYLnQaG0RxsHsnXllppwgBh";
const tableId = "tblGUvtb0lexD7vK";

// --- Helper Functions ---

function toLarkTimestamp(date) {
  if (!date) return null;
  return Math.floor(new Date(date).getTime());
}

function toMultiSelect(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  return [String(value)];
}

/**
 * MỚI: Hàm lấy Open ID từ Email hoặc Số điện thoại
 * Cần quyền: Contact > View user information by email or phone number
 */
// async function getLarkOpenId(token, contactValue, isPhone) {
//   if (!contactValue) return null;
//   try {
//     const res = await fetch(`${LARK_BASE}/contact/v3/users/batch_get_id?user_id_type=open_id`, {
//       method: "POST",
//       headers: {
//         "Content-Type": "application/json",
//         Authorization: `Bearer ${token}`
//       },
//       body: JSON.stringify({
//         emails: isPhone ? [] : [contactValue],
//         mobiles: isPhone ? [contactValue] : []
//       })
//     });

//     const data = await res.json();
//     // Lark trả về mảng user_list, lấy user_id (chính là open_id vì ta set param ở trên)
//     const user = data.data?.user_list?.[0];
    
//     if (user && user.user_id) {
//       return user.user_id;
//     }
//     console.warn(`[LARK LOOKUP] Không tìm thấy user cho: ${contactValue}`);
//     return null;
//   } catch (err) {
//     console.error("[LARK LOOKUP ERROR]", err.message);
//     return null;
//   }
// }

async function getLarkOpenId(token, contactValue, isPhone) {
  if (!contactValue) return null;

  const url = `${LARK_BASE}/contact/v3/users/batch_get_id?user_id_type=open_id`;
  const body = {
    emails: isPhone ? [] : [String(contactValue).trim().toLowerCase()],
    mobiles: isPhone ? [String(contactValue).trim()] : [],
    include_resigned: true, // optional: nếu có case nhân sự nghỉ việc mà vẫn cần map
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));

  // QUAN TRỌNG: phân biệt lỗi API vs không có user
  if (!res.ok || data.code !== 0) {
    console.error("[LARK LOOKUP API ERROR]", {
      status: res.status,
      code: data.code,
      msg: data.msg,
      raw: data,
      body,
    });
    return null;
  }

  const user = data.data?.user_list?.[0];
  console.log(
  "[LARK USER RAW]",
  contactValue,
  JSON.stringify(user, null, 2)
);

  if (!user?.user_id) {
    console.warn("[LARK LOOKUP] Not found or no permission for:", contactValue, {
      body,
      api_data: data,
    });
    return null;
  }

  return user.user_id; // open_id vì user_id_type=open_id
}


// --- Main Function ---

const pushCustomerToLark = async (row) => {
  try {
    // 1. Lấy Tenant Access Token
    const tokenRes = await fetch(`${LARK_BASE}/auth/v3/tenant_access_token/internal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret })
    });

    if (!tokenRes.ok) throw new Error("Failed to get Lark tenant token");
    const { tenant_access_token: token } = await tokenRes.json();

    // 2. Chuẩn hóa thông tin NV SALE và lấy Open ID
    let identifier = String(row.tk_lark || "").trim();
    console.log(row.tk_lark);
    let finalOpenId = null;

    if (identifier) {
      const isPhone = /^\+?[0-9\s.-]{8,15}$/.test(identifier) && /[0-9]/.test(identifier);
      let contactToLookup = identifier;

      if (isPhone) {
        // Chuẩn hóa SĐT sang +84 cho đúng format Lark yêu cầu khi lookup
        if (contactToLookup.startsWith("0")) {
          contactToLookup = "+84" + contactToLookup.slice(1);
        } else if (!contactToLookup.startsWith("+")) {
          contactToLookup = "+" + contactToLookup;
        }
        contactToLookup = contactToLookup.replace(/[\s.-]/g, "");
      }

      // Thực hiện chuyển đổi Email/SĐT -> Open ID
      finalOpenId = await getLarkOpenId(token, contactToLookup, isPhone);
    }

    // 3. Map fields
    const fields = {
      "ID Khách hàng": String(row.customer_id),
      "Tên khách hàng": row.name ?? null,
      "Số điện thoại": row.phone ?? null,
      "Sản phẩm dịch vụ quan tâm": toMultiSelect(row.product_interest),
      "Nhóm KH": row.customer_source ?? null,
      "Ghi chú": row.note ?? null,
      "Tình trạng khách": row.status ?? null,
      "Thời gian tạo": toLarkTimestamp(row.created_at),
      "Thời gian cập nhật": toLarkTimestamp(row.updated_at),
      // Quan trọng: Dùng openId đã lấy được
      "NV SALE": finalOpenId ? [{ id: finalOpenId }] : [],
    };

    // 4. Đẩy dữ liệu lên Lark với user_id_type=open_id (để khớp với mô tả lỗi)
    const url = `${LARK_BASE}/bitable/v1/apps/${baseId}/tables/${tableId}/records?user_id_type=open_id`;
    
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ fields })
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("[LARK INSERT ERROR]", {
        customer_id: row.customer_id,
        fields,
        error: errText
      });
      throw new Error(`Push to Lark failed: ${res.status}`);
    }

    return await res.json();

  } catch (err) {
    console.error("[pushCustomerToLark FAILED]", {
      customer_id: row?.customer_id,
      message: err.message
    });
    throw err;
  }
};

module.exports = { pushCustomerToLark };