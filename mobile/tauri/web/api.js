// api.js — 统一后端请求层
// 所有模块通过此文件访问后端，禁止在功能模块内直接调用 fetch。

import { BACKEND_BASE_URL } from './state.js';

function describeNetworkError(err, url) {
  const raw = String(err?.message || err || '').trim();
  const base = `后端未启动或网络不可达（${raw || 'network error'}）`;
  let host = '';
  try {
    host = new URL(String(url || '')).hostname || '';
  } catch (_) {}
  if (host && host !== '127.0.0.1' && host !== 'localhost') {
    return `${base}。如果这是手机连接电脑后端，请确认后端监听的是 0.0.0.0，而不是 127.0.0.1。`;
  }
  return `${base}（${url}）`;
}

function normalizeChatDebug(debug = {}, fallback = {}) {
  const effects = debug.effects || {};
  const prompt = debug.prompt || {};
  const trace = debug.trace || {};
  return {
    worker: debug.worker || fallback.worker || '',
    conversation_id: debug.conversation_id || fallback.conversation_id || '',
    prompt: {
      system_layers: Array.isArray(prompt.system_layers) ? prompt.system_layers : [],
      history_count: Number(prompt.history_count || 0),
      assembled_message_count: Number(prompt.assembled_message_count || 0),
      memory_count: Number(prompt.memory_count || 0),
      scratchpad_chars: Number(prompt.scratchpad_chars || 0),
      summary_chars: Number(prompt.summary_chars || 0),
    },
    effects: {
      saved_memories: Array.isArray(effects.saved_memories)
        ? effects.saved_memories
        : (Array.isArray(debug.saved_memories) ? debug.saved_memories : (fallback.saved_memories || [])),
      saved_session_memories: Array.isArray(effects.saved_session_memories)
        ? effects.saved_session_memories
        : (Array.isArray(debug.saved_session_memories) ? debug.saved_session_memories : (fallback.saved_session_memories || [])),
      scribe: effects.scribe ?? debug.scribe ?? fallback.scribe ?? null,
    },
    trace: {
      prompt_snapshot: trace.prompt_snapshot ?? debug.prompt_snapshot ?? fallback.prompt_snapshot ?? null,
      os: (trace.os && typeof trace.os === 'object')
        ? trace.os
        : ((debug.os && typeof debug.os === 'object') ? debug.os : (fallback.os || null)),
    },
  };
}

function normalizeChatError(error = null) {
  if (!error) return null;
  const code = String(error.code || 'CHAT_ERROR');
  const status = Number(error.status_code || 500);
  const rawMessage = String(error.message || '').trim();
  return {
    code,
    message: rawMessage || `${code}（HTTP ${status}）`,
    status_code: status,
  };
}

export function normalizeChatEnvelope(payload = {}, fallback = {}) {
  const debug = normalizeChatDebug(payload.debug || {}, payload);
  return {
    text: String(payload.text ?? payload.content ?? ''),
    usage: payload.usage ?? null,
    model: String(payload.model || fallback.model || ''),
    provider: String(payload.provider || fallback.provider || ''),
    debug,
    error: normalizeChatError(payload.error || null),
  };
}

function normalizeTaskDebug(debug = {}, fallback = {}) {
  return {
    worker: String(debug.worker || fallback.worker || ''),
    conversation_id: String(debug.conversation_id || fallback.conversation_id || ''),
    task: String(debug.task || fallback.task || ''),
    meta: (debug.meta && typeof debug.meta === 'object') ? debug.meta : {},
  };
}

export function normalizeTaskEnvelope(payload = {}, fallback = {}) {
  return {
    text: String(payload.text ?? payload.content ?? ''),
    usage: payload.usage ?? payload.stats?.usage ?? null,
    model: String(payload.model || fallback.model || ''),
    provider: String(payload.provider || fallback.provider || ''),
    debug: normalizeTaskDebug(payload.debug || {}, payload),
    error: normalizeChatError(payload.error || null),
  };
}

