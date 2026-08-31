export function homePath(homeId) {
  return `/homes/${encodeURIComponent(homeId)}`;
}

export function enterHome(homeId, navigation = window.location) {
  navigation.assign(homePath(homeId));
}