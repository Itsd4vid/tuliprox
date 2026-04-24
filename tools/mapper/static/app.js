/* ============================================================
   Tuliprox Mapper – app.js
   ============================================================ */

// ── State ────────────────────────────────────────────────────
const appState = {
  currentStep: 1,
  sessionId: null,
  groups: [],           // [{id, name, channels:[...]}]  – from parser
  selectedGroupIds: new Set(),
  selectedChannelIds: new Set(),
  finalGroups: [],      // [{id, name, channels:[{id,name,logo,tvg_id}]}]
  generatedFiles: {},   // {filename: content}
  previewFile: null,
};

// ── Init ──────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  renderStep(1);
});

// ── Step Rendering ────────────────────────────────────────────
function renderStep(step) {
  appState.currentStep = step;
  updateStepIndicator(step);
  const container = document.getElementById("stepContent");
  switch (step) {
    case 1: container.innerHTML = buildStep1(); bindStep1(); break;
    case 2: container.innerHTML = buildStep2(); bindStep2(); break;
    case 3: container.innerHTML = buildStep3(); bindStep3(); break;
    case 4: container.innerHTML = buildStep4(); bindStep4(); break;
  }
  container.scrollIntoView({ behavior: "smooth", block: "start" });
}

function updateStepIndicator(activeStep) {
  document.querySelectorAll(".step-item").forEach(el => {
    const s = parseInt(el.dataset.step);
    el.classList.remove("active", "done");
    if (s === activeStep) el.classList.add("active");
    else if (s < activeStep) el.classList.add("done");
  });
}

// ── Helpers ───────────────────────────────────────────────────
function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function showError(containerId, msg) {
  const el = document.getElementById(containerId);
  if (el) el.innerHTML = `<div class="alert alert-error">⚠️ ${escHtml(msg)}</div>`;
}

function clearError(containerId) {
  const el = document.getElementById(containerId);
  if (el) el.innerHTML = "";
}

function logoImg(url, cls = "source-ch-logo", fallbackCls = "source-ch-fallback") {
  if (!url) return `<span class="${fallbackCls}">📺</span>`;
  return `<img src="${escHtml(url)}" class="${cls}" loading="lazy"
              onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
          <span class="${fallbackCls}" style="display:none">📺</span>`;
}

function getSelectedGroups() {
  return appState.groups.filter(g => appState.selectedGroupIds.has(g.id));
}

function getSelectedChannelsInGroups() {
  const result = [];
  for (const g of getSelectedGroups()) {
    const chs = g.channels.filter(c => appState.selectedChannelIds.has(c.id));
    if (chs.length) result.push({ ...g, channels: chs });
  }
  return result;
}

// Returns channels already placed in finalGroups (by id)
function placedChannelIds() {
  const ids = new Set();
  for (const g of appState.finalGroups) {
    for (const c of g.channels) ids.add(c.id);
  }
  return ids;
}

// ── STEP 1 ────────────────────────────────────────────────────
function buildStep1() {
  return `
  <div class="card">
    <div class="card-title">📥 Import M3U Playlist</div>

    <div id="step1Error"></div>

    <div class="input-row">
      <label>Playlist URL</label>
      <div class="input-group">
        <input type="url" id="m3uUrl" placeholder="https://example.com/playlist.m3u" />
        <button class="btn btn-primary" id="loadBtn" onclick="loadPlaylist()">
          <span id="loadBtnText">Load Playlist</span>
        </button>
      </div>
    </div>

    <div class="divider">or</div>

    <div class="file-drop" id="fileDrop" onclick="document.getElementById('fileInput').click()">
      <input type="file" id="fileInput" accept=".m3u,.m3u8,.txt" />
      <div>📂 Click to upload or drag & drop an M3U file</div>
      <div id="fileDropName" style="margin-top:6px;font-size:.8rem;color:var(--text-muted)"></div>
    </div>

    <div id="groupsSection" style="margin-top:24px"></div>
  </div>`;
}

