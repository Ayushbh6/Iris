import sqlite3
from pathlib import Path
schema=Path('db/migrations/0001_initial.sql').read_text()+Path('db/migrations/0002_records.sql').read_text()
c=sqlite3.connect(':memory:')
c.executescript(schema)
c.executescript(schema)
tables={r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'")}
assert tables=={'visitors','conversations','messages','events','model_requests','media_assets','usage_records','quota_buckets','leave_messages'},tables
c.execute("INSERT INTO visitors VALUES ('v',1,1,100,'active')")
c.execute("INSERT INTO conversations VALUES ('c','v','active','voice','v1','{}','{}',1,1,NULL,100)")
c.execute("INSERT INTO messages VALUES ('m','c',1,'user','text','{\"text\":\"hello\"}',NULL,NULL,'complete',1,2)")
c.execute("INSERT INTO events VALUES ('e','c','m',NULL,1,'browser','message.accepted',NULL,'e1',1,2,'{}')")
def rejects(sql):
 try:c.execute(sql)
 except sqlite3.IntegrityError:return
 raise AssertionError('Expected constraint rejection: '+sql)
rejects("UPDATE events SET payload_json='{}' WHERE id='e'")
rejects("INSERT INTO messages VALUES ('m2','missing',1,'user','text','{}',NULL,NULL,'complete',1,2)")
rejects("INSERT INTO quota_buckets VALUES ('q','experiment','global','usd_micros',0,100,10,8,3,1)")
rejects("INSERT INTO messages VALUES ('m3','c',1,'user','text','{}',NULL,NULL,'complete',1,2)")
assert c.execute('PRAGMA foreign_key_check').fetchall()==[]
rejects("INSERT INTO leave_messages VALUES ('l','v',NULL,'','a@b.co','hi','new',1,NULL,100)")
rejects("INSERT INTO leave_messages VALUES ('l','v',NULL,'n','a@b.co','hi','bogus',1,NULL,100)")
c.execute("INSERT INTO leave_messages VALUES ('l','v',NULL,'n','a@b.co','hi','new',1,NULL,100)")
print('PASS: 9 tables, repeatable migration, ownership FKs, ordered messages, append-only events, quota ceiling.')
