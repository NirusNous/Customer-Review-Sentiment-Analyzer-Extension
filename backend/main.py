import os
import re
from collections import Counter
from contextlib import asynccontextmanager
from typing import Any

import torch
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from transformers import pipeline, AutoTokenizer, AutoModelForSeq2SeqLM
from dotenv import load_dotenv

load_dotenv()


SENTIMENT_MODEL = os.getenv(
    "SENTIMENT_MODEL",
    "distilbert-base-uncased-finetuned-sst-2-english",
)

SUMMARY_MODEL = os.getenv(
    "SUMMARY_MODEL",
    "sshleifer/distilbart-cnn-12-6",
)

MAX_REVIEWS = int(os.getenv("MAX_REVIEWS", "80"))
MAX_CHARS_PER_REVIEW = int(os.getenv("MAX_CHARS_PER_REVIEW", "1500"))

ALLOW_ORIGINS = [
    origin.strip()
    for origin in os.getenv("ALLOW_ORIGINS", "*").split(",")
    if origin.strip()
]

sentiment_analyzer = None
summary_tokenizer = None
summary_model = None


STOPWORDS = {
    "the", "and", "for", "that", "this", "with", "was", "were", "are", "but",
    "not", "you", "your", "have", "has", "had", "they", "them", "from", "too",
    "very", "just", "would", "could", "should", "about", "into", "than", "then",
    "there", "their", "its", "it's", "product", "item", "review", "reviews",
    "really", "also", "when", "what", "which", "only", "after", "before",
}


class AnalyzeRequest(BaseModel):
    reviews: list[str] = Field(..., min_length=1, max_length=MAX_REVIEWS)


class SentimentBreakdown(BaseModel):
    positive: int
    negative: int
    positive_pct: float
    negative_pct: float
    average_confidence: float


class ReviewResult(BaseModel):
    text: str
    label: str
    confidence: float


class AnalyzeResponse(BaseModel):
    total_reviews: int
    sentiment: SentimentBreakdown
    summary: str
    top_negative_terms: list[dict[str, Any]]
    reviews: list[ReviewResult]


def clean_text(text: str) -> str:
    text = re.sub(r"\s+", " ", text or "").strip()
    return text[:MAX_CHARS_PER_REVIEW]


def extract_keywords(texts: list[str], limit: int = 8) -> list[dict[str, Any]]:
    joined = " ".join(texts).lower()
    words = re.findall(r"[a-z][a-z\-]{2,}", joined)

    filtered = [
        word
        for word in words
        if word not in STOPWORDS and len(word) > 2
    ]

    return [
        {"term": term, "count": count}
        for term, count in Counter(filtered).most_common(limit)
    ]


def summarize_reviews(texts: list[str]) -> str:
    if not texts:
        return "No review text was available for summarization."

    combined = " ".join(texts)
    combined = combined[:3500]

    if len(combined.split()) < 35:
        return "Not enough review text to generate a reliable summary."

    try:
        device = "cuda" if torch.cuda.is_available() else "cpu"

        inputs = summary_tokenizer(
            combined,
            return_tensors="pt",
            truncation=True,
            max_length=1024,
        ).to(device)

        with torch.no_grad():
            output_ids = summary_model.generate(
                **inputs,
                max_length=110,
                min_length=25,
                num_beams=4,
                do_sample=False,
            )

        return summary_tokenizer.decode(
            output_ids[0],
            skip_special_tokens=True,
        )

    except Exception:
        return "Summary could not be generated for this review batch."

@asynccontextmanager
async def lifespan(app: FastAPI):
    global sentiment_analyzer, summary_tokenizer, summary_model

    sentiment_analyzer = pipeline(
        "sentiment-analysis",
        model=SENTIMENT_MODEL,
        device=-1,
    )

    summary_tokenizer = AutoTokenizer.from_pretrained(SUMMARY_MODEL)
    summary_model = AutoModelForSeq2SeqLM.from_pretrained(SUMMARY_MODEL)
    summary_model.to("cuda" if torch.cuda.is_available() else "cpu")
    summary_model.eval()

    yield


app = FastAPI(
    title="Customer Review Sentiment Analyzer API",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOW_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


@app.get("/")
def health_check():
    return {
        "status": "ok",
        "service": "customer-review-sentiment-analyzer",
    }


@app.post("/v1/analyze", response_model=AnalyzeResponse)
def analyze_reviews(payload: AnalyzeRequest):
    cleaned_reviews = [
        clean_text(review)
        for review in payload.reviews
        if len(clean_text(review)) >= 8
    ]

    if not cleaned_reviews:
        raise HTTPException(
            status_code=400,
            detail="No valid review text found.",
        )

    try:
        raw_predictions = sentiment_analyzer(
            cleaned_reviews,
            truncation=True,
            batch_size=16,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Sentiment model failed: {str(exc)}",
        ) from exc

    review_results: list[ReviewResult] = []
    positive_count = 0
    negative_count = 0
    confidence_sum = 0.0
    negative_review_texts: list[str] = []

    for text, pred in zip(cleaned_reviews, raw_predictions):
        label = pred["label"].upper()
        confidence = float(pred["score"])

        if label == "POSITIVE":
            positive_count += 1
        else:
            negative_count += 1
            negative_review_texts.append(text)

        confidence_sum += confidence

        review_results.append(
            ReviewResult(
                text=text,
                label=label,
                confidence=round(confidence, 4),
            )
        )

    total = len(cleaned_reviews)

    # Summarize negative reviews first. If there are no negatives, summarize all reviews.
    summary_source = negative_review_texts if negative_review_texts else cleaned_reviews

    return AnalyzeResponse(
        total_reviews=total,
        sentiment=SentimentBreakdown(
            positive=positive_count,
            negative=negative_count,
            positive_pct=round((positive_count / total) * 100, 2),
            negative_pct=round((negative_count / total) * 100, 2),
            average_confidence=round(confidence_sum / total, 4),
        ),
        summary=summarize_reviews(summary_source),
        top_negative_terms=extract_keywords(summary_source),
        reviews=review_results,
    )