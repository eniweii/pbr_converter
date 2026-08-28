// PBR Generator Page - standalone version
// This file provides the PBR Generator functionality as a separate page

(function() {
  'use strict';
  
  // State for the PBR generator page
  const pbrPageState = {
    material: null,
    stage: null,
    genSettingsDraft: null,
    generationStatus: {},
    pbrPreviewRole: 'diffuse',
    pbrLightX: -0.60,
    pbrLightY: 0.75,
    pbrLightPower: 1.2,
    pbrShape: 'sphere',
    pbrOrbitX: -0.15,
    pbrOrbitY: 0.35,
    pbrZoom: 1.0,
  };
  
  // Constants shared with main app
  const ROLE_FIELD = { rough: 'roughnessMap', metal: 'metallicMap', normal: 'normalMap', ao: 'ambientOcclusionMap' };
  const ROLE_LABEL = { rough: 'Roughness', metal: 'Metalness', normal: 'Normal', ao: 'Ambient Occlusion' };
  const DEFAULT_GEN_SETTINGS_FALLBACK = {
    roughness_gamma: 1.0, metal_low: 0.5, metal_high: 0.85,
    ao_blur_radius: 3, ao_strength: 1.5,
    diffuse_height_blur: 1, diffuse_height_contrast: 1.0,
    diffuse_normal_strength: 2.0, diffuse_normal_blur: 0,
    diffuse_ao_samples: 8, diffuse_ao_radius: 4.0, diffuse_ao_steps: 4, diffuse_ao_strength: 1.0,
    diffuse_roughness_sensitivity: 1.0, diffuse_roughness_kernel: 5,
    diffuse_metal_low: 0.5, diffuse_metal_high: 0.85,
  };
  
  const el = (id) => document.getElementById(id);
  
  // Setup resize handle for the generator sidebar
  function setupGeneratorResize() {
    const layout = el('pbr-generator-page');
    const handle = el('pbr-gen-resize-handle');
    if (!layout || !handle) return;
    
    const savedWidth = Number(localStorage.getItem('pbr-gen-sidebar-width'));
    if (savedWidth >= 280) {
      layout.style.setProperty('--gen-sidebar-width', `${savedWidth}px`);
    }
    
    let dragBounds = null;
    let pendingWidth = null;
    let frameId = null;
    
    const widthFromClientX = (clientX, bounds) => {
      const maxWidth = Math.max(280, bounds.width - 400);
      return Math.max(280, Math.min(maxWidth, clientX - bounds.left));
    };
    
    const applyWidth = (width) => {
      layout.style.setProperty('--gen-sidebar-width', `${width}px`);
    };
    
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
      if (pendingWidth !== null) {
        localStorage.setItem('pbr-gen-sidebar-width', String(Math.round(pendingWidth)));
      }
      pendingWidth = null;
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
      const current = layout.querySelector('.pbr-gen-sidebar').getBoundingClientRect().width;
      const bounds = layout.getBoundingClientRect();
      const width = widthFromClientX(bounds.left + current + (event.key === 'ArrowLeft' ? -20 : 20), bounds);
      applyWidth(width);
      localStorage.setItem('pbr-gen-sidebar-width', String(Math.round(width)));
    });
  }
  
  // Draw the light direction dial
  function drawLightDial(canvas) {
    const context = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    context.scale(dpr, dpr);
    
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    const radius = Math.min(rect.width, rect.height) / 2 - 4;
    
    context.clearRect(0, 0, rect.width, rect.height);
    
    // Background circle
    context.beginPath();
    context.arc(centerX, centerY, radius, 0, Math.PI * 2);
    context.fillStyle = '#1a1a1a';
    context.fill();
    context.strokeStyle = '#333';
    context.lineWidth = 2;
    context.stroke();
    
    // Light direction indicator
    const lightX = pbrPageState.pbrLightX * radius;
    const lightY = -pbrPageState.pbrLightY * radius;
    
    context.beginPath();
    context.moveTo(centerX, centerY);
    context.lineTo(centerX + lightX, centerY + lightY);
    context.strokeStyle = '#e8974a';
    context.lineWidth = 3;
    context.stroke();
    
    context.beginPath();
    context.arc(centerX + lightX, centerY + lightY, 5, 0, Math.PI * 2);
    context.fillStyle = '#e8974a';
    context.fill();
  }
  
  // Setup light dial interaction
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
      pbrPageState.pbrLightX = Number(nx.toFixed(3));
      pbrPageState.pbrLightY = Number(ny.toFixed(3));
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
  
  // Draw PBR sphere preview
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
    
    // Compile shaders, create program, buffers, etc.
    // Simplified for brevity - full implementation would go here
    
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * devicePixelRatio;
    canvas.height = rect.height * devicePixelRatio;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0.05, 0.05, 0.05, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  }
  
  // Refresh the preview
  async function refreshPbrPreview() {
    if (!pbrPageState.material) return;
    if (!window.pywebview?.api) return;
    
    const imageCanvas = el('pbr-map-preview');
    const sphereCanvas = el('pbr-sphere-preview');
    if (!imageCanvas || !sphereCanvas) return;
    
    const roles = ['diffuse', 'normal', 'rough', 'metal', 'ao', 'reflection'];
    try {
      const previews = await Promise.all(roles.map(role => 
        window.pywebview.api.get_preview_image(pbrPageState.material, role, pbrPageState.stage)
      ));
      
      const images = {};
      await Promise.all(previews.map((preview, index) => new Promise(resolve => {
        if (!preview || preview.error) return resolve();
        const image = new Image();
        image.onload = () => { images[roles[index]] = image; resolve(); };
        image.onerror = resolve;
        image.src = preview.data_url;
      })));
      
      const selected = images[pbrPageState.pbrPreviewRole] || images.diffuse;
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
      }
      
      drawPbrSphere(sphereCanvas, images);
    } catch (e) {
      console.error('Failed to refresh preview:', e);
    }
  }
  
  // Render the preview panel controls
  function renderPreviewPanel() {
    const roleSelect = el('pbr-preview-role-select');
    const shapeSelect = el('pbr-shape-select');
    const powerInput = el('pbr-light-power');
    const powerValue = el('pbr-light-power-value');
    const dialCanvas = el('pbr-light-dial');
    
    if (!roleSelect || !shapeSelect || !powerInput || !powerValue || !dialCanvas) return;
    
    // Populate role select
    roleSelect.innerHTML = '';
    ['diffuse', 'normal', 'rough', 'metal', 'ao'].forEach(role => {
      const option = document.createElement('option');
      option.value = role;
      option.textContent = role === 'ao' ? 'Ambient Occlusion' : role[0].toUpperCase() + role.slice(1);
      roleSelect.appendChild(option);
    });
    roleSelect.value = pbrPageState.pbrPreviewRole;
    roleSelect.onchange = () => {
      pbrPageState.pbrPreviewRole = roleSelect.value;
      refreshPbrPreview();
    };
    
    // Populate shape select
    shapeSelect.innerHTML = '';
    [['sphere', 'Sphere'], ['cube', 'Cube'], ['cylinder', 'Cylinder'], ['plane', 'Plane']].forEach(([shape, label]) => {
      const option = document.createElement('option');
      option.value = shape;
      option.textContent = label;
      shapeSelect.appendChild(option);
    });
    shapeSelect.value = pbrPageState.pbrShape;
    shapeSelect.onchange = () => {
      pbrPageState.pbrShape = shapeSelect.value;
      refreshPbrPreview();
    };
    
    // Light power
    powerInput.value = pbrPageState.pbrLightPower;
    powerValue.textContent = powerInput.value;
    powerInput.oninput = () => {
      pbrPageState.pbrLightPower = Number(powerInput.value);
      powerValue.textContent = powerInput.value;
      refreshPbrPreview();
    };
    
    // Setup light dial
    setupLightDial(dialCanvas);
    
    // Sphere canvas interactions
    const sphereCanvas = el('pbr-sphere-preview');
    if (sphereCanvas) {
      let dragging = false;
      let lastX = 0, lastY = 0;
      let zoomDragging = false;
      
      sphereCanvas.addEventListener('pointerdown', event => {
        if (event.shiftKey || event.button === 2) {
          zoomDragging = true;
          lastY = event.clientY;
        } else {
          dragging = true;
          lastX = event.clientX;
          lastY = event.clientY;
        }
        sphereCanvas.setPointerCapture(event.pointerId);
      });
      
      sphereCanvas.addEventListener('pointermove', event => {
        if (dragging) {
          pbrPageState.pbrOrbitY += (event.clientX - lastX) * 0.01;
          pbrPageState.pbrOrbitX += (event.clientY - lastY) * 0.01;
          pbrPageState.pbrOrbitX = Math.max(-1.45, Math.min(1.45, pbrPageState.pbrOrbitX));
          lastX = event.clientX;
          lastY = event.clientY;
          refreshPbrPreview();
        } else if (zoomDragging) {
          pbrPageState.pbrZoom += (lastY - event.clientY) * 0.01;
          pbrPageState.pbrZoom = Math.max(0.2, Math.min(5.0, pbrPageState.pbrZoom));
          lastY = event.clientY;
          refreshPbrPreview();
        }
      });
      
      sphereCanvas.addEventListener('pointerup', event => {
        dragging = false;
        zoomDragging = false;
        sphereCanvas.releasePointerCapture(event.pointerId);
      });
      
      sphereCanvas.addEventListener('pointercancel', () => {
        dragging = false;
        zoomDragging = false;
      });
      
      sphereCanvas.addEventListener('wheel', event => {
        event.preventDefault();
        pbrPageState.pbrZoom += event.deltaY * -0.002;
        pbrPageState.pbrZoom = Math.max(0.2, Math.min(5.0, pbrPageState.pbrZoom));
        refreshPbrPreview();
      }, { passive: false });
    }
    
    refreshPbrPreview();
  }
  
  // Draft setting field helper
  function draftSettingField(container, label, key, opts = {}) {
    const wrap = document.createElement('label');
    wrap.className = 'pbr-gen-setting';
    wrap.textContent = label;
    const input = document.createElement('input');
    input.type = 'number';
    if (opts.step !== undefined) input.step = opts.step;
    if (opts.min !== undefined) input.min = opts.min;
    if (opts.max !== undefined) input.max = opts.max;
    input.value = pbrPageState.genSettingsDraft[key];
    input.addEventListener('change', () => {
      const v = Number(input.value);
      if (Number.isNaN(v)) return;
      pbrPageState.genSettingsDraft[key] = v;
      renderGeneratorPanel();
    });
    wrap.appendChild(input);
    container.appendChild(wrap);
    return wrap;
  }
  
  // Render a role card - needs material and stage data from the main app state
  function renderPbrGenRoleCard(container, mat, stage, role) {
    const card = document.createElement('div');
    card.className = 'pbr-gen-card';
    
    const head = document.createElement('div');
    head.className = 'pbr-gen-card-head';
    const label = document.createElement('span');
    label.className = 'pbr-gen-card-label';
    label.textContent = ROLE_LABEL[role];
    head.appendChild(label);
    
    const info = pbrPageState.generationStatus[role] || { source: null, approximate: false };
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
      // Basic conversion settings
      if (info.source === 'spec') {
        draftSettingField(settingsRow, 'Gamma', 'roughness_gamma', { step: 0.1, min: 0.1, max: 5 });
      } else {
        draftSettingField(settingsRow, 'Sensitivity', 'diffuse_roughness_sensitivity', { step: 0.1, min: 0, max: 5 });
        draftSettingField(settingsRow, 'Kernel', 'diffuse_roughness_kernel', { step: 1, min: 1, max: 25 });
        draftSettingField(settingsRow, 'Height blur', 'diffuse_height_blur', { step: 1, min: 0, max: 10 });
        draftSettingField(settingsRow, 'Height contrast', 'diffuse_height_contrast', { step: 0.1, min: 0.1, max: 5 });
      }
      
      // AwesomeBump RMFilterProp - Noise Filter section
      const noiseSection = document.createElement('details');
      noiseSection.className = 'pbr-gen-details';
      noiseSection.open = true;
      const noiseSummary = document.createElement('summary');
      noiseSummary.textContent = 'Noise Filter';
      noiseSection.appendChild(noiseSummary);
      draftSettingField(noiseSection, 'Depth', 'roughness_noise_depth', { step: 1, min: 0, max: 20 });
      draftSettingField(noiseSection, 'Threshold', 'roughness_noise_threshold', { step: 0.05, min: 0, max: 1 });
      draftSettingField(noiseSection, 'Amplifier', 'roughness_noise_amplifier', { step: 0.1, min: 0, max: 5 });
      settingsRow.appendChild(noiseSection);
      
      // AwesomeBump RMFilterProp - Color Filter section
      const colorSection = document.createElement('details');
      colorSection.className = 'pbr-gen-details';
      colorSection.open = false;
      const colorSummary = document.createElement('summary');
      colorSummary.textContent = 'Color Filter';
      colorSection.appendChild(colorSummary);
      const colorPickerWrap = document.createElement('label');
      colorPickerWrap.className = 'pbr-gen-setting';
      colorPickerWrap.textContent = 'Pick Color';
      const colorPicker = document.createElement('input');
      colorPicker.type = 'color';
      colorPicker.value = pbrPageState.genSettingsDraft['roughness_color_picker'] || '#808080';
      colorPicker.addEventListener('change', () => {
        pbrPageState.genSettingsDraft['roughness_color_picker'] = colorPicker.value;
      });
      colorPickerWrap.appendChild(colorPicker);
      colorSection.appendChild(colorPickerWrap);
      const methodOptions = { 0: 'Off', 1: 'Add', 2: 'Subtract', 3: 'Multiply', 4: 'Overlay' };
      const methodWrap = document.createElement('label');
      methodWrap.className = 'pbr-gen-setting';
      methodWrap.textContent = 'Method';
      const methodSelect = document.createElement('select');
      Object.entries(methodOptions).forEach(([val, lbl]) => {
        const opt = document.createElement('option');
        opt.value = val;
        opt.textContent = lbl;
        methodSelect.appendChild(opt);
      });
      methodSelect.value = pbrPageState.genSettingsDraft['roughness_color_method'] || 0;
      methodSelect.addEventListener('change', () => {
        pbrPageState.genSettingsDraft['roughness_color_method'] = Number(methodSelect.value);
      });
      methodWrap.appendChild(methodSelect);
      colorSection.appendChild(methodWrap);
      draftSettingField(colorSection, 'Bias', 'roughness_color_bias', { step: 0.1, min: -2, max: 2 });
      draftSettingField(colorSection, 'Offset', 'roughness_color_offset', { step: 0.1, min: -2, max: 2 });
      const invertWrap = document.createElement('label');
      invertWrap.className = 'pbr-gen-setting pbr-gen-toggle';
      invertWrap.textContent = 'Invert Mask';
      const invertCheck = document.createElement('input');
      invertCheck.type = 'checkbox';
      invertCheck.checked = pbrPageState.genSettingsDraft['roughness_color_invert'] || false;
      invertCheck.addEventListener('change', () => {
        pbrPageState.genSettingsDraft['roughness_color_invert'] = invertCheck.checked;
      });
      invertWrap.appendChild(invertCheck);
      colorSection.appendChild(invertWrap);
      draftSettingField(colorSection, 'Amplifier', 'roughness_color_amplifier', { step: 0.1, min: 0, max: 5 });
      settingsRow.appendChild(colorSection);
      
      // AwesomeBump SurfaceDetailsProp section
      const surfaceSection = document.createElement('details');
      surfaceSection.className = 'pbr-gen-details';
      surfaceSection.open = false;
      const surfaceSummary = document.createElement('summary');
      surfaceSummary.textContent = 'Surface Details';
      surfaceSection.appendChild(surfaceSummary);
      draftSettingField(surfaceSection, 'Contrast', 'roughness_contrast', { step: 0.1, min: 0, max: 3 });
      draftSettingField(surfaceSection, 'DG Radius', 'roughness_double_gauss_radius', { step: 1, min: 0, max: 20 });
      draftSettingField(surfaceSection, 'DG Weight A', 'roughness_double_gauss_weight_a', { step: 0.1, min: 0, max: 5 });
      draftSettingField(surfaceSection, 'DG Weight B', 'roughness_double_gauss_weight_b', { step: 0.1, min: 0, max: 5 });
      draftSettingField(surfaceSection, 'DG Amplifier', 'roughness_double_gauss_amplifier', { step: 0.1, min: 0, max: 5 });
      settingsRow.appendChild(surfaceSection);
      
    } else if (role === 'metal') {
      // Basic conversion settings
      if (info.source === 'spec') {
        draftSettingField(settingsRow, 'Low', 'metal_low', { step: 0.05, min: 0, max: 1 });
        draftSettingField(settingsRow, 'High', 'metal_high', { step: 0.05, min: 0, max: 1 });
      } else {
        draftSettingField(settingsRow, 'Low (approx.)', 'diffuse_metal_low', { step: 0.05, min: 0, max: 1 });
        draftSettingField(settingsRow, 'High (approx.)', 'diffuse_metal_high', { step: 0.05, min: 0, max: 1 });
      }
      
      // AwesomeBump RMFilterProp - Noise Filter section
      const noiseSection = document.createElement('details');
      noiseSection.className = 'pbr-gen-details';
      noiseSection.open = true;
      const noiseSummary = document.createElement('summary');
      noiseSummary.textContent = 'Noise Filter';
      noiseSection.appendChild(noiseSummary);
      draftSettingField(noiseSection, 'Depth', 'metallic_noise_depth', { step: 1, min: 0, max: 20 });
      draftSettingField(noiseSection, 'Threshold', 'metallic_noise_threshold', { step: 0.05, min: 0, max: 1 });
      draftSettingField(noiseSection, 'Amplifier', 'metallic_noise_amplifier', { step: 0.1, min: 0, max: 5 });
      settingsRow.appendChild(noiseSection);
      
      // AwesomeBump RMFilterProp - Color Filter section
      const colorSection = document.createElement('details');
      colorSection.className = 'pbr-gen-details';
      colorSection.open = false;
      const colorSummary = document.createElement('summary');
      colorSummary.textContent = 'Color Filter';
      colorSection.appendChild(colorSummary);
      const colorPickerWrap = document.createElement('label');
      colorPickerWrap.className = 'pbr-gen-setting';
      colorPickerWrap.textContent = 'Pick Color';
      const colorPicker = document.createElement('input');
      colorPicker.type = 'color';
      colorPicker.value = pbrPageState.genSettingsDraft['metallic_color_picker'] || '#808080';
      colorPicker.addEventListener('change', () => {
        pbrPageState.genSettingsDraft['metallic_color_picker'] = colorPicker.value;
      });
      colorPickerWrap.appendChild(colorPicker);
      colorSection.appendChild(colorPickerWrap);
      const methodOptions = { 0: 'Off', 1: 'Add', 2: 'Subtract', 3: 'Multiply', 4: 'Overlay' };
      const methodWrap = document.createElement('label');
      methodWrap.className = 'pbr-gen-setting';
      methodWrap.textContent = 'Method';
      const methodSelect = document.createElement('select');
      Object.entries(methodOptions).forEach(([val, lbl]) => {
        const opt = document.createElement('option');
        opt.value = val;
        opt.textContent = lbl;
        methodSelect.appendChild(opt);
      });
      methodSelect.value = pbrPageState.genSettingsDraft['metallic_color_method'] || 0;
      methodSelect.addEventListener('change', () => {
        pbrPageState.genSettingsDraft['metallic_color_method'] = Number(methodSelect.value);
      });
      methodWrap.appendChild(methodSelect);
      colorSection.appendChild(methodWrap);
      draftSettingField(colorSection, 'Bias', 'metallic_color_bias', { step: 0.1, min: -2, max: 2 });
      draftSettingField(colorSection, 'Offset', 'metallic_color_offset', { step: 0.1, min: -2, max: 2 });
      const invertWrap = document.createElement('label');
      invertWrap.className = 'pbr-gen-setting pbr-gen-toggle';
      invertWrap.textContent = 'Invert Mask';
      const invertCheck = document.createElement('input');
      invertCheck.type = 'checkbox';
      invertCheck.checked = pbrPageState.genSettingsDraft['metallic_color_invert'] || false;
      invertCheck.addEventListener('change', () => {
        pbrPageState.genSettingsDraft['metallic_color_invert'] = invertCheck.checked;
      });
      invertWrap.appendChild(invertCheck);
      colorSection.appendChild(invertWrap);
      draftSettingField(colorSection, 'Amplifier', 'metallic_color_amplifier', { step: 0.1, min: 0, max: 5 });
      settingsRow.appendChild(colorSection);
      
      // AwesomeBump SurfaceDetailsProp section
      const surfaceSection = document.createElement('details');
      surfaceSection.className = 'pbr-gen-details';
      surfaceSection.open = false;
      const surfaceSummary = document.createElement('summary');
      surfaceSummary.textContent = 'Surface Details';
      surfaceSection.appendChild(surfaceSummary);
      draftSettingField(surfaceSection, 'Contrast', 'metallic_contrast', { step: 0.1, min: 0, max: 3 });
      draftSettingField(surfaceSection, 'DG Radius', 'metallic_double_gauss_radius', { step: 1, min: 0, max: 20 });
      draftSettingField(surfaceSection, 'DG Weight A', 'metallic_double_gauss_weight_a', { step: 0.1, min: 0, max: 5 });
      draftSettingField(surfaceSection, 'DG Weight B', 'metallic_double_gauss_weight_b', { step: 0.1, min: 0, max: 5 });
      draftSettingField(surfaceSection, 'DG Amplifier', 'metallic_double_gauss_amplifier', { step: 0.1, min: 0, max: 5 });
      settingsRow.appendChild(surfaceSection);
      
    } else if (role === 'normal') {
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
  
  // Generate a PBR map
  async function generatePbrMap(role) {
    const materialName = pbrPageState.material;
    const stageIndex = pbrPageState.stage;
    
    if (!materialName || !window.pywebview?.api) {
      alert('API not available or material not selected');
      return;
    }
    
    // Push draft settings
    const settingsToUse = Object.assign({}, pbrPageState.genSettingsDraft);
    try {
      await window.pywebview.api.update_settings(settingsToUse);
      const result = await window.pywebview.api.generate_map(materialName, role, stageIndex);
      
      if (result.status === 'ok') {
        alert('Generated: ' + result.filename);
        // Refresh status
        pbrPageState.generationStatus = await window.pywebview.api.get_generation_status(materialName, stageIndex);
        renderGeneratorPanel();
      } else {
        alert(result.message || 'Generation failed');
      }
    } catch (error) {
      alert('Generation error: ' + error.message);
    }
  }
  
  // Expose render functions globally so they can be called with updated material/stage data
  window.renderPbrGeneratorWithMaterial = async function(materialName, stageIndex, materialsData) {
    if (!materialName || stageIndex === null || stageIndex === undefined) {
      pbrPageState.material = null;
      pbrPageState.stage = null;
    } else {
      pbrPageState.material = materialName;
      pbrPageState.stage = stageIndex;
      pbrPageState.genSettingsDraft = Object.assign({}, DEFAULT_GEN_SETTINGS_FALLBACK);
      
      try {
        if (window.pywebview?.api) {
          // Fetch initial settings
          const settings = await window.pywebview.api.get_settings();
          if (settings && !settings.error) {
            pbrPageState.genSettingsDraft = Object.assign({}, settings);
          }
          
          // Resolve the scan key for this material name (case-insensitive match against scan results)
          let scanKey = materialName;
          try {
            const folderScan = await window.pywebview.api.get_texture_index();
            // get_texture_index returns {\"<material>_<suffix>\": \"<filename>\"}, extract unique material names
            const scanMaterials = new Set();
            for (const key of Object.keys(folderScan)) {
              const match = key.match(/^(.+)_[A-Z]+$/i);
              if (match) scanMaterials.add(match[1]);
            }
            const lower = materialName.toLowerCase();
            for (const scanMat of scanMaterials) {
              if (scanMat.toLowerCase() === lower) {
                scanKey = scanMat;
                break;
              }
            }
          } catch (e) {
            console.warn('Could not resolve scan key, using material name directly:', e);
          }
          
          // Fetch generation status using the resolved scan key
          pbrPageState.generationStatus = await window.pywebview.api.get_generation_status(scanKey, stageIndex);
        }
      } catch (e) {
        console.error('Failed to fetch initial data:', e);
      }
    }
    
    renderGeneratorPanel();
    renderPreviewPanel();
    
    // Update page title
    if (materialName) {
      document.getElementById('pbr-preview-title').textContent = materialName + ' - Preview';
    }
  };
  
  // Render the generator panel
  function renderGeneratorPanel() {
    const content = el('pbr-generator-content');
    if (!content) return;
    content.innerHTML = '';
    
    if (!pbrPageState.material || !pbrPageState.stage) {
      content.innerHTML = '<p class="hint">Select a material and stage from the Editor to begin.</p>';
      return;
    }
    
    // Header
    const header = document.createElement('div');
    header.className = 'pbr-gen-header';
    const title = document.createElement('span');
    title.className = 'pbr-gen-title';
    title.textContent = 'PBR Generator';
    header.appendChild(title);
    content.appendChild(header);
    
    // Subtitle
    const sub = document.createElement('div');
    sub.className = 'pbr-gen-sub';
    sub.textContent = pbrPageState.material + ' · stage ' + pbrPageState.stage;
    content.appendChild(sub);
    
    // Dirty badge
    const draft = pbrPageState.genSettingsDraft || {};
    const dirtyBadge = document.createElement('div');
    dirtyBadge.className = 'pbr-gen-dirty';
    dirtyBadge.textContent = 'Unsaved setting changes — saved automatically when generating';
    content.appendChild(dirtyBadge);
    
    // Role cards
    ['rough', 'metal', 'normal', 'ao'].forEach(role => {
      // Mock mat/stage for now - would need to fetch from API
      const mat = {};
      const stage = {};
      renderPbrGenRoleCard(content, mat, stage, role);
    });
    
    // Reset button
    const resetRow = document.createElement('div');
    resetRow.style.marginTop = '14px';
    const resetBtn = document.createElement('button');
    resetBtn.className = 'btn small';
    resetBtn.textContent = 'Reset to defaults';
    resetBtn.onclick = () => {
      pbrPageState.genSettingsDraft = Object.assign({}, DEFAULT_GEN_SETTINGS_FALLBACK);
      renderGeneratorPanel();
    };
    resetRow.appendChild(resetBtn);
    content.appendChild(resetRow);
  }
  
  // Initialize the page
  async function initPage(materialFromUrl, stageFromUrl) {
    // Get URL parameters for material and stage if not provided as arguments
    let material = materialFromUrl;
    let stage = stageFromUrl;
    
    if (material === undefined || material === null) {
      const params = new URLSearchParams(window.location.search);
      material = params.get('material');
      stage = stageFromUrl !== undefined ? stageFromUrl : (params.get('stage') ? parseInt(params.get('stage'), 10) : 0);
    }
    
    if (material) {
      pbrPageState.material = material;
      pbrPageState.stage = stage !== null ? stage : 0;
      pbrPageState.genSettingsDraft = Object.assign({}, DEFAULT_GEN_SETTINGS_FALLBACK);
      
      try {
        if (window.pywebview?.api) {
          // Fetch initial settings
          const settings = await window.pywebview.api.get_settings();
          if (settings && !settings.error) {
            pbrPageState.genSettingsDraft = Object.assign({}, settings);
          }
          
          // Fetch generation status
          pbrPageState.generationStatus = await window.pywebview.api.get_generation_status(material, pbrPageState.stage);
        }
      } catch (e) {
        console.error('Failed to fetch initial data:', e);
      }
    }
    
    setupGeneratorResize();
    renderGeneratorPanel();
    renderPreviewPanel();
    
    // Update page title
    if (material) {
      document.getElementById('pbr-preview-title').textContent = material + ' - Preview';
    }
  }
  
  // Expose initPage globally so app.js can call it when switching tabs
  window.initPbrGeneratorPage = initPage;
  
  // Wait for DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => initPage());
  } else {
    initPage();
  }
})();
