/**
 * 阅读面板（Shadow DOM 内）的样式拼装。
 *
 * 拆成独立模块的原因：MarkdownRenderer 的视觉检查脚本（scripts/md-visual.mjs）
 * 需要复用完全相同的 CSS，避免"检查用的样式"和"真实渲染的样式"不一致。
 *
 * 顺序：Markdown 基础排版 → 主题 → 自定义 CSS。后加载的同优先级规则会覆盖前者。
 * Tailwind（含 preflight）由 PreviewContent 单独插在最前面。
 */
import markdownBaseStyles from '@/markdown-base.css?inline'
import vueLightStyles from '@/themes/vue-light.css?inline'
import vueNightStyles from '@/themes/vue-night.css?inline'

export type PreviewTheme = 'default' | 'paper' | 'night' | 'vue-light' | 'vue-night' | 'custom'

export const MARKDOWN_BASE_CSS = markdownBaseStyles

export const themeStyles: Record<Exclude<PreviewTheme, 'custom'>, string> = {
  default: `
    #write { background: #fff; color: #202428; font-family: system-ui, sans-serif; }
    #write a, #write button { color: #087e84; }
    #write { --md-link: #087e84; --md-code-bg: rgba(9, 126, 132, 0.09); --md-code-color: #0a6b70;
      --md-fence-bg: #f7f8f8; --md-border: #dfe3e4; --md-fence-border: #e3e7e8;
      --md-quote-border: #b9d5d3; --md-table-head: #f2f6f5; --md-table-stripe: #fafcfb; }
  `,
  paper: `
    #write { background: #fcfaf5; color: #273430; font-family: Georgia, "Noto Serif CJK SC", serif; line-height: 1.8; }
    #write h1, #write h2, #write h3 { color: #146b69; }
    #write a, #write button { color: #ad503a; }
    #write pre, #write code { background: #f0ede5; }
    #write blockquote { border-color: #d67c5e; color: #52605b; }
    #write { --md-link: #ad503a; --md-border: #e0d8c8; --md-fence-bg: #f3efe6;
      --md-fence-border: #e3dbcb; --md-quote-border: #d67c5e; --md-code-bg: #f0ede5;
      --md-code-color: #9c462f; --md-table-head: #f2eee5; --md-table-stripe: #f8f5ee; }
  `,
  night: `
    #write { background: #202827; color: #e4e9e5; font-family: system-ui, sans-serif; }
    #write h1, #write h2, #write h3 { color: #a8d8c6; }
    #write a, #write button { color: #9bd5cb; }
    #write pre, #write code, #write th { background: #303d3a; color: #e4e9e5; }
    #write blockquote { color: #b2c4ba; }
    #write td, #write th, #write img { border-color: #53635c; }
    #write { --md-text: #e4e9e5; --md-muted: #b2c4ba; --md-border: #53635c; --md-link: #9bd5cb;
      --md-code-bg: #303d3a; --md-code-color: #f0b7a4; --md-fence-bg: #283230;
      --md-fence-border: #44524d; --md-quote-border: #53635c; --md-mark-bg: #6b5d1f;
      --md-table-head: #303d3a; --md-table-stripe: #26302e; }
  `,
  'vue-light': vueLightStyles,
  'vue-night': vueNightStyles,
}

/**
 * vue-light / vue-night 里 h1 没有下边框（只有 h2 有）。
 * 基础排版给 h1/h2 都加了下边框，这里按 Typora 主题原样还原。
 */
const VUE_FIXUPS = `
  /* 基础排版里的配色变量按主题给值：vue 主题只覆盖自己声明的选择器，
     不会覆盖前一道基础样式，所以变量要在主题之后按配色补上。 */
  #write {
    --md-text: #34495e; --md-muted: #777777; --md-border: #dfe2e5; --md-link: #42b983;
    --md-code-bg: #f8f8f8; --md-code-color: #e96900; --md-fence-bg: #f8f8f8;
    --md-fence-border: #f4f4f4; --md-quote-border: #42b983; --md-mark-bg: #ebffeb;
    --md-table-head: #f2f2f2; --md-table-stripe: #fafafa;
  }
  #write h1 { border-bottom: none; }
`

/** vue-night 的深色配色变量（对应 typora-vue-theme 的暗色版） */
const VUE_NIGHT_FIXUPS = `
  #write {
    --md-text: #aaaaaa; --md-muted: #888888; --md-border: hsl(210, 10%, 11%);
    --md-link: #42b983; --md-code-bg: hsl(0, 0%, 10%); --md-code-color: #f3b37f;
    --md-fence-bg: hsl(0, 0%, 10%); --md-fence-border: hsl(0, 0%, 11%);
    --md-quote-border: #42b983; --md-mark-bg: #3d3d1f;
    --md-table-head: hsl(0, 0%, 9%); --md-table-stripe: hsl(0, 0%, 10%);
  }
  #write h1 { border-bottom: none; }
`

