const DEFAULT_GROUPS = ['全部', '未分组', '开场', '提示音', '背景', '备用'];
const LOCKED_GROUPS = new Set(['全部']);
const STORAGE_VERSION = 4;
const audioPlayers = new Map();
const monitorPlayers = new Map();

const state = {
  items: [],
  groups: [...DEFAULT_GROUPS],
  selectedGroup: '全部',
  selectedDeviceId: 'default',
  monitorDeviceId: 'default',
  compactMode: false,
  executionMode: false,
  autoNext: false,
  currentItemId: null,
  editingGroup: null,
  editingGroupDraft: '',
  lastProgressRender: 0,
  saveTimer: null
};

const elements = {
  addFilesButton: document.getElementById('addFilesButton'),
  addFolderButton: document.getElementById('addFolderButton'),
  addGroupButton: document.getElementById('addGroupButton'),
  newGroupInput: document.getElementById('newGroupInput'),
  groupList: document.getElementById('groupList'),
  playlistItems: document.getElementById('playlistItems'),
  emptyState: document.getElementById('emptyState'),
  statusText: document.getElementById('statusText'),
  deviceSelect: document.getElementById('deviceSelect'),
  monitorDeviceSelect: document.getElementById('monitorDeviceSelect'),
  refreshDevicesButton: document.getElementById('refreshDevicesButton'),
  currentTitle: document.getElementById('currentTitle'),
  pauseButton: document.getElementById('pauseButton'),
  stopButton: document.getElementById('stopButton'),
  executionModeToggle: document.getElementById('executionModeToggle'),
  compactModeToggle: document.getElementById('compactModeToggle'),
  autoNextToggle: document.getElementById('autoNextToggle')
};

function createId() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeGroupName(name) {
  const trimmed = String(name || '').trim();
  return trimmed || '未分组';
}

function ensureGroup(name) {
  const group = normalizeGroupName(name);
  if (group !== '全部' && !state.groups.includes(group)) state.groups.push(group);
  return group;
}

function normalizeSavedGroups(groups) {
  const savedGroups = Array.isArray(groups)
    ? groups.map(normalizeGroupName).filter((group) => group && group !== '全部')
    : DEFAULT_GROUPS.filter((group) => group !== '全部');
  return Array.from(new Set(['全部', ...savedGroups]));
}

function normalizeItem(item) {
  return {
    id: item.id || createId(),
    name: item.name || '未命名音频',
    note: item.note || '',
    path: item.path,
    group: normalizeGroupName(item.group),
    missing: Boolean(item.missing),
    playbackRate: clampRate(item.playbackRate || item.rate || 1),
    volume: clampVolume(item.volume ?? 1),
    loop: Boolean(item.loop),
    cue: Boolean(item.cue),
    currentTime: Number(item.currentTime) || 0,
    duration: Number(item.duration) || 0,
    level: 0,
    isPlaying: false,
    isMonitoring: false,
    locks: {
      progress: item.locks?.progress !== false,
      rate: item.locks?.rate !== false,
      volume: item.locks?.volume !== false
    }
  };
}

function clampRate(rate) {
  return Math.min(2, Math.max(0.5, Number(rate) || 1));
}

function clampVolume(volume) {
  return Math.min(1, Math.max(0, Number(volume)));
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return '00:00';
  const wholeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = String(Math.floor(wholeSeconds / 60)).padStart(2, '0');
  const remainingSeconds = String(wholeSeconds % 60).padStart(2, '0');
  return `${minutes}:${remainingSeconds}`;
}

function fileUrl(filePath) {
  return `file:///${filePath.replace(/\\/g, '/').replace(/#/g, '%23')}`;
}

function setStatus(message) {
  elements.statusText.textContent = message;
}

function scheduleSave() {
  window.clearTimeout(state.saveTimer);
  state.saveTimer = window.setTimeout(saveSettings, 250);
}

