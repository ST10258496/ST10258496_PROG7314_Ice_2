import React, { useState, useEffect, useRef } from 'react';
import { Send, Loader2, BookOpen } from 'lucide-react';

// --- Configuration ---
// IMPORTANT: Replace this placeholder with YOUR actual Render URL and the /generate route.
const CHATBOT_API_URL = 'https://st10258496-prog7314-ice-2.onrender.com';

// Utility to ensure exponential backoff for API calls
const fetchWithRetry = async (url, options, retries = 3, delay = 1000) => {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, options);
      if (response.ok) return response;
      
      // Handle rate limits or temporary server errors
      if (response.status === 429 || response.status >= 500 && i < retries - 1) { 
        console.warn(`Attempt ${i + 1} failed with status ${response.status}. Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay * Math.pow(2, i)));
        continue;
      }
      throw new Error(`API returned status ${response.status}: ${response.statusText}`);
    } catch (error) {
      if (i === retries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, delay * Math.pow(2, i)));
    }
  }
};

// --- Main Application Component ---
const App = () => {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState([
    { text: "Greetings! I'm Bookworm Bot. Ask me to analyze a theme, summarize a novel, or find your next great read!", sender: 'gemini' } 
  ]);
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef(null);

  // Scroll to the bottom of the chat window on new message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Function to call the DEPLOYED Cohere server
  const callChatbotAPI = async (userQuery) => {
    setIsLoading(true);
    
    // Payload required by your Node.js server's /generate route
    const payload = {
      prompt: userQuery 
    };

    const options = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    };

    try {
      // Use your Render URL
      const response = await fetchWithRetry(CHATBOT_API_URL, options);
      const result = await response.json();
      
      let responseText = result.text || "I apologize, I lost my place in the book and cannot generate a response right now.";
      let citations = result.citations || [];
      
      let fullResponseText = responseText;
      
      // Format citations returned by the Cohere API
      if (citations.length > 0) {
        fullResponseText += '\n\n---\n\n**Citations from Documents:**\n';
        citations.forEach((c, index) => {
          // Citations often return start/end tokens, but we just want the text reference
          fullResponseText += `${index + 1}. Source: ${c.document_ids[0]}\n`;
        });
      }

      setMessages(prev => [...prev, { text: fullResponseText, sender: 'gemini' }]);

    } catch (error) {
      console.error("API Call Error:", error);
      setMessages(prev => [...prev, { text: "Network error or API failure. Please check your Render deployment URL and status.", sender: 'gemini' }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSendMessage = (e) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage = input.trim();
    setMessages(prev => [...prev, { text: userMessage, sender: 'user' }]);
    setInput('');
    callChatbotAPI(userMessage); // Call the server API
  };
  
  // Custom chat bubble component
  const MessageBubble = ({ message }) => {
    const isUser = message.sender === 'user';
    const align = isUser ? 'items-end' : 'items-start';
    const bgColor = isUser ? 'bg-amber-500 text-white' : 'bg-white text-gray-800 shadow-md';
    const margin = isUser ? 'ml-auto' : 'mr-auto';
    
    // Simple markdown to HTML conversion for links/bold text/citations
    const formatText = (text) => {
      // Basic markdown formatting
      let html = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" class="text-indigo-400 hover:text-indigo-300 underline">$1</a>');
      html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
      html = html.replace(/\n/g, '<br />');
      return { __html: html };
    };

    return (
      <div className={`flex w-full mb-4 ${align}`}>
        <div 
          className={`max-w-xs md:max-w-md lg:max-w-lg p-3 rounded-xl ${bgColor} ${margin} break-words`}
          style={{ 
            borderTopLeftRadius: isUser ? '12px' : '0', 
            borderTopRightRadius: isUser ? '0' : '12px',
          }}
        >
          <div className="text-sm" dangerouslySetInnerHTML={formatText(message.text)} />
        </div>
      </div>
    );
  };


  return (
    <div className="min-h-screen bg-gray-50 flex flex-col font-sans">
      
      {/* Header */}
      <header className="bg-amber-600 text-white p-4 shadow-lg fixed top-0 left-0 right-0 z-10">
        <h1 className="text-xl font-bold text-center flex items-center justify-center">
          <BookOpen className="h-6 w-6 mr-2" /> Bookworm Bot: Literary Assistant
        </h1>
      </header>

      {/* Chat Area */}
      <main className="flex-1 overflow-y-auto pt-20 pb-24 px-4">
        <div className="max-w-4xl mx-auto">
          {messages.map((message, index) => (
            <MessageBubble key={index} message={message} />
          ))}
          <div ref={messagesEndRef} />
          {isLoading && (
            <div className="flex w-full mb-4 items-start">
              <div className="p-3 rounded-xl bg-white text-gray-800 shadow-md mr-auto">
                <Loader2 className="animate-spin h-5 w-5 inline mr-2 text-amber-500" />
                <span className="text-sm">Flipping pages...</span>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Input Form (Mobile-friendly fixed bottom) */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 p-4 shadow-2xl z-10">
        <form onSubmit={handleSendMessage} className="max-w-4xl mx-auto flex gap-3">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about Moby Dick, themes in Sci-Fi, or recommend a book..."
            disabled={isLoading}
            className="flex-1 p-3 border border-gray-300 rounded-full focus:ring-amber-500 focus:border-amber-500 transition duration-150"
            autoFocus
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="bg-amber-600 hover:bg-amber-700 text-white p-3 rounded-full shadow-lg transition duration-150 disabled:bg-amber-300 flex items-center justify-center"
            title="Send Message"
          >
            {isLoading ? (
              <Loader2 className="h-6 w-6 animate-spin" />
            ) : (
              <Send className="h-6 w-6" />
            )}
          </button>
        </form>
      </div>

    </div>
  );
};

export default App;
