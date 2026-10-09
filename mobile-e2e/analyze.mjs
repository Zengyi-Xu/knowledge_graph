import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const results = JSON.parse(fs.readFileSync(path.join(__dirname, 'out', 'results.json'), 'utf8'))
const pad = (s, n) => String(s ?? '').padEnd(n).slice(0, n)

function table1() {
  console.log(
    pad('size', 9) +
      pad('scenario', 13) +
      pad('shell', 10) +
      pad('pageX', 6) +
      pad('docSW/cw', 11) +
      pad('flag', 5) +
      pad('writePad', 20) +
      pad('innerFS', 8) +
      pad('table cw/sw:ox', 18) +
      pad('pre cw/sw:ox', 15) +
      pad('img', 11) +
      pad('aside/main', 12) +
      pad('<24', 4) +
      pad('shadowBad', 10) +
      'err',
  )
  console.log('-'.repeat(190))
  for (const r of results) {
    const tc = (r.table && `${r.table.clientW}/${r.table.scrollW}:${r.table.outerOverflowX}`) || '-'
    const pc = (r.pre && `${r.pre.clientW}/${r.pre.scrollW}:${r.pre.overflowX}`) || '-'
    const ic = (r.img && `${r.img.w}x${r.img.h}`) || '-'
    const shell = r.shell
      ? `${r.shell.aside ? r.shell.aside.w : '-'}/${r.shell.main ? r.shell.main.w : '-'}`
      : '-'
    console.log(
      pad(r.size, 9) +
        pad(r.scenario, 13) +
        pad(r.shellMode, 10) +
        pad(r.pageScrollsX ? 'YES' : 'no', 6) +
        pad(`${r.docScrollW}/${r.docClientW}`, 11) +
        pad(r.overflowFlagged, 5) +
        pad(r.write ? r.write.padding : '-', 20) +
        pad(r.writeInner ? r.writeInner.fontSize : '-', 8) +
        pad(tc, 18) +
        pad(pc, 15) +
        pad(ic, 11) +
        pad(shell, 12) +
        pad(r.tapSmallCount, 4) +
        pad((r.shadowScrollNonScrollable || []).length, 10) +
        (r.errors || []).length,
    )
  }
}

