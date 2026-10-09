// Minimal local declarations keep the browser UI typecheckable without adding packages.
declare module "react" {
  export type SetStateAction<S> = S | ((previous: S) => S);
  export type Dispatch<A> = (value: A) => void;
  export function useState(initialState: null): [any, Dispatch<any>];
  export function useState(initialState: never[]): [any[], Dispatch<any>];
  export function useState<S>(initialState: S | (() => S)): [S, Dispatch<SetStateAction<S>>];
  export function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
  export function useRef<T = any>(initialValue?: T | null): { current: T | null };
  const React: { createElement: (...args: any[]) => any };
  export default React;
}
declare module "react-dom/client" {
  export function createRoot(container: Element | DocumentFragment | null): { render(children: any): void };
}
declare module "lucide-react";
declare module "react/jsx-runtime" {
  export const jsx: any;
  export const jsxs: any;
  export const Fragment: any;
}
declare module "*.css";
interface Window { __ksWaitingWorker?: ServiceWorker; }
declare namespace JSX {
  interface Element {}
  interface IntrinsicAttributes { key?: string | number; }
  interface IntrinsicElements { [elementName: string]: any; }
}