/** 面板自身的布局 + 代码块配色变量 + 手机端覆盖 */
const LAYOUT_CSS = `
  :host { display: block; min-height: 100%; }
  #write { box-sizing: border-box; min-height: 100%; margin: 0 auto; padding: 28px clamp(20px, 5%, 64px) 64px; }
  #write > div { max-width: 820px; margin: 0 auto; font-size: 15px; line-height: 1.7; }
  #write button { cursor: pointer; font: inherit; }
  /* 代码块底色按阅读主题给出（正文里的 pre 不随主题变化时，夜读/Vue 深色下会变成浅灰底 + 浅色字，几乎不可读）。
     变量只放在正文样式边界内，自定义主题可用同名变量覆盖。 */
  #write {
    --write-code-bg: #f8f8f8;
    --write-code-color: inherit;
    --write-inline-code-color: #e96900;
  }
`

const MOBILE_CSS = `
  @media (max-width: 767px) {
    #write {
      /* 手机留白：主题自带 20px 30px 100px / clamp(20px,5%,64px)，手机上过宽 */
      padding: 14px 14px 56px;
      /* vue-light/vue-night 自带 overflow-x: hidden，这里改为 clip：
         保持"不出现正文横向滚动条"，同时不以 hidden 掩盖布局溢出 */
      overflow-x: clip;
      max-width: none;
    }
    #write > div {
      max-width: 100%;
      font-size: 16px;
      line-height: 1.75;
    }
    /* 长链接、长连续英文单词不得撑宽正文；pre/code 不参与断行（见下） */
    #write p, #write h1, #write h2, #write h3, #write h4, #write h5, #write h6,
    #write li, #write blockquote, #write dd, #write dt, #write figcaption {
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    /* 代码块局部横向滚动，而不是撑宽或截断 */
    #write pre {
      overflow-x: auto;
      max-width: 100%;
      -webkit-overflow-scrolling: touch;
      background-color: var(--write-code-bg) !important;
      color: var(--write-code-color) !important;
      border-radius: 6px;
    }
    #write pre code {
      white-space: pre;
      background-color: transparent !important;
      color: inherit !important;
    }
    #write code {
      overflow-wrap: normal;
      word-break: keep-all;
      color: var(--write-inline-code-color);
    }
    /* 表格在自身容器内横向滚动；单元格内的超长链接/长单词允许断行，
       否则一个超长 URL 会把表格和整页撑宽（平板宽度下也会发生） */
    #write .md-table { overflow-x: auto; }
    #write .md-table table { min-width: max-content; max-width: none; }
    #write table :is(th, td) {
      padding: 6px 8px;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    #write img, #write video {
      max-width: 100% !important;
      max-height: none !important;
      height: auto !important;
      box-sizing: border-box;
    }
    /* 标题按手机可读字号重排，不用视口宽度缩放字体 */
    #write h1 { font-size: 1.45rem; line-height: 1.35; }
    #write h2 { font-size: 1.25rem; line-height: 1.4; }
    #write h3 { font-size: 1.1rem; line-height: 1.45; }
    /* 引用与列表左右缩进收敛 */
    #write blockquote { margin-left: 0; margin-right: 0; padding: 8px 12px; }
    #write ul, #write ol { padding-left: 1.4em; }
    /* 任务列表 checkbox 不再顶到负边距，避免手机上被裁掉 */
    #write .md-task-checkbox { margin-left: -1.15em; }
    /* 上下标：Tailwind preflight 把所有元素重置为 vertical-align: baseline，
       这里在正文样式边界内恢复上下标语义（不影响正文以外的界面） */
    #write sub { vertical-align: sub; font-size: 0.78em; }
    #write sup { vertical-align: super; font-size: 0.78em; }
  }
`

/** 代码块底色（夜读 / Vue 深色 / 纸质），按主题给出 */
function codeVars(theme: PreviewTheme): string {
  if (theme === 'night') return '#write { --write-code-bg: #303d3a; --write-code-color: #e4e9e5; }'
  if (theme === 'vue-night') {
    return '#write { --write-code-bg: hsl(0, 0%, 10%); --write-code-color: hsl(0, 0%, 85%); --write-inline-code-color: #f3b37f; }'
  }
  if (theme === 'paper') {
    return '#write { --write-code-bg: #f0ede5; --write-code-color: #273430; --write-inline-code-color: #ad503a; }'
  }
  if (theme === 'custom') return '#write { --write-code-color: #e96900; }'
  return ''
}

/** 阅读面板 Shadow DOM 里的全部 CSS（不含 Tailwind 基础层） */
export function previewCss(theme: PreviewTheme, customCss = ''): string {
  const themeCss = theme === 'custom' ? themeStyles.default : themeStyles[theme]
  const fixup = theme === 'vue-light' ? VUE_FIXUPS : theme === 'vue-night' ? VUE_NIGHT_FIXUPS : ''
  return [
    MARKDOWN_BASE_CSS,
    LAYOUT_CSS,
    codeVars(theme),
    themeCss,
    fixup,
    MOBILE_CSS,
    theme === 'custom' ? customCss : '',
  ]
    .filter(Boolean)
    .join('\n')
}
