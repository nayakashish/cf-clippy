import indexHTML from './index.html';
import stylesCSS from './styles.css';

interface Env {
	CLIPBOARD_KV: KVNamespace;
}

interface ClipData {
	text: string;
	isPublic: boolean;
	expiration: string;
	createdAt: number;
}

function generatePhraseId(): string {
	const adjectives = [
		'happy', 'brave', 'calm', 'bright', 'gentle', 'swift', 'wise', 'kind', 'bold', 'clever',
		'quick', 'quiet', 'light', 'soft', 'warm', 'cool', 'fresh', 'lucky', 'strong', 'sweet',
		'shiny', 'fast', 'smooth', 'neat', 'smart', 'funny', 'silly', 'safe', 'brisk', 'clear',
		'fair', 'cute', 'faint', 'firm', 'fine', 'gold', 'green', 'blue', 'red', 'pure',
		'calm', 'loyal', 'free', 'fresh', 'tiny', 'young', 'rich', 'safe', 'cool', 'bright'
	];

	const nouns = [
		'cat', 'dog', 'fox', 'wolf', 'bear', 'lion', 'owl', 'hawk', 'tiger', 'deer',
		'fish', 'frog', 'duck', 'bat', 'ant', 'bee', 'cow', 'pig', 'hen', 'rat',
		'tree', 'leaf', 'rock', 'hill', 'star', 'moon', 'sun', 'cloud', 'rain', 'wave',
		'river', 'pond', 'lake', 'sand', 'wind', 'fire', 'ice', 'snow', 'path', 'field',
		'boat', 'car', 'bike', 'rope', 'door', 'key', 'lamp', 'ring', 'book', 'coin'
	];

	const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
	const noun = nouns[Math.floor(Math.random() * nouns.length)];
	const num = Math.floor(Math.random() * 100);
	return `${adj}-${noun}-${num}`;
}

function getTTL(expiration: string): number | null {
	switch (expiration) {
		case '5m': return 300;
		case '1h': return 3600;
		case '24h': return 86400;
		case 'first': return null;
		default: return 3600;
	}
}

