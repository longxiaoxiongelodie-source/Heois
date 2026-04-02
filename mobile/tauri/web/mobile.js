import { apiAddGlobalMemory, apiCheckHealth, apiGetAvailableModels, apiGetConversation, apiGetConversationIndex, apiGetFolders, apiGetSettings, apiGetTitle, apiLookupTtsAudio, apiSaveConversations, apiSaveSettings, apiStreamChat, apiSynthesizeTts } from './api.js';
import { BACKEND_BASE_URL, getDefaultBackendBaseUrl, getStoredBackendBaseUrl, normalizeBackendBaseUrl, setBackendBaseUrl } from './state.js';
import { createMobilePickerController } from './mobile_picker.js';
import { createMobileInputDockController } from './mobile_input_dock.js';
import { getChatRouteMeta, hasAcknowledgedCloudRoute, markCloudRouteAcknowledged } from './utils.js';

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
  _pendingChatAttachments: [],
  _cloudSendNoticeShown: new Set(),
  modelFavorites: JSON.parse(localStorage.getItem('start-mobile-model-favorites') || '[]'),
  appIconChoice: localStorage.getItem('ministar-app-icon-choice') || 'default',
  collapsedFolders: new Set(JSON.parse(localStorage.getItem('ministar-mobile-collapsed-folders') || '[]')),
};

let mobileTtsAudio = null;
let mobileTtsActiveBtn = null;
let mobileTtsObjectUrl = null;
const MOBILE_SHEET_TRANSITION_MS = 240;
const MOBILE_APP_ICON_KEY = 'ministar-app-icon-choice';
const MOBILE_MODEL_FAVORITES_KEY = 'start-mobile-model-favorites';
const MOBILE_ASSISTANT_LABEL = '助手';
const MOBILE_CHAT_STATUS_LABEL = '聊天已接入后端';
const MOBILE_BUILD_STAMP = '2026-04-02 · api-chat-shell';
const MOBILE_COLLAPSED_FOLDERS_KEY = 'ministar-mobile-collapsed-folders';
const MOBILE_APP_ICON_OPTIONS = [
  { key: 'default', native: null, label: '现行', desc: '当前主图标，沿用现在这版。', preview: 'ministar-icon-default.png' },
  { key: 'seal', native: 'Seal', label: '徽记', desc: '更收束的印记感，像正式徽标。', preview: 'ministar-icon-seal.png' },
  { key: 'orbit', native: 'Orbit', label: '轨页', desc: '书页和轨道感更明显，偏叙事。', preview: 'ministar-icon-orbit.png' },
  { key: 'spark', native: 'Spark', label: '星窗', desc: '更轻快，也更像移动入口。', preview: 'ministar-icon-spark.png' },
];

let mobilePickerController = null;
let mobileInputDockController = null;

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

