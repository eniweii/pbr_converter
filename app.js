// ---------------------------------------------------------------------
// Shared state across all three tabs
// ---------------------------------------------------------------------
const state = {
  folders: [],              // from api.list_texture_folders(): [{path, label, removable}]
  folderScan: null,         // last merged scan result: {materials, unmatched}
  textureIndex: {},         // "<token>_<SUFFIX>": "<basename>" - from api.get_texture_index()
  materialsData: null,      // parsed materials.json, mutated live by the editor
  materialsPath: null,
  names: [],                // material keys currently shown on Source
  selected: new Set(),
  selectionAnchor: null,
  focused: null,
  groupEditMode: false,
  clipboard: null,
  basePathsByField: {},
  textureBasePath: '',
  genSettings: null,        // fetched from api.get_settings()
  deliveryDestination: null,
  levelBasePath: null,
  materialFilter: '',
  materialFilterTimer: null,
  userPreferences: { accent_color: '#e8974a', light_mode: false, font_scale: 100 },

  // PBR Generator panel - scoped to a single (material, stage), never a
  // group, since stage map requirements vary material-to-material and are
  // handled manually rather than batch-generated.
  pbrGenOpen: false,
  pbrGenMaterial: null,
  pbrGenStage: null,
  pbrPreviewRole: 'diffuse',
  pbrLightX: -0.60,
  pbrLightY: 0.75,
  pbrLightPower: 1.2,
  pbrShape: 'sphere',
  pbrOrbitX: -0.15,
  pbrOrbitY: 0.35,
  pbrZoom: 1.0,
  genSettingsDraft: null,   // edited live in the panel; only pushed to the
                             // backend when a role is generated or the
                             // panel is closed - never on every keystroke.
  generationStatus: {},     // from api.get_generation_status(material): per-role {source, approximate}

  // Deliver tab
  ddsSettings: null,        // from api.get_dds_settings(): {texconv_path, texconv_resolved, default_texconv_path, formats, overrides, mip_settings}
  workingFolderStats: { file_count: 0, total_bytes: 0 },
  deliverExpanded: new Set(), // material names with their per-stage DDS override panel open
};

const WINDOWS_8_ACCENTS = [
  ['Lime', '#a4c400'], ['Green', '#60a917'], ['Emerald', '#008a00'], ['Teal', '#00aba9'],
  ['Cyan', '#1ba1e2'], ['Cobalt', '#3e65ff'], ['Indigo', '#6a00ff'], ['Violet', '#aa00ff'],
  ['Pink', '#f472d0'], ['Magenta', '#d80073'], ['Crimson', '#a20025'], ['Red', '#e51400'],
  ['Orange', '#fa6800'], ['Amber', '#f0a30a'], ['Yellow', '#e3c800'], ['Brown', '#825a2c'],
  ['Olive', '#6d8764'], ['Steel', '#647687'], ['Mauve', '#76608a'], ['Taupe', '#87794e'],
];

// Column order must match the <th> order in index.html's Sources table.
const ROLE_LETTER = { diffuse: "D", spec: "S", normal: "N", metal: "M", rough: "R", opacity: "O", ao: "AO" };
const FOLDER_ROLES = ["diffuse", "spec", "normal", "metal", "rough", "opacity", "ao"];

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
// Which materials.json stage field each *generatable* role fills in, and
// how each is labeled in the PBR Generator panel.
const ROLE_FIELD = { rough: 'roughnessMap', metal: 'metallicMap', normal: 'normalMap', ao: 'ambientOcclusionMap' };
const ROLE_LABEL = { rough: 'Roughness', metal: 'Metalness', normal: 'Normal', ao: 'Ambient Occlusion' };
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

// Curated common DDS formats offered in the Deliver tab's format pickers.
const DDS_FORMAT_OPTIONS = [
  'BC1_UNORM', 'BC1_UNORM_SRGB', 'BC3_UNORM', 'BC3_UNORM_SRGB',
  'BC4_UNORM', 'BC5_UNORM', 'BC7_UNORM', 'BC7_UNORM_SRGB', 'R8G8B8A8_UNORM',
];
// Stage fields that get delivered as textures (and so have a DDS format),
// mirrors api.py's DEFAULT_DDS_FORMATS keys.
const DDS_FIELDS = ['baseColorMap', 'normalMap', 'metallicMap', 'roughnessMap', 'ambientOcclusionMap', 'opacityMap', 'emissiveMap'];

// Mirrors api.py's DEFAULT_SETTINGS - used only to seed the generator
// panel's draft if api.get_settings() somehow hasn't resolved yet.
const DEFAULT_GEN_SETTINGS_FALLBACK = {
  roughness_gamma: 1.0, metal_low: 0.5, metal_high: 0.85,
  ao_blur_radius: 3, ao_strength: 1.5,
  diffuse_height_blur: 1, diffuse_height_contrast: 1.0,
  diffuse_normal_strength: 2.0, diffuse_normal_blur: 0,
  diffuse_ao_samples: 8, diffuse_ao_radius: 4.0, diffuse_ao_steps: 4, diffuse_ao_strength: 1.0,
  diffuse_roughness_sensitivity: 1.0, diffuse_roughness_kernel: 5,
  diffuse_metal_low: 0.5, diffuse_metal_high: 0.85,
};

const el = id => document.getElementById(id);

function setEditorFeatureSidebarVisible(visible) {
  // No-op: PBR Generator is now on a separate page
}

// Hides/restores the Sources sidebar while the PBR Generator panel is
// open, so the feature sidebar has room. The sidebar's resizable width
// (persisted separately in localStorage) is untouched - this just toggles
// a class that hides it, rather than shrinking it to zero.
function setSourcesSidebarCollapsed(collapsed) {
  // No-op: PBR Generator is now on a separate page
}

function hexToRgb(hex) {
  const value = hex.replace('#', '');
  return [0, 2, 4].map(offset => parseInt(value.slice(offset, offset + 2), 16) / 255);
}

function rgbToHsl([red, green, blue]) {
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const lightness = (max + min) / 2;
  if (max === min) return [0, 0, lightness];
  const delta = max - min;
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let hue;
  if (max === red) hue = (green - blue) / delta + (green < blue ? 6 : 0);
  else if (max === green) hue = (blue - red) / delta + 2;
  else hue = (red - green) / delta + 4;
  return [hue * 60, saturation, lightness];
}

function hslColor(hue, saturation, lightness) {
  return `hsl(${Math.round((hue + 360) % 360)} ${Math.round(saturation * 100)}% ${Math.round(lightness * 100)}%)`;
}

function applyUserTheme(preferences) {
  const root = document.documentElement;
  const accent = /^#[0-9a-f]{6}$/i.test(preferences.accent_color)
    ? preferences.accent_color : '#e8974a';
  const [hue, saturation, accentLightness] = rgbToHsl(hexToRgb(accent));
  const lightMode = Boolean(preferences.light_mode);
  const fontScale = [100, 125, 150].includes(Number(preferences.font_scale))
    ? Number(preferences.font_scale) : 100;
  const accent2Lightness = lightMode ? 0.48 : 0.42;
  const accentSaturation = Math.max(0.45, saturation * 0.9);
  root.style.setProperty('--accent', accent);
  root.style.setProperty('--accent-2', hslColor(hue, accentSaturation, accent2Lightness));
  root.style.setProperty('--accent-hover', hslColor(hue, saturation, lightMode ? 0.38 : 0.68));
  root.style.setProperty('--accent-2-hover', hslColor(hue, accentSaturation, lightMode ? 0.40 : 0.34));
  root.style.setProperty('--accent-contrast', accentLightness > 0.58 ? '#171717' : '#ffffff');
  root.style.setProperty('--accent-2-contrast', accent2Lightness > 0.58 ? '#171717' : '#ffffff');
  root.style.setProperty('--bg', lightMode ? '#f1f1f1' : '#202020');
  root.style.setProperty('--bg-deep', lightMode ? '#dfe3e7' : '#2b2b2b');
  root.style.setProperty('--panel', lightMode ? '#ffffff' : '#141414');
  root.style.setProperty('--panel-2', lightMode ? '#e3e3e3' : '#232323');
  root.style.setProperty('--tile', lightMode ? '#d4d4d4' : '#2b2b2b');
  root.style.setProperty('--line', lightMode ? '#b8b8b8' : '#333333');
  root.style.setProperty('--text', lightMode ? '#171717' : '#f2f2f2');
  root.style.setProperty('--text-dim', lightMode ? '#555555' : '#a6a6a6');
  root.style.setProperty('--text-faint', lightMode ? '#777777' : '#707070');
  root.style.setProperty('--accent-contrast', lightMode ? '#171717' : '#ffffff');
  root.style.setProperty('--hover-surface', lightMode ? '#c6c6c6' : '#3a3a3a');
  root.style.setProperty('--input-bg', lightMode ? '#ffffff' : '#111111');
  root.style.setProperty('--ui-scale', String(fontScale / 100));
  state.userPreferences = { accent_color: accent, light_mode: lightMode, font_scale: fontScale };
  const accentInput = el('accent-color');
  if (accentInput) accentInput.value = accent;
  const lightModeInput = el('light-mode');
  if (lightModeInput) lightModeInput.checked = lightMode;
  document.querySelectorAll('#font-scale [data-scale]').forEach(button => {
    button.classList.toggle('active', Number(button.dataset.scale) === fontScale);
    button.setAttribute('aria-pressed', String(Number(button.dataset.scale) === fontScale));
  });
  renderAccentPalette();
}

