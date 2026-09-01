export function homePath(edgeHostname) {
  return new URL('/api/v1/auth/sso/directory/browser', edgeHostname).toString();
}

/**
 * The Directory-issued assertion is delivered in a top-level POST body. It is
 * deliberately not appended to the Cloudflare URL, history, Referer, or logs.
 */
export function enterHome(home, token, documentRef = document) {
  const form = documentRef.createElement('form');
  form.method = 'POST';
  form.action = homePath(home.edgeHostname);
  form.hidden = true;
  const input = documentRef.createElement('input');
  input.type = 'hidden';
  input.name = 'token';
  input.value = token;
  form.append(input);
  documentRef.body.append(form);
  form.submit();
}