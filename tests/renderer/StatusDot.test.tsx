// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusDot } from '../../src/components/StatusDot';

describe('StatusDot', () => {
  it('renders a green dot for ready', () => {
    render(<StatusDot runState="ready" />);
    const dot = screen.getByLabelText('Status: ready');
    expect(dot.className).toMatch(/bg-emerald|bg-green/);
  });

  it('renders an amber dot for needs_review', () => {
    render(<StatusDot runState="needs_review" />);
    const dot = screen.getByLabelText('Status: needs review');
    expect(dot.className).toMatch(/bg-amber/);
  });

  it('renders a red dot for error', () => {
    render(<StatusDot runState="error" />);
    const dot = screen.getByLabelText('Status: error');
    expect(dot.className).toMatch(/bg-red/);
  });

  it('renders a pulsing gold dot for detecting', () => {
    render(<StatusDot runState="detecting" />);
    const dot = screen.getByLabelText('Status: detecting');
    expect(dot.className).toMatch(/animate-pulse/);
  });

  it('renders a blue dot for uploaded', () => {
    render(<StatusDot runState="uploaded" />);
    const dot = screen.getByLabelText('Status: uploaded');
    expect(dot.className).toMatch(/bg-blue/);
  });
});
