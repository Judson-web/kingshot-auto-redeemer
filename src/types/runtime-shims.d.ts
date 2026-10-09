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
declare module "lucide-react" {
  export interface IconProps {
    size?: number | string;
    color?: string;
    strokeWidth?: number;
    absoluteStrokeWidth?: boolean;
    className?: string;
    role?: string;
    "aria-hidden"?: boolean | "true" | "false";
  }
  export type IconComponent = (props: IconProps) => JSX.Element;
  export const ExternalLink: IconComponent;
  export const Gift: IconComponent;
  export const Menu: IconComponent;
  export const Search: IconComponent;
  export const ShieldCheck: IconComponent;
  export const X: IconComponent;
  export const CheckCircle: IconComponent;
  export const LoaderCircle: IconComponent;
  export const AlertTriangle: IconComponent;
  export const Info: IconComponent;
  export const OctagonAlert: IconComponent;
  export const ArrowRight: IconComponent;
  export const Copy: IconComponent;
  export const Activity: IconComponent;
  export const Wrench: IconComponent;
  export const WifiOff: IconComponent;
  export const ArrowLeft: IconComponent;
  export const Clock3: IconComponent;
  export const Database: IconComponent;
  export const History: IconComponent;
  export const LockKeyhole: IconComponent;
  export const RefreshCw: IconComponent;
  export const Sparkles: IconComponent;
  export const Zap: IconComponent;
  export const LogOut: IconComponent;
  export const Send: IconComponent;
  export const Eye: IconComponent;
  export const EyeOff: IconComponent;
  export const RotateCcw: IconComponent;
  export const Palette: IconComponent;
  export const Image: IconComponent;
  export const Megaphone: IconComponent;
}
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