function resetCollapsedFoldersToDefault(folders = []) {
  mobileState.collapsedFolders = new Set(
    (Array.isArray(folders) ? folders : [])
      .map(folder => folder?.id)
      .filter(Boolean)
  );
  persistCollapsedFolders();
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

async function ensureConversationLoaded(convId) {
  const conv = mobileState.conversations.find(item => item.id === convId);
  if (!conv || conv.messagesLoaded) return conv || null;
  if (conv._loadingMessages) return conv;
  conv._loadingMessages = true;
  try {
    const full = await apiGetConversation(convId);
    if (!full || full.id !== convId) return conv;
    Object.assign(conv, normalizeMobileConversation(full), { messagesLoaded: true });
    return conv;
  } finally {
    conv._loadingMessages = false;
  }
}

async function callBackendTitle(messages) {
  const data = await apiGetTitle(messages);
  return data.title || '';
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

function createMessage(role, content, extras = {}) {
  return normalizeMobileMessage({
    id: extras.id || `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    role,
    content,
    createdAt: extras.createdAt || Date.now(),
    updatedAt: extras.updatedAt || extras.createdAt || Date.now(),
    model: extras.model || '',
    usage: extras.usage || null,
    status: extras.status || 'done',
    meta: extras.meta || {},
  });
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

function derivePartnerTokenCount(msg) {
  const total = Number(
    msg?.usage?.total_tokens
    ?? (
      msg?.usage?.prompt_tokens != null && msg?.usage?.completion_tokens != null
        ? Number(msg.usage.prompt_tokens) + Number(msg.usage.completion_tokens)
        : msg?.usage?.completion_tokens
    )
    ?? msg?.meta?.partnerTokens
    ?? msg?.meta?.tokens
    ?? 0,
  );
  return Number.isFinite(total) && total > 0 ? total : 0;
}

function normalizeMobileMessage(msg) {
  if (!msg || typeof msg !== 'object') return msg;
  const meta = { ...(msg.meta || {}) };
  if (msg.role === 'assistant') {
    const partnerTokens = derivePartnerTokenCount({ ...msg, meta });
    if (partnerTokens > 0) {
      meta.partnerTokens = partnerTokens;
      if (meta.tokens == null) meta.tokens = partnerTokens;
    }
    const scribeTokens = Number(meta.scribeTokens || 0);
    if (Number.isFinite(scribeTokens) && scribeTokens > 0) {
      meta.scribeTokens = scribeTokens;
    } else {
      delete meta.scribeTokens;
    }
  }
  return { ...msg, meta };
}

function normalizeMobileConversation(conv) {
  if (!conv || typeof conv !== 'object') return conv;
  const messages = Array.isArray(conv.messages) ? conv.messages.map(normalizeMobileMessage) : [];
  return {
    ...conv,
    messages,
    messagesLoaded: conv.messagesLoaded !== false,
    message_count: Number(conv.message_count ?? conv.messageCount ?? messages.length) || 0,
  };
}

function getMessageTokenCount(msg) {
  return derivePartnerTokenCount(msg);
}

function formatMobileMetaInfo(msg) {
  const parts = [];
  const timeText = formatMobileDateTime(msg?.createdAt || msg?.timestamp || 0);
  if (timeText) parts.push(timeText);
  if (msg?.role === 'assistant') {
    const tokens = getMessageTokenCount(msg);
    if (tokens) parts.push(`Partner ${tokens.toLocaleString()} tokens`);
    const scribeTokens = Number(msg?.meta?.scribeTokens || 0);
    if (scribeTokens > 0) parts.push(`Scribe ${scribeTokens.toLocaleString()}tokens`);
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

  const lookup = await apiLookupTtsAudio(text).catch(() => null);
  if (lookup?.found && lookup?.url) {
    return { audioUrl: `${BACKEND_BASE_URL}${lookup.url}` };
  }

  return apiSynthesizeTts(text);
}

function buildMobileMessageHeader(msg) {
  const header = document.createElement('div');
  header.className = `mobile-message-header ${msg.role}`;
  const meta = document.createElement('div');
  meta.className = `mobile-message-meta ${msg.role === 'user' ? 'user' : 'assistant'}`;

  if (msg.role === 'assistant') {
    const modelLine = document.createElement('div');
    modelLine.className = 'mobile-message-meta-model';
    modelLine.textContent = msg.model || MOBILE_ASSISTANT_LABEL;
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
  getMobileInputDockController().fillInputFromMessage(msg);
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
    const data = await apiLookupTtsAudio(text);
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
  const route = getChatRouteMeta(mobileState.settings || {});
  modelEl.textContent = route.providerId ? route.label : MOBILE_CHAT_STATUS_LABEL;
  updateSettingsSheet();
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
  if (conv._loadingMessages) {
    wrap.innerHTML = '<div class="mobile-empty-state">正在读取这段对话…</div>';
    updateHeader();
    renderMapSheet();
    return;
  }
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

function getMobilePickerController() {
  if (!mobilePickerController) {
    mobilePickerController = createMobilePickerController({
      state: mobileState,
      apiStreamChat,
      escHtml,
      showToast,
      openSheet,
      closeSheet,
      renderMessages,
      saveConversations,
      isImportedConversation,
      getTimelineConversations,
      formatMobileDateOnly,
      callBackendTitle,
      cleanAITitle,
      applyTimelineSelection,
      createNewConversation,
      ensureConversationLoaded,
    });
  }
  return mobilePickerController;
}

function getMobileInputDockController() {
  if (!mobileInputDockController) {
    mobileInputDockController = createMobileInputDockController({
      state: mobileState,
      escHtml,
      showToast,
      getChatRouteMeta,
      hasAcknowledgedCloudRoute,
      markCloudRouteAcknowledged,
      showChatPostEffects,
      saveConversations,
      createNewConversation,
      getCurrentConversation,
      createMessage,
      updateConversationTitle,
      renderMessages,
      renderPicker,
      formatCurrentModelLabel,
    });
  }
  return mobileInputDockController;
}

function renderPicker() {
  return getMobilePickerController().renderPicker();
}

function renderHistorySheet() {
  return getMobilePickerController().renderHistorySheet();
}

function autosizeInput() {
  return getMobileInputDockController().autosizeInput();
}

function getConversationFolder(convId) {
  return getMobilePickerController().getConversationFolder(convId);
}

function openConvActions(convId) {
  return getMobilePickerController().openConvActions(convId);
}

function renderMoveSheet() {
  return getMobilePickerController().renderMoveSheet();
}

function createNewFolder() {
  return getMobilePickerController().createNewFolder();
}

function syncMobileViewport() {
  return getMobileInputDockController().syncViewport();
}

function openPicker() {
  return getMobilePickerController().openPicker();
}

function closePicker() {
  return getMobilePickerController().closePicker();
}

function clearPickerSelection() {
  return getMobilePickerController().clearPickerSelection();
}

function togglePicker() {
  return getMobilePickerController().togglePicker();
}

function renameActiveConversation() {
  return getMobilePickerController().renameActiveConversation();
}

function togglePinActiveConversation() {
  return getMobilePickerController().togglePinActiveConversation();
}

function regenerateActiveConversationTitle() {
  return getMobilePickerController().regenerateActiveConversationTitle();
}

function deleteActiveConversation() {
  return getMobilePickerController().deleteActiveConversation();
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
  if (modelEl) modelEl.textContent = MOBILE_CHAT_STATUS_LABEL;
  const appIconEl = document.getElementById('mobile-settings-app-icon-sub');
  if (appIconEl) appIconEl.textContent = getCurrentAppIconOption().label;
  const healthEl = document.getElementById('mobile-settings-health-sub');
  if (healthEl) healthEl.textContent = healthLabel;
  const buildEl = document.getElementById('mobile-settings-build-sub');
  if (buildEl) buildEl.textContent = MOBILE_BUILD_STAMP;
}

function renderBuildStampImmediately() {
  const buildEl = document.getElementById('mobile-settings-build-sub');
  if (buildEl) buildEl.textContent = MOBILE_BUILD_STAMP;
}

function resetMobileCachedState() {
  localStorage.removeItem(MOBILE_MODEL_FAVORITES_KEY);
  localStorage.removeItem(MOBILE_APP_ICON_KEY);
  localStorage.removeItem(MOBILE_COLLAPSED_FOLDERS_KEY);
  try {
    sessionStorage.clear();
  } catch (_) {}
  mobileState.modelFavorites = [];
  mobileState.appIconChoice = 'default';
  mobileState.collapsedFolders = new Set();
  mobileState.search = '';
  mobileState.activeConvActionId = null;
  mobileState.activeMessageActionId = null;
  mobileState.messageDeleteConfirm = false;
  mobileState.drag = null;
  mobileState._lastPromptSnapshot = null;
}

function requestClearMobileCache() {
  const btn = document.getElementById('mobile-settings-clear-cache-btn');
  if (!btn) return;
  const titleEl = btn.querySelector('.mobile-model-title');
  const subEl = btn.querySelector('.mobile-model-sub');
  if (!btn.dataset.confirming) {
    btn.dataset.confirming = '1';
    if (titleEl) titleEl.textContent = '确认清手机端缓存';
    if (subEl) subEl.textContent = '再次点按后立即清空并刷新当前页面';
    window.setTimeout(() => {
      if (!btn.dataset.confirming) return;
      delete btn.dataset.confirming;
      if (titleEl) titleEl.textContent = '清手机端缓存';
      if (subEl) subEl.textContent = '只清本机收藏、折叠与临时状态，不删除后端对话数据';
    }, 2200);
    return;
  }
  resetMobileCachedState();
  showToast('手机端缓存已清空，正在刷新');
  window.setTimeout(() => window.location.reload(), 180);
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
  return apiCheckHealth(baseUrl);
}

function renderConnectionError(err) {
  const wrap = document.getElementById('mobile-messages');
  wrap.innerHTML = `
    <div class="mobile-empty-state">
      无法连接 StarT 后端。<br>${escHtml(err.message)}
      <div style="margin-top:10px;font-size:0.92em;opacity:0.82;line-height:1.5;">
        如果你是手机连接电脑后端，请把后端启动为 <code>--host 0.0.0.0</code>，
        不能只监听 <code>127.0.0.1</code>。
      </div>
      <div style="margin-top:10px;font-size:0.9em;opacity:0.72;line-height:1.5;">
        当前壳版本：<code>${MOBILE_BUILD_STAMP}</code><br>
        如果你这里仍看到“websocket 连接失败”，通常说明手机里运行的还是旧安装包，不是当前这版 <code>/api/chat</code> 壳。
      </div>
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

function updateScrollBottomButton() {
  return getMobileInputDockController().updateScrollBottomButton();
}

function scrollMessagesToBottom(smooth = true) {
  return getMobileInputDockController().scrollMessagesToBottom(smooth);
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
  const conv = { id, title: '新对话', messagesLoaded: true, message_count: 0, messages: [] };
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

function updateConversationTitle(conv) {
  const firstUser = conv.messages.find(msg => msg.role === 'user');
  if (firstUser) {
    conv.title = firstUser.content.slice(0, 20) + (firstUser.content.length > 20 ? '...' : '');
  }
}

function stopGeneration() {
  return getMobileInputDockController().stopGeneration();
}

function performChat(conv) {
  return getMobileInputDockController().performChat(conv);
}

async function sendMessage() {
  return getMobileInputDockController().sendMessage();
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
    apiGetConversationIndex(),
    apiGetFolders(mobileState.timelineMode || 'now'),
  ]);
  mobileState.settings = settings;
  mobileState.appIconChoice = localStorage.getItem(MOBILE_APP_ICON_KEY) || 'default';
  mobileState.conversations = Array.isArray(conversations) ? conversations.map(normalizeMobileConversation) : [];
  mobileState.folders = Array.isArray(folders) ? folders : [];
  resetCollapsedFoldersToDefault(mobileState.folders);
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

async function setTimelineMode(mode) {
  if (mode !== 'now' && mode !== 'oldtimes') return;
  mobileState.timelineMode = mode;
  mobileState.folders = await apiGetFolders(mobileState.timelineMode || 'now').catch(() => []);
  resetCollapsedFoldersToDefault(mobileState.folders);
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
  document.getElementById('mobile-settings-clear-cache-btn').addEventListener('click', requestClearMobileCache);
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
  populateBackendInput();
  renderBuildStampImmediately();
  updateSettingsSheet();
  getMobileInputDockController().init();

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
