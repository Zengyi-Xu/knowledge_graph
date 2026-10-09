/**
 * 布局测量探针（人工编写的合成测试数据场景专用）。
 * 结果写入 #__probe_result 的 textContent，由外部的无头浏览器脚本读取。
 *
 * 重要：React 19 不会响应用 JS 合成的 click / input 事件（实测 element.click() 与
 * dispatchEvent 都改不动 data-state），所以探针不自己驱动界面，而是把“下一个要做
 * 的动作 + 目标元素中心坐标”交给 runner，由 runner 用真实输入
 * （CDP Input.dispatchMouseEvent / Input.insertText）执行。
 */
;(function () {
  var MAX_LIST = 25

  function scenario() {
    return new URLSearchParams(location.search).get('scenario') || 'default'
  }

  var out = { scenario: scenario(), errors: [], engine: {} }
  var errors = out.errors

  function pushError(kind, text) {
    if (errors.length < 25) errors.push({ kind: kind, text: String(text).slice(0, 300) })
  }

  window.addEventListener('error', function (e) {
    pushError('error', (e.message || 'error') + ' @ ' + (e.filename || '') + ':' + (e.lineno || 0))
  })
  window.addEventListener('unhandledrejection', function (e) {
    var r = e.reason
    pushError('unhandledrejection', (r && (r.stack || r.message)) || r)
  })
  ;['error', 'warn'].forEach(function (level) {
    var orig = console[level].bind(console)
    console[level] = function () {
      var parts = []
      for (var i = 0; i < arguments.length; i++) {
        var a = arguments[i]
        try {
          parts.push(typeof a === 'string' ? a : (a && a.message) || JSON.stringify(a))
        } catch (err) {
          parts.push(String(a))
        }
      }
      pushError('console.' + level, parts.join(' '))
      orig.apply(null, arguments)
    }
  })

  /* ---------------------------------------------------------------- 工具 */

  function isVisible(el) {
    if (!el) return false
    var cs = getComputedStyle(el)
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false
    var r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  }

  function deepAll(selector) {
    var found = []
    function walk(root) {
      found = found.concat(Array.prototype.slice.call(root.querySelectorAll(selector)))
      Array.prototype.slice.call(root.querySelectorAll('*')).forEach(function (el) {
        if (el.shadowRoot) walk(el.shadowRoot)
      })
    }
    walk(document)
    return found
  }

  function label(el) {
    return {
      tag: el.tagName.toLowerCase(),
      cls: typeof el.className === 'string' ? el.className.slice(0, 80) : '',
      text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 24),
      aria: el.getAttribute('aria-label') || el.getAttribute('title') || '',
    }
  }

  function centerOf(el) {
    var r = el.getBoundingClientRect()
    return {
      x: Math.round(r.left + r.width / 2),
      y: Math.round(r.top + r.height / 2),
      w: Math.round(r.width),
      h: Math.round(r.height),
      inViewport:
        r.left >= 0 &&
        r.top >= 0 &&
        r.right <= document.documentElement.clientWidth + 1 &&
        r.bottom <= document.documentElement.clientHeight + 1,
    }
  }

  /** 该元素是否有“自身可横向滚动”的祖先（表格/代码块包装层）——这类溢出是设计允许的 */
  function hasScrollableAncestor(el) {
    var node = el.parentElement
    while (node && node !== document.body) {
      var ox = getComputedStyle(node).overflowX
      if ((ox === 'auto' || ox === 'scroll') && node.scrollWidth > node.clientWidth + 2) return true
      node = node.parentElement
    }
    return false
  }

  /* ---------------------------------------------------------------- 元素查找 */

  function findEditTab() {
    // v1.1.0 的 App.tsx 顶层还有一组视图标签（笔记 / 图谱 / 并列），
    // 所以「编辑」必须限定在 NoteEditor 自己那个 TabsList 里，否则会误点顶层标签；
    // 并列视图（view === 'both'）下根本没有这组标签。
    return deepAll('[role="tab"]').filter(function (t) {
      if ((t.textContent || '').trim() !== '编辑') return false
      var row = t.parentElement
      if (!row) return false
      var labels = Array.prototype.slice.call(row.querySelectorAll('[role="tab"]')).map(function (x) {
        return (x.textContent || '').trim()
      })
      // NoteEditor 的 TabsList 恰好是 [预览, 编辑]
      return labels.length === 2 && labels.indexOf('预览') >= 0
    })[0]
  }
  /** App.tsx 顶层视图标签（笔记 / 图谱 / 并列） */
  function findViewTab(name) {
    return deepAll('[role="tab"]').filter(function (t) {
      return (t.textContent || '').trim() === name
    })[0]
  }
  /** NoteEditor 的「预览」标签（用于判断 预览/编辑 这组是否渲染出来） */
  function findPreviewTab() {
    return deepAll('[role="tab"]').filter(function (t) {
      return (t.textContent || '').trim() === '预览'
    })[0]
  }
  function viewTabState(name) {
    var t = findViewTab(name)
    return t ? t.getAttribute('data-state') : null
  }
  /** 主区左上角的「展开/收起笔记列表」按钮（v1.1.0 新增） */
  function findListToggle() {
    return Array.prototype.slice
      .call(document.querySelectorAll('button[title]'))
      .filter(function (b) {
        return /笔记列表/.test(b.getAttribute('title') || '')
      })[0]
  }
  function isListOpen() {
    var btn = findListToggle()
    return !!btn && /收起笔记列表/.test(btn.getAttribute('title') || '')
  }
  function findSearchInput() {
    return Array.prototype.slice
      .call(document.querySelectorAll('input[placeholder]'))
      .filter(function (i) {
        return (i.getAttribute('placeholder') || '').indexOf('搜索') >= 0
      })[0]
  }
  function findNoteItem(title) {
    return Array.prototype.slice
      .call(document.querySelectorAll('.note-item'))
      .filter(function (b) {
        return (b.textContent || '').indexOf(title) >= 0
      })[0]
  }
  function findActiveNoteItem() {
    return Array.prototype.slice
      .call(document.querySelectorAll('.note-item'))
      .filter(function (b) {
        return /bg-accent/.test(b.className)
      })[0]
  }
  function findTextarea() {
    return deepAll('textarea').filter(isVisible)[0]
  }
  function findSuggestPopover() {
    return Array.prototype.slice.call(document.querySelectorAll('div')).filter(function (d) {
      return isVisible(d) && d.querySelectorAll('button').length > 0 && /bg-popover/.test(d.className)
    })[0]
  }

  /* ---------------------------------------------------------------- 外壳模拟 */

  function applyShellMobile() {
    // v1.1.0 的 App.tsx 已有「收起/展开笔记列表」按钮，但即使收起，
    // 它自身的最小宽度仍然撑破 360px：aside 固定 256px（w-64 shrink-0）、
    // 主区视图标签行最小约 228px（3 个 TabsTrigger × 74px）。这些都是 App.tsx
    // 顶层布局的问题，不属于 DS-01/02/03 的组件范围。
    // 所以这里注入一段**限定在测试实例**的样式，模拟“手机端列表/详情切换”之后的
    // 真实可用宽度，用来单独判定组件层是否达标；真实顶层的结论看 shellMode=original。
    if (new URLSearchParams(location.search).get('shell') !== 'mobile') return
    if (document.getElementById('__shell_mobile')) return
    var style = document.createElement('style')
    style.id = '__shell_mobile'
    style.textContent =
      'aside{display:none!important}' +
      'main{flex:1 1 100%!important;width:100%!important;min-width:0!important}' +
      'header{flex-wrap:wrap!important;height:auto!important;min-height:3.5rem;padding-top:6px!important;padding-bottom:6px!important;row-gap:6px}' +
      'header>div{flex-wrap:wrap;row-gap:6px}' +
      'header>.ml-auto{row-gap:6px}'
    document.head.appendChild(style)
  }

  /* ---------------------------------------------------------------- 测量 */

  function measure() {
    var vw = document.documentElement.clientWidth
    var vh = document.documentElement.clientHeight
    out.engine = {
      vw: vw,
      vh: vh,
      dpr: window.devicePixelRatio,
      ua: navigator.userAgent,
      hasContainerQueries: typeof CSS !== 'undefined' && CSS.supports && CSS.supports('container-type: inline-size'),
    }
    out.overflow = {
      docScrollW: document.documentElement.scrollWidth,
      docClientW: vw,
      bodyScrollW: document.body.scrollWidth,
      pageScrollsX: document.documentElement.scrollWidth > vw + 1 || document.body.scrollWidth > vw + 1,
      docScrollH: document.documentElement.scrollHeight,
      docClientH: document.documentElement.clientHeight,
      flagged: [],
    }
    out.tap = { scanned: 0, small: [], min44: [] }
    out.key = {}

    var all = deepAll('*')
    out.elementCount = all.length

    for (var i = 0; i < all.length; i++) {
      var el = all[i]
      if (!isVisible(el)) continue
      var style = getComputedStyle(el)
      if (style.position === 'fixed') continue
      var r = el.getBoundingClientRect()
      if (r.bottom < -1 || r.top > vh) continue
      if (r.right <= vw + 1 && r.left >= -1) continue
      if (hasScrollableAncestor(el)) continue
      if (out.overflow.flagged.length >= MAX_LIST) continue
      var l = label(el)
      out.overflow.flagged.push({
        rect: [Math.round(r.left), Math.round(r.right), Math.round(r.width)],
        tag: l.tag,
        cls: l.cls,
        text: l.text,
        overflowX: style.overflowX,
      })
    }

    if (out.engine.vw < 768) {
      var targets = deepAll(
        'button, a[href], [role="button"], input:not([type="hidden"]), select, textarea, [role="tab"]',
      )
      out.tap.scanned = targets.length
      for (var j = 0; j < targets.length; j++) {
        var t = targets[j]
        if (!isVisible(t)) continue
        var tr = t.getBoundingClientRect()
        var l2 = label(t)
        var info = {
          min: Math.min(Math.round(tr.width), Math.round(tr.height)),
          w: Math.round(tr.width),
          h: Math.round(tr.height),
          tag: l2.tag,
          cls: l2.cls,
          text: l2.text,
          aria: l2.aria,
          // 包在 <label> 里的控件（如双向同步开关）：真正的可点区域是整条 label
          inLabel: !!t.closest('label'),
          labelH: t.closest('label') ? Math.round(t.closest('label').getBoundingClientRect().height) : null,
        }
        if (info.min < 24) out.tap.small.push(info)
        if (info.min >= 44) out.tap.min44.push(info)
      }
      if (out.tap.min44.length > MAX_LIST) out.tap.min44.length = MAX_LIST
    }
  }

  /** 检查正文（Shadow DOM）内部的横向滚动是否被允许 */
  function measureShadow() {
    var hosts = Array.prototype.slice.call(document.querySelectorAll('*')).filter(function (el) {
      return el.shadowRoot
    })
    out.shadow = []
    hosts.forEach(function (host) {
      var hostRect = host.getBoundingClientRect()
      var entry = {
        host: { tag: host.tagName.toLowerCase(), w: Math.round(hostRect.width), scrollW: host.scrollWidth },
        scrollContainers: [],
        clipped: [],
      }
      var inner = Array.prototype.slice.call(host.shadowRoot.querySelectorAll('*'))
      var vw = document.documentElement.clientWidth
      inner.forEach(function (el) {
        if (!isVisible(el)) return
        var cs = getComputedStyle(el)
        if (el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 60) {
          entry.scrollContainers.push({
            tag: el.tagName.toLowerCase(),
            cls: typeof el.className === 'string' ? el.className.slice(0, 60) : '',
            scrollW: el.scrollWidth,
            clientW: el.clientWidth,
            overflowX: cs.overflowX,
            isScrollable: cs.overflowX === 'auto' || cs.overflowX === 'scroll',
          })
        }
      })
      var worst = null
      inner.forEach(function (el) {
        var cs = getComputedStyle(el)
        if (cs.position === 'fixed') return
        if (el.scrollWidth > el.clientWidth + 2) return
        var r = el.getBoundingClientRect()
        if (r.width <= vw + 1) return
        if (hasScrollableAncestor(el)) return
        if (!worst || r.width > worst.width) {
          worst = {
            tag: el.tagName.toLowerCase(),
            width: Math.round(r.width),
            text: (el.textContent || '').trim().slice(0, 40),
          }
        }
      })
      if (worst) entry.clipped.push(worst)
      out.shadow.push(entry)
    })
  }

  function collectFacts() {
    var facts = { probe: 'ok' }
    var text = document.body.innerText || ''
    // 手机端顶栏的「N 篇笔记」文案按设计被隐藏，所以不能用它判断水合；
    // 改用「正文渲染出来了（Shadow DOM 有 #write）或编辑区在」来判定。
    facts.hydrated = deepAll('#write').length > 0 || deepAll('textarea').length > 0
    facts.scenarioMarker = document.documentElement.getAttribute('data-test-scenario')
    facts.shellMobileOverride = !!document.getElementById('__shell_mobile')
    facts.bodyTextLen = text.length
    facts.controls = {
      activeWanted: localStorage.getItem('__test_active') || null,
      activeItem: (function () {
        var act = findActiveNoteItem()
        return act ? (act.textContent || '').slice(0, 40) : null
      })(),
      search: localStorage.getItem('__test_search') || null,
      searchValue: (findSearchInput() || {}).value || null,
      tabWanted: localStorage.getItem('__test_tab') || null,
      e2eState: window.__e2eState || null,
    }
    facts.controls.activeMatch =
      !!facts.controls.activeWanted &&
      !!facts.controls.activeItem &&
      facts.controls.activeItem.indexOf(facts.controls.activeWanted) >= 0
    facts.emptySearchText = text.indexOf('没有匹配的笔记') >= 0
    facts.seedError = document.documentElement.getAttribute('data-seed-error') || null
    facts.tabState = deepAll('[role="tab"]').map(function (t) {
      return (t.textContent || '').trim() + '=' + (t.getAttribute('data-state') || '?')
    })
    facts.listToggle = (function () {
      var b = findListToggle()
      return { found: !!b, title: b ? b.getAttribute('title') : null, open: isListOpen() }
    })()
    facts.allTabs = deepAll('[role="tab"]').length
    facts.previewTabFound = !!findPreviewTab()
    facts.textareas = Array.prototype.slice.call(document.querySelectorAll('textarea')).map(function (t) {
      var r = t.getBoundingClientRect()
      return { w: Math.round(r.width), h: Math.round(r.height), visible: isVisible(t), valueLen: (t.value || '').length }
    })

    var write = deepAll('#write')[0]
    if (write) {
      var cs = getComputedStyle(write)
      var r = write.getBoundingClientRect()
      facts.write = {
        padding: cs.padding,
        background: cs.backgroundColor,
        color: cs.color,
        overflowX: cs.overflowX,
        width: Math.round(r.width),
        scrollW: write.scrollWidth,
        clientW: write.clientWidth,
        hOverflow: write.scrollWidth > write.clientWidth + 2,
      }
      var inner = write.firstElementChild
      if (inner) {
        var ics = getComputedStyle(inner)
        var ir = inner.getBoundingClientRect()
        facts.writeInner = {
          fontSize: ics.fontSize,
          maxWidth: ics.maxWidth,
          width: Math.round(ir.width),
          wordBreak: ics.overflowWrap + '/' + ics.wordBreak,
        }
      }
      var table = write.querySelector('table')
      if (table) {
        var tw = table.closest('div')
        facts.table = {
          scrollW: tw ? tw.scrollWidth : table.scrollWidth,
          clientW: tw ? tw.clientWidth : table.clientWidth,
          outerOverflowX: tw ? getComputedStyle(tw).overflowX : '',
          tableWidth: Math.round(table.getBoundingClientRect().width),
        }
      }
      var pre = write.querySelector('pre')
      if (pre) {
        facts.pre = {
          scrollW: pre.scrollWidth,
          clientW: pre.clientWidth,
          overflowX: getComputedStyle(pre).overflowX,
          bg: getComputedStyle(pre).backgroundColor,
          color: getComputedStyle(pre).color,
          pad: getComputedStyle(pre).padding,
          rect: (function () {
            var pr = pre.getBoundingClientRect()
            return [Math.round(pr.left), Math.round(pr.right), Math.round(pr.width)]
          })(),
          inlineStyle: pre.getAttribute('style') || '',
        }
        var codeEl = pre.querySelector('code')
        if (codeEl) {
          facts.pre.codeBg = getComputedStyle(codeEl).backgroundColor
          facts.pre.codeColor = getComputedStyle(codeEl).color
          facts.pre.codeInline = codeEl.getAttribute('style') || ''
        }
      }
      var img = write.querySelector('img')
      if (img) {
        var irr = img.getBoundingClientRect()
        facts.img = { w: Math.round(irr.width), h: Math.round(irr.height), natural: img.naturalWidth }
      }
      var sub = write.querySelector('sub')
      var sup = write.querySelector('sup')
      if (sub) facts.sub = { fontSize: getComputedStyle(sub).fontSize, verticalAlign: getComputedStyle(sub).verticalAlign }
      if (sup) facts.sup = { fontSize: getComputedStyle(sup).fontSize, verticalAlign: getComputedStyle(sup).verticalAlign }
    }

    var editorTitle = Array.prototype.slice
      .call(document.querySelectorAll('input[placeholder="笔记标题"]'))
      .filter(isVisible)[0]
    facts.editorTitle = editorTitle ? centerOf(editorTitle) : null

    var aside = document.querySelector('aside')
    var main = document.querySelector('main')
    var header = document.querySelector('header')
    facts.shell = {
      aside: aside ? { w: Math.round(aside.getBoundingClientRect().width) } : null,
      main: main
        ? {
            w: Math.round(main.getBoundingClientRect().width),
            clientW: main.clientWidth,
            scrollW: main.scrollWidth,
            hOverflow: main.scrollWidth > main.clientWidth + 2,
          }
        : null,
      header: header
        ? { w: Math.round(header.getBoundingClientRect().width), scrollW: header.scrollWidth, clientW: header.clientWidth }
        : null,
    }

    var pop = findSuggestPopover()
    facts.linkSuggest = pop
      ? {
          w: Math.round(pop.getBoundingClientRect().width),
          right: Math.round(pop.getBoundingClientRect().right),
          items: pop.querySelectorAll('button').length,
        }
      : null

    out.facts = facts
  }

  function finish() {
    var pre = document.createElement('pre')
    pre.id = '__probe_result'
    pre.style.display = 'none'
    pre.textContent = JSON.stringify(out)
    document.body.appendChild(pre)
    document.documentElement.setAttribute('data-probe', 'done')
  }

  /* ---------------------------------------------------------------- 对外接口 */

  function nextAction() {
    var st =
      window.__e2eState ||
      (window.__e2eState = {
        viewSelected: false,
        activeClicked: false,
        tabClicked: false,
        searchTyped: false,
        suggestTyped: false,
        listForced: false,
      })

    // -1) 需要量列表控件的场景：保持抽屉展开
    if (localStorage.getItem('__test_drawer') === '1' && !st.listForced) {
      var dToggle = findListToggle()
      if (dToggle) {
        if (isListOpen()) {
          st.listForced = true
        } else {
          var cd = centerOf(dToggle)
          return { op: 'click', x: cd.x, y: cd.y, why: 'open-note-list' }
        }
      }
    }

    // 0) 先把顶层视图切到「笔记」：v1.1.0 默认可能是图谱/并列，
    //    而 NoteEditor 的「预览/编辑」切换只在「笔记」视图下存在。
    if (!st.viewSelected) {
      var notesTab = findViewTab('笔记')
      if (!notesTab) {
        st.viewSelected = true
      } else if (notesTab.getAttribute('data-state') === 'active') {
        st.viewSelected = true
        // 笔记视图渲染后，预览/编辑这组标签才存在
        if (findPreviewTab()) st.tabClicked = false
      } else {
        var cv = centerOf(notesTab)
        return { op: 'click', x: cv.x, y: cv.y, why: 'switch-view:笔记' }
      }
    }

    var active = localStorage.getItem('__test_active')
    if (active && !st.activeClicked) {
      var item = findNoteItem(active)
      if (!item) {
        // 列表被收起了（v1.1.0 的 note-graph-list-open）——先点开列表再切笔记。
        // 点开之后这一轮结束；下一轮再真正切笔记。若列表已经开着却仍找不到目标笔记，
        // 就不做任何事（避免死循环），让 controlsSettled 去判定失败。
        var toggle = findListToggle()
        if (toggle && !isListOpen()) {
          var ct = centerOf(toggle)
          return { op: 'click', x: ct.x, y: ct.y, why: 'open-note-list' }
        }
      } else {
        // 已经是活动笔记就不要再点：NoteEditor 以 note.id 为 key，
        // 多余的点击会重新挂载并把标签页重置回预览。
        var wasActive = /bg-accent/.test(item.className)
        st.activeClicked = true
        if (!wasActive) {
          var c = centerOf(item)
          return { op: 'click', x: c.x, y: c.y, why: 'switch-note:' + active }
        }
      }
    }

    var tab = localStorage.getItem('__test_tab')
    var suggest = localStorage.getItem('__test_suggest')
    if ((tab === 'edit' || suggest) && !st.tabClicked) {
      var et = findEditTab()
      if (et) {
        if (et.getAttribute('data-state') === 'active') st.tabClicked = true
        else {
          var c2 = centerOf(et)
          return { op: 'click', x: c2.x, y: c2.y, why: 'switch-tab:edit' }
        }
      }
    }

    var search = localStorage.getItem('__test_search')
    if (search && !st.searchTyped) {
      var si = findSearchInput()
      if (!si) {
        // 搜索框在笔记列表里；手机端列表是抽屉，收起时它不在 DOM 中，先展开
        var stoggle = findListToggle()
        if (stoggle && !isListOpen()) {
          var cs = centerOf(stoggle)
          return { op: 'click', x: cs.x, y: cs.y, why: 'open-note-list-for-search' }
        }
      } else if (si.value !== search) {
        var c3 = centerOf(si)
        return { op: 'type', x: c3.x, y: c3.y, text: search, why: 'search' }
      } else {
        st.searchTyped = true
      }
    }

    if (suggest && !st.suggestTyped) {
      var ta = findTextarea()
      if (ta) {
        var want = '关联：[[示例人物'
        if (ta.value === want) st.suggestTyped = true
        else {
          var c4 = centerOf(ta)
          return { op: 'type', x: c4.x, y: c4.y, text: want, why: 'wikilink-suggest' }
        }
      }
    }
    return { op: 'done' }
  }

  function controlsSettled() {
    var st = window.__e2eState || {}
    var active = localStorage.getItem('__test_active')
    var tab = localStorage.getItem('__test_tab')
    var suggest = localStorage.getItem('__test_suggest')
    var search = localStorage.getItem('__test_search')

    if (active) {
      var act = findActiveNoteItem()
      if (!act || (act.textContent || '').indexOf(active) < 0) return false
    }
    if (search && (!st.searchTyped || (findSearchInput() || {}).value !== search)) return false
    if (tab === 'edit' || suggest) {
      var et = findEditTab()
      if (!et || et.getAttribute('data-state') !== 'active') return false
      if (!findTextarea()) return false
    }
    if (suggest && !findSuggestPopover()) return false
    return true
  }

  function status() {
    var et = findEditTab()
    var act = findActiveNoteItem()
    return {
      scenario: scenario(),
      activeWanted: localStorage.getItem('__test_active'),
      activeNow: act ? (act.textContent || '').slice(0, 30) : null,
      tab: et ? et.getAttribute('data-state') : null,
      hasTextarea: !!findTextarea(),
      searchVal: (findSearchInput() || {}).value || '',
      hasSuggest: !!findSuggestPopover(),
      e2eState: window.__e2eState || null,
    }
  }

  window.__e2e = {
    nextAction: nextAction,
    controlsSettled: controlsSettled,
    status: status,
    setShellMobile: function () {
      applyShellMobile()
      return !!document.getElementById('__shell_mobile')
    },
    finish: function () {
      try {
        measure()
        measureShadow()
        collectFacts()
        out.controlAttempts = window.__e2eTries || 0
        out.controlsSettled = controlsSettled()
      } catch (e) {
        pushError('probe', (e && e.stack) || e)
      }
      finish()
    },
  }

  function run() {
    // 只负责把 __e2e 暴露给 runner；界面动作与外壳注入都由 runner 按顺序驱动。
    window.__e2eReady = true
  }

  function waitReady() {
    var tries = 0
    var timer = setInterval(function () {
      tries++
      var root = document.getElementById('root')
      var text = root ? root.innerText || '' : ''
      var ready =
        text.indexOf('篇笔记') >= 0 ||
        (document.documentElement.getAttribute('data-test-scenario') === 'no-notes' && text.length > 0)
      if (ready || tries > 150) {
        clearInterval(timer)
        run()
      }
    }, 40)
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(waitReady, 0)
  } else {
    document.addEventListener('DOMContentLoaded', function () {
      waitReady()
    })
  }
})()
