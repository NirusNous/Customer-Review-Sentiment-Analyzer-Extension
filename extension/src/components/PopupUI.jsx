import React from "react";
import {
  Bot,
  CheckCircle2,
  Info,
  Send,
  Square,
  UserRound,
} from "lucide-react";

const SUGGESTED_QUESTIONS = [
  ["Main complaints", "What are the main customer complaints?"],
  ["What people like", "What do customers like most?"],
  ["What people don't like", "What do customers dislike most?"],
  ["Pros and cons", "Summarize the pros and cons."],
  ["Delivery issues", "Are there delivery, packaging, or shipping issues?"],
  ["Quality issues", "Are there quality or durability issues?"],
];

export function AiDisclaimer() {
  return (
    <aside className="mt-3 flex items-start gap-2 rounded-lg border border-primary/10 bg-white px-3 py-2 text-[11px] leading-snug text-muted shadow-sm">
      <Info size={14} className="mt-0.5 shrink-0 text-accent" />
      <p>AI answers are not always 100% correct. If a reply is not relevant, rephrase your question and try again.</p>
    </aside>
  );
}

export function StatusPanel({ tone, title, icon, children }) {
  const toneClasses = {
    loading: "border-l-accent bg-white text-primary",
    error: "border-l-contrast bg-white text-contrast",
    warning: "border-l-contrast bg-white text-contrast",
    success: "border-l-accent bg-white text-primary",
  };

  return (
    <section className={`mt-3 rounded-lg border border-primary/10 border-l-4 p-3 text-[13px] leading-snug shadow-sm ${toneClasses[tone]}`}>
      <div className="flex gap-2">
        <div className="mt-0.5 shrink-0">{icon}</div>
        <div className="min-w-0">
          {title && <h2 className="mb-1 text-sm font-bold">{title}</h2>}
          <p>{children}</p>
        </div>
      </div>
    </section>
  );
}

export function SessionSummary({ sessionMeta }) {
  const isProgressive = sessionMeta.progressiveIndex &&
    sessionMeta.indexedReviewCount < sessionMeta.reviewCount;

  return (
    <StatusPanel tone="success" title="Session Ready" icon={<CheckCircle2 size={18} />}>
      {isProgressive
        ? (
          <>
            Indexed {sessionMeta.indexedReviewCount} of {sessionMeta.reviewCount} reviews into{" "}
            {sessionMeta.chunkCount} chunks. {sessionMeta.backlogReviewCount} reviews will be indexed lazily.
            {sessionMeta.unqueuedReviewCount > 0 && (
              <> {sessionMeta.unqueuedReviewCount} extra reviews were skipped to keep local storage responsive.</>
            )}
          </>
        )
        : <>Indexed {sessionMeta.reviewCount} reviews into {sessionMeta.chunkCount} chunks.</>}
    </StatusPanel>
  );
}

export function Metrics({ dashboard }) {
  const sentimentPercents = formatSentimentPercentages(dashboard);

  return (
    <section className="mt-3 grid grid-cols-4 gap-2">
      <MetricCard label="Reviews" value={String(dashboard.totalReviews)} tone="primary" />
      <MetricCard label="Positive" value={`${sentimentPercents.positive}%`} tone="accent" />
      <MetricCard label="Negative" value={`${sentimentPercents.negative}%`} tone="contrast" />
      <MetricCard label="Mixed" value={`${sentimentPercents.mixed}%`} tone="mixed" />
    </section>
  );
}

export function Suggestions({ disabled, onSelect }) {
  return (
    <section className="mt-3 grid grid-cols-2 gap-2 rounded-lg border border-primary/10 bg-white p-3 shadow-sm">
      <h2 className="col-span-2 text-sm font-bold text-primary">Suggested questions</h2>
      {SUGGESTED_QUESTIONS.map(([label, question]) => (
        <button
          key={question}
          type="button"
          disabled={disabled}
          onClick={() => onSelect(question)}
          className="min-h-9 rounded-lg border border-primary/10 bg-surface px-3 py-2 text-left text-[13px] font-bold leading-tight text-primary transition hover:border-accent hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          {label}
        </button>
      ))}
    </section>
  );
}