async function saveSettings() {
  const settings = {
    version: STORAGE_VERSION,
    items: state.items,
    groups: state.groups.filter((group) => group !== '全部'),
    selectedGroup: state.selectedGroup,
    selectedDeviceId: state.selectedDeviceId,
    monitorDeviceId: state.monitorDeviceId,
    compactMode: state.compactMode,
    executionMode: state.executionMode,
    autoNext: state.autoNext
  };

  try {
    await window.audioControl.saveSettings(settings);
  } catch (error) {
    console.error(error);
    setStatus('设置保存失败');
  }
}

async function loadSettings() {
  const settings = await window.audioControl.loadSettings();
  if (!settings) return;
  state.items = Array.isArray(settings.items) ? settings.items.map(normalizeItem).filter((item) => item.path) : [];
  state.groups = normalizeSavedGroups(settings.groups);
  for (const item of state.items) ensureGroup(item.group);
  state.selectedGroup = state.groups.includes(settings.selectedGroup) ? settings.selectedGroup : '全部';
  state.selectedDeviceId = settings.selectedDeviceId || 'default';
  state.monitorDeviceId = settings.monitorDeviceId || 'default';
  state.compactMode = Boolean(settings.compactMode);
  state.executionMode = Boolean(settings.executionMode);
  state.autoNext = Boolean(settings.autoNext);
}

async function refreshFileAvailability() {
  const checks = await Promise.all(
    state.items.map(async (item) => ({ id: item.id, missing: !(await window.audioControl.fileExists(item.path)) }))
  );
  for (const check of checks) {
    const item = state.items.find((entry) => entry.id === check.id);
    if (item) item.missing = check.missing;
  }
}

function applyViewMode() {
  document.body.classList.toggle('compact-mode', state.compactMode);
  document.body.classList.toggle('execution-mode', state.executionMode);
  elements.compactModeToggle.checked = state.compactMode;
  elements.executionModeToggle.checked = state.executionMode;
  elements.autoNextToggle.checked = state.autoNext;
}

async function refreshDevices() {
  try {
    await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    // Device labels may be generic until permission is granted.
  }

  const devices = await navigator.mediaDevices.enumerateDevices();
  const outputs = devices.filter((device) => device.kind === 'audiooutput');
  const options = outputs.length > 0 ? outputs : [{ deviceId: 'default', label: '系统默认输出设备' }];
  renderDeviceOptions(elements.deviceSelect, options, state.selectedDeviceId);
  renderDeviceOptions(elements.monitorDeviceSelect, options, state.monitorDeviceId);
  if (!options.some((device) => device.deviceId === state.selectedDeviceId)) state.selectedDeviceId = 'default';
  if (!options.some((device) => device.deviceId === state.monitorDeviceId)) state.monitorDeviceId = 'default';
  elements.deviceSelect.value = state.selectedDeviceId;
  elements.monitorDeviceSelect.value = state.monitorDeviceId;
  for (const player of audioPlayers.values()) await applyOutputDevice(player.audio, state.selectedDeviceId);
  for (const player of monitorPlayers.values()) await applyOutputDevice(player.audio, state.monitorDeviceId);
}

function renderDeviceOptions(select, options, selectedId) {
  select.innerHTML = '';
  for (const device of options) {
    const option = document.createElement('option');
    option.value = device.deviceId;
    option.textContent = device.label || (device.deviceId === 'default' ? '系统默认输出设备' : `音频输出设备 ${select.length + 1}`);
    select.append(option);
  }
  select.value = selectedId;
}

async function applyOutputDevice(audio, deviceId) {
  if (typeof audio.setSinkId !== 'function') return;
  try {
    await audio.setSinkId(deviceId || 'default');
  } catch (error) {
    console.error(error);
    setStatus('输出设备不可用，请重新选择设备');
  }
}

