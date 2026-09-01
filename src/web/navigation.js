export function homePath(homeId) {
  return `/homes/${encodeURIComponent(homeId)}/console`;
}

export function enterHome(homeId, navigation = window.location) {
  if (typeof window !== 'undefined') {
    const token = window.localStorage.getItem('directory_token');
    if (token) window.localStorage.setItem('hp_session_token', token);
  }
  navigation.assign(homePath(homeId));
}