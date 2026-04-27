// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { Toaster } from '../../src/components/Toaster';
import { useToasts } from '../../src/store/toasts';

describe('Toaster', () => {
  beforeEach(() => {
    useToasts.setState({ toasts: [] });
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('renders nothing when no toasts', () => {
    const { container } = render(<Toaster />);
    expect(container.querySelectorAll('[role="status"]').length).toBe(0);
  });

  it('shows a toast pushed via store', () => {
    render(<Toaster />);
    act(() => {
      useToasts.getState().push({ id: 't1', kind: 'success', message: 'Done!' });
    });
    expect(screen.getByText('Done!')).toBeTruthy();
  });

  it('auto-dismisses after 5 seconds', () => {
    render(<Toaster />);
    act(() => {
      useToasts.getState().push({ id: 't1', kind: 'success', message: 'Done!' });
    });
    expect(screen.queryByText('Done!')).not.toBeNull();
    act(() => { vi.advanceTimersByTime(5001); });
    expect(screen.queryByText('Done!')).toBeNull();
  });

  it('clicking dismisses immediately', () => {
    render(<Toaster />);
    act(() => {
      useToasts.getState().push({ id: 't1', kind: 'success', message: 'Done!' });
    });
    fireEvent.click(screen.getByText('Done!'));
    expect(screen.queryByText('Done!')).toBeNull();
  });
});
