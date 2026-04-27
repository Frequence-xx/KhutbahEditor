// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { DetectingPane } from '../../src/components/DetectingPane';

afterEach(cleanup);

describe('DetectingPane', () => {
  it('renders the project name and progress percent', () => {
    render(<DetectingPane projectName="Iziyi 25-04-26" progress={42} stage="Transcribe" />);
    expect(screen.getByText(/Iziyi 25-04-26/)).toBeTruthy();
    expect(screen.getByText(/42%/)).toBeTruthy();
    expect(screen.getByText(/Transcribe/)).toBeTruthy();
  });

  it('handles undefined progress as indeterminate', () => {
    render(<DetectingPane projectName="K" stage="Audio extraction" />);
    expect(screen.getByRole('progressbar')).toBeTruthy();
  });
});
