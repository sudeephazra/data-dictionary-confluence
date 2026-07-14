import '@testing-library/jest-dom';

// This setup file is used by frontend (jsdom) tests only.
// Backend/resolver tests run in the Node environment, which natively provides
// all Web API globals (Response, Headers, TextEncoder, ReadableStream, etc.).
//
// jsdom doesn't provide the Response constructor, but the @forge/bridge shim's
// productRequest() returns Response objects, so frontend tests need this polyfill.
if (typeof globalThis.Response === 'undefined') {
  globalThis.Response = class Response {
    readonly status: number;
    readonly ok: boolean;
    readonly headers: Headers;
    private _body: string;

    constructor(body?: string | null, init?: { status?: number; headers?: Headers | Record<string, string> }) {
      this._body = body ?? '';
      this.status = init?.status ?? 200;
      this.ok = this.status >= 200 && this.status < 300;
      this.headers = init?.headers instanceof Headers
        ? init.headers
        : new Headers(init?.headers as Record<string, string> | undefined);
    }

    async json() { return JSON.parse(this._body); }
    async text() { return this._body; }
  } as unknown as typeof Response;
}
