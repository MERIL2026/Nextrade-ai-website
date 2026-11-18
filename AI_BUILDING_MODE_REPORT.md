# NEXTRADE AI — AI BUILDING MODE REPORT

## 1. Philosophy & Honesty Guarantee

Nextrade AI executes genuine **Google Gemini (`@google/genai`)** financial research synthesis on `POST /api/research` and `POST /api/workspace/research` whenever `GEMINI_API_KEY` is configured and upstream inference succeeds. Whenever AI credentials are unavailable, disabled by admin policy, rate-limited, or fail upstream, Nextrade AI **never fabricates fake AI briefs** — instead it surfaces **AI Building Mode** and honest module readiness states.

## 2. Module Readiness Matrix

| Module | Current State | Behavior |
| :--- | :--- | :--- |
| **Live Gemini Financial Research** (`POST /api/research`, `POST /api/workspace/research`) | `LIVE WHEN CONFIGURED` | Enforces active admin prompt version (`ai_prompt_versions`), active AI Operations Policy (`ai_policy_versions`), prompt-injection sanitization, live quote grounding context (`liveQuote`), and Gemini structured JSON output via `@google/genai` |
| **AI Market Analysis Engine** | `BUILDING` | Under active development; explicitly displayed as `BUILDING` in UI roadmaps |
| **AI Portfolio Intelligence** | `COMING SOON` | Planned enhancement; clearly marked `COMING SOON` with zero simulated scores |
| **Predictive & Risk Analytics Engine** | `COMING SOON` | Planned enhancement; current analytics strictly compute mathematical metrics (`calculateSeriesRiskMetrics`, HHI concentration) from fetched market series |

## 3. Error Codes & Admin Policy Behavior

`src/lib/researchEngine.ts` eliminates static thesis generation and maps failure modes to structured `ResearchServiceError` codes (`503`/`400`), all logged transparently in `ai_request_logs` for Phase 3–6 observability:

- `AI_POLICY_BLOCKED` (`400`): Prompt injection patterns detected or query rejected by active safety policy (`BLOCKED` in telemetry).
- `AI_FEATURE_DISABLED` (`503`): Platform AI gate disabled or capability (`public_research` / `workspace_research`) toggled off in `/admin/ai` or `/admin/ai-policies`.
- `AI_NOT_CONFIGURED` (`503`): `GEMINI_API_KEY` missing or unset; client renders the **AI Building Mode** status panel explaining live key configuration (`FAILED` logged cleanly without fake response bodies).
- `AI_UNAVAILABLE` (`503`): Upstream Gemini API error or empty JSON response; client preserves user prompt input and displays honest unavailability + Building Mode context.

## 4. UI & Admin Consistency

- Updated `src/components/WorkspaceApp.tsx`, `src/components/WorkspacePreviewFrame.tsx`, and `src/components/pages/MarketsResearchPaperPages.tsx` (`/research`) to remove illustrative sample briefs and render the **AI Building Mode** module roadmap cleanly.
- Updated `src/components/admin/AdminAiView.tsx`, `src/components/admin/AdminAiPoliciesView.tsx`, `src/admin/superOpsMath.ts`, and `src/admin/superOpsService.ts` so emergency AI degradation controls and versioned policy descriptions reflect **AI Building Mode** rather than fake fallback briefs.
- Updated `src/workspace/service.ts` (`parseResearchJson`) and `src/workspace/types.ts` to label unconfigured/legacy non-Gemini records as `'unavailable'`.
