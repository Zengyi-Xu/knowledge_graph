/* Served only by local-web.mjs, before React loads. Reuses the desktop file API. */
(() => {
  const config = window.__KG_LOCAL_CONFIG__
  delete window.__KG_LOCAL_CONFIG__
  async function call(method, payload = {}) {
    const response = await fetch('/api/local', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-KG-Token': config.token }, body: JSON.stringify({ method, payload }) })
    const body = await response.json()
    if (!response.ok) throw new Error(body.error || '本地服务不可用')
    return body.result
  }
  const selectedVault = () => {
    try { return localStorage.getItem('kg-vault-dir-v1') || config.vault || '' }
    catch { return config.vault || '' }
  }
  const authorize = async (dir) => call('vault:authorize', { dir })
  const authorized = new Map()
  async function inVault(dir, method, payload = {}) {
    if (!authorized.has(dir)) authorized.set(dir, authorize(dir).catch((error) => { authorized.delete(dir); throw error }))
    await authorized.get(dir)
    return call(method, { dir, ...payload })
  }
  function fromBase64(text) { return Uint8Array.from(atob(text), (c) => c.charCodeAt(0)) }
  function toBase64(data) {
    let text = ''
    const bytes = new Uint8Array(data)
    for (let i = 0; i < bytes.length; i += 16384) text += String.fromCharCode(...bytes.subarray(i, i + 16384))
    return btoa(text)
  }
  try { if (!localStorage.getItem('kg-vault-dir-v1') && config.vault) localStorage.setItem('kg-vault-dir-v1', config.vault) }
  catch { /* The local service still supplies the vault when browser storage is full. */ }
  window.knowledgeGraphDesktop = {
    isElectron: false,
    isLocalWeb: true,
    defaultVaultDir: config.vault,
    defaultZoteroDb: config.zoteroDb || '',
    chooseVaultDir: async () => {
      const dir = window.prompt('输入已有笔记目录的完整路径（保留原来的文件分区）：', selectedVault())
      if (!dir?.trim()) return null
      try { return await authorize(dir.trim()) } catch (e) { window.alert(e.message); return null }
    },
    listVault: (dir) => inVault(dir, 'vault:list'),
    readVaultFiles: (dir, names) => inVault(dir, 'vault:read-files', { names }),
    writeVault: (dir, plan) => inVault(dir, 'vault:write', { plan }),
    openVaultDir: (dir) => inVault(dir, 'vault:open-dir'),
    chooseSyncFile: async () => {
      const selected = window.prompt('输入同步 JSON 文件的完整路径：', selectedVault() + '/sync/notes.json')
      if (!selected?.trim()) return null
      try { return await call('sync:authorize', { filePath: selected.trim() }) } catch (e) { window.alert(e.message); return null }
    },
    readSyncFile: async (filePath) => { await call('sync:authorize', { filePath }); return call('sync:read-file', { filePath }) },
    writeSyncFile: async (filePath, contents) => { await call('sync:authorize', { filePath }); return call('sync:write-file', { filePath, contents }) },
    listAttachments: (dir) => inVault(dir, 'attachments:list'),
    readAttachment: async (dir, rel) => { const text = await inVault(dir, 'attachments:read', { rel }); return text === null ? null : fromBase64(text) },
    writeAttachment: (dir, rel, data) => inVault(dir, 'attachments:write', { rel, data: toBase64(data) }),
    removeAttachment: (dir, rel) => inVault(dir, 'attachments:remove', { rel }),
    chooseOpenAttachment: () => new Promise((resolve) => {
      const input = document.createElement('input')
      input.type = 'file'; input.accept = '.pdf'; input.style.display = 'none'; document.body.append(input)
      input.addEventListener('cancel', () => { input.remove(); resolve(null) }, { once: true })
      input.addEventListener('change', async () => {
        const file = input.files?.[0]; input.remove()
        resolve(file ? { filePath: file.name, name: file.name, data: new Uint8Array(await file.arrayBuffer()) } : null)
      }, { once: true })
      input.click()
    }),
    chooseSaveAttachment: async () => null,
    readZotero: (dbPath) => call('zotero:read', { dbPath: dbPath || config.zoteroDb || '' }),
    // 网页端不能指定数据库/文件路径：服务端只用启动时 --zotero-db 授权的库解析 PDF
    openZoteroPdf: (_dbPath, zoteroKey, zoteroKeys) => call('zotero:open-pdf', { zoteroKey, zoteroKeys }),
    readZoteroPdf: async (_dbPath, zoteroKey, zoteroKeys) => {
      const result = await call('zotero:read-pdf', { zoteroKey, zoteroKeys })
      return { ...result, data: fromBase64(result.data) }
    },
    // 标注与子笔记（只读）：附件归属由服务端从授权的 Zotero 库解析
    readZoteroMarkup: (_dbPath, zoteroKey, zoteroKeys) => call('zotero:read-markup', { zoteroKey, zoteroKeys }),
    // Zotero 10+ 本地写入（只增）：服务端持密钥并连 127.0.0.1:23119
    zoteroLocalApi: (request) => call('zotero:local-api', request ?? {}),
    // 笔记 localPdf 字段记录的 PDF：服务端只允许白名单目录内的 .pdf
    openExternalFile: (filePath) => call('file:open-external', { path: filePath }),
    readExternalPdf: async (filePath) => {
      const result = await call('file:read-pdf', { path: filePath })
      return { ...result, data: fromBase64(result.data) }
    },
    // 没有 localPdf / Zotero PDF 的文献：在授权目录里按标题兜底找一份本地 PDF（只提名，不写盘）
    matchLocalPdf: (titles) => call('pdf:match-titles', { titles }),
    // 在 Zotero 里定位条目（zotero:// 协议）
    selectZoteroItem: (zoteroKey) => call('zotero:select-item', { zoteroKey }),
    aiStatus: (request) => call('ai:status', request ?? {}),
    aiComplete: (payload) => call('ai:complete', payload),
    // 浏览器写不了 text/rtf；由本机服务代写剪贴板，Word 才能拿到真域
    writeClipboardRtf: (rtf, text) => call('clipboard:write-rtf', { rtf, text }),
  }
})()