export function ChatPanel({
  messages,
  isChatBusy,
  question,
  onQuestionChange,
  onSubmit,
  onStopGeneration,
  chatMessagesRef,
}) {
  const hasStreamingAssistant = messages.some((message) => message.streaming);

  return (
    <section className="mt-3 overflow-hidden rounded-lg border border-primary/10 bg-white shadow-popup">
      <div className="flex items-center justify-between border-b border-primary/10 bg-primary px-3 py-2.5 text-white">
        <h2 className="text-sm font-bold">Review chat</h2>
      </div>

      <div
        ref={chatMessagesRef}
        className="scrollbar-thin flex h-[300px] flex-col gap-2.5 overflow-y-auto overscroll-contain bg-surface p-3"
        aria-live="polite"
      >
        {messages.length === 0 && (
          <div className="m-auto text-center text-xs text-muted/75">
            Messages will appear here once a session is ready.
          </div>
        )}

        {messages.map((message) => (
          <ChatMessage key={message.id} message={message} />
        ))}

        {isChatBusy && !hasStreamingAssistant && (
          <ChatMessage
            message={{
              id: "loading",
              role: "assistant",
              content: "",
              loading: true,
            }}
          />
        )}
      </div>

      <form onSubmit={onSubmit} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 border-t border-primary/10 bg-white p-2.5">
        <textarea
          rows={2}
          value={question}
          disabled={isChatBusy}
          onChange={(event) => onQuestionChange(event.target.value)}
          aria-label="Ask about the indexed reviews/comments"
          placeholder="Ask about the indexed reviews/comments..."
          className="min-h-[42px] max-h-24 w-full resize-none rounded-lg border border-primary/15 bg-surface px-3 py-2 text-[13px] leading-snug text-ink outline-none transition placeholder:text-muted/45 focus:border-accent focus:bg-white focus:ring-4 focus:ring-accent/15 disabled:bg-primary-soft/45 disabled:text-muted/70"
        />
        {isChatBusy ? (
          <button
            type="button"
            onClick={onStopGeneration}
            className="inline-flex min-w-[64px] items-center justify-center gap-1.5 rounded-lg bg-contrast px-3 py-2 text-[13px] font-bold text-white transition hover:bg-primary"
            title="Stop generation"
          >
            <Square size={13} fill="currentColor" />
            Stop
          </button>
        ) : (
          <button
            type="submit"
            disabled={!question.trim()}
            className="inline-flex min-w-[64px] items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-[13px] font-bold text-primary transition hover:bg-primary hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Send size={15} />
            Send
          </button>
        )}
      </form>
    </section>
  );
}

function ChatMessage({ message }) {
  const isUser = message.role === "user";

  return (
    <article
      className={`flex max-w-[86%] flex-col rounded-lg px-2.5 py-2 text-[13px] leading-snug ${
        isUser
          ? "self-end rounded-br-sm bg-primary text-white shadow-bubble"
          : "self-start rounded-bl-sm border border-primary/10 bg-white text-ink shadow-sm"
      } ${message.loading ? "w-fit min-w-[76px]" : ""}`}
    >
      <div
        className={`mb-1 flex items-center gap-1.5 text-[11px] font-extrabold ${
          isUser ? "text-white/80" : "text-accent"
        }`}
      >
        {isUser ? <UserRound size={12} /> : <Bot size={12} />}
        {isUser ? "You" : "Assistant"}
      </div>

      {message.loading || (message.streaming && !message.content) ? (
        <TypingIndicator />
      ) : (
        <div className="whitespace-pre-wrap break-words">{message.content}</div>
      )}

      {message.sources?.length > 0 && <Sources sources={message.sources} />}
    </article>
  );
}

function Sources({ sources }) {
  return (
    <details className="mt-2 border-t border-primary/10 pt-2">
      <summary className="cursor-pointer text-xs font-extrabold text-accent">
        Show relevant reviews/comments ({sources.length})
      </summary>

      <div className="mt-2 space-y-2">
        {sources.map((source, index) => {
          const opinion = formatOpinionLabel(source.metadata?.sentiment_label);
          const relevance = formatConfidencePercent(source.score);
          const metadataBadges = sourceMetadataBadges(source.metadata || {});

          return (
            <div
              key={`${source.chunk_id || source.review_id || "source"}-${index}`}
              className="rounded-lg border border-primary/10 bg-surface p-2 text-xs text-primary"
            >
              <div className="mb-2 flex flex-wrap gap-1.5 font-bold">
                <span className={`rounded border px-2 py-0.5 ${opinion.className}`}>
                  Opinion: {opinion.label}
                </span>
                <span className="rounded border border-primary/10 bg-white px-2 py-0.5 text-muted">
                  Query relevance: {relevance}
                </span>
                {metadataBadges.map((badge) => (
                  <span
                    key={badge}
                    className="rounded border border-primary/10 bg-white px-2 py-0.5 text-muted"
                  >
                    {badge}
                  </span>
                ))}
              </div>
              <p className="max-h-24 overflow-auto leading-snug">{source.text || ""}</p>
            </div>
          );
        })}
      </div>
    </details>
  );
}

