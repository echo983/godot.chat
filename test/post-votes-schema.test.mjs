// chat-room.ts 是个 Durable Object,依赖 Workers 运行时的 this.ctx.storage.sql,
// 没法在普通 Node 里直接 import 跑单测。这里用 node:sqlite 的 DatabaseSync 起一个
// 真实的内存 SQLite 数据库,复刻 post_votes 表的建表 SQL、castVote 的 upsert SQL、
// runWeeklyGc 的查票数+删除 SQL 原样跑一遍——改了 chat-room.ts 里对应的 SQL
// 要记得同步改这里,不然测试会跟真实代码脱节测不出问题。风格同 posts-schema.test.mjs。

import { DatabaseSync } from "node:sqlite";

const GC_CYCLE_MS = 7 * 24 * 60 * 60 * 1000;

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

const CREATE_VOTES_TABLE = `CREATE TABLE IF NOT EXISTS post_votes (
  post_id TEXT NOT NULL,
  hash_id TEXT NOT NULL,
  vote TEXT NOT NULL CHECK (vote IN ('good', 'bad')),
  updated_ts INTEGER NOT NULL,
  PRIMARY KEY (post_id, hash_id)
)`;

function makeDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(CREATE_POSTS_TABLE);
  db.exec(CREATE_VOTES_TABLE);
  return db;
}

function insertPost(db, id, createdTs) {
  db.prepare(
    "INSERT INTO posts (id, title, summary, key_points, from_seq, to_seq, created_ts) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(id, "标题", "摘要", JSON.stringify([]), 1, 1, createdTs);
}

function castVote(db, postId, hashId, vote, now) {
  db.prepare(
    `INSERT INTO post_votes (post_id, hash_id, vote, updated_ts) VALUES (?, ?, ?, ?)
     ON CONFLICT(post_id, hash_id) DO UPDATE SET vote = excluded.vote, updated_ts = excluded.updated_ts`,
  ).run(postId, hashId, vote, now);
}

function tallyVotes(db, postId) {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN vote = 'good' THEN 1 ELSE 0 END), 0) AS good,
              COALESCE(SUM(CASE WHEN vote = 'bad' THEN 1 ELSE 0 END), 0) AS bad
       FROM post_votes WHERE post_id = ?`,
    )
    .get(postId);
  return { good: row.good, bad: row.bad };
}

function isGoodPost(good, bad) {
  return good - bad > 0;
}

function isInGracePeriod(createdTs, now) {
  return now - createdTs < GC_CYCLE_MS;
}

function runWeeklyGc(db, now) {
  const rows = db.prepare("SELECT id, created_ts AS createdTs FROM posts").all();
  let deletedCount = 0;
  for (const row of rows) {
    if (isInGracePeriod(row.createdTs, now)) continue;
    const { good, bad } = tallyVotes(db, row.id);
    if (!isGoodPost(good, bad)) {
      db.prepare("DELETE FROM posts WHERE id = ?").run(row.id);
      db.prepare("DELETE FROM post_votes WHERE post_id = ?").run(row.id);
      deletedCount++;
    }
  }
  return deletedCount;
}

let fail = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) fail++;
  console.log(ok ? "ok  " : "FAIL", name, "->", JSON.stringify(actual), ok ? "" : `(expected ${JSON.stringify(expected)})`);
}

// --- 投票 upsert 语义 ---
{
  const db = makeDb();
  insertPost(db, "p1", 1000);

  castVote(db, "p1", "hashA", "good", 2000);
  check("投好票后票数正确", tallyVotes(db, "p1"), { good: 1, bad: 0 });

  castVote(db, "p1", "hashA", "bad", 3000);
  const rowCount = db.prepare("SELECT COUNT(*) AS n FROM post_votes WHERE post_id = ?").get("p1").n;
  check("同一人改票,行数不变(upsert 不是新增)", rowCount, 1);
  check("改票后票数翻转", tallyVotes(db, "p1"), { good: 0, bad: 1 });

  castVote(db, "p1", "hashB", "good", 4000);
  check("不同人投票产生新行", tallyVotes(db, "p1"), { good: 1, bad: 1 });
}

// --- GC:净负票、观察期已过 → 删除 ---
{
  const db = makeDb();
  const now = 100 * GC_CYCLE_MS;
  insertPost(db, "old-bad", now - 8 * 24 * 60 * 60 * 1000);
  castVote(db, "old-bad", "h1", "bad", now);
  castVote(db, "old-bad", "h2", "bad", now);

  const deleted = runWeeklyGc(db, now);
  check("净负票+观察期已过,GC 删了1条", deleted, 1);
  check("posts 表里这条真的没了", db.prepare("SELECT * FROM posts WHERE id = ?").get("old-bad"), undefined);
  check("post_votes 里对应记录也一起清掉了", db.prepare("SELECT * FROM post_votes WHERE post_id = ?").all("old-bad"), []);
}

// --- GC:净正票、观察期已过 → 保留 ---
{
  const db = makeDb();
  const now = 100 * GC_CYCLE_MS;
  insertPost(db, "old-good", now - 8 * 24 * 60 * 60 * 1000);
  castVote(db, "old-good", "h1", "good", now);
  castVote(db, "old-good", "h2", "good", now);
  castVote(db, "old-good", "h3", "bad", now);

  const deleted = runWeeklyGc(db, now);
  check("净正票+观察期已过,GC 不删", deleted, 0);
  check("posts 表里这条还在", db.prepare("SELECT id FROM posts WHERE id = ?").get("old-good").id, "old-good");
}

// --- GC:净负票,但还在观察期 → 跳过不动 ---
{
  const db = makeDb();
  const now = 100 * GC_CYCLE_MS;
  insertPost(db, "fresh-bad", now - 60 * 60 * 1000); // 1 小时前创建
  castVote(db, "fresh-bad", "h1", "bad", now);
  castVote(db, "fresh-bad", "h2", "bad", now);

  const deleted = runWeeklyGc(db, now);
  check("净负票但仍在观察期,GC 跳过不删", deleted, 0);
  check("posts 表里这条还在", db.prepare("SELECT id FROM posts WHERE id = ?").get("fresh-bad").id, "fresh-bad");
}

// --- GC:混合场景,一次跑多条互不干扰 ---
{
  const db = makeDb();
  const now = 100 * GC_CYCLE_MS;
  insertPost(db, "a-old-bad", now - 8 * 24 * 60 * 60 * 1000);
  insertPost(db, "b-old-good", now - 8 * 24 * 60 * 60 * 1000);
  insertPost(db, "c-fresh-noVote", now - 60 * 60 * 1000);
  castVote(db, "a-old-bad", "h1", "bad", now);
  castVote(db, "b-old-good", "h1", "good", now);

  const deleted = runWeeklyGc(db, now);
  check("混合场景只删该删的那一条", deleted, 1);
  const remaining = db.prepare("SELECT id FROM posts ORDER BY id").all().map((r) => r.id);
  check("剩下的两条是保留的+观察期内的", remaining, ["b-old-good", "c-fresh-noVote"]);
}

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
