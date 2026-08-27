// ---------------------------------------------------------------------
// Shared state across all three tabs
// ---------------------------------------------------------------------
const state = {
  folderScan: null,        // last api.scan() result: {materials, unmatched}
  textureIndex: {},        // "<token>_<SUFFIX>": "<basename>" - from api.get_texture_index()
  materialsData: null,     // parsed materials.json, mutated live by the editor
  materialsPath: null,
  names: [],               // material keys currently shown on Source
  selected: new Set(),
  focused: null,
  groupEditMode: false,
  clipboard: null,
  basePathsByField: {},
  textureBasePath: '',
};

const ROLE_LETTER = { diffuse: "D", normal: "N", metal: "M", rough: "R", opacity: "O", ao: "AO" };
const FOLDER_ROLES = ["diffuse", "normal", "metal", "rough", "opacity", "ao"];

const STAGE_FIELDS = [
  {key:'baseColorMap', type:'path'},
  {key:'normalMap', type:'path'},
  {key:'metallicMap', type:'path'},
  {key:'roughnessMap', type:'path'},
  {key:'ambientOcclusionMap', type:'path'},
  {key:'opacityMap', type:'path'},
  {key:'emissiveMap', type:'path'},
  {key:'diffuseMapUseUV', type:'number'},
  {key:'opacityMapUseUV', type:'number'},
  {key:'metallicFactor', type:'number'},
  {key:'roughnessFactor', type:'number'},
  {key:'opacityFactor', type:'number'},
  {key:'baseColorFactor', type:'array'},
  {key:'retroreflectivity', type:'number'},
  {key:'retroreflectiveColor', type:'array'},
  {key:'emissiveFactor', type:'array'},
  {key:'emissiveIntensityNits', type:'number'},
  {key:'vertColorEmissive', type:'bool'},
];
const PATH_FIELD_KEYS = STAGE_FIELDS.filter(f => f.type === 'path').map(f => f.key);
const BOOL_FLAGS = ['alphaTest','doubleSided','translucent','translucentRecvShadows','translucentZWrite','invertBackFaceNormals','subSurface','castShadows','planarReflection','dynamicCubemap'];
const NUM_FLAGS = ['alphaRef','activeLayers','subSurfaceIntensity','groundDepth'];
const TEXT_FLAGS = ['cubemap','internalName'];
// Maps each auto-fillable stage field to the filename suffix used on disk.
// baseColorMap is deliberately excluded - it's assumed already assigned, and
// every other map's filename is derived from ITS token, not baseColorMap's.
const MAP_SUFFIXES = { normalMap:'N', metallicMap:'M', roughnessMap:'R', ambientOcclusionMap:'AO', opacityMap:'O' };
const GROUND_TYPES = [
  'ASPHALT','ASPHALT_OLD','ASPHALT_PREPPED','ASPHALT_WET','ASPHALT_WET2','ASPHALT_WET3',
  'BEACHSAND','BRANCHES_STRONG','COBBLESTONE','CONCRETE','CONCRETE2',
  'DERBY_DIRT','DIRT','DIRT_DUSTY','DIRT_DUSTY_LOOSE','DIRT_GRASS','DIRT_LOOSE','DIRT_LOOSE_DUSTY',
  'DIRT_ROCKY','DIRT_ROCKY_LARGE','DIRT_SANDY',
  'FOREST','FOREST_FLOOR','FRICTIONLESS',
  'GRASS','GRASS2','GRASS3','GRASS4','GRAVEL','GRAVEL_WET','GRAVEL_RIVERBED','GRID',
  'GROUNDMODEL_ASPHALT1','GROUNDMODEL_ASPHALT_OLD','GROUNDMODEL_WOOD1','GROUNDMODEL_WOOD2',
  'ICE','KICKPLATE','LEAVES_STRONG','LEAVES_THIN',
  'METAL','METAL_TREAD','MUD','PLASTIC',
  'ROCK','ROCK_CLIFF','ROCKS_LARGE','ROCKYDIRT','RUMBLE_STRIP',
  'SAND','SANDTRAP','SHOCK_ABSORBER','SLIPPERY','SNOW','SNOWBANK','SOFT_COLLISION_GENERAL','SPIKE_STRIP',
  'VOID','WOOD',
];

const el = id => document.getElementById(id);

let toastTimer = null;
function toast(msg){
  const t = el('toast');
  if (!t) { console.log(msg); return; }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
}

