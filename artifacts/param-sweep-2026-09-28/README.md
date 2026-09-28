# Sampling parameters - 28 September 2026

Two repeats of the same suite at each setting, to separate a real difference from run-to-run noise.
Nothing else in the harness changed between repeats.

**Outcome: `temperature: 0` makes extraction reproducible and removes a 6x token blow-up; it is now the default in `modelExtract`. For the answer loop, temperature 0 reproduces 19 of 20 answers byte for byte but locks in two failures, so the answer loop keeps the provider default.**

## Extraction

| Run                       | Model                     | Extraction | Completion tokens | Cost    |
| ------------------------- | ------------------------- | ---------- | ----------------- | ------- |
| temperature 0             | `openai/gpt-4o-mini`      | 20/22      | 3230              | $0.0040 |
| temperature 0 (repeat)    | `openai/gpt-4o-mini`      | 20/22      | 3372              | $0.0041 |
| provider default          | `openai/gpt-4o-mini`      | 20/22      | 3094              | $0.0039 |
| provider default (repeat) | `openai/gpt-4o-mini`      | 17/22      | 19743             | $0.0139 |
| temperature 0             | `google/gemini-2.5-flash` | 20/22      | 4202              | $0.0132 |
| temperature 0 (repeat)    | `google/gemini-2.5-flash` | 20/22      | 4202              | $0.0132 |
| provider default          | `google/gemini-2.5-flash` | 21/22      | 4401              | $0.0137 |
| provider default (repeat) | `google/gemini-2.5-flash` | 21/22      | 4354              | $0.0136 |

Three things to read here.

1. At temperature 0, `gemini-2.5-flash` produced the identical token count in both repeats - 4,202 - and the same verdict on all 22 cases. At the provider default, two cases flipped between repeats.
2. `gpt-4o-mini` at the provider default spent 19,743 completion tokens in one repeat against a ~3,100-token norm, and cost 3.5x more for a worse score. Structured output plus sampling occasionally produces a long retry loop; temperature 0 did not do this in either repeat.
3. Mean quality is not the reason to choose 0. Scores are within one case of each other either way. Reproducibility is the reason, and an evaluation suite is worth little if the same input gives a different verdict on Tuesday.

This is recorded as a comment on `EXTRACT_TEMPERATURE` in `src/server/modules/proposals/extract.ts`.

## Answer loop

| Run                       | Answers | Median ms | Cost    |
| ------------------------- | ------- | --------- | ------- |
| provider default          | 20/20   | 2418      | $0.0516 |
| provider default (repeat) | 18/20   | 2477      | $0.0342 |
| temperature 0             | 18/20   | 2494      | $0.0404 |
| temperature 0 (repeat)    | 18/20   | 2379      | $0.0306 |

`google/gemini-2.5-flash`, 20 answer cases, prompt as shipped.

Byte-identical answers between the two repeats: **3/20 at the provider default, 19/20 at temperature 0**.

The two failures at temperature 0 are reproducible, and one of them is instructive. In `w17` the model mis-copies one Evidence id, writing `c892f171-ee2a-4233-0a91-...` where the tool's `cite` says `...-a091-...`. Production `internalHref` accepts the path shape, the id does not exist, and the grader marks the citation dead - which is exactly the boundary doing its job. At the provider default the same case passed, because a different sample copied the id correctly.

So temperature 0 does not fix a copy error; it makes it happen every time. Two failures reproduced forever are worse for a User than two failures that appear in one turn out of two, while a reproducible suite is better for a developer. The production answer loop therefore keeps the provider default, and the harness sets `--temperature 0` when a run needs to be comparable.

## Files

- [t0-a/](t0-a), [t0-b/](t0-b), [default-a/](default-a), [default-b/](default-b): extraction suite, both models.
- [answers-t0-a/](answers-t0-a), [answers-t0-b/](answers-t0-b), [answers-default-b/](answers-default-b): answer suite, `gemini-2.5-flash`. The fourth answer run is [../prompt-iteration-2026-09-28/answers-after/](../prompt-iteration-2026-09-28/answers-after).

## Reproducing

```bash
DATABASE_URL=postgres://pm:pm@localhost:5433/pm_eval_20260928 \
OPENAI_API_KEY=<openrouter-key> OPENAI_BASE_URL=https://openrouter.ai/api/v1 AI_PROVIDER=openai \
npx tsx scripts/eval.mts --out <dir> --suite extraction --skip-index --temperature 0 \
  --models openai/gpt-4o-mini,google/gemini-2.5-flash
```

Pass `--temperature default` for the provider-default arm (without the flag, extraction now runs at the shipped `EXTRACT_TEMPERATURE` of 0); use `--suite why` for the answer arm.
