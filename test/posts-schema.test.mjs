// chat-room.ts 是个 Durable Object,依赖 Workers 运行时的 this.ctx.storage.sql,
// 没法在普通 Node 里直接 import 跑单测。这里用 node:sqlite 的 DatabaseSync 起一个
// 真实的内存 SQLite 数据库,复刻 ensureSchema() 里 posts 表的建表/迁移 SQL 原样跑一遍——
// 改了 chat-room.ts 里对应的 SQL 要记得同步改这里,不然测试会跟真实代码脱节测不出问题。
//
// 重点测 2026-08-30 加的 source_messages 快照字段:新房间直接建表带这个字段;
// 已经建过表的旧房间(这次改动之前创建的)靠 PRAGMA table_info 探测 + ALTER TABLE
// 补上,不能漏掉旧房间,也不能对新房间重复 ALTER 报错。

import { DatabaseSync } from "node:sqlite";

const CREATE_POSTS_TABLE = `CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  key_points TEXT NOT NULL,
  from_seq INTEGER NOT NULL,
  to_seq INTEGER NOT NULL,
  created_ts INTEGER NOT NULL,
  source_messages TEXT NOT NULL DEFAULT '[]'
)`;

function ensurePostsSchema(db) {
  db.exec(CREATE_POSTS_TABLE);
  const cols = db.prepare("PRAGMA table_info(posts)").all().map((row) => row.name);
  if (!cols.includes("source_messages")) {
    db.exec("ALTER TABLE posts ADD COLUMN source_messages TEXT NOT NULL DEFAULT '[]'");
  }
}

function countPosts(db) {
  return db.prepare("SELECT COUNT(*) AS n FROM posts").get().n;
}

let fail = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fail++;
  console.log(ok ? "ok  " : "FAIL", name, "->", JSON.stringify(actual), ok ? "" : `(expected ${JSON.stringify(expected)})`);
}

// --- 全新房间:直接建表就带 source_messages ---
{
  const db = new DatabaseSync(":memory:");
  ensurePostsSchema(db);

  const sourceMessages = [{ nickname: "Alice", hashId: "abcd1234", text: "hello", ts: 1000 }];
  db.prepare(
    "INSERT INTO posts (id, title, summary, key_points, from_seq, to_seq, created_ts, source_messages) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).run("p1", "标题", "摘要", JSON.stringify(["要点一", "要点二"]), 1, 5, 2000, JSON.stringify(sourceMessages));

  const row = db.prepare("SELECT * FROM posts WHERE id = ?").get("p1");
  check("新房间插入的帖子字段完整", row.title, "标题");
  check("key_points JSON 往返正确", JSON.parse(row.key_points), ["要点一", "要点二"]);
  check("source_messages JSON 往返正确", JSON.parse(row.source_messages), sourceMessages);
  check("countPosts 统计正确", countPosts(db), 1);
}

// --- 旧房间:这次改动之前就建过表,没有 source_messages 列 ---
{
  const db = new DatabaseSync(":memory:");
  // 手动建一张"旧版本"的 posts 表,模拟改动之前就已经存在的房间
  db.exec(`CREATE TABLE posts (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    key_points TEXT NOT NULL,
    from_seq INTEGER NOT NULL,
    to_seq INTEGER NOT NULL,
    created_ts INTEGER NOT NULL
  )`);
  db.prepare(
    "INSERT INTO posts (id, title, summary, key_points, from_seq, to_seq, created_ts) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run("old1", "旧帖子", "旧摘要", JSON.stringify(["旧要点"]), 1, 3, 1500);

  // 跑一遍 ensurePostsSchema——这是房间下次被访问时,构造函数里真实会执行的路径
  ensurePostsSchema(db);

  const cols = db.prepare("PRAGMA table_info(posts)").all().map((r) => r.name);
  check("迁移后 source_messages 列存在", cols.includes("source_messages"), true);

  const row = db.prepare("SELECT * FROM posts WHERE id = ?").get("old1");
  check("旧帖子原有数据没丢", row.title, "旧帖子");
  check("旧帖子的 source_messages 补的是空数组默认值,不是 NULL", row.source_messages, "[]");

  // 再跑一遍 ensurePostsSchema,模拟房间被反复唤醒——不该因为列已存在而报错
  let threwOnSecondRun = false;
  try {
    ensurePostsSchema(db);
  } catch {
    threwOnSecondRun = true;
  }
  check("重复调用 ensurePostsSchema 不报错(列已存在时跳过 ALTER)", threwOnSecondRun, false);
}

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