// ---------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------
document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(btn.dataset.tab).classList.add("active");
    if (btn.dataset.tab === "source") renderSourceTable();
    if (btn.dataset.tab === "edit") renderEditor();
    if (btn.dataset.tab === "deliver") renderDeliverTable();
  });
});

// ---------------------------------------------------------------------
// Source tab: folder scan + materials.json list
// ---------------------------------------------------------------------
el("pick-folder-btn").addEventListener("click", async () => {
  const path = await window.pywebview.api.pick_folder();
  if (!path) return;
  el("folder-path").textContent = path;
  el("rescan-btn").disabled = false;
  await runScan(path);
});

el("rescan-btn").addEventListener("click", async () => { await runScan(); });

async function runScan(path) {
  const scan = await window.pywebview.api.scan(path);
  state.folderScan = scan;
  state.textureIndex = await window.pywebview.api.get_texture_index();
  renderSourceTable();
}

el("open-materials-btn").addEventListener("click", async () => {
  const result = await window.pywebview.api.pick_materials_json();
  if (!result) return;
  if (result.error) { toast(result.error); return; }
  state.materialsData = result.data;
  state.materialsPath = result.path;
  state.focused = null;
  state.selected.clear();
  state.groupEditMode = false;
  const detected = detectBasePaths(state.materialsData);
  state.basePathsByField = detected.byField;
  state.textureBasePath = detected.overall;
  el("materials-stat").textContent = result.path + " — " + Object.keys(result.data).length + " materials";
  renderSourceTable();
});

el("select-all-btn").addEventListener("click", () => {
  state.names.forEach(n => state.selected.add(n));
  renderSourceTable();
});
el("select-none-btn").addEventListener("click", () => {
  state.selected.clear();
  state.groupEditMode = false;
  el("group-edit-btn").classList.remove("active");
  renderSourceTable();
});
el("group-edit-btn").addEventListener("click", () => {
  if (state.selected.size === 0) { toast('Check at least one material first'); return; }
  if (!state.materialsData) { toast('Open a materials.json file first'); return; }
  state.groupEditMode = true;
  el("group-edit-btn").classList.add("active");
  document.querySelector('.tab-btn[data-tab="edit"]').click();
});

// Case-insensitive lookup: a folder-scan material name may not exactly
// match a materials.json key, but usually differs only in case.
function findFolderScanEntry(name) {
  if (!state.folderScan) return null;
  const lower = name.toLowerCase();
  for (const key of Object.keys(state.folderScan.materials || {})) {
    if (key.toLowerCase() === lower) return state.folderScan.materials[key];
  }
  return null;
}

function countNonEmptyStages(mat) {
  return (mat.Stages || []).filter(s => s && Object.keys(s).length > 0).length;
}

function renderSourceTable() {
  const tbody = el("materials-tbody");
  tbody.innerHTML = "";

  state.names = state.materialsData
    ? Object.keys(state.materialsData).sort()
    : Object.keys((state.folderScan && state.folderScan.materials) || {}).sort();

  for (const name of state.names) {
    const row = document.createElement("tr");
    row.dataset.material = name;

    const cbCell = document.createElement("td");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "material-select";
    checkbox.checked = state.selected.has(name);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) state.selected.add(name); else state.selected.delete(name);
    });
    cbCell.appendChild(checkbox);
    row.appendChild(cbCell);

    const nameCell = document.createElement("td");
    nameCell.textContent = name;
    nameCell.addEventListener("click", () => {
      state.focused = name;
      state.groupEditMode = false;
      document.querySelector('.tab-btn[data-tab="edit"]').click();
    });
    row.appendChild(nameCell);

    const folderEntry = findFolderScanEntry(name);
    for (const role of FOLDER_ROLES) {
      const cell = document.createElement("td");
      const present = !!(folderEntry && folderEntry.roles[role]);
      cell.textContent = ROLE_LETTER[role];
      cell.className = present ? "present" : "missing";
      cell.title = present ? folderEntry.roles[role] : "not found in scanned folder";
      row.appendChild(cell);
    }

    const stagesCell = document.createElement("td");
    stagesCell.textContent = state.materialsData ? `${countNonEmptyStages(state.materialsData[name])}/4` : "—";
    row.appendChild(stagesCell);

    tbody.appendChild(row);
  }

  const unmatchedBox = el("unmatched-box");
  const unmatchedList = el("unmatched-list");
  unmatchedList.innerHTML = "";
  const unmatched = (state.folderScan && state.folderScan.unmatched) || [];
  if (unmatched.length) {
    unmatchedBox.hidden = false;
    unmatched.forEach(f => {
      const li = document.createElement("li");
      li.textContent = f;
      unmatchedList.appendChild(li);
    });
  } else {
    unmatchedBox.hidden = true;
  }
}

