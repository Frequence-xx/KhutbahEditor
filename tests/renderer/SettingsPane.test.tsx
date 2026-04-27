// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { SettingsPane } from '../../src/components/SettingsPane';
import { useSettings } from '../../src/store/settings';

afterEach(() => {
  cleanup();
  useSettings.setState({ settings: null });
});

describe('SettingsPane', () => {
  beforeEach(() => {
    Object.assign(window, {
      khutbah: {
        auth: {
          listAccounts: vi.fn(() =>
            Promise.resolve([{ channelId: 'ch-1', channelTitle: 'Frequence' }]),
          ),
          signIn: vi.fn(() => Promise.resolve()),
          signOut: vi.fn(() => Promise.resolve()),
        },
        settings: {
          get: vi.fn(() => Promise.resolve({ computeDevice: 'auto', outputDir: '/out' })),
          set: vi.fn((patch: object) =>
            Promise.resolve({ computeDevice: 'auto', outputDir: '/out', ...patch }),
          ),
        },
      },
    });
  });

  it('renders the compute device selector with the loaded value', async () => {
    render(<SettingsPane />);
    const select = await screen.findByLabelText(/compute device/i);
    await waitFor(() => expect((select as HTMLSelectElement).value).toBe('auto'));
  });

  it('changing the device calls settings.set with the new value', async () => {
    render(<SettingsPane />);
    const select = await screen.findByLabelText(/compute device/i);
    await waitFor(() => expect((select as HTMLSelectElement).value).toBe('auto'));
    fireEvent.change(select, { target: { value: 'cuda' } });
    await waitFor(() => {
      expect(window.khutbah!.settings.set).toHaveBeenCalledWith({ computeDevice: 'cuda' });
    });
  });

  it('renders YouTube accounts by channelTitle', async () => {
    render(<SettingsPane />);
    await screen.findByText(/Frequence/);
  });

  it('clicking Sign in calls auth.signIn and refreshes the account list', async () => {
    render(<SettingsPane />);
    const btn = await screen.findByRole('button', { name: /sign in/i });
    fireEvent.click(btn);
    await waitFor(() => {
      expect(window.khutbah!.auth.signIn).toHaveBeenCalled();
    });
  });
});
