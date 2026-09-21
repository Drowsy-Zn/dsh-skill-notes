/* 两个冒烟脚本共用的固定测试数据。
 *
 * 为什么不用真实的 ~/.dsh/skills：CI 上没有那个目录，而且真实技能目录总会变，
 * 断言里的数字就得跟着改。这里在临时目录里造一份确定的小目录，断言稳定的数字；
 * 真实环境另有一块只读的提示（改动你的文件不是测试该做的事）。
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** SKILL.md 内容：覆盖带双引号、裸值、单引号、disable-model-invocation 四种写法。 */
const SKILLS = {
  xlsx: [
    '---',
    'name: xlsx',
    'description: "Read and write Excel and CSV files."',
    '---',
    '',
    '# xlsx',
  ].join('\n'),
  archify: [
    '---',
    'name: archify',
    'description: Draw architecture diagrams.',
    '---',
    '',
    '# archify',
  ].join('\n'),
  'task-brief': [
    '---',
    'name: task-brief',
    "description: 'Write a task brief before starting.'",
    'disable-model-invocation: true',
    '---',
    '',
    '# task-brief',
  ].join('\n'),
  brand: [
    '---',
    'name: brand',
    'description: Anthropic brand colors and fonts.',
    '---',
    '',
    '# brand',
  ].join('\n'),
}

/** 备注表：故意漏掉 brand，用来验证「新技能自动登记」。 */
const NOTES = {
  xlsx: { cat: '文档表格', note: '处理 Excel、CSV 表格文件。', trig: '表格、Excel、CSV' },
  archify: { cat: '作图', note: '画架构图、流程图。', trig: '架构图、流程图' },
  'task-brief': { cat: '写代码', note: '动手前先写任务简报。', trig: '任务简报' },
}

/** 断言里用到的确定性数字。 */
export const EXPECT = {
  total: 4,
  /** brand 没人备注，会被自动登记。 */
  unannotated: 1,
  unannotatedId: 'brand',
  /** 只有 task-brief 带 disable-model-invocation。 */
  manualOnly: 'task-brief',
  /** 分类胶囊：全部 + 三个分类，按数量降序。 */
  categories: ['文档表格', '作图', '写代码'],
}

/**
 * 建一份临时技能目录与备注文件。
 * @returns {{ skillsDir: string, notesPath: string, tmp: string, release: () => void }}
 */
export function makeFixtures() {
  const tmp = mkdtempSync(join(tmpdir(), 'dsh-skill-notes-fixture-'))
  const skillsDir = join(tmp, 'skills')
  mkdirSync(skillsDir, { recursive: true })
  for (const [id, text] of Object.entries(SKILLS)) {
    mkdirSync(join(skillsDir, id), { recursive: true })
    writeFileSync(join(skillsDir, id, 'SKILL.md'), text, 'utf8')
  }
  const notesPath = join(tmp, 'skill-notes.json')
  writeFileSync(notesPath, JSON.stringify(NOTES, null, 2) + '\n', 'utf8')
  return { skillsDir, notesPath, tmp, release: () => { rmSync(tmp, { recursive: true, force: true }) } }
}

/**
 * 找一份已安装的 @deepseek-ai/cordis（CI 的 node_modules、本机 npx 缓存等）。
 * 找不到就返回 undefined，调用方自己决定跳过还是失败。
 * @returns {string | undefined} 能 require 到 cordis 的 node_modules 路径
 */
export function findCordis() {
  const seen = new Set()
  /** @type {string[]} 先看包自己往上找，再看本机 npx 缓存（部署里 cordis 不一定在项目里） */
  const roots = [dirname(fileURLToPath(import.meta.url))]
  const npxCache = join(homedir(), 'AppData', 'Local', 'npm-cache', '_npx')
  if (existsSync(npxCache)) {
    roots.push(...readdirSync(npxCache).map((entry) => join(npxCache, entry)))
  }
  for (const root of roots) {
    for (const candidate of [join(root, 'node_modules'), join(root, '..', 'node_modules')]) {
      if (seen.has(candidate)) continue
      seen.add(candidate)
      if (existsSync(join(candidate, '@deepseek-ai', 'cordis', 'package.json'))) return candidate
    }
  }
  let dir = dirname(fileURLToPath(import.meta.url))
  for (let i = 0; i < 14; i += 1) {
    const candidate = join(dir, 'node_modules')
    if (!seen.has(candidate)) {
      seen.add(candidate)
      if (existsSync(join(candidate, '@deepseek-ai', 'cordis', 'package.json'))) return candidate
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return undefined
}
