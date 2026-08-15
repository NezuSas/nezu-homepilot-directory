export function enterHome(edgeHostname, navigation = window.location) {
  navigation.assign(edgeHostname);
}

export function ssoTokenRequestPath(homeId) {
  return `/directory/homes/${encodeURIComponent(homeId)}/sso-token`;
}

export function ssoRedirectUrl(edgeHostname, token) {
  return `${edgeHostname}/sso/directory?token=${encodeURIComponent(token)}`;
}
