/**
 * 移动端第一阶段 · 页面内验证驱动（classic script，无构建、无依赖）。
 *
 * 由 scripts/mobile-responsive-check.mjs 插到 dist/index.html 的 <head> 里
 * （在应用 module script 之前执行，因此可以先行播种 localStorage / 注入桥接桩），
 * 然后驱动真实界面：点列表项 → 详情 → 切编辑 → 输入 → 切预览 → 文献 → 图谱 →
 * 存储面板，并把测量结果与断言写成 JSON 放进 <pre id="kg-report">，
 * 由 `chrome --dump-dom` 取回。
 *
 * 关键约定：
 * - 不使用 User-Agent；只读 DOM 结构与 matchMedia 结果。
 * - 触摸模拟只用 DOM 事件（pointerdown/mousedown/click），与真实点击等价；
 *   Radix 的 Tabs 在 pointerdown 与 focus 时激活。
 * - 扫描溢出时跳过「自身可横向滚动」的容器（宽表格 / 代码块的局部滚动是设计如此）。
 */
;(function () {
  const params = new URLSearchParams(location.search)
  const scenario = params.get('scenario') === 'bridge' ? 'bridge' : 'no-bridge'
  const stopAt = params.get('view') || 'all'
  const editorMode = params.get('mode') === 'wysiwyg' ? 'wysiwyg' : 'classic'
  /** 截图用：能力面板那一步保持打开（跑断言时最后会关掉它） */
  const hold = params.get('hold') === '1'
  const width = Number(params.get('width') || window.innerWidth)
  const isPhone = width < 768

  // ----------------------------------------------------------------- 错误收集
  const consoleErrors = []
  const originalError = console.error
  console.error = function () {
    const parts = []
    for (const value of arguments) {
      parts.push(typeof value === 'string' ? value : (value && value.message) || String(value))
    }
    consoleErrors.push(parts.join(' ').slice(0, 200))
    originalError.apply(console, arguments)
  }
  let currentStage = 'startup'
  window.addEventListener('error', (event) =>
    consoleErrors.push(
      `[${currentStage}] onerror: ${event.message || ''} @ ${String((event.error && event.error.stack) || '').split('\n').slice(0, 3).join(' <- ').slice(0, 300)}`,
    ),
  )
  window.addEventListener('unhandledrejection', (event) =>
    consoleErrors.push(`[${currentStage}] unhandledrejection: ` + String(event.reason && event.reason.message ? event.reason.message : event.reason).slice(0, 200)),
  )

  // ----------------------------------------------------------------- 桥接桩 + 播种
  if (scenario === 'bridge') {
    window.knowledgeGraphDesktop = {
      isElectron: true,
      isLocalWeb: false,
      defaultVaultDir: '',
      defaultZoteroDb: '',
      chooseSyncFile: async () => null,
      writeSyncFile: async () => ({ filePath: '' }),
      readSyncFile: async () => ({ content: null }),
      chooseVaultDir: async () => null,
      listVault: async () => ({ exists: false, meta: null, md: [] }),
      readVaultFiles: async () => [],
      writeVault: async () => ({ written: 0, deleted: 0, filePath: '' }),
      openVaultDir: async () => ({ error: null }),
      listAttachments: async () => [],
      readAttachment: async () => null,
      writeAttachment: async () => ({ name: '' }),
      removeAttachment: async () => ({ name: '' }),
      openAttachmentExternal: async () => ({ error: null }),
      writeClipboardRtf: async () => ({ error: null }),
      chooseOpenAttachment: async () => null,
      chooseSaveAttachment: async () => null,
      readZotero: async () => ({ collections: [], items: [] }),
      openZoteroPdf: async () => ({ path: '' }),
      readZoteroPdf: async () => ({ data: new Uint8Array(), name: '', path: '' }),
      openExternalFile: async () => ({ error: null }),
      readExternalPdf: async () => ({ data: new Uint8Array(), name: '', path: '' }),
      selectZoteroItem: async () => ({ error: null }),
      aiStatus: async () => ({ configured: false, error: 'bridge-stub' }),
      aiComplete: async () => ({ ok: false, error: 'bridge-stub' }),
    }
  }

  let seedError = ''
  try {
    localStorage.clear()
    localStorage.setItem('kg-onboarding-done-v1', '1')
    localStorage.setItem('kg-notes-v1', JSON.stringify(window.__KG_FIXTURE__ || []))
    // 编辑器模式：classic = 预览/编辑切换（默认预览，交接文档要求的主路径）；
    // wysiwyg = 当前代码的默认值，单独跑一档确认它在手机端也能渲染
    localStorage.setItem('kg-editor-mode-v1', editorMode)
  } catch (error) {
    seedError = String(error && error.name)
  }
  // 同步标记：即使后面的流程没跑完，也能从 dump 出来的 DOM 判断驱动是否执行过、播种是否成功
  document.documentElement.setAttribute(
    'data-kg-driver',
    seedError
      ? `seed-failed:${seedError}`
      : `seeded:${(localStorage.getItem('kg-notes-v1') || '').length}`,
  )

  // ----------------------------------------------------------------- 工具
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

  async function waitFor(test, timeout = 2500) {
    const started = Date.now()
    for (;;) {
      let value = null
      try {
        value = test()
      } catch {
        value = null
      }
      if (value) return value
      if (Date.now() - started > timeout) return null
      await sleep(50)
    }
  }

  function fire(el, pointer) {
    const options = {
      bubbles: true,
      cancelable: true,
      composed: true,
      button: 0,
      buttons: pointer === 'pointerdown' || pointer === 'mousedown' ? 1 : 0,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
    }
    if (pointer.startsWith('pointer') && typeof PointerEvent === 'function') {
      el.dispatchEvent(new PointerEvent(pointer, options))
    } else {
      el.dispatchEvent(new MouseEvent(pointer, options))
    }
  }

  /** 真实点击等价：pointerdown → mousedown → pointerup → mouseup → click */
  function click(el) {
    if (!el) return false
    el.scrollIntoView({ block: 'center' })
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) fire(el, type)
    return true
  }

  /** Radix Tabs 触发器：按文字找，激活后核对 aria-selected */
  function clickTab(label) {
    const tab = [...document.querySelectorAll('[role="tab"]')].find((el) => (el.textContent || '').trim() === label)
    if (!tab) return false
    try {
      tab.focus()
    } catch {
      /* ignore */
    }
    click(tab)
    return true
  }

  /** 受控输入框：走原生 setter + input 事件，React 才能看到这次改动 */
  function typeInto(el, text) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set
    setter.call(el, el.value + text)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }

  /**
   * 更接近真人输入的方式：走浏览器编辑管线（有真实光标/选区）。
   * Vditor 这类编辑器会在 input 事件里读 `Selection.getRangeAt(0)`，
   * 用合成的 input 事件会抛 IndexSizeError（那是打桩产物，不是应用缺陷）。
   */
  function typeLikeUser(el, text) {
    try {
      el.focus()
      if (document.execCommand && document.execCommand('insertText', false, text)) return true
    } catch {
      /* 落到合成事件 */
    }
    typeInto(el, text)
    return false
  }

  function shadowWrite() {
    const host = [...document.querySelectorAll('div')].find((el) => el.shadowRoot)
    return host ? host.shadowRoot.getElementById('write') : null
  }

  function overflowOffenders() {
    const vw = window.innerWidth
    const scrollableX = (el) => {
      const style = getComputedStyle(el)
      return (style.overflowX === 'auto' || style.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 1
    }
    // 任何裁剪祖先（hidden / clip / auto / scroll）都不可能是「把页面撑宽」的原因：
    // 超出部分会被它裁掉或让它在内部滚动。真正要抓的是容器本身太宽。
    const insideClipper = (el) => {
      let node = el.parentElement
      while (node && node !== document.body) {
        if (getComputedStyle(node).overflowX !== 'visible') return true
        if (scrollableX(node)) return true
        node = node.parentElement
      }
      return false
    }
    const offenders = []
    for (const el of document.querySelectorAll('body *')) {
      const style = getComputedStyle(el)
      if (style.display === 'none' || style.visibility === 'hidden') continue
      const rect = el.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) continue
      if (rect.right <= vw + 1 && rect.left >= -1) continue
      if (insideClipper(el)) continue
      offenders.push({
        tag: el.tagName.toLowerCase(),
        cls: (typeof el.className === 'string' ? el.className : '').slice(0, 50),
        testid: el.getAttribute('data-testid') || '',
        left: Math.round(rect.left),
        right: Math.round(rect.right),
      })
    }
    return offenders
  }

  function smallTargets() {
    return [...document.querySelectorAll('button, a, [role="button"]')]
      .filter((el) => {
        const style = getComputedStyle(el)
        if (style.display === 'none' || style.visibility === 'hidden') return false
        const rect = el.getBoundingClientRect()
        return rect.width > 0 && rect.height > 0
      })
      .filter((el) => {
        const rect = el.getBoundingClientRect()
        return rect.height < 44 || rect.width < 44
      })
      .map((el) => {
        const rect = el.getBoundingClientRect()
        return {
          testid: el.getAttribute('data-testid') || '',
          label: (el.textContent || '').trim().slice(0, 18),
          w: Math.round(rect.width),
          h: Math.round(rect.height),
        }
      })
  }

  function probe() {
    const write = shadowWrite()
    const doc = document.documentElement
    return {
      vw: window.innerWidth,
      vh: window.innerHeight,
      pageOverflow: doc.scrollWidth - doc.clientWidth,
      offenders: overflowOffenders(),
      smallTargets: smallTargets(),
      preview: write ? { client: write.clientWidth, scroll: write.scrollWidth, text: write.innerText.slice(0, 120) } : null,
      hasTabbar: Boolean(document.querySelector('[data-testid="mobile-tabbar"]')),
      hasListPane: Boolean(document.querySelector('[data-testid="mobile-list-pane"]')),
      hasDetailPane: Boolean(document.querySelector('[data-testid="mobile-detail-pane"]')),
      hasAside: Boolean(document.querySelector('aside')),
      hasLitCards: Boolean(document.querySelector('[data-testid="literature-cards"]')),
      hasLitTable: Boolean(document.querySelector('[data-testid="literature-list"] table')),
      hasVaultBar: Boolean(document.querySelector('[data-testid="data-safety-status"]')),
      hasSyncBar: Boolean(document.querySelector('[data-testid="sync-status"]')),
      badge: (document.querySelector('[data-testid="capability-badge"]') || {}).textContent || '',
      text: (document.body.innerText || '').slice(0, 2500),
    }
  }

  const checks = []
  const check = (name, ok, detail) => checks.push({ name, ok: Boolean(ok), detail: detail === undefined ? '' : String(detail) })
  const report = { width, scenario, isPhone, editorMode, checks, notes: [], seedError }

  /**
   * 已知的打桩产物（不是应用缺陷）：无头环境里没有真实按键，
   * 只能用合成事件往 Vditor（所见即所得）里塞文本，它读不到光标选区就会抛
   * IndexSizeError(getRangeAt)。这里如实记录下来并从「控制台无错误」里剔除，
   * 并在报告里点名说明「这一条需要真机验证」。
   */
  const KNOWN_ARTIFACTS = [
    {
      match: 'getRangeAt',
      why: 'Vditor 在合成 input 事件下读不到光标选区（无头环境没有真实按键）；所见即所得的键入需在真机/真实键盘下验证',
    },
  ]
  function partitionErrors() {
    const real = []
    const artifacts = []
    for (const entry of consoleErrors) {
      const hit = KNOWN_ARTIFACTS.find((artifact) => entry.includes(artifact.match))
      if (hit) artifacts.push({ error: entry, why: hit.why })
      else real.push(entry)
    }
    return { real, artifacts }
  }

  function note(label, value) {
    report.notes.push({ label, value: typeof value === 'string' ? value.slice(0, 300) : value })
  }

  /**
   * 报告出口。
   * 正常跑法是把页面放进 harness.html 的 iframe 里（无头 Chrome 的窗口有最小宽度限制，
   * 只有 iframe 才能拿到真正的 360/390/412 视口）：驱动把报告 push 给父页面的数组；
   * 单独打开时退回「写进 documentElement 里的 <pre>」，方便人工排查。
   */
  const isFramed = (() => {
    try {
      return window.parent !== window && Array.isArray(window.parent.__KG_REPORTS__)
    } catch {
      return false
    }
  })()
  const reportNode = document.createElement('pre')
  reportNode.id = 'kg-report'
  reportNode.hidden = true
  document.documentElement.appendChild(reportNode)

  /** 每完成一步就刷新一次：即使虚拟时间预算被用光，也能拿到已完成的部分 */
  function flush(stage) {
    report.stage = stage
    report.finished = stage === 'done'
    currentStage = stage
    const { real, artifacts } = partitionErrors()
    report.consoleErrors = real
    report.knownArtifacts = artifacts
    const json = encodeURIComponent(JSON.stringify(report))
    reportNode.textContent = json
    if (isFramed) {
      const slot = window.parent.__KG_REPORTS__.findIndex((entry) => entry.width === report.width && entry.scenario === report.scenario)
      if (slot >= 0) window.parent.__KG_REPORTS__[slot] = report
      else window.parent.__KG_REPORTS__.push(report)
    }
  }
  flush('started')

  const LAYOUT = (probeResult) => {
    check(`${probeResult.vw}px 无横向溢出`, probeResult.pageOverflow <= 1 && probeResult.offenders.length === 0, `pageOverflow=${probeResult.pageOverflow} offenders=${JSON.stringify(probeResult.offenders)}`)
  }

  // ----------------------------------------------------------------- 主流程
  ;(async () => {
    try {
    const steps = []
    const step = (name, fn) => steps.push({ name, fn })

    step('default', async () => {
      check('视口宽度等于目标宽度', Math.abs(window.innerWidth - width) <= 1, `innerWidth=${window.innerWidth} 目标=${width}`)
      const item = await waitFor(() => document.querySelector('.note-item'))
      check('渲染出合成夹具', Boolean(item) && document.body.innerText.includes('示例'), `item=${Boolean(item)} seed=${seedError || 'ok'}`)
      note('bodyText', (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 240))
      note('cacheLength', (localStorage.getItem('kg-notes-v1') || '').length)
      const state = probe()
      LAYOUT(state)
      if (isPhone) {
        check('手机端有底部导航且不渲染桌面侧栏', state.hasTabbar && !state.hasAside, `tabbar=${state.hasTabbar} aside=${state.hasAside}`)
        check('手机端默认显示列表页', state.hasListPane, `listPane=${state.hasListPane}`)
        check('手机端顶部不显示存储/同步状态栏', !state.hasVaultBar && !state.hasSyncBar, `vault=${state.hasVaultBar} sync=${state.hasSyncBar}`)
        const buttons = state.smallTargets.filter((t) => !t.testid.startsWith('mobile-tab') ? true : false)
        check('手机端按钮触摸目标基本达标（<44px ≤3 个）', buttons.length <= 3, `共 ${state.smallTargets.length}：${JSON.stringify(buttons.slice(0, 6))}`)
      } else {
        check('保持桌面布局（侧栏 + 顶部 Tabs，无底部导航）', !state.hasTabbar && state.hasAside, `tabbar=${state.hasTabbar} aside=${state.hasAside}`)
        check('桌面端保留存储/同步状态栏', state.hasVaultBar && state.hasSyncBar, `vault=${state.hasVaultBar} sync=${state.hasSyncBar}`)
      }
      note('badge', state.badge)
    })

    step('capability', async () => {
      const badge = document.querySelector('[data-testid="capability-badge"]')
      click(badge)
      const dialog = await waitFor(() => document.querySelector('[data-testid="capability-dialog"]'))
      check('能力面板可打开', Boolean(dialog), 'capability-dialog')
      if (!dialog) return
      // 冻结单元 ui-kit 的对话框带 tailwindcss-animate 入场动画：动画帧里的 transform
      // 会顶掉基类的 `-translate-x-1/2`（动画结束后才回到居中，手机宽度上开场那 200ms
      // 会有一半露在屏幕外）。这里量的是「排布稳定后」的尺寸，所以先摘掉动画再量。
      await sleep(320)
      dialog.style.animation = 'none'
      const box = dialog.getBoundingClientRect()
      dialog.style.animation = ''
      const cs = getComputedStyle(dialog)
      const parent = dialog.parentElement
      const parentBox = parent ? parent.getBoundingClientRect() : { left: 0, right: 0 }
      const diag = [
        `rect=${Math.round(box.left)}..${Math.round(box.right)}`,
        `w=${Math.round(box.width)}`,
        `pos=${cs.position}`,
        `left=${cs.left}`,
        `translate=${cs.translate}`,
        `transform=${cs.transform}`,
        `maxW=${cs.maxWidth}`,
        `parent=${parent ? parent.tagName + '[' + Math.round(parentBox.left) + '..' + Math.round(parentBox.right) + ']' : 'none'}`,
        `docClient=${document.documentElement.clientWidth}`,
        `bodyClient=${document.body.clientWidth}`,
      ].join(' ')
      note('capabilityDialog', diag)
      check(
        '能力面板在视口内完整可见（不溢出屏幕）',
        box.left >= -1 && box.right <= window.innerWidth + 1,
        `vw=${window.innerWidth} ${diag}`,
      )
      const rows = [...dialog.querySelectorAll('[data-capability]')].map((el) => ({
        id: el.getAttribute('data-capability'),
        supported: el.getAttribute('data-supported'),
        text: (el.innerText || '').replace(/\s+/g, ' ').trim(),
      }))
      report.rows = rows
      const hostCaps = ['vaultDir', 'zoteroSqlite', 'localPdf', 'rtfClipboard', 'localAi']
      const expect = scenario === 'no-bridge' ? 'false' : 'true'
      const wrong = hostCaps.filter((id) => {
        const row = rows.find((r) => r.id === id)
        return !row || row.supported !== expect
      })
      check(scenario === 'no-bridge' ? '本机能力全部标记为已降级' : '有桥接时本机能力恢复为可用', wrong.length === 0, `异常=${wrong.join(',')}`)
      if (scenario === 'no-bridge') {
        const thin = rows.filter((r) => r.supported === 'false' && !r.text.includes('替代'))
        check('每项降级都写明原因与替代做法', thin.length === 0, `${thin.length} 项缺说明`)
        const badgeText = (document.querySelector('[data-testid="capability-badge"]') || {}).textContent || ''
        check('顶栏徽标显示降级项数量', badgeText.includes('降级'), badgeText.trim())
      } else {
        const badgeText = (document.querySelector('[data-testid="capability-badge"]') || {}).textContent || ''
        check('顶栏徽标显示能力完整', badgeText.includes('完整'), badgeText.trim())
      }
      if (hold) return
      const close = [...dialog.querySelectorAll('button')].find((el) => (el.textContent || '').trim() === '关闭')
      click(close)
      await waitFor(() => !document.querySelector('[data-testid="capability-dialog"]'), 2000)
    })

    step('detail', async () => {
      if (!isPhone) {
        // 桌面：并列视图里右侧是同一份 NoteEditor。
        // 经典模式默认落在「预览」，所见即所得模式直接是编辑器 —— 两种都要各自断言。
        const desktop = await waitFor(
          () => document.querySelector('textarea') || [...document.querySelectorAll('div')].find((el) => el.shadowRoot),
        )
        const state = probe()
        if (editorMode === 'wysiwyg') {
          check('并列视图里的编辑器已渲染（所见即所得）', Boolean(desktop) && !state.preview, `editor=${Boolean(desktop)} preview=${Boolean(state.preview)}`)
        } else {
          const tabs = [...document.querySelectorAll('[role="tab"]')].map((el) => (el.textContent || '').trim())
          const hasPreviewTab = tabs.includes('预览') && tabs.includes('编辑')
          check('并列视图默认预览，且「预览 / 编辑」两个标签页都在', Boolean(state.preview) && hasPreviewTab, `preview=${Boolean(state.preview)} tabs=${tabs.join('/')}`)
        }
        return
      }
      click(document.querySelector('.note-item'))
      const pane = await waitFor(() => document.querySelector('[data-testid="mobile-detail-pane"]'))
      check('点列表项进入详情页', Boolean(pane), 'mobile-detail-pane')
      // 编辑器是懒加载 chunk（Vditor 很大），手机端首次进入要等它真正挂载再断言，
      // 否则量到的是空壳（既没有标签页也没有 shadow 预览）。
      if (editorMode === 'classic') {
        await waitFor(() => document.querySelector('[role="tab"]') && shadowWrite(), 8000)
      } else {
        await waitFor(() => document.querySelector('textarea'), 8000)
      }
      await sleep(150)
      const state = probe()
      LAYOUT(state)
      if (editorMode === 'classic') {
        check('详情页默认预览（不是先落到编辑）且正文不横向溢出', Boolean(state.preview) && state.preview.scroll <= state.preview.client + 1, JSON.stringify(state.preview && { client: state.preview.client, scroll: state.preview.scroll }))
      }
    })

    step('edit', async () => {
      if (!isPhone) {
        const state = probe()
        LAYOUT(state)
        return
      }
      if (editorMode === 'wysiwyg') {
        // 当前代码的默认编辑器：正文即打即排版，没有「预览 / 编辑」标签页
        const field = await waitFor(() => document.querySelector('textarea'))
        check('所见即所得编辑器在手机端渲染出输入区', Boolean(field), `textarea=${Boolean(field)}`)
        if (field) {
          const real = typeLikeUser(field, '示例编辑追加内容')
          await sleep(150)
          const value = (document.querySelector('textarea') || {}).value || ''
          check('所见即所得编辑器接受输入', value.includes('示例编辑追加内容'), `len=${value.length} 真实编辑管线=${real}`)
          note('wysiwygInput', real ? 'execCommand（带光标）' : '合成 input 事件（无光标，可能触发 Vditor 的 getRangeAt 告警）')
        }
        LAYOUT(probe())
        return
      }
      const switched = clickTab('编辑')
      const textarea = await waitFor(() => document.querySelector('textarea'))
      check('切到编辑页且文本框可见', switched && Boolean(textarea), `switched=${switched} textarea=${Boolean(textarea)}`)
      if (!textarea) return
      textarea.focus()
      typeInto(textarea, '示例编辑追加内容')
      await sleep(150)
      const value = (document.querySelector('textarea') || {}).value || ''
      check('编辑输入进入草稿', value.includes('示例编辑追加内容'), `len=${value.length}`)
      const state = probe()
      LAYOUT(state)
    })

    step('preview', async () => {
      if (!isPhone || editorMode === 'wysiwyg') return
      clickTab('预览')
      await sleep(200)
      const write = await waitFor(() => shadowWrite())
      const text = write ? write.innerText : ''
      check('切回预览看到刚输入的编辑', text.includes('示例编辑追加内容'), `preview=${text.slice(0, 80)}`)
      if (write) {
        check('预览正文不横向溢出', write.scrollWidth <= write.clientWidth + 1, `client=${write.clientWidth} scroll=${write.scrollWidth}`)
      }
      const back = document.querySelector('button[title="返回笔记列表"]')
      click(back)
      const list = await waitFor(() => document.querySelector('[data-testid="mobile-list-pane"]'), 2000)
      check('详情页可返回列表', Boolean(list), `listPane=${Boolean(list)}`)
    })

    step('literature', async () => {
      // 文献视图是懒加载 chunk：等结构出现，别用固定 sleep；
      // 点一次可能落在重渲染的间隙（手机端底栏刚换过 pane），所以最多重试三次。
      let list = null
      for (let attempt = 0; attempt < 3 && !list; attempt += 1) {
        if (isPhone) click(document.querySelector('[data-testid="mobile-tab-literature"]'))
        else clickTab('文献')
        list = await waitFor(() => document.querySelector('[data-testid="literature-list"]'), 6000)
      }
      check('文献视图已加载', Boolean(list), `literature-list=${Boolean(list)}`)
      const state = probe()
      const okStructure = isPhone ? state.hasLitCards && !state.hasLitTable : state.hasLitTable
      check(isPhone ? '文献界面使用卡片列表' : '文献界面使用表格', okStructure, JSON.stringify({ cards: state.hasLitCards, table: state.hasLitTable }))
      LAYOUT(state)
    })

    step('pdf', async () => {
      if (scenario !== 'no-bridge') return
      const pdfButton = [...document.querySelectorAll('button')].find((el) => (el.textContent || '').trim().startsWith('PDF'))
      if (!pdfButton) {
        check('文献表存在本机 PDF 徽标', false, '没找到 PDF 徽标')
        return
      }
      click(pdfButton)
      await sleep(250)
      const bodyText = document.body.innerText
      const workspace = Boolean(document.querySelector('[class*="z-[80]"]'))
      const degraded = bodyText.includes('本机服务') && bodyText.includes('不会假装打开成功')
      check('点本机 PDF 徽标明确降级（不进入假装成功的阅读器）', !workspace && degraded, `workspace=${workspace} degraded=${degraded} tail=${bodyText.slice(-200).replace(/\s+/g, ' ')}`)
    })

    step('graph', async () => {
      let canvas = null
      for (let attempt = 0; attempt < 3 && !canvas; attempt += 1) {
        if (isPhone) click(document.querySelector('[data-testid="mobile-tab-graph"]'))
        else clickTab('图谱')
        canvas = await waitFor(() => document.querySelector('canvas, svg'), 6000)
      }
      check('图谱视图已加载', Boolean(canvas), `canvas=${Boolean(canvas)}`)
      const state = probe()
      LAYOUT(state)
    })

    step('storage', async () => {
      if (!isPhone) return
      click(document.querySelector('[data-testid="mobile-tab-settings"]'))
      const dialog = await waitFor(() => document.querySelector('[data-testid="mobile-storage-dialog"]'), 2000)
      check('底部「存储」面板可打开并包含存储状态', Boolean(dialog) && Boolean(dialog.querySelector('[data-testid="data-safety-status"]')), `dialog=${Boolean(dialog)}`)
      if (dialog) {
        const text = (dialog.innerText || '').replace(/\s+/g, ' ')
        check('存储面板写明「本地目录已降级」', text.includes('已降级') || text.includes('本地存储'), text.slice(0, 200))
      }
    })

    const names = steps.map((s) => s.name)
    const limitIndex = stopAt === 'all' ? steps.length : Math.max(1, names.indexOf(stopAt) + 1)
    for (let i = 0; i < limitIndex; i++) {
      try {
        await steps[i].fn()
      } catch (error) {
        check(`步骤 ${steps[i].name} 执行异常`, false, String((error && error.message) || error))
      }
      flush(steps[i].name)
    }
    note('stoppedAfter', names[limitIndex - 1])
    note('steps', names.join(','))
    } catch (error) {
      check('驱动异常', false, String((error && error.stack) || error).slice(0, 400))
    } finally {
      flush('done')
    }
  })()
})()