function renderAccentPalette() {
  const palette = el('accent-palette');
  if (!palette) return;
  palette.innerHTML = '';
  WINDOWS_8_ACCENTS.forEach(([name, color]) => {
    const swatch = document.createElement('button');
    swatch.type = 'button';
    swatch.className = 'accent-swatch';
    swatch.style.backgroundColor = color;
    swatch.title = name;
    swatch.setAttribute('aria-label', `${name} accent`);
    swatch.classList.toggle('active', color === state.userPreferences.accent_color.toLowerCase());
    swatch.addEventListener('click', async () => {
      applyUserTheme({ ...state.userPreferences, accent_color: color });
      await saveUserPreferences();
    });
    palette.appendChild(swatch);
  });
}

applyUserTheme(state.userPreferences);

function setupSidebarResize() {
  const layout = el('editor-workspace').parentElement;
  const handle = el('sidebar-resize-handle');
  if (!layout || !handle) return;

  const savedWidth = Number(localStorage.getItem('pbr-sidebar-width'));
  if (savedWidth >= 280) layout.style.setProperty('--sidebar-width', `${savedWidth}px`);

  const widthFromClientX = (clientX, bounds) => {
    const maxWidth = Math.max(280, bounds.width - 380);
    return Math.max(280, Math.min(maxWidth, clientX - bounds.left));
  };
  const applyWidth = (width) => {
    layout.style.setProperty('--sidebar-width', `${width}px`);
  };
  let dragBounds = null;
  let pendingWidth = null;
  let frameId = null;
  const queueWidth = (clientX) => {
    pendingWidth = widthFromClientX(clientX, dragBounds);
    if (frameId !== null) return;
    frameId = requestAnimationFrame(() => {
      frameId = null;
      if (pendingWidth !== null) applyWidth(pendingWidth);
    });
  };
  const saveWidth = () => {
    if (pendingWidth !== null) applyWidth(pendingWidth);
    if (frameId !== null) cancelAnimationFrame(frameId);
    frameId = null;
    if (pendingWidth !== null) localStorage.setItem('pbr-sidebar-width', String(Math.round(pendingWidth)));
    pendingWidth = null;
    renderSourceTable();
  };

  handle.addEventListener('pointerdown', (event) => {
    dragBounds = layout.getBoundingClientRect();
    handle.setPointerCapture(event.pointerId);
    handle.classList.add('dragging');
    queueWidth(event.clientX);
  });
  handle.addEventListener('pointermove', (event) => {
    if (handle.hasPointerCapture(event.pointerId)) queueWidth(event.clientX);
  });
  handle.addEventListener('pointerup', (event) => {
    saveWidth();
    handle.releasePointerCapture(event.pointerId);
    handle.classList.remove('dragging');
    dragBounds = null;
  });
  handle.addEventListener('pointercancel', () => {
    saveWidth();
    handle.classList.remove('dragging');
    dragBounds = null;
  });
  handle.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const current = layout.querySelector('.source-sidebar').getBoundingClientRect().width;
    const bounds = layout.getBoundingClientRect();
    const width = widthFromClientX(bounds.left + current + (event.key === 'ArrowLeft' ? -20 : 20), bounds);
    applyWidth(width);
    localStorage.setItem('pbr-sidebar-width', String(Math.round(width)));
  });
}

setupSidebarResize();

// setupFeaturePanelResize() removed - PBR Generator is now on a separate page

window.addEventListener('pywebviewready', async () => {
  try {
    const preferences = await window.pywebview.api.get_user_preferences();
    applyUserTheme(preferences);
    state.genSettings = await window.pywebview.api.get_settings();
    state.ddsSettings = await window.pywebview.api.get_dds_settings();
    state.folders = await window.pywebview.api.list_texture_folders();
    state.folderScan = await window.pywebview.api.rescan_all();
    state.textureIndex = await window.pywebview.api.get_texture_index();
    renderSourceTable();
    renderEditor();
  } catch (error) {
    toast(`Could not initialize the app: ${error.message}`);
  }
});

renderEditor();
renderSourceTable();

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
    if (btn.dataset.tab === "edit") {
      renderSourceTable();
      renderEditor();
    }
    if (btn.dataset.tab === "deliver") {
      renderDeliverSettings();
      renderDeliverTable();
      refreshWorkingFolderStats().then(renderDeliverSettings);
    }
    if (btn.dataset.tab === "pbr-converter") {
      // Initialize PBR Generator page with the currently focused material
      if (typeof window.renderPbrGeneratorWithMaterial === 'function') {
        const matName = state.focused;
        const matData = state.materialsData && matName ? state.materialsData[matName] : null;
        const hasStages = matData && Array.isArray(matData.Stages) && matData.Stages.length > 0;
        window.renderPbrGeneratorWithMaterial(matName, hasStages ? 0 : null, state.materialsData);
      }
    }
  });
});

document.querySelectorAll('.settings-nav-item').forEach(button => {
  button.addEventListener('click', () => {
    const page = button.dataset.settingsPage;
    document.querySelectorAll('.settings-nav-item').forEach(item => {
      const active = item === button;
      item.classList.toggle('active', active);
      item.setAttribute('aria-pressed', String(active));
    });
    document.querySelectorAll('.settings-page').forEach(content => {
      const active = content.dataset.settingsContent === page;
      content.classList.toggle('active', active);
      content.hidden = !active;
    });
  });
});

async function saveUserPreferences() {
  if (!window.pywebview?.api) return;
  const saved = await window.pywebview.api.update_user_preferences(state.userPreferences);
  if (saved.error) toast(saved.error);
}

const accentInput = el('accent-color');
if (accentInput) accentInput.addEventListener('input', async (event) => {
  applyUserTheme({ ...state.userPreferences, accent_color: event.target.value });
  await saveUserPreferences();
});

const lightModeInput = el('light-mode');
if (lightModeInput) lightModeInput.addEventListener('change', async (event) => {
  applyUserTheme({ ...state.userPreferences, light_mode: event.target.checked });
  await saveUserPreferences();
});

document.querySelectorAll('#theme-mode [data-theme-mode]').forEach(button => {
  button.addEventListener('click', async () => {
    const mode = button.dataset.themeMode;
    const lightMode = mode === 'light'
      || (mode === 'system' && window.matchMedia('(prefers-color-scheme: light)').matches);
    document.querySelectorAll('#theme-mode [data-theme-mode]').forEach(candidate => {
      candidate.setAttribute('aria-pressed', String(candidate === button));
    });
    applyUserTheme({ ...state.userPreferences, light_mode: lightMode });
    await saveUserPreferences();
  });
});

document.querySelectorAll('#font-scale [data-scale]').forEach(button => {
  button.addEventListener('click', async () => {
    applyUserTheme({ ...state.userPreferences, font_scale: Number(button.dataset.scale) });
    await saveUserPreferences();
  });
});

// ---------------------------------------------------------------------
// Sources sidebar: folder scan + materials.json list
// ---------------------------------------------------------------------
el('material-search').addEventListener('input', (event) => {
  state.materialFilter = event.target.value.trim().toLowerCase();
  clearTimeout(state.materialFilterTimer);
  state.materialFilterTimer = setTimeout(renderSourceTable, 100);
});

el('toggle-datamaps-btn').addEventListener('click', (event) => {
  const view = el('datamaps-view');
  const hidden = view.classList.toggle('datamaps-hidden');
  event.currentTarget.textContent = hidden ? 'Show DataMaps' : 'Hide DataMaps';
  event.currentTarget.setAttribute('aria-pressed', String(!hidden));
});

el("add-folder-btn").addEventListener("click", async () => {
  const scan = await window.pywebview.api.pick_and_add_folder();
  if (!scan) return;
  state.folders = await window.pywebview.api.list_texture_folders();
  state.folderScan = scan;
  state.textureIndex = await window.pywebview.api.get_texture_index();
  renderFolderList();
  renderSourceTable();
});

el("rescan-btn").addEventListener("click", async () => {
  state.folderScan = await window.pywebview.api.rescan_all();
  state.textureIndex = await window.pywebview.api.get_texture_index();
  renderSourceTable();
});

async function removeFolder(path) {
  state.folderScan = await window.pywebview.api.remove_texture_folder(path);
  state.folders = await window.pywebview.api.list_texture_folders();
  state.textureIndex = await window.pywebview.api.get_texture_index();
  renderFolderList();
  renderSourceTable();
}

