/* 知识图谱 PWA Service Worker（移动端第一阶段）。
 *
 * 目标：让「添加到主屏」后的应用能在断网时打开界面（离线壳），同时**绝不**
 * 干扰本机服务的动态内容。
 *
 * 策略：
 * - 导航请求（打开页面）：网络优先；只有网络失败时才用缓存的壳。这样升级后
 *   第一次打开就拿到新界面，不会出现「强刷还是旧界面」。
 * - 静态资源（同源 /assets/*、/vditor/*、图标、字体）：缓存优先 + 后台更新，
 *   文件名带内容哈希，天然可长期缓存。
 * - 一律跳过：/api/*、/local-bridge.js、带 `X-KG-No-Cache` 响应头的任何内容。
 *   本地网页端注入的 index.html 带这个头（里面有本次启动的访问令牌），
 *   缓存住旧令牌会让所有本机操作 403 —— 所以它永远不落缓存。
 * - 只处理同源 GET；跨域请求（在线文献检索）原样放行。
 */
const CACHE = 'kg-shell-v1'
const SHELL_URLS = ['./', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png']
const STATIC_PREFIXES = ['./assets/', './vditor/', './icons/']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => Promise.all(SHELL_URLS.map((url) => cache.add(new Request(url, { cache: 'reload' })).catch(() => null))))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

const isStatic = (url) => STATIC_PREFIXES.some((prefix) => url.pathname.includes(prefix.replace('./', '/')))

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/') || url.pathname.endsWith('/local-bridge.js')) return

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // 本地网页端注入过内容的页面：不缓存（内含本次启动的访问令牌）
          if (response.headers.get('X-KG-No-Cache')) {
            caches.open(CACHE).then((cache) => cache.delete('./')).catch(() => {})
            return response
          }
          if (response.ok) {
            const copy = response.clone()
            caches.open(CACHE).then((cache) => cache.put('./', copy)).catch(() => {})
          }
          return response
        })
        .catch(async () => {
          const cached = await caches.match('./')
          return (
            cached ??
            new Response('离线，且还没有缓存过界面。请先联网打开一次。', {
              status: 503,
              headers: { 'Content-Type': 'text/plain; charset=utf-8' },
            })
          )
        }),
    )
    return
  }

  if (!isStatic(url)) return

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone()
            caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {})
          }
          return response
        })
        .catch(() => cached ?? Response.error())
      return cached ?? network
    }),
  )
})
