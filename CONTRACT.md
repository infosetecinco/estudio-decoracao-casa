# Casa — Estúdio de Decoração · Integration contract

A **single self-contained HTML file** (`casa-decoracao.html`) that lets the owner decorate the approved house plan
(3 floors) in 2D and 3D. All UI text is **Brazilian Portuguese**. The file is bundled by `python tools/build.py`
from `src/` (see "Build"). Read `src/00-data.js` and `src/01-core.js` fully before writing code — they are the
source of truth and are already tested (`node tools/test-core.js`: all 18 plan room areas match exactly).

## 0. Hard rules for every module
- Each JS module is a classic-script IIFE: `(function(){ const DD = window.DD; ... DD.xxx = {...}; })();`
  No `import`/`export` statements, no top-level `await`, no bundler. Modules are concatenated in file-name order
  into ONE classic `<script>`: `00-data, 01-core, 10-materials, 11-catalog, 12-furniture3d, 20-plan2d, 30-view3d,
  40-ui, 99-boot`. A module may reference other `DD.*` namespaces only inside functions (they all exist by the
  time `99-boot.js` calls `init`).
- **Never write the string `</script` in JS** (build refuses). No `localStorage` except via `DD.persist`.
- **Immutability**: the document (`DD.store.doc`) is never mutated. Produce new objects (`DD.ops.update/add/remove`,
  spreads) and hand them to the store. Never keep a stale reference and mutate it.
- External resources allowed: three.js via the import map (below), Google Fonts (Space Grotesk, JetBrains Mono).
  Nothing else (no other CDNs, no images from the web). Textures/icons are generated procedurally or inline SVG.
- Must not throw on missing optional pieces: wrap cross-module calls that could fail (e.g. 3D not loaded yet).
- Keep functions reasonably small; no `console.log` spam (warnings/errors OK).

## 1. Units, coordinates, conventions
- World units: **millimetres**. Origin = back-left corner of the 9 000 × 20 000 mm lot. **+x → right, +y → down**
  (towards the street). This is exactly the orientation of the PDF drawing (top = back of lot).
- Floors: `doc.floors = [{id:'f0',name:'Térreo',level:0,height:2880,ceiling:2780}, {id:'f1',…level:2880}, {id:'f2',…level:5760}]`.
  `level` = finished-floor elevation (mm); `height` = floor-to-floor; `ceiling` = clear ceiling height (slab 100 mm).
- **Rotation** `rot` (degrees) is clockwise on screen (because +y is down). Helpers: `DD.util.localToWorld(cx,cy,rot,lx,ly)`
  / `worldToLocal`.
- **Furniture local frame**: origin at footprint centre; local **+x = width `w`**, local **+y = depth `d`**.
  The item's **back is at local y = −d/2** (against the wall), its **front at +d/2** (where you sit / access; screen
  of a TV; doors of a wardrobe; front of a car). `rot=0` → back towards −y (top of drawing), front faces down.
  Back against: top wall `rot=0`, right wall `rot=90`, bottom wall `rot=180`, left wall `rot=270`.
- **3D mapping** (three.js, metres): `X = x/1000`, `Z = y/1000`, `Y = up` (elevation/1000).
  Furniture object: `obj.position.set(x/1000, (floor.level + (item.elev||0))/1000, y/1000)` and
  **`obj.rotation.y = -rot * Math.PI/180`** (derived: plan rotation θ clockwise ↔ rotation about +Y by −θ).
  Builders return objects whose local +X = width, local +Z = depth with the BACK at z = −d/2, +Y up, origin at the
  bottom-centre of the footprint.
- Numbers shown to the user: metres with comma (`DD.util.fmtM(2500) → "2,50"`), areas `DD.util.fmtArea(14) → "14,00 m²"`.

