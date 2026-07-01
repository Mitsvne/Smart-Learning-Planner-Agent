import sqlite3
conn = sqlite3.connect('sessions.db')
cursor = conn.execute("SELECT * FROM sqlite_master;")
print(cursor.fetchall())