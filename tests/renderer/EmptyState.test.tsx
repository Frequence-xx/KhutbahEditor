// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { EmptyState } from '../../src/components/EmptyState';

afterEach(() => {
  cleanup();
});

describe('EmptyState', () => {
  it('renders the brand mark + a New khutbah button', () => {
    render(<EmptyState onNew={() => {}} />);
    expect(screen.getByRole('button', { name: /new khutbah/i })).toBeTruthy();
  });

  it('clicking the button calls onNew', () => {
    const onNew = vi.fn();
    render(<EmptyState onNew={onNew} />);
    fireEvent.click(screen.getByRole('button', { name: /new khutbah/i }));
    expect(onNew).toHaveBeenCalledTimes(1);
  });
});
