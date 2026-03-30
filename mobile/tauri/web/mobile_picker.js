import {
  apiAddConvToFolder,
  apiCreateFolder,
  apiDeleteConversation,
  apiRemoveConvFromFolder,
  apiReorderFolderConvs,
} from './api.js';

export function createMobilePickerController(deps) {
  const {
    state,
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
  } = deps;

  function persistCollapsedFolders() {
    localStorage.setItem('ministar-mobile-collapsed-folders', JSON.stringify([...state.collapsedFolders]));
  }

  function toggleFolderCollapsed(folderId) {
    if (!folderId) return;
    if (state.collapsedFolders.has(folderId)) state.collapsedFolders.delete(folderId);
    else state.collapsedFolders.add(folderId);
    persistCollapsedFolders();
    renderPicker();
  }

  function getConversationFolder(convId) {
    return state.folders.find(folder => (folder.conv_ids || []).includes(convId)) || null;
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

  function activateConversation(conv, options = {}) {
    state.currentId = conv.id;
    if (options.fromHistorySheet) {
      state.timelineMode = isImportedConversation(conv) ? 'oldtimes' : 'now';
      closeSheet('mobile-history-sheet');
    }
    renderPicker();
    renderMessages();
  }

  function buildHistoryButton(conv) {
    const btn = document.createElement('button');
    btn.className = `mobile-history-item${conv.id === state.currentId ? ' active' : ''}`;
    const folder = getConversationFolder(conv.id);
    btn.dataset.convId = conv.id;
    btn.dataset.folderId = folder?.id || '';
    const count = Array.isArray(conv.messages) ? conv.messages.length : 0;
    const stamp = conv.updatedAt || conv.createdAt || conv.id || 0;
    btn.innerHTML = buildHistoryLabelMarkup(conv.title || '新对话', `${formatMobileDateOnly(stamp)} · ${count} 条消息`);
    bindConversationInteractions(btn, conv);
    return btn;
  }

  function renderPicker() {
    const wrap = document.getElementById('mobile-picker-list');
    const keyword = state.search.trim().toLowerCase();
    const folders = Array.isArray(state.folders) ? state.folders : [];
    const convs = getTimelineConversations();
    const groupedConvIds = new Set(folders.flatMap(folder => folder.conv_ids || []));

    wrap.innerHTML = '';

    const folderItems = folders
      .slice()
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hans-CN'));

    folderItems.forEach(folder => {
      const isCollapsed = state.collapsedFolders.has(folder.id);
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
        folderConvs.forEach(conv => list.appendChild(buildHistoryButton(conv)));
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
      looseConvs.forEach(conv => list.appendChild(buildHistoryButton(conv)));
      looseGroup.appendChild(list);
      wrap.appendChild(looseGroup);
    }

    if (!wrap.childElementCount) {
      wrap.innerHTML = '<div class="mobile-empty-state">没有匹配到会话或文件夹。</div>';
    }

    const timelineToggleBtn = document.getElementById('mobile-timeline-toggle-btn');
    if (timelineToggleBtn) {
      timelineToggleBtn.classList.toggle('active', state.timelineMode === 'now');
      timelineToggleBtn.textContent = state.timelineMode === 'oldtimes' ? '∿' : '≈';
      timelineToggleBtn.title = state.timelineMode === 'oldtimes' ? '切换到现在' : '切换到旧时光';
    }
  }

  function renderHistorySheet() {
    const list = document.getElementById('mobile-history-list');
    const keyword = state.search.trim().toLowerCase();
    const allConvs = state.conversations
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
      btn.className = `mobile-history-sheet-item${conv.id === state.currentId ? ' active' : ''}`;
      btn.dataset.convId = conv.id;
      btn.dataset.folderId = getConversationFolder(conv.id)?.id || '';
      const stamp = conv.updatedAt || conv.createdAt || conv.id || 0;
      btn.innerHTML = buildHistoryLabelMarkup(conv.title || '新对话', `${formatMobileDateOnly(stamp)} · ${(conv.messages || []).length} 条消息`);
      bindConversationInteractions(btn, conv, { fromHistorySheet: true });
      list.appendChild(btn);
    });
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
    const ids = state.conversations.map(conv => conv.id);
    const orderedIds = reorderIds(ids, dragId, targetId, before);
    state.conversations = orderedIds
      .map(id => state.conversations.find(conv => conv.id === id))
      .filter(Boolean);
    await saveConversations();
  }

  async function reorderFolderConversations(folderId, dragId, targetId, before = true) {
    const folder = state.folders.find(item => item.id === folderId);
    if (!folder) return;
    const nextIds = reorderIds(folder.conv_ids || [], dragId, targetId, before);
    const updated = await apiReorderFolderConvs(folderId, nextIds);
    const idx = state.folders.findIndex(item => item.id === folderId);
    if (idx !== -1) state.folders[idx] = updated;
  }

  async function moveConvToFolderById(convId, folderId) {
    const updated = await apiAddConvToFolder(folderId, convId);
    state.folders = state.folders.map(folder => {
      const ids = (folder.conv_ids || []).filter(id => id !== convId);
      return folder.id === folderId ? updated : { ...folder, conv_ids: ids };
    });
  }

  async function removeConvFromFolderById(convId, folderId) {
    const updated = await apiRemoveConvFromFolder(folderId, convId);
    const idx = state.folders.findIndex(folder => folder.id === folderId);
    if (idx !== -1) state.folders[idx] = updated;
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

    if (dragFolderId) await removeConvFromFolderById(dragId, dragFolderId);
    if (targetFolderId) {
      await moveConvToFolderById(dragId, targetFolderId);
      await reorderFolderConversations(targetFolderId, dragId, targetId, before);
    } else {
      await reorderRootConversations(dragId, targetId, before);
    }
  }

  function startConvDrag(convId, title, clientX, clientY) {
    clearDragVisuals();
    const ghost = document.createElement('div');
    ghost.className = 'mobile-drag-ghost';
    ghost.textContent = title;
    document.body.appendChild(ghost);
    state.drag = { convId, ghost, target: null };
    updateConvDrag(clientX, clientY);
  }

  function updateConvDrag(clientX, clientY) {
    const drag = state.drag;
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
    const drag = state.drag;
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
      state.drag = null;
      renderPicker();
      renderHistorySheet();
    }
  }

  function openConvActions(convId) {
    const conv = state.conversations.find(item => item.id === convId);
    if (!conv) return;
    state.activeConvActionId = convId;
    document.getElementById('mobile-conv-actions-title').textContent = conv.title || '会话操作';
    document.getElementById('mobile-conv-pin-btn').textContent = conv.pinned ? '取消置顶' : '置顶';
    openSheet('mobile-conv-actions-sheet');
  }

  function getActiveActionConv() {
    return state.conversations.find(item => item.id === state.activeConvActionId) || null;
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
    state.conversations.sort((a, b) => {
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

    state.folders.forEach(folder => {
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
      state.conversations = state.conversations.filter(item => item.id !== conv.id);
      state.folders = state.folders.map(folder => ({
        ...folder,
        conv_ids: (folder.conv_ids || []).filter(id => id !== conv.id),
      }));
      if (state.currentId === conv.id) {
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

  function bindConversationInteractions(element, conv, options = {}) {
    let timer = null;
    let startX = 0;
    let startY = 0;
    let moved = false;
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

    element.addEventListener('touchstart', (event) => {
      const touch = event.changedTouches[0];
      startX = touch?.clientX || 0;
      startY = touch?.clientY || 0;
      moved = false;
      longPressed = false;
      dragging = false;
      actionOpened = false;
      clearTimer();
      timer = window.setTimeout(() => {
        timer = null;
        longPressed = true;
        actionOpened = true;
        suppressClick = true;
        setPickerInteracting(true);
        openConvActions(conv.id);
      }, 320);
    }, { passive: true });

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
        moved = true;
        clearTimer();
        return;
      }
      if (longPressed && !dragging && dist > 12) {
        dragging = true;
        suppressClick = true;
        setPickerInteracting(true);
        startConvDrag(conv.id, conv.title || '新对话', touch.clientX, touch.clientY);
      }
      if (dragging) {
        event.preventDefault();
        updateConvDrag(touch.clientX, touch.clientY);
      }
    }, { passive: false });

    element.addEventListener('touchend', (event) => {
      clearTimer();
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
      if (moved) {
        longPressed = false;
        actionOpened = false;
        setPickerInteracting(false);
        return;
      }
      event.preventDefault();
      longPressed = false;
      actionOpened = false;
      setPickerInteracting(false);
      suppressClick = true;
      activateConversation(conv, options);
      window.setTimeout(() => { suppressClick = false; }, 0);
    }, { passive: false });

    element.addEventListener('touchcancel', () => {
      clearTimer();
      if (dragging) finishConvDrag();
      dragging = false;
      longPressed = false;
      actionOpened = false;
      moved = false;
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
      activateConversation(conv, options);
    });
  }

  function openPicker() {
    state.pickerOpen = true;
    document.getElementById('mobile-app').classList.add('picker-open');
    document.getElementById('mobile-picker').classList.add('open');
  }

  function closePicker() {
    state.pickerOpen = false;
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
    if (state.pickerOpen) closePicker();
    else openPicker();
  }

  async function createNewFolder() {
    const raw = window.prompt('文件夹名称：', '新文件夹');
    if (raw === null) return;
    const name = raw.trim() || '新文件夹';
    try {
      const folder = await apiCreateFolder(name);
      state.folders.push(folder);
      renderPicker();
      showToast('文件夹已创建');
    } catch (err) {
      showToast(`创建失败：${err.message}`);
    }
  }

  return {
    renderPicker,
    renderHistorySheet,
    getConversationFolder,
    openConvActions,
    renderMoveSheet,
    renameActiveConversation,
    togglePinActiveConversation,
    regenerateActiveConversationTitle,
    deleteActiveConversation,
    openPicker,
    closePicker,
    clearPickerSelection,
    togglePicker,
    createNewFolder,
  };
}
