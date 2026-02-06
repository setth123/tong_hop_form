import os
import time
import json
import logging
import requests
import psycopg2
import psycopg2.extras
from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://postgres:password@192.168.110.46:5432/postgres"
)

BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "8098124595:AAFIN88huNmSTj5WuDy_Od2wI5RMRf2cnjQ")

BATCH_SIZE = int(os.getenv("BATCH_SIZE", "20"))
POLL_MS = int(os.getenv("POLL_MS", "800"))
MAX_RETRIES = int(os.getenv("MAX_RETRIES", "5"))
RESET_STUCK_MINUTES = int(os.getenv("RESET_STUCK_MINUTES", "10"))
MISSING_MAP_RETRY_SECONDS = int(os.getenv("MISSING_MAP_RETRY_SECONDS", "300"))

APP_SCHEMA = os.getenv("CUSTOMER_SCHEMA", "customers")  # dùng chung schema

if not DATABASE_URL:
    raise RuntimeError("Missing DATABASE_URL")
if not BOT_TOKEN:
    raise RuntimeError("Missing TELEGRAM_BOT_TOKEN")

psycopg2.extras.register_default_jsonb(loads=json.loads, globally=True)

def db_connect():
    conn = psycopg2.connect(DATABASE_URL)
    conn.autocommit = False
    return conn

def format_message(p: dict) -> str:
    lines = []

    name = str(p.get("name", "")).strip()
    phone = str(p.get("phone", "")).strip()

    lines.append("Bạn có khách hàng mới được phân công :")
    lines.append(f"Mã KH : {name} - {phone}".strip(" -"))

    fields = [
        ("product_interest", "Sản phẩm quan tâm"),
        ("customer_source", "Nguồn"),
        ("note", "Ghi chú"),
        ("status", "Trạng thái"),
        ("created_at", "Tạo lúc"),
    ]

    for k, label in fields:
        v = p.get(k)
        if not v:
            continue
        s = str(v).strip()
        if s:
            lines.append(f"- {label}: {s}")

    text = "\n".join(lines)
    if len(text) > 3900:
        text = text[:3900] + "\n...(truncated)"
    return text


def telegram_send(chat_id: int, text: str):
    url = f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage"
    payload = {
        "chat_id": chat_id,
        "text": text,
        "disable_web_page_preview": True
    }
    r = requests.post(url, json=payload, timeout=15)

    # parse response
    try:
        data = r.json()
    except Exception:
        r.raise_for_status()
        raise RuntimeError(f"Telegram response not JSON: {r.text[:300]}")

    # rate limit
    if r.status_code == 429 or data.get("error_code") == 429:
        retry_after = int(data.get("parameters", {}).get("retry_after", 1))
        logging.warning("Telegram rate limit: sleep %ss", retry_after)
        time.sleep(retry_after)

        r2 = requests.post(url, json=payload, timeout=15)
        data2 = r2.json()
        if not data2.get("ok"):
            raise RuntimeError(f"Telegram error after retry: {json.dumps(data2)[:500]}")
        return

    if not data.get("ok"):
        raise RuntimeError(f"Telegram error: {json.dumps(data)[:500]}")

def reset_stuck(conn):
    with conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                UPDATE {APP_SCHEMA}.telegram_outbox
                SET status='PENDING',
                    processing_started_at=NULL,
                    next_attempt_at=NOW(),
                    updated_at=NOW()
                WHERE status='PROCESSING'
                  AND processing_started_at IS NOT NULL
                  AND processing_started_at < NOW() - (%s * INTERVAL '1 minute')
                """,
                (RESET_STUCK_MINUTES,)
            )

def claim_jobs(conn, limit: int):
    with conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                f"""
                WITH cte AS (
                    SELECT id
                    FROM {APP_SCHEMA}.telegram_outbox
                    WHERE status='PENDING'
                      AND next_attempt_at <= NOW()
                    ORDER BY id
                    FOR UPDATE SKIP LOCKED
                    LIMIT %s
                )
                UPDATE {APP_SCHEMA}.telegram_outbox o
                SET status='PROCESSING',
                    processing_started_at=NOW(),
                    updated_at=NOW()
                FROM cte
                WHERE o.id = cte.id
                RETURNING o.id, o.sale_id, o.row_pk, o.payload, o.retry_count;
                """,
                (limit,)
            )
            return cur.fetchall()

def lookup_chat_id(conn, sale_id: int):
    with conn.cursor() as cur:
        cur.execute(
            f"SELECT telegram_chat_id FROM {APP_SCHEMA}.sale_telegram_map WHERE sale_id=%s",
            (sale_id,)
        )
        row = cur.fetchone()
        return row[0] if row else None

def mark_sent(conn, outbox_id: int):
    with conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                UPDATE {APP_SCHEMA}.telegram_outbox
                SET status='SENT',
                    sent_at=NOW(),
                    last_error=NULL,
                    processing_started_at=NULL,
                    updated_at=NOW()
                WHERE id=%s
                """,
                (outbox_id,)
            )

