/**
 * AI 统筹的任务模板：构造 system + user prompt。
 * 与 AiProvider 解耦：换模型只改这里的话术，校验/落地层不动。
 */
import type { Note } from '@/types/note'

/** 汇总笔记用「汇总:<一级分类>」标签记住自己覆盖的方向（旧版「方向:X」标签已废弃） */
export const SUMMARY_TAG_PREFIX = '汇总:'

export type AiTask =
  | { kind: 'retag-literature'; scope?: string } // scope = 分类路径（collections 首段起），空为全库
  | { kind: 'health-check' }
  | { kind: 'generate-summary'; direction: string } // direction = 一级分类（collections 首段）
  | { kind: 'update-summary'; noteId: string }

const OPS_CONTRACT = `你只允许输出一个 JSON 对象（不要输出任何其他文字、不要用 markdown 代码块之外的文字）：
{"operations":[...]}
操作类型三种：
- {"type":"create","noteType":"summary","title":"...","tags":["..."],"content":"...markdown..."} —— 新建笔记
- {"type":"update","id":"...","content":"...","tags":["..."]} —— id 必填，正文整篇替换
- {"type":"retag","id":"...","addTags":["..."],"removeTags":["..."]} —— id 必填
注意：标签用「前缀:值」格式；正文里的文献引用一律用 [[文献标题]] 双链。`

const litSnapshot = (n: Note) => ({
  id: n.id,
  title: n.title,
  year: n.literature?.year ?? '',
  venue: n.literature?.venue ?? '',
  authors: n.literature?.authors ?? [],
  collections: n.literature?.collections ?? [],
  tags: n.tags,
})

/** 文献清单 JSON，超限时返回 null（调用方应缩小范围） */
function litListJson(notes: Note[], maxChars = 150_000): string | null {
  const text = JSON.stringify(notes.map(litSnapshot), null, 1)
  return text.length > maxChars ? null : text
}

export function buildTask(
  task: AiTask,
  notes: Note[],
): { system: string; prompt: string; needsOps: boolean } {
  const literature = notes.filter((n) => n.type === 'literature')
  const base = '你是知识图谱笔记软件的统筹助手。改动必须保守、可解释、幂等（重复运行不产生重复标签）。'

  switch (task.kind) {
    case 'retag-literature': {
      const scoped = task.scope
        ? literature.filter((n) =>
            n.literature?.collections.some((c) => c === task.scope || c.startsWith(`${task.scope}/`)),
          )
        : literature
      const list = litListJson(scoped)
      if (!list) throw new Error('范围内的文献太多，请先按「分类」缩小范围')
      return {
        system: `${base} ${OPS_CONTRACT}`,
        prompt: `下面是应用内的文献清单（JSON：id/标题/年份/期刊/作者/Zotero分类collections/现有标签tags）。\n请检查每篇文献的标签质量：\n1. 有 venue 补「期刊:venue」、有年份补「年份:年份」；\n2. 修正明显错误的标签（大小写不一致、前缀写错）；\n3. 删掉与 collections 不符的旧标签（例如 collections 里已经不存在的分类）。\n注意：不要新增「方向:」标签 —— 分类由 collections 承担。\n只对有必要的文献输出 retag 操作，宁缺毋滥。\n\n${list}`,
        needsOps: true,
      }
    }
    case 'health-check':
      return {
        system: `${base} 你的输出是给用户直接阅读的中文 Markdown 报告，不要输出 JSON。`,
        prompt: `下面是全部笔记的清单（JSON：id/标题/类型/标签/正文里的双链 [[...]]）。请做图谱健康检查并输出报告：\n1. 孤立文献（没有任何双链、没有任何标签）；\n2. 断链（[[...]] 指向不存在的标题）；\n3. 疑似重复（标题高度相似）；\n4. 缺汇总的一级分类（某篇文献 collections 的首段没有任何 summary 笔记覆盖）。\n每条给出建议操作。\n\n${JSON.stringify(
          notes.map((n) => ({ id: n.id, title: n.title, type: n.type, tags: n.tags, links: n.content.match(/\[\[[^\]]+\]\]/g) ?? [] })),
          null,
          1,
        )}`,
        needsOps: false,
      }
    case 'generate-summary':
    case 'update-summary': {
      const isUpdate = task.kind === 'update-summary'
      const existing = isUpdate ? notes.find((n) => n.id === task.noteId) : undefined
      const direction = isUpdate
        ? (existing?.tags.find((t) => t.startsWith(SUMMARY_TAG_PREFIX))?.slice(3) ?? task.noteId)
        : task.direction
      const inScope = literature.filter((n) =>
        n.literature?.collections.some((c) => c.split('/')[0].trim() === direction),
      )
      const list = litListJson(inScope, 200_000)
      if (!list) throw new Error('该方向的文献太多，暂不支持生成汇总')
      return {
        system: `${base} ${OPS_CONTRACT}`,
        prompt: `方向「${direction}」下共有 ${inScope.length} 篇文献（JSON 清单附后）。请${
          isUpdate ? '改写已有的这篇汇总笔记' : '新建一篇「汇总」类型笔记'
        }，要求：\n1. 标题概括方向与范围${isUpdate && existing ? `（现标题「${existing.title}」，可微调）` : ''}；\n2. 正文为 Markdown：该方向文献分组清单（用 [[文献标题]] 双链）、研究趋势几句话、值得优先读的 Top-5 及一句理由；\n3. tags 至少含「${SUMMARY_TAG_PREFIX}${direction}」，用来记住这篇汇总覆盖哪个一级分类。\n\n${list}`,
        needsOps: true,
      }
    }
  }
}
