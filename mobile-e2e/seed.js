/**
 * 合成测试数据种子。
 * 在应用模块加载之前写入 localStorage，使 useNotes 的初始 state 即为合成数据，
 * 从而不会渲染 public/notes.json 中的任何真实笔记。
 * 所有标题、标签、正文均为人工编造的占位内容（“示例”“测试”）。
 */
;(function () {
  var params = new URLSearchParams(location.search)
  var scenario = params.get('scenario') || 'default'
  document.documentElement.setAttribute('data-test-scenario', scenario)

  var VARIANTS = {
    default: {},
    night: { theme: 'night' },
    paper: { theme: 'paper' },
    'vue-light': { theme: 'vue-light' },
    'vue-night': { theme: 'vue-night' },
    custom: { theme: 'custom', customCss: true },
    edit: { theme: 'default', tab: 'edit' },
    'edit-links': { theme: 'default', tab: 'edit', suggest: true },
    'empty-search': { theme: 'default', search: 'zzz-不存在的关键字-zzz' },
    'no-notes': { theme: 'default', emptyFlag: true },
    'long-list': { theme: 'default', only: 1 },
    'many-tags': { theme: 'default', manyTags: true },
    wide: { theme: 'default', activeTitle: '示例项目 材料数据库' },
    'wide-night': { theme: 'night', activeTitle: '示例项目 材料数据库' },
    'wide-vue': { theme: 'vue-light', activeTitle: '示例项目 材料数据库' },
    code: { theme: 'default', activeTitle: '示例技能 PyTorch' },
    'code-night': { theme: 'vue-night', activeTitle: '示例技能 PyTorch' },
    'code-paper': { theme: 'paper', activeTitle: '示例技能 PyTorch' },
    'code-custom': { theme: 'custom', customCss: true, activeTitle: '示例技能 PyTorch' },
    'wide-edit': { theme: 'default', tab: 'edit', activeTitle: '示例项目 材料数据库' },
  }

  var FREE_URL =
    'https://example.com/a/very/long/path/segment/that/should/never/widen/the/page/example-example-example?alpha=1&beta=2&gamma=3'
  var LONG_URL =
    'https://example.invalid/' + 'verylongpathsegment'.repeat(9) + '/end-of-the-long-url'
  var LONGWORD = 'Supercalifragilisticexpialidocious' + 'Antidisestablishmentarianism'.repeat(3)
  var IMG =
    'data:image/svg+xml;base64,' +
    'PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI4MDAiIGhlaWdodD0iNjAwIj48cmVjdCB3aWR0aD0iODAwIiBoZWlnaHQ9IjYwMCIgZmlsbD0iI2RkZWVmZiIvPjxjaXJjbGUgY3g9IjQwMCIgY3k9IjMwMCIgcj0iMjAwIiBmaWxsPSIjNDQ4OGZmIi8+PHRleHQgeD0iNDAwIiB5PSIzMjAiIGZvbnQtc2l6ZT0iNDgiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZpbGw9IiNmZmZmZmYiPua1i+ivleWbvueJhzwvdGV4dD48L3N2Zz4='

  var LONG_TITLE =
    '示例测试笔记：这是一条非常非常长的中文标题用来检查手机上标题换行是否会挤压右侧图标与元数据 一二三四五六七八九十'

  function note(id, title, type, grade, tags, content, updatedAt) {
    return {
      id: 'fix-' + id,
      title: title,
      type: type,
      grade: grade,
      tags: tags,
      content: content,
      createdAt: 1700000000000 + id * 1000,
      updatedAt: updatedAt || 1700000000000 + id * 1000,
    }
  }

  var T0 = 1700000000000

  var notes = [
    note(
      1,
      '示例人物 长标题测试',
      'person',
      'phd',
      ['示例', '机器学习', '电镜', '流片', '组会'],
      '示例人物笔记正文。这是**加粗**、*斜体*、`行内代码`、~~删除线~~ 的渲染检查。\n\n## 小节标题\n\n- 列表项一\n- [ ] 待办项\n- [x] 已完成项\n\n> 引用示例：这是一段引用文字。\n\n关联：[[示例项目 材料数据库]]、[[示例技能 PyTorch]]、[[示例技能 不存在]]\n\n化学式 H<sub>2</sub>O，平方 x<sup>2</sup> + y<sup>2</sup> = z<sup>2</sup>。\n\n标签写法 #示例 与 #机器学习。',
      T0 + 50000,
    ),
    note(
      2,
      LONG_TITLE,
      'other',
      '',
      ['示例', '超长标题', '换行测试'],
      '用于检查超长中文标题在手机列表与编辑头部是否换行且不挤压图标。\n\n' + LONGWORD,
      T0 + 49000,
    ),
    note(
      3,
      '示例项目 材料数据库',
      'task',
      '',
      ['示例', '数据库', '任务'],
      '示例项目笔记。\n\n## 宽表格检查\n\n| 表头一 | 表头二 | 表头三 | 表头四 | 表头五 | 表头六 |\n|:---|:---:|---:|---|---|---|\n| 很长的单元格内容用于撑宽表格 | 数据 B | 数据 C | 数据 D | 数据 E | 数据 F |\n| 第二行很长的单元格内容也用于撑宽表格 | 1234567890 | 数据 C2 | 数据 D2 | 数据 E2 | 数据 F2 |\n\n## 长链接\n\n[这是一个很长的链接文本](https://example.com/' +
        'a-very-long-path-segment'.repeat(8) +
        ')\n\n' +
        LONG_URL +
        '\n\n关联：[[示例人物 长标题测试]]',
      T0 + 48000,
    ),
    note(
      4,
      '示例技能 PyTorch',
      'skill',
      '',
      ['示例', '编程'],
      '示例技能笔记。\n\n## 代码块检查\n\n```python\nimport torch\nmodel = torch.nn.Sequential(*[torch.nn.Linear(1024, 1024) for _ in range(4)])\nprint("这是一行非常长的代码用来检查代码块是否局部横向滚动而不撑宽整个页面", model)\n```\n\n## 图片检查\n\n![示例图片](' +
        IMG +
        ')\n\n行内很长的连续英文单词：' +
        LONGWORD +
        '\n\n关联：[[示例人物 长标题测试]]',
      T0 + 47000,
    ),
    note(
      5,
      '示例求问 学习路线',
      'question',
      '',
      ['示例', '求问'],
      '示例求问笔记。\n\n化学式 H<sub>2</sub>O，数学式 x<sup>2</sup>，上下标应当正常显示。\n\n1. 有序列表一\n2. 有序列表二\n\n关联：[[示例技能 PyTorch]]',
      T0 + 46000,
    ),
    note(6, '示例其他 空白笔记', 'other', '', [], '', T0 + 45000),
    note(
      7,
      '示例人物 硕士生示例',
      'person',
      'master',
      ['示例', '人物'],
      '示例人物笔记（硕士生）。关联：[[示例项目 材料数据库]]',
      T0 + 44000,
    ),
    note(
      8,
      '示例人物 教授示例',
      'person',
      'pi',
      ['示例'],
      '示例人物笔记（教授）。关联：[[示例人物 硕士生示例]]',
      T0 + 43000,
    ),
    note(
      9,
      '示例任务 流片测试',
      'task',
      '',
      ['示例', '流片'],
      '示例任务笔记。关联：[[示例人物 教授示例]]、[[示例技能 PyTorch]]',
      T0 + 42000,
    ),
    note(
      10,
      '示例技能 电镜操作',
      'skill',
      '',
      ['示例', '电镜'],
      '示例技能笔记。关联：[[示例任务 流片测试]]',
      T0 + 41000,
    ),
  ]

  var v = VARIANTS[scenario] || {}
  if (v.only) notes = notes.slice(0, v.only)
  if (v.manyTags) {
    notes[0].tags = [
      '示例',
      '标签二',
      '标签三',
      '标签四',
      '标签五',
      '标签六',
      '标签七',
      '标签八',
    ]
  }
  if (v.emptyFlag) notes = []

  // 必须早于 useNotes 的初始 state
  try {
    localStorage.clear()
    if (v.emptyFlag) {
      localStorage.setItem('kaust-knowledge-graph-empty', '1')
    }
    localStorage.setItem('kaust-knowledge-graph-notes-v1', JSON.stringify(notes))
    // 阅读主题的存储键在 v1.1.0 去掉了 kaust- 前缀
    if (v.theme) localStorage.setItem('note-graph-preview-theme-v1', v.theme)
    if (v.customCss) {
      localStorage.setItem(
        'note-graph-custom-preview-theme-v1',
        JSON.stringify({
          name: '示例自定义主题',
          css: '#write { background: #f2f7ff; color: #1b2a4a; max-width: 900px; padding: 10px 40px 40px; overflow-x: hidden; }\n#write h1, #write h2 { color: #2a4d8f; }\n#write table { width: 1200px; }\n#write img { width: 1400px; }\n#write a { color: #b45309; }\n#write pre, #write code { background: #e6eefc; }',
        }),
      )
    }
    // 笔记列表是否展开（v1.1.0 新增，App.tsx 用它做手机端整栏折叠）
    localStorage.setItem('note-graph-list-open', v.listClosed ? '0' : '1')
    if (v.tab) localStorage.setItem('__test_tab', v.tab)
    if (v.search) localStorage.setItem('__test_search', v.search)
    if (v.suggest) localStorage.setItem('__test_suggest', '1')
    if (v.activeTitle) localStorage.setItem('__test_active', v.activeTitle)
  } catch (e) {
    document.documentElement.setAttribute('data-seed-error', String(e && e.message))
  }
})()