function getRelativeTime(timestamp: number): string {
	const seconds = Math.floor((Date.now() - timestamp) / 1000);
	if (seconds < 60) return 'just now';
	if (seconds < 3600) return Math.floor(seconds / 60) + ' min ago';
	if (seconds < 86400) return Math.floor(seconds / 3600) + ' hr ago';
	return Math.floor(seconds / 86400) + ' days ago';
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);
		const path = url.pathname;

		// Serve main HTML page
		if (path === '/') {
			return new Response(indexHTML, {
				headers: { 'Content-Type': 'text/html' }
			});
		}

		// Serve CSS
		if (path === '/styles.css') {
			return new Response(stylesCSS, {
				headers: { 'Content-Type': 'text/css' }
			});
		}

		// API: Create clip
		if (path === '/api/create' && request.method === 'POST') {
			const data: ClipData = await request.json();

			if (data.isPublic) {
				const id = 'pub_' + Date.now() + '_' + Math.random().toString(36).substring(7);
				const clipData = {
					text: data.text,
					isPublic: true,
					expiration: 'first',
					createdAt: Date.now()
				};

				// Store the clip
				await env.CLIPBOARD_KV.put(id, JSON.stringify(clipData));

				// Also store in a public feed index for faster retrieval
				const feedKey = 'PUBLIC_FEED';
				const existingFeed = await env.CLIPBOARD_KV.get(feedKey);
				const feedItems = existingFeed ? JSON.parse(existingFeed) : [];

				feedItems.unshift({
					id,
					preview: data.text.substring(0, 60) + (data.text.length > 60 ? '...' : ''),
					timestamp: Date.now()
				});

				// Keep only last 50 items in feed
				if (feedItems.length > 50) {
					feedItems.splice(50);
				}

				await env.CLIPBOARD_KV.put(feedKey, JSON.stringify(feedItems));

				return Response.json({ success: true });
			} else {
				let phraseId = generatePhraseId();
				let exists = await env.CLIPBOARD_KV.get(phraseId);
				while (exists) {
					phraseId = generatePhraseId();
					exists = await env.CLIPBOARD_KV.get(phraseId);
				}

				const ttl = getTTL(data.expiration);
				const clipData = {
					text: data.text,
					isPublic: false,
					expiration: data.expiration,
					createdAt: Date.now()
				};

				if (ttl) {
					await env.CLIPBOARD_KV.put(phraseId, JSON.stringify(clipData), { expirationTtl: ttl });
				} else {
					await env.CLIPBOARD_KV.put(phraseId, JSON.stringify(clipData));
				}

				return Response.json({ success: true, phraseId });
			}
		}

		// API: Get public feed
		if (path === '/api/feed' && request.method === 'GET') {
			const feedKey = 'PUBLIC_FEED';
			const feedData = await env.CLIPBOARD_KV.get(feedKey);

			if (!feedData) {
				return Response.json({ clips: [] });
			}

			const feedItems = JSON.parse(feedData);

			// Add relative timestamps
			const clips = feedItems.map((item: any) => ({
				id: item.id,
				preview: item.preview,
				timestamp: getRelativeTime(item.timestamp)
			}));

			return Response.json({ clips });
		}

		// API: Copy from feed
		if (path.startsWith('/api/copy/') && request.method === 'POST') {
			const id = path.replace('/api/copy/', '');
			const data = await env.CLIPBOARD_KV.get(id);

			if (data) {
				const clipData: ClipData = JSON.parse(data);

				// Delete the clip
				await env.CLIPBOARD_KV.delete(id);

				// Remove from public feed index
				const feedKey = 'PUBLIC_FEED';
				const feedData = await env.CLIPBOARD_KV.get(feedKey);
				if (feedData) {
					const feedItems = JSON.parse(feedData);
					const updatedFeed = feedItems.filter((item: any) => item.id !== id);
					await env.CLIPBOARD_KV.put(feedKey, JSON.stringify(updatedFeed));
				}

				return Response.json({ success: true, text: clipData.text });
			}

			return Response.json({ success: false }, { status: 404 });
		}

		// API: Delete clip (admin)
		if (path.startsWith('/api/delete/') && request.method === 'POST') {
			const id = path.replace('/api/delete/', '');
			await env.CLIPBOARD_KV.delete(id);
			return Response.json({ success: true });
		}

		// How it works page
		if (path === '/how-it-works') {
			return new Response(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ClipShare - How It Works</title>
  <link rel="stylesheet" href="/styles.css">
  <script src="https://kit.fontawesome.com/64091c808d.js" crossorigin="anonymous"></script>
</head>
<body>
  <div class="container-lg">
    <div class="how-intro">
      <h1>How ClipShare Works</h1>
      <p>Share text between your devices effortlessly</p>
    </div>

    <div style="margin-bottom: 3rem;">
      <div class="how-section">
        <h3>Quick Transfer (Public Feed)</h3>
        <p class="text-gray-600" style="margin-bottom: 0.75rem;">Perfect for copying text between your own devices in seconds.</p>
        <ol>
          <li>Paste your text on Device 1</li>
          <li>Make sure "Public" is checked</li>
          <li>Click "Create Clip"</li>
          <li>On Device 2, scroll to the Public Feed</li>
          <li>Click "Copy" - it copies and disappears immediately</li>
        </ol>
        <p class="how-note"><i class="fa-solid fa-bolt"></i> Note: Public clips expire after first copy</p>
      </div>

      <div class="how-section">
        <h3>Private Links</h3>
        <p class="text-gray-600" style="margin-bottom: 0.75rem;">Share text with others or access it multiple times.</p>
        <ol>
          <li>Paste your text</li>
          <li>Uncheck "Public"</li>
          <li>Choose expiration time (5 min, 1 hour, 24 hours, or first view)</li>
          <li>Click "Create Clip"</li>
          <li>Share the generated link (like "happy-turtle-42") or scan the QR code</li>
        </ol>
        <p class="how-note"><i class="fa-solid fa-link"></i> Private links can be accessed multiple times until they expire</p>
      </div>

      <div class="how-section">
        <h3>Viewing Clips</h3>
        <p class="text-gray-600" style="margin-bottom: 0.75rem;">When you open a clip link:</p>
        <ul>
          <li><strong>Copy to Clipboard</strong> - Click the button or click the text itself</li>
          <li><strong>View Large</strong> - Opens text in large print with extra spacing (great for short clips)</li>
        </ul>
      </div>

      <div class="how-section">
        <h3>QR Codes</h3>
        <p class="text-gray-600" style="margin-bottom: 0.75rem;">Every private clip generates a QR code automatically.</p>
        <ul>
          <li>Perfect for sending text from computer to phone</li>
          <li>Just scan the QR code with your phone camera</li>
          <li>Opens the clip link directly in your browser</li>
        </ul>
      </div>

      <div class="how-section">
        <h3>Expiration Options</h3>
        <div style="margin-top: 0.75rem;">
		<p class="text-sm text-gray-600"><strong>First view</strong> - One-time access (like a secret)</p>
          <p class="text-sm text-gray-600"><strong>5 minutes</strong> - Quick temporary share</p>
          <p class="text-sm text-gray-600"><strong>1 hour</strong> - Share within a work session</p>
          <p class="text-sm text-gray-600"><strong>24 hours</strong> - Share for the day</p>
        </div>
      </div>

      <div class="how-section">
        <h3>Tips & Tricks</h3>
        <ul>
          <li>Use Public Feed for quick device-to-device transfers</li>
          <li>Use Private Links with "First view" for sensitive info</li>
          <li>Clip IDs are easy to remember (like "happy-turtle-42")</li>
          <li>All clips have a 10,000 character limit</li>
          <li>Expired clips are automatically deleted</li>
        </ul>
      </div>
    </div>

    <div class="text-center">
      <a href="/" class="btn btn-primary btn-lg">
        Start Using ClipShare
      </a>
    </div>
  </div>
    <footer style="text-align: center; padding: 1rem 0; color: #9ca3af; font-size: 0.9rem; background-color: #fafaf9;">
        &copy; 2025 <a href="https://nayakshish.cc" style="color: #9ca3af; text-decoration: none;">ClipShare</a>. All
        rights reserved. <a href="/credits" style="color: #9ca3af; text-decoration: none;">Credits</a>
    </footer>

</body>
</html>`, {
				headers: { 'Content-Type': 'text/html' }
			});
		}

		// Credits page
		if (path === '/credits') {
			return new Response(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ClipShare - Credits</title>
  <link rel="stylesheet" href="/styles.css">
  <script src="https://kit.fontawesome.com/64091c808d.js" crossorigin="anonymous"></script>
  <style>
    .credits-card {
      background-color: #fff;
      padding: 2rem;
      border-radius: 12px;
      box-shadow: 0 6px 20px rgba(0,0,0,0.1);
      margin-bottom: 3rem;
    }
    .credit-text p {
      margin-bottom: 0.5rem;
      color: #6b7280; /* matches your text-gray-600 */
    }
  </style>
</head>
<body>
  <div class="container-lg">
      <div class="how-intro">
        <h1>Credits</h1>
      </div>

      <div class="how-section credit-text text-center">
        <p>&copy; 2025 <strong>ClipShare</strong>. All rights reserved.</p>
        <p>Icons provided by <a href="https://fontawesome.com/" target="_blank">Font Awesome</a>.</p>
        <p>Powered by <a href="https://www.cloudflare.com/" target="_blank">Cloudflare</a> & <a href="https://developers.cloudflare.com/workers/" target="_blank">Cloudflare Workers</a>.</p>
        <p>Page implemented with the help of <a href="https://www.anthropic.com/claude" target="_blank">Anthropic Claude AI</a>.</p>
      </div>

      <div class="text-center">
        <a href="/" class="btn btn-primary btn-lg">Back to Home</a>
      </div>
  </div>
</body>
    <footer style="text-align: center; padding: 1rem 0; color: #9ca3af; font-size: 0.9rem; background-color: #fafaf9;">
        &copy; 2025 <a href="https://nayakshish.cc" style="color: #9ca3af; text-decoration: none;">ClipShare</a>. All
        rights reserved. <a href="/credits" style="color: #9ca3af; text-decoration: none;">Credits</a>
    </footer>

</html>

`, {
				headers: { 'Content-Type': 'text/html' }
			});
		}

		// Admin page
		if (path === '/admin') {
			return new Response(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ClipShare - Admin</title>
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <div class="container-lg">
    <div class="admin-header">
      <h1 style="font-size: 2rem; margin-bottom: 0;">ClipShare Admin</h1>
      <a href="/" class="btn btn-primary">
        Back to Home
      </a>
    </div>

    <div class="admin-panel">
      <h2 style="margin-bottom: 1rem;">All Clips</h2>
      <div id="clipsList"></div>
    </div>
  </div>

  <script>
    async function loadAllClips() {
      try {
        const response = await fetch('/api/admin/list');
        const result = await response.json();

        if (result.clips && result.clips.length > 0) {
          document.getElementById('clipsList').innerHTML = result.clips.map(clip => \`
            <div class="admin-clip">
              <div class="admin-clip-info">
                <div>
                  <span class="admin-clip-id">\${clip.id}</span>
                  <span class="admin-clip-badge \${clip.isPublic ? 'badge-public' : 'badge-private'}">
                    \${clip.isPublic ? 'Public' : 'Private'}
                  </span>
                  <span class="text-xs text-gray-500">\${clip.expiration}</span>
                </div>
                <p class="admin-clip-preview">\${clip.preview}</p>
              </div>
              <div class="admin-actions">
                <a href="/\${clip.id}" target="_blank" class="btn-view">
                  View
                </a>
                <button onclick="deleteClip('\${clip.id}')" class="btn-delete">
                  Delete
                </button>
              </div>
            </div>
          \`).join('');
        } else {
          document.getElementById('clipsList').innerHTML = '<p class="empty-state">No clips found</p>';
        }
      } catch (err) {
        document.getElementById('clipsList').innerHTML = '<p class="empty-state" style="color: #dc2626;">Error loading clips</p>';
      }
    }

    async function deleteClip(id) {
      if (!confirm('Delete this clip?')) return;
      
      try {
        await fetch('/api/delete/' + id, { method: 'POST' });
        loadAllClips();
      } catch (err) {
        alert('Error deleting clip');
      }
    }

    loadAllClips();
  </script>
</body>
</html>`, {
				headers: { 'Content-Type': 'text/html' }
			});
		}

		// API: Admin list all clips
		if (path === '/api/admin/list') {
			const list = await env.CLIPBOARD_KV.list();
			const clips = [];

			for (const key of list.keys) {
				const data = await env.CLIPBOARD_KV.get(key.name);
				if (data) {
					const clipData: ClipData = JSON.parse(data);
					const preview = clipData.text.substring(0, 50) + (clipData.text.length > 50 ? '...' : '');
					clips.push({
						id: key.name,
						isPublic: clipData.isPublic,
						expiration: clipData.expiration,
						preview,
						createdAt: clipData.createdAt
					});
				}
			}

			clips.sort((a, b) => b.createdAt - a.createdAt);
			return Response.json({ clips });
		}

		// View individual clip
		if (path.startsWith('/') && path.length > 1) {
			const phraseId = path.substring(1);
			const data = await env.CLIPBOARD_KV.get(phraseId);

			if (!data) {
				return new Response(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ClipShare - Not Found</title>
  <link rel="stylesheet" href="/styles.css">
</head>
<body class="error-page">
  <div class="error-content">
    <h1>Clip Not Found</h1>
    <p>This clip may have expired or never existed.</p>
    <a href="/" class="btn btn-primary btn-lg" style="text-decoration:none;">
      Create a New Clip
    </a>
  </div>   
</body>
</html>`, {
					status: 404,
					headers: { 'Content-Type': 'text/html' }
				});
			}

			const clipData: ClipData = JSON.parse(data);

			if (clipData.expiration === 'first') {
				await env.CLIPBOARD_KV.delete(phraseId);
			}

			return new Response(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ClipShare - View Clip</title>
  <link rel="stylesheet" href="/styles.css">
  <script src="https://kit.fontawesome.com/64091c808d.js" crossorigin="anonymous"></script>
</head>
<body>
  <div class="main-section">
    <div class="container">
      <pre id="clipContent" class="clip-content">${clipData.text}</pre>
      <div class="clip-actions">
        <button id="copyBtn" class="btn btn-primary btn-lg flex items-center gap-2">
          <svg class="icon" viewBox="0 0 24 24">
            <path d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path>
          </svg>
          Copy to Clipboard
        </button>
        <button id="viewLargeBtn" class="btn btn-secondary btn-lg flex items-center gap-2">
          <svg class="icon" viewBox="0 0 24 24">
            <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7"></path>
          </svg>
          View Large
        </button>
      </div>
    </div>
  </div>

  <!-- Large View Modal -->
  <div id="largeModal" class="modal hidden">
    <div class="modal-content modal-content-lg">
      <div class="modal-header">
        <h3>Large Print View</h3>
        <button id="closeLargeModal" class="modal-close">
			<i class="fa-solid fa-xmark"></i>
        </button>
      </div>
      <pre id="largeContent" class="clip-large"></pre>
      <div class="flex" style="justify-content: center; margin-top: 1.5rem;">
        <button id="copyLargeBtn" class="btn btn-primary btn-lg flex items-center gap-2">
          <svg class="icon" viewBox="0 0 24 24">
            <path d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path>
          </svg>
          Copy to Clipboard
        </button>
      </div>
    </div>
  </div>
          <footer style="text-align: center; padding: 1rem 0; color: #9ca3af; font-size: 0.9rem; background-color: #fafaf9;">
        &copy; 2025 <a href="https://nayakshish.cc" style="color: #9ca3af; text-decoration: none;">ClipShare</a>. All
        rights reserved. <a href="/credits" style="color: #9ca3af; text-decoration: none;">Credits</a>
    </footer>


  <script>
    const content = \`${clipData.text}\`;
    
    async function copyContent(btn) {
      await navigator.clipboard.writeText(content);
      const originalHTML = btn.innerHTML;
      btn.innerHTML = '<svg class="icon" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"></path></svg> Copied!';
      setTimeout(() => {
        btn.innerHTML = originalHTML;
      }, 2000);
    }

    document.getElementById('copyBtn').addEventListener('click', () => copyContent(document.getElementById('copyBtn')));
    
    document.getElementById('clipContent').addEventListener('click', async () => {
      await navigator.clipboard.writeText(content);
      document.getElementById('clipContent').classList.add('copied');
      setTimeout(() => {
        document.getElementById('clipContent').classList.remove('copied');
      }, 500);
    });

    document.getElementById('viewLargeBtn').addEventListener('click', () => {
      document.getElementById('largeContent').textContent = content;
      document.getElementById('largeModal').classList.remove('hidden');
    });

    document.getElementById('closeLargeModal').addEventListener('click', () => {
      document.getElementById('largeModal').classList.add('hidden');
    });

    document.getElementById('copyLargeBtn').addEventListener('click', () => copyContent(document.getElementById('copyLargeBtn')));

    document.getElementById('largeContent').addEventListener('click', async () => {
      await navigator.clipboard.writeText(content);
      document.getElementById('largeContent').classList.add('copied');
      setTimeout(() => {
        document.getElementById('largeContent').classList.remove('copied');
      }, 500);
    });

    // Close modal on escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        document.getElementById('largeModal').classList.add('hidden');
      }
    });
  </script>
</body>
</html>`, {
				headers: { 'Content-Type': 'text/html' }
			});
		}

		return new Response('Not found', { status: 404 });
	}
};