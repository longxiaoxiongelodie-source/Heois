export function createMobileInputDockController(deps) {
  const {
    apiStreamChat,
    state,
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
  } = deps;
  let dockResizeObserver = null;
  let shellHeightPx = 0;
  const ASSISTANT_LABEL = '助手';
  const MAX_TEXT_FILE_CHARS = 120000;
  const MAX_IMAGE_FILE_BYTES = 5 * 1024 * 1024;
  const ACCEPTED_TEXT_EXTENSIONS = new Set(['md', 'txt']);
  const ACCEPTED_IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp']);

  function getInput() {
    return document.getElementById('mobile-user-input');
  }

  function getDock() {
    return document.getElementById('mobile-input-dock');
  }

  function getAttachmentInput() {
    return document.getElementById('mobile-attachment-input');
  }

  function getAttachmentTray() {
    return document.getElementById('mobile-attachment-tray');
  }

  function setRootVar(name, value) {
    document.documentElement?.style?.setProperty(name, value);
  }

  function measureShellHeight() {
    return Math.max(
      window.innerHeight || 0,
      document.documentElement?.clientHeight || 0,
      document.body?.clientHeight || 0,
    );
  }

  function syncShellHeight(force = false) {
    const nextHeight = Math.max(0, Math.round(measureShellHeight()));
    if (!nextHeight) return;
    if (!force && document.body?.classList.contains('keyboard-open')) return;
    if (!force && shellHeightPx && Math.abs(nextHeight - shellHeightPx) < 4) return;
    shellHeightPx = nextHeight;
    setRootVar('--mobile-shell-height', `${nextHeight}px`);
  }

  function syncDockMetrics() {
    const dock = getDock();
    if (!dock) return;
    const height = Math.max(0, Math.round(dock.getBoundingClientRect().height || dock.offsetHeight || 0));
    setRootVar('--mobile-dock-height', `${height}px`);
  }

  function autosizeInput() {
    const input = getInput();
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
    syncDockMetrics();
  }

  function syncViewport() {
    const root = document.documentElement;
    const body = document.body;
    const viewport = window.visualViewport;
    if (!root || !viewport) {
      setRootVar('--mobile-kb-offset', '0px');
      body?.classList.remove('keyboard-open');
      syncShellHeight();
      syncDockMetrics();
      return;
    }
    const keyboardOffset = Math.max(
      0,
      Math.round((window.innerHeight || 0) - (viewport.height + viewport.offsetTop)),
    );
    const keyboardOpen = keyboardOffset > 24;
    setRootVar('--mobile-kb-offset', `${keyboardOpen ? keyboardOffset : 0}px`);
    body?.classList.toggle('keyboard-open', keyboardOpen);
    if (!keyboardOpen) syncShellHeight();
    syncDockMetrics();
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

  function formatBytes(bytes = 0) {
    const value = Number(bytes || 0);
    if (value < 1024) return `${value} B`;
    if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }

  function getExt(name = '') {
    const text = String(name || '');
    const idx = text.lastIndexOf('.');
    return idx >= 0 ? text.slice(idx + 1).toLowerCase() : '';
  }

  function readAsText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error(`读取文件失败：${file.name}`));
      reader.readAsText(file, 'utf-8');
    });
  }

  function readAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error(`读取图片失败：${file.name}`));
      reader.readAsDataURL(file);
    });
  }

  async function fileToAttachment(file) {
    const mimeType = String(file?.type || '').trim();
    const ext = getExt(file?.name || '');
    if (mimeType.startsWith('image/') || ACCEPTED_IMAGE_EXTENSIONS.has(ext)) {
      if (file.size > MAX_IMAGE_FILE_BYTES) {
        throw new Error(`图片过大：${file.name}，请控制在 ${formatBytes(MAX_IMAGE_FILE_BYTES)} 内`);
      }
      return {
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        kind: 'image',
        name: file.name,
        mime_type: mimeType || 'image/*',
        size: file.size,
        data_url: await readAsDataUrl(file),
      };
    }
    if (ACCEPTED_TEXT_EXTENSIONS.has(ext)) {
      const text = await readAsText(file);
      if (text.length > MAX_TEXT_FILE_CHARS) {
        throw new Error(`文本过长：${file.name}，请控制在 ${MAX_TEXT_FILE_CHARS} 字以内`);
      }
      return {
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        kind: 'text_file',
        name: file.name,
        mime_type: mimeType || 'text/plain',
        size: file.size,
        text,
      };
    }
    throw new Error(`暂不支持该文件类型：${file.name}`);
  }

  function attachmentLabel(item) {
    return item.kind === 'image' ? `图片 · ${item.name}` : `文本 · ${item.name}`;
  }

  function renderPendingAttachments() {
    const tray = getAttachmentTray();
    if (!tray) return;
    const items = Array.isArray(state._pendingChatAttachments) ? state._pendingChatAttachments : [];
    tray.innerHTML = '';
    tray.classList.toggle('hidden', items.length === 0);
    items.forEach((item) => {
      const chip = document.createElement('div');
      chip.className = 'mobile-attachment-chip';
      chip.innerHTML =
        `<div class="mobile-attachment-chip-main">` +
          `<span class="mobile-attachment-chip-label">${escHtml(attachmentLabel(item))}</span>` +
          `<span class="mobile-attachment-chip-meta">${escHtml(formatBytes(item.size || 0))}</span>` +
        `</div>` +
        `<button type="button" class="mobile-attachment-chip-remove" data-mobile-attachment-remove="${escHtml(item.id || '')}">×</button>`;
      tray.appendChild(chip);
    });
    syncDockMetrics();
  }

  function openAttachmentPicker() {
    document.getElementById('mobile-extra-menu')?.classList.add('hidden');
    getAttachmentInput()?.click();
  }

  async function handleAttachmentFiles(event) {
    const input = event?.target;
    const files = Array.from(input?.files || []);
    if (files.length === 0) return;
    try {
      const next = [...(state._pendingChatAttachments || [])];
      for (const file of files) {
        next.push(await fileToAttachment(file));
      }
      state._pendingChatAttachments = next;
      renderPendingAttachments();
    } catch (err) {
      showToast(err?.message || '附件读取失败');
    } finally {
      if (input) input.value = '';
    }
  }

  function removePendingAttachment(id) {
    state._pendingChatAttachments = (state._pendingChatAttachments || []).filter((item) => item.id !== id);
    renderPendingAttachments();
  }

  function summarizePendingAttachments() {
    const items = Array.isArray(state._pendingChatAttachments) ? state._pendingChatAttachments : [];
    if (items.length === 0) return '';
    return `已附加：${items.map((item) => item.name).filter(Boolean).join('，')}`;
  }

  function consumePendingAttachments() {
    const items = Array.isArray(state._pendingChatAttachments) ? [...state._pendingChatAttachments] : [];
    state._pendingChatAttachments = [];
    renderPendingAttachments();
    return items.map((item) => {
      if (item.kind === 'image') {
        return {
          kind: 'image',
          name: item.name,
          mime_type: item.mime_type,
          data_url: item.data_url,
        };
      }
      return {
        kind: 'text_file',
        name: item.name,
        mime_type: item.mime_type,
        text: item.text,
      };
    });
  }

  function enterSendingMode() {
    const btn = document.getElementById('mobile-send-btn');
    if (!btn) return;
    btn.textContent = '停止';
    btn.onclick = (event) => {
      event.preventDefault();
      stopGeneration();
    };
  }

  function exitSendingMode() {
    const btn = document.getElementById('mobile-send-btn');
    if (!btn) return;
    btn.textContent = '发送';
    btn.onclick = null;
  }

  function stopGeneration() {
    if (state.activeWs && typeof state.activeWs.abort === 'function') {
      state.activeWs.abort();
    }
  }

  function buildRequestMessages(conv) {
    const contextLimit = state.settings?.contextLimit || 20;
    return conv.messages.slice(-contextLimit).map(msg => ({ role: msg.role, content: msg.content }));
  }

  function appendStreamingBubble() {
    const wrap = document.getElementById('mobile-messages');
    const item = document.createElement('article');
    item.className = 'mobile-message assistant';
    item.dataset.messageIndex = String((getCurrentConversation()?.messages.length || 0));

    const meta = document.createElement('div');
    meta.className = 'mobile-message-meta';
    meta.textContent = ASSISTANT_LABEL;

    const bubble = document.createElement('div');
    bubble.className = 'mobile-message-bubble';
    bubble.innerHTML = '<p></p>';
    const p = bubble.querySelector('p');

    item.append(meta, bubble);
    wrap?.appendChild(item);
    if (wrap) wrap.scrollTop = wrap.scrollHeight;
    updateScrollBottomButton();
    return { item, bubble, p, meta };
  }

  function getStreamingDisplay(text) {
    let visible = String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, '');
    const openIdx = visible.search(/<think>/i);
    if (openIdx !== -1) visible = visible.slice(0, openIdx);
    return visible.trim();
  }

  function renderStreamingContent(target, text) {
    target.p.textContent = getStreamingDisplay(text);
  }

  function createStreamingRenderer(target) {
    let latestText = '';
    let frameId = null;
    const scheduleFrame = () => {
      if (frameId !== null) return;
      const raf = window.requestAnimationFrame || ((cb) => window.setTimeout(cb, 16));
      frameId = raf(() => {
        frameId = null;
        renderStreamingContent(target, latestText);
        scrollMessagesToBottom(false);
        updateScrollBottomButton();
      });
    };
    return {
      update(text) {
        latestText = text;
        scheduleFrame();
      },
      flush(text = latestText) {
        latestText = text;
        if (frameId !== null) {
          const cancel = window.cancelAnimationFrame || window.clearTimeout;
          cancel(frameId);
          frameId = null;
        }
        renderStreamingContent(target, latestText);
        scrollMessagesToBottom(false);
        updateScrollBottomButton();
      },
    };
  }

  async function callBackendChat(requestMessages, onDelta, conversationId, attachments = [], onStart = null) {
    const controller = new AbortController();
    state.activeWs = controller;
    const result = {
      usage: null,
      cancelled: false,
      saved_memories: [],
      saved_session_memories: [],
      scribe: { updated: false, pair_count: 0 },
      prompt_snapshot: null,
      model: '',
    };
    try {
      await apiStreamChat({
        worker: 'partner',
        messages: requestMessages,
        attachments,
        stream: true,
        conversation_id: conversationId || '',
      }, (eventName, payload) => {
        if (eventName === 'start') {
          result.model = String(payload.model || result.model || '');
          onStart?.(payload);
          return;
        }
        if (eventName === 'delta') {
          onDelta(payload.text || '');
          return;
        }
        if (eventName === 'usage') {
          result.usage = payload.usage || null;
          return;
        }
        if (eventName === 'done') {
          state._lastPromptSnapshot = payload.debug?.trace?.prompt_snapshot || null;
          import('./settings.js')
            .then(mod => mod.populateDebugSection?.())
            .catch(() => {});
          result.usage = payload.usage || result.usage;
          result.saved_memories = payload.debug?.effects?.saved_memories || [];
          result.saved_session_memories = payload.debug?.effects?.saved_session_memories || [];
          result.scribe = payload.debug?.effects?.scribe || result.scribe;
          result.prompt_snapshot = payload.debug?.trace?.prompt_snapshot || null;
          result.model = String(payload.model || result.model || '');
          return;
        }
        if (eventName === 'error') {
          throw new Error(payload.error?.message || '未知错误');
        }
      }, { signal: controller.signal });
      return result;
    } catch (err) {
      if (err?.name === 'AbortError') return { ...result, cancelled: true };
      throw err;
    } finally {
      state.activeWs = null;
    }
  }

  async function performChat(conv, options = {}) {
    enterSendingMode();
    const stream = appendStreamingBubble();
    const streamRenderer = createStreamingRenderer(stream);
    const requestMessages = buildRequestMessages(conv);
    const userContentOverride = typeof options.userContentOverride === 'string'
      ? options.userContentOverride
      : null;
    if (userContentOverride !== null) {
      for (let index = requestMessages.length - 1; index >= 0; index -= 1) {
        if (requestMessages[index]?.role !== 'user') continue;
        requestMessages[index] = { ...requestMessages[index], content: userContentOverride };
        break;
      }
    }
    const attachments = Array.isArray(options.attachments) ? options.attachments : [];
    let fullContent = '';

    try {
      const result = await callBackendChat(requestMessages, (delta) => {
        fullContent += delta;
        streamRenderer.update(fullContent);
      }, conv.id, attachments, (payload) => {
        const currentModel = String(payload?.model || '').trim();
        if (currentModel) stream.meta.textContent = currentModel;
      });
      streamRenderer.flush(fullContent);

      const assistantMsg = createMessage('assistant', fullContent, {
        model: String(result?.model || stream.meta.textContent || ASSISTANT_LABEL),
        usage: result?.usage || null,
        meta: {
          partnerTokens:
            result?.usage?.total_tokens
            ?? (
              result?.usage?.prompt_tokens != null && result?.usage?.completion_tokens != null
                ? Number(result.usage.prompt_tokens) + Number(result.usage.completion_tokens)
                : result?.usage?.completion_tokens
                ?? null
            ),
          tokens:
            result?.usage?.total_tokens
            ?? (
              result?.usage?.prompt_tokens != null && result?.usage?.completion_tokens != null
                ? Number(result.usage.prompt_tokens) + Number(result.usage.completion_tokens)
                : result?.usage?.completion_tokens
                ?? null
            ),
          scribeTokens: result?.scribe?.usage?.total_tokens ?? null,
        },
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

  async function sendMessage() {
    const input = getInput();
    if (!input) return;
    const content = input.value.trim();
    const pendingAttachments = Array.isArray(state._pendingChatAttachments) ? state._pendingChatAttachments : [];
    if (!content && pendingAttachments.length === 0) return;

    let conv = getCurrentConversation();
    if (!conv) {
      await createNewConversation();
      conv = getCurrentConversation();
    }
    if (!conv) return;

    const route = getChatRouteMeta(state.settings || {});
    const hasAttachments = pendingAttachments.length > 0;
    if (route.isCloud) {
      if (!hasAcknowledgedCloudRoute(route, state._cloudSendNoticeShown)) {
        const message = hasAttachments
          ? `当前消息会发送到云端模型 ${route.providerName || route.host || ''}，并包含本轮附件。附件不会写入历史，但会发送到远端。是否继续？`
          : `当前聊天正在使用云端模型 ${route.providerName || route.host || ''}。这条消息会发送到远端服务。是否继续？`;
        if (!window.confirm(message)) return;
        markCloudRouteAcknowledged(route, state._cloudSendNoticeShown);
      }
    }

    const attachmentSummary = summarizePendingAttachments();
    const persistedContent = content
      ? [content, attachmentSummary].filter(Boolean).join('\n\n')
      : attachmentSummary;
    const userMsg = createMessage('user', persistedContent);
    conv.messages.push(userMsg);
    updateConversationTitle(conv);
    input.value = '';
    autosizeInput();
    renderMessages();
    renderPicker();
    await saveConversations();
    const attachments = consumePendingAttachments();
    await performChat(conv, {
      attachments,
      userContentOverride: content,
    });
  }

  async function clearContext() {
    const conv = getCurrentConversation();
    if (!conv) return;
    conv.contextClearedAt = conv.messages.length;
    document.getElementById('mobile-extra-menu')?.classList.add('hidden');
    await saveConversations();
    showToast('已清空上下文窗口');
  }

  async function createInlineConversation() {
    document.getElementById('mobile-extra-menu')?.classList.add('hidden');
    await createNewConversation();
  }

  function toggleExtraMenu() {
    document.getElementById('mobile-extra-menu')?.classList.toggle('hidden');
  }

  function fillInputFromMessage(msg) {
    const input = getInput();
    if (!input) return;
    input.value = String(msg?.content || '');
    autosizeInput();
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    showToast('已放回输入框');
  }

  function bindEvents() {
    document.getElementById('mobile-send-btn')?.addEventListener('click', sendMessage);
    document.getElementById('mobile-extra-btn')?.addEventListener('click', toggleExtraMenu);
    document.getElementById('mobile-attach-btn')?.addEventListener('click', openAttachmentPicker);
    document.getElementById('mobile-new-chat-inline-btn')?.addEventListener('click', createInlineConversation);
    document.getElementById('mobile-clear-context-btn')?.addEventListener('click', clearContext);
    document.getElementById('mobile-attachment-input')?.addEventListener('change', handleAttachmentFiles);
    document.getElementById('mobile-attachment-tray')?.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-mobile-attachment-remove]');
      if (!btn) return;
      removePendingAttachment(btn.dataset.mobileAttachmentRemove || '');
    });

    const input = getInput();
    input?.addEventListener('input', autosizeInput);
    input?.addEventListener('focus', () => {
      window.setTimeout(() => {
        syncViewport();
        scrollMessagesToBottom(false);
      }, 60);
    });
    input?.addEventListener('blur', () => {
      window.setTimeout(syncViewport, 60);
    });
    input?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && event.ctrlKey) {
        event.preventDefault();
        sendMessage();
      }
    });

    document.getElementById('mobile-messages')?.addEventListener('scroll', updateScrollBottomButton, { passive: true });
    document.getElementById('mobile-scroll-bottom-btn')?.addEventListener('click', () => scrollMessagesToBottom(true));
  }

  function bindDockResizeObserver() {
    if (typeof ResizeObserver === 'undefined') return;
    const dock = getDock();
    if (!dock) return;
    dockResizeObserver = new ResizeObserver(() => {
      syncDockMetrics();
    });
    dockResizeObserver.observe(dock);
  }

  function init() {
    bindEvents();
    autosizeInput();
    renderPendingAttachments();
    syncShellHeight(true);
    syncViewport();
    bindDockResizeObserver();
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', syncViewport);
      window.visualViewport.addEventListener('scroll', syncViewport);
    }
    window.addEventListener('resize', () => {
      syncShellHeight();
      syncViewport();
    }, { passive: true });
    window.addEventListener('orientationchange', () => {
      window.setTimeout(() => {
        syncShellHeight(true);
        syncViewport();
      }, 180);
    });
  }

  return {
    autosizeInput,
    syncViewport,
    sendMessage,
    stopGeneration,
    performChat,
    fillInputFromMessage,
    updateScrollBottomButton,
    scrollMessagesToBottom,
    init,
  };
}
