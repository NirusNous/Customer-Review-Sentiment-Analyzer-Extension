import {
  MESSAGE_TYPES,
  MODEL_CONFIG,
  MODEL_ROLES,
  RAG_LIMITS,
} from "../constants/ragConfig.js";
import {
  answerContradictsEvidence,
  buildFallbackAnswer,
  buildAnalyticsText,
  formatContextForPrompt,
  formatRecentChat,
} from "../localRag/answerContext.js";
import {
  analyzeQuery,
  fallbackAnswerForQuerySentiment,
} from "../localRag/queryPolicy.js";
import {
  attachEmbeddingsToChunks,
  buildSessionMetrics,
  createReviewChunks,
  normalizeReviewSentiment,
} from "../localRag/reviewProcessing.js";
import {
  prepareReviewIndexPlan,
  selectBacklogReviewsForQuery,
} from "../localRag/progressiveIndex.js";
import {
  chunksToSources,
  retrieveRelevantChunks,
} from "../localRag/retrieval.js";
import {
  cleanAssistantAnswer,
  hasPromptEcho,
  isUnsafeGeneratedAnswer,
} from "../localRag/responseGuards.js";
import {
  appendLocalSessionChunks,
  getLocalSession,
  getLocalSessionChunks,
  saveLocalSession,
  updateLocalSession,
} from "../localRagStore.js";
import {
  classifyTextsLocally,
  embedTextsLocally,
  isAbortError,
  sendWorkerMessage,
  streamLocalGeneration,
  throwIfAborted,
} from "./modelClient.js";

export { makeMessageId } from "./modelClient.js";

export async function createLocalRagSession(tab, scrapedReviews, reportProgress = () => {}) {
  const sessionId = makeLocalSessionId();
  const reviews = normalizeScrapedReviews(scrapedReviews);
  const indexPlan = prepareReviewIndexPlan(reviews, sessionId);
  const reviewsToIndex = indexPlan.initialReviews;

  reportProgress("Loading local embedding and sentiment models...");
  const initResult = await sendWorkerMessage({
    type: MESSAGE_TYPES.INIT_MODELS,
    roles: [MODEL_ROLES.EMBEDDING, MODEL_ROLES.SENTIMENT],
  });
  const failedModel = Object.values(initResult.models || {}).find((model) => !model.ok);

  if (failedModel) {
    throw new Error(failedModel.error || "A local model failed to initialize.");
  }

  if (indexPlan.isProgressive) {
    reportProgress(
      `Large page detected: indexing ${reviewsToIndex.length} priority reviews now; ` +
      `${indexPlan.backlogReviews.length} queued for lazy indexing.`,
    );
  }

  reportProgress(`Classifying sentiment for ${reviewsToIndex.length} reviews locally...`);
  const sentimentResults = await classifyTextsLocally(reviewsToIndex.map((review) => review.text), reportProgress);
  const enrichedReviews = enrichReviewsWithSentiment(reviewsToIndex, sentimentResults);

  const chunks = createReviewChunks(enrichedReviews, sessionId);

  reportProgress(`Embedding ${chunks.length} local chunks...`);
  const embeddings = await embedTextsLocally(chunks.map((chunk) => chunk.text), reportProgress);
  const embeddedChunks = attachEmbeddingsToChunks(chunks, embeddings);
  const metrics = buildSessionMetrics(mergeMetricReviews(indexPlan.metricReviews, enrichedReviews));
  const session = {
    id: sessionId,
    pageUrl: tab.url || null,
    pageTitle: tab.title || null,
    createdAt: new Date().toISOString(),
    reviewCount: reviews.length,
    indexedReviewCount: enrichedReviews.length,
    backlogReviewCount: indexPlan.backlogReviews.length,
    unqueuedReviewCount: indexPlan.unqueuedReviewCount,
    progressiveIndex: indexPlan.isProgressive,
    chunkCount: embeddedChunks.length,
    metrics,
    backlogReviews: indexPlan.backlogReviews,
    conversationSummary: "No earlier conversation summary.",
    models: {
      embedding: MODEL_CONFIG[MODEL_ROLES.EMBEDDING].model,
      sentiment: MODEL_CONFIG[MODEL_ROLES.SENTIMENT].model,
      generator: MODEL_CONFIG[MODEL_ROLES.GENERATOR].model,
    },
  };

  reportProgress("Saving local vector index...");
  await saveLocalSession(session, embeddedChunks);

  return {
    session_id: session.id,
    review_count: session.reviewCount,
    indexed_review_count: session.indexedReviewCount,
    backlog_review_count: session.backlogReviewCount,
    progressive_index: session.progressiveIndex,
    unqueued_review_count: session.unqueuedReviewCount,
    chunk_count: session.chunkCount,
    metrics: session.metrics,
  };
}

