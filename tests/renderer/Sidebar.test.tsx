// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Sidebar } from '../../src/components/Sidebar';
import { useProjects } from '../../src/store/projects';

describe('Sidebar', () => {
  beforeEach(() => {
    useProjects.setState({
      projects: [
        { id: 'a', sourcePath: '/a.mp4', duration: 1, createdAt: 2, runState: 'detecting', progress: 78 },
        { id: 'b', sourcePath: '/b.mp4', duration: 1, createdAt: 1, runState: 'uploaded' },
      ],
    });
  });

  it('renders rows newest-first and shows status dots', () => {
    render(<Sidebar selectedId={null} onSelect={() => {}} onNew={() => {}} onSettings={() => {}} />);
    const rows = screen.getAllByRole('button', { name: /a\.mp4|b\.mp4/ });
    expect(rows[0].textContent).toContain('a.mp4');
    expect(screen.getByLabelText(/Status: detecting/)).toBeTruthy();
    expect(screen.getByLabelText(/Status: uploaded/)).toBeTruthy();
  });

  it('clicking a row calls onSelect', () => {
    const onSelect = vi.fn();
    render(<Sidebar selectedId={null} onSelect={onSelect} onNew={() => {}} onSettings={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /a\.mp4/ }));
    expect(onSelect).toHaveBeenCalledWith('a');
  });

  it('clicking + New khutbah calls onNew', () => {
    const onNew = vi.fn();
    render(<Sidebar selectedId={null} onSelect={() => {}} onNew={onNew} onSettings={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /\+ new khutbah/i }));
    expect(onNew).toHaveBeenCalled();
  });

  it('clicking Settings calls onSettings', () => {
    const onSettings = vi.fn();
    render(<Sidebar selectedId={null} onSelect={() => {}} onNew={() => {}} onSettings={onSettings} />);
    fireEvent.click(screen.getByRole('button', { name: /settings/i }));
    expect(onSettings).toHaveBeenCalled();
  });

  it('clicking the × on a row calls onDelete with that id and stops propagation (I3)', () => {
    const onDelete = vi.fn();
    const onSelect = vi.fn();
    render(
      <Sidebar
        selectedId={null}
        onSelect={onSelect}
        onNew={() => {}}
        onSettings={() => {}}
        onDelete={onDelete}
      />,
    );
    const deleteBtn = screen.getByRole('button', { name: /delete a\.mp4/i });
    fireEvent.click(deleteBtn);
    expect(onDelete).toHaveBeenCalledWith('a');
    // Click on × must not also trigger row's onSelect
    expect(onSelect).not.toHaveBeenCalled();
  });
});
