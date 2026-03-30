import { apiAddConvToFolder, apiAddGlobalMemory, apiCreateFolder, apiDeleteConversation, apiGetAvailableModels, apiGetConversations, apiGetFolders, apiGetSettings, apiRemoveConvFromFolder, apiReorderFolderConvs, apiSaveConversations, apiSaveSettings } from './api.js';
import { BACKEND_BASE_URL, BACKEND_WS_URL, getDefaultBackendBaseUrl, getStoredBackendBaseUrl, normalizeBackendBaseUrl, setBackendBaseUrl } from './state.js';

const mobileState = {
  settings: null,
  conversations: [],
  folders: [],
  currentId: null,
  pickerOpen: false,
  activeWs: null,
  search: '',
  timelineMode: 'now',
  modelCatalog: [],
  toastTimer: null,
  healthMeta: null,
  activeConvActionId: null,
  activeMessageActionId: null,
  messageDeleteConfirm: false,
  drag: null,
  modelFavorites: JSON.parse(localStorage.getItem('start-mobile-model-favorites') || '[]'),
  appIconChoice: localStorage.getItem('ministar-app-icon-choice') || 'default',
  collapsedFolders: new Set(JSON.parse(localStorage.getItem('ministar-mobile-collapsed-folders') || '[]')),
};

let mobileTtsAudio = null;
let mobileTtsActiveBtn = null;
let mobileTtsObjectUrl = null;
const MOBILE_SHEET_TRANSITION_MS = 240;
const MOBILE_APP_ICON_KEY = 'ministar-app-icon-choice';
const MOBILE_APP_ICON_OPTIONS = [
  { key: 'default', native: null, label: '现行', desc: '当前主图标，沿用现在这版。', preview: 'ministar-icon-default.png' },
  { key: 'seal', native: 'Seal', label: '徽记', desc: '更收束的印记感，像正式徽标。', preview: 'ministar-icon-seal.png' },
  { key: 'orbit', native: 'Orbit', label: '轨页', desc: '书页和轨道感更明显，偏叙事。', preview: 'ministar-icon-orbit.png' },
  { key: 'spark', native: 'Spark', label: '星窗', desc: '更轻快，也更像移动入口。', preview: 'ministar-icon-spark.png' },
];

function escHtml(text = '') {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function showToast(message) {
  const el = document.getElementById('mobile-toast');
  if (!el) return;
  el.textContent = message;
  el.classList.add('show');
  window.clearTimeout(mobileState.toastTimer);
  mobileState.toastTimer = window.setTimeout(() => el.classList.remove('show'), 1800);
}

function showChatPostEffects(result) {
  const parts = [];
  const globalCount = Array.isArray(result?.saved_memories) ? result.saved_memories.length : 0;
  const sessionCount = Array.isArray(result?.saved_session_memories) ? result.saved_session_memories.length : 0;
  const scribe = result?.scribe || {};
  if (globalCount > 0) parts.push(`长期记忆 +${globalCount}`);
  if (sessionCount > 0) parts.push(`临时记事本 +${sessionCount}`);
  if (scribe.updated) parts.push(`Scribe 已更新到 ${scribe.pair_count} 对`);
  if (parts.length) showToast(parts.join(' · '));
}

function getTauriInvoke() {
  return window.__TAURI__?.core?.invoke || window.__TAURI_INTERNALS__?.invoke || null;
}

function getCurrentAppIconOption() {
  return MOBILE_APP_ICON_OPTIONS.find(item => item.key === mobileState.appIconChoice) || MOBILE_APP_ICON_OPTIONS[0];
}

async function syncAppIconChoiceFromShell() {
  const invoke = getTauriInvoke();
  if (!invoke) return;
  try {
    const nativeName = await invoke('get_current_app_icon');
    const option = MOBILE_APP_ICON_OPTIONS.find(item => item.native === (nativeName || null));
    if (option) {
      mobileState.appIconChoice = option.key;
      localStorage.setItem(MOBILE_APP_ICON_KEY, option.key);
    }
  } catch (err) {
    console.warn('[Mobile] 获取当前 app 图标失败：', err?.message || err);
  }
}

function renderAppIconSheet() {
  const list = document.getElementById('mobile-app-icon-list');
  if (!list) return;
  list.innerHTML = '';
  MOBILE_APP_ICON_OPTIONS.forEach(option => {
    const btn = document.createElement('button');
    btn.className = `mobile-app-icon-option${option.key === mobileState.appIconChoice ? ' active' : ''}`;
    btn.innerHTML = `
      <img class="mobile-app-icon-preview" src="${escHtml(option.preview)}" alt="${escHtml(option.label)}">
      <div class="mobile-app-icon-copy">
        <div class="mobile-app-icon-name">${escHtml(option.label)}</div>
        <div class="mobile-app-icon-desc">${escHtml(option.desc)}</div>
      </div>
      <div class="mobile-app-icon-check">✓</div>
    `;
    btn.addEventListener('click', async () => {
      await applyAppIconChoice(option.key);
    });
    list.appendChild(btn);
  });
}

async function applyAppIconChoice(iconKey, { silent = false } = {}) {
  const option = MOBILE_APP_ICON_OPTIONS.find(item => item.key === iconKey);
  if (!option) return;
  const invoke = getTauriInvoke();
  if (invoke) {
    try {
      await invoke('set_app_icon', { iconName: option.native });
    } catch (err) {
      showToast(`切换失败：${err?.message || err}`);
      return;
    }
  } else if (!silent) {
    showToast('当前环境暂不支持切换主屏图标');
  }
  mobileState.appIconChoice = option.key;
  localStorage.setItem(MOBILE_APP_ICON_KEY, option.key);
  updateSettingsSheet();
  renderAppIconSheet();
  if (!silent) showToast(`已切换为${option.label}`);
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.readAsDataURL(file);
  });
}

function getCurrentMessage() {
  const conv = getCurrentConversation();
  if (!conv) return null;
  return conv.messages.find(msg => msg.id === mobileState.activeMessageActionId) || null;
}

function getCurrentConversation() {
  return mobileState.conversations.find(conv => conv.id === mobileState.currentId) || null;
}

function persistCollapsedFolders() {
  localStorage.setItem('ministar-mobile-collapsed-folders', JSON.stringify([...mobileState.collapsedFolders]));
}

function toggleFolderCollapsed(folderId) {
  if (!folderId) return;
  if (mobileState.collapsedFolders.has(folderId)) mobileState.collapsedFolders.delete(folderId);
  else mobileState.collapsedFolders.add(folderId);
  persistCollapsedFolders();
  renderPicker();
}

function isImportedConversation(conv) {
  return !!(conv && (conv.title_source === 'imported' || conv.import_info));
}

function matchesTimelineMode(conv) {
  return mobileState.timelineMode === 'oldtimes' ? isImportedConversation(conv) : !isImportedConversation(conv);
}

function getTimelineConversations() {
  return mobileState.conversations.filter(matchesTimelineMode);
}

function saveConversations() {
  return apiSaveConversations(mobileState.conversations, mobileState.settings).catch((err) => {
    console.warn('[Mobile] 保存会话失败：', err.message);
    showToast('保存失败');
  });
}

async function callBackendTitle(messages) {
  const resp = await fetch(`${BACKEND_BASE_URL}/api/title`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ settings: mobileState.settings, messages }),
  });
  const json = await resp.json();
  if (!json.ok) throw new Error(json.error || '标题生成失败');
  return json.data?.title || '';
}

