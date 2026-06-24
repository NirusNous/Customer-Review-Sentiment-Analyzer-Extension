import React from "react";
import {
  AlertCircle,
  Loader2,
  MessageSquareText,
  RefreshCw,
  Search,
} from "lucide-react";
import {
  AiDisclaimer,
  ChatPanel,
  Metrics,
  SessionSummary,
  StatusPanel,
  Suggestions,
} from "./components/PopupUI.jsx";
import { scrapeReviewsFromPage } from "./scraper/pageScraper.js";
import {
  answerQuestionLocally,
  createLocalRagSession,
  makeMessageId,
} from "./services/localSessionService.js";
import { deleteLocalSession } from "./localRagStore.js";

export default function App() {
  const [sessionId, setSessionId] = React.useState(null);
  const [sessionMeta, setSessionMeta] = React.useState(null);
  const [dashboard, setDashboard] = React.useState(null);
  const [messages, setMessages] = React.useState([]);
  const [question, setQuestion] = React.useState("");
  const [error, setError] = React.useState("");
  const [emptyState, setEmptyState] = React.useState(false);
  const [isIndexing, setIsIndexing] = React.useState(false);
  const [indexingStatus, setIndexingStatus] = React.useState("");
  const [isChatBusy, setIsChatBusy] = React.useState(false);
  const chatMessagesRef = React.useRef(null);
  const activeGenerationRef = React.useRef(null);
  const [pendingReviews, setPendingReviews] = React.useState(null);
  const [selectedReviewCount, setSelectedReviewCount] = React.useState(0);
  const [activeTab, setActiveTab] = React.useState(null);

  React.useEffect(() => {
    const chatMessages = chatMessagesRef.current;

    if (!chatMessages) {
      return;
    }

    window.requestAnimationFrame(() => {
      chatMessages.scrollTo({
        top: chatMessages.scrollHeight,
        behavior: "smooth",
      });
    });
  }, [messages, isChatBusy]);

  async function createOrRefreshSession(shouldRefresh = false) {
    setIsIndexing(true);
    setIndexingStatus("Reading visible reviews from the current tab...");
    setError("");
    setEmptyState(false);
    setPendingReviews(null);

    try {
      if (shouldRefresh && sessionId) {
        await deleteSessionQuietly(sessionId);
      }

      resetSessionState();

      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });

      if (!tab?.id) {
        throw new Error("No active browser tab found.");
      }

      setActiveTab(tab);

      const injectionResults = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: scrapeReviewsFromPage,
        args: [null],
      });

      const scrapeResult = injectionResults?.[0]?.result || {
        reviews: [],
        hitLimit: false,
      };
      const reviews = scrapeResult.reviews || [];

      if (!reviews.length) {
        setEmptyState(true);
        setIsIndexing(false);
        setIndexingStatus("");
        return;
      }

      setPendingReviews({
        reviews,
        hitLimit: Boolean(scrapeResult.hitLimit)
      });
      setSelectedReviewCount(Math.min(reviews.length, 50)); // Default to 50 or max
    } catch (caughtError) {
      setError(caughtError.message || "Failed to read reviews.");
    } finally {
      setIsIndexing(false);
      setIndexingStatus("");
    }
  }

  async function handleProcessReviews() {
    if (!pendingReviews || !activeTab) return;
    
    setIsIndexing(true);
    setIndexingStatus("Building local review index...");
    setError("");

    try {
      const slicedReviews = pendingReviews.reviews.slice(0, selectedReviewCount);
      const sessionData = await createLocalRagSession(activeTab, slicedReviews, setIndexingStatus);
      applySessionData(sessionData, pendingReviews.hitLimit);
      setPendingReviews(null);
    } catch (caughtError) {
      setError(caughtError.message || "Failed to create local RAG session.");
    } finally {
      setIsIndexing(false);
      setIndexingStatus("");
    }
  }

  function applySessionData(sessionData, hitLimit) {
    setSessionId(sessionData.session_id);
    setSessionMeta({
      reviewCount: sessionData.review_count,
      indexedReviewCount: sessionData.indexed_review_count ?? sessionData.review_count,
      backlogReviewCount: sessionData.backlog_review_count ?? 0,
      unqueuedReviewCount: sessionData.unqueued_review_count ?? 0,
      progressiveIndex: Boolean(sessionData.progressive_index),
      chunkCount: sessionData.chunk_count,
      hitLimit,
    });
    setDashboard(buildDashboardFromSession(sessionData));
    setMessages([
      {
        id: makeMessageId(),
        role: "assistant",
        content:
          "Local session ready. Ask me about complaints, positives, risks, delivery issues, quality issues, or anything else in the indexed reviews/comments.",
        sources: [],
      },
    ]);
  }

  function buildDashboardFromSession(sessionData) {
    const metrics = sessionData.metrics || {};

    return {
      totalReviews: metrics.total_reviews ?? sessionData.review_count ?? 0,
      positiveCount: metrics.positive ?? 0,
      negativeCount: metrics.negative ?? 0,
      mixedCount: metrics.mixed ?? 0,
      positivePct: metrics.positive_pct ?? 0,
      negativePct: metrics.negative_pct ?? 0,
      mixedPct: metrics.mixed_pct ?? 0,
    };
  }

  async function sendQuestion(nextQuestion) {
    const cleanQuestion = nextQuestion.trim();

    if (!sessionId) {
      setError("Create a RAG session first.");
      return;
    }

    if (!cleanQuestion || isChatBusy) {
      return;
    }

    setError("");
    setQuestion("");
    const assistantMessageId = makeMessageId();
    const priorMessages = messages;
    const generationController = new AbortController();
    activeGenerationRef.current = {
      assistantMessageId,
      controller: generationController,
    };

    setMessages((currentMessages) => [
      ...currentMessages,
      {
        id: makeMessageId(),
        role: "user",
        content: cleanQuestion,
      },
      {
        id: assistantMessageId,
        role: "assistant",
        content: "",
        sources: [],
        streaming: true,
      },
    ]);
    setIsChatBusy(true);

    try {
      const result = await answerQuestionLocally({
        sessionId,
        question: cleanQuestion,
        recentMessages: priorMessages,
        signal: generationController.signal,
        onToken: (partialAnswer) => {
          if (generationController.signal.aborted) {
            return;
          }

          updateAssistantMessage(assistantMessageId, {
            content: partialAnswer,
            streaming: true,
          });
        },
      });

      if (generationController.signal.aborted) {
        return;
      }

      updateAssistantMessage(assistantMessageId, {
        content: result.answer,
        sources: result.sources,
        streaming: false,
      });
    } catch (caughtError) {
      if (caughtError?.name === "AbortError") {
        updateAssistantMessage(assistantMessageId, {
          content: "Generation stopped.",
          sources: [],
          streaming: false,
        });
        return;
      }

      setMessages((currentMessages) => currentMessages.filter(
        (message) => message.id !== assistantMessageId,
      ));
      setError(caughtError.message || "Chat request failed.");
    } finally {
      if (activeGenerationRef.current?.controller === generationController) {
        activeGenerationRef.current = null;
      }

      setIsChatBusy(false);
    }
  }

  function stopGeneration() {
    const activeGeneration = activeGenerationRef.current;

    if (!activeGeneration) {
      return;
    }

    activeGeneration.controller.abort();
    updateAssistantMessage(activeGeneration.assistantMessageId, {
      content: "Generation stopped.",
      sources: [],
      streaming: false,
    });
  }

  function updateAssistantMessage(messageId, patch) {
    setMessages((currentMessages) => currentMessages.map((message) => (
      message.id === messageId
        ? {
          ...message,
          ...patch,
        }
        : message
    )));
  }

  const hasSession = Boolean(sessionId);

  function resetSessionState() {
    setSessionId(null);
    setSessionMeta(null);
    setDashboard(null);
    setMessages([]);
    setQuestion("");
    setIndexingStatus("");
    setIsChatBusy(false);
    activeGenerationRef.current?.controller.abort();
    activeGenerationRef.current = null;
  }

  async function deleteSessionQuietly(targetSessionId) {
    try {
      await deleteLocalSession(targetSessionId);
    } catch {
      // Ignore cleanup errors in the popup.
    }
  }

  function handleSubmit(event) {
    event.preventDefault();
    sendQuestion(question);
  }

  return (
    <main className="max-h-[600px] w-[430px] overflow-y-auto bg-shell p-3.5 text-ink">
      <header className="rounded-lg bg-primary px-3 py-3 text-white shadow-popup">
        <div className="flex items-start gap-2">
          <div className="mt-0.5 rounded-lg border border-white/20 bg-accent p-2 text-white">
            <MessageSquareText size={18} strokeWidth={2.25} />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-bold leading-tight">Review RAG Assistant</h1>
            <p className="mt-1 text-[13px] leading-snug text-white/75">
              Index visible reviews or comments locally in your browser, then ask questions about them.
            </p>
          </div>
        </div>
      </header>

      <section className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] gap-2">
        <button
          type="button"
          onClick={() => createOrRefreshSession(false)}
          disabled={isIndexing || pendingReviews}
          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-accent px-3 py-2 text-[13px] font-bold text-primary shadow-bubble transition hover:bg-primary-hover hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isIndexing ? <Loader2 className="animate-spin" size={16} /> : <Search size={16} />}
          Analyse Comments On Current Page
        </button>

        <button
          type="button"
          onClick={() => createOrRefreshSession(true)}
          disabled={isIndexing || !sessionId}
          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-primary/20 bg-white px-3 py-2 text-[13px] font-bold text-primary transition hover:border-contrast hover:text-contrast disabled:cursor-not-allowed disabled:opacity-60"
          title="Refresh session"
        >
          <RefreshCw size={15} className={isIndexing ? "animate-spin" : ""} />
          Refresh
        </button>
      </section>

      {pendingReviews && (
        <section className="mt-3 rounded-lg border border-primary/10 bg-white p-3 shadow-sm">
          <h2 className="mb-2 text-sm font-bold text-primary">Found {pendingReviews.reviews.length} reviews</h2>
          <p className="text-[13px] text-muted mb-3">How many do you want to process? Processing fewer reviews is faster.</p>
          
          <div className="flex items-center gap-3">
            <input
              type="range"
              min="1"
              max={pendingReviews.reviews.length}
              value={selectedReviewCount}
              onChange={(e) => setSelectedReviewCount(Number(e.target.value))}
              className="flex-1"
            />
            <span className="font-bold text-sm w-8 text-right">{selectedReviewCount}</span>
          </div>

          <button
            type="button"
            onClick={handleProcessReviews}
            className="mt-4 w-full rounded-lg bg-primary py-2 text-[13px] font-bold text-white transition hover:bg-primary-hover"
          >
            Process {selectedReviewCount} Reviews
          </button>
        </section>
      )}

      {isIndexing && (
        <StatusPanel tone="loading" icon={<Loader2 className="animate-spin" size={18} />}>
          {indexingStatus || "Building local review index..."}
        </StatusPanel>
      )}

      {error && (
        <StatusPanel tone="error" icon={<AlertCircle size={18} />}>
          {error}
        </StatusPanel>
      )}

      {emptyState && (
        <StatusPanel tone="warning" title="No review text found" icon={<AlertCircle size={18} />}>
          could not find any text in this page
        </StatusPanel>
      )}

      {sessionMeta && <SessionSummary sessionMeta={sessionMeta} />}
      {dashboard && <Metrics dashboard={dashboard} />}

      {hasSession && (
        <Suggestions
          disabled={isChatBusy}
          onSelect={(suggestedQuestion) => sendQuestion(suggestedQuestion)}
        />
      )}

      {hasSession && <AiDisclaimer />}

      {hasSession && (
        <ChatPanel
          messages={messages}
          isChatBusy={isChatBusy}
          question={question}
          onQuestionChange={setQuestion}
          onSubmit={handleSubmit}
          onStopGeneration={stopGeneration}
          chatMessagesRef={chatMessagesRef}
        />
      )}
    </main>
  );
}
