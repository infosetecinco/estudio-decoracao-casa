// Builds tools/ui-harness.html (NOT part of the product build): the real shell + CSS + every src/NN-*.js module,
// with tools/ui-harness-stubs.js inserted before 99-boot so missing modules (plan2d / view3d) get stand-ins.
// Usage: node tools/build-ui-harness.js
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const read = (p) => fs.readFileSync(p, 'utf8');

const shell = read(path.join(SRC, 'shell.html'));
const css = fs
  .readdirSync(SRC)
  .filter((f) => f.endsWith('.css'))
  .sort()
  .map((f) => read(path.join(SRC, f)))
  .join('\n');
const vm = require('vm');
// Other engineers deliver modules in parallel: skip any that does not compile yet (half-written file).
const compiles = (f) => {
  try {
    new vm.Script(read(path.join(SRC, f)), { filename: f });
    return true;
  } catch (err) {
    console.warn(`skipping ${f}: ${err.message}`);
    return false;
  }
};
const modules = fs
  .readdirSync(SRC)
  .filter((f) => /^\d\d-.*\.js$/.test(f))
  .sort()
  .filter(compiles);
const stubs = read(path.join(__dirname, 'ui-harness-stubs.js'));
const js = modules
  .map((f) => (f === '99-boot.js' ? `// ---- stubs ----\n${stubs}\n` : '') + `// ---- ${f} ----\n${read(path.join(SRC, f))}`)
  .join('\n');
if (js.toLowerCase().indexOf('</script') >= 0) throw new Error('a module contains "</script"');
if (shell.indexOf('/*__CSS__*/') < 0 || shell.indexOf('//__JS__') < 0) throw new Error('shell markers missing');
const html = shell.replace('/*__CSS__*/', () => css).replace('//__JS__', () => js);
const out = path.join(__dirname, 'ui-harness.html');
fs.writeFileSync(out, html, 'utf8');
console.log(`ui-harness.html: ${Math.round(html.length / 1024)} KB, modules: ${modules.join(', ')}`);