function renderGroups() {
  elements.groupList.innerHTML = '';
  for (const group of state.groups) {
    const row = document.createElement('div');
    row.className = group === state.selectedGroup ? 'group-row active' : 'group-row';
    if (state.editingGroup === group) {
      const input = document.createElement('input');
      input.className = 'group-edit-input';
      input.value = state.editingGroupDraft || group;
      input.placeholder = '输入分组名';
      input.addEventListener('input', () => {
        state.editingGroupDraft = input.value;
      });
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') renameGroup(group, input.value);
        if (event.key === 'Escape') cancelGroupEdit();
      });
      row.append(
        input,
        makeButton('保存', 'group-icon-button save', () => renameGroup(group, input.value)),
        makeButton('取消', 'group-icon-button', cancelGroupEdit)
      );
      elements.groupList.append(row);
      window.setTimeout(() => input.focus(), 0);
      continue;
    }

    const button = makeButton(group, 'group-button', () => {
      state.selectedGroup = group;
      render();
      scheduleSave();
    });
    row.append(button);
    if (!LOCKED_GROUPS.has(group)) {
      row.append(
        makeButton('改名', 'group-icon-button edit-only', () => startRenameGroup(group)),
        makeButton('删除', 'group-icon-button danger edit-only', () => deleteGroup(group))
      );
    }
    elements.groupList.append(row);
  }
}

function startRenameGroup(groupName) {
  if (LOCKED_GROUPS.has(groupName)) return;
  state.editingGroup = groupName;
  state.editingGroupDraft = groupName;
  renderGroups();
}

function cancelGroupEdit() {
  state.editingGroup = null;
  state.editingGroupDraft = '';
  renderGroups();
}

function renameGroup(oldName, rawName) {
  const nextName = normalizeGroupName(rawName);
  if (!nextName || nextName === oldName || state.groups.includes(nextName)) {
    cancelGroupEdit();
    return;
  }
  state.groups = state.groups.map((group) => (group === oldName ? nextName : group));
  for (const item of state.items) if (item.group === oldName) item.group = nextName;
  if (state.selectedGroup === oldName) state.selectedGroup = nextName;
  state.editingGroup = null;
  state.editingGroupDraft = '';
  render();
  scheduleSave();
}

function deleteGroup(groupName) {
  const fallbackGroup = state.groups.find((group) => group !== '全部' && group !== groupName) || '未分组';
  if (!window.confirm(`确定删除分组“${groupName}”？该分组下音频会移动到“${fallbackGroup}”。`)) return;
  state.groups = state.groups.filter((group) => group !== groupName);
  ensureGroup(fallbackGroup);
  for (const item of state.items) if (item.group === groupName) item.group = fallbackGroup;
  if (state.selectedGroup === groupName) state.selectedGroup = '全部';
  render();
  scheduleSave();
}

function getFilteredItems() {
  return state.selectedGroup === '全部'
    ? state.items
    : state.items.filter((item) => item.group === state.selectedGroup);
}

function renderPlaylist() {
  const filteredItems = getFilteredItems();
  elements.playlistItems.innerHTML = '';
  elements.emptyState.hidden = filteredItems.length > 0;
  for (const item of filteredItems) elements.playlistItems.append(createPlaylistRow(item));
}

function getVisibleItemRow(itemId) {
  return elements.playlistItems.querySelector(`[data-item-id="${CSS.escape(itemId)}"]`);
}

function updateItemRowLive(item) {
  const row = getVisibleItemRow(item.id);
  if (!row) {
    renderTransport();
    return;
  }
  row.className = item.isPlaying ? 'playlist-row current' : state.currentItemId === item.id ? 'playlist-row focused' : 'playlist-row';
  setText(row, 'current-time', formatTime(item.currentTime));
  setText(row, 'duration-time', item.duration > 0 ? formatTime(item.duration) : '00:00');
  setText(row, 'status', statusText(item));
  const status = row.querySelector('[data-role="status"]');
  if (status) status.className = statusClass(item);
  const progress = row.querySelector('[data-role="progress"]');
  if (progress) progress.value = item.duration > 0 ? String(Math.round((item.currentTime / item.duration) * 1000)) : '0';
  const meterFill = row.querySelector('[data-role="meter-fill"]');
  if (meterFill) meterFill.style.width = `${Math.round(item.level * 100)}%`;
  renderTransport();
}

