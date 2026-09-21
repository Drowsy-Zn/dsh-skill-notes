/* dsh-skill-notes — browser half.
 *
 * Contributes one control to the composer tool row (`conversation.input.left`)
 * that opens a searchable panel of every installed skill, each with a one-line
 * Chinese note. Picking a row inserts the official `/skill-name` gesture into
 * the draft through the framework input machine (`inputActions.setDraft`), so
 * DSH's native user-invocation path loads that skill with the message.
 *
 * Registered through the client module system's classic-script factory form;
 * `require` resolves platform seed words only (react), so this file stays a
 * single self-contained script with no build step.
 */
window.__ModuleLoader__.load({
  id: "dsh-skill-notes",
  factory: (require) => {
    var React = require("react")

    var CSS = [
      '.skn-backdrop{position:fixed;inset:0;z-index:2000;background:rgba(0,0,0,.3);display:flex;align-items:flex-start;justify-content:center;padding:56px 16px 16px;}',
      '.skn-panel{width:100%;max-width:860px;max-height:calc(100vh - 88px);display:flex;flex-direction:column;background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l2);border-radius:14px;box-shadow:0 18px 48px rgba(0,0,0,.28);overflow:hidden;color:var(--dsw-alias-label-primary);}',
      '.skn-head{display:flex;align-items:center;gap:12px;padding:14px 16px 10px;}',
      '.skn-title{font-size:15px;font-weight:600;flex:1;}',
      '.skn-meta{font-size:12px;color:var(--dsw-alias-label-secondary);}',
      '.skn-close{cursor:pointer;border:none;background:transparent;color:var(--dsw-alias-label-secondary);font-size:18px;line-height:1;padding:4px 8px;border-radius:6px;}',
      '.skn-close:hover{background:var(--dsw-alias-bg-layer-2);}',
      '.skn-search{margin:0 16px 10px;padding:8px 12px;border-radius:9px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:13px;outline:none;}',
      '.skn-search:focus{border-color:var(--dsw-alias-brand-primary);}',
      '.skn-filters{display:flex;flex-wrap:wrap;gap:6px;padding:0 16px 10px;}',
      '.skn-chip{cursor:pointer;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);font-size:12px;padding:3px 10px;border-radius:999px;}',
      '.skn-chip:hover{border-color:var(--dsw-alias-border-l2);}',
      '.skn-chip.on{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:#fff;}',
      '.skn-list{overflow:auto;padding:0 8px 12px;}',
      '.skn-item{display:flex;gap:12px;padding:9px 10px;border-radius:9px;cursor:pointer;}',
      '.skn-item:hover{background:var(--dsw-alias-bg-layer-2);}',
      '.skn-id{flex:0 0 168px;font-size:12px;font-weight:600;word-break:break-all;color:var(--dsw-alias-brand-primary);}',
      '.skn-body{flex:1;min-width:0;}',
      '.skn-note{font-size:13.5px;line-height:1.5;}',
      '.skn-note.todo{color:var(--dsw-alias-label-secondary);font-style:italic;}',
      '.skn-trig{font-size:11.5px;color:var(--dsw-alias-label-secondary);margin-top:3px;line-height:1.45;}',
      '.skn-badge{display:inline-block;font-size:10.5px;padding:1px 6px;border-radius:5px;margin-left:6px;vertical-align:1px;background:var(--dsw-alias-state-warn-primary);color:#fff;}',
      '.skn-empty{padding:22px;text-align:center;color:var(--dsw-alias-label-secondary);font-size:13px;}',
      '.skn-tip{padding:6px 16px 2px;font-size:11.5px;color:var(--dsw-alias-label-secondary);}',
      '.skn-err{padding:9px 16px;color:var(--dsw-alias-state-error-primary);font-size:12px;word-break:break-all;max-height:180px;overflow:auto;}',
      '.skn-btn{display:inline-flex;align-items:center;gap:5px;cursor:pointer;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);font-size:12px;padding:4px 10px;border-radius:8px;white-space:nowrap;}',
      '.skn-btn:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l2);}',
    ].join('')

    function SkillNotesPanel(props) {
      if (!props.open) return null
      var skills = props.skills
      var cats = []
      for (var i = 0; i < skills.length; i += 1) {
        if (cats.indexOf(skills[i].cat) < 0) cats.push(skills[i].cat)
      }
      var q = props.query.trim().toLowerCase()
      var rows = []
      for (var j = 0; j < skills.length; j += 1) {
        var item = skills[j]
        if (props.cat !== '' && item.cat !== props.cat) continue
        if (q !== '') {
          var hay = (item.id + ' ' + item.note + ' ' + item.trig + ' ' + item.cat).toLowerCase()
          if (hay.indexOf(q) < 0) continue
        }
        rows.push(item)
      }

      var chips = [React.createElement('button', {
        key: '__all',
        className: props.cat === '' ? 'skn-chip on' : 'skn-chip',
        onClick: function () { props.onCat('') },
      }, '全部 ' + skills.length)]
      for (var c = 0; c < cats.length; c += 1) {
        var name = cats[c]
        var n = 0
        for (var k = 0; k < skills.length; k += 1) if (skills[k].cat === name) n += 1
        chips.push(React.createElement('button', {
          key: name,
          className: props.cat === name ? 'skn-chip on' : 'skn-chip',
          onClick: (function (chosen) {
            return function () { props.onCat(chosen) }
          })(name),
        }, name + ' ' + n))
      }

      var items = []
      for (var r = 0; r < rows.length; r += 1) {
        var row = rows[r]
        var body = [React.createElement('div', {
          key: 'n',
          className: row.annotated ? 'skn-note' : 'skn-note todo',
        }, row.note)]
        if (row.trig !== '') {
          body.push(React.createElement('div', { key: 't', className: 'skn-trig' }, '什么时候用：' + row.trig))
        }
        items.push(React.createElement('div', {
          key: row.id,
          className: 'skn-item',
          title: '点击把 /' + row.id + ' 插入输入框',
          onClick: (function (chosen) {
            return function () { props.onPick(chosen) }
          })(row.id),
        },
        React.createElement('div', { className: 'skn-id' },
          row.id,
          row.manualOnly
            ? React.createElement('span', {
              className: 'skn-badge',
              title: '这个技能模型看不到，只能你手动输入 /' + row.id,
            }, '只能手动调用')
            : null
        ),
        React.createElement('div', { className: 'skn-body' }, body)
        ))
      }

      var list = items.length > 0
        ? items
        : [React.createElement('div', { key: 'e', className: 'skn-empty' },
          props.loading ? '正在读取技能…' : '没有匹配的技能')]

      var meta = props.catalog === null
        ? (props.loading ? '读取中…' : '')
        : ('共 ' + props.catalog.total + ' 个技能')

      var tip = props.catalog === null || props.catalog.unannotated === 0
        ? null
        : React.createElement('div', { className: 'skn-tip' },
          '有 ' + props.catalog.unannotated + ' 个新技能还没有备注（灰色斜体），在对话里跟我说“给 xxx 加备注”就能补上')

      return React.createElement('div', {
        className: 'skn-backdrop',
        onClick: function () { props.onClose() },
      },
      React.createElement('div', {
        className: 'skn-panel',
        onClick: function (event) { event.stopPropagation() },
      },
      React.createElement('div', { className: 'skn-head' },
        React.createElement('div', { className: 'skn-title' }, '技能速查'),
        React.createElement('div', { className: 'skn-meta' }, meta),
        React.createElement('button', {
          className: 'skn-close',
          onClick: function () { props.onClose() },
          title: '关闭',
        }, '×')
      ),
      React.createElement('input', {
        className: 'skn-search',
        value: props.query,
        placeholder: '搜一下：表格、报错、架构图、做PPT…',
        autoFocus: true,
        onChange: function (event) { props.onQuery(event.target.value) },
      }),
      React.createElement('div', { className: 'skn-filters' }, chips),
      tip,
      props.error === '' ? null : React.createElement('div', { className: 'skn-err' }, props.error),
      React.createElement('div', { className: 'skn-list' }, list)
      ))
    }

    function SkillNotesButton(props) {
      var openState = React.useState(false)
      var catState = React.useState(null)
      var listState = React.useState([])
      var loadState = React.useState(false)
      var errState = React.useState('')
      var qState = React.useState('')
      var fState = React.useState('')
      var open = openState[0]
      var catalog = catState[0]
      var skills = listState[0]
      var loading = loadState[0]
      var error = errState[0]
      var query = qState[0]
      var cat = fState[0]
      var inputActions = props.inputActions
      var draft = props.input !== undefined && props.input !== null && typeof props.input.draft === 'string'
        ? props.input.draft
        : ''

      var load = function () {
        openState[1](true)
        loadState[1](true)
        errState[1]('')
        fetch('/dsh-skill-notes/catalog')
          .then(function (response) { return response.json() })
          .then(function (data) {
            if (data !== null && typeof data === 'object' && data.ok === true) {
              catState[1](data)
              listState[1](data.items)
            } else {
              errState[1](data !== null && typeof data === 'object' && typeof data.error === 'string'
                ? data.error
                : '读取技能备注失败')
            }
          })
          .catch(function (err) {
            errState[1]('请求失败：' + String((err && err.message) || err))
          })
          .then(function () { loadState[1](false) })
      }

      var pick = function (id) {
        var gesture = '/' + id
        if (inputActions !== undefined && inputActions !== null) {
          inputActions.setDraft(draft.length > 0 && !/\s$/.test(draft) ? draft + ' ' + gesture : draft + gesture)
        }
        openState[1](false)
      }

      return React.createElement('span', null,
        React.createElement('button', {
          className: 'skn-btn',
          title: '看看所有技能是干什么的（点一行就把 /技能名 填进输入框）',
          onClick: function () { if (open) openState[1](false); else load() },
        }, '📖 技能速查'),
        React.createElement(SkillNotesPanel, {
          open: open,
          catalog: catalog,
          skills: skills,
          loading: loading,
          error: error,
          query: query,
          cat: cat,
          onQuery: qState[1],
          onCat: fState[1],
          onPick: pick,
          onClose: function () { openState[1](false) },
        })
      )
    }

    function apply(ctx) {
      var slots = ctx.get('slots')
      if (slots === undefined) {
        console.error('[dsh-skill-notes] slots 服务未挂载，浏览器端不注册任何内容')
        return
      }
      ctx.effect(function () {
        var style = document.createElement('style')
        style.setAttribute('data-dsh-skill-notes', '')
        style.textContent = CSS
        document.head.appendChild(style)
        return function () { style.remove() }
      }, 'dsh-skill-notes: styles')
      slots.inject('conversation.input.left', function () {
        return slots.register(
          { name: 'conversation.input.left', id: 'skill-notes', order: 45 },
          function (props) { return React.createElement(SkillNotesButton, props) }
        )
      })
    }

    return { apply: apply }
  },
})
