// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ErrorPane } from '../../src/components/ErrorPane';

afterEach(cleanup);

describe('ErrorPane', () => {
  it('renders the error message and a Retry button', () => {
    render(<ErrorPane message="sidecar crashed" onRetry={() => {}} />);
    expect(screen.getByText(/sidecar crashed/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /retry/i })).toBeTruthy();
  });

  it('clicking Retry calls onRetry', () => {
    const onRetry = vi.fn();
    render(<ErrorPane message="x" onRetry={onRetry} />);
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalled();
  });
});