function setText(row, role, text) {
  const element = row.querySelector(`[data-role="${role}"]`);
  if (element) element.textContent = text;
}

function statusText(item) {
  if (item.missing) return '文件丢失';
  if (item.isMonitoring) return '监听中';
  if (item.isPlaying) return '播放中';
  if (item.currentTime > 0 || item.duration > 0) return '已暂停';
  return '就绪';
}

function statusClass(item) {
  if (item.missing) return 'badge warning';
  if (item.isMonitoring) return 'badge cue';
  if (item.isPlaying) return 'badge playing';
  if (item.currentTime > 0 || item.duration > 0) return 'badge paused';
  return 'badge';
}

function createPlaylistRow(item) {
  const row = document.createElement('article');
  row.className = item.isPlaying ? 'playlist-row current' : state.currentItemId === item.id ? 'playlist-row focused' : 'playlist-row';
  row.dataset.itemId = item.id;

  const nameCell = document.createElement('div');
  nameCell.className = 'name-cell';
  const controlStack = document.createElement('div');
  controlStack.className = 'primary-control-stack';
  const playButton = makeButton(item.currentTime > 0 ? '继续' : '播放', item.isPlaying ? 'play-button active' : 'play-button', () => playItem(item.id));
  playButton.disabled = item.missing || item.isPlaying;
  const pauseButton = makeButton('暂停', 'pause-small-button', () => pauseItem(item.id), !item.isPlaying);
  controlStack.append(playButton, pauseButton);

  const textWrap = document.createElement('div');
  textWrap.className = 'name-wrap';
  const nameInput = document.createElement('input');
  nameInput.className = 'name-input edit-control';
  nameInput.value = item.name;
  nameInput.title = item.path;
  nameInput.addEventListener('input', () => {
    item.name = nameInput.value.trim() || item.name;
    scheduleSave();
  });
  const nameLabel = document.createElement('div');
  nameLabel.className = 'name-label execute-control';
  nameLabel.textContent = item.name;
  const noteInput = document.createElement('input');
  noteInput.className = 'note-input edit-control';
  noteInput.value = item.note;
  noteInput.placeholder = '备注：暖场用、颁奖环节用...';
  noteInput.addEventListener('input', () => {
    item.note = noteInput.value.trim();
    scheduleSave();
  });
  const noteLabel = document.createElement('div');
  noteLabel.className = 'note-label execute-control';
  noteLabel.textContent = item.note || '无备注';
  textWrap.append(nameInput, nameLabel, noteInput, noteLabel);
  nameCell.append(controlStack, fileLamp(item), textWrap);

  const groupSelect = document.createElement('select');
  groupSelect.className = 'group-select edit-only';
  for (const group of state.groups.filter((entry) => entry !== '全部')) {
    const option = document.createElement('option');
    option.value = group;
    option.textContent = group;
    groupSelect.append(option);
  }
  groupSelect.value = item.group;
  groupSelect.addEventListener('change', () => {
    item.group = ensureGroup(groupSelect.value);
    render();
    scheduleSave();
  });

  const meter = document.createElement('div');
  meter.className = 'meter';
  const meterFill = document.createElement('span');
  meterFill.dataset.role = 'meter-fill';
  meter.append(meterFill);

  const volumeCell = createLockedSlider(item, 'volume', '音量', 0, 1, 0.01, item.volume, (value) => {
    item.volume = clampVolume(value);
    const player = audioPlayers.get(item.id);
    if (player) player.audio.volume = item.volume;
  });

  const speedCell = createLockedSlider(item, 'rate', '速率', 0.5, 2, 0.05, item.playbackRate, (value) => {
    item.playbackRate = clampRate(value);
    const player = audioPlayers.get(item.id);
    if (player) player.audio.playbackRate = item.playbackRate;
  }, (value) => `${Number(value).toFixed(2)}x`);

  const progressCell = document.createElement('div');
  progressCell.className = 'progress-cell locked-cell';
  progressCell.append(timeSpan('current-time', formatTime(item.currentTime)));
  const progress = document.createElement('input');
  progress.type = 'range';
  progress.min = '0';
  progress.max = '1000';
  progress.step = '1';
  progress.value = item.duration > 0 ? String(Math.round((item.currentTime / item.duration) * 1000)) : '0';
  progress.dataset.role = 'progress';
  attachLock(progress, item, 'progress', () => renderPlaylist());
  progress.addEventListener('input', () => {
    if (item.locks.progress) return;
    if (item.duration > 0) item.currentTime = item.duration * (Number(progress.value) / 1000);
    const player = audioPlayers.get(item.id);
    if (player && Number.isFinite(player.audio.duration)) player.audio.currentTime = player.audio.duration * (Number(progress.value) / 1000);
    scheduleSave();
  });
  progressCell.append(progress, timeSpan('duration-time', item.duration > 0 ? formatTime(item.duration) : '00:00'), lockBadge(item.locks.progress));

  const status = document.createElement('span');
  status.dataset.role = 'status';
  status.className = statusClass(item);
  status.textContent = statusText(item);

  const actions = document.createElement('div');
  actions.className = 'row-actions';
  actions.append(
    makeButton('停止', 'stop-button', () => stopItem(item.id), !item.isPlaying && item.currentTime <= 0 && item.duration <= 0),
    makeButton(item.loop ? '循环中' : '循环', item.loop ? 'loop-button active' : 'loop-button', () => {
      item.loop = !item.loop;
      const player = audioPlayers.get(item.id);
      if (player) player.audio.loop = item.loop;
      renderPlaylist();
      scheduleSave();
    }),
    makeButton(item.isMonitoring ? '监听中' : '监听', item.isMonitoring ? 'cue-button active' : 'cue-button', () => toggleMonitor(item.id)),
    makeButton('上移', 'order-button edit-only', () => moveItem(item.id, -1)),
    makeButton('下移', 'order-button edit-only', () => moveItem(item.id, 1)),
    makeButton('删除', 'danger edit-only', () => removeItem(item.id))
  );

  row.append(nameCell, groupSelect, meter, volumeCell, speedCell, progressCell, status, actions);
  return row;
}

