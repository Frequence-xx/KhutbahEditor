import { shell } from 'electron';
import http from 'http';
import crypto from 'crypto';
import { URL } from 'url';
import { tokens } from './keychain.js';
import { accounts, YouTubeAccount } from './accounts.js';

// Embedded — public client id is fine for desktop OAuth (no secret needed with PKCE)
const CLIENT_ID: string =
  process.env.GOOGLE_OAUTH_CLIENT_ID || 'PLACEHOLDER_CLIENT_ID.apps.googleusercontent.com';
const SCOPES: string = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube',
].join(' ');

type PkcePair = { verifier: string; challenge: string };

function pkce(): PkcePair {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export type OAuthTokens = {
  accessToken: string;
  expiresAt: number;
  addedAccounts?: YouTubeAccount[];
};

type GoogleTokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  token_type: string;
  scope?: string;
};

type ChannelListResponse = {
  items?: Array<{
    id: string;
    snippet: {
      title: string;
      thumbnails?: {
        default?: { url: string };
      };
    };
  }>;
};

export async function signInWithGoogle(): Promise<OAuthTokens> {
  const { verifier, challenge } = pkce();

  // CSRF protection: random state token. Must round-trip via Google.
  const state = crypto.randomBytes(16).toString('base64url');

  // Bind a single ephemeral port and KEEP the server alive for the callback.
  // (The plan's "open a server, close it, open another" pattern has a TOCTOU
  // race where the port can be stolen between the two binds. We bind once.)
  const server = http.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('Failed to bind OAuth callback server');
  }
  const port = address.port;
  const redirectUri = `http://127.0.0.1:${port}/callback`;

  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', SCOPES);
  authUrl.searchParams.set('code_challenge', challenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('prompt', 'consent');
  authUrl.searchParams.set('state', state);

  // 5-minute hard timeout on the entire OAuth dance — protects against a user
  // who walks away mid-flow leaving the loopback server bound forever.
  const TIMEOUT_MS = 5 * 60 * 1000;

  const code: string = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      server.close();
      reject(new Error('OAuth timeout — sign-in took longer than 5 minutes'));
    }, TIMEOUT_MS);

    server.on('request', (req, res) => {
      // Reject any path other than /callback — defense in depth against
      // localhost CSRF / unrelated services pointing at the same port.
      const u = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
      if (u.pathname !== '/callback') {
        res.writeHead(404);
        res.end();
        return;
      }
      const c = u.searchParams.get('code');
      const err = u.searchParams.get('error');
      const returnedState = u.searchParams.get('state');

      // CSRF check: returned state must match what we sent.
      if (returnedState !== state) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Invalid state parameter — possible CSRF attempt.');
        clearTimeout(timer);
        server.close();
        reject(new Error('OAuth state mismatch — possible CSRF attempt'));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(
        `<!doctype html><html><body style="font-family:system-ui;background:#0C1118;color:#F5E9C8;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
          <div><h1>${err ? '&#x2715; Sign-in failed' : '&#x2713; Signed in to KhutbahEditor'}</h1>
          <p>You can close this window.</p></div>
        </body></html>`,
      );

      clearTimeout(timer);
      server.close();
      if (err) reject(new Error(`OAuth error: ${err}`));
      else if (c) resolve(c);
      else reject(new Error('OAuth callback received no code or error'));
    });

    shell.openExternal(authUrl.toString()).catch((e) => {
      clearTimeout(timer);
      server.close();
      reject(e);
    });
  });

  // Exchange code + verifier for tokens
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: CLIENT_ID,
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
    }),
  });
  if (!tokenRes.ok) {
    throw new Error(`Token exchange failed: ${tokenRes.status} ${await tokenRes.text()}`);
  }
  const t: GoogleTokenResponse = await tokenRes.json();
  if (!t.refresh_token) {
    throw new Error(
      'Google did not return a refresh_token. Re-add this Google account in Settings → Sign out, then sign in again.',
    );
  }

  // MULTI-ACCOUNT: discover all channels owned by this Google account, store
  // refresh token + account record per channel. (One Google account → N YouTube
  // channels share the same OAuth grant; channelId is the account primary key.)
  const channelsRes = await fetch(
    'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true',
    { headers: { Authorization: `Bearer ${t.access_token}` } },
  );
  if (!channelsRes.ok) {
    throw new Error(
      `Channel list failed: ${channelsRes.status} ${await channelsRes.text()}`,
    );
  }
  const channels: ChannelListResponse = await channelsRes.json();
  const items = channels.items ?? [];

  if (items.length === 0) {
    throw new Error(
      'This Google account has no YouTube channels. Create a channel at youtube.com first, then sign in again.',
    );
  }

  const isFirstAccountEver = accounts.list().length === 0;
  const added: YouTubeAccount[] = [];
  for (const ch of items) {
    await tokens.set(ch.id, t.refresh_token);
    const rec: YouTubeAccount = {
      channelId: ch.id,
      channelTitle: ch.snippet.title,
      thumbnailUrl: ch.snippet.thumbnails?.default?.url ?? '',
      signedInAt: Date.now(),
      autoPublish: isFirstAccountEver,
    };
    accounts.upsert(rec);
    added.push(rec);
  }

  return {
    accessToken: t.access_token,
    expiresAt: Date.now() + (t.expires_in - 60) * 1000,
    addedAccounts: added,
  };
}

export async function ensureAccessToken(channelId: string): Promise<OAuthTokens> {
  const refresh = await tokens.get(channelId);
  if (!refresh) throw new Error(`not_signed_in:${channelId}`);
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: CLIENT_ID,
      refresh_token: refresh,
    }),
  });
  if (!r.ok) {
    const body = await r.text();
    throw new Error(`Refresh failed for ${channelId}: ${r.status} ${body}`);
  }
  const t: GoogleTokenResponse = await r.json();
  return {
    accessToken: t.access_token,
    expiresAt: Date.now() + (t.expires_in - 60) * 1000,
  };
}

export async function signOutAccount(channelId: string): Promise<void> {
  await tokens.clear(channelId);
  accounts.remove(channelId);
}

export function listAccounts(): YouTubeAccount[] {
  return accounts.list();
}
