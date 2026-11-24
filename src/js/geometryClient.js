/**
 * Worker client: single in-flight build at a time, newest-wins queue.
 */

export class GeometryClient {
  constructor(wasmUrl) {
    this.wasmUrl = wasmUrl;
    this.worker = new Worker(new URL('../worker/geometryWorker.js', import.meta.url), {
      type: 'module',
      name: 'geometry',
    });
    this.seq = 0;
    this.pending = null;
    this.queued = null;
    this.ready = false;
    this.handlers = { ready: [], built: [], error: [], fatal: [] };
    this.worker.addEventListener('message', (e) => this._onMessage(e.data));
    this.worker.addEventListener('error', (e) => {
      this._emit('fatal', { message: e.message || '几何 Worker 崩溃' });
    });
  }

  start() {
    const url = new URL('manifold-3d/manifold.wasm', import.meta.url).href;
    this.worker.postMessage({ type: 'init', wasmUrl: this.wasmUrl || url });
  }

  on(event, fn) {
    this.handlers[event].push(fn);
    return () => {
      this.handlers[event] = this.handlers[event].filter((f) => f !== fn);
    };
  }

  _emit(event, payload) {
    for (const fn of this.handlers[event]) fn(payload);
  }

  _onMessage(msg) {
    if (!msg) return;
    if (msg.type === 'ready') {
      this.ready = true;
      this._emit('ready', msg);
      return;
    }
    if (msg.type === 'fatal') {
      this._emit('fatal', msg);
      return;
    }
    if (msg.type === 'built') {
      if (!this.pending || msg.requestId !== this.pending.id) return;
      const { resolve } = this.pending;
      this.pending = null;
      this._flush();
      resolve({ ok: true, payload: msg });
      return;
    }
    if (msg.type === 'build-error') {
      if (!this.pending || msg.requestId !== this.pending.id) return;
      const { reject } = this.pending;
      this.pending = null;
      this._flush();
      reject(new Error(msg.message || '构建失败'));
    }
  }

  _flush() {
    if (this.pending || !this.queued) return;
    const job = this.queued;
    this.queued = null;
    this.submit(job.doc, job.opts, job.resolve, job.reject);
  }

  build(doc, opts = {}) {
    return new Promise((resolve, reject) => {
      const job = { doc, opts, resolve, reject };
      if (this.pending) {
        // Newest wins: supersede any queued job.
        if (this.queued) this.queued.reject(new Error('superseded'));
        this.queued = job;
      } else {
        this.submit(doc, opts, resolve, reject);
      }
    });
  }

  submit(doc, opts, resolve, reject) {
    this.seq += 1;
    const id = this.seq;
    this.pending = { id, resolve, reject };
    this.worker.postMessage({ type: 'build', requestId: id, doc, opts });
  }

  terminate() {
    this.worker.terminate();
  }
}
