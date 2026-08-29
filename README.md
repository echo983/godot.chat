# godot.chat

任意 `*.godot.chat` 子域名都是一个独立聊天室,访问即自动创建,不需要注册、不需要事先申请。这是产品构想([`docs/构想摘要.md`](docs/构想摘要.md))里"会代谢的聊天室"的**第一层**——实时聊天这个原始层。构想里"LLM 自动析出帖子"和"结晶/结石/矿渣/化石"分类投票系统是后续阶段,**这个仓库目前还没有做**。

线上地址:[godot.chat](https://godot.chat)

## 这是什么

- 输入任意合法房间名(比如 `newyork`、`apple`,也支持中日韩文字比如 `东京`),对应的 `xxx.godot.chat` 直接可用,没人访问过就自动创建
- 实时消息,支持文本、图片/视频链接自动嵌入预览
- 每个房间独立的匿名身份系统:昵称 + 头像 + 哈希后缀防冒充,可选的跨设备身份恢复码(不是账号系统,见下文"设计取舍")
- 消息持久化(每个房间滚动保留最近 1000 条),支持翻页加载历史
- 在线列表、私聊(悄悄话)
- 简体中文/繁体中文/English/Español 四语言界面,根据浏览器语言自动切换,也可手动选择
- 一整套针对匿名公共聊天室的防滥用机制(见下文"设计取舍")

## 架构

Cloudflare Workers + Durable Objects,没有独立后端服务器,没有数据库(D1/KV 都没用),状态全部落在 Durable Object 自带的 SQLite storage 里。

```
浏览器 ──HTTP/WebSocket──▶ Worker (src/index.ts)
                              │
                  ┌───────────┴────────────┐
                  │                         │
           RoomRegistry              ChatRoom (每个房间一个实例)
        (全站唯一一个实例)              idFromName(房间名)
        - 记录哪些房间名已创建           - 消息存储 + 分页
        - 按 IP 限制新建房间频率         - 身份哈希 + 昵称
                                        - 在线状态广播
                                        - 私聊路由
                                        - 频率限制/冷却/换身份封禁
```

- **一个 Worker 脚本**(`src/index.ts`)通过通配符路由(`*.godot.chat/*`)处理所有子域名,按 Host 头解析出房间名,分发给对应的 Durable Object。
- **`ChatRoom`**:每个房间名对应一个实例(`idFromName(room)`),互相之间数据完全隔离,读不到彼此——这是刻意的设计原则,详见下文。
- **`RoomRegistry`**:全站唯一一个实例,只做两件跨房间的事:记录"这个房间名是不是第一次被访问"、限制单个 IP 短时间内能创建多少个新房间。除此之外不涉及任何身份/消息内容。

## 目录结构

```
src/
  index.ts          Worker 入口,路由分发、CSP、robots.txt、客户端错误上报接口
  chat-room.ts       ChatRoom Durable Object:消息存储、身份、在线状态、私聊、防滥用
  room-registry.ts   RoomRegistry Durable Object:新房间创建限流
  room-name.ts       房间名校验规则(含 CJK/punycode 处理)
  i18n.ts            多语言文案 + 语言解析逻辑
  pages.ts           页面 HTML/CSS/前端 JS(没有构建步骤,直接手写字符串模板)
  node-punycode.d.ts node:punycode 的最小类型声明
test/                单元测试(见下文"测试")
scripts/
  render-and-check.mjs   真实渲染 pages.ts 产出的页面并校验内嵌脚本语法
docs/
  构想摘要.md         产品构想全文
wrangler.jsonc        Worker 配置(路由、Durable Object 绑定、迁移)
```

## 本地开发

```bash
npm install
```

需要一个 Cloudflare API Token(Account Owned Token,新格式 `cfat_` 开头),放在 `secret/cfkey.txt`(这个文件被 `.gitignore` 排除,不会进仓库)。权限至少需要:

- Zone → DNS → Edit(仅第一次配置通配符 DNS 记录需要,日常开发用不到)
- Zone → Zone Settings → Edit
- Account → Workers Scripts → Edit
- Account → Account Analytics → Read(可选,排查线上问题时有用)

```bash
npm run typecheck    # tsc --noEmit
npm test              # 跑 test/ 下全部单测 + check:pages
npm run dev            # 本地 wrangler dev
npm run deploy          # 部署到生产(godot-chat)
```

`deploy` 需要 `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` 环境变量,比如:

```bash
CLOUDFLARE_API_TOKEN=$(cat secret/cfkey.txt) CLOUDFLARE_ACCOUNT_ID=<你的账号ID> npm run deploy
```

**已知的本地开发限制**:`wrangler dev` 在 `wrangler.jsonc` 配置了 `routes` 的情况下,不会尊重自定义的 `Host` 请求头做子域名路由(内部一律按配置的 zone 处理)——所以本地测"进哪个房间"这件事测不出来,只能测通用逻辑,真正验证子域名路由只能直接部署到线上测。

没有 CI——`npm test`、`npm run typecheck` 都是手动跑,直接部署到生产,没有中间环节。

`src/index.ts`/`src/pages.ts` 里的域名不是硬编码的,读的是 `wrangler.jsonc` 里 `vars.ROOT_DOMAIN`(目前只有一个值:`godot.chat`)——这是给"曾经尝试过 staging 环境"留下的痕迹,见下文"尚未实现"。

## 测试

`test/` 目录下按测试目标分两类:

- **直接 import 真实源码**的(`room-name.test.mjs`、`room-name-cjk.test.mjs`、`i18n.test.mjs`):这几个模块是纯逻辑,不依赖 Workers 运行时,可以在普通 Node 里直接跑,测的就是真实代码。
- **复刻逻辑**的(其余几个):`chat-room.ts` 和 `room-registry.ts` 是 Durable Object,依赖 `this.ctx.storage.sql`、`crypto.subtle`、Hibernatable WebSocket 这些 Workers 专属 API,没法在普通 Node 里直接跑;`pages.ts` 里的客户端逻辑活在拼 HTML 字符串的模板字面量里,也没法作为模块直接 import。这些测试文件顶部都有注释说明——**改了对应的真实实现,要记得手动同步改测试**,它们不会自动帮你发现代码漂移。

`scripts/render-and-check.mjs`(即 `npm run check:pages`)是另一类校验:用 esbuild 真实打包 `pages.ts`,调用真实的 `renderChatPage`/`renderLandingPage`,对产出的每个 `<script>` 块做语法解析。这是专门为了防一类曾经真实上线过的 bug——`pages.ts` 把前端 JS 写在 TypeScript 模板字符串里,`\/`、`\s`、`\.`、`\]` 这类反斜杠转义会被外层模板字符串自己先吃掉一层,直接写在字符串里的正则表达式很容易被静默改坏,只对 `${...}` 占位符做替换的语法检查测不出这个问题,必须走真实渲染。

## 设计取舍

一些不是随手做的决定,记录一下为什么:

- **没有账号系统,身份按房间隔离,不跨房间**。每个房间的身份是"secret(存在浏览器 localStorage,永不广播)→ 服务端算出 hashId(SHA-256,单向,拿到 hashId 也反推不出 secret)"这套机制,不同房间的 secret 互不相关。想在另一台设备/浏览器继续用同一个身份,靠用户自己复制"身份恢复码"(其实就是那个 secret)手动带过去,不是账号登录。房间之间在业务层面(身份、消息)完全不打交道,只有 `RoomRegistry` 这种纯安全计数会跨房间共享。
- **同形异义字(IDN homograph)不做防御**。允许中日韩文字进房间名,理论上能拼出跟别的房间名视觉相似的字符串,但这个产品没有"官方认证房间"的概念,冒充了也就是把人带进另一个空房间,不构成钓鱼那种真实危害,所以没有为此增加复杂度。
- **消息不做端到端加密**,只是标准的 HTTPS/WSS 传输加密——服务器(Durable Object)能看到明文消息内容,这是做持久化/翻页/防滥用检测的前提。
- **私聊(悄悄话)不落盘**,纯实时中继,断线/离线就收不到,没有离线补发。公开聊天消息滚动保留最近 1000 条则是落盘的。
- **防滥用全部是自动化规则**(消息频率限制、同身份发言冷却、换身份限流封禁、新建房间限流),**没有人工举报/禁言机制**——这是已知的、刻意先不做的缺口,不是忘了。

## 尚未实现 / 刻意搁置

- 消息撤回/编辑(刻意不做)
- 举报/禁言机制、房间目录浏览、服务条款/社区准则(暂时搁置)
- 构想里的核心功能——LLM 自动从聊天析出帖子、结晶/结石/矿渣/化石分类与投票、生命周期管理——完全未开始
- CI/CD、staging 环境——**试过一次 staging,已经撤掉了**。方案是给 staging 一套独立的 Worker 脚本 + 独立域名(`staging.godot.chat` / `*.staging.godot.chat`),但这个产品的核心机制是"任意子域名自动建房",意味着 staging 也需要 `*.staging.godot.chat` 这种二级通配符——而 Cloudflare 免费的 Universal SSL 证书只覆盖"裸域名 + 一级通配符"(`godot.chat` + `*.godot.chat`),不覆盖 `*.staging.godot.chat` 这种二级通配符,会直接 `ERR_SSL_VERSION_OR_CIPHER_MISMATCH`。要解决得买 Advanced Certificate Manager(付费加订),或者把 staging 房间路由改成用路径而不是子域名(但那样就测不了这个产品最核心的子域名路由机制,失去了 staging 的意义)。评估下来风险/成本不划算,直接撤掉,以后谁想再试一次,先看这段。

## 版本历史

用 `git tag` 查看,从 `v0.1.0`(通配符子域名 + 基础聊天室)到当前 `v0.16.x`,每个 tag 对应一次功能性变更,tag 的 message 里有简要说明。