function renderFolderList() {
  const list = el("folder-list");
  list.innerHTML = "";
  state.folders.forEach(f => {
    const li = document.createElement("li");
    li.className = "folder-item" + (f.removable ? "" : " folder-item-locked");
    const label = document.createElement("span");
    label.textContent = f.label === f.path ? f.path : `${f.label} — ${f.path}`;
    li.appendChild(label);
    if (f.removable) {
      const removeBtn = document.createElement("button");
      removeBtn.className = "btn small";
      removeBtn.textContent = "Remove";
      removeBtn.onclick = () => removeFolder(f.path);
      li.appendChild(removeBtn);
    } else {
      const tag = document.createElement("span");
      tag.className = "folder-tag";
      tag.textContent = "auto";
      li.appendChild(tag);
    }
    list.appendChild(li);
  });
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
  await closePbrGenerator(true); // switching files - drop any open generator scope without re-saving into the new file's settings twice

  // Restore whatever project state came back with this materials.json
  // (or defaults, if no .pbrproject.json exists alongside it yet).
  state.folders = result.folders;
  state.genSettings = result.settings;
  state.deliveryDestination = result.delivery_destination;
  state.levelBasePath = result.level_base_path;
  state.ddsSettings = result.dds_settings;
  state.deliverExpanded = new Set();
  state.folderScan = await window.pywebview.api.rescan_all();
  state.textureIndex = await window.pywebview.api.get_texture_index();

  const detected = detectBasePaths(state.materialsData);
  state.basePathsByField = detected.byField;
  // A restored project's level_base_path (explicitly set on Deliver) takes
  // priority over whatever we auto-detect from the file's existing paths.
  state.textureBasePath = state.levelBasePath || detected.overall;
  if (!state.levelBasePath && detected.overall) {
    state.levelBasePath = detected.overall;
    await window.pywebview.api.set_level_base_path(detected.overall);
  }

  el("materials-stat").textContent = result.path + " — " + Object.keys(result.data).length + " materials";
  el("destination-path").textContent = state.deliveryDestination || "no destination set";
  renderFolderList();
  renderSourceTable();
  renderEditor();
});