def mark_failed(conn, outbox_id: int, err: str):
    with conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                UPDATE {APP_SCHEMA}.telegram_outbox
                SET status='FAILED',
                    last_error=%s,
                    processing_started_at=NULL,
                    updated_at=NOW()
                WHERE id=%s
                """,
                (err[:2000], outbox_id)
            )

def backoff_seconds(retry_count: int) -> int:
    # 5s, 10s, 20s, 40s... max 300s
    sec = 5 * (2 ** max(0, retry_count))
    return min(sec, 300)

def mark_retry(conn, outbox_id: int, retry_count: int, err: str):
    delay = backoff_seconds(retry_count)
    with conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                UPDATE {APP_SCHEMA}.telegram_outbox
                SET retry_count = retry_count + 1,
                    status = CASE WHEN retry_count + 1 >= %s THEN 'FAILED' ELSE 'PENDING' END,
                    last_error=%s,
                    next_attempt_at = NOW() + (%s * INTERVAL '1 second'),
                    processing_started_at=NULL,
                    updated_at=NOW()
                WHERE id=%s
                """,
                (MAX_RETRIES, err[:2000], delay, outbox_id)
            )

def mark_wait_mapping(conn, outbox_id: int, sale_id: int):  
    with conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                UPDATE {APP_SCHEMA}.telegram_outbox
                SET status='PENDING',
                    last_error=%s,
                    next_attempt_at = NOW() + (%s * INTERVAL '1 second'),
                    processing_started_at=NULL,
                    updated_at=NOW()
                WHERE id=%s
                """,
                (f"Missing mapping sale_id={sale_id}", MISSING_MAP_RETRY_SECONDS, outbox_id)
            )

def process_once(conn) -> int:
    reset_stuck(conn)

    jobs = claim_jobs(conn, BATCH_SIZE)
    if not jobs:
        return 0

    for job in jobs:
        oid = job["id"]
        sale_id = job["sale_id"]
        payload = job["payload"] or {}
        retry_count = int(job["retry_count"] or 0)

        try:
            if sale_id is None:
                mark_failed(conn, oid, "sale_id is NULL -> không xác định được người nhận")
                continue

            chat_id = lookup_chat_id(conn, int(sale_id))
            if not chat_id:
                # Chưa có mapping: chờ bạn import danh sách sale_id -> telegram_id
                mark_wait_mapping(conn, oid, int(sale_id))
                continue

            text = format_message(payload)
            telegram_send(int(chat_id), text)

            mark_sent(conn, oid)

        except Exception as e:
            logging.exception("Send failed for outbox_id=%s", oid)
            mark_retry(conn, oid, retry_count, str(e))

    return len(jobs)

def main():
    conn = db_connect()
    logging.info("Worker started | batch=%s poll_ms=%s", BATCH_SIZE, POLL_MS)

    while True:
        try:
            n = process_once(conn)
            time.sleep(0.05 if n > 0 else POLL_MS / 1000.0)
        except (psycopg2.OperationalError, psycopg2.InterfaceError):
            logging.exception("DB connection error -> reconnect")
            try:
                conn.close()
            except Exception:
                pass
            time.sleep(1)
            conn = db_connect()
        except Exception:
            logging.exception("Worker loop error")
            time.sleep(1)

if __name__ == "__main__":
    main()