import { resolveLocale, SUPPORTED_LOCALES, DEFAULT_LOCALE } from "../src/i18n.ts";

function makeRequest(headers) {
  return new Request("https://newyork.godot.chat/", { headers });
}

const cases = [
  ["no headers at all", {}, "en"],
  ["cookie wins over accept-language", { Cookie: "lang=zh-Hant", "Accept-Language": "en-US" }, "zh-Hant"],
  ["invalid cookie value falls through to accept-language", { Cookie: "lang=fr", "Accept-Language": "es-MX" }, "es"],
  ["accept-language zh-CN -> zh-Hans", { "Accept-Language": "zh-CN,zh;q=0.9" }, "zh-Hans"],
  ["accept-language zh-TW -> zh-Hant", { "Accept-Language": "zh-TW,zh;q=0.9" }, "zh-Hant"],
  ["accept-language bare zh -> zh-Hans", { "Accept-Language": "zh" }, "zh-Hans"],
  ["accept-language unsupported (fr) falls back to en", { "Accept-Language": "fr-FR,fr;q=0.9" }, "en"],
  ["accept-language multiple, first unsupported then es", { "Accept-Language": "fr-FR;q=0.9,es-ES;q=0.8" }, "es"],
  ["accept-language with q values out of order", { "Accept-Language": "en;q=0.5,zh-TW;q=0.9" }, "zh-Hant"],
  ["cookie with other cookies mixed in", { Cookie: "foo=bar; lang=es; baz=qux" }, "es"],
];

let failed = 0;
for (const [name, headers, expected] of cases) {
  const got = resolveLocale(makeRequest(headers));
  const ok = got === expected;
  if (!ok) failed++;
  console.log(ok ? "ok  " : "FAIL", name, "->", got, ok ? "" : `(expected ${expected})`);
}

if (!SUPPORTED_LOCALES.includes(DEFAULT_LOCALE)) {
  failed++;
  console.log("FAIL: DEFAULT_LOCALE not in SUPPORTED_LOCALES");
}

console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
