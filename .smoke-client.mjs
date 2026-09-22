/* Offline smoke test for the browser half.
 *
 * react-dom is not shipped with the deployment, so this file provides a small
 * stateful React look-alike: state lives in a WeakMap keyed by the component
 * element object (which is stable across re-renders), and createElement builds
 * ordinary elements. That is enough to drive the button through a real
 * open -> load -> filter -> pick cycle and read the markup plus the setDraft
 * calls it made.
 */
import { existsSync, readFileSync } from 'node:fs'

import { EXPECT, makeFixtures } from './.smoke-fixtures.mjs'

const states = new WeakMap()
let current = null

const React = {
  createElement(type, props, ...children) {
    return { type, props: { ...(props ?? {}), children: children.length > 1 ? children : children[0] } }
  },
  useState(initial) {
    if (current === null) return [typeof initial === 'function' ? initial() : initial, () => {}]
    let slot = states.get(current)
    if (slot === undefined) { slot = []; states.set(current, slot) }
    const i = current.__cursor++
    if (!(i in slot)) slot[i] = typeof initial === 'function' ? initial() : initial
    const set = (next) => { slot[i] = typeof next === 'function' ? next(slot[i]) : next }
    return [slot[i], set]
  },
  useEffect() {},
  useMemo(fn) { return fn() },
  useRef(v) { return { current: v } },
  isValidElement: (e) => e !== null && typeof e === 'object' && 'type' in e && 'props' in e,
  Fragment: Symbol('Fragment'),
}

/* Render one element node. All rendered (non-component) elements end up in out. */
function walk(node, out) {
  if (node === null || node === undefined || typeof node === 'boolean') return
  if (Array.isArray(node)) { for (const child of node) walk(child, out); return }
  if (typeof node === 'object' && node.type === React.Fragment) { walk(node.props.children, out); return }
  if (typeof node === 'object' && typeof node.type === 'function') {
    const saved = current
    current = node
    const previous = node.__cursor ?? 0
    node.__cursor = 0
    const tree = node.type(node.props)
    node.__cursor = previous
    current = saved
    walk(tree, out)
    return
  }
  if (typeof node === 'object') { out.push(node); walk(node.props?.children, out) }
}

function tree() {
  const out = []
  walk(button, out)
  return out
}
function textOf(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (typeof node.type === 'function') return textOf(node.type(node.props))
  return textOf(node.props?.children)
}
const findAll = (pred) => tree().filter(pred)
const find = (pred) => tree().find(pred)
const cls = (e) => String(e?.props?.className ?? '')

// --- fetch shim answering the catalog route --------------------------------
// 目录内容来自临时固定数据，跟宿主端用同一份，所以这里的行数、分类数都是定值。
const fx = makeFixtures()
const notes = JSON.parse(readFileSync(fx.notesPath, 'utf8'))
const { readdirSync, statSync } = await import('node:fs')
const { join } = await import('node:path')
const items = readdirSync(fx.skillsDir)
  .filter((n) => statSync(join(fx.skillsDir, n)).isDirectory() && !n.startsWith('.'))
  .map((id) => ({
    id,
    cat: notes[id]?.cat ?? '未备注',
    note: notes[id]?.note ?? '（还没备注）',
    trig: notes[id]?.trig ?? '',
    annotated: Boolean(notes[id]),
    manualOnly: id === 'task-brief',
  }))
const catalog = {
  ok: true, items, total: items.length,
  annotated: items.filter((i) => i.annotated).length,
  unannotated: items.filter((i) => !i.annotated).length,
  added: [], broken: false, notesPath: fx.notesPath,
}
const fetched = []
globalThis.fetch = async (url) => {
  fetched.push(url)
  return { status: 200, json: async () => catalog }
}

// --- load the bundle ------------------------------------------------------
let registered = null
globalThis.window = {
  __ModuleLoader__: {
    load({ id, factory }) {
      registered = { id, exports: factory((name) => { if (name === 'react') return React; throw new Error('unexpected require: ' + name) }) }
    },
  },
}
const appended = []
const htmlAttributes = {}
globalThis.document = {
  createElement: () => ({ setAttribute() {}, remove() { this.removed = true }, style: {}, textContent: '' }),
  head: { appendChild(node) { appended.push(node) } },
  documentElement: { setAttribute(name, value) { htmlAttributes[name] = value } },
}
await import(new URL('./client/bundle.js', import.meta.url))

let failures = 0
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (!ok) failures += 1
  console.log(`${ok ? 'ok ' : 'BAD'} ${label}${ok ? '' : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`)
}

check('模块 id', registered.id, 'dsh-skill-notes')
// The shell mounts this half as a cordis plugin, and cordis delivers a service
// only to a plugin that declares it — so the declared surface is load-bearing,
// not cosmetic. Dropping 'slots' here is what made the control invisible.
check('导出面', Object.keys(registered.exports), ['inject', 'apply'])
check('声明了 slots 依赖', registered.exports.inject, ['slots'])
check('apply 是函数', typeof registered.exports.apply, 'function')

