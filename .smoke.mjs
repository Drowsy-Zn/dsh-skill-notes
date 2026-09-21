/* 宿主端离线冒烟测试。
 *
 * 跑法：node .smoke.mjs（不需要 DSH 在运行，也不写你的真实技能目录）。
 * 断言全部针对 .smoke-fixtures.mjs 造的临时固定数据，所以在任何机器上结果一致；
 * 真实的 ~/.dsh/skills 只做只读展示，不参与判定。
 */
import { createServer } from 'node:http'
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { EXPECT, findCordis, makeFixtures } from './.smoke-fixtures.mjs'

// DSH_HOME 必须在导入被测模块之前指向固定数据：src/index.js 在模块初始化时就把
// 备注文件路径算好了（真实进程里这是对的——DSH_HOME 是启动期就固定的）。
const fx = makeFixtures()
const realHome = process.env.DSH_HOME
process.env.DSH_HOME = fx.tmp

const { apply, inject, buildCatalog } = await import(new URL('./src/index.js', import.meta.url))

let bad = 0
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) bad += 1
  console.log(`${ok ? 'ok ' : 'BAD'} ${label}${ok ? '' : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`)
}

let cordisDir
try {
  console.log('inject =', JSON.stringify(inject))
  check('inject 声明了 webServer 与 systemPrompt', [...inject].sort(), ['systemPrompt', 'webServer'])

  // --- 固定数据上的目录构建 ------------------------------------------------
  const first = buildCatalog(fx.skillsDir, fx.notesPath)
  console.log('\n[固定数据] ok/total/annotated/unannotated/broken =',
    first.ok, first.total, first.annotated, first.unannotated, first.broken)
  console.log('[固定数据] added =', JSON.stringify(first.added))
  check('固定数据：ok', first.ok, true)
  check('固定数据：总数', first.total, EXPECT.total)
  check('固定数据：已备注数', first.annotated, EXPECT.total - EXPECT.unannotated)
  check('固定数据：未备注数', first.unannotated, EXPECT.unannotated)
  check('固定数据：自动登记了 brand', first.added, [EXPECT.unannotatedId])
  check('固定数据：备注文件不被判为坏', first.broken, false)

  const reparsed = JSON.parse(readFileSync(fx.notesPath, 'utf8'))
  check('固定数据：brand 已被写进备注文件且分类为未备注', reparsed[EXPECT.unannotatedId]?.cat, '未备注')
  check('固定数据：原条目未被改动', reparsed.xlsx,
    { cat: '文档表格', note: '处理 Excel、CSV 表格文件。', trig: '表格、Excel、CSV' })

  // 再跑一遍：这次没有新技能，added 必须为空（幂等）；brand 已在文件里，所以不再算未备注
  const second = buildCatalog(fx.skillsDir, fx.notesPath)
  check('固定数据：二次构建无新增', second.added, [])
  check('固定数据：二次构建后未备注归零', second.unannotated, 0)
  check('固定数据：两次构建的技能集合一致', second.items.map((i) => i.id), first.items.map((i) => i.id))
  check('固定数据：两次构建的分类一致', second.items.map((i) => i.cat), first.items.map((i) => i.cat))

  check('固定数据：manualOnly 只认 disable-model-invocation',
    first.items.filter((i) => i.manualOnly).map((i) => i.id), [EXPECT.manualOnly])
  check('固定数据：每项字段齐全',
    first.items.every((i) => typeof i.id === 'string' && i.id !== '' && typeof i.note === 'string' && typeof i.cat === 'string' && typeof i.trig === 'string' && typeof i.annotated === 'boolean'), true)
  check('固定数据：id 无重复', new Set(first.items.map((i) => i.id)).size, EXPECT.total)
  check('固定数据：分类去重后的集合',
    [...new Set(first.items.map((i) => i.cat))].sort(), [...EXPECT.categories, '未备注'].sort())

  // --- 降级路径 ------------------------------------------------------------
  const brokenPath = join(fx.tmp, 'broken.json')
  writeFileSync(brokenPath, '{ this is not json ]', 'utf8')
  const broken = buildCatalog(fx.skillsDir, brokenPath)
  check('坏 JSON 不抛错且仍列出技能', [broken.ok, broken.broken, broken.items.length], [true, true, EXPECT.total])

  const missingPath = join(fx.tmp, 'missing.json')
  const missing = buildCatalog(fx.skillsDir, missingPath)
  check('备注文件缺失时全部算未备注', [missing.ok, missing.broken, missing.unannotated], [true, false, EXPECT.total])
  check('备注文件缺失时写回文件', existsSync(missingPath), true)

  const noSkills = buildCatalog(join(fx.tmp, 'no-such-skills'), join(fx.tmp, 'x.json'))
  check('技能目录不存在时 ok=false 且带 error', [noSkills.ok, noSkills.items.length, typeof noSkills.error === 'string'], [false, 0, true])
  console.log('     error =', noSkills.error)

  // --- 真实环境：只读展示，不参与判定 --------------------------------------
  const realSkills = join(realHome ?? join(process.env.USERPROFILE ?? process.env.HOME ?? '', '.dsh'), 'skills')
  if (existsSync(realSkills)) {
    console.log('\n[本机真实技能目录 · 只读展示，不影响通过与否]')
    try {
      const notes = JSON.parse(readFileSync(join(realSkills, '..', 'skill-notes.json'), 'utf8'))
      const ids = readdirSync(realSkills).filter((n) => statSync(join(realSkills, n)).isDirectory() && !n.startsWith('.'))
      const annotated = ids.filter((id) => notes[id]).length
      console.log(`     技能 ${ids.length} 个，其中已备注 ${annotated} 个，未备注 ${ids.length - annotated} 个`)
      const un = ids.filter((id) => !notes[id])
      if (un.length > 0) console.log('     未备注：' + un.join(', '))
      const extra = Object.keys(notes).filter((k) => !ids.includes(k))
      if (extra.length > 0) console.log('     备注里多出的（技能已卸载）：' + extra.join(', '))
    } catch (err) {
      console.log('     读不到真实备注文件，跳过展示：' + (err && err.message))
    }
  } else {
    console.log('\n[本机没有 DSH_HOME/skills，跳过真实环境展示]')
  }

  // --- apply()：用假 webServer / systemPrompt 驱动 --------------------------
  cordisDir = findCordis()
  if (cordisDir === undefined) {
    console.log('\n[没找到 @deepseek-ai/cordis，跳过 apply() 一段]')
  } else {
    console.log('\n[cordis]', cordisDir)
    const require = process.getBuiltinModule('node:module').createRequire(join(cordisDir, 'noop.js'))
    const { Context } = require('@deepseek-ai/cordis')

    const routes = []
    let disposed = 0
    const ctx = new Context()
    ctx.provide('webServer', { register(route) { routes.push(route); return () => { disposed += 1 } } })
    const sections = []
    ctx.provide('systemPrompt', { section(desc) { sections.push(desc); return () => {} } })

    let applied = true
    try {
      apply(ctx)
    } catch (err) {
      applied = false
      console.log('apply() 抛异常：' + (err && err.stack ? err.stack.split('\n').slice(0, 8).join('\n') : err))
    }
    check('apply() 正常返回', applied, true)

    if (applied) {
      check('注册了 1 条路由', routes.length, 1)
      check('路由是 prefix /dsh-skill-notes', [routes[0]?.kind, routes[0]?.path], ['prefix', '/dsh-skill-notes'])
      check('注入 1 个 prompt 段', sections.length, 1)
      check('prompt 段名与顺序', [sections[0]?.name, sections[0]?.order], ['plugin:skill-notes', 150])
      check('prompt 段提到了备注文件', /skill-notes\.json/.test(String(sections[0]?.text ?? '')), true)

      // 经真 socket 打一次目录接口（被测模块已按固定数据里的 DSH_HOME 解析路径）
      const server = createServer((req, res) => routes[0].handler(req, res))
      await new Promise((r) => server.listen(0, '127.0.0.1', r))
      const port = server.address().port

      const response = await fetch(`http://127.0.0.1:${port}/dsh-skill-notes/catalog`)
      const data = await response.json()
      check('HTTP 200', response.status, 200)
      check('Content-Type', response.headers.get('content-type'), 'application/json; charset=utf-8')
      check('cache-control: no-store', response.headers.get('cache-control'), 'no-store')
      check('走 DSH_HOME 解析备注文件', data.notesPath, join(fx.tmp, 'skill-notes.json'))
      check('接口返回 ok', data.ok, true)
      check('接口返回的技能数', data.total, EXPECT.total)
      // 前面那轮已把 brand 自动登记进备注文件，所以这里的未备注必须是 0：
      // 恰好证明「登记过的不再重复报未备注」
      check('接口返回的未备注数', data.unannotated, 0)
      check('接口返回的 added 为空', data.added, [])

      for (const [probe, want] of [
        ['/dsh-skill-notes', 200],
        ['/dsh-skill-notes/', 200],
        ['/dsh-skill-notes/catalog', 200],
        ['/dsh-skill-notes/catalog?x=1', 200],
        ['/dsh-skill-notes/nope', 404],
        ['/dsh-skill-notes/catalog/../../etc/passwd', 404],
      ]) {
        const res2 = await fetch(`http://127.0.0.1:${port}${probe}`)
        check(`${probe} -> ${want}`, res2.status, want)
      }
      server.close()

      await ctx.fiber.dispose()
      check('卸载后路由已注销', disposed, 1)
    }
  }
} finally {
  fx.release()
  check('临时目录已清理', existsSync(fx.tmp), false)
  if (realHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = realHome
}

console.log(bad === 0 ? '\n宿主端冒烟测试全部通过' : `\n${bad} 项不符`)
process.exitCode = bad === 0 ? 0 : 1