function MetricCard({ label, value, tone }) {
  const toneClasses = {
    primary: "border-primary bg-primary text-white",
    accent: "border-accent bg-accent text-primary",
    contrast: "border-contrast bg-contrast text-white",
    mixed: "border-primary/15 bg-white text-primary",
  };

  return (
    <div className={`min-w-0 rounded-lg border p-2.5 text-center shadow-sm ${toneClasses[tone]}`}>
      <span className="block text-[11px] font-semibold opacity-75">{label}</span>
      <strong className="mt-1 block break-words text-[17px] leading-tight">{value}</strong>
    </div>
  );
}

function TypingIndicator() {
  return (
    <span className="inline-flex items-center gap-2 text-xs font-semibold text-muted" role="status" aria-label="Assistant is thinking">
      <span>Finding relevant reviews</span>
      <span className="typing-indicator" aria-hidden="true">
        <span className="typing-dot" />
        <span className="typing-dot" />
        <span className="typing-dot" />
      </span>
    </span>
  );
}

function formatOpinionLabel(label) {
  const normalizedLabel = String(label || "mixed").toLowerCase();

  if (normalizedLabel === "positive") {
    return { label: "Positive", className: "border-accent bg-accent text-primary" };
  }

  if (normalizedLabel === "negative") {
    return { label: "Negative", className: "border-contrast bg-contrast text-white" };
  }

  return { label: "Mixed", className: "border-primary/15 bg-white text-primary" };
}

function sourceMetadataBadges(metadata) {
  const badges = [];
  const rating = metadata.rating ?? metadata.star_rating ?? metadata.stars ?? metadata.ratingValue;
  const ratingMax = metadata.rating_max ?? metadata.ratingMax ?? 5;
  const helpfulVotes = metadata.helpful_votes ?? metadata.helpful_count ?? metadata.helpfulness_count;
  const upvotes = metadata.upvotes ?? metadata.upvote_count ?? metadata.likes ?? metadata.like_count;
  const downvotes = metadata.downvotes ?? metadata.downvote_count ?? metadata.dislikes ?? metadata.dislike_count;

  if (rating !== undefined && rating !== null && rating !== "") {
    badges.push(`Rating: ${rating}/${ratingMax || 5}`);
  }

  if (metadata.date) {
    badges.push(`Date: ${metadata.date}`);
  }

  if (metadata.helpfulness) {
    badges.push(`Helpfulness: ${metadata.helpfulness}`);
  } else if (helpfulVotes !== undefined && helpfulVotes !== null) {
    badges.push(`Helpful: ${formatCount(helpfulVotes)}`);
  }

  if (upvotes !== undefined && upvotes !== null && String(upvotes) !== String(helpfulVotes)) {
    badges.push(`Upvotes: ${formatCount(upvotes)}`);
  }

  if (downvotes !== undefined && downvotes !== null) {
    badges.push(`Downvotes: ${formatCount(downvotes)}`);
  }

  return badges;
}

function formatSentimentPercentages(dashboard) {
  const counts = [
    Number(dashboard.positiveCount),
    Number(dashboard.negativeCount),
    Number(dashboard.mixedCount),
  ];
  const countTotal = counts.reduce((sum, count) => sum + (Number.isFinite(count) ? count : 0), 0);

  if (!countTotal) {
    const positive = Number(dashboard.positivePct) || 0;
    const negative = Number(dashboard.negativePct) || 0;
    return {
      positive: formatPercent(positive),
      negative: formatPercent(negative),
      mixed: formatPercent(Math.max(0, 100 - positive - negative)),
    };
  }

  const rawTenths = counts.map((count) => (Math.max(count, 0) / countTotal) * 1000);
  const floorTenths = rawTenths.map(Math.floor);
  let remainingTenths = 1000 - floorTenths.reduce((sum, value) => sum + value, 0);
  const order = rawTenths
    .map((rawValue, index) => ({ index, remainder: rawValue - floorTenths[index] }))
    .sort((left, right) => right.remainder - left.remainder);

  for (const item of order) {
    if (remainingTenths <= 0) break;
    floorTenths[item.index] += 1;
    remainingTenths -= 1;
  }

  return {
    positive: formatPercent(floorTenths[0] / 10),
    negative: formatPercent(floorTenths[1] / 10),
    mixed: formatPercent(floorTenths[2] / 10),
  };
}

function formatConfidencePercent(value) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue)
    ? `${Math.round(Math.min(Math.max(numericValue, 0), 1) * 100)}%`
    : "N/A";
}

function formatCount(value) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return String(value);
  }

  return Intl.NumberFormat("en", {
    notation: numericValue >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(numericValue);
}

function formatPercent(value) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return "0";
  }

  const rounded = Math.round(numericValue * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}