// ---------------------------------------------------------------------
// Populate logic (ported from the standalone materials editor) - matches
// each stage's OWN map token against state.textureIndex, built from the
// Python-side folder scan instead of a browser-side directory walk.
// ---------------------------------------------------------------------
function stripHexPrefix(base) {
  return base.replace(/^0x[0-9a-f]+_/i, '');
}

// baseColorMap filename "0xE38C5ED8_AB_PAN_CAR360_01_D.dds" -> token "AB_PAN_CAR360_01"
function deriveMapToken(baseColorMapPath) {
  if (!baseColorMapPath || typeof baseColorMapPath !== 'string') return null;
  const filename = baseColorMapPath.split('/').pop();
  const dot = filename.lastIndexOf('.');
  const base = dot > 0 ? filename.slice(0, dot) : filename;
  const m = base.match(/^(.*)_D$/i);
  return stripHexPrefix(m ? m[1] : base);
}

function findScannedTexture(token, suffix) {
  return state.textureIndex[(token + '_' + suffix).toLowerCase()] || null;
}

function populateStageMaps(mat, stageIndex, keys) {
  if (!Array.isArray(mat.Stages)) return 0;
  const stage = mat.Stages[stageIndex];
  if (!stage) return 0;
  const token = deriveMapToken(stage.baseColorMap);
  if (!token) return 0;
  let filled = 0;
  keys.forEach(key => {
    if (stage[key]) return;
    const suffix = MAP_SUFFIXES[key];
    const filename = findScannedTexture(token, suffix);
    if (filename) {
      stage[key] = (state.basePathsByField[key] || state.textureBasePath) + filename;
      filled++;
    }
  });
  return filled;
}

function populateAllStagesMaps(mat, keys) {
  let filled = 0;
  for (let i = 0; i < 4; i++) filled += populateStageMaps(mat, i, keys);
  return filled;
}

function runPopulate(mats, keys, stageIndex) {
  if (Object.keys(state.textureIndex).length === 0) { toast('Scan a texture folder first (Source tab)'); return; }
  if (mats.length === 0) { toast('Nothing selected to populate'); return; }
  let totalFilled = 0, matsTouched = 0;
  mats.forEach(mat => {
    const before = totalFilled;
    totalFilled += (stageIndex === undefined)
      ? populateAllStagesMaps(mat, keys)
      : populateStageMaps(mat, stageIndex, keys);
    if (totalFilled > before) matsTouched++;
  });
  toast(totalFilled === 0
    ? 'No matching textures found for the current selection'
    : 'Filled ' + totalFilled + ' field(s) across ' + matsTouched + ' material(s)');
  renderEditor();
}

// For each map type, find its most common directory in the loaded file -
// these often live in different subfolders (Normal/, Metal/, etc).
function detectBasePaths(d) {
  const perField = {};
  const overall = {};
  PATH_FIELD_KEYS.forEach(k => perField[k] = {});
  Object.values(d).forEach(mat => (mat.Stages || []).forEach(st => {
    if (!st) return;
    PATH_FIELD_KEYS.forEach(k => {
      const v = st[k];
      if (typeof v === 'string' && v.includes('/')) {
        const dir = v.slice(0, v.lastIndexOf('/') + 1);
        perField[k][dir] = (perField[k][dir] || 0) + 1;
        overall[dir] = (overall[dir] || 0) + 1;
      }
    });
  }));
  const pickBest = counts => {
    let best = '', bestCount = 0;
    for (const dir in counts) if (counts[dir] > bestCount) { best = dir; bestCount = counts[dir]; }
    return best;
  };
  const byField = {};
  PATH_FIELD_KEYS.forEach(k => { byField[k] = pickBest(perField[k]); });
  return { byField, overall: pickBest(overall) };
}