function cleanAITitle(raw) {
  let text = String(raw || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<\/?think>/gi, '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/[*#`~_>|\\]/g, '')
    .replace(/["'"'"]/g, '')
    .replace(/[：:]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[。！？、，.!?,;；\-–—]+$/, '')
    .trim();
  if (text.includes('→')) text = text.split('→').pop().trim();
  text = text.replace(/^[（(]+|[）)]+$/g, '').trim();
  text = text.replace(/[（()）]/g, '').trim();
  if (/[，、]/.test(text)) text = text.split(/[，、]/)[0].trim();
  text = text.replace(/[。！？.!?]+$/, '').trim();
  return text.slice(0, 18) || null;
}

function autosizeInput() {
  const input = document.getElementById('mobile-user-input');
  if (!input) return;
  const styles = window.getComputedStyle(input);
  const lineHeight = parseFloat(styles.lineHeight) || 24;
  const paddingTop = parseFloat(styles.paddingTop) || 0;
  const paddingBottom = parseFloat(styles.paddingBottom) || 0;
  const minHeight = lineHeight * 2 + paddingTop + paddingBottom;
  const maxHeight = lineHeight * 12 + paddingTop + paddingBottom;
  input.style.height = 'auto';
  input.style.height = `${Math.max(minHeight, Math.min(input.scrollHeight, maxHeight))}px`;
  input.style.overflowY = input.scrollHeight > maxHeight ? 'auto' : 'hidden';
}

function createMessage(role, content, extras = {}) {
  return {
    id: extras.id || `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    role,
    content,
    createdAt: extras.createdAt || Date.now(),
    updatedAt: extras.updatedAt || extras.createdAt || Date.now(),
    model: extras.model || '',
    usage: extras.usage || null,
    status: extras.status || 'done',
  };
}

function formatMobileDateTime(ts) {
  const value = Number(ts || 0);
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (num) => String(num).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function formatMobileDateOnly(ts) {
  const value = Number(ts || 0);
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (num) => String(num).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function getMessageTokenCount(msg) {
  const total = Number(
    msg?.usage?.total_tokens
    ?? msg?.meta?.tokens
    ?? (
      msg?.usage?.prompt_tokens != null && msg?.usage?.completion_tokens != null
        ? Number(msg.usage.prompt_tokens) + Number(msg.usage.completion_tokens)
        : msg?.usage?.completion_tokens
    )
    ?? 0,
  );
  return Number.isFinite(total) && total > 0 ? total : 0;
}

function formatMobileMetaInfo(msg) {
  const parts = [];
  const timeText = formatMobileDateTime(msg?.createdAt || msg?.timestamp || 0);
  if (timeText) parts.push(timeText);
  if (msg?.role === 'assistant') {
    const tokens = getMessageTokenCount(msg);
    if (tokens) parts.push(`↓ ${tokens.toLocaleString()} tokens`);
  }
  return parts.join('  ');
}

function buildMobileAvatar(role) {
  const el = document.createElement('div');
  el.className = `mobile-msg-avatar mobile-msg-avatar-${role}`;
  const src = role === 'user' ? mobileState.settings?.userAvatar : mobileState.settings?.assistantAvatar;
  if (src && String(src).startsWith('data:')) {
    const img = document.createElement('img');
    img.src = src;
    img.alt = role === 'user' ? '用户' : '助手';
    el.appendChild(img);
  } else {
    el.textContent = role === 'user' ? 'ꕥ' : '✦';
  }
  return el;
}

function getMobileTtsText(content) {
  const raw = String(content || '');
  const withoutThink = raw.replace(/<think>[\s\S]*?<\/think>/gi, ' ');
  return withoutThink
    .replace(/[#>*_`~-]/g, ' ')
    .replace(/\[(.*?)\]\((.*?)\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function clearMobileTtsPlaybackState() {
  if (mobileTtsAudio) {
    try { mobileTtsAudio.pause(); } catch (_) {}
    mobileTtsAudio = null;
  }
  if (mobileTtsObjectUrl) {
    try { URL.revokeObjectURL(mobileTtsObjectUrl); } catch (_) {}
    mobileTtsObjectUrl = null;
  }
  if (mobileTtsActiveBtn) {
    mobileTtsActiveBtn.textContent = '◉';
    mobileTtsActiveBtn.disabled = false;
    mobileTtsActiveBtn = null;
  }
}

function bindTapAction(element, handler) {
  if (!element) return;
  let touched = false;
  const stop = (event) => {
    event.preventDefault();
    event.stopPropagation();
  };
  element.addEventListener('touchstart', stop, { passive: false });
  element.addEventListener('pointerdown', stop);
  element.addEventListener('mousedown', stop);
  element.addEventListener('touchend', (event) => {
    touched = true;
    event.preventDefault();
    event.stopPropagation();
    handler(event);
    window.setTimeout(() => { touched = false; }, 0);
  }, { passive: false });
  element.addEventListener('click', (event) => {
    if (touched) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    handler(event);
  });
}

async function requestMobileTtsAudio(msg) {
  const tts = mobileState.settings?.tts || {};
  if (!tts.enabled) throw new Error('请先在桌面端启用 TTS');
  if (!tts.apiBaseUrl || !tts.modelName || !tts.voice) {
    throw new Error('请先在桌面端补全 TTS 配置');
  }
  const text = getMobileTtsText(msg.content);

  const lookupResp = await fetch(`${BACKEND_BASE_URL}/api/tts/audio-lookup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ settings: mobileState.settings, text }),
  });
  if (lookupResp.ok) {
    const lookup = await lookupResp.json();
    if (lookup?.found && lookup?.url) {
      return { audioUrl: `${BACKEND_BASE_URL}${lookup.url}` };
    }
  }

  const resp = await fetch(`${BACKEND_BASE_URL}/api/tts/synthesize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ settings: mobileState.settings, text }),
  });
  if (!resp.ok) {
    let body = null;
    try { body = await resp.json(); } catch (_) {}
    throw new Error(body?.error || `HTTP ${resp.status}`);
  }
  const audioUrl = resp.headers.get('X-TTS-Audio-Url') || '';
  if (audioUrl) return { audioUrl: `${BACKEND_BASE_URL}${audioUrl}` };
  const blob = await resp.blob();
  return { blob };
}

function buildMobileMessageHeader(msg) {
  const header = document.createElement('div');
  header.className = `mobile-message-header ${msg.role}`;
  const meta = document.createElement('div');
  meta.className = `mobile-message-meta ${msg.role === 'user' ? 'user' : 'assistant'}`;

  if (msg.role === 'assistant') {
    const modelLine = document.createElement('div');
    modelLine.className = 'mobile-message-meta-model';
    modelLine.textContent = msg.model || formatCurrentModelLabel();
    meta.appendChild(modelLine);
  }

  const infoLine = document.createElement('div');
  infoLine.className = 'mobile-message-meta-info';
  infoLine.textContent = formatMobileMetaInfo(msg) || (msg.role === 'user' ? '你' : '助手');
  meta.appendChild(infoLine);

  if (msg.role === 'assistant') {
    header.append(buildMobileAvatar('assistant'), meta);
  } else {
    header.append(meta, buildMobileAvatar('user'));
  }
  return header;
}

async function copyMobileMessage(msg, button) {
  const text = String(msg?.content || '');
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    if (button) {
      const old = button.textContent;
      button.textContent = '已复制';
      button.disabled = true;
      window.setTimeout(() => {
        button.textContent = old;
        button.disabled = false;
      }, 900);
    }
    showToast('已复制');
  } catch {
    showToast('复制失败');
  }
}

async function deleteMobileMessage(messageId) {
  const conv = getCurrentConversation();
  if (!conv) return;
  const index = conv.messages.findIndex(msg => msg.id === messageId);
  if (index === -1) return;
  conv.messages.splice(index, 1);
  updateConversationTitle(conv);
  renderMessages();
  renderPicker();
  renderHistorySheet();
  await saveConversations();
  showToast('已删除消息');
}

function editMobileMessage(msg) {
  const input = document.getElementById('mobile-user-input');
  if (!input) return;
  input.value = String(msg?.content || '');
  autosizeInput();
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
  showToast('已放回输入框');
}

async function playMobileMessageTts(msg, button = null) {
  try {
    if (mobileTtsActiveBtn === button && button) {
      clearMobileTtsPlaybackState();
      return;
    }
    clearMobileTtsPlaybackState();
    if (button) {
      button.disabled = true;
      button.textContent = '…';
    }
    const { blob, audioUrl } = await requestMobileTtsAudio(msg);
    if (audioUrl) mobileTtsAudio = new Audio(audioUrl);
    else {
      mobileTtsObjectUrl = URL.createObjectURL(blob);
      mobileTtsAudio = new Audio(mobileTtsObjectUrl);
    }
    if (button) {
      mobileTtsActiveBtn = button;
      button.disabled = false;
      button.textContent = '□';
    }
    mobileTtsAudio.addEventListener('ended', clearMobileTtsPlaybackState, { once: true });
    mobileTtsAudio.addEventListener('error', () => {
      showToast('TTS 播放失败');
      clearMobileTtsPlaybackState();
    }, { once: true });
    await mobileTtsAudio.play();
  } catch (err) {
    clearMobileTtsPlaybackState();
    showToast(`TTS 失败：${err.message}`);
  }
}

async function checkMobileMessageTtsFile(msg, button) {
  const originalText = button?.textContent || '?';
  if (button) {
    button.disabled = true;
    button.textContent = '…';
  }
  try {
    const tts = mobileState.settings?.tts || {};
    if (!tts.enabled) throw new Error('请先在桌面端启用 TTS');
    if (!tts.apiBaseUrl || !tts.modelName || !tts.voice) {
      throw new Error('请先在桌面端补全 TTS 配置');
    }
    const text = getMobileTtsText(msg.content);
    const resp = await fetch(`${BACKEND_BASE_URL}/api/tts/audio-lookup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ settings: mobileState.settings, text }),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    showToast(data?.found ? '本地已有语音' : '本地没有对应语音');
    if (button) {
      button.textContent = data?.found ? '✓' : '✕';
      window.setTimeout(() => {
        button.textContent = originalText;
        button.disabled = false;
      }, 1000);
      return;
    }
  } catch (err) {
    showToast(`查询失败：${err.message}`);
  }
  if (button) {
    button.textContent = originalText;
    button.disabled = false;
  }
}

async function regenerateMobileAssistant(msg) {
  const conv = getCurrentConversation();
  if (!conv || msg?.role !== 'assistant') return;
  const lastAssistantIndex = [...conv.messages].map((item, index) => ({ item, index }))
    .filter(entry => entry.item.role === 'assistant')
    .slice(-1)[0]?.index;
  const msgIndex = conv.messages.findIndex(item => item.id === msg.id);
  if (msgIndex === -1 || msgIndex !== lastAssistantIndex) {
    showToast('目前只支持重答最后一条助手消息');
    return;
  }
  conv.messages.splice(msgIndex, 1);
  renderMessages();
  renderPicker();
  await saveConversations();
  await performChat(conv);
}

async function saveAssistantMessageToMemory(msg) {
  if (!msg || msg.role !== 'assistant') return;
  const content = String(msg.content || '').trim();
  if (!content) {
    showToast('这条消息没有可写入的内容');
    return;
  }
  try {
    await apiAddGlobalMemory(content, [], '');
    showToast('已写入长期记忆');
  } catch (err) {
    showToast(`写入失败：${err.message}`);
  }
}

function openMessageMoreSheet(msg) {
  mobileState.activeMessageActionId = msg?.id || null;
  mobileState.messageDeleteConfirm = false;
  const current = getCurrentMessage();
  if (!current) return;
  document.getElementById('mobile-message-more-title').textContent = current.role === 'assistant' ? '助手消息操作' : '我的消息操作';
  document.getElementById('mobile-message-more-memory-btn').style.display = current.role === 'assistant' ? '' : 'none';
  document.getElementById('mobile-message-more-edit-btn').style.display = current.role === 'user' ? '' : 'none';
  document.getElementById('mobile-message-more-regen-btn').style.display = current.role === 'assistant' ? '' : 'none';
  document.getElementById('mobile-message-more-tts-btn').style.display = current.role === 'assistant' ? '' : 'none';
  const deleteBtn = document.getElementById('mobile-message-more-delete-btn');
  if (deleteBtn) {
    deleteBtn.textContent = '删除';
    deleteBtn.classList.remove('confirming');
  }
  openSheet('mobile-message-more-sheet');
}

function buildMobileMessageActions(msg) {
  const row = document.createElement('div');
  row.className = `mobile-message-actions ${msg.role}`;

  if (msg.role === 'assistant') {
    const ttsBtn = document.createElement('button');
    ttsBtn.className = 'mobile-message-action-btn';
    ttsBtn.textContent = '◉';
    ttsBtn.title = '朗读';
    ttsBtn.setAttribute('aria-label', '朗读');
    ttsBtn.addEventListener('click', () => playMobileMessageTts(msg, ttsBtn));
    row.appendChild(ttsBtn);

    const ttsLookupBtn = document.createElement('button');
    ttsLookupBtn.className = 'mobile-message-action-btn';
    ttsLookupBtn.textContent = '?';
    ttsLookupBtn.title = '查询本地语音';
    ttsLookupBtn.setAttribute('aria-label', '查询本地语音');
    ttsLookupBtn.addEventListener('click', () => checkMobileMessageTtsFile(msg, ttsLookupBtn));
    row.appendChild(ttsLookupBtn);
  }

  const copyBtn = document.createElement('button');
  copyBtn.className = 'mobile-message-action-btn';
  copyBtn.textContent = '⎘';
  copyBtn.title = '复制';
  copyBtn.setAttribute('aria-label', '复制');
    copyBtn.addEventListener('click', () => copyMobileMessage(msg, copyBtn));
    row.appendChild(copyBtn);

  if (msg.role === 'assistant') {
    const regenBtn = document.createElement('button');
    regenBtn.className = 'mobile-message-action-btn';
    regenBtn.textContent = '↺';
    regenBtn.title = '重新生成';
    regenBtn.setAttribute('aria-label', '重新生成');
    regenBtn.addEventListener('click', () => regenerateMobileAssistant(msg));
    row.appendChild(regenBtn);

    const moreBtn = document.createElement('button');
    moreBtn.className = 'mobile-message-action-btn';
    moreBtn.textContent = '⋯';
    moreBtn.title = '更多';
    moreBtn.setAttribute('aria-label', '更多');
    moreBtn.addEventListener('click', () => openMessageMoreSheet(msg));
    row.appendChild(moreBtn);
  } else {
    const editBtn = document.createElement('button');
    editBtn.className = 'mobile-message-action-btn';
    editBtn.textContent = '✎';
    editBtn.title = '编辑';
    editBtn.setAttribute('aria-label', '编辑');
    editBtn.addEventListener('click', () => editMobileMessage(msg));
    row.appendChild(editBtn);

    const moreBtn = document.createElement('button');
    moreBtn.className = 'mobile-message-action-btn';
    moreBtn.textContent = '⋯';
    moreBtn.title = '更多';
    moreBtn.setAttribute('aria-label', '更多');
    moreBtn.addEventListener('click', () => openMessageMoreSheet(msg));
    row.appendChild(moreBtn);
  }

  return row;
}

function updateHeader() {
  const conv = getCurrentConversation();
  const titleEl = document.getElementById('mobile-conv-title');
  const modelEl = document.getElementById('mobile-model-name');
  titleEl.textContent = conv?.title || '新对话';
  modelEl.textContent = formatCurrentModelLabel();
  updateSettingsSheet();
}

function formatCurrentModelLabel() {
  const chatTask = mobileState.settings?.taskModels?.chat || {};
  const providerId = chatTask.provider || '';
  const providerName = mobileState.settings?.providers?.[providerId]?.name || providerId || '';
  const modelName = chatTask.modelName || '未选择模型';
  return providerName ? `${modelName} · ${providerName}` : modelName;
}

function renderMessages() {
  const wrap = document.getElementById('mobile-messages');
  const conv = getCurrentConversation();
  if (!conv) {
    wrap.innerHTML = '<div class="mobile-empty-state">还没有会话，先从左上角进入选择界面新建一个吧。</div>';
    updateHeader();
    renderMapSheet();
    return;
  }

  wrap.innerHTML = '';
  conv.messages.forEach((msg, index) => {
    const item = document.createElement('article');
    item.className = `mobile-message ${msg.role === 'user' ? 'user' : 'assistant'}`;
    item.dataset.messageId = msg.id || '';
    item.dataset.messageIndex = String(index);

    item.appendChild(buildMobileMessageHeader(msg));

    const bubble = document.createElement('div');
    bubble.className = 'mobile-message-bubble';
    if (msg.role === 'assistant' && typeof marked !== 'undefined' && typeof DOMPurify !== 'undefined') {
      const raw = marked.parse(msg.content || '');
      bubble.innerHTML = DOMPurify.sanitize(raw);
    } else {
      bubble.innerHTML = `<p>${escHtml(msg.content || '').replace(/\n/g, '<br>')}</p>`;
    }
    item.appendChild(bubble);
    item.appendChild(buildMobileMessageActions(msg));
    wrap.appendChild(item);
  });

  updateHeader();
  renderMapSheet();
  wrap.scrollTop = wrap.scrollHeight;
  updateScrollBottomButton();
}

function buildFolderMap() {
  const map = new Map();
  (mobileState.folders || []).forEach(folder => map.set(folder.id, folder));
  return map;
}

function renderPicker() {
  const wrap = document.getElementById('mobile-picker-list');
  const keyword = mobileState.search.trim().toLowerCase();
  const folders = Array.isArray(mobileState.folders) ? mobileState.folders : [];
  const convs = getTimelineConversations();
  const groupedConvIds = new Set(folders.flatMap(folder => folder.conv_ids || []));

  wrap.innerHTML = '';

  const folderItems = folders
    .slice()
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hans-CN'));

  folderItems.forEach(folder => {
    const isCollapsed = mobileState.collapsedFolders.has(folder.id);
    const folderConvs = (folder.conv_ids || [])
      .map(id => convs.find(conv => conv.id === id))
      .filter(Boolean)
      .sort((a, b) => Number(b.updatedAt || b.id || 0) - Number(a.updatedAt || a.id || 0))
      .filter(conv => {
        if (!keyword) return true;
        return String(folder.name || '').toLowerCase().includes(keyword)
          || String(conv.title || '').toLowerCase().includes(keyword);
      });

    if (!folderConvs.length && keyword && !String(folder.name || '').toLowerCase().includes(keyword)) {
      return;
    }

    const group = document.createElement('section');
    group.className = 'mobile-folder-group';
    group.dataset.folderId = folder.id;

    const head = document.createElement('div');
    head.className = 'mobile-folder-head';
    head.innerHTML = `
      <button class="mobile-folder-summary" title="折叠或展开">
        <span class="mobile-folder-title">${escHtml(folder.name || '未命名文件夹')}</span>
        <span class="mobile-folder-caret${isCollapsed ? ' collapsed' : ''}">⌄</span>
      </button>
      <button class="mobile-folder-toggle" title="新对话">＋</button>
    `;
    head.querySelector('.mobile-folder-summary').addEventListener('click', () => toggleFolderCollapsed(folder.id));
    head.querySelector('.mobile-folder-toggle').addEventListener('click', () => createNewConversation(folder.id));
    group.appendChild(head);

    const list = document.createElement('div');
    list.className = `mobile-folder-convs${isCollapsed ? ' collapsed' : ''}`;
    if (folderConvs.length && !isCollapsed) {
      folderConvs.forEach(conv => list.appendChild(buildHistoryButton(conv, folder.name || '文件夹')));
    }
    group.appendChild(list);
    wrap.appendChild(group);
  });

  const looseConvs = convs
    .filter(conv => !groupedConvIds.has(conv.id))
    .sort((a, b) => Number(b.updatedAt || b.id || 0) - Number(a.updatedAt || a.id || 0))
    .filter(conv => !keyword || String(conv.title || '').toLowerCase().includes(keyword));
  if (looseConvs.length) {
    const looseGroup = document.createElement('section');
    looseGroup.className = 'mobile-folder-group';
    looseGroup.dataset.folderId = '';
    looseGroup.innerHTML = '<div class="mobile-folder-title">未归类</div>';
    const list = document.createElement('div');
    list.className = 'mobile-folder-convs';
    looseConvs.forEach(conv => list.appendChild(buildHistoryButton(conv, '未归类')));
    looseGroup.appendChild(list);
    wrap.appendChild(looseGroup);
  }

  if (!wrap.childElementCount) {
    wrap.innerHTML = '<div class="mobile-empty-state">没有匹配到会话或文件夹。</div>';
  }

  const timelineToggleBtn = document.getElementById('mobile-timeline-toggle-btn');
  if (timelineToggleBtn) {
    timelineToggleBtn.classList.toggle('active', mobileState.timelineMode === 'now');
    timelineToggleBtn.textContent = mobileState.timelineMode === 'oldtimes' ? '∿' : '≈';
    timelineToggleBtn.title = mobileState.timelineMode === 'oldtimes' ? '切换到现在' : '切换到旧时光';
  }
}

function svgLabelDataUrl(text, {
  height = 26,
  fontSize = 16,
  fontWeight = 600,
  color = '#ecf2ff',
} = {}) {
  const textValue = String(text || '');
  const estimatedWidth = Math.max(
    Math.ceil(textValue.length * fontSize * (fontWeight >= 700 ? 1.08 : 0.98) + 18),
    56,
  );
  const safeText = String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
  const y = Math.round(height * 0.74);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${estimatedWidth}" height="${height}" viewBox="0 0 ${estimatedWidth} ${height}"><text x="0" y="${y}" fill="${color}" font-size="${fontSize}" font-weight="${fontWeight}" font-family="Segoe UI, PingFang SC, Microsoft YaHei, sans-serif">${safeText}</text></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function buildHistoryLabelMarkup(title, sub) {
  return `
    <img class="mobile-history-line mobile-history-line-title" alt="" draggable="false" src="${svgLabelDataUrl(title, { height: 26, fontSize: 14, fontWeight: 700, color: '#ecf2ff' })}">
    <img class="mobile-history-line mobile-history-line-sub" alt="" draggable="false" src="${svgLabelDataUrl(sub, { height: 20, fontSize: 11, fontWeight: 500, color: 'rgba(224, 233, 255, 0.62)' })}">
  `;
}

function buildHistoryButton(conv, groupName = '') {
  const btn = document.createElement('button');
  btn.className = `mobile-history-item${conv.id === mobileState.currentId ? ' active' : ''}`;
  const folder = getConversationFolder(conv.id);
  btn.dataset.convId = conv.id;
  btn.dataset.folderId = folder?.id || '';
  const count = Array.isArray(conv.messages) ? conv.messages.length : 0;
  const stamp = conv.updatedAt || conv.createdAt || conv.id || 0;
  btn.innerHTML = buildHistoryLabelMarkup(conv.title || '新对话', `${formatMobileDateOnly(stamp)} · ${count} 条消息`);
  bindConversationInteractions(btn, conv);
  return btn;
}

function renderModelSheet() {
  const list = document.getElementById('mobile-model-list');
  const current = mobileState.settings?.taskModels?.chat || {};
  list.innerHTML = '';

  if (!mobileState.modelCatalog.length) {
    list.innerHTML = '<div class="mobile-empty-state">暂无可用模型。先在桌面端配置供应商与模型。</div>';
    return;
  }

  mobileState.modelCatalog.forEach(item => {
    const isActive = item.providerId === current.provider && item.modelName === current.modelName;
    const isFav = mobileState.modelFavorites.includes(`${item.providerId}::${item.modelName}`);
    const btn = document.createElement('button');
    btn.className = `mobile-model-item${isActive ? ' active' : ''}`;
    btn.innerHTML = `
      <div class="mobile-model-title">${escHtml(item.modelName)}${isFav ? ' ★' : ''}</div>
      <div class="mobile-model-sub">${escHtml(item.providerName || item.providerId)}</div>
    `;
    btn.addEventListener('click', async () => {
      mobileState.settings.taskModels.chat = {
        modelName: item.modelName,
        provider: item.providerId,
      };
      try {
        await apiSaveSettings(mobileState.settings);
        closeSheet('mobile-model-sheet');
        updateHeader();
        renderModelSheet();
        showToast('已切换模型');
      } catch (err) {
        showToast(err.message);
      }
    });
    btn.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      toggleFavoriteModel(item.providerId, item.modelName);
      renderModelSheet();
    });
    list.appendChild(btn);
  });
}

function renderMapSheet() {
  const list = document.getElementById('mobile-map-list');
  const conv = getCurrentConversation();
  list.innerHTML = '';
  if (!conv || !Array.isArray(conv.messages) || !conv.messages.length) {
    list.innerHTML = '<div class="mobile-empty-state">当前对话还没有可导航的消息。</div>';
    return;
  }

  const finalItems = conv.messages.map((msg, index) => ({ msg, index }));
  finalItems.forEach(({ msg, index }) => {
    const btn = document.createElement('button');
    const roleClass = msg.role === 'user' ? 'user' : 'assistant';
    btn.className = `mobile-map-item ${roleClass}`;
    const summary = String(msg.content || '').replace(/\s+/g, ' ').trim().slice(0, 36) || `消息 ${index + 1}`;
    btn.innerHTML = `
      <div class="mobile-map-title">${escHtml(summary)}</div>
    `;
    btn.addEventListener('click', () => {
      const target = document.querySelector(`[data-message-index="${index}"]`);
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      closeSheet('mobile-map-sheet');
    });
    list.appendChild(btn);
  });
}

function renderHistorySheet() {
  const list = document.getElementById('mobile-history-list');
  const keyword = mobileState.search.trim().toLowerCase();
  const allConvs = mobileState.conversations
    .slice()
    .sort((a, b) => Number(b.updatedAt || b.id || 0) - Number(a.updatedAt || a.id || 0))
    .filter(conv => !keyword || String(conv.title || '').toLowerCase().includes(keyword));

  list.innerHTML = '';
  if (!allConvs.length) {
    list.innerHTML = '<div class="mobile-empty-state">还没有历史会话。</div>';
    return;
  }

  allConvs.forEach(conv => {
    const btn = document.createElement('button');
    btn.className = `mobile-history-sheet-item${conv.id === mobileState.currentId ? ' active' : ''}`;
    btn.dataset.convId = conv.id;
    btn.dataset.folderId = getConversationFolder(conv.id)?.id || '';
    const stamp = conv.updatedAt || conv.createdAt || conv.id || 0;
    btn.innerHTML = buildHistoryLabelMarkup(conv.title || '新对话', `${formatMobileDateOnly(stamp)} · ${(conv.messages || []).length} 条消息`);
    bindConversationInteractions(btn, conv, { fromHistorySheet: true });
    list.appendChild(btn);
  });
}

function bindConversationInteractions(element, conv, options = {}) {
  let timer = null;
  let startX = 0;
  let startY = 0;
  let longPressed = false;
  let dragging = false;
  let suppressClick = false;
  let actionOpened = false;

  const clearTimer = () => {
    if (timer) window.clearTimeout(timer);
    timer = null;
  };

  const setPickerInteracting = active => {
    document.body?.classList.toggle('picker-interacting', active);
    document.documentElement?.style.setProperty('-webkit-touch-callout', active ? 'none' : '');
    if (!active) clearPickerSelection();
  };

  const setPressing = active => {
    element.classList.toggle('is-pressing', active);
  };

  const activateConversation = () => {
    mobileState.currentId = conv.id;
    if (options.fromHistorySheet) {
      mobileState.timelineMode = isImportedConversation(conv) ? 'oldtimes' : 'now';
      closeSheet('mobile-history-sheet');
    } else {
      closePicker();
    }
    renderPicker();
    renderMessages();
  };

  element.addEventListener('touchstart', (event) => {
    event.preventDefault();
    setPickerInteracting(true);
    setPressing(true);
    const touch = event.changedTouches[0];
    startX = touch?.clientX || 0;
    startY = touch?.clientY || 0;
    longPressed = false;
    dragging = false;
    actionOpened = false;
    clearTimer();
    timer = window.setTimeout(() => {
      timer = null;
      longPressed = true;
      actionOpened = true;
      suppressClick = true;
      openConvActions(conv.id);
    }, 220);
  }, { passive: false });

  element.addEventListener('touchmove', (event) => {
    if (actionOpened) {
      event.preventDefault();
      return;
    }
    const touch = event.changedTouches[0];
    const dx = (touch?.clientX || 0) - startX;
    const dy = (touch?.clientY || 0) - startY;
    const dist = Math.hypot(dx, dy);
    if (!longPressed && dist > 10) {
      clearTimer();
      setPressing(false);
      return;
    }
    if (longPressed && !dragging && dist > 12) {
      dragging = true;
      suppressClick = true;
      setPressing(false);
      startConvDrag(conv.id, conv.title || '新对话', touch.clientX, touch.clientY);
    }
    if (dragging) {
      event.preventDefault();
      updateConvDrag(touch.clientX, touch.clientY);
    }
  }, { passive: false });

  element.addEventListener('touchend', (event) => {
    clearTimer();
    setPressing(false);
    if (dragging) {
      finishConvDrag();
      dragging = false;
      longPressed = false;
      actionOpened = false;
      setPickerInteracting(false);
      return;
    }
    if (actionOpened) {
      event.preventDefault();
      longPressed = false;
      actionOpened = false;
      setPickerInteracting(false);
      window.setTimeout(() => { suppressClick = false; }, 0);
      return;
    }
    if (longPressed) {
      event.preventDefault();
      openConvActions(conv.id);
      suppressClick = true;
      longPressed = false;
      actionOpened = false;
      setPickerInteracting(false);
      window.setTimeout(() => { suppressClick = false; }, 0);
      return;
    }
    event.preventDefault();
    longPressed = false;
    actionOpened = false;
    setPickerInteracting(false);
    activateConversation();
    window.setTimeout(() => { suppressClick = false; }, 0);
  }, { passive: false });

  element.addEventListener('touchcancel', () => {
    clearTimer();
    if (dragging) finishConvDrag();
    dragging = false;
    longPressed = false;
    actionOpened = false;
    setPressing(false);
    setPickerInteracting(false);
  }, { passive: true });

  element.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    openConvActions(conv.id);
  });

  element.addEventListener('click', (event) => {
    if (suppressClick) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    activateConversation();
  });
}

function reorderIds(ids, dragId, targetId, before = true) {
  const ordered = [...ids];
  const from = ordered.indexOf(dragId);
  const target = ordered.indexOf(targetId);
  if (from === -1 || target === -1 || dragId === targetId) return ordered;
  ordered.splice(from, 1);
  const freshTarget = ordered.indexOf(targetId);
  ordered.splice(before ? freshTarget : freshTarget + 1, 0, dragId);
  return ordered;
}

async function reorderRootConversations(dragId, targetId, before = true) {
  const ids = mobileState.conversations.map(conv => conv.id);
  const orderedIds = reorderIds(ids, dragId, targetId, before);
  mobileState.conversations = orderedIds
    .map(id => mobileState.conversations.find(conv => conv.id === id))
    .filter(Boolean);
  await saveConversations();
}

async function reorderFolderConversations(folderId, dragId, targetId, before = true) {
  const folder = mobileState.folders.find(item => item.id === folderId);
  if (!folder) return;
  const nextIds = reorderIds(folder.conv_ids || [], dragId, targetId, before);
  const updated = await apiReorderFolderConvs(folderId, nextIds);
  const idx = mobileState.folders.findIndex(item => item.id === folderId);
  if (idx !== -1) mobileState.folders[idx] = updated;
}

async function moveConvToFolderById(convId, folderId) {
  const updated = await apiAddConvToFolder(folderId, convId);
  mobileState.folders = mobileState.folders.map(folder => {
    const ids = (folder.conv_ids || []).filter(id => id !== convId);
    return folder.id === folderId ? updated : { ...folder, conv_ids: ids };
  });
}

async function removeConvFromFolderById(convId, folderId) {
  const updated = await apiRemoveConvFromFolder(folderId, convId);
  const idx = mobileState.folders.findIndex(folder => folder.id === folderId);
  if (idx !== -1) mobileState.folders[idx] = updated;
}

async function dropConvRelative(dragId, targetId, before = true) {
  if (!dragId || !targetId || dragId === targetId) return;
  const dragFolder = getConversationFolder(dragId);
  const targetFolder = getConversationFolder(targetId);
  const dragFolderId = dragFolder?.id || null;
  const targetFolderId = targetFolder?.id || null;

  if (dragFolderId === targetFolderId) {
    if (targetFolderId) await reorderFolderConversations(targetFolderId, dragId, targetId, before);
    else await reorderRootConversations(dragId, targetId, before);
    return;
  }

  if (dragFolderId) {
    await removeConvFromFolderById(dragId, dragFolderId);
  }
  if (targetFolderId) {
    await moveConvToFolderById(dragId, targetFolderId);
    await reorderFolderConversations(targetFolderId, dragId, targetId, before);
  } else {
    await reorderRootConversations(dragId, targetId, before);
  }
}

function clearDragVisuals() {
  document.querySelectorAll('.drag-target-before, .drag-target-after').forEach(el => {
    el.classList.remove('drag-target-before', 'drag-target-after');
  });
  document.querySelectorAll('.drag-folder-inside').forEach(el => {
    el.classList.remove('drag-folder-inside');
  });
  document.getElementById('mobile-picker-list')?.classList.remove('drag-root-over');
}

function startConvDrag(convId, title, clientX, clientY) {
  clearDragVisuals();
  const ghost = document.createElement('div');
  ghost.className = 'mobile-drag-ghost';
  ghost.textContent = title;
  document.body.appendChild(ghost);
  mobileState.drag = { convId, ghost, target: null };
  updateConvDrag(clientX, clientY);
}

function updateConvDrag(clientX, clientY) {
  const drag = mobileState.drag;
  if (!drag) return;
  drag.ghost.style.left = `${clientX}px`;
  drag.ghost.style.top = `${clientY}px`;
  clearDragVisuals();

  const target = document.elementFromPoint(clientX, clientY);
  const targetConv = target?.closest?.('.mobile-history-item, .mobile-history-sheet-item');
  if (targetConv?.dataset?.convId && targetConv.dataset.convId !== drag.convId) {
    const rect = targetConv.getBoundingClientRect();
    const before = clientY < rect.top + rect.height / 2;
    targetConv.classList.add(before ? 'drag-target-before' : 'drag-target-after');
    drag.target = { type: 'conv', convId: targetConv.dataset.convId, before };
    return;
  }

  const folderGroup = target?.closest?.('.mobile-folder-group');
  if (folderGroup?.dataset && folderGroup.dataset.folderId) {
    folderGroup.classList.add('drag-folder-inside');
    drag.target = { type: 'folder', folderId: folderGroup.dataset.folderId };
    return;
  }

  const pickerList = document.getElementById('mobile-picker-list');
  if (pickerList?.contains(target)) {
    pickerList.classList.add('drag-root-over');
    drag.target = { type: 'root' };
    return;
  }

  drag.target = null;
}

async function finishConvDrag() {
  const drag = mobileState.drag;
  if (!drag) return;
  try {
    const currentFolder = getConversationFolder(drag.convId);
    if (drag.target?.type === 'conv') {
      await dropConvRelative(drag.convId, drag.target.convId, drag.target.before);
      showToast('已调整顺序');
    } else if (drag.target?.type === 'folder') {
      await moveConvToFolderById(drag.convId, drag.target.folderId);
      showToast('已移入文件夹');
    } else if (drag.target?.type === 'root' && currentFolder) {
      await removeConvFromFolderById(drag.convId, currentFolder.id);
      showToast('已移出文件夹');
    }
  } catch (err) {
    showToast(`拖动失败：${err.message}`);
  } finally {
    clearDragVisuals();
    drag.ghost.remove();
    mobileState.drag = null;
    renderPicker();
    renderHistorySheet();
  }
}

function getConversationFolder(convId) {
  return mobileState.folders.find(folder => (folder.conv_ids || []).includes(convId)) || null;
}

function openConvActions(convId) {
  const conv = mobileState.conversations.find(item => item.id === convId);
  if (!conv) return;
  mobileState.activeConvActionId = convId;
  document.getElementById('mobile-conv-actions-title').textContent = conv.title || '会话操作';
  document.getElementById('mobile-conv-pin-btn').textContent = conv.pinned ? '取消置顶' : '置顶';
  openSheet('mobile-conv-actions-sheet');
}

function getActiveActionConv() {
  return mobileState.conversations.find(item => item.id === mobileState.activeConvActionId) || null;
}

async function renameActiveConversation() {
  const conv = getActiveActionConv();
  if (!conv) return;
  const raw = window.prompt('重命名对话：', conv.title || '新对话');
  if (raw === null) return;
  const name = raw.trim() || '新对话';
  conv.title = name;
  closeSheet('mobile-conv-actions-sheet');
  renderPicker();
  renderMessages();
  renderHistorySheet();
  await saveConversations();
  showToast('已重命名');
}

async function togglePinActiveConversation() {
  const conv = getActiveActionConv();
  if (!conv) return;
  conv.pinned = !conv.pinned;
  mobileState.conversations.sort((a, b) => {
    const aPin = a.pinned ? 1 : 0;
    const bPin = b.pinned ? 1 : 0;
    if (aPin !== bPin) return bPin - aPin;
    return Number(b.updatedAt || b.id || 0) - Number(a.updatedAt || a.id || 0);
  });
  closeSheet('mobile-conv-actions-sheet');
  renderPicker();
  renderMessages();
  renderHistorySheet();
  await saveConversations();
  showToast(conv.pinned ? '已置顶' : '已取消置顶');
}

async function regenerateActiveConversationTitle() {
  const conv = getActiveActionConv();
  if (!conv) return;
  try {
    const recentMsgs = (conv.messages || []).slice(0, 6).map(msg => ({ role: msg.role, content: msg.content }));
    const raw = await callBackendTitle(recentMsgs);
    const title = cleanAITitle(raw);
    if (!title) throw new Error('标题为空');
    conv.title = title;
    closeSheet('mobile-conv-actions-sheet');
    renderPicker();
    renderMessages();
    renderHistorySheet();
    await saveConversations();
    showToast('标题已更新');
  } catch (err) {
    showToast(`生成失败：${err.message}`);
  }
}

function renderMoveSheet() {
  const conv = getActiveActionConv();
  const list = document.getElementById('mobile-move-list');
  list.innerHTML = '';
  if (!conv) {
    list.innerHTML = '<div class="mobile-empty-state">未找到要移动的对话。</div>';
    return;
  }
  const currentFolder = getConversationFolder(conv.id);

  const rootBtn = document.createElement('button');
  rootBtn.className = 'mobile-model-item';
  rootBtn.innerHTML = `
    <div class="mobile-model-title">未归类</div>
    <div class="mobile-model-sub">${currentFolder ? '移出当前文件夹' : '当前已在这里'}</div>
  `;
  rootBtn.addEventListener('click', async () => {
    if (currentFolder) {
      try {
        await removeConvFromFolderById(conv.id, currentFolder.id);
        closeSheet('mobile-move-sheet');
        closeSheet('mobile-conv-actions-sheet');
        renderPicker();
        renderHistorySheet();
        showToast('已移出文件夹');
      } catch (err) {
        showToast(`移动失败：${err.message}`);
      }
    }
  });
  list.appendChild(rootBtn);

  mobileState.folders.forEach(folder => {
    const btn = document.createElement('button');
    btn.className = 'mobile-model-item';
    const active = currentFolder?.id === folder.id;
    btn.innerHTML = `
      <div class="mobile-model-title">${escHtml(folder.name || '未命名文件夹')}${active ? ' · 当前' : ''}</div>
      <div class="mobile-model-sub">${(folder.conv_ids || []).length} 个对话</div>
    `;
    btn.addEventListener('click', async () => {
      try {
        if (currentFolder && currentFolder.id !== folder.id) {
          await removeConvFromFolderById(conv.id, currentFolder.id);
        }
        await moveConvToFolderById(conv.id, folder.id);
        closeSheet('mobile-move-sheet');
        closeSheet('mobile-conv-actions-sheet');
        renderPicker();
        renderHistorySheet();
        showToast('已移动');
      } catch (err) {
        showToast(`移动失败：${err.message}`);
      }
    });
    list.appendChild(btn);
  });
}

async function deleteActiveConversation() {
  const conv = getActiveActionConv();
  if (!conv) return;
  const yes = window.confirm('确认删除此对话？');
  if (!yes) return;
  try {
    await apiDeleteConversation(conv.id, false);
    mobileState.conversations = mobileState.conversations.filter(item => item.id !== conv.id);
    mobileState.folders = mobileState.folders.map(folder => ({
      ...folder,
      conv_ids: (folder.conv_ids || []).filter(id => id !== conv.id),
    }));
    if (mobileState.currentId === conv.id) {
      applyTimelineSelection();
    }
    closeSheet('mobile-conv-actions-sheet');
    renderPicker();
    renderMessages();
    renderHistorySheet();
    showToast('已删除');
  } catch (err) {
    showToast(`删除失败：${err.message}`);
  }
}

function updateSettingsSheet() {
  const timelineLabel = mobileState.timelineMode === 'oldtimes' ? '旧时光' : '现在';
  const healthLabel = mobileState.healthMeta
    ? `已连接 · ${mobileState.healthMeta.data_root || '未知数据目录'}`
    : '未连接';
  const backendEl = document.getElementById('mobile-settings-backend-sub');
  if (backendEl) backendEl.textContent = BACKEND_BASE_URL;
  const timelineEl = document.getElementById('mobile-settings-timeline-sub');
  if (timelineEl) timelineEl.textContent = timelineLabel;
  const modelEl = document.getElementById('mobile-settings-model-sub');
  if (modelEl) modelEl.textContent = formatCurrentModelLabel();
  const appIconEl = document.getElementById('mobile-settings-app-icon-sub');
  if (appIconEl) appIconEl.textContent = getCurrentAppIconOption().label;
  const healthEl = document.getElementById('mobile-settings-health-sub');
  if (healthEl) healthEl.textContent = healthLabel;
}

function renderMobileUserIdentity() {
  const name = String(mobileState.settings?.userName || '').trim() || '用户';
  const avatarSrc = String(mobileState.settings?.userAvatar || '');
  const label = document.getElementById('mobile-user-label');
  const shellAvatar = document.getElementById('mobile-user-avatar');
  const sheetAvatar = document.getElementById('mobile-user-sheet-avatar');
  const sheetSub = document.getElementById('mobile-user-sheet-sub');
  const nameInput = document.getElementById('mobile-user-name-input');
  if (label) label.textContent = name;
  if (sheetSub) sheetSub.textContent = name;
  if (nameInput) nameInput.value = name;
  [shellAvatar, sheetAvatar].forEach((el) => {
    if (!el) return;
    el.innerHTML = '';
    if (avatarSrc && avatarSrc.startsWith('data:')) {
      const img = document.createElement('img');
      img.src = avatarSrc;
      img.alt = name;
      el.appendChild(img);
    } else {
      el.textContent = 'ꕥ';
    }
  });
}

function openUserSheet() {
  renderMobileUserIdentity();
  openSheet('mobile-user-sheet');
}

async function saveMobileUserProfile() {
  try {
    mobileState.settings.userName = (document.getElementById('mobile-user-name-input')?.value || '').trim();
    await apiSaveSettings(mobileState.settings);
    renderMobileUserIdentity();
    renderMessages();
    closeSheet('mobile-user-sheet');
    showToast('用户资料已保存');
  } catch (err) {
    showToast(`保存失败：${err.message}`);
  }
}

function updateBackendStatus(message = '', isError = false) {
  const el = document.getElementById('mobile-backend-status');
  if (!el) return;
  el.textContent = message;
  el.style.color = isError ? '#d74b62' : 'rgba(28, 35, 64, 0.66)';
}

function populateBackendInput() {
  const input = document.getElementById('mobile-backend-input');
  if (!input) return;
  input.value = getStoredBackendBaseUrl() || BACKEND_BASE_URL || getDefaultBackendBaseUrl();
  updateBackendStatus(`当前地址：${BACKEND_BASE_URL}`);
}

function openBackendSheet(withMessage = '') {
  closeSheet('mobile-settings-sheet');
  populateBackendInput();
  if (withMessage) updateBackendStatus(withMessage, true);
  openSheet('mobile-backend-sheet');
  window.setTimeout(() => {
    const input = document.getElementById('mobile-backend-input');
    if (!input) return;
    input.focus();
    input.select();
  }, 120);
}

async function requestHealthWithBaseUrl(baseUrl) {
  const resp = await fetch(`${baseUrl}/api/health`);
  if (!resp.ok) throw new Error(`连接后端失败（HTTP ${resp.status}）`);
  return resp.json();
}

function renderConnectionError(err) {
  const wrap = document.getElementById('mobile-messages');
  wrap.innerHTML = `
    <div class="mobile-empty-state">
      无法连接 StarT 后端。<br>${escHtml(err.message)}
      <div class="mobile-empty-action-row">
        <button id="mobile-open-backend-sheet-btn" class="mobile-empty-action">配置后端地址</button>
      </div>
    </div>
  `;
  document.getElementById('mobile-open-backend-sheet-btn')?.addEventListener('click', () => openBackendSheet());
}

async function connectBackend(rawValue, { persist = false, reload = false } = {}) {
  const normalized = normalizeBackendBaseUrl(rawValue);
  if (!normalized) {
    updateBackendStatus('地址格式无效，请输入 IP:端口 或完整 http 地址。', true);
    return false;
  }
  updateBackendStatus('正在测试连接…');
  try {
    const json = await requestHealthWithBaseUrl(normalized);
    if (!persist) {
      mobileState.healthMeta = json?.meta || null;
      updateSettingsSheet();
      updateBackendStatus(`连接成功：${normalized}`);
      return true;
    }
    setBackendBaseUrl(normalized);
    mobileState.healthMeta = json?.meta || null;
    updateSettingsSheet();
    updateBackendStatus(`连接成功：${normalized}`);
    if (reload) await loadInitialData();
    return true;
  } catch (err) {
    updateBackendStatus(err.message, true);
    if (reload) renderConnectionError(err);
    return false;
  }
}

function isNearMessagesBottom() {
  const wrap = document.getElementById('mobile-messages');
  if (!wrap) return true;
  return wrap.scrollHeight - wrap.scrollTop - wrap.clientHeight < 120;
}

function updateScrollBottomButton() {
  const btn = document.getElementById('mobile-scroll-bottom-btn');
  if (!btn) return;
  btn.classList.toggle('hidden', isNearMessagesBottom());
}

function scrollMessagesToBottom(smooth = true) {
  const wrap = document.getElementById('mobile-messages');
  if (!wrap) return;
  wrap.scrollTo({ top: wrap.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
}

function openPicker() {
  mobileState.pickerOpen = true;
  document.getElementById('mobile-app').classList.add('picker-open');
  document.getElementById('mobile-picker').classList.add('open');
}

function closePicker() {
  mobileState.pickerOpen = false;
  document.getElementById('mobile-app').classList.remove('picker-open');
  document.getElementById('mobile-picker').classList.remove('open');
}

function clearPickerSelection() {
  const picker = document.getElementById('mobile-picker');
  const selection = window.getSelection?.();
  if (!picker || !selection || !selection.rangeCount) return;
  const anchorNode = selection.anchorNode;
  const focusNode = selection.focusNode;
  if ((anchorNode && picker.contains(anchorNode)) || (focusNode && picker.contains(focusNode))) {
    selection.removeAllRanges();
  }
}

function togglePicker() {
  if (mobileState.pickerOpen) closePicker();
  else openPicker();
}

function openSheet(id) {
  const sheet = document.getElementById(id);
  if (!sheet) return;
  window.clearTimeout(sheet._closeTimer);
  sheet.classList.remove('hidden');
  requestAnimationFrame(() => sheet.classList.add('is-open'));
}

function closeSheet(id) {
  const sheet = document.getElementById(id);
  if (!sheet) return;
  sheet.classList.remove('is-open');
  window.clearTimeout(sheet._closeTimer);
  sheet._closeTimer = window.setTimeout(() => sheet.classList.add('hidden'), MOBILE_SHEET_TRANSITION_MS);
}

function syncMobileViewport() {
  const root = document.documentElement;
  const viewport = window.visualViewport;
  const body = document.body;
  if (!root) return;
  if (!viewport) {
    root.style.setProperty('--mobile-vh', '100vh');
    root.style.setProperty('--mobile-vv-top', '0px');
    root.style.setProperty('--mobile-kb-offset', '0px');
    body?.classList.remove('keyboard-open');
    return;
  }
  const visibleHeight = Math.max(0, Math.round(viewport.height));
  const keyboardOffset = Math.max(0, Math.round((window.innerHeight || 0) - (viewport.height + viewport.offsetTop)));
  root.style.setProperty('--mobile-vh', `${visibleHeight}px`);
  root.style.setProperty('--mobile-vv-top', '0px');
  root.style.setProperty('--mobile-kb-offset', `${keyboardOffset}px`);
  body?.classList.toggle('keyboard-open', keyboardOffset > 24);
}

function toggleFavoriteModel(providerId, modelName) {
  const key = `${providerId}::${modelName}`;
  const set = new Set(mobileState.modelFavorites);
  if (set.has(key)) set.delete(key);
  else set.add(key);
  mobileState.modelFavorites = Array.from(set);
  localStorage.setItem('start-mobile-model-favorites', JSON.stringify(mobileState.modelFavorites));
}

async function loadModelCatalog() {
  const providers = mobileState.settings?.providers || {};
  const providerEntries = Object.entries(providers);
  const items = [];
  for (const [providerId, provider] of providerEntries) {
    try {
      const models = await apiGetAvailableModels(providerId);
      (models || []).forEach(modelName => {
        items.push({ providerId, providerName: provider?.name || providerId, modelName });
      });
    } catch (err) {
      console.warn('[Mobile] 获取模型失败：', providerId, err.message);
    }
  }
  items.sort((a, b) => {
    const aFav = mobileState.modelFavorites.includes(`${a.providerId}::${a.modelName}`) ? -1 : 0;
    const bFav = mobileState.modelFavorites.includes(`${b.providerId}::${b.modelName}`) ? -1 : 0;
    if (aFav !== bFav) return aFav - bFav;
    return `${a.providerName}/${a.modelName}`.localeCompare(`${b.providerName}/${b.modelName}`, 'zh-Hans-CN');
  });
  mobileState.modelCatalog = items;
  renderModelSheet();
}

async function createNewConversation(folderId = null) {
  if (mobileState.timelineMode === 'oldtimes') {
    showToast('旧时光模式下仅浏览资料');
    return;
  }
  const id = Date.now().toString();
  const conv = { id, title: '新对话', messages: [] };
  mobileState.conversations.unshift(conv);
  mobileState.currentId = id;
  if (folderId) {
    const folder = mobileState.folders.find(item => item.id === folderId);
    if (folder) {
      folder.conv_ids = [id, ...(folder.conv_ids || [])];
    }
  }
  renderMessages();
  renderPicker();
  closePicker();
  await saveConversations();
}

async function createNewFolder() {
  const raw = window.prompt('文件夹名称：', '新文件夹');
  if (raw === null) return;
  const name = raw.trim() || '新文件夹';
  try {
    const folder = await apiCreateFolder(name);
    mobileState.folders.push(folder);
    renderPicker();
    showToast('文件夹已创建');
  } catch (err) {
    showToast(`创建失败：${err.message}`);
  }
}

function updateConversationTitle(conv) {
  const firstUser = conv.messages.find(msg => msg.role === 'user');
  if (firstUser) {
    conv.title = firstUser.content.slice(0, 20) + (firstUser.content.length > 20 ? '...' : '');
  }
}

async function sendMessage() {
  const input = document.getElementById('mobile-user-input');
  const content = input.value.trim();
  if (!content) return;

  let conv = getCurrentConversation();
  if (!conv) {
    await createNewConversation();
    conv = getCurrentConversation();
  }
  if (!conv) return;

  const userMsg = createMessage('user', content);
  conv.messages.push(userMsg);
  updateConversationTitle(conv);
  input.value = '';
  autosizeInput();
  renderMessages();
  renderPicker();
  await saveConversations();
  await performChat(conv);
}

function enterSendingMode() {
  const btn = document.getElementById('mobile-send-btn');
  btn.textContent = '停止';
  btn.onclick = (event) => {
    event.preventDefault();
    stopGeneration();
  };
}

function exitSendingMode() {
  const btn = document.getElementById('mobile-send-btn');
  btn.textContent = '发送';
  btn.onclick = null;
}

function stopGeneration() {
  if (mobileState.activeWs && mobileState.activeWs.readyState === WebSocket.OPEN) {
    mobileState.activeWs.send(JSON.stringify({ type: 'cancel' }));
  }
}

function buildRequestMessages(conv) {
  const contextLimit = mobileState.settings?.contextLimit || 20;
  return conv.messages.slice(-contextLimit).map(msg => ({ role: msg.role, content: msg.content }));
}

function appendStreamingBubble(modelName) {
  const wrap = document.getElementById('mobile-messages');
  const item = document.createElement('article');
  item.className = 'mobile-message assistant';
  item.dataset.messageIndex = String((getCurrentConversation()?.messages.length || 0));

  const meta = document.createElement('div');
  meta.className = 'mobile-message-meta';
  meta.textContent = modelName;

  const bubble = document.createElement('div');
  bubble.className = 'mobile-message-bubble';
  bubble.innerHTML = '<p></p>';
  const p = bubble.querySelector('p');

  item.append(meta, bubble);
  wrap.appendChild(item);
  wrap.scrollTop = wrap.scrollHeight;
  updateScrollBottomButton();
  return { item, bubble, p };
}

function renderStreamingContent(target, text) {
  if (typeof marked !== 'undefined' && typeof DOMPurify !== 'undefined') {
    target.bubble.innerHTML = DOMPurify.sanitize(marked.parse(text || ''));
  } else {
    target.bubble.innerHTML = `<p>${escHtml(text || '').replace(/\n/g, '<br>')}</p>`;
  }
}

async function performChat(conv) {
  enterSendingMode();
  const modelName = formatCurrentModelLabel();
  const stream = appendStreamingBubble(modelName);
  let fullContent = '';

  try {
    const result = await callBackendChat(buildRequestMessages(conv), (delta) => {
      fullContent += delta;
      renderStreamingContent(stream, fullContent);
      scrollMessagesToBottom(false);
      updateScrollBottomButton();
    }, conv.id);

    const assistantMsg = createMessage('assistant', fullContent, {
      model: mobileState.settings?.taskModels?.chat?.modelName || '',
      usage: result?.usage || null,
    });
    conv.messages.push(assistantMsg);
    stream.item.remove();
    renderMessages();
    await saveConversations();
    showChatPostEffects(result);
  } catch (err) {
    stream.bubble.innerHTML = `<p>${escHtml(err.message)}</p>`;
    stream.item.classList.add('error');
    showToast(err.message);
  } finally {
    exitSendingMode();
  }
}

async function callBackendChat(requestMessages, onDelta, conversationId) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${BACKEND_WS_URL}/ws/chat`);
    mobileState.activeWs = ws;

    ws.onopen = () => {
      const conv = mobileState.conversations.find(item => item.id === conversationId);
      ws.send(JSON.stringify({
        type: 'chat',
        settings: mobileState.settings,
        messages: requestMessages,
        session_id: conversationId || '',
        scratchpad: conv?.scratchpad || '',
      }));
    };

    ws.onmessage = (event) => {
      let payload;
      try {
        payload = JSON.parse(event.data);
      } catch {
        return;
      }
      if (payload.type === 'token') {
        onDelta(payload.data || '');
      } else if (payload.type === 'done') {
        mobileState.activeWs = null;
        resolve({
          usage: payload.usage || null,
          cancelled: !!payload.cancelled,
          saved_memories: payload.saved_memories || [],
          saved_session_memories: payload.saved_session_memories || [],
          scribe: payload.scribe || { updated: false, pair_count: 0 },
        });
      } else if (payload.type === 'error') {
        mobileState.activeWs = null;
        reject(new Error(payload.message || '未知错误'));
      }
    };

    ws.onerror = () => {
      mobileState.activeWs = null;
      reject(new Error('WebSocket 连接失败，请检查后端是否运行'));
    };

    ws.onclose = (event) => {
      if (mobileState.activeWs === ws) mobileState.activeWs = null;
      if (event.code !== 1000 && event.code !== 1001) {
        reject(new Error(`WebSocket 异常断开 (${event.code})`));
      }
    };
  });
}