function withTaskEnvelope(payload = {}, fallback = {}) {
  return {
    ...payload,
    ...normalizeTaskEnvelope(payload, fallback),
  };
}

export async function apiChat(payload, options = {}) {
  const data = await fetchJsonOrThrow(BACKEND_BASE_URL + '/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, stream: false }),
    signal: options.signal,
  });
  return normalizeChatEnvelope(data);
}

// ── 核心 HTTP 工具 ────────────────────────────────────────────

export async function fetchJsonOrThrow(url, options = {}) {
  const timeoutMs = Number(options?.timeout_ms || 0);
  const controller = timeoutMs > 0 ? new AbortController() : null;
  const timeoutId = controller
    ? window.setTimeout(() => controller.abort(new DOMException('timeout', 'AbortError')), timeoutMs)
    : null;
  const fetchOptions = controller
    ? { ...options, signal: options.signal || controller.signal }
    : options;
  let resp;
  try {
    resp = await fetch(url, fetchOptions);
  } catch (err) {
    if (err?.name === 'AbortError' && timeoutMs > 0) {
      throw new Error(`请求超时（>${timeoutMs}ms）`);
    }
    throw new Error(describeNetworkError(err, url));
  } finally {
    if (timeoutId !== null) window.clearTimeout(timeoutId);
  }
  let body;
  try {
    body = await resp.json();
  } catch (_) {
    throw new Error('接口返回非 JSON 响应（HTTP ' + resp.status + '）');
  }
  if (!body.ok) {
    const detail = typeof body.error === 'string'
      ? body.error
      : body.error?.message || body.message || '接口返回错误（HTTP ' + resp.status + '）';
    throw new Error(detail);
  }
  return body.data;
}

export async function fetchResponseOrThrow(url, options = {}) {
  let resp;
  try {
    resp = await fetch(url, options);
  } catch (err) {
    throw new Error(describeNetworkError(err, url));
  }
  if (!resp.ok) {
    let body = null;
    try {
      body = await resp.json();
    } catch (_) {
      throw new Error(`接口返回错误（HTTP ${resp.status}）`);
    }
    const detail = typeof body?.error === 'string'
      ? body.error
      : body?.error?.message || body?.message || `接口返回错误（HTTP ${resp.status}）`;
    throw new Error(detail);
  }
  return resp;
}

export async function apiStreamChat(payload, onEvent, options = {}) {
  let resp;
  try {
    resp = await fetch(BACKEND_BASE_URL + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: options.signal,
    });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    throw new Error(describeNetworkError(err, BACKEND_BASE_URL + '/api/chat'));
  }

  if (!resp.ok) {
    let body = null;
    try {
      body = await resp.json();
    } catch (_) {
      throw new Error(`聊天接口异常（HTTP ${resp.status}）`);
    }
    const detail = typeof body?.error === 'string'
      ? body.error
      : body?.error?.message || body?.message || `聊天接口异常（HTTP ${resp.status}）`;
    throw new Error(detail);
  }

  const reader = resp.body?.getReader();
  if (!reader) throw new Error('聊天接口未返回可读流');
  const decoder = new TextDecoder();
  let buffer = '';
  let streamMeta = {};
  let reachedTerminalEvent = false;
  let pendingDeltaText = '';
  let pendingDeltaPayload = null;
  let deltaFlushTimer = null;

  const flushPendingDelta = () => {
    if (!pendingDeltaText) return;
    const payload = normalizeChatEnvelope(
      { ...(pendingDeltaPayload || {}), text: pendingDeltaText },
      streamMeta,
    );
    pendingDeltaText = '';
    pendingDeltaPayload = null;
    if (deltaFlushTimer !== null) {
      window.clearTimeout(deltaFlushTimer);
      deltaFlushTimer = null;
    }
    onEvent?.('delta', payload);
  };

  const schedulePendingDeltaFlush = () => {
    if (deltaFlushTimer !== null) return;
    deltaFlushTimer = window.setTimeout(() => {
      deltaFlushTimer = null;
      flushPendingDelta();
    }, 24);
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
    let idx = buffer.indexOf('\n\n');
    while (idx >= 0) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      idx = buffer.indexOf('\n\n');
      if (!chunk.trim()) continue;
      let eventName = 'message';
      const dataLines = [];
      chunk.split('\n').forEach((line) => {
        if (line.startsWith('event:')) eventName = line.slice(6).trim();
        if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
      });
      let data = {};
      try {
        data = dataLines.length ? JSON.parse(dataLines.join('\n')) : {};
      } catch (_) {
        data = {};
      }
      const normalized = normalizeChatEnvelope(data, streamMeta);
      if (eventName === 'start') {
        streamMeta = {
          model: normalized.model,
          provider: normalized.provider,
          worker: normalized.debug.worker,
          conversation_id: normalized.debug.conversation_id,
        };
      }
      if (eventName === 'delta') {
        pendingDeltaText += normalized.text || '';
        pendingDeltaPayload = normalized;
        schedulePendingDeltaFlush();
        continue;
      }
      flushPendingDelta();
      onEvent?.(eventName, normalized);
      if (eventName === 'done' || eventName === 'error') {
        reachedTerminalEvent = true;
        break;
      }
    }
    if (reachedTerminalEvent) {
      flushPendingDelta();
      try {
        await reader.cancel();
      } catch (_) {}
      break;
    }
  }
}

