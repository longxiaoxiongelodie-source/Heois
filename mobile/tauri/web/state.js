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

const _HOST = typeof window !== 'undefined' && window.location?.hostname
  ? window.location.hostname
  : '127.0.0.1';
const _PROTO = typeof window !== 'undefined' && window.location?.protocol === 'https:'
  ? 'https:'
  : 'http:';
const _WS_PROTO = _PROTO === 'https:' ? 'wss:' : 'ws:';

export const BACKEND_BASE_URL = `${_PROTO}//${_HOST}:8000`;
export const BACKEND_WS_URL   = `${_WS_PROTO}//${_HOST}:8000`;

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
