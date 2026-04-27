// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReviewPane } from '../../src/components/ReviewPane';

const project = {
  id: 'p1',
  sourcePath: '/s',
  duration: 200,
  createdAt: 1,
  runState: 'ready' as const,
  part1: { start: 10, end: 100, confidence: 0.95, outputPath: '/p1.mp4' },
  part2: { start: 110, end: 195, confidence: 0.95, outputPath: '/p2.mp4' },
};

describe('ReviewPane — actions', () => {
  it('clicking Start +5s on Part 1 calls onNudge("p1Start", +5)', () => {
    const onNudge = vi.fn();
    render(<ReviewPane project={project} onAccept={() => {}} onNudge={onNudge} />);
    fireEvent.click(screen.getByRole('button', { name: /start \+5s/i }));
    expect(onNudge).toHaveBeenCalledWith('p1Start', 5);
  });

  it('clicking End −5s on Part 2 calls onNudge("p2End", -5)', () => {
    const onNudge = vi.fn();
    render(<ReviewPane project={project} onAccept={() => {}} onNudge={onNudge} />);
    fireEvent.click(screen.getByRole('tab', { name: /part 2/i }));
    fireEvent.click(screen.getByRole('button', { name: /end −5s/i }));
    expect(onNudge).toHaveBeenCalledWith('p2End', -5);
  });

  it('clicking Accept & upload calls onAccept', () => {
    const onAccept = vi.fn();
    render(<ReviewPane project={project} onAccept={onAccept} onNudge={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /accept & upload/i }));
    expect(onAccept).toHaveBeenCalledTimes(1);
  });
});