// ── Settings ──────────────────────────────────────────────────

export function apiGetSettings() {
  return fetchJsonOrThrow(BACKEND_BASE_URL + '/api/settings', { timeout_ms: 8000 });
}
export function apiGetSecurityPolicy() {
  return fetchJsonOrThrow(BACKEND_BASE_URL + '/api/security-policy');
}
export function apiSaveSettings(settings) {
  return fetchJsonOrThrow(BACKEND_BASE_URL + '/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
}
export function apiGetAvailableModels(providerRef) {
  const body = (providerRef && typeof providerRef === 'object')
    ? providerRef
    : (providerRef === 'tts' ? { target: 'tts' } : { providerId: providerRef });
  return fetchJsonOrThrow(BACKEND_BASE_URL + '/api/available-models', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
export function apiGetOsGuard() {
  return fetchJsonOrThrow(BACKEND_BASE_URL + '/api/os-guard');
}
export function apiSaveOsGuard(payload) {
  return fetchJsonOrThrow(BACKEND_BASE_URL + '/api/os-guard', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

// ── Conversations ─────────────────────────────────────────────

export function apiGetConversations() {
  return fetchJsonOrThrow(BACKEND_BASE_URL + '/api/conversations');
}
export function apiGetConversationIndex() {
  return fetchJsonOrThrow(BACKEND_BASE_URL + '/api/conversations/index', { timeout_ms: 8000 });
}
export function apiGetConversationShards() {
  return fetchJsonOrThrow(BACKEND_BASE_URL + '/api/conversations/shards');
}
export function apiGetConversation(convId) {
  return fetchJsonOrThrow(`${BACKEND_BASE_URL}/api/conversations/${encodeURIComponent(convId)}`);
}
export function apiSaveConversations(conversations, settings) {
  return fetchJsonOrThrow(BACKEND_BASE_URL + '/api/conversations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    timeout_ms: 8000,
    body: JSON.stringify({ conversations, settings }),
  });
}
export function apiDeleteConversation(convId, purgeArchive = false) {
  return fetchJsonOrThrow(
    `${BACKEND_BASE_URL}/api/conversations/${encodeURIComponent(convId)}?purge_archive=${purgeArchive}`,
    { method: 'DELETE' }
  );
}
export function apiArchiveConversation(convId) {
  return fetchJsonOrThrow(BACKEND_BASE_URL + '/api/archive', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conversation_ids: [convId] }),
  });
}
export async function apiHasArchiveSession(convId) {
  let resp;
  try {
    resp = await fetch(`${BACKEND_BASE_URL}/api/archive-works/${encodeURIComponent(convId)}`);
  } catch (_) {
    return false;
  }
  return resp.ok;
}
export function apiImportNormalizedConversation(path, overwrite = false) {
  return fetchJsonOrThrow(BACKEND_BASE_URL + '/api/conversations/import-normalized', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, overwrite }),
  });
}
export function apiImportNormalizedConversationPayload(payload, overwrite = false) {
  return fetchJsonOrThrow(BACKEND_BASE_URL + '/api/conversations/import-normalized', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ payload, overwrite }),
  });
}
export function apiImportNormalizedConversationPayloads(payloads, overwrite = false) {
  return fetchJsonOrThrow(BACKEND_BASE_URL + '/api/conversations/import-normalized', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ payloads, overwrite }),
  });
}
export function apiGetPartnerFrames() {
  return fetchJsonOrThrow(`${BACKEND_BASE_URL}/api/settings/partner-frames`);
}
export function apiSavePartnerFrames(partnerFrames) {
  return fetchJsonOrThrow(`${BACKEND_BASE_URL}/api/settings/partner-frames`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(partnerFrames),
  });
}
export function apiGetPartnerMidMemory() {
  return fetchJsonOrThrow(`${BACKEND_BASE_URL}/api/settings/partner-mid-memory`);
}
export function apiSavePartnerMidMemory(partnerMidMemory) {
  return fetchJsonOrThrow(`${BACKEND_BASE_URL}/api/settings/partner-mid-memory`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(partnerMidMemory),
  });
}