// --- mount through the real slot contract ---------------------------------
const injected = {}
const slots = {
  inject(key, factory) { injected.key = key; injected.dispose = factory() },
  register(options, render) { injected.options = options; injected.render = render; return () => {} },
}
const ctx = { get: (n) => (n === 'slots' ? slots : undefined), effect: (fn) => fn() }
registered.exports.apply(ctx)

check('slot key', injected.key, 'conversation.input.left')
check('注册 id', injected.options.id, 'skill-notes')
check('注册 order', injected.options.order, 45)
check('样式已插入 head', appended.length, 1)

const actions = { calls: [], setDraft(text) { this.calls.push(text) } }
const props = { inputActions: actions, input: { draft: '' }, session: null }
const rendered = injected.render(props)
const button = rendered
check('slot 渲染出组件', typeof button.type, 'function')

const buttonNode = find((e) => e.type === 'button' && textOf(e) === '📖 技能速查')
check('工具行按钮', Boolean(buttonNode), true)
check('按钮 title 非空', typeof buttonNode?.props.title === 'string' && buttonNode.props.title.length > 0, true)
check('未打开时不渲染面板', findAll((e) => cls(e).includes('skn-backdrop')).length, 0)

// click -> open + async load
buttonNode.props.onClick()
await new Promise((r) => setTimeout(r, 20))
check('fetch 了目录接口', fetched, ['/dsh-skill-notes/catalog'])
const backdrop = find((e) => cls(e).includes('skn-backdrop'))
check('打开后面板出现', Boolean(backdrop), true)

const panel = find((e) => cls(e).includes('skn-panel'))
const panelText = () => textOf(find((e) => cls(e).includes('skn-panel')))
check('面板含技能名', ['xlsx', 'archify', 'task-brief'].map((id) => panelText().includes(id)), [true, true, true])
check('面板含中文备注', panelText().includes('处理 Excel') || panelText().includes('Excel'), true)
check('只能手动调用徽章', panelText().includes('只能手动调用'), true)
check('计数文案', panelText().includes('共 ' + EXPECT.total + ' 个技能'), true)
check('可点行数', findAll((e) => cls(e).includes('skn-item')).length, EXPECT.total)
const chips = findAll((e) => e.type === 'button' && cls(e).includes('skn-chip')).map(textOf)
check('分类胶囊集合',
  chips.map((c) => c.replace(/ \d+$/, '')).sort(),
  ['全部', ...EXPECT.categories, '未备注'].sort())
check('「全部」胶囊计数', chips.filter((c) => c === '全部 ' + EXPECT.total), ['全部 ' + EXPECT.total])

// search — first child of a row is the id cell, so read that
const search = () => find((e) => e.type === 'input' && cls(e).includes('skn-search'))
check('搜索框有 placeholder', typeof search().props.placeholder === 'string', true)
const rowIds = () => findAll((e) => cls(e).includes('skn-item')).map((e) => textOf(e.props.children[0]))
search().props.onChange({ target: { value: '处理 Excel' } })
check('搜中文备注命中', rowIds(), ['xlsx'])
check('搜命中时只剩 1 行', findAll((e) => cls(e).includes('skn-item')).length, 1)
search().props.onChange({ target: { value: '流程图' } })
check('搜触发词命中', rowIds().includes('archify'), true)
search().props.onChange({ target: { value: 'XLSX' } })
check('搜大写技能名命中', rowIds(), ['xlsx'])
search().props.onChange({ target: { value: '不存在的技能zzz' } })
check('搜不存在的词 → 空提示', findAll((e) => cls(e).includes('skn-item')).length, 0)
check('空提示文案', findAll((e) => cls(e).includes('skn-empty')).map(textOf), ['没有匹配的技能'])
search().props.onChange({ target: { value: '' } })

// category chip
const chipNamed = (prefix) => find((e) => e.type === 'button' && cls(e).includes('skn-chip') && textOf(e).startsWith(prefix))
check('「全部」胶囊', textOf(chipNamed('全部')), '全部 ' + EXPECT.total)
check('「作图」胶囊', textOf(chipNamed('作图')), '作图 1')
chipNamed('作图').props.onClick()
check('筛「作图」后行数', findAll((e) => cls(e).includes('skn-item')).length, 1)
chipNamed('全部').props.onClick()
check('回到全部行数', findAll((e) => cls(e).includes('skn-item')).length, EXPECT.total)

// pick a row: empty draft -> no leading space
actions.calls.length = 0
findAll((e) => cls(e).includes('skn-item')).find((e) => textOf(e).startsWith('archify')).props.onClick()
check('空草稿 setDraft', actions.calls, ['/archify'])
check('点击后面板关闭', findAll((e) => cls(e).includes('skn-backdrop')).length, 0)

