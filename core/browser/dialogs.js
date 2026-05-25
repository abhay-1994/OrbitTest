// Copyright 2026 Abhay
// Licensed under the Apache License, Version 2.0.

function createDialogState() {
  return {
    open: null,
    history: [],
    waiters: [],
    maxDialogs: 30,
    nextId: 1,
    unsubscribe: []
  };
}

function serializeDialogForUser(dialog) {
  if (!dialog) {
    return null;
  }

  return {
    id: dialog.id,
    type: dialog.type || 'alert',
    message: dialog.message || '',
    defaultPrompt: dialog.defaultPrompt || '',
    url: dialog.url || null,
    openedAt: dialog.openedAt || null,
    closedAt: dialog.closedAt || null,
    handled: Boolean(dialog.handled),
    handledAt: dialog.handledAt || null,
    handledBy: dialog.handledBy || null
  };
}

function serializeDialogForTrace(dialog) {
  return {
    type: dialog.type || 'alert',
    message: dialog.message || '',
    url: dialog.url || null,
    openedAt: dialog.openedAt || null,
    handled: Boolean(dialog.handled),
    handledAt: dialog.handledAt || null,
    handledBy: dialog.handledBy || null,
    handleError: dialog.handleError || null
  };
}

module.exports = { createDialogState, serializeDialogForUser, serializeDialogForTrace };
