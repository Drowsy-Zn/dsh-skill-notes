/**
 * dsh-skill-notes — host half.
 *
 * Reads the DSH user skills directory (`$DSH_HOME/skills`, default
 * `~/.dsh/skills`), pairs each skill's frontmatter name with a one-line
 * Chinese note kept in a plain JSON file next to the skills directory
 * (`<dshHome>/skill-notes.json`), and serves the merged catalog over a small
 * route (`/dsh-skill-notes/catalog`) for the browser half.
 *
 * Design notes:
 *
 *  - The notes file is the single source of truth for the Chinese text. A
 *    skill that has no entry is registered automatically as "not annotated"
 *    and appears in the panel as a to-do, so a newly installed skill can
 *    never be silently missing from the list.
 *
 *  - Notes are written by the *agent*, never guessed here. While any skill is
 *    unannotated this plugin asks the agent, once per turn, to fill the gaps;
 *    the notice carries the skill names and their paths and nothing else, so
 *    the turn it is already annotated it costs zero prompt tokens.
 *
 *  - Nothing is written into the skills directory. `SKILL.md` frontmatter is
 *    read-only here: its `description` belongs to the model catalog used for
 *    skill routing, and must not be repurposed as a human-facing note.
 *
 * @module dsh-skill-notes
 */

import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Required services: the route registry and the prompt registries. */
export const inject = ['webServer', 'systemPrompt']

/** Section order within the tool-guidance band. */
const SECTION_ORDER = 150

/** Order of the completion notice, just after the tool-guidance band. */
const NOTICE_ORDER = 210

/** Category used for a skill the notes file does not know yet. */
const TODO_CATEGORY = '未备注'

/**
 * The single source of truth for how a note must read.
 *
 * This object is what keeps 34 hand-written and 34 later agent-written notes
 * looking like one person wrote them: the static prompt section renders it, the
 * completion notice points at it, and `.check-notes.mjs` audits the notes file
 * against it, so the rules are checkable rather than merely advisory.
 */
export const NOTE_RULES = {
  fallbackCategory: '其他',
  structure: '{ "技能名": { "cat": "分类", "note": "一句话说明", "trig": "什么时候用（关键词）" } }',
  rules: [
    '三个字段都要写；技能名必须和 SKILL.md 里的 name 完全一致（大小写、连字符都一样）。',
    'note：只有一句话、说清「用户拿它能干什么」，20~50 个汉字，句号结尾。别复述技能名，别抄英文原文的句子。',
    'note：用用户能懂的大白话。禁止出现「根因」「结构化」「生命周期」「枚举」「编排」「幂等」「抽象」「范式」这类内部术语。',
    'cat：2~4 个汉字，优先复用已有分类：文档表格、作图、做网页、写代码、换风格、分工角色、其他。都不贴切才新建，新分类也要同样短。',
    'trig：3~5 个「用户真会打在输入框里的词」，用中文顿号「、」隔开。写用户会说的话（风格名、工具名、文件名、口语动词），不要写「当用户需要…」这种句子。',
    'trig 要补上 note 里没提到的说法：note 里出现过的技术名词，用户未必照着说，所以 trig 至少要有一个别的说法（口语动词、同义词、使用场景）。',
    '拿不准就写得朴素一点。宁可少写一个关键词，也不要编一个用户根本不会说的词。',
  ],
  examples: [
    {
      id: 'xlsx',
      cat: '文档表格',
      note: '处理 Excel、CSV 表格文件。读写数据、算公式、做图表、整理乱的表格。',
      trig: '表格、Excel、CSV、算公式',
    },
    {
      id: 'root-cause-debug',
      cat: '写代码',
      note: '看这个 bug 到底为什么出的，找出真正的原因，而不是先改表面的症状。',
      trig: '为什么出错、报错、查原因、到底哪儿有问题',
    },
  ],
  limits: {
    minNoteLength: 8,
    maxNoteLength: 60,
    maxCatLength: 4,
    minTrigTerms: 2,
    preferredTrigTerms: 3,
    maxTrigTermLength: 16,
    forbiddenTerms: ['根因', '结构化', '生命周期', '枚举', '编排', '幂等', '范式', '抽象', '链路'],
  },
}

