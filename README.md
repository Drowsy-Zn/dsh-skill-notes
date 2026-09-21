# dsh-skill-notes · 技能速查

给 [DeepSeek Harness](https://github.com/deepseek-ai) Web GUI 加一个**技能速查面板**：在输入框工具行点一下，就能看到每个技能**用中文一句话说明是干什么的**，点任意一行直接把 `/技能名` 插进输入框。

DSH 官方的 `/` 补全和技能选择器都是**按技能名找**——你得先记住名字。这个插件解决的是另一半问题：**忘了有什么技能、不知道某个技能能干什么**。

## 它长什么样

- 输入框工具行左侧多一个 **`📖 技能速查`** 按钮
- 点开是一张卡片：搜索框 + 分类筛选 + 技能列表
- 每行 = **技能名** + **中文一句话说明** + **什么时候用（触发词）**
- 搜索支持技能名、中文说明、触发词
- 点任意一行 → `/技能名` 追加进输入框（不覆盖你已打的内容）
- 模型看不见的技能（`disable-model-invocation: true`）带一个橙色 `只能手动调用` 徽章

## 备注放在哪

**单独一个 JSON 文件**，不占用技能自带的 `description`：

```
$DSH_HOME/skill-notes.json      # 默认 ~/.dsh/skill-notes.json
```

```json
{
  "xlsx": {
    "cat": "文档表格",
    "note": "处理 Excel、CSV 表格文件。读写数据、算公式、做图表、整理乱的表格。",
    "trig": "表格、Excel、CSV、算公式"
  }
}
```

| 字段 | 作用 |
|---|---|
| `cat` | 分类，面板里做筛选胶囊。取 `未备注` 时表示还没写 |
| `note` | 一句话中文说明，给人看的 |
| `trig` | 什么时候用，写用户会说的词 |

### 为什么不用技能自己的 `description`

DSH 的技能目录**只把 `name` 和 `description` 渲染给模型**，用于「这条需求该不该加载这个技能」。它的长度直接计入每一步的上下文开销，所以应该为**模型路由**服务，而不是当人类可读的备注用。两者混在一起，改备注就会影响模型判断——这个插件把两件事分开。

## 新技能会自己补上备注，不用你操心

这是这个插件最省事的地方：**装完之后，你再装什么新技能，都不需要跟 AI 说「给它加个备注」。**

原理是：插件往系统提示里挂了一条**常驻提醒**——只要发现技能目录里有技能在备注文件里查不到，它就会在**模型看到的消息里**多出一段：

```
[技能速查] 有 2 个技能还没有中文备注，请在这条消息处理完之前先补上
（一次改完，正在处理的用户请求照常做完，不用让用户再说一遍，也不用问用户）：
foo → /Users/you/.dsh/skills/foo/SKILL.md
bar → /Users/you/.dsh/skills/bar/SKILL.md
按插件 dsh-skill-notes 的段落说明编辑 …
```

于是 AI 在回答你**本来就在问的那件事**的同时，顺手读一下这几个 `SKILL.md`，把中文备注补进 JSON，然后继续做正事。你从头到尾不用提这件事。

几个细节：

- **全部有备注时这段提醒是空的**，一个字符都不占。也就是说平时完全不影响上下文开销。
- **补完立刻消失**：提醒只在「还有缺的」时存在，AI 写完文件，下一轮就看不到了。
- **实时**：你新装一个技能，当前这轮对话里就会冒出来，不用重启。
- 面板顶部同时显示 `有 N 个新技能还没有备注`，新增的那几条排在列表最上面（灰色斜体，占位说明），你也能一眼看到进度。

所以**不会有技能被漏掉**。当然，你也可以自己动手：

1. 自己编辑 `skill-notes.json`
2. 直接跟 AI 说「给 xxx 加备注」
3. 什么都不做，等它自己发现

### 写法是预设好的，所以几十条备注看起来像一个人写的

插件里写死了一套**备注规则**（`NOTE_RULES`，在 `src/index.js` 里），并且把它整段渲染进系统提示——规则、正例、边界值都在里面，AI 不是「自由发挥写一句中文」，而是照着同一张模板填空：

- `note` 一句话、20~50 字、句号结尾，说清「用户拿它能干什么」，**不许出现「根因」「结构化」「生命周期」「枚举」这类内部术语**
- `cat` 2~4 个汉字，优先复用现有分类，不够用才新建
- `trig` 3~5 个「用户真会打在输入框里的词」，用「、」隔开，写用户会说的话而不是「当用户需要…」
- 还有两条现成的正例，AI 直接照抄句式

于是**不管是你手写、还是 AI 自动补的，格式全都一样**。想改风格只改一处：`NOTE_RULES` 里的 `rules` / `examples`，面板、提示、审计脚本会同时跟着变。

规则不只是「说法」——`npm run check:notes` 会拿同一份 `NOTE_RULES`（包括里面的 `limits` 数字）去逐条体检你的 `skill-notes.json`，把不合规的挑出来。本仓库的 34 条备注就是这么对齐的。

### 为什么不做成「插件自己调模型去写」

那样确实更彻底，但插件得内置一个模型 API key，等于**每个用这个插件的人都得配一套自己的 API**。现在的做法把这件事交给用户本来就在用的那个对话模型上：**没有任何额外配置、没有额外开销、不用联网**。

备注文件里已经卸载的技能的条目会**保留**，重新装上还在。

## 安装

```sh
# 从 GitHub 安装
dsh plugin --profile web add "git+https://github.com/Drowsy-Zn/dsh-skill-notes.git"

# 或在插件市场里搜索 dsh-skill-notes 点安装

# 从本地目录链接安装（开发/自用）
dsh plugin --profile web add link:/path/to/dsh-skill-notes
```

装完**重启 `dsh web`**（或刷新页面，取决于客户端模块是否已重新扫描）。之后它是正式插件，重启后常在，可在 GUI 的插件列表里看到。

> 包里声明了 `dsh.bundle.patch`（见 `cordis.patch.yml`），`dsh plugin add` 会自动把它加进 profile 的 `dsh.profile.bundles` 层列表——这就是「装一次就一直挂着」的机制。

### 卸载

```sh
dsh plugin --profile web remove dsh-skill-notes
```

## 结构

```
dsh-skill-notes/
├── package.json          # dsh.bundle.patch + dsh.client 两处声明
├── cordis.patch.yml      # 往 host 组合里插一行
├── src/index.js          # 宿主端：扫技能目录 + 读写备注 JSON + 路由 + prompt 段
└── client/bundle.js      # 浏览器端：__ModuleLoader__ 工厂，注册输入框按钮
```
- **宿主端**用真正的 Node 模块（`node:fs` / `node:os` / `node:path`），通过 `ctx.webServer.register` 暴露 `GET /dsh-skill-notes/catalog`
- **浏览器端**是 classic-script 工厂形式，`require('react')` 是唯一的平台种子依赖，因此**不需要打包工具**——改代码直接改这个文件
- 侧效应全部走 `ctx.effect`，卸载时自动清理

## 开发

```sh
npm run check        # node --check 两个入口文件
npm test             # 离线冒烟测试，不需要 DSH 在跑
npm run check:notes  # 按 NOTE_RULES 体检你本机的 skill-notes.json（只读）
```

`npm test` 跑两个自包含的脚本，用假的 `webServer` / `systemPrompt` / `slots` 服务把两半都点一遍（共 103 项断言）：

- `.smoke.mjs` —— 宿主端：真实 cordis `Context` 上 apply、经真 socket 打路由、断言目录内容与路由筛查（非目录路径 404）、坏 JSON 与目录缺失的降级、以及卸载后路由确实注销
- `.smoke.mjs` 还专门覆盖**自动补备注**这条链路：提示在有缺口时非空且点名技能与 `SKILL.md` 路径 → 把缺口写进 JSON → 下一次组装提示立刻变成空字符串（这段用 `statSync` 的签名做缓存，不依赖计时器，所以测试是确定性的）
- `.smoke.mjs` 还会核对 `NOTE_RULES` 与它自己的 `limits` 是否自洽（示例长度、关键词个数、禁用词），规则写歪了 CI 就会红
- `.smoke-client.mjs` —— 浏览器端：一个带真实 state 的 React 替身，走完「点开 → 拉目录 → 搜索 → 筛选分类 → 点行插入」整条链路，断言渲染出的按钮文案、行数、徽章，以及 `setDraft` 拿到的确切草稿字符串

两个脚本都**不联网、不写你的真实技能目录**：断言用的是 `.smoke-fixtures.mjs` 在临时目录里造的一份固定技能目录（4 个技能，其中一个故意没备注），所以数字在任何机器上都一样；你本机的 `~/.dsh/skills` 只在宿主端脚本里做只读展示，不影响通过与否。跑完临时目录会删掉。

找不到 `@deepseek-ai/cordis` 时宿主端脚本会跳过 `apply()` 那一段并明确打印出来，其余部分照跑。

仓库里的 GitHub Actions（`.github/workflows/check.yml`）在 Node 22 与 24 上各跑一遍这两步，外加 `npm pack --dry-run`。

## 已知边界

- 面板位置绑定在 `conversation.input.left` 这个 slot；DSH 若改 slot 名需要跟着改
- `SKILL.md` 的解析是轻量 YAML 子集（只取 `name` / `description` / `disable-model-invocation`），不是完整 YAML 解析器
- 备注文件是 UTF-8 无 BOM 的 JSON；写坏了面板会提示 `备注文件解析失败` 并显示空列表（不会崩）
- 「自动补备注」依赖用户正在使用的对话模型会照办系统提示里的要求。绝大多数模型都会，但这不是硬保证；面板上的灰色条目和顶部计数是兜底——真没人补的时候你看得见

## 开发笔记：这台机器怎么把代码传上来

写这个插件的过程中踩到一个坑，记下来免得下次再花两小时：**这台机器的 `git push` 走不通**。

```
$ git push
fatal: unable to access 'https://github.com/…': Failed to connect to github.com
port 443 after 21105 ms: Could not connect to server
```

但并不是网络坏了，只是 `github.com` 这一个域名的 443 端口连不上：

| 目标 | 结果 |
| --- | --- |
| `github.com:443`（git 用的就是它） | ✗ 超时 |
| `api.github.com` | ✓ 200 |
| `raw.githubusercontent.com` | ✓ 200 |
| `codeload.github.com` | ✓ 200 |
| `gh` 命令行工具 | ✗ 装了才有，本机没有 |

所以本仓库的提交不是 `git push` 上去的，而是走 GitHub 官方接口，按「**文件 → 目录树 → 提交 → 移动分支指针**」四步把对象传上去（`POST /git/blobs` → `POST /git/trees` → `POST /git/commits` → `PATCH /git/refs/heads/main`）。这条路走通之后，本地提交和远端提交的树是逐字节一致的，只是提交对象的作者/时间写法不同，所以 sha 不一样。

接口有三个脾气，谁要重写这段代码都会撞上：

- 文件必须先作为 blob 传上去，否则建目录树报 `422 tree.sha … is not a valid blob`
- **建树只能加和改，删不掉东西**：删文件必须显式写一条 `{ path, mode: '100644', type: 'blob', sha: null }`
- `base_tree` 得写**远端父提交记录的那棵树**，写本地 git 算出来的同一棵树会被拒：`base_tree is not a valid tree oid`
- 空仓库（刚建、一个提交都没有）访问接口返回的是 **409 `Git Repository is empty`，不是 404**

这一段流程已经整理成一个可复用的技能（`push-to-github`），带 `--check` / `--dry-run` / 推完自动对账，本仓库的改动就是用它推的。

顺手解决的另一个问题：提交对象是「照着本地能重建的样子」生成的（作者、提交者、日期都显式给全），所以加 `--sync-local` 时本地能自己把同一个提交拼出来、再把分支指针挪过去，**不需要 `git fetch`**（这台机器上它也跑不通）。结果就是本地、`origin/main`、远端三处的 sha 完全一致，`git status` 干净。

中间查得最久的一个坑：日期。给接口发带 `+08:00` 的日期，GitHub 存下来的提交里时间会是 `1790020592 +0000` —— **时区被它统一改成了 UTC**，于是本地按 `+0800` 拼出来的 sha 永远对不上（要看差别得 `git cat-file commit <sha>`）。现在脚本**直接按 UTC 发**，两边就一致了。另外提交正文末尾**必须有且只有一个换行**，少一个 sha 也会变。

### 对齐本地这一步，顺序错了会废掉仓库

`--sync-local` 的第一版是「拼出提交 → 挪指针」，漏了最关键的一步：**推送时那棵树是 GitHub 那边生成的，本地从来没有**。
指针一挪，HEAD 就指向一棵不存在的树，`git status` 直接报

```
error: bad tree object HEAD
```

而且想挪回去都做不到（`reset` 也要读那棵树）。正确的顺序是**先补齐、再挪指针**：

1. 缺树 → 照接口那份递归清单分层重建（`git mktree` **一次只肯建一层**，带斜杠的路径会被拒：`fatal: path .github/workflows/check.yml contains slash`）
2. 缺提交对象 → 原样拼一遍（`git hash-object -t commit -w`）
3. 补齐之后才动 `refs/heads`、`refs/remotes/origin`，接着 `git reset --mixed -q HEAD` 刷暂存区（不刷的话 `git status` 会把刚推的内容显示成待提交，状态是 `MM`）
4. 最后跑一次 `git status` 确认干净

真弄坏了能修：`repair-local.mjs <仓库目录>` 照远端的提交和递归清单，在本地把树和提交一层层重建出来再把指针挪回去。修完跑 `git fsck --no-progress` 确认没有 `missing` / `broken`。

重建提交时还有个容易读错字段的地方：提交对象里 author 和 committer 写的是同一个时间，**日期要用 `committer.date`**（用 `author.date` 会在某些情况下读到 undefined，报 `Cannot read properties of undefined (reading 'getTime')`）。

### 判断存在性：别用 `rev-parse`

`git rev-parse --verify --quiet <不存在的 sha>` **会把 sha 原样回显、退出码还是 0**。拿它当存在性判断会误判（踩过：以为树在，挪完指针直接 `bad tree object`）。要用 `git cat-file -e`（不存在时退出码 1）。

### 核验远端内容走 api，别走 raw

`raw.githubusercontent.com` 这段不稳（实测 node 的 `fetch` 报 `UND_ERR_CONNECT_TIMEOUT`）。核验远端文件用 `GET /repos/{repo}/contents/{path}`（返回 base64）。

### 在 pwsh 里干活的两个坑

- 写文件内容时，**pwsh 双引号字符串里的反引号是转义符**：`"…，\`repair-local.mjs\` 能…"` 会把 `\`r` 吃掉变成 `epair-local.mjs`，整行还会跟上一行粘在一起。要拼反引号用 `[char]96`。

## License

MIT
