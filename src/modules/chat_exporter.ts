// Interfaces for structure (can be shared)
interface ChatMessage {
  role: string;
  content: string;
  timestamp: string | null;
}

interface ChatExtractionResult {
  content: string;
  filename: string;
  error?: string;
  requiresMarkdownConversion?: boolean;
}


export function isChatSite(url: string): boolean {
  const chatDomains: string[] = [
      "chat.openai.com",
      "gemini.google.com",
      "aistudio.google.com"
  ];
  try {
      const hostname = new URL(url).hostname;
      return chatDomains.some(domain => hostname === domain);
  } catch (e) {
      return false; // Invalid URL
  }
}

// Add parameter type
export function extractChatData(format: 'txt' | 'md' | 'json'): ChatExtractionResult {
  // --- Site-Specific Selectors --- KEEP YOUR SELECTORS HERE
  const selectors: { [key: string]: any } = {
      // ChatGPT (chat.openai.com) support: extract each message group and its content
      "chat.openai.com": {
          // Main chat container
          container: 'main',
          // Each message turn is a group div (user or assistant)
          messageTurn: 'div.group',
          // The message content is within a prose-styled div
          messageContent: 'div.prose',
          // Role and timestamp not currently encoded; roles default to "unknown"
      },
      "gemini.google.com": { container: 'main', messageTurn: '.message', messageContent: '.content .text', roleIndicator: '.participant .name' },
      "aistudio.google.com": { container: 'div.chat-container', messageTurn: 'div.message-row', messageContent: 'div.message-text', roleIndicator: 'div.sender-role' },
  };

  let extractedContent: string = "";
  let filename: string = "chat-export";
  const hostname: string = window.location.hostname;
  const siteConfig = selectors[hostname];
  let requiresMarkdownConversion: boolean = false;

  if (!siteConfig) {
      return { content: "", filename: "error.txt", error: `No selectors defined for ${hostname}. Needs configuration.` };
  }

  try {
      const chatContainer: Element | null = siteConfig.container ? document.querySelector(siteConfig.container) : document.body;
      if (!chatContainer) throw new Error(`Chat container ('${siteConfig.container || 'body'}') not found.`);

      const turns: NodeListOf<Element> = chatContainer.querySelectorAll(siteConfig.messageTurn);
      if (!turns || turns.length === 0) {
           throw new Error(`No chat turns found using selector: "${siteConfig.messageTurn}". Site structure may have changed.`);
      }
      console.log(`Snaggle: Found ${turns.length} chat turns/messages using "${siteConfig.messageTurn}".`);

      const chatData: ChatMessage[] = []; // Use interface

      turns.forEach((turn: Element, index: number) => {
          let role: string = "unknown";
          let textContent: string = "";
          let timestamp: string | null = null; // Explicitly null

          // --- Extract Role --- (Add types to elements)
          let roleElement: Element | null = siteConfig.roleSelector ? turn.querySelector(siteConfig.roleSelector) : null;
          if (roleElement && siteConfig.roleAttribute) {
               role = roleElement.getAttribute(siteConfig.roleAttribute) || "unknown";
          } else if (siteConfig.roleIndicator) {
               const roleIndicatorElement: Element | null = turn.querySelector(siteConfig.roleIndicator);
               if (roleIndicatorElement) role = roleIndicatorElement.textContent?.trim().toLowerCase() || "unknown";
          }
          role = role.replace(/^model$/i, "assistant");

          // --- Extract Timestamp --- (Add types to elements)
           if (siteConfig.timestampSelector) {
              const timeElement: Element | null = turn.querySelector(siteConfig.timestampSelector);
              if (timeElement) {
                  timestamp = siteConfig.timestampAttribute ? timeElement.getAttribute(siteConfig.timestampAttribute) : timeElement.textContent;
                  timestamp = timestamp ? timestamp.trim() : null;
              }
           }

          // --- Extract Content --- (Add types to elements)
          const contentElement: HTMLElement | null = turn.querySelector(siteConfig.messageContent); // Use HTMLElement for innerText/innerHTML
          if (contentElement) {
               if (format === 'md') {
                   textContent = contentElement.innerHTML;
                   requiresMarkdownConversion = true;
               } else {
                   textContent = contentElement.innerText;
               }
          } else {
              console.warn("Snaggle: Message content selector failed for a turn, using turn's innerText fallback.");
               // Use HTMLElement for innerText
              textContent = (turn as HTMLElement).innerText;
              if (format === 'md') requiresMarkdownConversion = false;
          }
          textContent = textContent ? textContent.trim() : "";

          if (!textContent) {
              console.log(`Snaggle: Skipping turn ${index} due to empty content.`);
              return; // Skip this iteration
          }

          // --- Assemble Output ---
          if (format === 'json') {
              chatData.push({ role, content: textContent, timestamp });
          } else if (format === 'txt') {
              extractedContent += `Role: ${role}\n`;
              if (timestamp) extractedContent += `Time: ${timestamp}\n`;
              extractedContent += `Content:\n${textContent}\n\n---\n\n`;
          } else if (format === 'md') {
               extractedContent += `**${role.toUpperCase()}**${timestamp ? ` (_${timestamp}_)` : ''}:\n\n`;
               extractedContent += `${textContent}\n\n`;
               extractedContent += `***\n\n`;
          }
      });

      const dateStr: string = new Date().toISOString().replace(/[:.]/g, '-');
      filename = `${hostname.split('.')[0]}-chat-${dateStr}`;

      if (format === 'json') {
          extractedContent = JSON.stringify(chatData, null, 2);
          filename += '.json';
      } else if (format === 'txt') {
          filename += '.txt';
      } else if (format === 'md') {
          filename += '.md';
      }

      return {
          content: extractedContent,
          filename: filename,
          requiresMarkdownConversion: format === 'md' && requiresMarkdownConversion
      };

  } catch (error: any) {
      console.error("Snaggle Chat Extraction Error:", error);
      return { content: "", filename:"error.txt", error: `Failed to extract chat: ${error?.message ?? 'Unknown error'}` };
  }
}