// ── Folders ───────────────────────────────────────────────────

export function apiGetFolders(scope = 'now') {
  return fetchJsonOrThrow(`${BACKEND_BASE_URL}/api/folders?scope=${encodeURIComponent(scope)}`, { timeout_ms: 8000 });
}
export function apiCreateFolder(name, parentId = null, scope = 'now') {
  return fetchJsonOrThrow(BACKEND_BASE_URL + '/api/folders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, parent_id: parentId, scope }),
  });
}
export function apiRenameFolder(folderId, name) {
  return fetchJsonOrThrow(`${BACKEND_BASE_URL}/api/folders/${folderId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
}
export function apiDeleteFolder(folderId) {
  return fetchJsonOrThrow(`${BACKEND_BASE_URL}/api/folders/${folderId}`, { method: 'DELETE' });
}
export function apiAddConvToFolder(folderId, convId) {
  return fetchJsonOrThrow(`${BACKEND_BASE_URL}/api/folders/${folderId}/convs/${encodeURIComponent(convId)}`, {
    method: 'POST',
  });
}
export function apiRemoveConvFromFolder(folderId, convId) {
  return fetchJsonOrThrow(`${BACKEND_BASE_URL}/api/folders/${folderId}/convs/${encodeURIComponent(convId)}`, {
    method: 'DELETE',
  });
}
export function apiMoveFolder(folderId, newParentId, beforeFolderId) {
  return fetchJsonOrThrow(`${BACKEND_BASE_URL}/api/folders/${folderId}/move`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ new_parent_id: newParentId, before_folder_id: beforeFolderId }),
  });
}
export function apiReorderFolderConvs(folderId, convIds) {
  return fetchJsonOrThrow(`${BACKEND_BASE_URL}/api/folders/${folderId}/reorder-convs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conv_ids: convIds }),
  });
}

// ── Notes ─────────────────────────────────────────────────────