async function healthCheck() {
  const json = await requestHealthWithBaseUrl(BACKEND_BASE_URL);
  mobileState.healthMeta = json?.meta || null;
  updateSettingsSheet();
  return json;
}

async function loadInitialData() {
  await healthCheck();
  const [settings, conversations, folders] = await Promise.all([
    apiGetSettings(),
    apiGetConversations(),
    apiGetFolders(),
  ]);
  mobileState.settings = settings;
  mobileState.appIconChoice = localStorage.getItem(MOBILE_APP_ICON_KEY) || 'default';
  mobileState.conversations = Array.isArray(conversations) ? conversations : [];
  mobileState.folders = Array.isArray(folders) ? folders : [];
  await syncAppIconChoiceFromShell();
  applyTimelineSelection();
  renderMessages();
  renderPicker();
  updateSettingsSheet();
  renderAppIconSheet();
  renderMobileUserIdentity();
  await loadModelCatalog();
}

function applyTimelineSelection() {
  const current = getCurrentConversation();
  if (current && matchesTimelineMode(current)) return;
  mobileState.currentId = getTimelineConversations()[0]?.id || null;
}

function setTimelineMode(mode) {
  if (mode !== 'now' && mode !== 'oldtimes') return;
  mobileState.timelineMode = mode;
  applyTimelineSelection();
  renderPicker();
  renderMessages();
  updateSettingsSheet();
}

