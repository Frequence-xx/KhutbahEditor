// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NewKhutbahModal } from '../../src/components/NewKhutbahModal';

describe('NewKhutbahModal', () => {
  const noop = () => {};

  it('renders 3 tabs: YouTube / Local file / Dual-file', () => {
    render(<NewKhutbahModal open onClose={noop} onSubmitYoutube={noop} onSubmitLocal={noop} onSubmitDual={noop} />);
    expect(screen.getByRole('tab', { name: /youtube/i })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /local/i })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /dual/i })).toBeTruthy();
  });

  it('submitting the YouTube tab calls onSubmitYoutube with the URL', () => {
    const onSubmitYoutube = vi.fn();
    render(<NewKhutbahModal open onClose={noop} onSubmitYoutube={onSubmitYoutube} onSubmitLocal={noop} onSubmitDual={noop} />);
    const input = screen.getByPlaceholderText(/youtube url/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'https://youtu.be/abc' } });
    fireEvent.click(screen.getByRole('button', { name: /start/i }));
    expect(onSubmitYoutube).toHaveBeenCalledWith('https://youtu.be/abc');
  });

  it('clicking the backdrop calls onClose', () => {
    const onClose = vi.fn();
    render(<NewKhutbahModal open onClose={onClose} onSubmitYoutube={noop} onSubmitLocal={noop} onSubmitDual={noop} />);
    fireEvent.click(screen.getByTestId('modal-backdrop'));
    expect(onClose).toHaveBeenCalled();
  });

  it('open=false renders nothing', () => {
    const { container } = render(<NewKhutbahModal open={false} onClose={noop} onSubmitYoutube={noop} onSubmitLocal={noop} onSubmitDual={noop} />);
    expect(container.firstChild).toBeNull();
  });
});