// pick with a non-empty draft -> append with a space
const inst2Props = { inputActions: actions, input: { draft: '帮我看看' }, session: null }
const button2 = injected.render(inst2Props)
find((e) => e.type === 'button' && textOf(e) === '📖 技能速查') ?? null
const query2 = () => {
  const out = []
  walk(button2, out)
  return out
}
const btn2 = query2().find((e) => e.type === 'button' && textOf(e) === '📖 技能速查')
btn2.props.onClick()
await new Promise((r) => setTimeout(r, 20))
const search2 = query2().find((e) => e.type === 'input' && cls(e).includes('skn-search'))
search2.props.onChange({ target: { value: 'xlsx' } })
const row2 = query2().find((e) => cls(e).includes('skn-item'))
check('带草稿点击的目标', textOf(row2.props.children[0]), 'xlsx')
actions.calls.length = 0
row2.props.onClick()
check('非空草稿 setDraft 用空格拼接', actions.calls, ['帮我看看 /xlsx'])

// trailing space in draft -> no double space
const inst3Props = { inputActions: actions, input: { draft: '帮我看看 ' }, session: null }
const button3 = injected.render(inst3Props)
const out3 = []
walk(button3, out3)
out3.find((e) => e.type === 'button' && textOf(e) === '📖 技能速查').props.onClick()
await new Promise((r) => setTimeout(r, 20))
out3.length = 0
walk(button3, out3)
out3.find((e) => e.type === 'input' && cls(e).includes('skn-search')).props.onChange({ target: { value: 'xlsx' } })
out3.length = 0
walk(button3, out3)
actions.calls.length = 0
out3.find((e) => cls(e).includes('skn-item')).props.onClick()
check('草稿已带尾空格不再加', actions.calls, ['帮我看看 /xlsx'])

// inputActions missing entirely -> must not throw
const inst4Props = { input: undefined, inputActions: undefined, session: null }
const button4 = injected.render(inst4Props)
const out4 = []
walk(button4, out4)
out4.find((e) => e.type === 'button' && textOf(e) === '📖 技能速查').props.onClick()
await new Promise((r) => setTimeout(r, 20))
out4.length = 0
walk(button4, out4)
let threw = null
try { out4.find((e) => cls(e).includes('skn-item')).props.onClick() } catch (err) { threw = String(err && err.message) }
check('缺 inputActions 不抛错', threw, null)
out4.length = 0
walk(button4, out4)
check('缺 inputActions 仍关闭面板', out4.filter((e) => cls(e).includes('skn-backdrop')).length, 0)

// slots service absent -> apply must not throw, and must leave a visible trace
let threw2 = null
try { registered.exports.apply({ get: () => undefined, effect: (fn) => fn() }) } catch (err) { threw2 = String(err && err.message) }
check('缺 slots 服务不抛错', threw2, null)
check('缺 slots 服务留下可见痕迹', htmlAttributes['data-dsh-skill-notes-error'], 'slots-missing')
check('挂载成功时留下面包屑', htmlAttributes['data-dsh-skill-notes-ready'], '1')

// --- 有一个技能还没备注时：顶部提示 + 灰斜体占位 ----------------------------
const unannotatedCatalog = {
  ...catalog,
  unannotated: EXPECT.unannotated,
  items: items.map((i) => (i.id === EXPECT.unannotatedId
    ? { ...i, annotated: false, cat: '未备注', note: '（已自动加入，还没有中文备注 —— 在对话里说“给 ' + EXPECT.unannotatedId + ' 加备注”即可补上）', trig: '' }
    : i)),
}
globalThis.fetch = async (url) => { fetched.push(url); return { status: 200, json: async () => unannotatedCatalog } }
const button5 = injected.render({ inputActions: actions, input: { draft: '' }, session: null })
const out5 = []
walk(button5, out5)
out5.find((e) => e.type === 'button' && textOf(e) === '📖 技能速查').props.onClick()
await new Promise((r) => setTimeout(r, 20))
out5.length = 0
walk(button5, out5)
const text5 = out5.map(textOf).join('\n')
check('顶部提示未备注数量', text5.includes('有 ' + EXPECT.unannotated + ' 个新技能还没有备注'), true)
check('提示渲染成 skn-tip', out5.some((e) => cls(e).includes('skn-tip')), true)
check('未备注行的说明是灰斜体（skn-note todo）', out5.some((e) => cls(e) === 'skn-note todo'), true)
check('未备注行提示怎么补备注', text5.includes('加备注'), true)

fx.release()
check('固定数据临时目录已清理', existsSync(fx.tmp), false)

console.log(failures === 0 ? '\n客户端冒烟测试全部通过' : `\n${failures} 项不符`)
process.exitCode = failures === 0 ? 0 : 1
