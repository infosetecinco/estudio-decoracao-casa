"""Bundle src/ into one self-contained HTML file.

src/shell.html must contain the markers  /*__CSS__*/  (inside a <style>) and  //__JS__  (inside a classic <script>).
All src/*.css are concatenated in name order; all src/NN-*.js are concatenated in name order.
Usage:  python tools/build.py  [out.html]
"""
import pathlib, sys, re

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / 'src'
out = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'casa-decoracao.html'

shell = (SRC / 'shell.html').read_text(encoding='utf-8')
css = '\n'.join(f'/* ---- {p.name} ---- */\n' + p.read_text(encoding='utf-8') for p in sorted(SRC.glob('*.css')))
js_files = sorted(p for p in SRC.glob('*.js') if re.match(r'^\d\d-', p.name))
js = '\n'.join(f'// ---- {p.name} ----\n' + p.read_text(encoding='utf-8') for p in js_files)
if '</script' in js.lower():
    sys.exit('ERROR: a JS module contains "</script" — split the string (e.g. "<\\/script>").')
if '/*__CSS__*/' not in shell or '//__JS__' not in shell:
    sys.exit('ERROR: shell.html is missing /*__CSS__*/ or //__JS__ markers')
html = shell.replace('/*__CSS__*/', css).replace('//__JS__', js)
out.write_text(html, encoding='utf-8')
print(f'built {out.name}: {len(html)//1024} KB from {len(js_files)} js modules + {len(list(SRC.glob("*.css")))} css')
