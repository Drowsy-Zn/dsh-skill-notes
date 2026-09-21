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
 *  - Nothing is written into the skills directory. `SKILL.md` frontmatter is
 *    read-only here: its `description` belongs to the model catalog used for
 *    skill routing, and must not be repurposed as a human-facing note.
 *
 *  - A system-prompt section tells the agent where the notes file is, so a
 *    user can just ask "add a note for <skill>" in conversation instead of
 *    editing JSON by hand.
 *
 * @module dsh-skill-notes
 */

import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Required services: the route registry and the prompt band. */
export const inject = ['webServer', 'systemPrompt']

/** Section order within the tool-guidance band. */
const SECTION_ORDER = 150

/** Category used for a skill the notes file does not know yet. */
const TODO_CATEGORY = '未备注'

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

/** Walk the skills directory and merge each skill with its note. */
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
  const added = []

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

    let entry = Object.hasOwn(table, id) ? table[id] : null
    let annotated = true
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      entry = {
        cat: TODO_CATEGORY,
        note: `（已自动加入，还没有中文备注 —— 在对话里说“给 ${id} 加备注”即可补上）`,
        trig: '',
      }
      table[id] = entry
      added.push(id)
      annotated = false
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

  // Persist only when the file was absent or genuinely gained entries, so a
  // hand-edited file is never rewritten on a plain read.
  if (added.length > 0 || notes.missing) {
    try {
      writeFileSync(notesPath, `${JSON.stringify(table, null, 2)}\n`, 'utf8')
    } catch (error) {
      console.warn(`[dsh-skill-notes] 写入备注文件失败：${String(error?.message ?? error)}`)
    }
  }

  const unannotated = items.filter((item) => !item.annotated).length
  return {
    ok: true,
    items,
    total: items.length,
    annotated: items.length - unannotated,
    unannotated,
    notesPath,
    broken: notes.broken,
    added,
  }
}

/** Mount the catalog route and the prompt section. */
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
    text: `本机装了插件 dsh-skill-notes（Web GUI 输入框工具行的「技能速查」按钮）。它把每个技能的中文备注存在 ${notesPath}，格式为 { "技能名": { "cat": "分类", "note": "一句话说明", "trig": "什么时候用（关键词）" } }。用户说「给 xxx 加备注」「xxx 是干什么的」，或新装了技能需要补备注时，直接编辑这个 JSON 即可，不需改插件代码。写备注用大白话：note 说明它干什么（不要用内部术语），trig 写用户会说的触发词。`,
  }), 'dsh-skill-notes: prompt section')
}
