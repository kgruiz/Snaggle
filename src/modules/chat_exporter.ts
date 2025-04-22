// src/modules/chat_exporter.ts

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

  // isChatSite function removed - it's now in src/utils/site_checkers.ts

  // This function is intended to be run IN THE PAGE via scripting.executeScript
  export function extractChatData(format: 'txt' | 'md' | 'json'): ChatExtractionResult {
    // --- Site-Specific Selectors --- KEEP YOUR SELECTORS HERE
    const selectors: { [key: string]: any } = {
        // ChatGPT (chat.openai.com) support: extract each message group and its content
        "chat.openai.com": {
            container: 'main', // Main area containing the chat
            messageTurn: 'div[data-testid^="conversation-turn-"]', // More specific selector for turns
            messageContent: 'div.prose', // Content within the turn
            roleIndicator: null, // Role is often implicit or needs parent inspection
            roleAttribute: null, // No direct attribute usually
            timestampSelector: null, // No reliable timestamp selector usually
            // Function to determine role based on turn element (example)
            getRole: (turnElement: Element): string => {
                // Look for specific classes or structures indicating user vs assistant
                // This might need adjustment based on current ChatGPT structure
                const userIcon = turnElement.querySelector('img[alt="User"]'); // Or similar identifier
                if (userIcon) return 'user';
                // Check for assistant indicators
                const assistantProse = turnElement.querySelector('.markdown.prose');
                if(assistantProse) return 'assistant';
                return 'unknown'; // Default
            }
        },
        "gemini.google.com": {
            container: 'main', // Or a more specific chat container if available
            messageTurn: '.message', // Or '.query-container', '.candidate-container' etc.
            messageContent: '.content .text, .markdown', // Check for text or markdown content areas
            roleIndicator: '.participant .name', // Or similar for role text
            timestampSelector: null, // Timestamps might be harder to grab reliably
            getRole: (turnElement: Element): string => {
                const roleEl = turnElement.querySelector('.participant .name');
                const roleText = roleEl?.textContent?.trim().toLowerCase();
                if (roleText === 'user' || roleText?.includes('you')) return 'user';
                if (roleText === 'gemini' || roleText?.includes('model')) return 'assistant';
                return 'unknown';
            }
        },
        "aistudio.google.com": {
            container: 'div.chat-container',
            messageTurn: 'div.message-row',
            messageContent: 'div.message-text',
            roleIndicator: 'div.sender-role',
            timestampSelector: null, // Timestamps not obviously available
            getRole: (turnElement: Element): string => {
                const roleEl = turnElement.querySelector('div.sender-role');
                const roleText = roleEl?.textContent?.trim().toLowerCase();
                if (roleText === 'user') return 'user';
                if (roleText === 'model') return 'assistant';
                return 'unknown';
            }
         },
         // Add more site configurations here
    };

    let extractedContent: string = "";
    let filename: string = "chat-export";
    // ***** Get hostname *inside* the function *****
    let hostname: string = "unknown-host";
    try {
        // Check if running in a context where window is defined (content script)
        if (typeof window !== 'undefined' && window.location) {
           hostname = window.location.hostname;
        } else {
           // Cannot determine hostname if window is not available (should not happen if injected)
           throw new Error("window.location is not accessible in this context.");
        }
    } catch (e: any) {
         console.error("Snaggle extractChatData: Failed to get window.location.hostname", e);
         return { content: "", filename: "error.txt", error: `Could not determine hostname: ${e.message}` };
    }

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
             // Fallback if no turns found
             const hasContent = chatContainer.textContent && chatContainer.textContent.trim().length > 50; // Heuristic
             if(hasContent) {
                  console.warn(`Snaggle: No chat turns found using selector: "${siteConfig.messageTurn}", but container has content. Falling back to container's content.`);
                  if (format === 'md') {
                      extractedContent = (chatContainer as HTMLElement).innerHTML.trim();
                      requiresMarkdownConversion = true; // Needs conversion
                  } else { // txt or json (treat json as txt here as structure is lost)
                      extractedContent = (chatContainer as HTMLElement).innerText.trim();
                  }
             } else {
                 throw new Error(`No chat turns found using selector: "${siteConfig.messageTurn}". Site structure may have changed.`);
             }
        }

        const chatData: ChatMessage[] = []; // Use interface

        // Only loop if we didn't use the fallback above
        if (extractedContent === "") {
          turns.forEach((turn: Element, index: number) => {
              let role: string = "unknown";
              let textContent: string = "";
              let timestamp: string | null = null; // Explicitly null

              // --- Extract Role using config ---
              if (siteConfig.getRole && typeof siteConfig.getRole === 'function') {
                  role = siteConfig.getRole(turn);
              } else if (siteConfig.roleIndicator) {
                   const roleIndicatorElement: Element | null = turn.querySelector(siteConfig.roleIndicator);
                   if (roleIndicatorElement) role = roleIndicatorElement.textContent?.trim().toLowerCase() || "unknown";
                   // Standardize role names
                   role = role.replace(/^model$/i, "assistant").replace(/^user$/i, "user");
              } else if (siteConfig.roleAttribute) {
                   role = turn.getAttribute(siteConfig.roleAttribute) || "unknown";
              }


              // --- Extract Timestamp ---
               if (siteConfig.timestampSelector) {
                  const timeElement: Element | null = turn.querySelector(siteConfig.timestampSelector);
                  if (timeElement) {
                      timestamp = siteConfig.timestampAttribute ? timeElement.getAttribute(siteConfig.timestampAttribute) : timeElement.textContent;
                      timestamp = timestamp ? timestamp.trim() : null;
                  }
               }

              // --- Extract Content ---
              const contentElement: HTMLElement | null = turn.querySelector(siteConfig.messageContent);
              if (contentElement) {
                   if (format === 'md') {
                       textContent = contentElement.innerHTML; // Get HTML for potential conversion
                       requiresMarkdownConversion = true;
                   } else {
                       textContent = contentElement.innerText; // Get plain text
                   }
              } else {
                  // If content selector fails, maybe the turn *is* the content?
                  console.warn(`Snaggle: Message content selector ('${siteConfig.messageContent}') failed for turn ${index}, using turn's innerText fallback.`);
                  textContent = (turn as HTMLElement).innerText;
                  if (format === 'md') requiresMarkdownConversion = false; // Can't convert if we only got innerText
              }
              textContent = textContent ? textContent.trim() : "";

              // Skip if no content extracted for this turn
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
                   extractedContent += `${textContent}\n\n`; // Content might be HTML here
                   extractedContent += `***\n\n`;
              }
          });
        } // End if (extractedContent === "") check

        const dateStr: string = new Date().toISOString().replace(/[:.]/g, '-');
        filename = `${hostname.split('.')[0] || 'unknown'}-chat-${dateStr}`;

        if (format === 'json') {
            if (chatData.length > 0) {
                extractedContent = JSON.stringify(chatData, null, 2);
            } else if (extractedContent === "") {
                throw new Error("No chat data or fallback content could be extracted.");
            }
            // If fallback was used, extractedContent holds the text - JSON structure is lost
            filename += '.json';
            requiresMarkdownConversion = false; // JSON never needs markdown conversion
        } else if (format === 'txt') {
            filename += '.txt';
            requiresMarkdownConversion = false; // TXT never needs conversion
        } else if (format === 'md') {
            filename += '.md';
            // Keep requiresMarkdownConversion as determined during extraction
        }

        return {
            content: extractedContent,
            filename: filename,
            requiresMarkdownConversion: format === 'md' && requiresMarkdownConversion // Only MD might need it
        };

    } catch (error: any) {
        console.error("Snaggle Chat Extraction Error:", error);
        return { content: "", filename:"error.txt", error: `Failed to extract chat: ${error?.message ?? 'Unknown error'}` };
    }
  }