// ---------------------------------------------------------------------
// Edit tab: field builders (ported)
// ---------------------------------------------------------------------
function field(labelText, value, onChange, type, mixed, pathKey, onPopulate) {
  const wrap = document.createElement('div');
  wrap.className = 'field';
  const label = document.createElement('label');
  label.textContent = labelText;
  wrap.appendChild(label);

  if (type === 'path') {
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.gap = '6px';
    const input = document.createElement('input');
    input.type = 'text';
    input.value = mixed ? '' : ((value === null || value === undefined) ? '' : value);
    input.placeholder = mixed ? '(mixed)' : (value === null ? 'null' : '');
    input.style.flex = '1';
    input.onchange = () => { onChange(input.value === '' ? null : input.value); };
    row.appendChild(input);
    if (onPopulate) {
      const popBtn = document.createElement('button');
      popBtn.className = 'btn small';
      popBtn.type = 'button';
      popBtn.textContent = '⚡';
      const hasIndex = Object.keys(state.textureIndex).length > 0;
      popBtn.disabled = !hasIndex;
      popBtn.title = hasIndex
        ? "Auto-fill from the scanned texture folder, matched by this stage's own map token — only if this field is currently empty"
        : 'Scan a texture folder first (Source tab)';
      popBtn.onclick = onPopulate;
      row.appendChild(popBtn);
    }
    wrap.appendChild(row);
    return wrap;
  }

  const input = document.createElement('input');
  input.type = type === 'number' ? 'number' : 'text';
  input.value = mixed ? '' : ((value === null || value === undefined) ? '' : value);
  input.placeholder = mixed ? '(mixed)' : (value === null ? 'null' : '');
  input.onchange = () => {
    let v = input.value;
    if (v === '') { onChange(null); return; }
    if (type === 'number') { v = Number(v); if (Number.isNaN(v)) v = null; }
    onChange(v);
  };
  wrap.appendChild(input);
  return wrap;
}

function boolField(labelText, value, onChange, mixed) {
  const wrap = document.createElement('div');
  wrap.className = 'field bool-field';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = !!value;
  if (mixed) input.indeterminate = true;
  input.onchange = () => onChange(input.checked);
  const label = document.createElement('label');
  label.textContent = labelText + (mixed ? ' (mixed)' : '');
  wrap.appendChild(input);
  wrap.appendChild(label);
  return wrap;
}