export async function answerQuestionLocally({
  sessionId,
  question,
  recentMessages,
  signal,
  onToken,
}) {
  let [session, chunks] = await Promise.all([
    getLocalSession(sessionId),
    getLocalSessionChunks(sessionId),
  ]);

  if (!session || !chunks.length) {
    throw new Error("Local session not found. Refresh the page index and try again.");
  }

  const analysis = analyzeQuery(question);
  const retrievalQuestion = analysis.normalizedQuestion || question;
  ({ session, chunks } = await expandIndexForQuestion({
    session,
    chunks,
    question: retrievalQuestion,
    analysis,
    signal,
  }));
  throwIfAborted(signal);

  const [queryEmbedding] = await embedTextsLocally([retrievalQuestion], undefined, signal);
  const retrievedChunks = retrieveRelevantChunks({
    chunks,
    query: retrievalQuestion,
    queryEmbedding,
    analysis,
  });

  if (!retrievedChunks.length) {
    return {
      answer: fallbackAnswerForQuerySentiment(analysis.querySentiment),
      sources: [],
    };
  }

  const {
    context,
    contextChunks,
  } = formatContextForPrompt(
    retrievedChunks,
    analysis.limits.maxContextTokens,
  );
  const sources = chunksToSources(
    contextChunks.length ? contextChunks : retrievedChunks,
    analysis.limits.displaySourceCount,
  );
  const evidenceChunks = contextChunks.length ? contextChunks : retrievedChunks;
  const sessionAnalytics = buildAnalyticsText(session, analysis);
  const recentChat = formatRecentChat(recentMessages, RAG_LIMITS.maxRecentMessages);
  const conversationSummary = session.conversationSummary || "No earlier conversation summary.";

  try {
    const generatedAnswer = await streamLocalGeneration({
      query: retrievalQuestion,
      context,
      recentChat,
      conversationSummary,
      sessionAnalytics,
      answerStyle: analysis.answerStyle,
      maxNewTokens: analysis.limits.maxNewTokens,
      signal,
      onToken,
    });
    const answer = cleanAssistantAnswer(generatedAnswer, question);
    const unsafe = (
      hasPromptEcho(generatedAnswer, question) ||
      isUnsafeGeneratedAnswer({
        rawAnswer: generatedAnswer,
        cleanedAnswer: answer,
        userQuestion: question,
      }) ||
      answerContradictsEvidence(answer, evidenceChunks, analysis)
    );

    if (answer && !unsafe) {
      return {
        answer,
        sources,
      };
    }
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }

    console.warn("Local generator unavailable; using extractive fallback.", error);
  }

  return {
    answer: buildFallbackAnswer(retrievalQuestion, evidenceChunks, session),
    sources,
  };
}

async function expandIndexForQuestion({
  session,
  chunks,
  question,
  analysis,
  signal,
}) {
  const backlogReviews = Array.isArray(session.backlogReviews) ? session.backlogReviews : [];

  if (!backlogReviews.length) {
    return {
      session,
      chunks,
    };
  }

  const {
    selectedReviews,
    remainingReviews,
  } = selectBacklogReviewsForQuery(backlogReviews, question, analysis);

  if (!selectedReviews.length) {
    return {
      session,
      chunks,
    };
  }

  throwIfAborted(signal);
  const sentimentResults = await classifyTextsLocally(
    selectedReviews.map((review) => review.text),
    undefined,
    signal,
  );
  const enrichedReviews = enrichReviewsWithSentiment(selectedReviews, sentimentResults);
  const lazyChunks = createReviewChunks(enrichedReviews, session.id);
  const embeddings = await embedTextsLocally(lazyChunks.map((chunk) => chunk.text), undefined, signal);
  const embeddedChunks = attachEmbeddingsToChunks(lazyChunks, embeddings);
  const nextSession = {
    ...session,
    updatedAt: new Date().toISOString(),
    backlogReviews: remainingReviews,
    backlogReviewCount: remainingReviews.length,
    indexedReviewCount: (Number(session.indexedReviewCount) || 0) + enrichedReviews.length,
    chunkCount: chunks.length + embeddedChunks.length,
  };

  await Promise.all([
    appendLocalSessionChunks(embeddedChunks),
    updateLocalSession(nextSession),
  ]);

  return {
    session: nextSession,
    chunks: chunks.concat(embeddedChunks),
  };
}

function normalizeScrapedReviews(reviews) {
  return (Array.isArray(reviews) ? reviews : [])
    .map((review) => ({
      ...review,
      text: String(review?.text || "").replace(/\s+/g, " ").trim(),
    }))
    .filter((review) => review.text);
}

function enrichReviewsWithSentiment(reviews, sentimentResults) {
  return reviews.map((review, index) => {
    const sentiment = normalizeReviewSentiment(sentimentResults[index], review.text);

    return {
      ...review,
      sentiment_label: sentiment.label,
      sentiment_score: sentiment.score,
    };
  });
}

function mergeMetricReviews(metricReviews, enrichedReviews) {
  const reviewsById = new Map(metricReviews.map((review) => [review.id, review]));

  enrichedReviews.forEach((review) => {
    reviewsById.set(review.id, review);
  });

  return Array.from(reviewsById.values())
    .sort((left, right) => (left.original_index || 0) - (right.original_index || 0));
}

function makeLocalSessionId() {
  if (globalThis.crypto?.randomUUID) {
    return `local-${globalThis.crypto.randomUUID()}`;
  }

  return `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