function makeButton(text, className, handler, disabled = false) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = text;
  button.disabled = disabled;
  button.addEventListener('click', handler);
  return button;
}

function fileLamp(item) {
  const lamp = document.createElement('span');
  lamp.className = item.missing ? 'file-lamp missing' : 'file-lamp ok';
  lamp.title = item.missing ? '文件丢失' : '文件存在';
  return lamp;
}

function timeSpan(role, text) {
  const span = document.createElement('span');
  span.dataset.role = role;
  span.textContent = text;
  return span;
}

function createLockedSlider(item, key, label, min, max, step, value, onInput, formatter = (next) => `${Math.round(Number(next) * 100)}%`) {
  const cell = document.createElement('div');
  cell.className = 'locked-cell';
  const valueLabel = document.createElement('strong');
  valueLabel.textContent = `${label} ${formatter(value)}`;
  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = String(min);
  slider.max = String(max);
  slider.step = String(step);
  slider.value = String(value);
  attachLock(slider, item, key, () => renderPlaylist());
  slider.addEventListener('input', () => {
    if (item.locks[key]) return;
    onInput(slider.value);
    valueLabel.textContent = `${label} ${formatter(slider.value)}`;
    scheduleSave();
  });
  cell.append(valueLabel, slider, lockBadge(item.locks[key]));
  return cell;
}

