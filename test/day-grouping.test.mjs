// 复刻 pages.ts 里 buildBatch / appendMessages / prependMessages 的算法,
// 用普通数组模拟 DOM 的 #log,而不是真的渲染 HTML,专门测分隔条去重的边界情况。
// pages.ts 的这段逻辑活在 <script> 模板字符串里没法直接 import,改了那边的算法
// 记得同步改这里。

function dayKey(ts) {
  const d = new Date(ts);
  return d.getFullYear() + "-" + d.getMonth() + "-" + d.getDate();
}

function buildBatch(list) {
  const items = [];
  let prevKey = null;
  for (const m of list) {
    const key = dayKey(m.ts);
    if (key !== prevKey) {
      items.push({ type: "sep", key });
      prevKey = key;
    }
    items.push({ type: "row", key, text: m.text });
  }
  return items;
}

// log 是一个数组,模拟 DOM 子节点列表(顺序 = 从旧到新,从上到下)
let log = [];
let lastDayKey = null;
let firstDayKey = null;

function appendMessages(list) {
  if (!list.length) return;
  const items = buildBatch(list);
  if (items[0].type === "sep" && items[0].key === lastDayKey) items.shift();
  for (const item of items) log.push(item);
  if (items.length) {
    lastDayKey = items[items.length - 1].key;
    if (firstDayKey === null) firstDayKey = items[0].key;
  }
}

function prependMessages(list) {
  if (!list.length) return;
  const items = buildBatch(list);
  if (items[items.length - 1].key === firstDayKey && log[0] && log[0].type === "sep") {
    log.shift();
  }
  log = [...items, ...log];
  firstDayKey = items[0].key;
}

function reset() {
  log = [];
  lastDayKey = null;
  firstDayKey = null;
}

function summarize() {
  return log.map((i) => (i.type === "sep" ? "[" + i.key + "]" : i.text)).join(" ");
}

const day1 = new Date(2026, 7, 27).getTime() + 1000 * 60 * 10; // 8月27日
const day2 = new Date(2026, 7, 28).getTime() + 1000 * 60 * 10; // 8月28日
const day3 = new Date(2026, 7, 29).getTime() + 1000 * 60 * 10; // 8月29日

let fail = 0;
function check(name, actual, expected) {
  const ok = actual === expected;
  if (!ok) fail++;
  console.log(ok ? "ok  " : "FAIL", name, "->", JSON.stringify(actual), ok ? "" : `(expected ${JSON.stringify(expected)})`);
}

// 场景一:初次连接拿到跨两天的历史,按时间正序 append
reset();
appendMessages([
  { ts: day1, text: "a1" },
  { ts: day1, text: "a2" },
  { ts: day2, text: "b1" },
]);
check(
  "初次历史(跨天)",
  summarize(),
  `[${dayKey(day1)}] a1 a2 [${dayKey(day2)}] b1`,
);

// 场景二:后续来了一条同一天的实时消息,不应该插入重复的分隔条
appendMessages([{ ts: day2, text: "b2" }]);
check(
  "同天实时消息不重复分隔条",
  summarize(),
  `[${dayKey(day1)}] a1 a2 [${dayKey(day2)}] b1 b2`,
);

// 场景三:再来一条新的一天的实时消息,应该新增分隔条
appendMessages([{ ts: day3, text: "c1" }]);
check(
  "新的一天要新增分隔条",
  summarize(),
  `[${dayKey(day1)}] a1 a2 [${dayKey(day2)}] b1 b2 [${dayKey(day3)}] c1`,
);

// 场景四:往上翻页,拿到的更早一批消息,最后一条和当前顶部(day1)是同一天 ->
// 不应该出现两个 day1 的分隔条,应该去掉原来顶部那个,合并成一组
reset();
appendMessages([
  { ts: day2, text: "b1" },
]);
prependMessages([
  { ts: day1, text: "a1" },
  { ts: day1, text: "a2" },
]);
check(
  "翻页衔接同一天,不产生重复分隔条",
  summarize(),
  `[${dayKey(day1)}] a1 a2 [${dayKey(day2)}] b1`,
);

// 场景五:往上翻页,拿到的更早一批消息是不同的一天 -> 应该正常出现两个分隔条
reset();
appendMessages([{ ts: day2, text: "b1" }]);
prependMessages([{ ts: day1, text: "a1" }]);
check(
  "翻页衔接不同天,各自保留分隔条",
  summarize(),
  `[${dayKey(day1)}] a1 [${dayKey(day2)}] b1`,
);

console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
