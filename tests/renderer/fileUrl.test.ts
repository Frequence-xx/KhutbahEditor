import { describe, it, expect } from 'vitest';
import { toKhutbahFileUrl } from '../../src/lib/fileUrl';

describe('toKhutbahFileUrl', () => {
  it('encodes spaces in filenames', () => {
    expect(toKhutbahFileUrl('/home/u/khutbah file.mp4')).toBe(
      'khutbah-file:///home/u/khutbah%20file.mp4',
    );
  });

  it('encodes URL-reserved brackets — the actual bug from real-world paths', () => {
    expect(toKhutbahFileUrl('/home/u/clip [QGxYiaz45Co].mp4')).toBe(
      'khutbah-file:///home/u/clip%20%5BQGxYiaz45Co%5D.mp4',
    );
  });

  it('encodes the fullwidth bar | used by yt-dlp output templates', () => {
    expect(toKhutbahFileUrl('/home/u/De Eeuwig｜Ustaadh.mp4')).toBe(
      'khutbah-file:///home/u/De%20Eeuwig%EF%BD%9CUstaadh.mp4',
    );
  });

  it('preserves slashes', () => {
    expect(toKhutbahFileUrl('/a/b/c.mp4')).toBe('khutbah-file:///a/b/c.mp4');
  });

  it('normalises Windows backslashes', () => {
    expect(toKhutbahFileUrl('C:\\Users\\u\\clip.mp4')).toBe(
      'khutbah-file:///C%3A/Users/u/clip.mp4',
    );
  });
});