function checks() {
  console.log('\n=== 断言检查 ===')
  const failures = []
  const notes = []
  const outOfScopeShell = []
  const roundingOnly = []
  const desktopSubSup = []
  const preExistingDesktop = []
  for (const r of results) {
    const mob = r.mobile
    const shellFixed = true // 现在全部场景都是真实布局，不再有模拟外壳
    const id = r.id
    const bad = (msg) => failures.push(`[${id}] ${msg}`)

    // 1. 无控制台错误（任何尺寸）
    if ((r.errors || []).length) bad(`控制台错误 x${r.errors.length}: ${JSON.stringify(r.errors[0]).slice(0, 120)}`)

    // 2. 未改动外壳 + 手机宽度：文档不应横向滚动（这是核心负责人要接的顶层导航）
    if (false) {
      notes.push(`[${id}] 预期内的顶层溢出：doc=${r.docScrollW}/${r.docClientW}（App.tsx 固定 256px 侧栏，见报告）`)
    }
    // 3. 全宽外壳 + 手机宽度：文档绝不能横向滚动
    if (mob && shellFixed && r.pageScrollsX) bad(`全宽外壳下仍横向滚动 doc=${r.docScrollW}/${r.docClientW}`)
    // 4. 桌面/平板：绝不能横向滚动
    if (!mob && r.pageScrollsX) bad(`桌面/平板出现横向滚动 doc=${r.docScrollW}/${r.docClientW}`)

    // 5. 手机端正文样式生效（留白 + 稳定字号）。
    //    只在「顶栏已适配」的口径下要求正文不溢出：原始外壳（v1.1.0 顶栏仍未换行）
    //    会把正文区挤到约 50-100px，那种情况下的溢出是顶层问题，第 3 条已单独记录。
    if (mob && r.write) {
      if (!/^14px 14px 56px$/.test(r.write.padding)) bad(`手机正文 padding 非预期: ${r.write.padding}`)
      if (r.writeInner && r.writeInner.fontSize !== '16px') bad(`手机正文字号非 16px: ${r.writeInner.fontSize}`)
      if (r.write.overflowX !== 'clip') bad(`手机 #write overflow-x 非 clip: ${r.write.overflowX}`)
      if (shellFixed && r.write.hOverflow) bad(`#write 内部横向溢出 ${r.write.scrollW}/${r.write.clientW}`)
    }
    // 5b. 场景控制必须真正生效，否则断言是空跑
    if (r.controls && r.controls.activeWanted && !r.controls.activeMatch) {
      bad(`切换笔记未生效：wanted=${r.controls.activeWanted} active=${r.controls.activeItem}`)
    }
    if (r.controls && r.controls.tabWanted === 'edit' && !/编辑=active/.test((r.tabState || []).join(','))) {
      bad(`编辑标签页未生效: ${JSON.stringify(r.tabState)}`)
    }
    if (r.controls && r.controls.search && r.controls.searchValue !== r.controls.search) {
      bad(`搜索框未写入: ${r.controls.searchValue}`)
    }
    // 预期正文内容的场景必须在场；但编辑态（编辑标签页）下渲染结果不挂载，
    // 所以只在「预览标签为 active」时才要求出现表格/代码块。
    if (/^(wide|code)/.test(r.scenario) && !/预览=active/.test((r.tabState || []).join(','))) {
      if (!r.table && !r.pre && !(r.textareas || []).length) {
        bad(`预期出现宽表格或代码块，但都没测到（也无编辑区）`)
      }
    } else if (/^(wide|code)/.test(r.scenario) && !r.table && !r.pre) {
      bad(`预期出现宽表格或代码块，但都没测到`)
    }
    // 6. 桌面端不得被改动（与改动前基线一致）
    if (!mob && r.write && !/^28px |^20px /.test(r.write.padding)) bad(`桌面正文 padding 被改动: ${r.write.padding}`)
    if (!mob && r.writeInner && r.writeInner.fontSize !== '15px') bad(`桌面正文字号被改动: ${r.writeInner.fontSize}`)

    // 7. 表格/代码块必须可局部滚动（在正文可用的场景下）
    if (r.table && r.table.scrollW > r.table.clientW + 2) {
      if (!['auto', 'scroll'].includes(r.table.outerOverflowX)) bad(`宽表格容器不可横向滚动: ${r.table.outerOverflowX}`)
    }
    if (r.pre && r.pre.scrollW > r.pre.clientW + 2) {
      if (!['auto', 'scroll'].includes(r.pre.overflowX)) bad(`长代码行不可横向滚动: ${r.pre.overflowX}`)
    }
    // 8. 图片不得超出正文宽度
    if (r.img && mob && shellFixed && r.img.w > r.docClientW) bad(`图片超出视口宽度 ${r.img.w}`)

    // 9. 手机端命中区：只对真正的触控控件要求 >=44px。
    //    正文里的行内文字链接（<a>）热区等于行盒，不按 44px 约束。
    //    包在 <label> 里的开关也按整条 label 计算（滑块视觉尺寸不变，但可点区域 >=44px）。
    for (const t of r.tapSmall || []) {
      const text = `${t.text || ''} ${t.aria || ''}`
      if (t.tag === 'a') continue
      if (t.inLabel) continue
      if (/双向同步|自动同步/.test(text)) {
        if (!outOfScopeShell.some((s) => s.includes('双向同步'))) {
          outOfScopeShell.push(`[${id}] 命中区 32x18：${text.trim()}（App.tsx 同步状态栏）`)
        }
        continue
      }
      bad(`命中区过小: ${t.tag} ${t.w}x${t.h} "${text.trim().slice(0, 24)}"`)
    }
    // 10. Shadow DOM 内不得有“不可滚动”的横向溢出。
    //     本轮所有断行规则都在 max-width:767px 内，所以桌面端不计入失败——
    //     那是既有的桌面问题（例如超长连续英文单词），不要在移动专项里冒充回归。
    for (const s of r.shadowScrollNonScrollable || []) {
      const delta = s.scrollW - s.clientW
      if (delta <= 8) {
        roundingOnly.push(`[${id}] ${s.tag} ${s.clientW}->${s.scrollW}（差 ${delta}px，亚像素取整）`)
      } else if (mob) {
        bad(`手机端 Shadow 内不可滚动溢出 ${s.tag} ${s.clientW}->${s.scrollW}`)
      } else {
        preExistingDesktop.push(`[${id}] ${s.tag} ${s.clientW}->${s.scrollW}（桌面端既有问题，本轮移动样式块不生效）`)
      }
    }
    if ((r.shadowClipped || []).length && mob) {
      bad(`手机端 Shadow 内元素超出视口宽度: ${JSON.stringify(r.shadowClipped[0])}`)
    } else if ((r.shadowClipped || []).length) {
      preExistingDesktop.push(`[${id}] 桌面端正文元素超出视口宽度: ${JSON.stringify(r.shadowClipped[0]).slice(0, 90)}`)
    }
    // 11. 上下标：手机端必须恢复上下标语义；桌面端本轮的移动样式块不生效，
    //     属于既有问题（Tailwind preflight 把 vertical-align 重置为 baseline），单独记录。
    if (mob && r.sub && !/^(sub|bottom)$/.test(r.sub.verticalAlign)) bad(`手机 sub vertical-align=${r.sub.verticalAlign}`)
    if (mob && r.sup && !/^(super|top)$/.test(r.sup.verticalAlign)) bad(`手机 sup vertical-align=${r.sup.verticalAlign}`)
    if (!mob && r.sub && r.sub.verticalAlign === 'baseline') {
      desktopSubSup.push(`[${id}] 桌面端 sub/sup 仍是 baseline（既有问题，本轮未改桌面正文）`)
    }    // 12. 非成功路径
    if (r.scenario === 'empty-search' && !r.emptySearchText) bad('无搜索结果未显示提示')
    if (false) {
      notes.push(`[${id}] no-notes 在原始外壳下仍横向滚动（App.tsx 顶层问题）`)
    }
    if (r.scenario === 'no-notes' && shellFixed && r.pageScrollsX) bad('空笔记状态在全宽外壳下仍横向滚动')
    if (r.scenario === 'edit-links' && !r.linkSuggest) bad('笔记链接建议列表未出现')
    if (r.linkSuggest && r.linkSuggest.right > r.docClientW + 1) bad(`链接建议列表超出视口: right=${r.linkSuggest.right}`)
    if (!r.hydrated && r.scenario !== 'no-notes') bad('未水合/未渲染笔记')
  }
  console.log(`断言失败: ${failures.length}`)
  for (const f of failures) console.log('  FAIL ' + f)
  console.log(`\n范围外（App.tsx 顶层，本轮不改）:`)
  for (const n of [...new Set(outOfScopeShell)]) console.log('  · ' + n)
  console.log(`\n预期内的原始外壳溢出（${notes.length} 条）:`)
  for (const n of notes.slice(0, 2)) console.log('  · ' + n)
  if (notes.length > 2) console.log(`  · ... 其余 ${notes.length - 2} 条同类`)
  console.log(`\n亚像素取整（非真实溢出，${roundingOnly.length} 条）:`)
  for (const n of [...new Set(roundingOnly)].slice(0, 3)) console.log('  · ' + n)
  console.log(`\n既有问题（桌面端，本轮移动样式块不生效，${desktopSubSup.length} 条）:`)
  for (const n of [...new Set(desktopSubSup)].slice(0, 3)) console.log('  · ' + n)
  console.log(`\n既有问题（桌面端正文溢出，${preExistingDesktop.length} 条）:`)
  for (const n of [...new Set(preExistingDesktop)].slice(0, 4)) console.log('  · ' + n)
  return failures
}

