/**
 * 导入弹窗的输入形态判定（纯函数）：DOI / arXiv 二选一由输入本身决定。
 * 与对话框渲染解耦，便于单测（`npm run test:lit-view`）。
 */

/**
 * 输入像不像 arXiv 编号：直接编号（2401.12345）、abs/pdf 链接、带 .pdf 后缀都算。
 * 只用于选路，实际请求仍传用户原始输入（`@/lib/literature` 自己会规范化）。
 */
export function looksLikeArxivId(raw: string): boolean {
  const id = raw.replace(/^https?:\/\/arxiv\.org\/(abs\/)?/i, '').replace(/\.pdf$/i, '')
  return /^\d{4}\.\d{4,5}$/.test(id)
}
