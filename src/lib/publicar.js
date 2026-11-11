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
  try {
    const response = await fetch('/api/publicar', { cache: 'no-store' });
    if (response.ok) {
      const data = await response.json();
      if (data?.published) return data;
    }
  } catch {
    /* o alojamento estático não tem a rota; usa o ficheiro da última publicação */
  }
  try {
    const response = await fetch('/semana-publicada.json', { cache: 'no-store' });
    if (!response.ok) return { published: false };
    return response.json();
  } catch {
    return { published: false };
  }
}

export async function savePublished(data) {
  const token = document.querySelector('meta[name="publicar-local"]')?.getAttribute('content') || '';
  if (!token) throw new Error('publicar');
  const response = await fetch('/api/publicar', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-publicar-token': token },
    body: JSON.stringify({ ...data, label: lisbonPublishLabel(new Date()) }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.published) throw new Error(payload.error || 'publicar');
  return payload;
}
