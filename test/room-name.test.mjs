import { normalizeRoomName } from "../src/room-name.ts";

const cases = [
  ["newyork", true, "newyork"],
  ["Apple", true, "apple"],
  ["a", true, "a"],
  ["a1-b2", true, "a1-b2"],
  ["", false],
  ["averylongname1", false], // 14 chars > 12
  ["123456789012", true, "123456789012"], // exactly 12
  ["1234567890123", false], // 13 chars
  ["-abc", false],
  ["abc-", false],
  ["ab--cd", false],
  ["bad_name", false],
  ["a.b", false],
  ["xn--abc", false],
  ["www", false],
  ["api", false],
  ["godot", false],
  ["chat", false],
];

let failed = 0;
for (const [input, expectOk, expectRoom] of cases) {
  const r = normalizeRoomName(input);
  const ok = r.ok === expectOk && (!expectOk || r.room === expectRoom);
  if (!ok) {
    failed++;
    console.log("FAIL", JSON.stringify(input), "->", r);
  } else {
    console.log("ok  ", JSON.stringify(input), "->", r.ok ? r.room : r.reason);
  }
}
console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