function lockBadge(locked) {
  const badge = document.createElement('em');
  badge.className = locked ? 'lock-badge' : 'lock-badge unlocked';
  badge.textContent = locked ? '锁' : '可调';
  return badge;
}

function attachLock(element, item, key, rerender) {
  element.classList.toggle('locked-slider', item.locks[key]);
  let holdTimer = null;
  const unlock = () => {
    item.locks[key] = false;
    setStatus('滑条已解锁，本次可调整');
    rerender();
  };
  element.addEventListener('pointerdown', (event) => {
    if (!item.locks[key]) return;
    event.preventDefault();
    holdTimer = window.setTimeout(unlock, 500);
  });
  element.addEventListener('pointerup', () => window.clearTimeout(holdTimer));
  element.addEventListener('pointerleave', () => window.clearTimeout(holdTimer));
  element.addEventListener('dblclick', (event) => {
    event.preventDefault();
    unlock();
  });
}

function renderTransport() {
  const playingItems = state.items.filter((item) => item.isPlaying);
  const monitoringItems = state.items.filter((item) => item.isMonitoring);
  if (playingItems.length > 1) elements.currentTitle.textContent = `正在同时播放 ${playingItems.length} 条音频`;
  else if (playingItems.length === 1) {
    const item = playingItems[0];
    elements.currentTitle.textContent = `${item.name} · ${formatTime(item.currentTime)} / ${formatTime(item.duration)}`;
  } else elements.currentTitle.textContent = monitoringItems.length > 0 ? `监听中 ${monitoringItems.length} 条音频` : '未选择音频';
  elements.pauseButton.textContent = playingItems.length > 0 ? '全部暂停' : '继续';
}

function render() {
  applyViewMode();
  renderGroups();
  renderPlaylist();
  renderTransport();
}

function addFiles(files) {
  let addedCount = 0;
  const existingPaths = new Set(state.items.map((item) => item.path.toLowerCase()));
  const targetGroup = state.selectedGroup === '全部' ? '未分组' : state.selectedGroup;
  for (const file of files) {
    if (existingPaths.has(file.path.toLowerCase())) continue;
    state.items.push(normalizeItem({ id: createId(), name: file.name, path: file.path, group: targetGroup }));
    existingPaths.add(file.path.toLowerCase());
    addedCount += 1;
  }
  setStatus(addedCount > 0 ? `已添加 ${addedCount} 个音频` : '没有新的音频可添加');
  render();
  scheduleSave();
}

function getAudioPlayer(item) {
  if (audioPlayers.has(item.id)) return audioPlayers.get(item.id);
  const audio = new Audio(fileUrl(item.path));
  audio.preload = 'metadata';
  audio.playbackRate = clampRate(item.playbackRate);
  audio.volume = item.volume;
  audio.loop = item.loop;
  const record = { audio, raf: null };
  attachAudioEvents(record, item, false);
  audioPlayers.set(item.id, record);
  applyOutputDevice(audio, state.selectedDeviceId);
  return record;
}

function getMonitorPlayer(item) {
  if (monitorPlayers.has(item.id)) return monitorPlayers.get(item.id);
  const audio = new Audio(fileUrl(item.path));
  audio.preload = 'metadata';
  audio.volume = item.volume;
  audio.loop = true;
  const record = { audio, raf: null };
  attachAudioEvents(record, item, true);
  monitorPlayers.set(item.id, record);
  applyOutputDevice(audio, state.monitorDeviceId);
  return record;
}

