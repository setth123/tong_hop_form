import os
import sys
import json
import psycopg2
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://postgres:password@192.168.110.46:5432/postgres"
)

APP_SCHEMA = os.getenv("CUSTOMER_SCHEMA", "customers")

if not DATABASE_URL:
    print("Missing DATABASE_URL", file=sys.stderr)
    sys.exit(1)

def main():
    if len(sys.argv) < 2:
        print("Usage: python load_sale_map.py sale_map.json", file=sys.stderr)
        sys.exit(1)

    path = sys.argv[1]
    items = json.load(open(path, "r", encoding="utf-8"))
    if not isinstance(items, list):
        raise RuntimeError("JSON must be a list of objects")

    conn = psycopg2.connect(DATABASE_URL)
    try:
        with conn:
            with conn.cursor() as cur:
                for it in items:
                    sale_id = int(it["sale_id"])
                    chat_id = int(it["telegram_chat_id"])

                    cur.execute(
                        f"""
                        INSERT INTO {APP_SCHEMA}.sale_telegram_map (sale_id, telegram_chat_id)
                        VALUES (%s, %s)
                        ON CONFLICT (sale_id)
                        DO UPDATE SET telegram_chat_id = EXCLUDED.telegram_chat_id,
                                      updated_at = NOW()
                        """,
                        (sale_id, chat_id)
                    )
        print(f"Imported {len(items)} mappings into {APP_SCHEMA}.sale_telegram_map")
    finally:
        conn.close()

if __name__ == "__main__":
    main()