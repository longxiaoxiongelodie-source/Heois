export function createMobileInputDockController(deps) {
  const {
    state,
    escHtml,
    showToast,
    showChatPostEffects,
    saveConversations,
    createNewConversation,
    getCurrentConversation,
    createMessage,
    updateConversationTitle,
    renderMessages,
    renderPicker,
    formatCurrentModelLabel,
    BACKEND_WS_URL,
  } = deps;
  let dockResizeObserver = null;
  let shellHeightPx = 0;

  function getInput() {
    return document.getElementById('mobile-user-input');
  }

  function getDock() {
    return document.getElementById('mobile-input-dock');
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
    if (state.activeWs && state.activeWs.readyState === WebSocket.OPEN) {
      state.activeWs.send(JSON.stringify({ type: 'cancel' }));
    }
  }

  function buildRequestMessages(conv) {
    const contextLimit = state.settings?.contextLimit || 20;
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
    wrap?.appendChild(item);
    if (wrap) wrap.scrollTop = wrap.scrollHeight;
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

  async function callBackendChat(requestMessages, onDelta, conversationId) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${BACKEND_WS_URL}/ws/chat`);
      state.activeWs = ws;

      ws.onopen = () => {
        const conv = state.conversations.find(item => item.id === conversationId);
        ws.send(JSON.stringify({
          type: 'chat',
          settings: state.settings,
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
          state.activeWs = null;
          state._lastPromptSnapshot = payload.prompt_snapshot || null;
          import('./settings.js')
            .then(mod => mod.populateDebugSection?.())
            .catch(() => {});
          resolve({
            usage: payload.usage || null,
            cancelled: !!payload.cancelled,
            saved_memories: payload.saved_memories || [],
            saved_session_memories: payload.saved_session_memories || [],
            scribe: payload.scribe || { updated: false, pair_count: 0 },
            prompt_snapshot: payload.prompt_snapshot || null,
          });
        } else if (payload.type === 'error') {
          state.activeWs = null;
          reject(new Error(payload.message || '未知错误'));
        }
      };

      ws.onerror = () => {
        state.activeWs = null;
        reject(new Error('WebSocket 连接失败，请检查后端是否运行'));
      };

      ws.onclose = (event) => {
        if (state.activeWs === ws) state.activeWs = null;
        if (event.code !== 1000 && event.code !== 1001) {
          reject(new Error(`WebSocket 异常断开 (${event.code})`));
        }
      };
    });
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
        model: state.settings?.taskModels?.chat?.modelName || '',
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
    document.getElementById('mobile-new-chat-inline-btn')?.addEventListener('click', createInlineConversation);
    document.getElementById('mobile-clear-context-btn')?.addEventListener('click', clearContext);

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
