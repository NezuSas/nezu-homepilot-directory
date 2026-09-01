export interface HomeNavigation {
  assign(path: string): void;
}
export interface HomeTarget {
  edgeHostname: string;
}
export interface HomeDocument {
  createElement(name: string): HTMLFormElement | HTMLInputElement;
  body: { append(node: HTMLFormElement): void; };
}
export function enterHome(home: HomeTarget, token: string, documentRef?: HomeDocument): void;
export function homePath(edgeHostname: string): string;