/** Render NOTE_RULES as the text of the static prompt section. */
export function renderRules(notesPath) {
  const samples = NOTE_RULES.examples
    .map((item) => `  ${JSON.stringify(item, null, 2).split('\n').join('\n  ')}`)
    .join(',\n')
  return [
    `本机装了插件 dsh-skill-notes（Web GUI 输入框工具行的「技能速查」按钮，点开是全部技能的中文速查面板）。`,
    `每个技能的中文备注存在 ${notesPath}，格式为 ${NOTE_RULES.structure}。`,
    `用户说「给 xxx 加备注」「xxx 是干什么的」，或新装了技能需要补备注时，直接编辑这个 JSON 即可，不需改插件代码。`,
    `写备注必须守同一套规则，这样全部技能读起来才像一个人写的：`,
    ...NOTE_RULES.rules.map((rule) => `- ${rule}`),
    `照这两个条目抄写法（cat / note / trig 都要有）：`,
    `${samples}`,
    `分类实在没有合适的就用「${NOTE_RULES.fallbackCategory}」。`,
    `没备注的技能在面板里是灰色的「${TODO_CATEGORY}」，补齐后自动变成正常条目。`,
  ].join('\n')
}

/** Resolve the DSH home, mirroring @deepseek-ai/dsh-home-paths precedence. */
function resolveDshHome() {
  const configured = process.env.DSH_HOME
  if (typeof configured === 'string' && configured.trim().length > 0) return configured.trim()
  return join(homedir(), '.dsh')
}

/** Parse the leading YAML frontmatter block of a SKILL.md into a flat map. */
function parseFrontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  if (match === null) return null
  const out = {}
  for (const line of match[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_-]+):[ \t]*(.*)$/.exec(line)
    if (kv === null) continue
    let value = kv[2].trim()
    if (value.length >= 2) {
      const first = value.charAt(0)
      const last = value.charAt(value.length - 1)
      if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
        value = value.slice(1, -1)
      }
    }
    if (value !== '') out[kv[1]] = value
  }
  return out
}

/** Read the notes file; never throws. Reports a malformed file instead. */
function readNotes(path) {
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return { table: {}, broken: false, missing: true }
  }
  try {
    const parsed = JSON.parse(text)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { table: {}, broken: true, missing: false }
    }
    return { table: parsed, broken: false, missing: false }
  } catch {
    return { table: {}, broken: true, missing: false }
  }
}

/** True when a notes-file entry is a usable annotation object. */
function isNoteEntry(entry) {
  return entry !== null && typeof entry === 'object' && !Array.isArray(entry)
}

/**
 * Walk the skills directory and merge each skill with its note.
 *
 * A skill with no usable entry is registered as an unannotated placeholder and
 * reported in `unannotated` / `pending`, which is what the prompt notice and
 * the panel to-do count are built from.
 */
export function buildCatalog(skillsDir, notesPath) {
  let names
  try {
    names = readdirSync(skillsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => entry.name)
      .sort()
  } catch (error) {
    return { ok: false, error: `读取技能目录失败：${String(error?.message ?? error)}`, items: [] }
  }

  const notes = readNotes(notesPath)
  const table = notes.table
  const items = []
  const pending = []

  for (const name of names) {
    let raw
    try {
      raw = readFileSync(join(skillsDir, name, 'SKILL.md'), 'utf8')
    } catch {
      continue
    }
    const meta = parseFrontmatter(raw)
    if (meta === null || meta.description === undefined) continue
    const id = meta.name !== undefined ? meta.name : name

    const existing = Object.hasOwn(table, id) ? table[id] : null
    let entry = existing
    const annotated = isNoteEntry(entry)
    if (!annotated) {
      entry = {
        cat: TODO_CATEGORY,
        note: `（还没有中文备注 —— 在对话里说“给 ${id} 加备注”即可补上）`,
        trig: '',
      }
      table[id] = entry
      pending.push({ id, path: join(skillsDir, name, 'SKILL.md') })
    }

    const flag = meta['disable-model-invocation']
    items.push({
      id,
      note: typeof entry.note === 'string' ? entry.note : '(备注格式不对)',
      cat: typeof entry.cat === 'string' && entry.cat.length > 0 ? entry.cat : TODO_CATEGORY,
      trig: typeof entry.trig === 'string' ? entry.trig : '',
      annotated,
      manualOnly: flag === 'true' || flag === 'yes',
    })
  }

  // Persist only when the file was absent (cold start), so a hand-edited file
  // is never rewritten merely because a placeholder was built in memory.
  if (notes.missing) {
    try {
      writeFileSync(notesPath, `${JSON.stringify(table, null, 2)}\n`, 'utf8')
    } catch (error) {
      console.warn(`[dsh-skill-notes] 写入备注文件失败：${String(error?.message ?? error)}`)
    }
  }

  return {
    ok: true,
    items,
    total: items.length,
    annotated: items.length - pending.length,
    unannotated: pending.length,
    pending,
    notesPath,
    broken: notes.broken,
  }
}