function clamp01(v) { return Math.max(0, Math.min(1, isNaN(v) ? 0 : v)); }
function rgbArrToHex(arr) {
  const c = v => Math.round(clamp01(Number(v)) * 255).toString(16).padStart(2, '0');
  return '#' + c(arr[0]) + c(arr[1]) + c(arr[2]);
}
function hexToRgbArr(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function arrayField(labelText, value, onChange, mixed) {
  const wrap = document.createElement('div');
  wrap.className = 'field';
  const label = document.createElement('label');
  label.textContent = labelText + (mixed ? ' (mixed)' : '');
  wrap.appendChild(label);

  const row = document.createElement('div');
  row.style.display = 'flex';
  row.style.gap = '6px';

  const arr = (!mixed && Array.isArray(value)) ? value.slice() : [null, null, null];
  while (arr.length < 3) arr.push(null);

  const swatch = document.createElement('input');
  swatch.type = 'color';
  swatch.style.width = '32px';
  swatch.style.height = '32px';
  swatch.style.padding = '0';
  swatch.style.border = 'none';
  swatch.style.background = 'none';
  swatch.style.cursor = 'pointer';
  swatch.style.flexShrink = '0';

  const inputs = [];
  function currentNums() { return inputs.map(i => i.value === '' ? 0 : Number(i.value)); }
  function syncSwatch() { swatch.value = rgbArrToHex(currentNums()); }

  arr.forEach(v => {
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.step = 'any';
    inp.placeholder = mixed ? '(mixed)' : '0';
    inp.value = (v === null || v === undefined) ? '' : v;
    inp.style.flex = '1';
    inp.onchange = () => { syncSwatch(); onChange(currentNums()); };
    inputs.push(inp);
  });
  syncSwatch();

  swatch.oninput = () => {
    const rgb = hexToRgbArr(swatch.value);
    inputs.forEach((inp, idx) => { inp.value = rgb[idx]; });
    onChange(currentNums());
  };

  row.appendChild(swatch);
  inputs.forEach(inp => row.appendChild(inp));

  const clearBtn = document.createElement('button');
  clearBtn.className = 'btn small';
  clearBtn.type = 'button';
  clearBtn.textContent = '×';
  clearBtn.title = 'Clear to null';
  clearBtn.onclick = () => { inputs.forEach(i => { i.value = ''; }); syncSwatch(); onChange(null); };
  row.appendChild(clearBtn);

  wrap.appendChild(row);
  return wrap;
}

function blendOpField(value, onChange) {
  const wrap = document.createElement('div');
  wrap.className = 'field';
  const label = document.createElement('label');
  label.textContent = 'translucentBlendOp';
  wrap.appendChild(label);
  const sel = document.createElement('select');
  ['None', 'PreMulAlpha', 'Add', 'AddAlpha', 'LerpAlpha', 'Mul', 'Sub'].forEach(opt => {
    const o = document.createElement('option');
    o.value = opt; o.textContent = opt;
    if (value === opt) o.selected = true;
    sel.appendChild(o);
  });
  sel.onchange = () => { onChange(sel.value); };
  wrap.appendChild(sel);
  return wrap;
}

function groundTypeField(value, onChange) {
  const wrap = document.createElement('div');
  wrap.className = 'field';
  const label = document.createElement('label');
  label.textContent = 'groundType';
  wrap.appendChild(label);
  const sel = document.createElement('select');
  const blank = document.createElement('option');
  blank.value = ''; blank.textContent = '(unset)';
  if (!value) blank.selected = true;
  sel.appendChild(blank);
  GROUND_TYPES.forEach(opt => {
    const o = document.createElement('option');
    o.value = opt; o.textContent = opt;
    if (value === opt) o.selected = true;
    sel.appendChild(o);
  });
  sel.onchange = () => { onChange(sel.value === '' ? null : sel.value); };
  wrap.appendChild(sel);
  return wrap;
}

// ---------------------------------------------------------------------
// Edit tab: main render (ported: single-material + group-edit modes)
// ---------------------------------------------------------------------
function selectedMats() {
  return Array.from(state.selected).map(n => state.materialsData[n]).filter(Boolean);
}

function groupValue(getter) {
  const mats = selectedMats();
  if (mats.length === 0) return { mixed: false, value: null };
  const vals = mats.map(m => { const v = getter(m); return v === undefined ? null : v; });
  const firstKey = JSON.stringify(vals[0]);
  const allSame = vals.every(v => JSON.stringify(v) === firstKey);
  return { mixed: !allSame, value: allSame ? vals[0] : null };
}

function groupSet(setter) { selectedMats().forEach(setter); }

function renderEditor() {
  const editorEl = el('edit-content');
  editorEl.innerHTML = '';

  if (!state.materialsData) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = 'Open a materials.json file from the Source tab to edit materials here.';
    editorEl.appendChild(p);
    return;
  }

  if (state.groupEditMode && state.selected.size > 0) { renderGroupEditor(); return; }

  if (!state.focused || !state.materialsData[state.focused]) {
    const e = document.createElement('div');
    e.id = 'empty-state';
    e.textContent = 'Click a material name on the Source tab to edit it, or check several and use "Edit as group".';
    editorEl.appendChild(e);
    return;
  }

  const mat = state.materialsData[state.focused];
  const headerRow = document.createElement('div');
  headerRow.style.display = 'flex';
  headerRow.style.alignItems = 'flex-start';
  headerRow.style.justifyContent = 'space-between';
  headerRow.style.gap = '16px';
  const h1 = document.createElement('h1');
  h1.style.margin = '0';
  h1.textContent = state.focused;
  const popAllBtn = document.createElement('button');
  popAllBtn.className = 'btn tile-purple';
  popAllBtn.textContent = state.selected.size > 0 ? 'Populate Maps (' + state.selected.size + ' selected)' : 'Populate Maps';
  popAllBtn.disabled = Object.keys(state.textureIndex).length === 0;
  popAllBtn.onclick = () => runPopulate(state.selected.size > 0 ? selectedMats() : [mat], Object.keys(MAP_SUFFIXES));
  headerRow.appendChild(h1);
  headerRow.appendChild(popAllBtn);
  const sub = document.createElement('div');
  sub.className = 'sub';
  sub.textContent = 'class: ' + (mat.class || '—') + '   ·   version: ' + (mat.version ?? '—');
  editorEl.appendChild(headerRow);
  editorEl.appendChild(sub);

  const flagsTitle = document.createElement('div');
  flagsTitle.className = 'section-title';
  flagsTitle.textContent = 'Material flags';
  editorEl.appendChild(flagsTitle);
  const flagsGrid = document.createElement('div');
  flagsGrid.className = 'flags-grid';
  NUM_FLAGS.forEach(k => flagsGrid.appendChild(field(k, mat[k] ?? null, v => { mat[k] = v; }, 'number')));
  TEXT_FLAGS.forEach(k => flagsGrid.appendChild(field(k, mat[k] ?? null, v => { mat[k] = v; }, 'text')));
  flagsGrid.appendChild(blendOpField(mat.translucentBlendOp, v => { mat.translucentBlendOp = v; }));
  flagsGrid.appendChild(groundTypeField(mat.groundType ?? null, v => { mat.groundType = v; }));
  BOOL_FLAGS.forEach(k => flagsGrid.appendChild(boolField(k, mat[k], v => {
    mat[k] = v;
    if (k === 'subSurface' && v) { mat.doubleSided = true; mat.invertBackFaceNormals = true; renderEditor(); }
  })));
  editorEl.appendChild(flagsGrid);

  const stagesTitle = document.createElement('div');
  stagesTitle.className = 'section-title';
  stagesTitle.textContent = 'Stages';
  editorEl.appendChild(stagesTitle);

  if (!Array.isArray(mat.Stages)) mat.Stages = [{}, {}, {}, {}];
  while (mat.Stages.length < 4) mat.Stages.push({});

  const stagesWrap = document.createElement('div');
  stagesWrap.className = 'stages';

  mat.Stages.forEach((stage, i) => {
    const card = document.createElement('div');
    const nonEmpty = stage && Object.keys(stage).length > 0;
    card.className = 'stage-card' + (nonEmpty ? '' : ' empty');

    const head = document.createElement('div');
    head.className = 'stage-head';
    const idx = document.createElement('span');
    idx.className = 'idx';
    idx.textContent = 'STAGE ' + i;
    head.appendChild(idx);
    const spacer = document.createElement('span');
    spacer.className = 'spacer';
    head.appendChild(spacer);
    const copyBtn = document.createElement('button');
    copyBtn.className = 'btn small';
    copyBtn.textContent = 'Copy stage';
    copyBtn.onclick = () => {
      state.clipboard = { type: 'stage', index: i, data: Object.assign({}, mat.Stages[i]) };
      toast('Copied stage ' + i + ' from ' + state.focused);
    };
    head.appendChild(copyBtn);
    card.appendChild(head);

    const grid = document.createElement('div');
    grid.className = 'stage-fields';
    STAGE_FIELDS.forEach(({ key, type }) => {
      const setVal = v => { if (v === null) delete mat.Stages[i][key]; else mat.Stages[i][key] = v; };
      if (type === 'array') grid.appendChild(arrayField(key, stage[key] ?? null, setVal, false));
      else if (type === 'bool') grid.appendChild(boolField(key, stage[key], setVal));
      else {
        const onPopulate = MAP_SUFFIXES[key]
          ? () => runPopulate(state.selected.size > 0 ? selectedMats() : [mat], [key], i)
          : null;
        grid.appendChild(field(key, stage[key] ?? null, setVal, type, false, key, onPopulate));
      }
    });
    card.appendChild(grid);
    stagesWrap.appendChild(card);
  });

  editorEl.appendChild(stagesWrap);

  const copyAllRow = document.createElement('div');
  copyAllRow.style.marginTop = '14px';
  const copyAllBtn = document.createElement('button');
  copyAllBtn.className = 'btn';
  copyAllBtn.textContent = 'Copy all 4 stages';
  copyAllBtn.onclick = () => {
    state.clipboard = { type: 'stages', data: mat.Stages.map(s => Object.assign({}, s)) };
    toast('Copied all stages from ' + state.focused);
  };
  copyAllRow.appendChild(copyAllBtn);
  editorEl.appendChild(copyAllRow);

  if (state.clipboard) {
    const pasteBtn = document.createElement('button');
    pasteBtn.className = 'btn small';
    pasteBtn.style.marginLeft = '8px';
    pasteBtn.textContent = 'Paste ' + (state.clipboard.type === 'stage' ? ('stage ' + state.clipboard.index) : 'all stages') + ' here';
    pasteBtn.onclick = () => {
      if (!Array.isArray(mat.Stages)) mat.Stages = [{}, {}, {}, {}];
      if (state.clipboard.type === 'stage') {
        mat.Stages[state.clipboard.index] = Object.assign({}, mat.Stages[state.clipboard.index] || {}, state.clipboard.data);
      } else {
        state.clipboard.data.forEach((sd, i) => { mat.Stages[i] = Object.assign({}, mat.Stages[i] || {}, sd); });
      }
      renderEditor();
    };
    copyAllRow.appendChild(pasteBtn);
  }
}