function attachAudioEvents(record, item, isMonitor) {
  const { audio } = record;
  audio.addEventListener('loadedmetadata', () => {
    item.duration = Number.isFinite(audio.duration) ? audio.duration : 0;
    updateItemRowLive(item);
    scheduleSave();
  });
  audio.addEventListener('timeupdate', () => {
    if (!isMonitor) {
      item.currentTime = audio.currentTime;
      item.duration = Number.isFinite(audio.duration) ? audio.duration : item.duration;
    }
    const now = Date.now();
    if (now - state.lastProgressRender > 220) {
      state.lastProgressRender = now;
      updateItemRowLive(item);
    }
  });
  audio.addEventListener('play', () => startMeter(record, item));
  audio.addEventListener('pause', () => stopMeter(record, item));
  audio.addEventListener('ended', () => {
    stopMeter(record, item);
    if (isMonitor) {
      item.isMonitoring = false;
      monitorPlayers.delete(item.id);
      render();
      return;
    }
    item.currentTime = 0;
    item.isPlaying = false;
    audioPlayers.delete(item.id);
    if (state.autoNext && !item.loop) playNextItem(item);
    render();
    scheduleSave();
  });
}

function startMeter(record, item) {
  const tick = () => {
    const audio = record.audio;
    item.level = audio.paused ? 0 : Math.max(0.08, Math.min(1, audio.volume * (0.35 + Math.random() * 0.65)));
    updateItemRowLive(item);
    record.raf = requestAnimationFrame(tick);
  };
  window.cancelAnimationFrame(record.raf);
  record.raf = requestAnimationFrame(tick);
}

function stopMeter(record, item) {
  window.cancelAnimationFrame(record.raf);
  item.level = 0;
  updateItemRowLive(item);
}

async function playItem(itemId) {
  const item = state.items.find((entry) => entry.id === itemId);
  if (!item || item.isPlaying) return;
  if (!(await window.audioControl.fileExists(item.path))) {
    item.missing = true;
    setStatus('音频文件不存在，请检查原文件位置');
    render();
    scheduleSave();
    return;
  }
  const record = getAudioPlayer(item);
  record.audio.playbackRate = clampRate(item.playbackRate);
  record.audio.volume = item.volume;
  record.audio.loop = item.loop;
  if (item.currentTime > 0 && item.duration > item.currentTime) record.audio.currentTime = item.currentTime;
  await applyOutputDevice(record.audio, state.selectedDeviceId);
  try {
    await record.audio.play();
    item.isPlaying = true;
    state.currentItemId = item.id;
    setStatus(`正在播放：${item.name}`);
  } catch (error) {
    console.error(error);
    setStatus('播放失败，请检查文件格式或输出设备');
  }
  render();
}

function pauseItem(itemId) {
  const item = state.items.find((entry) => entry.id === itemId);
  const record = audioPlayers.get(itemId);
  if (!item || !record) return;
  item.currentTime = record.audio.currentTime;
  item.isPlaying = false;
  record.audio.pause();
  state.currentItemId = item.id;
  setStatus(`已暂停：${item.name}`);
  render();
  scheduleSave();
}

function stopItem(itemId) {
  const item = state.items.find((entry) => entry.id === itemId);
  const record = audioPlayers.get(itemId);
  if (record) {
    record.audio.pause();
    record.audio.currentTime = 0;
    stopMeter(record, item);
    audioPlayers.delete(itemId);
  }
  if (item) {
    item.currentTime = 0;
    item.isPlaying = false;
    item.level = 0;
    if (state.currentItemId === item.id) state.currentItemId = null;
    setStatus(`已停止：${item.name}`);
  }
  render();
  scheduleSave();
}

async function toggleMonitor(itemId) {
  const item = state.items.find((entry) => entry.id === itemId);
  if (!item) return;
  if (item.isMonitoring) {
    const record = monitorPlayers.get(item.id);
    if (record) {
      record.audio.pause();
      stopMeter(record, item);
      monitorPlayers.delete(item.id);
    }
    item.isMonitoring = false;
    render();
    return;
  }
  const record = getMonitorPlayer(item);
  await applyOutputDevice(record.audio, state.monitorDeviceId);
  try {
    await record.audio.play();
    item.isMonitoring = true;
    setStatus(`监听中：${item.name}`);
  } catch (error) {
    console.error(error);
    setStatus('监听播放失败，请检查监听设备');
  }
  render();
}