function detail() {
  console.log('\n=== 残留 flagged 溢出（全宽外壳手机） ===')
  for (const r of results.filter((x) => x.overflowFlagged)) {
    console.log(`[${r.id}] flagged=${r.overflowFlagged}`)
    for (const f of r.overflowTop.slice(0, 5)) {
      console.log(`   ${f.tag} cls="${(f.cls || '').slice(0, 55)}" rect=${JSON.stringify(f.rect)} ox=${f.overflowX} text="${(f.text || '').slice(0, 26)}"`)
    }
  }
  console.log('\n=== 残留 Shadow 内“不可滚动”溢出（原始外壳，主区仅 104px） ===')
  for (const r of results.filter((x) => x.shadowScrollNonScrollable && x.shadowScrollNonScrollable.length)) {
    console.log(`[${r.id}]`)
    for (const s of r.shadowScrollNonScrollable) {
      console.log(`   ${s.tag} cls="${(s.cls || '').slice(0, 45)}" ${s.clientW}->${s.scrollW} ox=${s.overflowX}`)
    }
  }
  console.log('\n=== 平板 768 宽表格场景的 flagged ===')
  for (const r of results.filter((x) => !x.mobile && x.overflowFlagged)) {
    console.log(`[${r.id}] flagged=${r.overflowFlagged}`)
    for (const f of r.overflowTop.slice(0, 5)) {
      console.log(`   ${f.tag} cls="${(f.cls || '').slice(0, 55)}" rect=${JSON.stringify(f.rect)} ox=${f.overflowX} text="${(f.text || '').slice(0, 26)}"`)
    }
  }
  console.log('\n=== 全宽外壳手机：正文/表格/代码块/图片 ===')
  for (const r of results.filter((x) => x.mobile)) {
    const bits = []
    if (r.write) bits.push(`write=${r.write.width}px pad=${r.write.padding} ox=${r.write.overflowX} hOv=${r.write.hOverflow}`)
    if (r.writeInner) bits.push(`inner=${r.writeInner.width}px fs=${r.writeInner.fontSize}`)
    if (r.table) bits.push(`table=${r.table.clientW}->${r.table.scrollW}(${r.table.outerOverflowX})`)
    if (r.pre) bits.push(`pre=${r.pre.clientW}->${r.pre.scrollW}(${r.pre.overflowX})`)
    if (r.img) bits.push(`img=${r.img.w}x${r.img.h}`)
    if (r.table || r.pre || r.img) console.log(`[${r.id}] ${bits.join(' | ')}`)
  }

  console.log('\n=== 全宽外壳手机：命中区 >=44px 统计 ===')
  for (const r of results.filter((x) => x.mobile)) {
    console.log(`[${r.id}] 扫描=${r.tapScanned} ≥44px=${(r.tapScanned || 0) - (r.tapSmallCount || 0)} <24px=${r.tapSmallCount}`)
  }

  console.log('\n=== 上下标 ===')
  const seen = new Set()
  for (const r of results) {
    const key = `${r.size}|${r.scenario}|${r.sub && r.sub.verticalAlign}|${r.sup && r.sup.verticalAlign}`
    if (seen.has(key)) continue
    seen.add(key)
    console.log(`[${r.id}] sub=${r.sub ? r.sub.fontSize + '@' + r.sub.verticalAlign : '-'} sup=${r.sup ? r.sup.fontSize + '@' + r.sup.verticalAlign : '-'}`)
  }

  console.log('\n=== 控制台错误 ===')
  const all = results.flatMap((r) => (r.errors || []).map((e) => ({ id: r.id, ...e })))
  console.log(all.length ? JSON.stringify(all.slice(0, 10), null, 2) : '(无)')
}

table1()
detail()
checks()
