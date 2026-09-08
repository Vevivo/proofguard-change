export {};

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
      on?: (event: string, listener: (value: unknown) => void) => void;
      removeListener?: (event: string, listener: (value: unknown) => void) => void;
    };
  }
}
