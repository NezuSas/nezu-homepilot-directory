export function enterHome(edgeHostname, navigation = window.location) {
  navigation.assign(edgeHostname);
}
