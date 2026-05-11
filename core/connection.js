const WebSocket = require('ws');

class Connection {
  constructor(wsUrl, options = {}) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.id = 0;
    this.callbacks = new Map();
    this.eventCallbacks = new Map();
    this.connectTimeoutMs = options.connectTimeoutMs || 10000;
    this.commandTimeoutMs = options.commandTimeoutMs || 15000;
    this.log = Boolean(options.log);
    this.closed = false;
    this.closeReason = null;
  }

  async connect() {
    return new Promise((resolve, reject) => {
      let settled = false;
      this.closed = false;
      this.closeReason = null;
      this.ws = new WebSocket(this.wsUrl);

      const finish = (fn, value) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timeout);
        fn(value);
      };

      const timeout = setTimeout(() => {
        this.closeReason = new Error(`Timed out connecting to Chrome at ${this.wsUrl}`);
        this.terminate();
        finish(reject, this.closeReason);
      }, this.connectTimeoutMs);

      this.ws.on('open', () => {
        this.logMessage('OrbitTest connected to Chrome');
        finish(resolve);
      });

      this.ws.on('error', (error) => {
        if (!settled) {
          finish(reject, error);
          return;
        }

        this.rejectPending(error);
      });

      this.ws.on('message', (data) => {
        this.handleMessage(data);
      });

      this.ws.on('close', (code, reason) => {
        const message = reason ? reason.toString() : 'no reason';
        const error = this.closeReason || new Error(`Connection closed (code ${code}, ${message})`);

        this.closed = true;
        this.closeReason = error;
        clearTimeout(timeout);

        if (!settled) {
          finish(reject, error);
        }

        this.rejectPending(error);
        this.clearEvents(error);
      });
    });
  }

  handleMessage(data) {
    let message;

    try {
      message = JSON.parse(data.toString());
    } catch (error) {
      this.rejectPending(new Error(`Invalid message from Chrome: ${error.message}`));
      return;
    }

    if (this.callbacks.has(message.id)) {
      const callback = this.callbacks.get(message.id);
      this.callbacks.delete(message.id);
      clearTimeout(callback.timeout);

      if (message.error) {
        callback.reject(new Error(message.error.message || JSON.stringify(message.error)));
        return;
      }

      callback.resolve(message);
      return;
    }

    if (message.method && this.eventCallbacks.has(message.method)) {
      const callbacks = this.eventCallbacks.get(message.method).slice();

      callbacks.forEach(callback => callback(message));
    }
  }

  send(method, params = {}, options = {}) {
    return new Promise((resolve, reject) => {
      if (!this.isOpen()) {
        reject(this.closeReason || new Error('Connection lost. WebSocket is closed.'));
        return;
      }

      this.id++;
      const messageId = this.id;
      const timeoutMs = options.timeoutMs || this.commandTimeoutMs;
      const timeout = setTimeout(() => {
        this.callbacks.delete(messageId);
        reject(new Error(`Timed out after ${timeoutMs}ms running ${method}`));
      }, timeoutMs);

      this.callbacks.set(messageId, { resolve, reject, timeout });

      this.ws.send(JSON.stringify({
        id: messageId,
        method,
        params
      }), (error) => {
        if (!error) {
          return;
        }

        clearTimeout(timeout);
        this.callbacks.delete(messageId);
        reject(error);
      });
    });
  }

  waitForEvent(method, timeoutMs = 5000, predicate = null) {
    return new Promise((resolve, reject) => {
      if (!this.isOpen()) {
        reject(this.closeReason || new Error('Connection lost. WebSocket is closed.'));
        return;
      }

      const timeout = setTimeout(() => {
        this.removeEventCallback(method, handleEvent);
        reject(new Error(`Timed out waiting for ${method}`));
      }, timeoutMs);

      const handleEvent = (message) => {
        if (predicate && !predicate(message)) {
          return;
        }

        clearTimeout(timeout);
        this.removeEventCallback(method, handleEvent);
        resolve(message);
      };

      const callbacks = this.eventCallbacks.get(method) || [];
      callbacks.push(handleEvent);
      this.eventCallbacks.set(method, callbacks);
    });
  }

  onEvent(method, callback) {
    const callbacks = this.eventCallbacks.get(method) || [];
    callbacks.push(callback);
    this.eventCallbacks.set(method, callbacks);

    return () => this.removeEventCallback(method, callback);
  }

  removeEventCallback(method, callback) {
    const callbacks = this.eventCallbacks.get(method) || [];
    const nextCallbacks = callbacks.filter(current => current !== callback);

    if (nextCallbacks.length > 0) {
      this.eventCallbacks.set(method, nextCallbacks);
    } else {
      this.eventCallbacks.delete(method);
    }
  }

  isOpen() {
    return this.ws && this.ws.readyState === WebSocket.OPEN && !this.closed;
  }

  rejectPending(error) {
    for (const callback of this.callbacks.values()) {
      clearTimeout(callback.timeout);
      callback.reject(error);
    }

    this.callbacks.clear();
  }

  clearEvents(error) {
    this.eventCallbacks.clear();
  }

  logMessage(...args) {
    if (this.log) {
      console.log(...args);
    }
  }

  terminate() {
    if (this.ws && this.ws.readyState !== WebSocket.CLOSED) {
      this.ws.terminate();
    }
  }

  close() {
    this.closed = true;
    this.closeReason = new Error('Connection closed by OrbitTest');

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.close();
    } else if (this.ws && this.ws.readyState !== WebSocket.CLOSED) {
      this.ws.terminate();
    }

    this.rejectPending(this.closeReason);
    this.clearEvents(this.closeReason);
  }
}

module.exports = Connection;
