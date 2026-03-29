// api.js — 统一后端请求层
// 所有模块通过此文件访问后端，禁止在功能模块内直接调用 fetch。

import { BACKEND_BASE_URL } from './state.js';

// ── 核心 HTTP 工具 ────────────────────────────────────────────

export async function fetchJsonOrThrow(url, options = {}) {
  let resp;
  try {
    resp = await fetch(url, options);
  } catch (_) {
    throw new Error('后端未启动或网络不可达（Failed to fetch ' + url + '）');
  }
  let body;
  try {
    body = await resp.json();
  } catch (_) {
    throw new Error('接口返回非 JSON 响应（HTTP ' + resp.status + '）');
  }
  if (!body.ok) {
    throw new Error(body.error || '接口返回错误（HTTP ' + resp.status + '）');
  }
  return body.data;
}

// ── Settings ──────────────────────────────────────────────────

export function apiGetSettings() {
  return fetchJsonOrThrow(BACKEND_BASE_URL + '/api/settings');
}
export function apiSaveSettings(settings) {
  return fetchJsonOrThrow(BACKEND_BASE_URL + '/api/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
}
export function apiGetAvailableModels(providerId) {
  return fetchJsonOrThrow(BACKEND_BASE_URL + '/api/available-models', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider_id: providerId }),
  });
}

// ── Conversations ─────────────────────────────────────────────

export function apiGetConversations() {
  return fetchJsonOrThrow(BACKEND_BASE_URL + '/api/conversations');
}
export function apiSaveConversations(conversations, settings) {
  return fetchJsonOrThrow(BACKEND_BASE_URL + '/api/conversations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conversations, settings }),
  });
}
export function apiDeleteConversation(convId, purgeArchive = false) {
  return fetchJsonOrThrow(
    `${BACKEND_BASE_URL}/api/conversations/${encodeURIComponent(convId)}?purge_archive=${purgeArchive}`,
    { method: 'DELETE' }
  );
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

// ── Folders ───────────────────────────────────────────────────

export function apiGetFolders() {
  return fetchJsonOrThrow(BACKEND_BASE_URL + '/api/folders');
}
export function apiCreateFolder(name, parentId = null) {
  return fetchJsonOrThrow(BACKEND_BASE_URL + '/api/folders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, parent_id: parentId }),
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
export function apiGenerateNote(convId, title, messages, settings) {
  return fetchJsonOrThrow(BACKEND_BASE_URL + '/api/reader/selection', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conv_id: convId, title, messages, settings }),
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
export function apiGenerateArchiveEntry(convId, messages, settings, fields) {
  return fetchJsonOrThrow(BACKEND_BASE_URL + '/api/archive-entries/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conv_id: convId, messages, settings, fields }),
  });
}
export function apiCreateArchiveEntry(data) {
  return fetchJsonOrThrow(BACKEND_BASE_URL + '/api/archive-entries', {
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
export function apiGenerateArchiveAnalysis(convId, recordIds, settings) {
  return fetchJsonOrThrow(BACKEND_BASE_URL + '/api/archive-analysis/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conv_id: convId, record_ids: recordIds, settings }),
  });
}
export function apiGenerateArchivePeriods(convId, settings) {
  return fetchJsonOrThrow(BACKEND_BASE_URL + '/api/archive-analysis/generate-periods', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conv_id: convId, settings }),
  });
}
export function apiSaveManualArchivePeriods(convId, ranges, settings) {
  return fetchJsonOrThrow(BACKEND_BASE_URL + '/api/archive-analysis/manual-periods', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conv_id: convId, ranges, settings }),
  });
}
export function apiSummarizeArchivePeriod(convId, periodId, settings) {
  return fetchJsonOrThrow(BACKEND_BASE_URL + '/api/archive-analysis/summarize-period', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conv_id: convId, period_id: periodId, settings }),
  });
}
export function apiClearArchivePeriodSummary(convId, periodId) {
  return fetchJsonOrThrow(BACKEND_BASE_URL + '/api/archive-analysis/clear-period-summary', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conv_id: convId, period_id: periodId }),
  });
}
export function apiReviseArchivePhrases(convId, periodIds, settings) {
  return fetchJsonOrThrow(BACKEND_BASE_URL + '/api/archive-analysis/revise-phrases', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conv_id: convId, period_ids: periodIds, settings }),
  });
}
export function apiGenerateArchiveMovement(convId, settings) {
  return fetchJsonOrThrow(BACKEND_BASE_URL + '/api/archive-analysis/generate-movement', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conv_id: convId, settings }),
  });
}
export function apiGenerateArchiveAlchemySpell(convId, settings) {
  return fetchJsonOrThrow(BACKEND_BASE_URL + '/api/archive-analysis/generate-alchemy-spell', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ conv_id: convId, settings }),
  });
}
export function apiPromoteArchiveAlchemySpell(convId) {
  return fetchJsonOrThrow(BACKEND_BASE_URL + '/api/archive-analysis/promote-alchemy-spell', {
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

export function apiGetTitle(messages, settings) {
  return fetchJsonOrThrow(BACKEND_BASE_URL + '/api/title', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, settings }),
  });
}
