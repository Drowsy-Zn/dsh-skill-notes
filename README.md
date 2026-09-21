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

## 新技能会自动进来

插件每次打开面板都重新扫一遍 `$DSH_HOME/skills/`：

- 技能目录里有、备注文件里没有的 → **自动登记**，归到 `未备注` 分类
- 面板顶部显示 `有 N 个新技能还没有备注`
- 那条技能显示为灰色斜体，提示怎么补

所以**不会有技能被漏掉**。补备注有三种方式：

1. 在对话里直接说「给 xxx 加备注」——插件会往 system prompt 里注入备注文件的位置和格式，agent 直接改 JSON
2. 自己编辑 `skill-notes.json`
3. 等 agent 主动发现

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
npm run check   # node --check 两个入口文件
npm test        # 离线冒烟测试，不需要 DSH 在跑
```

`npm test` 跑两个自包含的脚本，用假的 `webServer` / `systemPrompt` / `slots` 服务把两半都点一遍：

- `.smoke.mjs` —— 宿主端：真实 cordis `Context` 上 apply、经真 socket 打路由、断言目录内容与路由筛查（非目录路径 404）、坏 JSON 与目录缺失的降级、以及卸载后路由确实注销
- `.smoke-client.mjs` —— 浏览器端：一个带真实 state 的 React 替身，走完「点开 → 拉目录 → 搜索 → 筛选分类 → 点行插入」整条链路，断言渲染出的按钮文案、行数、徽章，以及 `setDraft` 拿到的确切草稿字符串

两个脚本都不联网、不写你的技能目录，只读 `skill-notes.json` 和 `~/.dsh/skills`。仓库里的 GitHub Actions（`.github/workflows/check.yml`）在 Node 22 与 24 上各跑一遍这两步，外加 `npm pack --dry-run`。

## 发布流程备忘

打算上 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 精选列表——那才是插件市场里能搜到的唯一来源。要点：

- 往那个仓库提 PR，**只加一个文件** `data/plugins/<owner>__<repo>.yml`，别动 README（README 由他们的脚本生成）
- 他们的 CI 从本仓库 `package.json` 读 `dsh.bundle`，只声明 `dsh.client` 是最常见的被拒原因——本包两个都声明了
- 仓库需**创建满 1 天**才收（防「提 PR 前几分钟才建好」的仓库）
- 仓库加 GitHub topic `dsh-plugin`（与本包 keywords 里的一致）
- 描述必须属实，评审核对代码；`category` 挑最接近的即可

## 已知边界

- 面板位置绑定在 `conversation.input.left` 这个 slot；DSH 若改 slot 名需要跟着改
- `SKILL.md` 的解析是轻量 YAML 子集（只取 `name` / `description` / `disable-model-invocation`），不是完整 YAML 解析器
- 备注文件是 UTF-8 无 BOM 的 JSON；写坏了面板会提示 `备注文件解析失败` 并显示空列表（不会崩）

## License

MIT
