// utils.js — 纯工具函数，无 DOM 依赖，无状态依赖
// 格式化、转义、数据处理等通用小函数。

// ── 时间格式化 ────────────────────────────────────────────────

/** 完整日期时间：YYYY-MM-DD HH:mm:ss */
export function formatDateTime(ts) {
  const d = new Date(ts);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** 短时间：M/DD HH:mm（用于记忆库条目） */
export function formatTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ── 字符串工具 ────────────────────────────────────────────────

/** HTML 转义 */
export function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 截断字符串，超出则加省略号 */
export function truncate(str, maxLen) {
  if (!str) return '';
  return str.length > maxLen ? str.slice(0, maxLen) + '…' : str;
}

export function isLocalHost(host = '') {
  const text = String(host || '').trim().toLowerCase();
  return text === 'localhost' || text === '127.0.0.1' || text === '0.0.0.0' || text === '::1';
}

export function getChatRouteMeta(settings = {}) {
  const providers = settings?.providers || {};
  const chatTask = settings?.taskModels?.chat || {};
  const providerId = String(chatTask.provider || '').trim();
  const modelName = String(chatTask.modelName || '').trim();
  const provider = providers[providerId] || {};
  const providerName = String(provider.name || providerId || '').trim();
  const baseUrl = String(provider.apiBaseUrl || '').trim();
  let host = '';
  try {
    host = new URL(baseUrl).hostname || '';
  } catch {
    host = '';
  }
  const isCloud = !!(baseUrl && host && !isLocalHost(host));
  return {
    providerId,
    providerName,
    modelName,
    baseUrl,
    host,
    isCloud,
    label: isCloud ? `云端 · ${providerName || host || 'Remote'}` : '本地 / 自管',
  };
}

function getCloudNoticeStorageKey(route = {}) {
  const providerKey = String(route.providerId || route.providerName || route.baseUrl || route.host || '').trim();
  return providerKey ? `start-cloud-route-notice:${providerKey}` : '';
}

export function hasAcknowledgedCloudRoute(route = {}, cache = null) {
  const key = getCloudNoticeStorageKey(route);
  if (!key) return false;
  if (cache?.has?.(key)) return true;
  try {
    return window.sessionStorage?.getItem(key) === '1';
  } catch {
    return false;
  }
}

export function markCloudRouteAcknowledged(route = {}, cache = null) {
  const key = getCloudNoticeStorageKey(route);
  if (!key) return;
  cache?.add?.(key);
  try {
    window.sessionStorage?.setItem(key, '1');
  } catch {}
}
