/**
 * Construct a `khutbah-file://` URL from an absolute filesystem path.
 *
 * Encodes per-segment so reserved URL characters in the filename — especially
 * brackets ([id]), spaces, fullwidth bars (｜), and assorted Unicode — don't
 * trip Chromium's URL parser. Without this, paths like
 *   /home/user/khutbah [QGxYiaz45Co].mp4.proxy.mp4
 * would yield a URL Chromium silently refuses to load (brackets are reserved
 * for IPv6 host syntax), and the <video> element shows broken/disabled
 * controls — exactly the "I can't control anything" symptom the user hit.
 *
 * Slashes are preserved; everything else in each path segment is URL-encoded
 * via encodeURIComponent. Drive letters on Windows (`C:/...`) need a leading
 * slash before the colon; we add it if absent so the URL has a non-empty host
 * authority section.
 */
export function toKhutbahFileUrl(absolutePath: string): string {
  // Normalise Windows backslashes to forward slashes for URL building.
  const normalized = absolutePath.replace(/\\/g, '/');
  const withLeadingSlash = normalized.startsWith('/') ? normalized : '/' + normalized;
  const encoded = withLeadingSlash
    .split('/')
    .map((seg, i) => (i === 0 ? seg : encodeURIComponent(seg)))
    .join('/');
  return `khutbah-file://${encoded}`;
}