el("select-all-btn").addEventListener("click", () => {
  state.names.forEach(n => state.selected.add(n));
  refreshSourceSelection();
});
el("select-none-btn").addEventListener("click", () => {
  state.selected.clear();
  state.groupEditMode = false;
  el("group-edit-btn").classList.remove("active");
  refreshSourceSelection();
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

function getActiveLayerCount(mat) {
  const activeLayers = Number(mat.activeLayers);
  return Number.isFinite(activeLayers) ? activeLayers : 1;
}

function selectMaterialRange(index, additive = false) {
  if (state.selectionAnchor === null) state.selectionAnchor = index;
  if (!additive) state.selected.clear();
  const start = Math.min(state.selectionAnchor, index);
  const end = Math.max(state.selectionAnchor, index);
  for (let rangeIndex = start; rangeIndex <= end; rangeIndex++) {
    state.selected.add(state.names[rangeIndex]);
  }
}

function selectMaterial(name, index, event, checkbox) {
  const additive = event.ctrlKey || event.metaKey;
  if (event.shiftKey) {
    selectMaterialRange(index, additive);
  } else if (checkbox) {
    state.selected.clear();
    if (checkbox.checked) state.selected.add(name);
    state.selectionAnchor = index;
  } else if (additive) {
    if (state.selected.has(name)) state.selected.delete(name);
    else state.selected.add(name);
    state.selectionAnchor = index;
  } else {
    state.selected.clear();
    state.selected.add(name);
    state.selectionAnchor = index;
  }
  state.focused = name;
}

function refreshSourceSelection() {
  document.querySelectorAll('#materials-tbody tr[data-material]').forEach(row => {
    const name = row.dataset.material;
    row.classList.toggle('selected', state.selected.has(name));
    row.classList.toggle('focused', state.focused === name);
    const checkbox = row.querySelector('.material-select');
    if (checkbox) checkbox.checked = state.selected.has(name);
  });
  const allNames = state.materialsData
    ? Object.keys(state.materialsData)
    : Object.keys((state.folderScan && state.folderScan.materials) || {});
  el('selection-count').textContent = `${state.selected.size} selected / ${allNames.length} loaded`;
}

function renderSourceTable() {
  const tbody = el("materials-tbody");
  tbody.innerHTML = "";

  const allNames = state.materialsData
    ? Object.keys(state.materialsData).sort()
    : Object.keys((state.folderScan && state.folderScan.materials) || {}).sort();
  state.names = state.materialFilter
    ? allNames.filter(name => name.toLowerCase().includes(state.materialFilter))
    : allNames;
  el('selection-count').textContent = `${state.selected.size} selected / ${allNames.length} loaded`;
  const scanEntries = new Map(Object.entries((state.folderScan && state.folderScan.materials) || {})
    .map(([name, entry]) => [name.toLowerCase(), entry]));
  const rows = document.createDocumentFragment();

  for (const name of state.names) {
    const row = document.createElement("tr");
    row.dataset.material = name;
    row.className = state.selected.has(name) ? 'selected' : '';
    if (state.focused === name) row.classList.add('focused');

    const cbCell = document.createElement("td");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "material-select";
    checkbox.checked = state.selected.has(name);
    checkbox.addEventListener("click", (event) => {
      event.stopPropagation();
      const index = state.names.indexOf(name);
      selectMaterial(name, index, event, checkbox);
      refreshSourceSelection();
      if (state.groupEditMode) renderEditor();
    });
    cbCell.appendChild(checkbox);
    row.appendChild(cbCell);

    const nameCell = document.createElement("td");
    nameCell.textContent = name;
    nameCell.addEventListener("click", async (event) => {
      const index = state.names.indexOf(name);
      selectMaterial(name, index, event, null);
      state.groupEditMode = false;
      if (state.pbrGenOpen && state.pbrGenMaterial !== name) await closePbrGenerator();
      refreshSourceSelection();
      document.querySelector('.tab-btn[data-tab="edit"]').click();
    });
    row.appendChild(nameCell);

    const folderEntry = scanEntries.get(name.toLowerCase());
    const assignedDiffuse = state.materialsData && state.materialsData[name]
      ? (state.materialsData[name].Stages || []).some(stage => stage && typeof stage.baseColorMap === 'string' && stage.baseColorMap.trim())
      : false;
    for (const role of FOLDER_ROLES) {
      const cell = document.createElement("td");
      const scanned = !!(folderEntry && folderEntry.roles[role]);
      const present = scanned || (role === 'diffuse' && assignedDiffuse);
      cell.textContent = present ? "✓" : "✗";
      cell.className = `datamap-cell ${present ? "present" : "missing"}`;
      cell.title = scanned
        ? folderEntry.roles[role]
        : (present ? 'Diffuse assigned in materials.json; available for derived map generation' : `${ROLE_LETTER[role]} (${role}) not found in any scanned folder`);
      row.appendChild(cell);
    }

    const stagesCell = document.createElement("td");
    stagesCell.textContent = state.materialsData ? `${getActiveLayerCount(state.materialsData[name])}/4` : "—";
    row.appendChild(stagesCell);

    rows.appendChild(row);
  }
  tbody.appendChild(rows);

  const unmatchedDetails = el("unmatched-details");
  const unmatchedList = el("unmatched-list");
  const unmatchedCount = el("unmatched-count");
  unmatchedList.innerHTML = "";
  const unmatched = (state.folderScan && state.folderScan.unmatched) || [];
  unmatchedCount.textContent = unmatched.length;
  if (unmatched.length) {
    unmatchedDetails.hidden = false;
    unmatched.forEach(f => {
      const li = document.createElement("li");
      li.textContent = f;
      unmatchedList.appendChild(li);
    });
  } else {
    unmatchedDetails.hidden = true;
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
// Also handles other map types and complex basenames by stripping any known
// suffix letter(s) just like discovery/name_parser.py does.
function deriveMapToken(baseColorMapPath) {
  if (!baseColorMapPath || typeof baseColorMapPath !== 'string') return null;
  const filename = baseColorMapPath.split('/').pop();
  const dot = filename.lastIndexOf('.');
  const base = dot > 0 ? filename.slice(0, dot) : filename;
  // Match the pattern: basename_SUFFIX where SUFFIX is one of the known role letters
  // This mirrors discovery/name_parser.py's PATTERN logic.
  const m = base.match(/^(.+)_(REF|AO|[DNMROAS])$/i);
  return m ? stripHexPrefix(m[1]) : stripHexPrefix(base);
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
  if (Object.keys(state.textureIndex).length === 0) { toast('Add a texture folder first (Sources sidebar)'); return; }
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

// Finds the exact key (not just the entry) in the last folder scan matching
// a materials.json material name, case-insensitively - generate_map needs
// the scan's own key to look up the source spec/normal/diffuse file.
function findFolderScanKey(name) {
  if (!state.folderScan) return null;
  const lower = name.toLowerCase();
  for (const key of Object.keys(state.folderScan.materials || {})) {
    if (key.toLowerCase() === lower) return key;
  }
  return null;
}

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
// PBR Generator panel - focused-stage-scoped, diffuse-fallback-aware.
//
// Settings shown here are edited into state.genSettingsDraft ONLY. No
// api.update_settings() call and no api.generate_map() call happens as
// the user types - that only happens when a per-role Generate button is
// clicked, or when the panel is closed (which persists the draft as a
// convenience so it's there next time, without ever writing an image).
// ---------------------------------------------------------------------
async function openPbrGenerator(materialName, stageIndex) {
  if (state.pbrGenOpen) await closePbrGenerator();
  state.pbrGenMaterial = materialName;
  state.pbrGenStage = stageIndex;
  state.pbrGenOpen = true;
  state.genSettingsDraft = Object.assign({}, state.genSettings || DEFAULT_GEN_SETTINGS_FALLBACK);
  state.generationStatus = {};
  setEditorFeatureSidebarVisible(true);
  setSourcesSidebarCollapsed(true);
  renderPbrGeneratorPanel();
  try {
    const scanKey = findFolderScanKey(materialName) || materialName;
    state.generationStatus = await window.pywebview.api.get_generation_status(scanKey, stageIndex, scanKey);
  } catch (e) {
    state.generationStatus = {};
  }
  renderPbrGeneratorPanel();
}

// silent=true skips the toast, used when switching materials/files rather
// than the user explicitly closing the panel.
async function closePbrGenerator(silent) {
  if (!state.pbrGenOpen && state.genSettingsDraft === null) return;
  if (state.genSettingsDraft) {
    state.genSettings = Object.assign({}, state.genSettingsDraft);
    try {
      await window.pywebview.api.update_settings(state.genSettingsDraft);
      if (!silent) toast('Generator settings saved');
    } catch (e) { /* best-effort - draft is still reflected in state.genSettings */ }
  }
  state.pbrGenOpen = false;
  state.pbrGenMaterial = null;
  state.pbrGenStage = null;
  state.genSettingsDraft = null;
  state.generationStatus = {};
  setEditorFeatureSidebarVisible(false);
  setSourcesSidebarCollapsed(false);
  const panel = el('editor-feature-sidebar');
  if (panel) panel.innerHTML = '';
}

function draftSettingField(container, label, key, opts = {}) {
  const wrap = document.createElement('label');
  wrap.className = 'pbr-gen-setting';
  wrap.textContent = label;
  const input = document.createElement('input');
  input.type = 'number';
  if (opts.step !== undefined) input.step = opts.step;
  if (opts.min !== undefined) input.min = opts.min;
  if (opts.max !== undefined) input.max = opts.max;
  input.value = state.genSettingsDraft[key];
  input.addEventListener('change', () => {
    const v = Number(input.value);
    if (Number.isNaN(v)) return;
    state.genSettingsDraft[key] = v;
    renderPbrGeneratorPanel(); // re-render just to refresh the unsaved-changes badge
  });
  wrap.appendChild(input);
  container.appendChild(wrap);
  return wrap;
}

function renderPbrGenRoleCard(container, mat, stage, role) {
  const card = document.createElement('div');
  card.className = 'pbr-gen-card';

  const head = document.createElement('div');
  head.className = 'pbr-gen-card-head';
  const label = document.createElement('span');
  label.className = 'pbr-gen-card-label';
  label.textContent = ROLE_LABEL[role];
  head.appendChild(label);

  const info = state.generationStatus[role] || { source: null, approximate: false };
  const badge = document.createElement('span');
  let badgeText, badgeClass;
  if (!info.source) { badgeText = 'no source'; badgeClass = 'none'; }
  else if (info.approximate) { badgeText = 'diffuse (approx.)'; badgeClass = 'approx'; }
  else { badgeText = role === 'ao' ? 'scanned normal' : 'scanned spec'; badgeClass = 'primary'; }
  badge.className = 'pbr-gen-badge ' + badgeClass;
  badge.textContent = badgeText;
  head.appendChild(badge);
  card.appendChild(head);

  const fieldKey = ROLE_FIELD[role];
  const currentVal = stage ? stage[fieldKey] : null;
  const currentRow = document.createElement('div');
  currentRow.className = 'pbr-gen-current';
  currentRow.textContent = currentVal ? ('current: ' + currentVal.split('/').pop()) : 'not assigned in this stage';
  card.appendChild(currentRow);

  const settingsRow = document.createElement('div');
  settingsRow.className = 'pbr-gen-settings-row';

  if (role === 'rough') {
    if (info.source === 'spec') {
      draftSettingField(settingsRow, 'Gamma', 'roughness_gamma', { step: 0.1, min: 0.1, max: 5 });
    } else {
      draftSettingField(settingsRow, 'Sensitivity', 'diffuse_roughness_sensitivity', { step: 0.1, min: 0, max: 5 });
      draftSettingField(settingsRow, 'Kernel', 'diffuse_roughness_kernel', { step: 1, min: 1, max: 25 });
      draftSettingField(settingsRow, 'Height blur', 'diffuse_height_blur', { step: 1, min: 0, max: 10 });
      draftSettingField(settingsRow, 'Height contrast', 'diffuse_height_contrast', { step: 0.1, min: 0.1, max: 5 });
    }
  } else if (role === 'metal') {
    if (info.source === 'spec') {
      draftSettingField(settingsRow, 'Low', 'metal_low', { step: 0.05, min: 0, max: 1 });
      draftSettingField(settingsRow, 'High', 'metal_high', { step: 0.05, min: 0, max: 1 });
    } else {
      draftSettingField(settingsRow, 'Low (approx.)', 'diffuse_metal_low', { step: 0.05, min: 0, max: 1 });
      draftSettingField(settingsRow, 'High (approx.)', 'diffuse_metal_high', { step: 0.05, min: 0, max: 1 });
    }
  } else if (role === 'normal') {
    // Only ever diffuse-sourced - a scanned normal is wired in via Populate.
    draftSettingField(settingsRow, 'Strength', 'diffuse_normal_strength', { step: 0.1, min: 0.1, max: 10 });
    draftSettingField(settingsRow, 'Blur', 'diffuse_normal_blur', { step: 1, min: 0, max: 10 });
    draftSettingField(settingsRow, 'Height blur', 'diffuse_height_blur', { step: 1, min: 0, max: 10 });
    draftSettingField(settingsRow, 'Height contrast', 'diffuse_height_contrast', { step: 0.1, min: 0.1, max: 5 });
  } else if (role === 'ao') {
    if (info.source === 'normal') {
      draftSettingField(settingsRow, 'Blur', 'ao_blur_radius', { step: 1, min: 0, max: 20 });
      draftSettingField(settingsRow, 'Strength', 'ao_strength', { step: 0.1, min: 0, max: 10 });
    } else {
      draftSettingField(settingsRow, 'Samples', 'diffuse_ao_samples', { step: 1, min: 1, max: 32 });
      draftSettingField(settingsRow, 'Radius', 'diffuse_ao_radius', { step: 0.5, min: 0.5, max: 32 });
      draftSettingField(settingsRow, 'Steps', 'diffuse_ao_steps', { step: 1, min: 1, max: 16 });
      draftSettingField(settingsRow, 'Strength', 'diffuse_ao_strength', { step: 0.1, min: 0, max: 10 });
    }
  }
  card.appendChild(settingsRow);

  const genBtn = document.createElement('button');
  genBtn.className = 'btn small tile-purple';
  genBtn.textContent = 'Generate';
  genBtn.disabled = !info.source;
  genBtn.title = info.source ? '' : 'No scanned spec/normal or diffuse map available for this material';
  genBtn.onclick = () => generatePbrMap(role);
  card.appendChild(genBtn);

  container.appendChild(card);
}

function drawPbrSphere(canvas, maps) {
  const gl = canvas.getContext('webgl', { antialias: true, alpha: false, depth: true });
  if (!gl) return;
  const vertexSource = `
    attribute vec3 position; attribute vec2 uv; varying vec3 vNormal; varying vec3 vViewDir; varying vec2 texUv;
    uniform float orbitX; uniform float orbitY; uniform float zoom;
    void main() {
      float cx = cos(orbitX), sx = sin(orbitX), cy = cos(orbitY), sy = sin(orbitY);
      vec3 p = vec3(position.x * cy + position.z * sy, position.y, -position.x * sy + position.z * cy);
      p = vec3(p.x, p.y * cx - p.z * sx, p.y * sx + p.z * cx);
      vNormal = normalize(p);
      vViewDir = normalize(vec3(0.0, 0.0, -4.0) - p);
      float depth = p.z + 4.0;
      gl_Position = vec4(p.x / (depth * .62) * zoom, p.y / (depth * .62) * zoom, (depth - 2.0) / 4.0, 1.0);
      texUv = uv;
    }
  `;
  const fragmentSource = `
    precision mediump float; varying vec3 vNormal; varying vec3 vViewDir; varying vec2 texUv;
    uniform sampler2D diffuseMap; uniform sampler2D normalMap; uniform sampler2D roughMap;
    uniform sampler2D metalMap; uniform sampler2D aoMap; uniform sampler2D reflectionMap; uniform vec3 lightDirection; uniform float lightPower;
    vec3 toLinear(vec3 c){ return c*c; }
    vec3 toSRGB(vec3 c){ return sqrt(max(c,0.0)); }
    void main(){
      vec3 base = toLinear(texture2D(diffuseMap, texUv).rgb);
      vec3 mapN = texture2D(normalMap, texUv).xyz * 2.0 - 1.0;
      float reflMask = texture2D(reflectionMap, texUv).r;
      float rough = texture2D(roughMap, texUv).r;
      float metal = texture2D(metalMap, texUv).r;
      float ao = texture2D(aoMap, texUv).r;
      mapN.xy *= (1.0 - step(0.01, reflMask));
      vec3 N = normalize(vNormal + vec3(mapN.xy * 0.65, 0.0));
      vec3 L = normalize(lightDirection);
      vec3 V = vViewDir;
      vec3 H = normalize(L + V);
      float NdotL = max(dot(N, L), 0.0);
      float NdotH = max(dot(N, H), 0.0);
      vec3 ambient = base * 0.30 * ao;
      vec3 diffuse = base * NdotL * (1.0 - metal) * 0.75;
      float specPower = mix(128.0, 2.0, rough);
      float spec = pow(NdotH, specPower) * NdotL;
      vec3 specColor = mix(vec3(1.0), base, metal);
      float specIntensity = mix(0.35, 1.0, metal);
      vec3 specular = specColor * spec * specIntensity;
      vec3 color = ambient + (diffuse + specular) * lightPower;
      color = mix(color * 0.45, color, ao);
      gl_FragColor = vec4(toSRGB(color), 1.0);
    }
  `;
  const compile = (type, source) => { const shader = gl.createShader(type); gl.shaderSource(shader, source); gl.compileShader(shader); return shader; };
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl.VERTEX_SHADER, vertexSource));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragmentSource));
  gl.linkProgram(program); gl.useProgram(program);

  const positions = [], uvs = [], indices = [];
  if (state.pbrShape === 'cube') {
    const faces = [[[0,0,1],[1,0,0],[0,1,0]], [[0,0,-1],[-1,0,0],[0,1,0]], [[1,0,0],[0,0,-1],[0,1,0]], [[-1,0,0],[0,0,1],[0,1,0]], [[0,1,0],[1,0,0],[0,0,-1]], [[0,-1,0],[1,0,0],[0,0,1]]];
    faces.forEach(([normal, axisX, axisY], faceIndex) => {
      const start = positions.length / 3;
      [[-1,-1],[1,-1],[1,1],[-1,1]].forEach(([x, y], vertexIndex) => {
        positions.push(normal[0] * .5 + axisX[0] * x * .5 + axisY[0] * y * .5, normal[1] * .5 + axisX[1] * x * .5 + axisY[1] * y * .5, normal[2] * .5 + axisX[2] * x * .5 + axisY[2] * y * .5);
        uvs.push(vertexIndex === 1 || vertexIndex === 2 ? 1 : 0, vertexIndex >= 2 ? 0 : 1);
      });
      indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
    });
  } else if (state.pbrShape === 'plane') {
    positions.push(-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1); uvs.push(0, 1, 1, 1, 1, 0, 0, 0); indices.push(0, 2, 1, 0, 3, 2);
  } else {
    const rows = state.pbrShape === 'cylinder' ? 12 : 32, columns = 48;
    for (let y = 0; y <= rows; y++) for (let x = 0; x <= columns; x++) {
      const u = x / columns, v = y / rows;
      if (state.pbrShape === 'cylinder') {
        const theta = u * Math.PI * 2;
        positions.push(Math.cos(theta), v * 2 - 1, Math.sin(theta));
      } else {
        const phi = v * Math.PI, theta = u * Math.PI * 2;
        positions.push(Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta));
      }
      uvs.push(u, 1 - v);
    }
    for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) {
      const i = y * (columns + 1) + x; indices.push(i, i + 1, i + columns + 1, i + 1, i + columns + 2, i + columns + 1);
    }
  }
  const buffer = (attribute, data, size) => { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW); const location = gl.getAttribLocation(program, attribute); gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0); };
  buffer('position', positions, 3); buffer('uv', uvs, 2);
  const indexBuffer = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);
  const fbGray = document.createElement('canvas'); fbGray.width = fbGray.height = 2; fbGray.getContext('2d').fillStyle = '#777'; fbGray.getContext('2d').fillRect(0, 0, 2, 2);
  const fbBlack = document.createElement('canvas'); fbBlack.width = fbBlack.height = 2; fbBlack.getContext('2d').fillStyle = '#000'; fbBlack.getContext('2d').fillRect(0, 0, 2, 2);
  const fbNormal = document.createElement('canvas'); fbNormal.width = fbNormal.height = 2; fbNormal.getContext('2d').fillStyle = '#8080ff'; fbNormal.getContext('2d').fillRect(0, 0, 2, 2);
  [['diffuse', fbGray], ['normal', fbNormal], ['rough', fbGray], ['metal', fbBlack], ['ao', fbGray], ['reflection', fbBlack]].forEach(([name, fallback], unit) => {
    const texture = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, texture); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, maps[name] || fallback); gl.uniform1i(gl.getUniformLocation(program, name + 'Map'), unit);
  });
  gl.uniform1f(gl.getUniformLocation(program, 'orbitX'), Number(state.pbrOrbitX));
  gl.uniform1f(gl.getUniformLocation(program, 'orbitY'), Number(state.pbrOrbitY));
  gl.uniform1f(gl.getUniformLocation(program, 'zoom'), Number(state.pbrZoom));
  // The light dial gives an (x, y) position on a disc; the camera in this
  // scene sits at z = -4 looking toward +z, so a camera-facing (visible)
  // surface has a normal whose z-component is negative. For the light to
  // actually be able to hit that surface, L.z must be negative too - z is
  // reconstructed from the disc radius (dial-edge = grazing/rim light,
  // dial-center = light pointing straight back at the camera).
  const lightX = Number(state.pbrLightX) || 0;
  const lightY = Number(state.pbrLightY) || 0;
  const lightMagSq = Math.min(1, lightX * lightX + lightY * lightY);
  const lightZ = -Math.sqrt(Math.max(0, 1 - lightMagSq));
  gl.uniform3fv(gl.getUniformLocation(program, 'lightDirection'), [lightX, lightY, lightZ]);
  gl.uniform1f(gl.getUniformLocation(program, 'lightPower'), Number(state.pbrLightPower));
  canvas.width = canvas.clientWidth * devicePixelRatio; canvas.height = canvas.clientHeight * devicePixelRatio; gl.viewport(0, 0, canvas.width, canvas.height);
  // Depth testing alone is enough to correctly hide the far side of a
  // closed shape - the nearest fragment always wins regardless of triangle
  // draw order. Deliberately NOT culling: this scene's camera looks toward
  // +z (the vertex shader treats (0,0,-4) as the eye and projects forward
  // in +z), which is the reverse of the usual OpenGL -z convention, so a
  // standard CCW/BACK cull assumption ends up discarding the correct
  // (near) faces instead of the hidden (far) ones - worse than not
  // culling at all.
  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LEQUAL);
  gl.disable(gl.CULL_FACE);
  gl.clearColor(.05, .05, .05, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.drawElements(gl.TRIANGLES, indices.length, gl.UNSIGNED_SHORT, 0);
}

