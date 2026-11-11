export function lisbonPublishLabel(date) {
  const formatted = new Intl.DateTimeFormat('pt-PT', {
    timeZone: 'Europe/Lisbon',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
  return `${formatted} · Lisboa`;
}

export function isPublishedPage() {
  return window.location.pathname.endsWith('/publicado.html');
}

export async function loadPublished() {
  const response = await fetch('/api/publicar', { cache: 'no-store' });
  if (!response.ok) throw new Error('publicar');
  return response.json();
}

export async function savePublished(data) {
  const response = await fetch('/api/publicar', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...data, label: lisbonPublishLabel(new Date()) }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.published) throw new Error(payload.error || 'publicar');
  return payload;
}
