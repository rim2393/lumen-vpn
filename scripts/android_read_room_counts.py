import json
import sqlite3
import sys


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("usage: android_read_room_counts.py <lumen.db>")
    con = sqlite3.connect(sys.argv[1])
    try:
        cur = con.cursor()
        subscriptions = cur.execute("select count(*) from subscriptions").fetchone()[0]
        servers = cur.execute("select count(*) from servers").fetchone()[0]
        ready_servers = cur.execute(
            "select count(*) from servers where length(host) > 0 and rawUri is not null"
        ).fetchone()[0]
        print(
            json.dumps(
                {
                    "subscriptions": subscriptions,
                    "servers": servers,
                    "ready_servers": ready_servers,
                },
                separators=(",", ":"),
            )
        )
    finally:
        con.close()


if __name__ == "__main__":
    main()
