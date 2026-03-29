// state.js — shared mutable state + constants

export const state = {
  settings: {
    // 多供应商：{ provider_id: { name, apiBaseUrl, apiKey, providerType } }
    providers: {},
    // 全局默认模型名（兼容字段，实际通过 taskModels 管理）
    modelName:    '',
    systemPrompt: '',
    userName:     '',
    assistantName: '',
    taggerSystemPrompt:    '',
    scribeSystemPrompt:    '',
    readerSystemPrompt:    '',
    archivistSystemPrompt: '',
    mergeSystemPrompt:     '',
    taskModels: {
      chat:    { modelName: '', provider: '' },
      title:   { modelName: '', provider: '' },
      archivist: { modelName: '', provider: '' },
    },
    workerConfigs: {
      partner:   { enabled: true, slot: 'chat', temperature: 0.8, top_p: 0.95 },
      tagger:    { enabled: true, slot: 'title', temperature: 0.4, top_p: 0.9 },
      merge:     { enabled: true, slot: 'title', temperature: 0.35, top_p: 0.9 },
      scribe:    { enabled: true, slot: 'archivist', temperature: 0.3, top_p: 0.85 },
      reader:    { enabled: true, slot: 'archivist', temperature: 0.5, top_p: 0.9 },
      archivist: { enabled: true, slot: 'archivist', temperature: 0.2, top_p: 0.8 },
    },
    contextLimit:           20,
    // 头像（data URL 或空字符串）
    userAvatar:      '',
    assistantAvatar: '',
  },
  conversations: [],
  currentId: null,
  _folders: [],
  _folderCollapsed: new Set(),
  _timelineMode: 'now',
  _dragConvId: null,
  _dragFolderId: null,
  _activeWs: null,
  _titlingConvIds: new Set(),
  _memoriesCache: { global: [], byConversation: {} },
  _globalMemoriesCache: [],
  _midTermMemoriesCache: [],
  _selectedGlobalMemoryIds: new Set(),
  _globalMemoryMode: 'default',
  _globalMemoryReturnMode: 'default',
  _globalMemoryPrevMode: 'default',
  _globalMemoryPrevFocusId: null,
  _globalMemoryFocusId: null,
  _globalMemoryDraftId: null,
  _midMemoryMode: 'default',
  _midMemoryFocusId: null,
  _midMemoryDraftId: null,
  _arcCurrentNote: null,
  _arcCurrentConv: null,
  _arcMode: 'info',
  _arcSidebarCollapsed: false,
  _arcEntries: [],
  _arcAnalysisDoc: null,
  _arcScribeState: null,
  _arcAnalysisFurnace: 'split',
  _arcAlchemyFocus: '',
  _arcAlchemyCollapsed: false,
  _arcFiveMergeSelectedKeys: new Set(),
  _arcFiveMergeSelectedLevel: 1,
  _arcSelectedPeriodIds: new Set(),
  _arcPhraseBatchMode: false,
  _arcPhraseBatchStartId: null,
  _arcPhraseBatchDraftRanges: [],
  _arcManualPeriodMode: false,
  _arcManualPeriodStartId: null,
  _arcManualPeriodDraftRanges: [],
  _arcChecked: new Set(),
  _arcPopState: null,
  _arcConvs: [],
  _arcWorksItems: [],
  _arcWorksDetailId: null,
  _userScrolledAway: false,
  _editMode: false,
  _selectedPairIndices: new Set(),
  _settingsNavStack: [],
  _scratchpadTimer: null,
};

export const MOBILE_BACKEND_OVERRIDE_KEY = 'ministar-backend-base-url';

const _HOST = typeof window !== 'undefined' && window.location?.hostname
  ? window.location.hostname
  : '127.0.0.1';
const _PROTO = typeof window !== 'undefined' && window.location?.protocol === 'https:'
  ? 'https:'
  : 'http:';

export function getDefaultBackendBaseUrl() {
  return `${_PROTO}//${_HOST}:8000`;
}

export function normalizeBackendBaseUrl(raw = '') {
  const text = String(raw || '').trim();
  if (!text) return '';
  const withProto = /^https?:\/\//i.test(text) ? text : `http://${text}`;
  let url;
  try {
    url = new URL(withProto);
  } catch {
    return '';
  }
  url.hash = '';
  url.search = '';
  url.pathname = '';
  if (!url.port) url.port = '8000';
  return url.toString().replace(/\/$/, '');
}

function resolveBackendWsUrl(baseUrl) {
  const httpUrl = new URL(baseUrl);
  httpUrl.protocol = httpUrl.protocol === 'https:' ? 'wss:' : 'ws:';
  return httpUrl.toString().replace(/\/$/, '');
}

export function getStoredBackendBaseUrl() {
  if (typeof window === 'undefined' || !window.localStorage) return '';
  return normalizeBackendBaseUrl(window.localStorage.getItem(MOBILE_BACKEND_OVERRIDE_KEY) || '');
}

export let BACKEND_BASE_URL = getStoredBackendBaseUrl() || getDefaultBackendBaseUrl();
export let BACKEND_WS_URL = resolveBackendWsUrl(BACKEND_BASE_URL);

export function setBackendBaseUrl(raw = '') {
  const normalized = normalizeBackendBaseUrl(raw);
  if (typeof window !== 'undefined' && window.localStorage) {
    if (normalized) window.localStorage.setItem(MOBILE_BACKEND_OVERRIDE_KEY, normalized);
    else window.localStorage.removeItem(MOBILE_BACKEND_OVERRIDE_KEY);
  }
  BACKEND_BASE_URL = normalized || getDefaultBackendBaseUrl();
  BACKEND_WS_URL = resolveBackendWsUrl(BACKEND_BASE_URL);
  return BACKEND_BASE_URL;
}

export const DEBUG_REQUEST = false;
export const DEBUG_SUMMARY = true;

export const ARC_FIELD_LABELS = {
  summary:      '摘要',
  topic_tags:   '主题词',
  process_tags: '动作词',
  characters:   '人物',
  locations:    '地点',
  moments:      '时刻',
  unique_hooks: '钩子',
};

export const ARC_TAG_FIELDS = new Set(['topic_tags','process_tags','characters','locations','moments','unique_hooks']);
