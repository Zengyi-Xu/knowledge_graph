import fs from 'node:fs'
const r = JSON.parse(fs.readFileSync('mobile-e2e/out/results.json', 'utf8'))
const mob = r.filter((x) => x.mobile)
const shell = mob.filter((x) => x.shellMode === 'mobile')
console.log('total', r.length, 'mobile', mob.length, 'shell-mobile', shell.length)
console.log('console errors total:', r.reduce((a, x) => a + (x.errors || []).length, 0))
console.log('settled:', r.filter((x) => x.controlsSettled).length)
console.log('shell-mobile pageScrollsX:', shell.filter((x) => x.pageScrollsX).length)
console.log('shell-mobile flagged:', shell.reduce((a, x) => a + x.overflowFlagged, 0))
console.log('original pageScrollsX:', r.filter((x) => x.shellMode === 'original' && x.pageScrollsX).length)
// desktop regression values
for (const x of r.filter((y) => !y.mobile)) {
  console.log('DESKTOP', x.id, 'pad=' + (x.write && x.write.padding), 'fs=' + (x.writeInner && x.writeInner.fontSize), 'scrollX=' + x.pageScrollsX)
}
// mobile details
for (const x of shell) {
  const bits = []
  if (x.write) bits.push(`w=${x.write.width} pad=${x.write.padding} ox=${x.write.overflowX} hOv=${x.write.hOverflow}`)
  if (x.writeInner) bits.push(`inner=${x.writeInner.width} fs=${x.writeInner.fontSize}`)
  if (x.table) bits.push(`table=${x.table.clientW}->${x.table.scrollW}(${x.table.outerOverflowX})`)
  if (x.pre) bits.push(`pre=${x.pre.clientW}->${x.pre.scrollW}(${x.pre.overflowX}) bg=${x.pre.bg} fg=${x.pre.color}`)
  if (x.img) bits.push(`img=${x.img.w}x${x.img.h}`)
  if (x.tapScanned) bits.push(`tap=${x.tapScanned - (x.tapSmallCount || 0)}/${x.tapScanned}`)
  console.log('MOB', x.id, bits.join(' | '))
}
console.log('--- tap small (mobile) ---')
for (const x of shell) {
  for (const t of x.tapSmall || []) console.log('  ', x.id, t.tag, t.w + 'x' + t.h, JSON.stringify((t.text || t.aria || '').slice(0, 20)))
}
console.log('--- sub/sup ---')
for (const x of r.filter((y) => y.sub).slice(0, 3)) console.log('  ', x.id, JSON.stringify(x.sub), JSON.stringify(x.sup))
