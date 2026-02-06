import os
import sys
import psycopg2
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://postgres:password@192.168.110.46:5432/postgres"
)

CUSTOMER_SCHEMA = os.getenv("CUSTOMER_SCHEMA", "customers")
CUSTOMER_TABLE = os.getenv("CUSTOMER_TABLE", "customer")

if not DATABASE_URL:
    print("Missing DATABASE_URL in .env", file=sys.stderr)
    sys.exit(1)

def qident(name: str) -> str:
    # quote identifier an toàn: "abc"
    return '"' + name.replace('"', '""') + '"'

FULL_CUSTOMER_TABLE = f"{qident(CUSTOMER_SCHEMA)}.{qident(CUSTOMER_TABLE)}"
APP_SCHEMA = qident(CUSTOMER_SCHEMA)

STATEMENTS = [
    # 0) create schema (safe)
    f"CREATE SCHEMA IF NOT EXISTS {APP_SCHEMA};",

    # 1) mapping sale_id -> telegram_chat_id
    f"""
    CREATE TABLE IF NOT EXISTS {APP_SCHEMA}.sale_telegram_map (
      sale_id           INTEGER PRIMARY KEY,
      telegram_chat_id  BIGINT NOT NULL,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    """,

    # 2) outbox
    f"""
    CREATE TABLE IF NOT EXISTS {APP_SCHEMA}.telegram_outbox (
      id                    BIGSERIAL PRIMARY KEY,
      source_table          TEXT NOT NULL DEFAULT '{CUSTOMER_SCHEMA}.{CUSTOMER_TABLE}',
      row_pk                TEXT,
      sale_id               INTEGER,
      payload               JSONB NOT NULL,
      status                TEXT NOT NULL DEFAULT 'PENDING', -- PENDING | PROCESSING | SENT | FAILED
      retry_count           INT NOT NULL DEFAULT 0,
      last_error            TEXT,
      next_attempt_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      processing_started_at TIMESTAMPTZ,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      sent_at               TIMESTAMPTZ
    );
    """,

    f"CREATE INDEX IF NOT EXISTS idx_telegram_outbox_status_id ON {APP_SCHEMA}.telegram_outbox (status, id);",
    f"CREATE INDEX IF NOT EXISTS idx_telegram_outbox_next_attempt ON {APP_SCHEMA}.telegram_outbox (next_attempt_at);",

    # 3) updated_at helper trigger
    f"""
    CREATE OR REPLACE FUNCTION {APP_SCHEMA}.fn_set_updated_at()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
    """,

    f"DROP TRIGGER IF EXISTS tg_sale_telegram_map_updated_at ON {APP_SCHEMA}.sale_telegram_map;",
    f"""
    CREATE TRIGGER tg_sale_telegram_map_updated_at
    BEFORE UPDATE ON {APP_SCHEMA}.sale_telegram_map
    FOR EACH ROW
    EXECUTE FUNCTION {APP_SCHEMA}.fn_set_updated_at();
    """,

    f"DROP TRIGGER IF EXISTS tg_telegram_outbox_updated_at ON {APP_SCHEMA}.telegram_outbox;",
    f"""
    CREATE TRIGGER tg_telegram_outbox_updated_at
    BEFORE UPDATE ON {APP_SCHEMA}.telegram_outbox
    FOR EACH ROW
    EXECUTE FUNCTION {APP_SCHEMA}.fn_set_updated_at();
    """,

    # 4) Trigger function: enqueue on insert (nếu sale_id có sẵn)
    f"""
    CREATE OR REPLACE FUNCTION {APP_SCHEMA}.fn_customer_enqueue_on_insert()
    RETURNS TRIGGER AS $$
    BEGIN
      IF NEW.sale_id IS NULL THEN
        RETURN NEW;
      END IF;

      INSERT INTO {APP_SCHEMA}.telegram_outbox (row_pk, sale_id, payload)
      VALUES (NEW.customer_id::TEXT, NEW.sale_id, to_jsonb(NEW));

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
    """,

    f"DROP TRIGGER IF EXISTS tg_customer_outbox_insert ON {FULL_CUSTOMER_TABLE};",
    f"""
    CREATE TRIGGER tg_customer_outbox_insert
    AFTER INSERT ON {FULL_CUSTOMER_TABLE}
    FOR EACH ROW
    EXECUTE FUNCTION {APP_SCHEMA}.fn_customer_enqueue_on_insert();
    """,

    # 5) Trigger function: enqueue khi sale_id được gán/đổi (rất hợp case của bạn)
    f"""
    CREATE OR REPLACE FUNCTION {APP_SCHEMA}.fn_customer_enqueue_on_sale_change()
    RETURNS TRIGGER AS $$
    BEGIN
      IF NEW.sale_id IS NOT NULL AND (OLD.sale_id IS DISTINCT FROM NEW.sale_id) THEN
        INSERT INTO {APP_SCHEMA}.telegram_outbox (row_pk, sale_id, payload)
        VALUES (NEW.customer_id::TEXT, NEW.sale_id, to_jsonb(NEW));
      END IF;

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
    """,

    f"DROP TRIGGER IF EXISTS tg_customer_outbox_sale_change ON {FULL_CUSTOMER_TABLE};",
    f"""
    CREATE TRIGGER tg_customer_outbox_sale_change
    AFTER UPDATE OF sale_id ON {FULL_CUSTOMER_TABLE}
    FOR EACH ROW
    WHEN (OLD.sale_id IS DISTINCT FROM NEW.sale_id)
    EXECUTE FUNCTION {APP_SCHEMA}.fn_customer_enqueue_on_sale_change();
    """,
]

def main():
    conn = psycopg2.connect(DATABASE_URL)
    try:
        with conn:
            with conn.cursor() as cur:
                # kiểm tra table tồn tại
                cur.execute(
                    """
                    SELECT to_regclass(%s);
                    """,
                    (f"{CUSTOMER_SCHEMA}.{CUSTOMER_TABLE}",)
                )
                if cur.fetchone()[0] is None:
                    raise RuntimeError(f"Table {CUSTOMER_SCHEMA}.{CUSTOMER_TABLE} not found. Check CUSTOMER_SCHEMA/CUSTOMER_TABLE.")

                for sql in STATEMENTS:
                    cur.execute(sql)

        print("DB setup OK: sale_telegram_map, telegram_outbox, triggers created.")
    finally:
        conn.close()

if __name__ == "__main__":
    main()