// Draws the light-direction gizmo: a disc where the dot's position is the
// (x, y) of the light on the unit circle - dragging to the rim gives a
// grazing/rim light, dragging to the center points the light straight back
// at the camera. This is what actually drives lightDirection in
// drawPbrSphere(), which reconstructs the z-component from how far the dot
// sits from center (see the comment there for the sign convention).
function drawLightDial(canvas) {
  const context = canvas.getContext('2d');
  if (!context) return;
  const width = canvas.width = Math.max(1, canvas.clientWidth) * devicePixelRatio;
  const height = canvas.height = Math.max(1, canvas.clientHeight) * devicePixelRatio;
  const cx = width / 2, cy = height / 2;
  const radius = Math.min(width, height) / 2 - 3 * devicePixelRatio;
  context.clearRect(0, 0, width, height);

  const gradient = context.createRadialGradient(cx, cy, 0, cx, cy, radius);
  gradient.addColorStop(0, '#3c3c3c');
  gradient.addColorStop(1, '#0b0b0b');
  context.fillStyle = gradient;
  context.beginPath();
  context.arc(cx, cy, radius, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = 'rgba(255,255,255,0.18)';
  context.lineWidth = devicePixelRatio;
  context.stroke();

  context.beginPath();
  context.moveTo(cx - radius, cy); context.lineTo(cx + radius, cy);
  context.moveTo(cx, cy - radius); context.lineTo(cx, cy + radius);
  context.strokeStyle = 'rgba(255,255,255,0.10)';
  context.stroke();

  const lightX = Number(state.pbrLightX) || 0;
  const lightY = Number(state.pbrLightY) || 0;
  const dotX = cx + lightX * radius;
  const dotY = cy - lightY * radius; // canvas y grows downward; up-drag should raise the light
  context.beginPath();
  context.arc(dotX, dotY, 6 * devicePixelRatio, 0, Math.PI * 2);
  context.fillStyle = (getComputedStyle(document.documentElement).getPropertyValue('--accent') || '#e8974a').trim();
  context.fill();
  context.lineWidth = 1.5 * devicePixelRatio;
  context.strokeStyle = '#111';
  context.stroke();
}

function setupLightDial(canvas) {
  let dragging = false;
  const updateFromEvent = (event) => {
    const rect = canvas.getBoundingClientRect();
    const radius = Math.min(rect.width, rect.height) / 2;
    if (radius <= 0) return;
    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    let nx = (event.clientX - cx) / radius;
    let ny = -(event.clientY - cy) / radius;
    const mag = Math.hypot(nx, ny);
    if (mag > 1) { nx /= mag; ny /= mag; }
    state.pbrLightX = Number(nx.toFixed(3));
    state.pbrLightY = Number(ny.toFixed(3));
    drawLightDial(canvas);
    refreshPbrPreview();
  };
  canvas.addEventListener('pointerdown', (event) => {
    dragging = true;
    canvas.setPointerCapture(event.pointerId);
    updateFromEvent(event);
  });
  canvas.addEventListener('pointermove', (event) => { if (dragging) updateFromEvent(event); });
  canvas.addEventListener('pointerup', (event) => { dragging = false; canvas.releasePointerCapture(event.pointerId); });
  canvas.addEventListener('pointercancel', () => { dragging = false; });
  drawLightDial(canvas);
}

async function refreshPbrPreview() {
  const materialName = state.pbrGenMaterial;
  if (!materialName) return;
  const scanKey = findFolderScanKey(materialName) || materialName;
  if (!window.pywebview?.api) return;
  const imageCanvas = el('pbr-map-preview');
  const sphereCanvas = el('pbr-sphere-preview');
  if (!imageCanvas || !sphereCanvas) return;
  const roles = ['diffuse', 'normal', 'rough', 'metal', 'ao', 'reflection'];
  const previews = await Promise.all(roles.map(role => window.pywebview.api.get_preview_image(scanKey, role, state.pbrGenStage, scanKey)));
  const images = {};
  await Promise.all(previews.map((preview, index) => new Promise(resolve => {
    if (!preview || preview.error) return resolve();
    const image = new Image(); image.onload = () => { images[roles[index]] = image; resolve(); }; image.onerror = resolve; image.src = preview.data_url;
  })));
  const selected = images[state.pbrPreviewRole] || images.diffuse;
  const context = imageCanvas.getContext('2d');
  imageCanvas.width = imageCanvas.clientWidth * devicePixelRatio;
  imageCanvas.height = imageCanvas.clientHeight * devicePixelRatio;
  context.clearRect(0, 0, imageCanvas.width, imageCanvas.height);
  if (selected) {
    const scale = Math.min(imageCanvas.width / selected.naturalWidth, imageCanvas.height / selected.naturalHeight);
    const width = selected.naturalWidth * scale;
    const height = selected.naturalHeight * scale;
    context.drawImage(selected, (imageCanvas.width - width) / 2, (imageCanvas.height - height) / 2, width, height);
  } else {
    context.fillStyle = '#777';
    context.font = `${Math.max(11, imageCanvas.width / 24)}px sans-serif`;
    context.textAlign = 'center';
    context.fillText('No source image found', imageCanvas.width / 2, imageCanvas.height / 2);
    const error = previews.find(preview => preview && preview.error);
    if (error) {
      context.font = `${Math.max(9, imageCanvas.width / 34)}px sans-serif`;
      context.fillText(error.error, imageCanvas.width / 2, imageCanvas.height / 2 + 22);
    }
  }
  drawPbrSphere(sphereCanvas, images);
}

function renderPbrPreviewPanel() {
  const panel = el('pbr-preview-sidebar');
  if (!panel) return;
  panel.innerHTML = '';
  const title = document.createElement('div');
  title.className = 'pbr-preview-title';
  title.textContent = 'Material Preview';
  panel.appendChild(title);
  const previewControls = document.createElement('div');
  previewControls.className = 'pbr-preview-controls';
  const previewSelect = document.createElement('select');
  ['diffuse', 'normal', 'rough', 'metal', 'ao'].forEach(role => {
    const option = document.createElement('option'); option.value = role; option.textContent = role === 'ao' ? 'Ambient Occlusion' : role[0].toUpperCase() + role.slice(1); previewSelect.appendChild(option);
  });
  previewSelect.value = state.pbrPreviewRole;
  previewSelect.onchange = () => { state.pbrPreviewRole = previewSelect.value; refreshPbrPreview(); };
  previewControls.appendChild(previewSelect); panel.appendChild(previewControls);
  const shapeSelect = document.createElement('select');
  [['sphere', 'Sphere'], ['cube', 'Cube'], ['cylinder', 'Cylinder'], ['plane', 'Plane']].forEach(([shape, label]) => {
    const option = document.createElement('option'); option.value = shape; option.textContent = label; shapeSelect.appendChild(option);
  });
  shapeSelect.value = state.pbrShape;
  shapeSelect.title = 'Preview shape';
  shapeSelect.onchange = () => { state.pbrShape = shapeSelect.value; refreshPbrPreview(); };
  previewControls.appendChild(shapeSelect);
  const lightSection = document.createElement('div');
  lightSection.className = 'pbr-light-section';
  const dialWrap = document.createElement('div');
  dialWrap.className = 'pbr-light-dial-wrap';
  const dialLabel = document.createElement('span');
  dialLabel.className = 'pbr-light-dial-label';
  dialLabel.textContent = 'Light direction';
  dialWrap.appendChild(dialLabel);
  const dialCanvas = document.createElement('canvas');
  dialCanvas.className = 'pbr-light-dial';
  dialCanvas.title = 'Drag to orbit the light around the material';
  dialWrap.appendChild(dialCanvas);
  const dialHint = document.createElement('span');
  dialHint.className = 'pbr-light-dial-hint';
  dialHint.textContent = 'Drag — center is straight-on, edge is grazing';
  dialWrap.appendChild(dialHint);
  lightSection.appendChild(dialWrap);

  const powerControl = document.createElement('label');
  powerControl.className = 'pbr-light-power';
  powerControl.textContent = 'Power';
  const powerInput = document.createElement('input');
  powerInput.type = 'range'; powerInput.min = .2; powerInput.max = 2; powerInput.step = .1; powerInput.value = state.pbrLightPower;
  const powerValue = document.createElement('output');
  powerValue.textContent = powerInput.value;
  powerInput.oninput = () => { state.pbrLightPower = Number(powerInput.value); powerValue.textContent = powerInput.value; refreshPbrPreview(); };
  powerControl.appendChild(powerInput);
  powerControl.appendChild(powerValue);
  lightSection.appendChild(powerControl);
  panel.appendChild(lightSection);
  setupLightDial(dialCanvas);
  const previewGrid = document.createElement('div'); previewGrid.className = 'pbr-preview-grid';
  const mapFrame = document.createElement('div'); mapFrame.className = 'pbr-preview-map-frame';
  const mapLabel = document.createElement('span'); mapLabel.textContent = 'Map'; mapFrame.appendChild(mapLabel);
  const mapCanvas = document.createElement('canvas'); mapCanvas.id = 'pbr-map-preview'; mapCanvas.className = 'pbr-map-preview';
  mapFrame.appendChild(mapCanvas);
  const sphereFrame = document.createElement('div'); sphereFrame.className = 'pbr-preview-sphere-frame';
  const sphereLabel = document.createElement('span'); sphereLabel.textContent = 'PBR'; sphereFrame.appendChild(sphereLabel);
  const sphereCanvas = document.createElement('canvas'); sphereCanvas.id = 'pbr-sphere-preview'; sphereCanvas.className = 'pbr-sphere-preview';
  sphereFrame.appendChild(sphereCanvas);
  previewGrid.appendChild(mapFrame); previewGrid.appendChild(sphereFrame); panel.appendChild(previewGrid);
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let zoomDragging = false;
  sphereCanvas.addEventListener('pointerdown', event => {
    if (event.shiftKey || event.button === 2) {
      zoomDragging = true; lastY = event.clientY;
    } else {
      dragging = true; lastX = event.clientX; lastY = event.clientY;
    }
    sphereCanvas.setPointerCapture(event.pointerId);
  });
  sphereCanvas.addEventListener('pointermove', event => {
    if (dragging) {
      state.pbrOrbitY += (event.clientX - lastX) * .01;
      state.pbrOrbitX += (event.clientY - lastY) * .01;
      state.pbrOrbitX = Math.max(-1.45, Math.min(1.45, state.pbrOrbitX));
      lastX = event.clientX; lastY = event.clientY;
      refreshPbrPreview();
    } else if (zoomDragging) {
      state.pbrZoom += (lastY - event.clientY) * 0.01;
      state.pbrZoom = Math.max(0.2, Math.min(5.0, state.pbrZoom));
      lastY = event.clientY;
      refreshPbrPreview();
    }
  });
  sphereCanvas.addEventListener('pointerup', event => { dragging = false; zoomDragging = false; sphereCanvas.releasePointerCapture(event.pointerId); });
  sphereCanvas.addEventListener('pointercancel', () => { dragging = false; zoomDragging = false; });
  sphereCanvas.addEventListener('wheel', event => {
    event.preventDefault();
    state.pbrZoom += event.deltaY * -0.002;
    state.pbrZoom = Math.max(0.2, Math.min(5.0, state.pbrZoom));
    refreshPbrPreview();
  }, { passive: false });
  refreshPbrPreview();
}

function renderPbrGeneratorPanel() {
  const panel = el('editor-feature-sidebar');
  if (!panel) return;
  panel.innerHTML = '';
  if (!state.pbrGenOpen && !state.pbrGenMaterial) return;

  const mat = state.materialsData ? state.materialsData[state.pbrGenMaterial] : null;
  const stage = (mat && Array.isArray(mat.Stages)) ? mat.Stages[state.pbrGenStage] : null;

  const header = document.createElement('div');
  header.className = 'pbr-gen-header';
  const title = document.createElement('span');
  title.className = 'pbr-gen-title';
  title.textContent = 'PBR Generator';
  const closeBtn = document.createElement('button');
  closeBtn.className = 'btn small';
  closeBtn.textContent = 'Close';
  closeBtn.onclick = async () => { await closePbrGenerator(); renderEditor(); };
  header.appendChild(title);
  header.appendChild(closeBtn);
  panel.appendChild(header);

  const sub = document.createElement('div');
  sub.className = 'pbr-gen-sub';
  sub.textContent = state.pbrGenMaterial + '  ·  stage ' + state.pbrGenStage;
  panel.appendChild(sub);

  const draft = state.genSettingsDraft || {};
  const dirty = state.genSettings ? JSON.stringify(draft) !== JSON.stringify(state.genSettings) : false;
  const dirtyBadge = document.createElement('div');
  dirtyBadge.className = 'pbr-gen-dirty' + (dirty ? ' active' : '');
  dirtyBadge.textContent = dirty
    ? 'Unsaved setting changes — saved automatically when you close this panel'
    : 'No image is written until you click Generate on a map below';
  panel.appendChild(dirtyBadge);

  if (!mat || !stage) {
    const warn = document.createElement('div');
    warn.className = 'hint';
    warn.textContent = 'This material/stage is no longer available.';
    panel.appendChild(warn);
    return;
  }

  ['rough', 'metal', 'normal', 'ao'].forEach(role => renderPbrGenRoleCard(panel, mat, stage, role));

  renderPbrPreviewPanel();

  const resetRow = document.createElement('div');
  resetRow.style.marginTop = '14px';
  const resetBtn = document.createElement('button');
  resetBtn.className = 'btn small';
  resetBtn.textContent = 'Reset unsaved changes';
  resetBtn.disabled = !dirty;
  resetBtn.onclick = () => {
    state.genSettingsDraft = Object.assign({}, state.genSettings || DEFAULT_GEN_SETTINGS_FALLBACK);
    renderPbrGeneratorPanel();
  };
  resetRow.appendChild(resetBtn);
  panel.appendChild(resetRow);
}

async function generatePbrMap(role) {
  const materialName = state.pbrGenMaterial;
  const stageIndex = state.pbrGenStage;
  const mat = state.materialsData && state.materialsData[materialName];
  if (!mat) { toast('Material no longer available'); return; }
  const scanKey = findFolderScanKey(materialName) || materialName;

  // Push the draft live before baking, so this generation uses exactly
  // what's shown in the panel - and it's persisted immediately rather
  // than only on close, in case the app closes unexpectedly mid-session.
  state.genSettings = Object.assign({}, state.genSettingsDraft);
  let result;
  try {
    await window.pywebview.api.update_settings(state.genSettingsDraft);
    result = await window.pywebview.api.generate_map(scanKey, role, stageIndex, true, scanKey);
  } catch (error) {
    toast(`Generation failed: ${error.message}`);
    return;
  }
  if (result.status !== 'ok') {
    toast(result.message || ('Generation failed for ' + role));
    return;
  }

  if (!Array.isArray(mat.Stages)) mat.Stages = [{}, {}, {}, {}];
  while (mat.Stages.length < 4) mat.Stages.push({});
  const fieldKey = ROLE_FIELD[role];
  // The working file keeps its editable extension (e.g. .png) so it can be
  // inspected/reopened, but the delivered asset will be a .dds - point the
  // stage field at that eventual name so materials.json is correct even
  // before Deliver has run. Deliver's manifest builder matches working
  // files by basename (ignoring extension) precisely to support this.
  const deliveredName = result.filename.replace(/\.[^.]+$/, '.dds');
  mat.Stages[stageIndex][fieldKey] = (state.basePathsByField[fieldKey] || state.textureBasePath) + deliveredName;

  state.textureIndex = await window.pywebview.api.get_texture_index();
  state.generationStatus = await window.pywebview.api.get_generation_status(scanKey, stageIndex, scanKey);

  toast(result.message);
  renderPbrGeneratorPanel();
  renderEditor();
  renderSourceTable();
}

// ---------------------------------------------------------------------
// Edit tab: field builders (ported)
// ---------------------------------------------------------------------
function field(labelText, value, onChange, type, mixed, onPopulate) {
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
        : 'Scan a texture folder first (Sources sidebar)';
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
    const boot = document.createElement('div');
    boot.className = 'metro-boot-container';
    boot.innerHTML = '<button class="metro-tile" type="button"><span class="metro-icon">+</span><span class="metro-text">No materials.json<br>file loaded</span></button><div class="metro-hint">Open a materials file to begin</div>';
    boot.querySelector('.metro-tile').addEventListener('click', () => el('open-materials-btn').click());
    editorEl.appendChild(boot);
    return;
  }

  if (state.groupEditMode && state.selected.size > 0) { renderGroupEditor(); return; }

  if (!state.focused || !state.materialsData[state.focused]) {
    const e = document.createElement('div');
    e.id = 'empty-state';
    e.textContent = 'Click a material name in Sources to edit it, or check several and use "Edit as group".';
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
    const nonEmpty = stage && Object.keys(stage).length > 0;
    const card = document.createElement(nonEmpty ? 'div' : 'details');
    card.className = 'stage-card' + (nonEmpty ? '' : ' empty');

    const head = document.createElement(nonEmpty ? 'div' : 'summary');
    head.className = 'stage-head';
    const idx = document.createElement('span');
    idx.className = 'idx';
    idx.textContent = 'STAGE ' + i;
    head.appendChild(idx);
    const spacer = document.createElement('span');
    spacer.className = 'spacer';
    head.appendChild(spacer);

    const genPanelBtn = document.createElement('button');
    const isOpenHere = state.pbrGenOpen && state.pbrGenMaterial === state.focused && state.pbrGenStage === i;
    genPanelBtn.className = 'btn small tile-purple' + (isOpenHere ? ' active' : '');
    genPanelBtn.type = 'button';
    genPanelBtn.textContent = isOpenHere ? 'Close Generator' : 'PBR Generator';
    genPanelBtn.title = 'Derive rough/metal/normal/ao maps for this stage from scanned spec/normal, or from diffuse when those are missing';
    genPanelBtn.onclick = async () => {
      if (isOpenHere) {
        await closePbrGenerator();
      } else {
        await openPbrGenerator(state.focused, i);
      }
      renderEditor();
    };
    head.appendChild(genPanelBtn);

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
        grid.appendChild(field(key, stage[key] ?? null, setVal, type, false, onPopulate));
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
  banner.textContent = 'Every field below writes live to all ' + mats.length + ' checked materials as you edit. Fields marked "(mixed)" currently differ across the selection. Map generation is per-stage and per-material only (use PBR Generator from a single material\'s Stage card) since stage requirements vary material to material.';
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
    const nonEmpty = mats.some(mat => mat.Stages[i] && Object.keys(mat.Stages[i]).length > 0);
    const card = document.createElement(nonEmpty ? 'div' : 'details');
    card.className = 'stage-card' + (nonEmpty ? '' : ' empty');

    const head = document.createElement(nonEmpty ? 'div' : 'summary');
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
        grid.appendChild(field(key, g.value, setVal, type, g.mixed, onPopulate));
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
// Deliver tab: readiness summary, texconv/DDS settings, working-folder
// stats, and the manifest-driven delivery itself.
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

function formatBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(2) + ' MB';
}

async function refreshWorkingFolderStats() {
  state.workingFolderStats = await window.pywebview.api.get_working_folder_stats();
}

function ddsFormatSelect(value, onChange, includeDefaultOption) {
  const sel = document.createElement('select');
  if (includeDefaultOption) {
    const def = document.createElement('option');
    def.value = '';
    def.textContent = '(use default)';
    sel.appendChild(def);
  }
  DDS_FORMAT_OPTIONS.forEach(fmt => {
    const o = document.createElement('option');
    o.value = fmt;
    o.textContent = fmt;
    if (value === fmt) o.selected = true;
    sel.appendChild(o);
  });
  if (!value && !includeDefaultOption) sel.value = DDS_FORMAT_OPTIONS[0];
  sel.onchange = () => onChange(sel.value);
  return sel;
}

function resolveDdsFormat(materialName, stageIndex, field) {
  const dds = state.ddsSettings;
  if (!dds) return 'BC1_UNORM';
  const key = `${materialName}|${stageIndex}|${field}`;
  return dds.overrides[key] || dds.formats[field] || 'BC1_UNORM';
}

function renderDeliverSettings() {
  const container = el('deliver-settings');
  if (!container) return;
  container.innerHTML = '';
  const dds = state.ddsSettings;
  if (!dds) return;

  // texconv location + validation
  const texRow = document.createElement('div');
  texRow.className = 'toolbar';
  const texLabel = document.createElement('span');
  texLabel.className = 'folder-path';
  texLabel.textContent = dds.texconv_resolved
    ? ('texconv: ' + dds.texconv_resolved)
    : ('texconv: not found (expected at ' + dds.default_texconv_path + ')');
  const pickTexBtn = document.createElement('button');
  pickTexBtn.textContent = 'Choose texconv.exe…';
  pickTexBtn.onclick = async () => {
    const updated = await window.pywebview.api.pick_texconv_path();
    if (updated) { state.ddsSettings = updated; renderDeliverSettings(); }
  };
  const checkBtn = document.createElement('button');
  checkBtn.textContent = 'Check';
  texRow.appendChild(texLabel);
  texRow.appendChild(pickTexBtn);
  texRow.appendChild(checkBtn);
  container.appendChild(texRow);

  const statusLine = document.createElement('div');
  statusLine.className = 'deliver-status-line';
  container.appendChild(statusLine);
  checkBtn.onclick = async () => {
    const result = await window.pywebview.api.check_texconv();
    statusLine.textContent = result.message;
    statusLine.className = 'deliver-status-line ' + (result.status === 'ok' ? 'ok' : 'error');
  };

  // Default DDS format per delivered map type
  const ddsTitle = document.createElement('div');
  ddsTitle.className = 'section-title';
  ddsTitle.textContent = 'Default DDS format per map type';
  container.appendChild(ddsTitle);
  const grid = document.createElement('div');
  grid.className = 'deliver-settings-grid';
  DDS_FIELDS.forEach(field => {
    const wrap = document.createElement('div');
    wrap.className = 'field';
    const label = document.createElement('label');
    label.textContent = field;
    wrap.appendChild(label);
    wrap.appendChild(ddsFormatSelect(dds.formats[field], async (val) => {
      state.ddsSettings = await window.pywebview.api.update_dds_defaults({ [field]: val });
    }, false));
    grid.appendChild(wrap);
  });
  container.appendChild(grid);
  const ddsHint = document.createElement('p');
  ddsHint.className = 'hint';
  ddsHint.textContent = 'Per-stage overrides are available per material below (stages can legitimately want different compression than the default).';
  container.appendChild(ddsHint);

  // Mip settings
  const mipTitle = document.createElement('div');
  mipTitle.className = 'section-title';
  mipTitle.textContent = 'Mipmaps';
  container.appendChild(mipTitle);
  const mipRow = document.createElement('div');
  mipRow.className = 'toolbar';
  const mipToggleWrap = document.createElement('label');
  mipToggleWrap.className = 'field bool-field';
  const mipToggle = document.createElement('input');
  mipToggle.type = 'checkbox';
  mipToggle.checked = !!dds.mip_settings.generate_mips;
  mipToggle.onchange = async () => {
    state.ddsSettings = await window.pywebview.api.update_mip_settings({ generate_mips: mipToggle.checked });
  };
  const mipToggleLabel = document.createElement('span');
  mipToggleLabel.textContent = 'Generate mip chain';
  mipToggleWrap.appendChild(mipToggle);
  mipToggleWrap.appendChild(mipToggleLabel);
  mipRow.appendChild(mipToggleWrap);

  const mipLevelsWrap = document.createElement('div');
  mipLevelsWrap.className = 'field';
  const mipLevelsLabel = document.createElement('label');
  mipLevelsLabel.textContent = 'Mip levels (0 = full chain)';
  const mipLevelsInput = document.createElement('input');
  mipLevelsInput.type = 'number';
  mipLevelsInput.min = 0;
  mipLevelsInput.value = dds.mip_settings.mip_levels || 0;
  mipLevelsInput.onchange = async () => {
    state.ddsSettings = await window.pywebview.api.update_mip_settings({ mip_levels: Number(mipLevelsInput.value) || 0 });
  };
  mipLevelsWrap.appendChild(mipLevelsLabel);
  mipLevelsWrap.appendChild(mipLevelsInput);
  mipRow.appendChild(mipLevelsWrap);
  container.appendChild(mipRow);

  // Working folder stats + manual cleanup
  const wfTitle = document.createElement('div');
  wfTitle.className = 'section-title';
  wfTitle.textContent = 'Working folder';
  container.appendChild(wfTitle);
  const wfStats = document.createElement('div');
  wfStats.className = 'working-folder-stats';
  const stats = state.workingFolderStats || { file_count: 0, total_bytes: 0 };
  const countSpan = document.createElement('span');
  countSpan.innerHTML = `<strong>${stats.file_count}</strong> file(s)`;
  const sizeSpan = document.createElement('span');
  sizeSpan.innerHTML = `<strong>${formatBytes(stats.total_bytes)}</strong>`;
  wfStats.appendChild(countSpan);
  wfStats.appendChild(sizeSpan);
  const clearBtn = document.createElement('button');
  clearBtn.textContent = 'Clear working folder now';
  clearBtn.onclick = async () => {
    if (!confirm('Delete all generated files currently in the working folder? This cannot be undone.')) return;
    const result = await window.pywebview.api.clear_working_folder();
    toast(result.message);
    state.folderScan = await window.pywebview.api.rescan_all();
    state.textureIndex = await window.pywebview.api.get_texture_index();
    await refreshWorkingFolderStats();
    renderDeliverSettings();
    renderSourceTable();
  };
  wfStats.appendChild(clearBtn);
  container.appendChild(wfStats);
  const wfHint = document.createElement('p');
  wfHint.className = 'hint';
  wfHint.textContent = 'Generated maps stay here - kept even after Deliver - until you clear them manually or close the app.';
  container.appendChild(wfHint);
}

function renderDdsOverridePanel(matName, mat) {
  const wrap = document.createElement('div');
  wrap.style.padding = '10px 0 16px';
  const stages = mat.Stages || [];
  const nonEmptyStages = stages.map((s, i) => ({ s, i })).filter(({ s }) => s && Object.keys(s).length > 0);
  if (nonEmptyStages.length === 0) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = 'No stages with data yet.';
    wrap.appendChild(p);
    return wrap;
  }
  nonEmptyStages.forEach(({ s: stage, i: stageIndex }) => {
    const hasAnyField = DDS_FIELDS.some(f => stage[f]);
    if (!hasAnyField) return;
    const stageTitle = document.createElement('div');
    stageTitle.className = 'section-title';
    stageTitle.style.margin = '10px 0 6px';
    stageTitle.textContent = 'Stage ' + stageIndex;
    wrap.appendChild(stageTitle);
    const grid = document.createElement('div');
    grid.className = 'deliver-settings-grid';
    DDS_FIELDS.forEach(field => {
      if (!stage[field]) return;
      const fieldWrap = document.createElement('div');
      fieldWrap.className = 'field';
      const label = document.createElement('label');
      label.textContent = field;
      fieldWrap.appendChild(label);
      const overrideKey = `${matName}|${stageIndex}|${field}`;
      const currentOverride = (state.ddsSettings && state.ddsSettings.overrides[overrideKey]) || '';
      fieldWrap.appendChild(ddsFormatSelect(currentOverride, async (val) => {
        state.ddsSettings = await window.pywebview.api.set_dds_override(matName, stageIndex, field, val || null);
      }, true));
      grid.appendChild(fieldWrap);
    });
    wrap.appendChild(grid);
  });
  return wrap;
}

