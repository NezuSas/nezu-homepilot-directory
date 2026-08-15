export interface HomeNavigation { assign(url: string): void; }
export function enterHome(edgeHostname: string, navigation?: HomeNavigation): void;