function bindEvents() {
  const pickerEl = document.getElementById('mobile-picker');
  const headerEl = document.getElementById('mobile-chat-header');
  pickerEl.addEventListener('touchstart', event => {
    if (event.target.closest('input, textarea')) return;
    clearPickerSelection();
  }, { passive: false });
  pickerEl.addEventListener('contextmenu', event => {
    if (event.target.closest('input, textarea')) return;
    event.preventDefault();
    event.stopPropagation();
    clearPickerSelection();
  });
  pickerEl.addEventListener('selectstart', event => {
    if (event.target.closest('input, textarea')) return;
    event.preventDefault();
    clearPickerSelection();
  });
  ['click', 'touchstart', 'touchend', 'pointerdown', 'mousedown'].forEach(type => {
    headerEl.addEventListener(type, event => {
      event.stopPropagation();
    }, { passive: type === 'touchstart' ? false : true });
  });
  bindTapAction(document.getElementById('mobile-picker-toggle'), () => togglePicker());
  document.getElementById('mobile-chat-shell').addEventListener('click', () => {
    if (mobileState.pickerOpen) closePicker();
  });
  document.getElementById('mobile-picker-backdrop').addEventListener('click', closePicker);
  bindTapAction(document.getElementById('mobile-map-trigger'), () => openSheet('mobile-map-sheet'));
  document.getElementById('mobile-map-sheet-close').addEventListener('click', () => closeSheet('mobile-map-sheet'));
  bindTapAction(document.getElementById('mobile-model-trigger'), () => openSheet('mobile-model-sheet'));
  document.getElementById('mobile-model-sheet-close').addEventListener('click', () => closeSheet('mobile-model-sheet'));
  bindTapAction(document.getElementById('mobile-history-btn'), () => {
    renderHistorySheet();
    openSheet('mobile-history-sheet');
  });
  document.getElementById('mobile-history-sheet-close').addEventListener('click', () => closeSheet('mobile-history-sheet'));
  bindTapAction(document.getElementById('mobile-settings-btn'), () => openSheet('mobile-settings-sheet'));
  document.getElementById('mobile-settings-sheet-close').addEventListener('click', () => closeSheet('mobile-settings-sheet'));
  document.getElementById('mobile-settings-app-icon-trigger').addEventListener('click', () => {
    renderAppIconSheet();
    openSheet('mobile-app-icon-sheet');
  });
  document.getElementById('mobile-app-icon-sheet-close').addEventListener('click', () => closeSheet('mobile-app-icon-sheet'));
  bindTapAction(document.getElementById('mobile-user-btn'), openUserSheet);
  document.getElementById('mobile-user-sheet-close').addEventListener('click', () => closeSheet('mobile-user-sheet'));
  document.getElementById('mobile-settings-backend-trigger').addEventListener('click', () => openBackendSheet());
  document.getElementById('mobile-backend-sheet-close').addEventListener('click', () => closeSheet('mobile-backend-sheet'));
  document.getElementById('mobile-conv-actions-close').addEventListener('click', () => closeSheet('mobile-conv-actions-sheet'));
  document.getElementById('mobile-move-sheet-close').addEventListener('click', () => closeSheet('mobile-move-sheet'));
  document.getElementById('mobile-message-more-close').addEventListener('click', () => closeSheet('mobile-message-more-sheet'));
  document.querySelectorAll('.mobile-sheet-backdrop').forEach(el => el.addEventListener('click', () => closeSheet(el.parentElement.id)));
  document.getElementById('mobile-send-btn').addEventListener('click', sendMessage);
  document.getElementById('mobile-extra-btn').addEventListener('click', () => {
    document.getElementById('mobile-extra-menu').classList.toggle('hidden');
  });
  document.getElementById('mobile-new-chat-inline-btn').addEventListener('click', async () => {
    document.getElementById('mobile-extra-menu').classList.add('hidden');
    await createNewConversation();
  });
  document.getElementById('mobile-clear-context-btn').addEventListener('click', async () => {
    const conv = getCurrentConversation();
    if (!conv) return;
    conv.contextClearedAt = conv.messages.length;
    document.getElementById('mobile-extra-menu').classList.add('hidden');
    await saveConversations();
    showToast('已清空上下文窗口');
  });
  document.getElementById('mobile-search-input').addEventListener('input', (event) => {
    mobileState.search = event.target.value || '';
    renderPicker();
  });
  document.getElementById('mobile-backend-test-btn').addEventListener('click', async () => {
    const value = document.getElementById('mobile-backend-input')?.value || '';
    await connectBackend(value, { persist: false, reload: false });
  });
  document.getElementById('mobile-backend-save-btn').addEventListener('click', async () => {
    const value = document.getElementById('mobile-backend-input')?.value || '';
    const ok = await connectBackend(value, { persist: true, reload: true });
    if (ok) {
      closeSheet('mobile-backend-sheet');
      showToast('已连接新后端');
    }
  });
  document.getElementById('mobile-backend-reset-btn').addEventListener('click', async () => {
    const defaultUrl = getDefaultBackendBaseUrl();
    document.getElementById('mobile-backend-input').value = defaultUrl;
    updateBackendStatus('正在恢复默认地址…');
    try {
      const json = await requestHealthWithBaseUrl(defaultUrl);
      setBackendBaseUrl('');
      mobileState.healthMeta = json?.meta || null;
      await loadInitialData();
      populateBackendInput();
      closeSheet('mobile-backend-sheet');
      showToast('已恢复默认地址');
    } catch (err) {
      updateBackendStatus(err.message, true);
      renderConnectionError(err);
    }
  });
  document.getElementById('mobile-user-avatar-pick-btn').addEventListener('click', () => {
    document.getElementById('mobile-user-avatar-input')?.click();
  });
  document.getElementById('mobile-user-avatar-clear-btn').addEventListener('click', () => {
    mobileState.settings.userAvatar = '';
    renderMobileUserIdentity();
  });
  document.getElementById('mobile-user-save-btn').addEventListener('click', saveMobileUserProfile);
  document.getElementById('mobile-user-avatar-input').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      mobileState.settings.userAvatar = await readFileAsDataUrl(file);
      renderMobileUserIdentity();
    } catch (err) {
      showToast(err.message);
    } finally {
      event.target.value = '';
    }
  });
  bindTapAction(document.getElementById('mobile-new-folder-btn'), createNewFolder);
  bindTapAction(document.getElementById('mobile-new-chat-top-btn'), async () => createNewConversation());
  document.getElementById('mobile-conv-rename-btn').addEventListener('click', renameActiveConversation);
  document.getElementById('mobile-conv-pin-btn').addEventListener('click', togglePinActiveConversation);
  document.getElementById('mobile-conv-retitle-btn').addEventListener('click', regenerateActiveConversationTitle);
  document.getElementById('mobile-conv-move-btn').addEventListener('click', () => {
    renderMoveSheet();
    openSheet('mobile-move-sheet');
  });
  document.getElementById('mobile-conv-delete-btn').addEventListener('click', deleteActiveConversation);
  document.getElementById('mobile-message-more-copy-btn').addEventListener('click', async () => {
    const msg = getCurrentMessage();
    if (!msg) return;
    await copyMobileMessage(msg);
    closeSheet('mobile-message-more-sheet');
  });
  document.getElementById('mobile-message-more-memory-btn').addEventListener('click', async () => {
    const msg = getCurrentMessage();
    if (!msg) return;
    closeSheet('mobile-message-more-sheet');
    await saveAssistantMessageToMemory(msg);
  });
  document.getElementById('mobile-message-more-edit-btn').addEventListener('click', () => {
    const msg = getCurrentMessage();
    if (!msg) return;
    editMobileMessage(msg);
    closeSheet('mobile-message-more-sheet');
  });
  document.getElementById('mobile-message-more-regen-btn').addEventListener('click', async () => {
    const msg = getCurrentMessage();
    if (!msg) return;
    closeSheet('mobile-message-more-sheet');
    await regenerateMobileAssistant(msg);
  });
  document.getElementById('mobile-message-more-tts-btn').addEventListener('click', async () => {
    const msg = getCurrentMessage();
    if (!msg) return;
    closeSheet('mobile-message-more-sheet');
    await playMobileMessageTts(msg);
  });
  document.getElementById('mobile-message-more-delete-btn').addEventListener('click', async () => {
    const msg = getCurrentMessage();
    if (!msg) return;
    const btn = document.getElementById('mobile-message-more-delete-btn');
    if (!mobileState.messageDeleteConfirm) {
      mobileState.messageDeleteConfirm = true;
      if (btn) {
        btn.textContent = '确认删除';
        btn.classList.add('confirming');
      }
      window.setTimeout(() => {
        if (!mobileState.messageDeleteConfirm) return;
        mobileState.messageDeleteConfirm = false;
        if (btn) {
          btn.textContent = '删除';
          btn.classList.remove('confirming');
        }
      }, 2400);
      return;
    }
    mobileState.messageDeleteConfirm = false;
    closeSheet('mobile-message-more-sheet');
    await deleteMobileMessage(msg.id);
  });
  document.getElementById('mobile-timeline-toggle-btn').addEventListener('click', () => {
    setTimelineMode(mobileState.timelineMode === 'oldtimes' ? 'now' : 'oldtimes');
  });
  document.getElementById('mobile-settings-timeline-toggle').addEventListener('click', () => {
    setTimelineMode(mobileState.timelineMode === 'oldtimes' ? 'now' : 'oldtimes');
  });
  document.getElementById('mobile-user-input').addEventListener('input', autosizeInput);
  document.getElementById('mobile-user-input').addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && event.ctrlKey) {
      event.preventDefault();
      sendMessage();
    }
  });
  document.getElementById('mobile-messages').addEventListener('scroll', updateScrollBottomButton, { passive: true });
  document.getElementById('mobile-scroll-bottom-btn').addEventListener('click', () => scrollMessagesToBottom(true));
  let touchStartX = 0;
  let touchStartY = 0;
  let touchStartTarget = null;
  document.addEventListener('touchstart', (event) => {
    touchStartX = event.changedTouches[0]?.clientX || 0;
    touchStartY = event.changedTouches[0]?.clientY || 0;
    touchStartTarget = event.target;
  }, { passive: true });
  document.addEventListener('selectionchange', clearPickerSelection);
  document.addEventListener('touchend', (event) => {
    const touch = event.changedTouches[0];
    const touchEndX = touch?.clientX || 0;
    const touchEndY = touch?.clientY || 0;
    const diffX = touchEndX - touchStartX;
    const diffY = touchEndY - touchStartY;
    const mostlyHorizontal = Math.abs(diffX) > 56 && Math.abs(diffY) < 42;
    const startEl = touchStartTarget instanceof Element ? touchStartTarget : null;
    const startedInChatShell = !!startEl?.closest?.('#mobile-chat-shell');
    const startedInPicker = !!startEl?.closest?.('#mobile-picker');
    const startedInInputArea = !!startEl?.closest?.('#mobile-input-dock, #mobile-user-input');
    const startedInSheet = !!startEl?.closest?.('.mobile-sheet:not(.hidden)');

    if (startedInSheet || startedInInputArea || !mostlyHorizontal) return;
    if (!mobileState.pickerOpen && startedInChatShell && diffX > 0) {
      openPicker();
      return;
    }
    if (mobileState.pickerOpen && (startedInChatShell || startedInPicker) && diffX < 0) {
      closePicker();
    }
  }, { passive: true });
}

async function init() {
  bindEvents();
  autosizeInput();
  populateBackendInput();
  syncMobileViewport();
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', syncMobileViewport);
    window.visualViewport.addEventListener('scroll', syncMobileViewport);
  }
  window.addEventListener('orientationchange', () => window.setTimeout(syncMobileViewport, 120));

  try {
    await loadInitialData();
  } catch (err) {
    console.error('[Mobile] 初始化失败：', err);
    renderConnectionError(err);
    openBackendSheet(err.message);
    showToast('后端未连接');
  }
}

init();