## 2. Document (undoable) — `DD.store.doc`
```js
{
  version: 1, meta: {name, source},
  floors: [...],
  walls: [{ id, floor, a:{x,y}, b:{x,y}, thick, height, kind }],   // kind: 'structural'|'partition'|'muro'|'railing'
  openings: [{ id, wall, code:'P1'|…|'J7', type:'door'|'window', t, width, height, sill, style, hinge:'start'|'end', side:1|-1 }],
  roomSeeds: [{ id, floor, name, x, y, material, planArea, outdoor }],
  separators: [{ id, floor, a, b }],       // invisible room-separation lines (e.g. open garage front) — draw dashed thin
  stairs: [{ id, floor, x, y, length, width, tread, lowerCount, upperCount }],  // U-stair rising FROM `floor`
  furniture: [{ id, floor, type, x, y, rot, w, d, h, elev, color }],   // color null = catalog default
  measures: [{ id, floor, a:{x,y}, b:{x,y} }],
  site: { lot:{w,h}, street, northDeg, zones:[{id, kind:'grass'|'paving'|'driveway', x,y,w,h}] }
}
```
- **Walls** are centre-line segments with thickness. `kind`: `structural` (dark, locked: cannot be moved/demolished),
  `partition` (non-structural: can be demolished, moved, re-thicknessed), `muro` (boundary wall 1,80 m, locked),
  `railing` (mureta/guarda-corpo ~1,0 m, locked). User-drawn walls are `partition`.