function renderGroupEditor() {
  const editorEl = el('edit-content');
  const mats = selectedMats();
  const names = Array.from(state.selected);

  const headerRow = document.createElement('div');
  headerRow.style.display = 'flex';
  headerRow.style.alignItems = 'flex-start';
  headerRow.style.justifyContent = 'space-between';
  headerRow.style.gap = '16px';
  const h1 = document.createElement('h1');
  h1.style.margin = '0';
  h1.textContent = 'Editing ' + mats.length + ' materials as group';
  const popAllBtn = document.createElement('button');
  popAllBtn.className = 'btn tile-purple';
  popAllBtn.textContent = 'Populate Maps (' + mats.length + ' selected)';
  popAllBtn.disabled = Object.keys(state.textureIndex).length === 0;
  popAllBtn.onclick = () => runPopulate(mats, Object.keys(MAP_SUFFIXES));
  headerRow.appendChild(h1);
  headerRow.appendChild(popAllBtn);
  const sub = document.createElement('div');
  sub.className = 'sub';
  sub.textContent = names.slice(0, 4).join(', ') + (names.length > 4 ? ' … +' + (names.length - 4) + ' more' : '');
  editorEl.appendChild(headerRow);
  editorEl.appendChild(sub);

  const banner = document.createElement('div');
  banner.className = 'group-banner';
  banner.textContent = 'Every field below writes live to all ' + mats.length + ' checked materials as you edit. Fields marked "(mixed)" currently differ across the selection.';
  editorEl.appendChild(banner);

  const flagsTitle = document.createElement('div');
  flagsTitle.className = 'section-title';
  flagsTitle.textContent = 'Material flags';
  editorEl.appendChild(flagsTitle);
  const flagsGrid = document.createElement('div');
  flagsGrid.className = 'flags-grid';
  NUM_FLAGS.forEach(k => {
    const g = groupValue(m => m[k] ?? null);
    flagsGrid.appendChild(field(k, g.value, v => { groupSet(m => { m[k] = v; }); }, 'number', g.mixed));
  });
  TEXT_FLAGS.forEach(k => {
    const g = groupValue(m => m[k] ?? null);
    flagsGrid.appendChild(field(k, g.value, v => { groupSet(m => { m[k] = v; }); }, 'text', g.mixed));
  });
  const bg = groupValue(m => m.translucentBlendOp ?? 'None');
  flagsGrid.appendChild(blendOpField(bg.mixed ? null : bg.value, v => { groupSet(m => { m.translucentBlendOp = v; }); }));
  const gg = groupValue(m => m.groundType ?? null);
  flagsGrid.appendChild(groundTypeField(gg.mixed ? null : gg.value, v => { groupSet(m => { m.groundType = v; }); }));
  BOOL_FLAGS.forEach(k => {
    const g = groupValue(m => !!m[k]);
    flagsGrid.appendChild(boolField(k, g.value, v => {
      groupSet(m => { m[k] = v; if (k === 'subSurface' && v) { m.doubleSided = true; m.invertBackFaceNormals = true; } });
      if (k === 'subSurface' && v) renderEditor();
    }, g.mixed));
  });
  editorEl.appendChild(flagsGrid);

  const stagesTitle = document.createElement('div');
  stagesTitle.className = 'section-title';
  stagesTitle.textContent = 'Stages';
  editorEl.appendChild(stagesTitle);

  mats.forEach(mat => {
    if (!Array.isArray(mat.Stages)) mat.Stages = [{}, {}, {}, {}];
    while (mat.Stages.length < 4) mat.Stages.push({});
  });

  const stagesWrap = document.createElement('div');
  stagesWrap.className = 'stages';

  for (let i = 0; i < 4; i++) {
    const card = document.createElement('div');
    card.className = 'stage-card';

    const head = document.createElement('div');
    head.className = 'stage-head';
    const idx = document.createElement('span');
    idx.className = 'idx';
    idx.textContent = 'STAGE ' + i;
    head.appendChild(idx);
    const spacer = document.createElement('span');
    spacer.className = 'spacer';
    head.appendChild(spacer);
    const copyBtn = document.createElement('button');
    copyBtn.className = 'btn small';
    copyBtn.textContent = 'Copy stage';
    copyBtn.onclick = () => {
      state.clipboard = { type: 'stage', index: i, data: Object.assign({}, mats[0].Stages[i]) };
      toast('Copied stage ' + i + ' from ' + names[0]);
    };
    head.appendChild(copyBtn);
    card.appendChild(head);

    const grid = document.createElement('div');
    grid.className = 'stage-fields';
    STAGE_FIELDS.forEach(({ key, type }) => {
      const g = groupValue(m => (m.Stages[i] && m.Stages[i][key]) ?? null);
      const setVal = v => { groupSet(m => { if (v === null) delete m.Stages[i][key]; else m.Stages[i][key] = v; }); };
      if (type === 'array') grid.appendChild(arrayField(key, g.value, setVal, g.mixed));
      else if (type === 'bool') grid.appendChild(boolField(key, g.mixed ? undefined : !!g.value, setVal, g.mixed));
      else {
        const onPopulate = MAP_SUFFIXES[key] ? () => runPopulate(selectedMats(), [key], i) : null;
        grid.appendChild(field(key, g.value, setVal, type, g.mixed, key, onPopulate));
      }
    });
    card.appendChild(grid);
    stagesWrap.appendChild(card);
  }

  editorEl.appendChild(stagesWrap);

  const copyAllRow = document.createElement('div');
  copyAllRow.style.marginTop = '14px';
  const copyAllBtn = document.createElement('button');
  copyAllBtn.className = 'btn';
  copyAllBtn.textContent = 'Copy all 4 stages';
  copyAllBtn.onclick = () => {
    state.clipboard = { type: 'stages', data: mats[0].Stages.map(s => Object.assign({}, s)) };
    toast('Copied all stages from ' + names[0]);
  };
  copyAllRow.appendChild(copyAllBtn);
  editorEl.appendChild(copyAllRow);
}

