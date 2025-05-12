// src/utils/site_checkers.ts

/** Checks if the URL is a known chat site. Safe for background script. */
export function isChatSite(url: string): boolean {
    const chatDomains: string[] = [
      "chatgpt.com",
      "gemini.google.com",
      "aistudio.google.com"
      // Add other chat domains here if needed
    ];
    try {
      const hostname = new URL(url).hostname;
      return chatDomains.some(domain => hostname === domain);
    } catch (e) {
      console.warn("isChatSite check failed for URL:", url, e);
      return false; // Invalid URL or other error
    }
  }

  /** Checks if the URL is a GitHub repository page. Safe for background script. */
  export function isGitHubRepoPage(urlString: string): boolean {
      try {
          const url = new URL(urlString);
          if (url.hostname !== 'github.com') return false;
          const pathParts = url.pathname.split('/').filter(Boolean);
          // Basic check: Must have at least owner/repo
          return pathParts.length >= 2;
      } catch (e) {
          console.warn("isGitHubRepoPage check failed for URL:", urlString, e);
          return false; // Invalid URL or other error
      }
  }

  /** Checks if the URL is a general HTTP/HTTPS/File page. Safe for background script. */
  export function isGeneralSite(url: string): boolean {
       try {
          const protocol = new URL(url).protocol;
          // Allow file:// for local testing/usage if needed
          return protocol === 'http:' || protocol === 'https:' || protocol === 'file:';
      } catch (e) {
          console.warn("isGeneralSite check failed for URL:", url, e);
          return false; // Invalid URL or other error
       }
  }