- **Openings**: `t` = distance (mm) from `wall.a` to the opening centre along the wall. `side` = +1 means the leaf
  swings / slides towards the wall's **left normal** `n = (−d.y, d.x)` where `d = unit(b−a)` (for a wall drawn
  left→right that is +y, i.e. down). `hinge:'start'` = hinge at the jamb nearer `wall.a`. Styles:
  doors `swing | double | slide | slide4 | gate | gateSlide`; windows `slide2 | maxar | fixedMaxar | pivot`.
  Heights: `sill` from floor, `height` of the opening (a window may extend above the wall's height — clamp).
  Schedule & descriptions: `DD.data.SCHEDULE[code]`.
- **Rooms are derived, not stored**: `DD.rooms.compute(doc, floorId)` → `[{ id:'room:<seedId>', floor, seedIds, name,
  material, outdoor, planArea, open, area (m²), perimeter (mm), labelX, labelY, outer:[{x,y}], holes:[[{x,y}]], bbox }]`.
  Cached by identity of `doc.walls/roomSeeds/separators` (cheap to call every frame). Demolishing a wall merges rooms
  automatically (name becomes "Cozinha + Quarto"). `open:true` = region leaks to the outside (no polygon; don't fill).
  Floor material of a room lives on its seeds → change with `DD.ops.setRoomMaterial(doc, room.seedIds, matId)`.
- **Stairs**: `DD.geom.stairGeometry(stair, floorHeight)` → `{riser, treads:[{n,x0,y0,x1,y1,z,flight}], landing:[rects with z],
  footprint, walkline:[pts]}` (z = tread top above the stair's floor level). Lower flight = far row (y+w/2..y+w) going +x,
  landing at x+length, upper flight = near row going −x. **The Térreo "Quarto" door is reached by walking UNDER the
  upper flight** → treads/flights are floating slabs, never solid to the floor under the upper flight.
  `DD.geom.stairHoles(doc, floorId)` → slab holes on that floor. On each floor plan draw the stair rising from it
  (label "S" at the start) and, if a stair arrives from below and none leaves, the arriving one (label "D").

## 3. Store API (`DD.store`, created in 99-boot)
- `DD.store.doc`, `DD.store.ui` (getters). `commit(nextDoc, label)` → one undo step. For drags:
  `beginGesture(label)` → many `preview(nextDoc)` (no history) → `endGesture(label)` (one undo step) or `cancelGesture()`.
- `undo()` / `redo()` return the label or null; `canUndo()`, `canRedo()`, `undoLabel()`, `redoLabel()`.
- `replace(doc, label, {clearHistory})` for import/reset. `subscribe(fn(doc, prevDoc, info))` → unsubscribe fn.
  `info.transient` is true for previews. Diff by reference (`doc.walls !== prevDoc.walls`, per-item identity).
- **UI state** (not undoable): `DD.store.setUI(patch)`, `DD.store.subscribeUI(fn(ui, prevUI))`. Shape (`DD.defaultUI()`):
  `{ floor, view:'2d'|'3d'|'split', tool:'select'|'measure'|'wall'|'paint'|'demolish'|'pan', selection:null|{kind,id},
     hover:null|{kind,id}, cam3d:'orbit'|'walk', showAllFloors, snap, paintMaterial, show:{dims,furniture,areas,grid,labels,structure} }`
  `selection.kind ∈ 'furniture'|'wall'|'opening'|'room'|'measure'`; for rooms `id` is the room id (`'room:<seedId>'`).
  Selection is shared: selecting in 2D highlights in 3D and vice versa.
- Domain ops (all pure, return new docs) in `DD.ops`: `update/add/remove(doc, coll, id|item, patch)`, `byId`,
  `demolishWall(doc,id) → {doc,error}`, `addWall(doc,floor,a,b,thick) → {doc,wall}`, `moveWall(doc,id,dx,dy)` (keeps
  joints), `setRoomMaterial`, `renameRoom`, `addFurniture(doc,type,floor,x,y,rot) → {doc,item}`, `duplicateFurniture`,
  `addOpening(doc, wallId, code, t) → {doc, opening}`, `isEditableWall(w)`, `KIND_LABEL`.
- Geometry in `DD.geom`: `wallDir, wallPolygon, wallFaces, openingFrame(w,op) → {c,d,n,start,end,t0,t1}`,
  `openingsOfWall`, `wallPieces(w, openings) → [{t0,t1,z0,z1,part}]` (solid/sill/lintel boxes for 3D & collision),
  `stairGeometry, stairHeightAt, stairHoles, raycastWalls(doc,floor,p,dir) → {dist,wall}`, `furnitureCorners`,
  **`snapFurniture(doc, floorId, item, {x,y,rot}, {threshold, angleTol}) → {x,y,rot,snaps}`** (wall adsorption; use
  it from both 2D and 3D drags when `ui.snap` and not Alt), `snapPoints(doc,floor)`, `dimensionData(doc,floor) →
  {bbox, xs, ys, xsExt, ysExt}` (breakpoints for auto dimension chains; recomputed from current walls).
- Events: `DD.events.on(name, fn)` / `emit`. Names: `'toast' {msg,kind:'info'|'ok'|'warn'|'error'}` (use `DD.toast(msg,kind)`),
  `'doc:committed' {label}`, `'saved' {auto}`, `'view:changed' {view}`, `'plan2d:viewport'`, `'focus:item' {kind,id}`.
- Persistence: `DD.persist.save(doc)/load()/clear()/validate()/downloadJSON(doc,name)/downloadDataURL(url,name)/readJSONFile(file)`.
  Autosave is wired in boot (debounced on every commit).

## 4. Module APIs to implement

### 4.1 `src/10-materials.js` → `DD.materials`
```js
DD.materials = {
  list: [{ id, name, group, tileMM, base, site?:true }], // group: 'Cerâmicos'|'Madeiras'|'Pedras e cimentícios'|'Têxteis'|'Externos'
  get(id),                  // entry, falls back to 'porcelanato'
  canvas(id),               // cached HTMLCanvasElement 512×512, seamless, covering tileMM×tileMM mm of floor
  swatch(id, px=64),        // dataURL square preview for UI pickers
}
```
Required room materials (ids used by data): `porcelanato` (60×60 light warm grey, thin grout), `marmore` (Calacatta-like
80×80 with veins), `madeira` (oak planks, staggered), `madeiraEscura` (walnut planks), `vinilico` (light vinyl planks),
`ceramica` (45×45 white/beige bathroom tile), `ceramicaExt` (anti-slip 45×45 terracotta/sand), `ladrilho` (hydraulic
cement tile with a geometric pattern, 20×20), `cimento` (cimento queimado, mottled), `concreto` (garage concrete with
subtle joints), `carpete` (fine carpet noise), `deck` (outdoor wood deck boards with gaps).
Site-only (`site:true`, not offered in the room picker): `grama` (grass), `calcada` (paver/“Proj. beiral” pavement),
`intertravado` (interlocking driveway pavers). Textures must tile seamlessly (use modular noise / draw tiles
wrapping edges). Deterministic (seeded PRNG) so the look is stable across reloads.

### 4.2 `src/11-catalog.js` → `DD.catalog` (types, 2D symbols, default layout)
```js
DD.catalog = {
  categories: [{ id, name }],
  types: { [typeId]: { name, category, w, d, h, elev, color, flat?:bool, fixture?:bool } },
  draw2d(ctx, item, o),     // ctx already translated/rotated to the item's local frame, units = mm.
                            // o = { px: mm per screen pixel (use lineWidth = n*o.px), selected, hovered, ghost, color }
  thumbnail(typeId, px=72), // dataURL of the top-view symbol for the library panel (cached)
  defaultLayout(doc),       // → furniture items for all 3 floors (see §6)
}
```
2D symbols follow architectural drafting conventions (top view, crisp ink outlines, subtle fills tinted with the item
colour, recognisable details: cushions, pillows & folded sheet, burners, sink bowl, toilet bowl, wardrobe doors,
car silhouette, plant leaves…). They must scale correctly with any `w/d` (draw relative to w/d). `flat:true` for rugs
(drawn first, under other furniture, never snapped to walls).

### 4.3 `src/12-furniture3d.js` → `DD.furniture3d`
```js
DD.furniture3d = { build(THREE, item) }   // → THREE.Object3D in METRES, local +X width, +Z depth, back at z=-d/2,
                                          //   origin bottom-centre, sized from item.w/d/h (mm); item.color overrides main colour.
```
Detailed but light low-poly models (Box/Cylinder/Lathe/Extrude geometries, shared materials cached per colour).
`castShadow/receiveShadow` set. Mark every mesh with `userData.furnitureId = item.id` (the 3D view uses it for picking).
Unknown type → simple rounded box.

### 4.4 `src/20-plan2d.js` → `DD.plan2d` (canvas 2D editor)
```js
DD.plan2d = {
  init(canvasEl),                 // attach listeners, ResizeObserver, subscribe to store/ui, fit to active floor
  redraw(),                       // request a frame (coalesce with rAF)
  fit(),                          // zoom to the active floor
  zoomBy(factor, clientX?, clientY?),
  getViewport(),                  // → { cx, cy (world mm at canvas centre), scale (css px per mm), width, height (css px), rect }
  setViewport({cx, cy, scale}),
  screenToWorld(clientX, clientY) → {x,y},  worldToScreen(x,y) → {x,y} (client coords)
  addFurnitureAt(type, clientX, clientY) → id,   // used by library drag&drop / click
  exportPNG({ scale=2, background=true }) → dataURL,   // whole active floor incl. dimensions & legend
}
```
### 4.5 `src/30-view3d.js` → `DD.view3d` (three.js)
```js
DD.view3d = {
  init(containerEl),              // async-safe: dynamic import('three') via the import map; show a message if it fails
  isReady() → bool,
  setActive(bool),                // start/stop the render loop (only render when visible)
  resize(),
  setCameraMode('orbit'|'walk'),  // also mirrors ui.cam3d
  transitionFrom2D(viewport2d, ms=1100) → Promise,  // camera starts top-down matching the 2D view, eases to aerial
  transitionTo2D(viewport2d, ms=900) → Promise,     // camera eases to top-down matching the 2D view
  exportPNG() → dataURL,
}
```
### 4.6 `src/40-ui.js` + `src/shell.html` + `src/styles.css` → `DD.ui`
```js
DD.ui = { init(), ready(), setView(view), showToast(msg, kind) }
```
`init()` binds the DOM defined in `shell.html` (must exist before plan2d/view3d init). Required element ids:
`#app`, `#plan-canvas` (inside `#view2d`), `#view3d` (empty container for the WebGL canvas; the 3D module owns its
contents), `#view3d-overlay` (UI overlay inside #view3d owned by ui.js for 3D controls), `#toasts`.

## 5. Build & test
- `python tools/build.py` → `casa-decoracao.html`. Shell must contain `/*__CSS__*/` inside `<style>` and `//__JS__`
  inside a classic `<script>` near the end of `<body>`, plus this import map in `<head>` (used by view3d's dynamic import):
  ```html
  <script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js",
  "three/addons/":"https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/"}}</script>
  ```
  view3d loads: `const THREE = await import('three'); const {OrbitControls} = await import('three/addons/controls/OrbitControls.js');
  const {PointerLockControls} = await import('three/addons/controls/PointerLockControls.js');`
- Syntax check every module: `node --check src/<file>.js`. Pure logic can be tested in Node with a `window` shim
  (see `tools/test-core.js`). Stubs for missing modules are fine in your own tests — do NOT create or edit other agents' files.
- Write only your own files. If you need something from core that is missing, implement a local helper in your module
  and mention it in your final report (do not edit `00-data.js`/`01-core.js`/`99-boot.js`).

## 6. Rooms (clear interior bounds, mm) — for layouts, labels and sanity checks
Térreo (f0): Cozinha x1650–4150 y3000–8600 · Desp. x4300–5400 y3000–4600 · Suíte (banheiro) x5550–7350 y3000–4600 ·
Quarto x4300–7350 y4750–8600 · Lav. x1650–3000 y8750–10350 · Sala = x3150–8850 y8750–10350 (hall + STAIR zone
x6150–8850) ∪ x4300–8850 y10350–14850 · Garagem x150–4150 y10500–15000 (open front, car goes here, front = +y).
1º Pav (f1): Closet x1650–4150 y3000–4600 · Closet x4300–7350 y3000–4600 · Quarto Master x3150–7350 y4750–8600 ·
Suíte (banheiro) x1650–3000 y4750–7500 · Banhº x1650–3000 y7650–10350 · Circulação x3150–8850 y8750–10350 (STAIR
x6150–8850) · Quarto 1 x150–4150 y10500–14850 · Quarto 2 x4300–8850 y10500–14850 · Varanda x150–8850 y15000–16050.
2º Pav (f2): Varanda coberta (área gourmet) = x1650–7350 y3000–8600 ∪ x3150–6150 y8600–10350 ∪ STAIR x6150–8850
y8750–10350 · Lav. x1650–3000 y8750–10350 · Varanda descoberta (terraço) x150–8850 y10500–14850.
Door swing zones to keep free and plan fixtures are listed in the catalog agent's brief.

## 7. Visual direction ("mesa de desenho")
- 2D canvas = drafting paper: bg `#F3EFE6`, minor grid `#E7E1D5` (100 mm, only when zoomed in), major `#DAD2C3` (1 m).
  Ink `#1F1D1A`. Structural walls: solid poché `#2E2A26`. Partitions: `#CFC6B7` fill + 45° hatch `#8C8375`.
  Muro: `#9C9385` + sparse hatch. Railing: outline + centre line. Dimensions `#6E655A` lines, text `#3A342D`
  in JetBrains Mono. Room names Space Grotesk 600, area in JetBrains Mono. Selection/accent **coral `#D9643A`**
  (the facade colour "algodão egípcio coral"); snapping/measure **teal `#1F8A8A`**.
- App chrome: graphite. Tokens (CSS custom properties on `:root`): `--bg #151412`, `--panel #1E1D1A`, `--panel-2 #26241F`,
  `--line #34312B`, `--text #EDE8DF`, `--muted #A39A8C`, `--accent #E0703F`, `--accent-2 #2BA3A3`, `--danger #E5484D`,
  `--ok #46A758`. Provide a light variant under `:root[data-theme="light"]` and `@media (prefers-color-scheme: light)`
  guarded by `:root:not([data-theme="dark"])` (warm light greys). Fonts: "Space Grotesk" (UI), "JetBrains Mono" (numbers).
- 3D: warm daylight (sun + hemisphere), soft PCF shadows, ACES tone mapping, sRGB; interior walls warm white
  `#EFEBE3`, wall tops (cut) `#2E2A26` for structural / `#BFB6A6` partitions so the 2D logic reads in 3D; window frames
  & doors wood `#8A5A2E` (facade has wooden frames/shutters), glass light blue transparent, railings black metal,
  muros coral-beige `#E7D3C0`, grass ground, sky gradient.
