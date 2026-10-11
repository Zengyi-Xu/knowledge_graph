// 往 vault 里新增/更新一篇笔记：先把正文落成 md（唯一事实来源），再导出同步用的 JSON。
//
// 用法（先 esbuild 打包）：
//   node .tmp-vault-add/add-note.cjs <vault目录> <标题> <类型> <标签,逗号分隔> <正文md文件>
//
// 类型取值：person | task | skill | question | other
// 同名（或同 id）笔记会被更新，不会重复。
import fs from 'node:fs/promises'
import path from 'node:path'
import { baseNameOf, parseMeta, parseNoteMarkdown, planVaultWrite } from '@/lib/vaultFormat'
import { uid } from '@/types/note'
import type { Note, NoteType } from '@/types/note'
import * as vaultFs from '../electron/vaultFs.cjs'

const TYPES = new Set(['person', 'task', 'skill', 'question', 'other'])

// 与 src/lib/syncFile.ts 的 canonNote 一致
function canonNote(n: Note) {
  return {
    id: n.id,
    title: n.title,
    type: n.type ?? 'other',
    grade: n.grade ?? '',
    tags: Array.isArray(n.tags) ? [...n.tags] : [],
    content: n.content ?? '',
    createdAt: n.createdAt ?? 0,
    updatedAt: n.updatedAt ?? 0,
  }
}

async function main() {
  const [dir, title, type, tagsCsv, bodyFile] = process.argv.slice(2)
  if (!dir || !title || !type || !bodyFile) {
    throw new Error('用法：add-note.cjs <vault目录> <标题> <类型> <标签,逗号分隔> <正文md文件>')
  }
  if (!TYPES.has(type)) throw new Error(`类型必须是 ${[...TYPES].join(' | ')}`)

  const listing = await vaultFs.listVault(dir)
  if (!listing.exists) throw new Error(`vault 目录不存在：${dir}`)
  const index = listing.meta ? parseMeta(listing.meta) : null
  if (!index) throw new Error('vault 里没有可识别的 meta.json')

  const texts = await vaultFs.readVaultFiles(
    dir,
    index.notes.map((e) => e.file),
  )
  const notes: Note[] = []
  const written = new Map<string, { file: string; text: string }>()
  for (const t of texts) {
    if (t.text == null) continue
    const entry = index.notes.find((e) => e.file === t.name)
    if (!entry) continue
    const parsed = parseNoteMarkdown(t.text, baseNameOf(t.name))
    parsed.note.id = entry.id
    notes.push(parsed.note)
    if (!parsed.needsRewrite) written.set(entry.id, { file: t.name, text: t.text })
  }

  const body = (await fs.readFile(bodyFile, 'utf8')).replace(/\r\n/g, '\n').replace(/\s+$/, '')
  const tags = tagsCsv.split(',').map((s) => s.trim().replace(/^#/, '')).filter(Boolean)
  const now = Date.now()
  const at = notes.findIndex((n) => n.title.trim() === title.trim())
  const note: Note = {
    id: at >= 0 ? notes[at].id : uid(),
    title,
    type: type as NoteType,
    grade: at >= 0 ? notes[at].grade : '',
    tags,
    content: body,
    createdAt: at >= 0 ? notes[at].createdAt : now,
    updatedAt: now,
  }
  if (at >= 0) notes[at] = note
  else notes.push(note)

  const plan = planVaultWrite(notes, index.notes, listing.md.map((f) => f.name), written, listing.meta ?? '')
  const result = await vaultFs.writeVault(dir, {
    writes: plan.writes.map((w) => ({ file: w.file, text: w.text })),
    deletes: plan.deletes,
    meta: plan.metaSkipped ? null : plan.meta,
  })

  const json = JSON.stringify(notes.map(canonNote), null, 2)
  const syncPath = path.join(dir, 'sync', 'notes.json')
  await fs.mkdir(path.dirname(syncPath), { recursive: true })
  await fs.writeFile(syncPath, json, 'utf8')
  await fs.writeFile(path.join(process.cwd(), 'public', 'notes.json'), json + '\n', 'utf8')

  console.log(`note: ${title}  (${type}, tags=${tags.join('/') || '无'})`)
  console.log(`writes=${result.written} deletes=${result.deleted} notes=${notes.length}`)
  for (const w of plan.writes) console.log(`  + ${w.file}`)
  for (const d of plan.deletes) console.log(`  - ${d}`)
  console.log(`sync: ${syncPath}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
