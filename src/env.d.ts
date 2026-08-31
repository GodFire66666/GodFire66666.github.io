/// <reference types="astro/client" />

import type { NavigateOptions } from "astro:transitions/client";

declare global {
  interface Window {
    __yucongNavigate?: (
      href: string,
      options?: NavigateOptions,
    ) => Promise<void>;
    __yucongTransitionController?: AbortController;
  }
}

export {};
