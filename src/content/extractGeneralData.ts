// src/content/extractGeneralData.ts

interface PageExtractionResult {
    content: string;
    error?: string;
    requiresMarkdownConversion?: boolean;
  }

  /**
   * Runs inside the target page and returns extracted content.
   */
  export function extractDataForInjection(): PageExtractionResult {
    const format = 'md'; // hard‑coded for now

    try {
      if (!document.body) throw new Error('Document body not found.');

      let content = '';
      let requiresMarkdownConversion = false;

      // Always use “md” path
      const source =
        document.querySelector('main') ||
        document.querySelector('article') ||
        document.querySelector('[role="main"]') ||
        document.body;

      if (!source) throw new Error('Main content element not found.');

      const clone = source.cloneNode(true) as Element;
      const removeSel = [
        'script',
        'style',
        'link',
        'meta',
        'noscript',
        'svg',
        'iframe',
        'header',
        'footer',
        'nav',
        'aside',
        '[role="banner"]',
        '[role="contentinfo"]',
        '[role="navigation"]',
        '[role="complementary"]',
        'button',
        'input',
        'select',
        'textarea',
        '.advertisement',
        '.ad',
        '#ad',
        '[class*="banner"]',
        '.popup',
        '.modal',
        '#cookie-notice',
        '.cookie-consent'
      ];

      clone.querySelectorAll(removeSel.join(',')).forEach((el) => el.remove());

      content = clone.innerHTML.trim();
      requiresMarkdownConversion = true;

      return { content, requiresMarkdownConversion };
    } catch (err: any) {
      return {
        content: '',
        error: `Failed to extract page data: ${err?.message ?? 'Unknown error'}`
      };
    }
  }
