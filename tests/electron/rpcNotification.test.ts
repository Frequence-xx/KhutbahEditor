import { describe, it, expect, vi } from 'vitest';
import { StdioRpc } from '../../electron/sidecar/rpc';
import { Readable, Writable } from 'stream';

describe('StdioRpc — notifications', () => {
  function makePair() {
    const stdoutEvents = new Readable({ read() {} });
    const stdin = new Writable({ write(_c, _e, cb) { cb(); } });
    return { stdin, stdoutEvents };
  }

  it('forwards JSON-RPC notifications to onNotification listeners', async () => {
    const { stdin, stdoutEvents } = makePair();
    const rpc = new StdioRpc(stdin, stdoutEvents);
    const listener = vi.fn();
    rpc.onNotification(listener);
    stdoutEvents.push(JSON.stringify({
      jsonrpc: '2.0',
      method: 'progress',
      params: { stage: 'download', progress: 0.5 },
    }) + '\n');
    // Give the readline interface a tick
    await new Promise((r) => setImmediate(r));
    expect(listener).toHaveBeenCalledWith('progress', { stage: 'download', progress: 0.5 });
  });

  it('does not invoke onNotification for response messages', async () => {
    const { stdin, stdoutEvents } = makePair();
    const rpc = new StdioRpc(stdin, stdoutEvents);
    const listener = vi.fn();
    rpc.onNotification(listener);
    stdoutEvents.push(JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      result: { ok: true },
    }) + '\n');
    await new Promise((r) => setImmediate(r));
    expect(listener).not.toHaveBeenCalled();
  });

  it('unsubscribes a listener when the returned cleanup is called', async () => {
    const { stdin, stdoutEvents } = makePair();
    const rpc = new StdioRpc(stdin, stdoutEvents);
    const listener = vi.fn();
    const unsub = rpc.onNotification(listener);
    unsub();
    stdoutEvents.push(JSON.stringify({
      jsonrpc: '2.0',
      method: 'progress',
      params: { stage: 'download', progress: 0.9 },
    }) + '\n');
    await new Promise((r) => setImmediate(r));
    expect(listener).not.toHaveBeenCalled();
  });

  it('fans out to multiple listeners simultaneously', async () => {
    const { stdin, stdoutEvents } = makePair();
    const rpc = new StdioRpc(stdin, stdoutEvents);
    const listenerA = vi.fn();
    const listenerB = vi.fn();
    rpc.onNotification(listenerA);
    rpc.onNotification(listenerB);
    stdoutEvents.push(JSON.stringify({
      jsonrpc: '2.0',
      method: 'progress',
      params: { stage: 'download', progress: 0.25 },
    }) + '\n');
    await new Promise((r) => setImmediate(r));
    expect(listenerA).toHaveBeenCalledWith('progress', { stage: 'download', progress: 0.25 });
    expect(listenerB).toHaveBeenCalledWith('progress', { stage: 'download', progress: 0.25 });
  });
});
