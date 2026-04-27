// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ReviewPane } from '../../src/components/ReviewPane';

afterEach(cleanup);

const project = {
  id: 'p1',
  sourcePath: '/src.mp4',
  duration: 200,
  createdAt: 1,
  runState: 'ready' as const,
  part1: { start: 10, end: 100, confidence: 0.95, outputPath: '/out/part1.mp4' },
  part2: { start: 110, end: 195, confidence: 0.71, outputPath: '/out/part2.mp4' },
};

describe('ReviewPane — tabs', () => {
  it('renders both tabs and a video element with part1 by default if both >= 0.9', () => {
    const ready = { ...project, part2: { ...project.part2, confidence: 0.95 } };
    render(<ReviewPane project={ready} onAccept={() => {}} onNudge={() => {}} />);
    expect(screen.getByRole('tab', { name: /part 1/i })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /part 2/i })).toBeTruthy();
    const video = screen.getByTestId('preview') as HTMLVideoElement;
    expect(video.src).toContain('part1.mp4');
  });

  it('defaults the active tab to the lower-confidence part when needs_review', () => {
    render(<ReviewPane project={project} onAccept={() => {}} onNudge={() => {}} />);
    const video = screen.getByTestId('preview') as HTMLVideoElement;
    expect(video.src).toContain('part2.mp4');
  });

  it('clicking Part 2 tab swaps the video src', () => {
    const ready = { ...project, part2: { ...project.part2, confidence: 0.95 } };
    render(<ReviewPane project={ready} onAccept={() => {}} onNudge={() => {}} />);
    fireEvent.click(screen.getByRole('tab', { name: /part 2/i }));
    const video = screen.getByTestId('preview') as HTMLVideoElement;
    expect(video.src).toContain('part2.mp4');
  });
});
