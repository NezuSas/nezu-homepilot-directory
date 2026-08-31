export interface HomeNavigation { assign(url: string): void; }
export function enterHome(homeId: string, navigation?: HomeNavigation): void;
export function homePath(homeId: string): string;