export function apiListNotes() {
  return fetchJsonOrThrow(BACKEND_BASE_URL + '/api/notes');
}
export function apiUpdateNote(convId, updates) {
  return fetchJsonOrThrow(BACKEND_BASE_URL + '/api/notes/' + encodeURIComponent(convId), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
}
export function apiDeleteNote(convId) {
  return fetchJsonOrThrow(BACKEND_BASE_URL + '/api/notes/' + encodeURIComponent(convId), {
    method: 'DELETE',
  });
}
// ── Archive ───────────────────────────────────────────────────

export function apiGetArchiveIndex() {
  return fetchJsonOrThrow(BACKEND_BASE_URL + '/api/archive/index');
}
export function apiGetArchiveEntries(convId) {
  return fetchJsonOrThrow(`${BACKEND_BASE_URL}/api/archive-entries/${encodeURIComponent(convId)}`);
}
export function apiSaveArchiveEntry(convId, recordId, data) {
  return fetchJsonOrThrow(
    `${BACKEND_BASE_URL}/api/archive-entries/${encodeURIComponent(convId)}/${encodeURIComponent(recordId)}`,
    { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }
  );
}
export function apiDeleteArchiveEntry(convId, recordId) {
  return fetchJsonOrThrow(
    `${BACKEND_BASE_URL}/api/archive-entries/${encodeURIComponent(convId)}/${encodeURIComponent(recordId)}`,
    { method: 'DELETE' }
  );
}
export function apiGenerateArchiveEntry(convId, pairs, field = null) {
  return fetchJsonOrThrow(BACKEND_BASE_URL + '/api/archive-entries/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conv_id: convId, pairs, field }),
  });
}
export function apiCreateArchiveEntry(data) {
  return fetchJsonOrThrow(BACKEND_BASE_URL + '/api/archive-entries', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}
export function apiCreateManualArchiveEntry(data) {
  return fetchJsonOrThrow(BACKEND_BASE_URL + '/api/archive-entries/manual', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}
export function apiArchiveConversations(convIds) {
  return fetchJsonOrThrow(BACKEND_BASE_URL + '/api/archive', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conversation_ids: convIds }),
  });
}

