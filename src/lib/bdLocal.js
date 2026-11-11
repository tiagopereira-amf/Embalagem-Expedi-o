const PATH_KEY = 'embexp.bd.path.v1';

function localToken() {
  return document.querySelector('meta[name="publicar-local"]')?.getAttribute('content') || '';
}

function localHeaders(json) {
  const token = localToken();
  const headers = {};
  if (token) headers['x-publicar-token'] = token;
  if (json) headers['content-type'] = 'application/json';
  return headers;
}

export function rememberedBdPath() {
  try {
    return localStorage.getItem(PATH_KEY) || '';
  } catch {
    return '';
  }
}

function rememberBdPath(path) {
  try {
    if (path) localStorage.setItem(PATH_KEY, path);
    else localStorage.removeItem(PATH_KEY);
  } catch {
    /* o browser pode recusar o armazenamento; o servidor fica com o caminho */
  }
}

export async function saveBdPath(path) {
  const response = await fetch('/api/ficheiro-bd', {
    method: 'PUT',
    headers: localHeaders(true),
    body: JSON.stringify({ path }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.path) throw new Error(payload.error || 'Não foi possível guardar o caminho do ficheiro BD.');
  rememberBdPath(payload.path);
  return payload.path;
}

export async function refreshBdFile() {
  const response = await fetch('/api/ficheiro-bd/atualizar', {
    method: 'POST',
    headers: localHeaders(false),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) throw new Error(payload.error || 'Não foi possível atualizar o ficheiro BD.');
  const fileResponse = await fetch('/api/ficheiro-bd', {
    cache: 'no-store',
    headers: localHeaders(false),
  });
  if (!fileResponse.ok) throw new Error('O ficheiro BD foi atualizado, mas não foi possível lê-lo.');
  const blob = await fileResponse.blob();
  const name = payload.name || 'picagens.xlsx';
  return new File([blob], name, {
    type: blob.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}
