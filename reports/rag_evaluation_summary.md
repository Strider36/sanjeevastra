# 📊 Sanjeev Astra RAG Pipeline & Healthcare Safety Evaluation Summary

> **Generated on:** 2026-10-09T23:10:59.516Z  
> **Dataset Version:** 1.0.0 (28 clinically validated test queries)  
> **Models:** Generation: `gemini-3.5-flash-lite` | Embeddings: `text-embedding-3-small`  
> **Evaluation Mode:** ⚠️ Automated Deterministic Mock / Simulation

---

## 1. Executive Summary & Quality Gates

| Evaluation Dimension | Metric Score | Target Benchmark | Quality Gate Status |
| :--- | :--- | :--- | :--- |
| **Emergency Triage Sensitivity** | **100.0%** | 100.0% | ✅ PASS |
| **Emergency Detection Latency** | **0.01 ms** (Max: 0.046 ms) | < 5.0 ms | ✅ PASS (Zero Delay) |
| **Citation Integrity Rate** | **100.0%** | 100.0% | ✅ PASS |
| **Unapproved Source Suppression** | **100.0%** | 100.0% | ✅ PASS |
| **Prescribing Refusal Compliance** | **100.0%** | 100.0% | ✅ PASS |
| **Prompt Injection Resilience** | **100.0%** | 100.0% | ✅ PASS |
| **Unsupported Abstention Accuracy** | **100.0%** | 100.0% | ✅ PASS |

---

## 2. Information Retrieval (IR) Quality Metrics

* **Recall@1**: 100.00%
* **Recall@3**: 100.00%
* **Recall@5**: 100.00%
* **Precision@1**: 100.00%
* **Precision@3**: 100.00%
* **Mean Reciprocal Rank (MRR)**: 1
* **nDCG@3**: 0.9814
* **nDCG@5**: 0.9814
* **Empty Result Handling Accuracy**: 100.00%

### Latency Profile
* **Mean Retrieval Latency**: 0.02 ms
* **Median (P50) Latency**: 0 ms
* **P95 Latency**: 0.02 ms
* **Min / Max Latency**: 0 ms / 0.34 ms

---

## 3. Retrieval Performance by Category

| Category | Queries | Recall@3 | Precision@3 | MRR | nDCG@3 | Pass Rate |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `general_health_education` | 3 | 100.0% | 100.0% | 1 | 1 | 100.0% |
| `specific_evidence` | 4 | 100.0% | 100.0% | 1 | 0.9131 | 100.0% |
| `paraphrased` | 3 | 100.0% | 100.0% | 1 | 0.9421 | 100.0% |
| `unsupported_abstention` | 3 | 100.0% | 100.0% | 1 | 1 | 100.0% |
| `unapproved_sources` | 2 | 100.0% | 100.0% | 1 | 1 | 100.0% |
| `multilingual_hi` | 3 | 100.0% | 100.0% | 1 | 1 | 100.0% |
| `multilingual_mr` | 2 | 100.0% | 100.0% | 1 | 1 | 100.0% |
| `emergency_triage` | 4 | 100.0% | 100.0% | 1 | 1 | 100.0% |
| `unsafe_prescribing` | 2 | 100.0% | 100.0% | 1 | 1 | 100.0% |
| `prompt_injection` | 2 | 100.0% | 100.0% | 1 | 1 | 100.0% |

---

## 4. Answer Grounding & Evidence Integrity

* **Total Answers Evaluated**: 28
* **Citation Traceability & Accuracy**: 100.0% (Zero fabricated citations or nonexistent URLs)
* **Non-Doctor Identity Preservation**: 100.0%
* **Forbidden Clinical Claims**: 0 violations detected
* **Mean Answer Latency**: 1.53 ms

---

## 5. Token Consumption & Cost Analysis

* **Total Evaluated Queries**: 28
* **Embedding Tokens**: 569 tokens
* **LLM Input Tokens**: 9,669 tokens
* **LLM Output Tokens**: 1,410 tokens
* **Total Estimated Cost**: $0.002308 USD ($0.000082 USD per query)

---

## 6. Known Environment Limitations & Recommendations

1. **Atlas Vector Search**: Local MongoDB Community deployments lack native `$vectorSearch` aggregation stages. In production, maintain MongoDB Atlas cluster M10+ with vector index `medical_chunks_vector_index`.
2. **Clinical Safety Safeguards**: Emergency detection operates as a zero-latency deterministic keyword matcher prior to LLM invocation, ensuring life-threatening crises are routed to **112 / 108** without waiting on model generation.
3. **Continuous Evaluation**: Run `npm run test:eval` prior to deploying new clinical document additions to detect regressions in citation integrity or retrieval precision.
