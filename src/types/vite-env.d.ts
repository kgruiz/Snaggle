/// <reference types="vite/client" />

// Declare modules ending with '?raw' to load as strings
declare module '*?raw' {
    const content: string;
    export default content;
  }

  // You might need to add declarations for other Vite-specific imports here in the future
  // if you use different query parameters or features.