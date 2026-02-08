/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

import { build, files, version } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;

const CACHE_NAME = `skyboard-${version}`;
const CDN_CACHE_NAME = 'skyboard-cdn';

// Hashed build assets (JS/CSS) + static files (icons, manifest, etc.)
const PRECACHE_ASSETS = [...build, ...files];

// Install: precache all assets + the SPA shell
sw.addEventListener('install', (event) => {
	event.waitUntil(
		caches.open(CACHE_NAME).then(async (cache) => {
			await cache.addAll(PRECACHE_ASSETS);
			// Cache the SPA shell so navigation works offline
			await cache.add('/');
		})
	);
});

// Activate: delete old caches and take control immediately
sw.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) =>
				Promise.all(
					keys
						.filter((key) => key !== CACHE_NAME && key !== CDN_CACHE_NAME)
						.map((key) => caches.delete(key))
				)
			)
			.then(() => sw.clients.claim())
	);
});

// Fetch: cache-first for assets, network-first for navigation
sw.addEventListener('fetch', (event) => {
	const { request } = event;

	if (request.method !== 'GET') return;

	const url = new URL(request.url);

	// Cache Bluesky CDN images (avatars etc.) — content-addressed, so immutable
	// These are loaded by <img> tags as no-cors requests, producing opaque responses
	// (type === 'opaque', status === 0). Opaque responses are cacheable.
	if (url.hostname === 'cdn.bsky.app') {
		event.respondWith(
			caches.match(request).then(
				(cached) =>
					cached ||
					fetch(request)
						.then((response) => {
							if (response.ok || response.type === 'opaque') {
								const clone = response.clone();
								caches.open(CDN_CACHE_NAME).then((cache) => cache.put(request, clone));
							}
							return response;
						})
						.catch(() => new Response('', { status: 408, statusText: 'Offline' }))
			)
		);
		return;
	}

	// Skip other cross-origin requests (AT Protocol PDS, Bluesky API, OAuth servers)
	if (url.origin !== sw.location.origin) return;

	if (request.mode === 'navigate') {
		// Navigation: try network first, fall back to cached SPA shell
		event.respondWith(
			fetch(request)
				.then((response) => {
					const clone = response.clone();
					caches.open(CACHE_NAME).then((cache) => cache.put('/', clone));
					return response;
				})
				.catch(() =>
					caches.match('/').then(
						(cached) =>
							cached ||
							new Response('Offline', {
								status: 503,
								headers: { 'Content-Type': 'text/plain' }
							})
					)
				)
		);
		return;
	}

	// All other same-origin GET requests: cache-first
	event.respondWith(
		caches.match(request).then((cached) => {
			return cached || fetch(request);
		})
	);
});
