// src/types/vite-env.d.ts
/// <reference types="vite/client" />

// Declare modules ending with '?raw' to load as strings
declare module '*?raw' {
  const content: string;
  export default content;
}