/** Mount the catalog route and the two prompt registries. */
export function apply(ctx) {
  const dshHome = resolveDshHome()
  const skillsDir = join(dshHome, 'skills')
  const notesPath = join(dshHome, 'skill-notes.json')

  ctx.effect(() => {
    const handler = (req, res) => {
      // `kind: 'prefix'` hands us every URL under this mount, so screen out
      // anything that is not the catalog route instead of answering 200 to it.
      const pathname = new URL(req.url ?? '/', 'http://localhost').pathname.replace(/\/+$/, '')
      if (pathname !== '/dsh-skill-notes' && pathname !== '/dsh-skill-notes/catalog') {
        res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ ok: false, error: 'not found: ' + pathname, items: [] }))
        return
      }
      try {
        const catalog = buildCatalog(skillsDir, notesPath)
        res.writeHead(catalog.ok ? 200 : 500, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
        })
        res.end(JSON.stringify(catalog))
      } catch (error) {
        res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ ok: false, error: String(error?.message ?? error), items: [] }))
      }
    }
    return ctx.webServer.register({ kind: 'prefix', path: '/dsh-skill-notes', handler })
  }, 'dsh-skill-notes: routes')

  ctx.effect(() => ctx.systemPrompt.section({
    name: 'plugin:skill-notes',
    order: SECTION_ORDER,
    text: renderRules(notesPath),
  }), 'dsh-skill-notes: prompt section')

  ctx.effect(() => ctx.systemPrompt.context({
    name: 'plugin:skill-notes:pending',
    order: NOTICE_ORDER,
    text: makeNoticeProvider(skillsDir, notesPath),
  }), 'dsh-skill-notes: pending notice')
}

/**
 * Build the dynamic notice. Returns the empty string — which contributes
 * nothing — unless a skill genuinely has no note, so the happy path is free.
 */
function makeNoticeProvider(skillsDir, notesPath) {
  let cache = null

  return () => {
    // Cache key = the two things the answer depends on: the skills directory
    // listing and the notes file. Two statSync calls per assembly keep the
    // notice accurate without walking every SKILL.md on every model step, and
    // an edit to either one invalidates it immediately — no clock involved.
    const signature = signatureOf(skillsDir, notesPath)
    if (cache !== null && cache.signature === signature) return cache.text
    let text = ''
    try {
      const catalog = buildCatalog(skillsDir, notesPath)
      if (catalog.ok) text = renderNotice(catalog.pending, notesPath)
    } catch {
      text = ''
    }
    cache = { signature, text }
    return text
  }
}

/** A cheap change signature for the skills directory plus the notes file. */
function signatureOf(skillsDir, notesPath) {
  const stamp = (path) => {
    try {
      const info = statSync(path)
      return `${info.mtimeMs}:${info.size}`
    } catch {
      return '-'
    }
  }
  return `${stamp(skillsDir)}|${stamp(notesPath)}`
}

/** Render the completion notice and return '' when every skill is annotated. */
function renderNotice(pending, notesPath) {
  if (pending.length === 0) return ''
  const list = pending.map((item) => `${item.id} → ${item.path}`).join('\n')
  return [
    `[技能速查] 有 ${pending.length} 个技能还没有中文备注，请在这条消息处理完之前先补上。`,
    `正在处理的用户请求照常做完，不用让用户再说一遍，也不用问用户，你自己顺手做完就行。`,
    list,
    `按插件 dsh-skill-notes 的段落里的规则编辑 ${notesPath}：缺哪个补哪个，已备注的不要动，三个字段都写，写法照抄那里的示例，别再用「${TODO_CATEGORY}」这个分类。`,
    `补完这一轮之后的对话就不会再看到这条提示。`,
  ].join('\n')
}
