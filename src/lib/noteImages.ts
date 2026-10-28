/**
 * 正文插图：图片落盘为 vault 内 `attachments/img-<uid>.<ext>`，正文里只写一条短相对路径
 * `![图片](./attachments/img-….png)`（`./` 前缀是 Markdown 解析器放行相对路径的口径，
 * 见 docs/MARKDOWN_RENDERER.md）。浏览器直接拿这个路径加载不到文件，所以渲染层
 * （经典预览 / 所见即所得）统一由 resolveNoteImages 把它们换成 blob URL。
 *
 * 为什么不内嵌 base64：一张截图就是几百 KB 的 data: URL，正文文本膨胀到打不开编辑器。
 */
import { uid } from '@/types/note'
import { resolvedVaultDir } from '@/lib/vaultFs'
import { capability } from '@/lib/capabilities'

/** 正文里插图路径的统一前缀 */
const IMG_PREFIX = './attachments/'

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/bmp': 'bmp',
}

function api() {
  const desk = window.knowledgeGraphDesktop
  if (!desk?.writeAttachment || !desk.readAttachment) throw new Error(capability('vaultAttachments').reason)
  const dir = resolvedVaultDir()
  if (!dir) throw new Error('请先选择笔记目录（插图保存在笔记目录的 attachments/ 里）')
  return { desk, dir }
}

/** 插图能力是否可用（桌面版 / 本机网页服务 + 已选 vault 目录） */
export function noteImagesSupported(): boolean {
  return Boolean(window.knowledgeGraphDesktop?.writeAttachment) && Boolean(resolvedVaultDir())
}

/** 保存一张插图到 vault 的 attachments/，返回写进正文的相对路径 */
export async function saveNoteImage(data: Blob): Promise<string> {
  const { desk, dir } = api()
  const ext = EXT_BY_MIME[data.type] ?? 'png'
  const rel = `attachments/img-${uid()}.${ext}`
  await desk.writeAttachment(dir, rel, new Uint8Array(await data.arrayBuffer()))
  return './' + rel
}

/** 这个 src 是不是本模块负责的 vault 插图路径 */
export function isNoteImageSrc(src: string): boolean {
  return src.startsWith(IMG_PREFIX)
}

/** 已解析的 blob URL 缓存：同一路径只读一次盘（会话级，不释放） */
const blobCache = new Map<string, string>()

/**
 * 把 root 下所有 vault 插图的 src 换成 blob URL（幂等，可在 MutationObserver 里反复调）。
 * 读不到文件的保持原样（预览里显示为裂图，与附件缺失的既有口径一致）。
 */
export function resolveNoteImages(root: ParentNode): void {
  const desk = window.knowledgeGraphDesktop
  if (!desk?.readAttachment) return
  const dir = resolvedVaultDir()
  if (!dir) return
  for (const img of root.querySelectorAll?.('img') ?? []) {
    const raw = img.getAttribute('src') ?? ''
    if (!isNoteImageSrc(raw)) continue
    const cached = blobCache.get(raw)
    if (cached) {
      if (img.getAttribute('src') !== cached) img.src = cached
      continue
    }
    const rel = raw.slice(2) // 去掉 './'，留 attachments/…
    void desk.readAttachment(dir, rel).then((data) => {
      if (!data || !img.isConnected) return
      const ext = rel.split('.').pop() ?? 'png'
      const url = URL.createObjectURL(new Blob([data.buffer as ArrayBuffer], { type: `image/${ext === 'jpg' ? 'jpeg' : ext}` }))
      blobCache.set(raw, url)
      // 异步回来时这张图可能已被重渲染换掉；只有还是同一个元素才直接改
      if (img.getAttribute('src') === raw) img.src = url
    }).catch(() => {
      /* 读失败保持裂图 */
    })
  }
}