function playNextItem(item) {
  const list = getFilteredItems().filter((entry) => !entry.missing);
  const fallbackList = state.items.filter((entry) => !entry.missing);
  const source = list.some((entry) => entry.id === item.id) ? list : fallbackList;
  const index = source.findIndex((entry) => entry.id === item.id);
  const next = source[index + 1] || source[0];
  if (next && next.id !== item.id) {
    setStatus(`自动下一首：${next.name}`);
    playItem(next.id);
  }
}

function moveItem(itemId, direction) {
  const visible = getFilteredItems();
  const visibleIndex = visible.findIndex((item) => item.id === itemId);
  const target = visible[visibleIndex + direction];
  if (!target) return;
  const sourceIndex = state.items.findIndex((item) => item.id === itemId);
  const targetIndex = state.items.findIndex((item) => item.id === target.id);
  const [item] = state.items.splice(sourceIndex, 1);
  state.items.splice(targetIndex, 0, item);
  setStatus('已调整播放顺序。自动下一首会按当前筛选列表从上到下播放。');
  renderPlaylist();
  scheduleSave();
}

function removeItem(itemId) {
  stopItem(itemId);
  state.items = state.items.filter((item) => item.id !== itemId);
  render();
  scheduleSave();
}

function stopPlayback() {
  for (const item of state.items) stopItem(item.id);
  setStatus('已全部停止');
}

function bindEvents() {
  elements.addFilesButton.addEventListener('click', async () => addFiles(await window.audioControl.addAudioFiles()));
  elements.addFolderButton.addEventListener('click', async () => addFiles(await window.audioControl.addAudioFolder()));
  elements.addGroupButton.addEventListener('click', () => {
    const group = ensureGroup(elements.newGroupInput.value);
    state.selectedGroup = group;
    elements.newGroupInput.value = '';
    render();
    scheduleSave();
  });
  elements.newGroupInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') elements.addGroupButton.click();
  });
  elements.deviceSelect.addEventListener('change', async () => {
    state.selectedDeviceId = elements.deviceSelect.value;
    for (const player of audioPlayers.values()) await applyOutputDevice(player.audio, state.selectedDeviceId);
    scheduleSave();
  });
  elements.monitorDeviceSelect.addEventListener('change', async () => {
    state.monitorDeviceId = elements.monitorDeviceSelect.value;
    for (const player of monitorPlayers.values()) await applyOutputDevice(player.audio, state.monitorDeviceId);
    scheduleSave();
  });
  elements.refreshDevicesButton.addEventListener('click', refreshDevices);
  elements.executionModeToggle.addEventListener('change', () => {
    state.executionMode = elements.executionModeToggle.checked;
    render();
    scheduleSave();
  });
  elements.compactModeToggle.addEventListener('change', () => {
    state.compactMode = elements.compactModeToggle.checked;
    render();
    scheduleSave();
  });
  elements.autoNextToggle.addEventListener('change', () => {
    state.autoNext = elements.autoNextToggle.checked;
    setStatus(state.autoNext ? '自动下一首已开启：按当前筛选列表从上到下播放。' : '自动下一首已关闭');
    scheduleSave();
  });
  elements.pauseButton.addEventListener('click', () => {
    const playingItems = state.items.filter((item) => item.isPlaying);
    for (const item of playingItems) pauseItem(item.id);
    if (playingItems.length === 0) {
      const currentItem = state.items.find((item) => item.id === state.currentItemId && item.currentTime > 0);
      if (currentItem) playItem(currentItem.id);
    }
  });
  elements.stopButton.addEventListener('click', stopPlayback);
  if (navigator.mediaDevices) navigator.mediaDevices.addEventListener('devicechange', refreshDevices);
}

async function init() {
  bindEvents();
  await loadSettings();
  await refreshFileAvailability();
  render();
  await refreshDevices();
  render();
}

init().catch((error) => {
  console.error(error);
  setStatus('启动失败，请重启软件');
});
