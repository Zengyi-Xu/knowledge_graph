import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import postcss from 'postcss'
import selectorParser from 'postcss-selector-parser'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'themes')

for (const [source, target] of [['vue.css', 'vue-light.css'], ['vue-dark.css', 'vue-night.css']]) {
  const css = postcss.parse(readFileSync(path.join(root, 'vendor', source), 'utf8'))
  css.walkAtRules((rule) => {
    if (rule.name === 'import' || rule.name === 'font-face') rule.remove()
  })
  css.walkRules((rule) => {
    rule.selector = selectorParser((selectors) => {
      selectors.each((selector) => {
        selector.walkTags((tag) => {
          if (tag.value === 'html') tag.replaceWith(selectorParser.pseudo({ value: ':host' }))
          if (tag.value === 'body') tag.replaceWith(selectorParser.id({ value: 'write' }))
        })
        selector.walkPseudos((pseudo) => {
          if (pseudo.value === ':root') pseudo.value = ':host'
        })
        const first = selector.at(0)
        if (first?.value !== 'write' && first?.value !== ':host') {
          selector.prepend(selectorParser.combinator({ value: ' ' }))
          selector.prepend(selectorParser.id({ value: 'write' }))
        }
      })
    }).processSync(rule.selector, { lossless: false })
  })
  writeFileSync(path.join(root, target), `/* Adapted from typora-vue-theme (Apache-2.0); see vendor/VUE-LICENSE.txt. */\n${css.toString().trimEnd()}\n`)
}
