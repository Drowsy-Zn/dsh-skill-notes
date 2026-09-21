/**
 * 备注风格自检：把 NOTE_RULES 里写死的规则，真正套到现有的备注文件上跑一遍。
 * 跑法：node .check-notes.mjs   （只读，不改任何文件）
 *
 * 用途：规则写在提示词里只是「说法」，这个脚本让规则变成「能被违反、能被发现」的东西。
 * 用户新装了技能之后如果备注不合规，也能靠它找出来。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { NOTE_RULES } from './src/index.js'

const dshHome = process.env.DSH_HOME?.trim() || join(homedir(), '.dsh')
const skillsDir = join(dshHome, 'skills')
const notesPath = join(dshHome, 'skill-notes.json')

if (!existsSync(notesPath)) {
  console.log('没有备注文件：' + notesPath)
  process.exit(0)
}

const notes = JSON.parse(readFileSync(notesPath, 'utf8'))
const installed = readdirSync(skillsDir, { withFileTypes: true })
  .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
  .map((e) => e.name)

const problems = []
const complain = (id, what) => problems.push(`${id}：${what}`)

// NOTE_RULES 本身要说得清楚，规则自己不能有矛盾
if (!Array.isArray(NOTE_RULES.rules) || NOTE_RULES.rules.length === 0) complain('NOTE_RULES', '规则列表是空的')
if (!Array.isArray(NOTE_RULES.examples) || NOTE_RULES.examples.length === 0) {
  complain('NOTE_RULES', '没有可照抄的示例')
} else {
  for (const item of NOTE_RULES.examples) {
    for (const key of ['id', 'cat', 'note', 'trig']) {
      if (typeof item?.[key] !== 'string' || item[key].trim() === '') {
        complain('NOTE_RULES', `示例 ${JSON.stringify(item?.id)} 缺 ${key}`)
      }
    }
  }
}
if (typeof NOTE_RULES.fallbackCategory !== 'string' || NOTE_RULES.fallbackCategory !== '其他') {
  complain('NOTE_RULES', `兜底分类应为「其他」，实际是「${NOTE_RULES.fallbackCategory}」`)
}

const { minNoteLength, maxNoteLength, forbiddenTerms, minTrigTerms, maxCatLength, maxTrigTermLength } = NOTE_RULES.limits

for (const id of installed) {
  const entry = notes[id]
  if (entry === undefined) {
    complain(id, '没有备注（面板里会是灰色的「未备注」）')
    continue
  }
  const { cat, note, trig } = entry ?? {}

  if (typeof cat !== 'string' || cat.trim() === '') complain(id, 'cat 缺失或为空')
  else {
    if (cat === '未备注') complain(id, 'cat 还是占位值「未备注」')
    if (cat.length > maxCatLength) complain(id, `cat 太长（${cat.length} > ${maxCatLength} 字）`)
    if (/[A-Za-z]/.test(cat)) complain(id, `cat 里混了英文：${cat}`)
  }

  if (typeof note !== 'string' || note.trim() === '') {
    complain(id, 'note 缺失或为空')
    continue
  }
  if (note.length < minNoteLength) complain(id, `note 太短（${note.length} < ${minNoteLength} 字），可能说不清干什么`)
  if (note.length > maxNoteLength) complain(id, `note 太长（${note.length} > ${maxNoteLength} 字），面板一行放不下`)
  if (/^\(|^（/.test(note)) complain(id, 'note 看起来还是占位文案')
  for (const term of forbiddenTerms) {
    if (note.includes(term)) complain(id, `note 里出现内部术语「${term}」`)
  }
  if (/[,.;:!?]/.test(note) && !/[，。；：！？、]/.test(note)) complain(id, 'note 用了英文标点，不像大白话')

  if (typeof trig !== 'string' || trig.trim() === '') {
    complain(id, 'trig 缺失或为空')
    continue
  }
  const terms = trig.split(/[、,，\/|]/).map((t) => t.trim()).filter((t) => t !== '')
  if (terms.length < minTrigTerms) {
    complain(id, `trig 只有 ${terms.length} 个关键词，太少（< ${minTrigTerms}）`)
  } else if (terms.length < NOTE_RULES.limits.preferredTrigTerms) {
    console.log(`  · ${id}：trig 只有 ${terms.length} 个关键词，建议补到 ${NOTE_RULES.limits.preferredTrigTerms} 个（不算失败）`)
  }
  for (const term of terms) {
    if (term.length > maxTrigTermLength) complain(id, `trig 关键词太长：「${term}」`)
    // 关键词和 note 不重复是「首选」而非硬性：品牌名/工具名（Excel、PDF）两边都出现才是正常的
    else if (note.includes(term) && /^[A-Za-z0-9\s]+$/.test(term) === false && term.length >= 3) {
      console.log(`  · ${id}：trig 的「${term}」note 里已经提过，如果还有别的说法可以补上（不算失败）`)
    }
  }
  if (/当用户|用户说|例如|等等/.test(trig)) complain(id, 'trig 里写了句子，应该只写关键词')
}

const known = new Set(Object.keys(notes))
const extra = [...known].filter((k) => !installed.includes(k))

console.log(`备注文件：${notesPath}`)
console.log(`技能目录：${skillsDir}`)
console.log(`已装技能 ${installed.length} 个；备注条目 ${known.size} 条（其中 ${extra.length} 条是已卸载技能留下的，保留即可）`)
if (extra.length > 0) console.log('  已卸载但保留：' + extra.join(', '))
console.log('')

if (problems.length === 0) {
  console.log(`风格自检通过：${installed.length} 条备注全部符合 NOTE_RULES`)
} else {
  console.log(`风格自检发现 ${problems.length} 处不符：`)
  for (const p of problems) console.log('  - ' + p)
  process.exitCode = 1
}