function bindStep1() {
  // File drag & drop
  const drop = document.getElementById("fileDrop");
  const input = document.getElementById("fileInput");

  drop.addEventListener("dragover", e => { e.preventDefault(); drop.classList.add("drag-over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("drag-over"));
  drop.addEventListener("drop", e => {
    e.preventDefault();
    drop.classList.remove("drag-over");
    const file = e.dataTransfer.files[0];
    if (file) { input.files = e.dataTransfer.files; onFileSelected(file); }
  });
  input.addEventListener("change", () => {
    if (input.files[0]) onFileSelected(input.files[0]);
  });

  // If groups already loaded (back navigation)
  if (appState.groups.length) renderGroupList();
}

function onFileSelected(file) {
  document.getElementById("fileDropName").textContent = `Selected: ${file.name}`;
  loadPlaylist(file);
}

async function loadPlaylist(fileArg = null) {
  clearError("step1Error");
  const urlInput = document.getElementById("m3uUrl");
  const fileInput = document.getElementById("fileInput");
  const loadBtn = document.getElementById("loadBtn");
  const loadBtnText = document.getElementById("loadBtnText");

  const file = fileArg || (fileInput && fileInput.files[0]);
  const url = urlInput ? urlInput.value.trim() : "";

  if (!file && !url) {
    showError("step1Error", "Please enter a URL or upload a file.");
    return;
  }

  loadBtn.disabled = true;
  loadBtnText.innerHTML = `<span class="spinner"></span> Loading…`;

  try {
    const formData = new FormData();
    if (file) {
      formData.append("file", file);
    } else {
      formData.append("url", url);
    }

    const res = await fetch("/api/parse", { method: "POST", body: formData });
    const data = await res.json();

    if (!res.ok) throw new Error(data.detail || "Failed to parse playlist.");

    appState.sessionId = data.session_id;
    appState.groups = data.groups || [];
    // Default: all groups selected
    appState.selectedGroupIds = new Set(appState.groups.map(g => g.id));
    // Default: all channels selected
    appState.selectedChannelIds = new Set(
      appState.groups.flatMap(g => g.channels.map(c => c.id))
    );

    renderGroupList();
  } catch (err) {
    showError("step1Error", err.message);
  } finally {
    loadBtn.disabled = false;
    loadBtnText.textContent = "Load Playlist";
  }
}

function renderGroupList() {
  const section = document.getElementById("groupsSection");
  if (!section) return;

  const total = appState.groups.length;
  const selected = appState.selectedGroupIds.size;

  section.innerHTML = `
    <div class="group-controls">
      <span class="group-counter"><strong>${selected}</strong> of <strong>${total}</strong> groups selected</span>
      <div class="flex-gap">
        <button class="btn btn-ghost btn-sm" onclick="selectAllGroups(true)">Select All</button>
        <button class="btn btn-ghost btn-sm" onclick="selectAllGroups(false)">Deselect All</button>
      </div>
    </div>
    <div class="group-list" id="groupList">
      ${appState.groups.map(g => buildGroupRow(g)).join("")}
    </div>
    <div class="nav-bar">
      <span></span>
      <button class="btn btn-primary" id="step1Next"
        ${selected === 0 ? "disabled" : ""}
        onclick="goStep2()">
        Next →
      </button>
    </div>`;
}

function buildGroupRow(group) {
  const isSelected = appState.selectedGroupIds.has(group.id);
  const logos = group.channels.slice(0, 3).map(c =>
    c.logo
      ? `<img src="${escHtml(c.logo)}" class="group-logo" loading="lazy"
              onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
         <span class="logo-placeholder" style="display:none">📺</span>`
      : `<span class="logo-placeholder">📺</span>`
  ).join("");

  return `
    <div class="group-row ${isSelected ? "selected" : ""}"
         onclick="toggleGroup('${escHtml(group.id)}')" data-gid="${escHtml(group.id)}">
      <input type="checkbox" class="group-checkbox" ${isSelected ? "checked" : ""}
             onclick="event.stopPropagation();toggleGroup('${escHtml(group.id)}')"
             data-gchk="${escHtml(group.id)}">
      <span class="group-name">${escHtml(group.name || "(unnamed)")}</span>
      <span class="group-count">${group.channels.length} ch</span>
      <div class="group-logos">${logos}</div>
    </div>`;
}

function toggleGroup(id) {
  if (appState.selectedGroupIds.has(id)) appState.selectedGroupIds.delete(id);
  else appState.selectedGroupIds.add(id);
  // sync checkbox
  const chk = document.querySelector(`[data-gchk="${CSS.escape(id)}"]`);
  if (chk) chk.checked = appState.selectedGroupIds.has(id);
  const row = document.querySelector(`[data-gid="${CSS.escape(id)}"]`);
  if (row) row.classList.toggle("selected", appState.selectedGroupIds.has(id));

  const sel = appState.selectedGroupIds.size;
  const counter = document.querySelector(".group-counter");
  if (counter) counter.innerHTML = `<strong>${sel}</strong> of <strong>${appState.groups.length}</strong> groups selected`;
  const nextBtn = document.getElementById("step1Next");
  if (nextBtn) nextBtn.disabled = sel === 0;
}

function selectAllGroups(select) {
  appState.groups.forEach(g => {
    if (select) appState.selectedGroupIds.add(g.id);
    else appState.selectedGroupIds.delete(g.id);
  });
  renderGroupList();
}

function goStep2() {
  if (appState.selectedGroupIds.size === 0) return;
  renderStep(2);
}

// ── STEP 2 ────────────────────────────────────────────────────
function buildStep2() {
  const groups = getSelectedGroups();
  const totalCh = groups.reduce((a, g) => a + g.channels.length, 0);
  const selCh = groups.reduce((a, g) => a + g.channels.filter(c => appState.selectedChannelIds.has(c.id)).length, 0);
  const pct = totalCh ? Math.round(selCh / totalCh * 100) : 0;

  const accordions = groups.map(g => {
    const selCount = g.channels.filter(c => appState.selectedChannelIds.has(c.id)).length;
    return `
    <div class="accordion-group" id="acc_${escHtml(g.id)}">
      <div class="accordion-header" onclick="toggleAccordion('${escHtml(g.id)}')">
        <span class="accordion-chevron" id="chev_${escHtml(g.id)}">▶</span>
        <span class="accordion-group-name">${escHtml(g.name)}</span>
        <span class="group-count" id="selCount_${escHtml(g.id)}">${selCount}/${g.channels.length}</span>
        <button class="btn btn-ghost btn-sm" style="margin-left:8px"
          onclick="event.stopPropagation();selectAllChannels('${escHtml(g.id)}', true)">All</button>
        <button class="btn btn-ghost btn-sm"
          onclick="event.stopPropagation();selectAllChannels('${escHtml(g.id)}', false)">None</button>
      </div>
      <div class="accordion-body" id="body_${escHtml(g.id)}">
        <div class="channel-grid">
          ${g.channels.map(c => buildChannelCard(c)).join("")}
        </div>
      </div>
    </div>`;
  }).join("");

  return `
  <div class="card">
    <div class="card-title">📺 Select Channels</div>
    <div class="progress-bar-wrap">
      <div class="progress-bar" id="progressBar" style="width:${pct}%"></div>
    </div>
    <div class="progress-label" id="progressLabel">
      <strong>${selCh}</strong> channels selected across <strong>${groups.length}</strong> groups
    </div>
    ${accordions}
    <div class="nav-bar">
      <button class="btn btn-ghost" onclick="renderStep(1)">← Back</button>
      <button class="btn btn-primary" id="step2Next"
        ${selCh === 0 ? "disabled" : ""}
        onclick="goStep3()">
        Next →
      </button>
    </div>
  </div>`;
}

function bindStep2() {
  // open first accordion by default
  const groups = getSelectedGroups();
  if (groups.length) toggleAccordion(groups[0].id);
}

function buildChannelCard(ch) {
  const sel = appState.selectedChannelIds.has(ch.id);
  const logoHtml = ch.logo
    ? `<div class="channel-logo-wrap">
         <img src="${escHtml(ch.logo)}" class="channel-logo" loading="lazy"
              onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
         <div class="channel-logo-fallback" style="display:none">📺</div>
       </div>`
    : `<div class="channel-logo-fallback">📺</div>`;

  return `
    <div class="channel-card ${sel ? "selected" : ""}"
         onclick="toggleChannel('${escHtml(ch.id)}', '${escHtml(ch.groupId || "")}')"
         data-cid="${escHtml(ch.id)}">
      ${logoHtml}
      <span class="channel-name">${escHtml(ch.name)}</span>
    </div>`;
}

function toggleAccordion(gid) {
  const body = document.getElementById(`body_${gid}`);
  const chev = document.getElementById(`chev_${gid}`);
  if (!body) return;
  body.classList.toggle("open");
  if (chev) chev.classList.toggle("open", body.classList.contains("open"));
}

function toggleChannel(cid, _gid) {
  if (appState.selectedChannelIds.has(cid)) appState.selectedChannelIds.delete(cid);
  else appState.selectedChannelIds.add(cid);

  const card = document.querySelector(`[data-cid="${CSS.escape(cid)}"]`);
  if (card) card.classList.toggle("selected", appState.selectedChannelIds.has(cid));

  updateStep2Progress();
}

function selectAllChannels(gid, select) {
  const group = appState.groups.find(g => g.id === gid);
  if (!group) return;
  group.channels.forEach(c => {
    if (select) appState.selectedChannelIds.add(c.id);
    else appState.selectedChannelIds.delete(c.id);
    const card = document.querySelector(`[data-cid="${CSS.escape(c.id)}"]`);
    if (card) card.classList.toggle("selected", select);
  });
  updateStep2Progress();
  // update counter badge
  const selCount = document.getElementById(`selCount_${gid}`);
  if (selCount) selCount.textContent = `${select ? group.channels.length : 0}/${group.channels.length}`;
}

function updateStep2Progress() {
  const groups = getSelectedGroups();
  const totalCh = groups.reduce((a, g) => a + g.channels.length, 0);
  const selCh = groups.reduce((a, g) => a + g.channels.filter(c => appState.selectedChannelIds.has(c.id)).length, 0);
  const pct = totalCh ? Math.round(selCh / totalCh * 100) : 0;

  const bar = document.getElementById("progressBar");
  if (bar) bar.style.width = pct + "%";
  const lbl = document.getElementById("progressLabel");
  if (lbl) lbl.innerHTML = `<strong>${selCh}</strong> channels selected across <strong>${groups.length}</strong> groups`;
  const next = document.getElementById("step2Next");
  if (next) next.disabled = selCh === 0;

  // update all per-group counters
  groups.forEach(g => {
    const cnt = document.getElementById(`selCount_${g.id}`);
    if (cnt) cnt.textContent = `${g.channels.filter(c => appState.selectedChannelIds.has(c.id)).length}/${g.channels.length}`;
  });
}

function goStep3() {
  const selChannels = getSelectedChannelsInGroups();
  if (selChannels.length === 0) return;
  // Seed finalGroups with existing groups if empty, or keep existing
  if (appState.finalGroups.length === 0) {
    appState.finalGroups = selChannels.map(g => ({
      id: `fg_${uid()}`,
      name: g.name,
      channels: g.channels.map(c => ({ ...c })),
    }));
  }
  renderStep(3);
}

// ── STEP 3 ────────────────────────────────────────────────────
const sortableInstances = [];

function buildStep3() {
  // Build source panel: selected channels NOT yet in finalGroups
  const placed = placedChannelIds();
  const srcGroups = getSelectedChannelsInGroups().map(g => ({
    ...g,
    channels: g.channels.filter(c => !placed.has(c.id)),
  })).filter(g => g.channels.length > 0);

  const srcHtml = srcGroups.length === 0
    ? `<div class="alert alert-info">All channels have been placed in the right panel.</div>`
    : srcGroups.map(g => `
        <div class="source-group-label">${escHtml(g.name)}</div>
        ${g.channels.map(c => `
          <div class="source-channel-item" data-id="${escHtml(c.id)}" data-name="${escHtml(c.name)}"
               data-logo="${escHtml(c.logo || "")}" data-tvg="${escHtml(c.tvg_id || "")}">
            <span class="drag-handle">⠿</span>
            ${logoImg(c.logo)}
            <span>${escHtml(c.name)}</span>
          </div>`).join("")}
      `).join("");

  const destHtml = appState.finalGroups.map(fg => buildDestGroup(fg)).join("");

  return `
  <div class="card">
    <div class="card-title">🎛️ Organize Channels</div>
    <div class="organizer-layout">
      <!-- Left: source -->
      <div>
        <div class="panel-title">
          📋 Source Channels
          <span class="panel-subtitle">Drag to right panel →</span>
        </div>
        <div class="source-panel" id="sourcePanel">
          ${srcHtml}
        </div>
      </div>

      <!-- Right: destination -->
      <div>
        <div class="panel-title">
          📁 Final Playlist
          <button class="btn btn-ghost btn-sm" style="margin-left:auto" onclick="addDestGroup()">＋ Add Group</button>
        </div>
        <div class="dest-panel-scroll" id="destPanel">
          ${destHtml || '<div class="alert alert-info">No groups yet. Add a group with the button above.</div>'}
        </div>
      </div>
    </div>

    <div class="mapping-id-row">
      <div class="input-row">
        <label>Mapping ID</label>
        <input type="text" id="mappingIdInput" value="my_mapping" placeholder="my_mapping" />
      </div>
      <button class="btn btn-success" onclick="generateFiles()" id="generateBtn">
        ⚡ Generate Files
      </button>
    </div>

    <div id="step3Error" style="margin-top:12px"></div>

    <div class="nav-bar">
      <button class="btn btn-ghost" onclick="renderStep(2)">← Back</button>
      <span></span>
    </div>
  </div>`;
}

function buildDestGroup(fg) {
  const chHtml = fg.channels.map(c => buildDestChannel(c)).join("");
  return `
    <div class="dest-group-card" data-fgid="${escHtml(fg.id)}">
      <div class="dest-group-header">
        <input class="dest-group-name-input" type="text" value="${escHtml(fg.name)}"
               data-fgname="${escHtml(fg.id)}"
               onchange="renameDestGroup('${escHtml(fg.id)}', this.value)">
        <button class="btn btn-danger btn-sm" onclick="deleteDestGroup('${escHtml(fg.id)}')">🗑</button>
      </div>
      <div class="dest-drop-zone" id="dz_${escHtml(fg.id)}">
        ${chHtml || '<div class="dest-drop-hint">Drop channels here</div>'}
      </div>
    </div>`;
}

function buildDestChannel(c) {
  return `
    <div class="dest-channel-item" data-id="${escHtml(c.id)}" data-name="${escHtml(c.name)}"
         data-logo="${escHtml(c.logo || "")}" data-tvg="${escHtml(c.tvg_id || "")}">
      <span class="drag-handle">⠿</span>
      ${logoImg(c.logo)}
      <span>${escHtml(c.name)}</span>
      <button class="remove-ch-btn" onclick="removeFromDest('${escHtml(c.id)}')" title="Remove">✕</button>
    </div>`;
}

function bindStep3() {
  sortableInstances.forEach(s => s.destroy && s.destroy());
  sortableInstances.length = 0;

  initSourceSortable();
  appState.finalGroups.forEach(fg => initDestSortable(fg.id));
}

function initSourceSortable() {
  const el = document.getElementById("sourcePanel");
  if (!el || typeof Sortable === "undefined") return;
  const inst = Sortable.create(el, {
    group: { name: "channels", pull: true, put: false },
    sort: false,
    animation: 150,
    ghostClass: "sortable-ghost",
    dragClass: "sortable-drag",
    handle: ".drag-handle",
    onEnd(evt) {
      if (evt.to === el) return; // put back — shouldn't happen (put:false)
    },
  });
  sortableInstances.push(inst);
}

function initDestSortable(fgid) {
  const el = document.getElementById(`dz_${fgid}`);
  if (!el || typeof Sortable === "undefined") return;
  const inst = Sortable.create(el, {
    group: { name: "channels", pull: true, put: true },
    animation: 150,
    ghostClass: "sortable-ghost",
    dragClass: "sortable-drag",
    handle: ".drag-handle",
    filter: ".dest-drop-hint",
    onAdd(evt) {
      const item = evt.item;
      // Convert source-channel-item to dest-channel-item markup
      const id = item.dataset.id;
      const name = item.dataset.name;
      const logo = item.dataset.logo;
      const tvg = item.dataset.tvg;
      const ch = { id, name, logo, tvg_id: tvg };
      item.outerHTML = buildDestChannel(ch);
      // remove hint if present
      const hint = el.querySelector(".dest-drop-hint");
      if (hint) hint.remove();
      syncFinalGroupsFromDOM();
      // re-init so the new item has a remove button handler
    },
    onUpdate() { syncFinalGroupsFromDOM(); },
    onRemove(evt) {
      const id = evt.item.dataset.id;
      // check if it went to source
      if (evt.to.id === "sourcePanel") {
        evt.item.remove(); // source handles its own display via re-render
        syncFinalGroupsFromDOM();
        refreshSourcePanel();
      } else {
        syncFinalGroupsFromDOM();
      }
      // add hint back if empty
      if (el.children.length === 0) {
        el.innerHTML = '<div class="dest-drop-hint">Drop channels here</div>';
      }
    },
  });
  sortableInstances.push(inst);
}

function syncFinalGroupsFromDOM() {
  const cards = document.querySelectorAll(".dest-group-card");
  appState.finalGroups = Array.from(cards).map(card => {
    const fgid = card.dataset.fgid;
    const nameInput = card.querySelector(`[data-fgname]`);
    const name = nameInput ? nameInput.value : "";
    const items = card.querySelectorAll(".dest-channel-item");
    const channels = Array.from(items).map(item => ({
      id: item.dataset.id,
      name: item.dataset.name,
      logo: item.dataset.logo || "",
      tvg_id: item.dataset.tvg || "",
    }));
    return { id: fgid, name, channels };
  });
}

function refreshSourcePanel() {
  const placed = placedChannelIds();
  const srcGroups = getSelectedChannelsInGroups().map(g => ({
    ...g,
    channels: g.channels.filter(c => !placed.has(c.id)),
  })).filter(g => g.channels.length > 0);

  const sp = document.getElementById("sourcePanel");
  if (!sp) return;
  sp.innerHTML = srcGroups.length === 0
    ? `<div class="alert alert-info">All channels have been placed in the right panel.</div>`
    : srcGroups.map(g => `
        <div class="source-group-label">${escHtml(g.name)}</div>
        ${g.channels.map(c => `
          <div class="source-channel-item" data-id="${escHtml(c.id)}" data-name="${escHtml(c.name)}"
               data-logo="${escHtml(c.logo || "")}" data-tvg="${escHtml(c.tvg_id || "")}">
            <span class="drag-handle">⠿</span>
            ${logoImg(c.logo)}
            <span>${escHtml(c.name)}</span>
          </div>`).join("")}
      `).join("");
  initSourceSortable();
}

function removeFromDest(cid) {
  syncFinalGroupsFromDOM();
  // Remove channel from finalGroups state
  for (const fg of appState.finalGroups) {
    fg.channels = fg.channels.filter(c => c.id !== cid);
  }
  // Re-render step3 to reflect
  renderStep(3);
}

function addDestGroup() {
  const name = prompt("New group name:") || "New Group";
  appState.finalGroups.push({ id: `fg_${uid()}`, name, channels: [] });
  renderStep(3);
}

function renameDestGroup(fgid, newName) {
  const fg = appState.finalGroups.find(g => g.id === fgid);
  if (fg) fg.name = newName;
  syncFinalGroupsFromDOM();
}

function deleteDestGroup(fgid) {
  syncFinalGroupsFromDOM();
  const idx = appState.finalGroups.findIndex(g => g.id === fgid);
  if (idx !== -1) appState.finalGroups.splice(idx, 1);
  renderStep(3);
}

async function generateFiles() {
  syncFinalGroupsFromDOM();
  clearError("step3Error");

  const mappingId = document.getElementById("mappingIdInput")?.value.trim() || "my_mapping";
  const nonEmpty = appState.finalGroups.filter(g => g.channels.length > 0);

  if (nonEmpty.length === 0) {
    showError("step3Error", "Add at least one channel to a group before generating.");
    return;
  }

  const btn = document.getElementById("generateBtn");
  if (btn) { btn.disabled = true; btn.textContent = "Generating…"; }

  try {
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(appState.sessionId ? { "X-Session-ID": appState.sessionId } : {}),
      },
      body: JSON.stringify({ mapping_id: mappingId, groups: nonEmpty }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || "Generation failed.");

    appState.sessionId = data.session_id || appState.sessionId;
    appState.generatedFiles = data.files || {};
    appState.previewFile = "mapping.yml";
    renderStep(4);
  } catch (err) {
    showError("step3Error", err.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "⚡ Generate Files"; }
  }
}

// ── STEP 4 ────────────────────────────────────────────────────
const FILE_META = {
  "mapping.yml":        { icon: "🗺️",  badge: "yml",  label: "Mapping" },
  "template.yml":       { icon: "📐", badge: "yml",  label: "Templates" },
  "filter_snippet.txt": { icon: "🔍", badge: "txt",  label: "Filter" },
};

function buildStep4() {
  const files = Object.keys(appState.generatedFiles);
  const cardsHtml = files.map(f => {
    const meta = FILE_META[f] || { icon: "📄", badge: "txt", label: f };
    const isActive = appState.previewFile === f;
    return `
      <div class="file-card ${isActive ? "active" : ""}" onclick="previewFile('${escHtml(f)}')" data-fc="${escHtml(f)}">
        <div class="file-card-icon">${meta.icon}</div>
        <div class="file-card-name">${escHtml(f)}</div>
        <div class="file-card-badge ${meta.badge}">${meta.label}</div>
        <div class="file-card-actions">
          <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();copyFile('${escHtml(f)}')">📋 Copy</button>
          <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();downloadFile('${escHtml(f)}')">⬇️ Download</button>
        </div>
      </div>`;
  }).join("");

  const previewContent = appState.generatedFiles[appState.previewFile] || "";

  return `
  <div class="card">
    <div class="output-header">
      <h2>🎉 Files Generated!</h2>
      <p>Your tuliprox mapping files are ready.</p>
    </div>

    <div class="file-cards-grid">${cardsHtml}</div>

    <div class="code-preview-label">📄 Preview — ${escHtml(appState.previewFile || "")}</div>
    <div class="code-preview" id="codePreview">
      <pre id="codePreviewContent">${escHtml(previewContent)}</pre>
    </div>

    <div class="info-box">
      💡 <strong>How to apply:</strong><br>
      Copy <strong>mapping.yml</strong> and <strong>template.yml</strong> into your
      <code>tuliprox config/</code> folder (or merge with existing files).<br>
      Then reference the mapping ID in your <strong>source.yml</strong> target's
      <code>mapping</code> field and use the filter from <strong>filter_snippet.txt</strong>.
    </div>

    <div class="output-actions">
      <button class="btn btn-success" onclick="downloadZip()">⬇️ Download All (ZIP)</button>
      <button class="btn btn-ghost" onclick="startOver()">← Start Over</button>
    </div>
  </div>`;
}

function bindStep4() {}

function previewFile(filename) {
  appState.previewFile = filename;
  // Update active card
  document.querySelectorAll(".file-card").forEach(c => {
    c.classList.toggle("active", c.dataset.fc === filename);
  });
  const content = appState.generatedFiles[filename] || "";
  const pre = document.getElementById("codePreviewContent");
  if (pre) pre.textContent = content;
  const lbl = document.querySelector(".code-preview-label");
  if (lbl) lbl.textContent = `📄 Preview — ${filename}`;
}

async function copyFile(filename) {
  const content = appState.generatedFiles[filename];
  if (!content) return;
  try {
    await navigator.clipboard.writeText(content);
    showToast(`Copied ${filename} to clipboard!`);
  } catch {
    // Fallback
    const ta = document.createElement("textarea");
    ta.value = content;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    showToast(`Copied ${filename} to clipboard!`);
  }
}

function downloadFile(filename) {
  const content = appState.generatedFiles[filename];
  if (!content) return;
  const blob = new Blob([content], { type: "text/plain" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function downloadZip() {
  if (!appState.sessionId) return;
  try {
    const res = await fetch("/api/download/zip/all", {
      headers: { "X-Session-ID": appState.sessionId },
    });
    if (!res.ok) throw new Error("Failed to download ZIP.");
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "tuliprox_mapping.zip";
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (err) {
    showToast(`Error: ${err.message}`, "error");
  }
}

function startOver() {
  appState.currentStep = 1;
  appState.sessionId = null;
  appState.groups = [];
  appState.selectedGroupIds = new Set();
  appState.selectedChannelIds = new Set();
  appState.finalGroups = [];
  appState.generatedFiles = {};
  appState.previewFile = null;
  renderStep(1);
}

// ── Toast ─────────────────────────────────────────────────────
function showToast(msg, type = "success") {
  let toast = document.getElementById("toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "toast";
    Object.assign(toast.style, {
      position: "fixed", bottom: "24px", right: "24px",
      padding: "12px 20px", borderRadius: "8px",
      fontSize: ".875rem", fontWeight: "600", zIndex: "9999",
      boxShadow: "0 4px 20px rgba(0,0,0,.4)",
      transition: "opacity .3s ease",
      maxWidth: "320px",
    });
    document.body.appendChild(toast);
  }
  toast.style.background = type === "error" ? "#7f1d1d" : "#064e3b";
  toast.style.color = type === "error" ? "#fca5a5" : "#6ee7b7";
  toast.style.border = `1px solid ${type === "error" ? "rgba(239,68,68,.4)" : "rgba(16,185,129,.4)"}`;
  toast.textContent = msg;
  toast.style.opacity = "1";
  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => { toast.style.opacity = "0"; }, 2800);
}