// ---------------------------------------------------------------------
// Deliver tab: readiness summary + save
// ---------------------------------------------------------------------
const REQUIRED_FOR_READY = ['baseColorMap', 'normalMap', 'metallicMap', 'roughnessMap'];

function stageReadiness(mat) {
  const stages = mat.Stages || [];
  const nonEmpty = stages.filter(s => s && Object.keys(s).length > 0);
  const incomplete = [];
  nonEmpty.forEach((stage, i) => {
    const missing = REQUIRED_FOR_READY.filter(k => !stage[k]);
    if (missing.length) incomplete.push({ index: i, missing });
  });
  return { total: nonEmpty.length, ready: nonEmpty.length - incomplete.length, incomplete };
}

function renderDeliverTable() {
  const tbody = el('deliver-tbody');
  tbody.innerHTML = '';
  if (!state.materialsData) {
    el('deliver-stat').textContent = 'Open a materials.json file on the Source tab first.';
    return;
  }
  el('deliver-stat').textContent = state.materialsPath || '';

  Object.keys(state.materialsData).sort().forEach(name => {
    const mat = state.materialsData[name];
    const r = stageReadiness(mat);
    const row = document.createElement('tr');

    const nameCell = document.createElement('td');
    nameCell.textContent = name;
    nameCell.style.textAlign = 'left';
    nameCell.style.fontFamily = 'var(--mono)';
    row.appendChild(nameCell);

    const readyCell = document.createElement('td');
    readyCell.textContent = `${r.ready}/${r.total}`;
    readyCell.className = (r.total > 0 && r.ready === r.total) ? 'present' : 'missing';
    row.appendChild(readyCell);

    const detailCell = document.createElement('td');
    detailCell.style.textAlign = 'left';
    detailCell.style.fontSize = '11px';
    detailCell.style.color = 'var(--text-faint)';
    detailCell.textContent = r.incomplete
      .map(e => `stage ${e.index}: missing ${e.missing.join(', ')}`)
      .join(' · ');
    row.appendChild(detailCell);

    tbody.appendChild(row);
  });
}

el('deliver-save-btn').addEventListener('click', async () => {
  if (!state.materialsData) { toast('Nothing loaded to save'); return; }
  const result = await window.pywebview.api.save_materials_json(state.materialsData);
  el('deliver-stat').textContent = result.message;
  toast(result.message);
});