function renderDeliverTable() {
  const tbody = el('deliver-tbody');
  tbody.innerHTML = '';
  if (!state.materialsData) {
    el('deliver-stat').textContent = 'Open a materials.json file in the Sources sidebar first.';
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

    const isExpanded = state.deliverExpanded.has(name);
    const ddsCell = document.createElement('td');
    const expandBtn = document.createElement('button');
    expandBtn.className = 'btn small';
    expandBtn.textContent = isExpanded ? 'Hide DDS' : 'DDS overrides';
    expandBtn.onclick = () => {
      if (isExpanded) state.deliverExpanded.delete(name); else state.deliverExpanded.add(name);
      renderDeliverTable();
    };
    ddsCell.appendChild(expandBtn);
    row.appendChild(ddsCell);

    tbody.appendChild(row);

    if (isExpanded) {
      const detailRow = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 4;
      cell.style.textAlign = 'left';
      cell.appendChild(renderDdsOverridePanel(name, mat));
      detailRow.appendChild(cell);
      tbody.appendChild(detailRow);
    }
  });
}

// Builds the manifest deliver_generated() needs: which working-folder file
// maps to which output filename and DDS format. Matches stage-field paths
// to working files by BASENAME (ignoring extension), since a stage field
// points at the eventual "<name>.dds" while the working intermediate keeps
// its editable extension (e.g. "<name>.png"). When the same working file
// is needed under two different formats for two different stages, the
// second one is renamed and that stage's field is updated in-place to
// point at the renamed output - the caller should prompt a Save afterward.
function buildDeliveryManifest(workingFiles) {
  const workingBaseIndex = new Map();
  workingFiles.forEach(f => {
    const base = f.includes('.') ? f.slice(0, f.lastIndexOf('.')) : f;
    workingBaseIndex.set(base, f);
  });

  const manifest = [];
  const formatBySource = new Map(); // working filename -> {format, outputName}
  let renameCount = 0;

  Object.keys(state.materialsData || {}).forEach(matName => {
    const mat = state.materialsData[matName];
    (mat.Stages || []).forEach((stage, stageIndex) => {
      if (!stage) return;
      DDS_FIELDS.forEach(field => {
        const path = stage[field];
        if (!path) return;
        const filename = path.split('/').pop();
        const base = filename.includes('.') ? filename.slice(0, filename.lastIndexOf('.')) : filename;
        const workingFile = workingBaseIndex.get(base);
        if (!workingFile) return; // not something sitting in the working folder - leave untouched by Deliver

        const format = resolveDdsFormat(matName, stageIndex, field);
        let outputName = base + '.dds';
        const existing = formatBySource.get(workingFile);
        if (existing && existing.format !== format) {
          outputName = base + '__' + field + '_s' + stageIndex + '.dds';
          const dir = path.slice(0, path.lastIndexOf('/') + 1);
          stage[field] = dir + outputName;
          renameCount++;
        } else if (!existing) {
          formatBySource.set(workingFile, { format, outputName });
        } else {
          outputName = existing.outputName;
        }
        manifest.push({ source: workingFile, format, output_name: outputName });
      });
    });
  });

  return { manifest, renameCount };
}

el('pick-destination-btn').addEventListener('click', async () => {
  const path = await window.pywebview.api.pick_delivery_destination();
  if (!path) return;
  state.deliveryDestination = path;
  el('destination-path').textContent = path;
});

el('deliver-generated-btn').addEventListener('click', async () => {
  if (!state.materialsData) { toast('Open a materials.json file first'); return; }
  const workingFiles = await window.pywebview.api.list_working_folder_files();
  const { manifest, renameCount } = buildDeliveryManifest(workingFiles);
  const result = await window.pywebview.api.deliver_generated(manifest);
  toast(result.message + (renameCount
    ? ` — ${renameCount} stage field(s) pointed at renamed per-stage variants, remember to Save materials.json`
    : ''));
  el('deliver-stat').textContent = result.message;
  renderDeliverTable();
  renderEditor();
});

el('deliver-save-btn').addEventListener('click', async () => {
  if (!state.materialsData) { toast('Nothing loaded to save'); return; }
  const result = await window.pywebview.api.save_materials_json(state.materialsData);
  el('deliver-stat').textContent = result.message;
  toast(result.message);
});
