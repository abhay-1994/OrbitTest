const WebSocket = require('ws');

class Connection {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.id = 0;
    this.callbacks = new Map();
    this.eventCallbacks = new Map();
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);

      const timeout = setTimeout(() => {
        reject(new Error(`Timed out connecting to Chrome at ${this.wsUrl}`));
      }, 5000);

      this.ws.on('open', () => {
        clearTimeout(timeout);
        console.log('OrbitTest connected to Chrome');
        resolve();
      });

      this.ws.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });

      this.ws.on('message', (data) => {
        const message = JSON.parse(data.toString());

        if (this.callbacks.has(message.id)) {
          const callback = this.callbacks.get(message.id);
          this.callbacks.delete(message.id);
          callback.resolve(message);
          return;
        }

        if (message.method && this.eventCallbacks.has(message.method)) {
          const callbacks = this.eventCallbacks.get(message.method);
          this.eventCallbacks.delete(message.method);
          callbacks.forEach(callback => callback(message));
        }
      });

      this.ws.on('close', () => {
        const error = new Error('Connection closed');

        for (const callback of this.callbacks.values()) {
          callback.reject(error);
        }

        this.callbacks.clear();
        this.eventCallbacks.clear();
      });
    });
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error('Connection lost. WebSocket is closed.'));
        return;
      }

      this.id++;
      const messageId = this.id;

      this.callbacks.set(messageId, { resolve, reject });

      this.ws.send(JSON.stringify({
        id: messageId,
        method,
        params
      }), (error) => {
        if (!error) {
          return;
        }

        this.callbacks.delete(messageId);
        reject(error);
      });
    });
  }

  waitForEvent(method, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const callbacks = this.eventCallbacks.get(method) || [];
        const nextCallbacks = callbacks.filter(callback => callback !== handleEvent);

        if (nextCallbacks.length > 0) {
          this.eventCallbacks.set(method, nextCallbacks);
        } else {
          this.eventCallbacks.delete(method);
        }

        reject(new Error(`Timed out waiting for ${method}`));
      }, timeoutMs);

      const handleEvent = (message) => {
        clearTimeout(timeout);
        resolve(message);
      };

      const callbacks = this.eventCallbacks.get(method) || [];
      callbacks.push(handleEvent);
      this.eventCallbacks.set(method, callbacks);
    });
  }

  close() {
    if (this.ws && this.ws.readyState !== WebSocket.CLOSED) {
      this.ws.close();
    }
  }
}

module.exports = Connection;
