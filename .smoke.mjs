import { createServer } from 'node:http'

const require = process.getBuiltinModule('node:module').createRequire('C:/Users/Nan/AppData/Local/npm-cache/_npx/1e7f6d9597241db0/node_modules/')
const { Context } = require('@deepseek-ai/cordis')

const { apply, inject, buildCatalog } = await import(new URL('./src/index.js', import.meta.url))
console.log('inject  =', JSON.stringify(inject))

// --- direct catalog unit checks -------------------------------------------
const direct = buildCatalog('C:/Users/Nan/.dsh/skills', 'C:/Users/Nan/.dsh/skill-notes.json')
console.log('buildCatalog ok/total/annotated/unannotated/broken =',
  direct.ok, direct.total, direct.annotated, direct.unannotated, direct.broken)
console.log('重复调用结果一致 =', JSON.stringify(buildCatalog('C:/Users/Nan/.dsh/skills', 'C:/Users/Nan/.dsh/skill-notes.json')) === JSON.stringify(direct))

// 坏备注文件：解析失败要优雅降级，不是抛异常
const { writeFileSync, mkdtempSync, rmSync } = await import('node:fs')
const { tmpdir } = await import('node:os')
const { join: pjoin } = await import('node:path')
const tmp = mkdtempSync(pjoin(tmpdir(), 'skn-'))
const brokenPath = pjoin(tmp, 'skill-notes.json')
writeFileSync(brokenPath, '{ this is not json ]', 'utf8')
const broken = buildCatalog('C:/Users/Nan/.dsh/skills', brokenPath)
console.log('坏备注文件不抛错 =', true, '| ok =', broken.ok, '| broken =', broken.broken, '| items 仍有', (broken.items || []).length, '条')
const missing = buildCatalog('C:/Users/Nan/.dsh/skills', pjoin(tmp, 'does-not-exist.json'))
console.log('备注文件缺失   =', 'ok =', missing.ok, '| broken =', missing.broken, '| unannotated =', missing.unannotated, '| 已写回文件 =', (await import('node:fs')).existsSync(pjoin(tmp, 'does-not-exist.json')))
const noSkills = buildCatalog(pjoin(tmp, 'no-such-skills'), pjoin(tmp, 'x.json'))
console.log('技能目录不存在 =', 'ok =', noSkills.ok, '| items =', (noSkills.items || []).length, '| error =', noSkills.error)
rmSync(tmp, { recursive: true, force: true })

const ctx = new Context()

// --- mock webServer -------------------------------------------------------
const routes = []
let disposed = 0
ctx.provide('webServer', {
  register(route) { routes.push(route); return () => { disposed += 1 } },
})
// --- mock systemPrompt ----------------------------------------------------
const sections = []
ctx.provide('systemPrompt', {
  section(desc) { sections.push(desc); return () => {} },
})

ctx.start?.()
try {
  apply(ctx)
  console.log('apply()  return: OK')
} catch (err) {
  console.log('apply()  THREW  :', err && err.stack ? err.stack.split('\n').slice(0, 6).join('\n') : err)
  process.exit(1)
}

console.log('routes   =', routes.length, routes.map((r) => r.kind + ' ' + r.path).join(' | '))
console.log('sections =', sections.length, sections.map((s) => s.name + '@' + s.order).join(' | '))
if (routes.length === 0) { console.log('!! 没有注册任何路由，无法请求'); process.exit(1) }

// --- drive the registered handler over a real socket ----------------------
const route = routes[0]
const server = createServer((req, res) => route.handler(req, res))
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const port = server.address().port
const response = await fetch(`http://127.0.0.1:${port}/dsh-skill-notes/catalog`)
const data = await response.json()

console.log('HTTP     =', response.status, response.headers.get('content-type'))
console.log('ok       =', data.ok, '| total =', data.total, '| annotated =', data.annotated, '| unannotated =', data.unannotated, '| added =', JSON.stringify(data.added))
console.log('notesPath=', data.notesPath)
console.log('broken   =', data.broken)
console.log('--- 前 3 条 ---')
for (const item of (data.items || []).slice(0, 3)) {
  console.log(`  ${item.id}  [${item.cat}]  manualOnly=${item.manualOnly}  annotated=${item.annotated}`)
  console.log(`     note: ${item.note}`)
  console.log(`     trig: ${item.trig}`)
}
const manual = (data.items || []).filter((i) => i.manualOnly).map((i) => i.id)
console.log('manualOnly 技能 =', JSON.stringify(manual))
const unannotated = (data.items || []).filter((i) => !i.annotated).map((i) => i.id)
console.log('未备注技能     =', JSON.stringify(unannotated))

let bad = 0
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) bad += 1
  console.log(`${ok ? 'ok ' : 'BAD'} ${label}${ok ? '' : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`)
}

check('HTTP 状态', response.status, 200)
check('Content-Type', response.headers.get('content-type'), 'application/json; charset=utf-8')
check('cache-control', response.headers.get('cache-control'), 'no-store')
check('ok 字段', data.ok, true)
check('总数 34', data.total, 34)
check('全部有备注', data.unannotated, 0)
check('备注文件完好', data.broken, false)
check('无新增', data.added, [])
check('notesPath 指向 DSH_HOME', data.notesPath, 'C:\\Users\\Nan\\.dsh\\skill-notes.json')
check('每项都有 id/note/cat/trig', (data.items || []).every((i) => typeof i.id === 'string' && i.id !== '' && typeof i.note === 'string' && typeof i.cat === 'string' && typeof i.trig === 'string'), true)
check('id 无重复', new Set((data.items || []).map((i) => i.id)).size, data.total)
check('manualOnly 只有 task-brief', (data.items || []).filter((i) => i.manualOnly).map((i) => i.id), ['task-brief'])
check('未备注项为 0', (data.items || []).filter((i) => !i.annotated).length, 0)

// --- 路由筛查：非目录路径不该拿到 200 -------------------------------------
const expectations = [
  ['/dsh-skill-notes', 200],
  ['/dsh-skill-notes/', 200],
  ['/dsh-skill-notes/catalog', 200],
  ['/dsh-skill-notes/catalog?x=1', 200],
  ['/dsh-skill-notes/nope', 404],
  ['/dsh-skill-notes/catalog/../../etc/passwd', 404],
]
for (const [probe, want] of expectations) {
  const res2 = await fetch(`http://127.0.0.1:${port}${probe}`)
  check(`${probe} -> ${want}`, res2.status, want)
}
server.close()

// --- 卸载必须清干净 -------------------------------------------------------
ctx.dispose?.()
await ctx.fiber.dispose()
check('dispose 后路由已注销', disposed, 1)

console.log(bad === 0 ? '\n宿主端冒烟测试全部通过' : `\n${bad} 项不符`)
process.exitCode = bad === 0 ? 0 : 1
