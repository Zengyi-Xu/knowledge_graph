/** citation-js 主包不带类型声明（module.exports 就是 Cite 类），这里补一个最小声明 */
declare module 'citation-js' {
  import type { Cite as CiteCore } from '@citation-js/core'

  const Cite: typeof CiteCore
  export default Cite
}