export function apiGetArchiveAnalysis(convId) {
  return fetchJsonOrThrow(`${BACKEND_BASE_URL}/api/archive-analysis/${encodeURIComponent(convId)}`);
}
export function apiGetArchiveScribeSummary(convId) {
  return fetchJsonOrThrow(`${BACKEND_BASE_URL}/api/archive-analysis/${encodeURIComponent(convId)}/scribe`);
}
export function apiGenerateArchiveAnalysis(convId, recordIds) {
  return fetchJsonOrThrow(BACKEND_BASE_URL + '/api/archive-analysis/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conv_id: convId, record_ids: recordIds }),
  }).then((data) => withTaskEnvelope(data));
}
export function apiGenerateArchivePeriods(convId) {
  return fetchJsonOrThrow(BACKEND_BASE_URL + '/api/archive-analysis/generate-periods', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conv_id: convId }),
  }).then((data) => withTaskEnvelope(data));
}
export function apiSaveManualArchivePeriods(convId, ranges) {
  return fetchJsonOrThrow(BACKEND_BASE_URL + '/api/archive-analysis/manual-periods', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conv_id: convId, ranges }),
  });
}
export function apiSummarizeArchivePeriod(convId, periodId) {
  return fetchJsonOrThrow(BACKEND_BASE_URL + '/api/archive-analysis/summarize-period', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conv_id: convId, period_id: periodId }),
  }).then((data) => withTaskEnvelope(data));
}
export function apiClearArchivePeriodSummary(convId, periodId) {
  return fetchJsonOrThrow(BACKEND_BASE_URL + '/api/archive-analysis/clear-period-summary', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conv_id: convId, period_id: periodId }),
  });
}
export function apiReviseArchivePhrases(convId, periodIds) {
  return fetchJsonOrThrow(BACKEND_BASE_URL + '/api/archive-analysis/revise-phrases', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conv_id: convId, period_ids: periodIds }),
  }).then((data) => withTaskEnvelope(data));
}
export function apiGenerateArchiveMovement(convId) {
  return fetchJsonOrThrow(BACKEND_BASE_URL + '/api/archive-analysis/generate-movement', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conv_id: convId }),
  }).then((data) => withTaskEnvelope(data));
}
export function apiGenerateArchiveAlchemySpell(convId) {
  return fetchJsonOrThrow(BACKEND_BASE_URL + '/api/archive-analysis/generate-alchemy-spell', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conv_id: convId }),
  }).then((data) => withTaskEnvelope(data));
}
export function apiPromoteArchiveAlchemySpell(convId) {
  return fetchJsonOrThrow(BACKEND_BASE_URL + '/api/archive-analysis/promote-alchemy-spell', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conv_id: convId }),
  });
}
export function apiPromoteArchiveMovement(convId) {
  return fetchJsonOrThrow(BACKEND_BASE_URL + '/api/archive-analysis/promote-movement', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conv_id: convId }),
  });
}
export function apiPatchArchiveAnalysis(convId, recordId, updates) {
  return fetchJsonOrThrow(`${BACKEND_BASE_URL}/api/archive-analysis/${encodeURIComponent(convId)}/${encodeURIComponent(recordId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
}
export function apiDeleteArchiveAnalysis(convId, recordId) {
  return fetchJsonOrThrow(`${BACKEND_BASE_URL}/api/archive-analysis/${encodeURIComponent(convId)}/${encodeURIComponent(recordId)}`, {
    method: 'DELETE',
  });
}


export function apiGetArchiveWorks() {
  return fetchJsonOrThrow(BACKEND_BASE_URL + '/api/archive-works');
}

export function apiGetArchiveWork(convId) {
  return fetchJsonOrThrow(`${BACKEND_BASE_URL}/api/archive-works/${encodeURIComponent(convId)}`);
}

export function apiLookupTtsAudio(text) {
  return fetchJsonOrThrow(`${BACKEND_BASE_URL}/api/tts/audio-lookup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
}

export async function apiSynthesizeTts(text) {
  const resp = await fetchResponseOrThrow(`${BACKEND_BASE_URL}/api/tts/synthesize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  const audioFile = resp.headers.get('X-TTS-Audio-File') || '';
  const audioUrl = resp.headers.get('X-TTS-Audio-Url') || '';
  if (audioUrl) {
    return {
      audioUrl: `${BACKEND_BASE_URL}${audioUrl}`,
      audioFile,
    };
  }
  const blob = await resp.blob();
  return {
    blob,
    audioFile,
  };
}

export async function apiCheckHealth(baseUrl = BACKEND_BASE_URL) {
  const timeoutMs = 4000;
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(new DOMException('timeout', 'AbortError')), timeoutMs);
  let resp;
  try {
    resp = await fetch(`${baseUrl}/api/health`, { signal: controller.signal });
  } catch (err) {
    if (err?.name === 'AbortError') throw new Error(`请求超时（>${timeoutMs}ms）`);
    throw new Error(describeNetworkError(err, `${baseUrl}/api/health`));
  } finally {
    window.clearTimeout(timeoutId);
  }
  let body;
  try {
    body = await resp.json();
  } catch (_) {
    throw new Error(`接口返回非 JSON 响应（HTTP ${resp.status}）`);
  }
  if (!resp.ok || !body?.ok) {
    const detail = typeof body?.error === 'string'
      ? body.error
      : body?.error?.message || body?.message || `接口返回错误（HTTP ${resp.status}）`;
    throw new Error(detail);
  }
  return body;
}

// ── Memory ────────────────────────────────────────────────────

export function apiGetGlobalMemories(term) {
  const url = term
    ? `${BACKEND_BASE_URL}/api/memories/global?term=${encodeURIComponent(term)}`
    : `${BACKEND_BASE_URL}/api/memories/global`;
  return fetchJsonOrThrow(url);
}
export function apiGetHearthPartnerContext(sessionId) {
  const url = sessionId
    ? `${BACKEND_BASE_URL}/api/hearth/partner/context?session_id=${encodeURIComponent(sessionId)}`
    : `${BACKEND_BASE_URL}/api/hearth/partner/context`;
  return fetchJsonOrThrow(url);
}
export function apiGetHearthLatestPromptBuild(sessionId) {
  const url = sessionId
    ? `${BACKEND_BASE_URL}/api/hearth/partner/latest-prompt-build?session_id=${encodeURIComponent(sessionId)}`
    : `${BACKEND_BASE_URL}/api/hearth/partner/latest-prompt-build`;
  return fetchJsonOrThrow(url);
}
export function apiGetHearthScribeDetail(sessionId) {
  const url = sessionId
    ? `${BACKEND_BASE_URL}/api/hearth/partner/scribe-detail?session_id=${encodeURIComponent(sessionId)}`
    : `${BACKEND_BASE_URL}/api/hearth/partner/scribe-detail`;
  return fetchJsonOrThrow(url);
}
export function apiGetHearthAssistantLedger() {
  return fetchJsonOrThrow(`${BACKEND_BASE_URL}/api/hearth/partner/assistant-ledger`);
}
export function apiAddGlobalMemory(content, tags, echoesPartition) {
  return fetchJsonOrThrow(BACKEND_BASE_URL + '/api/memories/global', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, tags, echoesPartition }),
  });
}
export function apiUpdateGlobalMemory(id, updates) {
  return fetchJsonOrThrow(`${BACKEND_BASE_URL}/api/memories/global/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
}
export function apiDeleteGlobalMemory(id) {
  return fetchJsonOrThrow(`${BACKEND_BASE_URL}/api/memories/global/${id}`, { method: 'DELETE' });
}
export function apiRestoreMemories(memories) {
  return fetchJsonOrThrow(`${BACKEND_BASE_URL}/api/memories`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(memories),
  });
}
export function apiMergeGlobalMemories(memoryIds, mode = 'merge') {
  return fetchJsonOrThrow(`${BACKEND_BASE_URL}/api/memories/merge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ memory_ids: memoryIds, mode }),
  });
}
export function apiGetCandidates(limit = 0) {
  return fetchJsonOrThrow(`${BACKEND_BASE_URL}/api/memories/candidates?limit=${limit}`);
}
export function apiPromoteCandidate(candidateId, term) {
  return fetchJsonOrThrow(BACKEND_BASE_URL + '/api/memories/promote', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ candidate_id: candidateId, term }),
  });
}
export function apiRejectCandidate(candidateId, reason = '') {
  return fetchJsonOrThrow(BACKEND_BASE_URL + '/api/memories/reject', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ candidate_id: candidateId, reason }),
  });
}
export function apiPromoteAllReady() {
  return fetchJsonOrThrow(BACKEND_BASE_URL + '/api/memories/promote-all-ready', { method: 'POST' });
}
export function apiPurgeRejected() {
  return fetchJsonOrThrow(BACKEND_BASE_URL + '/api/memories/purge-rejected', { method: 'POST' });
}
export function apiAutoMemorize(convId, summary, title) {
  return fetchJsonOrThrow(BACKEND_BASE_URL + '/api/auto-memorize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conversation_id: convId, summary, conversation_title: title }),
  });
}

// ── Chat / Title / Summary ────────────────────────────────────

export function apiGetTitle(messages) {
  return fetchJsonOrThrow(BACKEND_BASE_URL + '/api/title', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages }),
  }).then((data) => ({
    ...withTaskEnvelope(data),
    title: String(data?.title ?? data?.text ?? ''),
  }));
}

export function apiReaderFull(convId, title, messages) {
  return fetchJsonOrThrow(BACKEND_BASE_URL + '/api/reader/full', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conv_id: convId, title, messages }),
  }).then((data) => ({
    ...withTaskEnvelope(data),
    summary: String(data?.summary ?? data?.text ?? ''),
    title: String(data?.title ?? title ?? ''),
  }));
}
