export interface HomeNavigation { assign(url: string): void; }
export function enterHome(edgeHostname: string, navigation?: HomeNavigation): void;
export function ssoTokenRequestPath(homeId: string): string;
export function ssoRedirectUrl(edgeHostname: string, token: string): string;
