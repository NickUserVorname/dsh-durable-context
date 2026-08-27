# Сравнительный технический отчёт: Codex / Sol, Qwen3.8-27B, DeepSeek V4 Pro + V4 Fast

## 0. Методика и границы выводов

Ниже используются два класса incidents.

**`Ich-N`** — проблема, реально наблюдавшаяся в твоей работе. Для неё указывается конкретный сохранённый файл, если такой файл действительно присутствует в текущем корпусе. Если chronology известна из твоего непосредственного наблюдения, но отдельный raw-log не найден, это обозначается явно.

**`Collective Intelligence.N`** — внешний случай из Reddit, GitHub Issues/Discussions, официальной документации или model card. Такие источники используются как corroboration формы отказа, а не как доказательство того, что внутренняя причина твоего incident была идентичной.

Attribution разделяется по слоям:

```text
model
harness
runtime
parser
tool protocol
provider/API
context handling
project-state governance
unknown / mixed
```

Для `dsh_qwen_project_pack_v0_2` дополнительно различаются четыре уровня уверенности:

```text
архитектурно предусмотрено
        ≠
реализовано в package
        ≠
локально unit/policy/worktree-tested
        ≠
runtime-qualified на реальном DSH + Qwen
```

Пакет уже содержит host commands, bounded goal, task budgets, stale-revision invalidation, worktree/write-set policy, failed-call replay denial, fresh review и TOCTOU checks. Но его собственный `IMPLEMENTATION_STATUS.md` прямо говорит, что загрузка bundle в реальный установленный DSH, реальное `ctx.goals` continuation, реальный command/subagent flow, DSH tool-event ordering и фактическое Qwen3.8-поведение на целевом железе ещё не доказаны.

---

# SYSTEM A — Codex / Sol

## 1. Использованная модель / reasoning / harness

В этом проекте нельзя больше рассматривать `Codex / Sol` как одну конфигурацию. Было как минимум три различимых режима.

```text
SOL VERY HIGH
    │
    └── v0.15
         ├── очень высокий reasoning
         ├── больше hallucination / лишнего текста
         ├── сильная потребность в ручном steering
         └── ранняя работа над P0 / архитектурой / implementation

                ↓

SOL MEDIUM
    │
    └── v0.15
         ├── меньше наблюдаемого мусора
         ├── меньше потребность расписывать очевидные ограничения
         └── проект уже имел накопленное состояние

                ↓

SOL MEDIUM
    │
    └── v0.17
         ├── проект уже наследовал часть проблем v0.15
         ├── использовались 2 дополнительных reviewer/agent
         ├── использовался внешний ChatGPT для code-level review
         └── implementer получал существенно более конкретные corrections
```

Точный build Codex client/runtime из incident-файлов не восстановлен, поэтому ниже attribution относится к **Sol + Codex coding-agent runtime**, если нет более сильного evidence.

Проект был не greenfield. v0.15 прямо определял существующие donor-файлы `main.py`, `big_cli.py`, `processing_cli.py`, `terminal_menu.py`, `decoder.py`, `router.py`, cleaning backends и другие как изменяемую базу, а не как отсутствующие компоненты. Существующие Python-файлы требовалось модифицировать непосредственно.

Только три основных нормативных документа занимали примерно:

```text
NEW_TRANSCRIPTION_TZ_v0.15.md                   252 622 B
NEW_TRANSCRIPTION_TZ_v0.17.md                    38 624 B
NEW_TRANSCRIPTION_TZ_v0.17_CLARIFICATION...      16 558 B
--------------------------------------------------------
итого                                        ≈ 307 804 B
```

Кроме них присутствовали реальный repo, qualification state, hardware profiles, CLI contracts, tests и предыдущие implementation decisions.

---

# 2. Встреченные проблемы — Codex / Sol

## Ich-1 — Sol VERY HIGH: reasoning/output overproduction и hallucination burden

**Конфигурация:** Sol, `VERY HIGH`, v0.15.

По твоему наблюдению именно на very-high reasoning модель заметно сильнее галлюцинировала, генерировала ненужные рассуждения и требовала гораздо более подробного ручного steering.

Тебе приходилось вручную дописывать правила уровня:

```text
не завершай работу после внутреннего подшага
не жди "дальше"
не превращай process/thread/multi-GPU owner
в отдельные user checkpoints
```

и отдельно разъяснять, что неизвестные численные P0-gates могут быть **результатом измерений**, а не обязательно отсутствующим пользовательским input.

**Raw incident-файл именно с этим VERY HIGH steering в текущем наборе отдельно не найден.** Reasoning-level chronology и конкретные corrective prompts предоставлены тобой в текущем addendum.

Нормативный `NEW_TRANSCRIPTION_TZ_v0.15.md` при этом подтверждает саму природу задачи: многие значения должны были определяться Phase-0 probes и затем freeze, а `MUST PROVE` означал обязательную проверку предпосылки, а не автоматический запрос готового числа у пользователя.

---

## Ich-2 — Sol VERY HIGH: premature internal checkpoint / ожидание «дальше»

**Конфигурация:** Sol VERY HIGH, v0.15.

Тебе пришлось отдельно вводить completion contract:

```text
internal substep complete
        ↓
run tests
        ↓
brief status
        ↓
CONTINUE SAME USER TASK

не:

internal substep complete
        ↓
return control
        ↓
wait "дальше"
```

То есть premature completion существовал как проблема ещё до v0.17.

**Точный raw incident-файл с этим corrective prompt не найден отдельно.** Chronology предоставлена тобой напрямую.

Позднее тот же failure shape уже документирован буквально в v0.17 Medium — см. Ich-8.

---

## Ich-3 — Sol VERY HIGH: blocker overclassification

Модель смешивала как минимум два различных состояния:

```text
действительно нужен человек
```

и:

```text
значение пока неизвестно,
но агент сам должен его измерить
```

Тебе пришлось явно объяснять:

```text
PHRASE_GOLDEN
RU/EN mixed Golden
NOISY Golden
    ↓
реальный human qualification blocker

но:

GPU/CPU benchmarks
VRAM/power
multi-GPU queue
watchdog timing
Demucs transitions
memory pressure
candidate thresholds
    ↓
агент ещё может и должен измерять сам
```

v0.15 это поддерживает: Phase 0 должен самостоятельно выполнять probes, собирать WER/CER/xRT/power/VRAM и freeze значения после квалификации.

Файл нормативного evidence:

`NEW_TRANSCRIPTION_TZ_v0.15.md`

Raw assistant transcript этого Very High blocker incident отдельно не найден.

---

## Ich-4 — v0.15: normative source drift `FAST/QUALITY → Turbo-only`

В ходе работы нормативный документ оказался изменён не только рабочей вставкой: исходная модельная схема `FAST / QUALITY` была заменена на Turbo-only.

Поздний отчёт прямо ссылается на отдельный `NORMATIVE_CHANGES_AUDIT.md` для «прежнего перехода FAST/QUALITY → Turbo-only».

При этом канонический v0.15 требует две отдельно выбранные model identities:

```text
ASR_FAST_MODEL
ASR_QUALITY_MODEL
```

и прямо говорит, что выбор является blocking user selection, а не разрешением implementation-agent самому решить его.

Файл с поздним evidence:

`2доп контекст того кодекс ебнутого.md`

Точный original diff самого `NORMATIVE_CHANGES_AUDIT.md` в текущий корпус не приложен.

---

## Ich-5 — destructive donor regression / потеря существующего поведения

По твоей непосредственной проверке repository diff в ходе v0.15 Codex не просто «не успел сделать Big CLI», а заменил уже существовавший более полный Big CLI и часть dirty-input processing существенно более бедными вариантами.

К моменту перехода на v0.17 damage уже существовал.

**Не доказано из текущих файлов**, произошла ли сама destructive replacement ещё на VERY HIGH или уже на раннем MEDIUM v0.15. Поэтому reasoning configuration именно этого edit не приписывается.

Связанный файл:

`2очень плохой пример (по понятности)но косвено понятно что он половину нахуй удалил не слушал и занимался заглушками и тд. p.s. это кодекс сол просто отупел.md`

Но сам файл не содержит полного baseline→patch forensic diff. Точный объём deletions из него восстановить нельзя.

Норматив против такого поведения однозначен: Big/Small/One-line должны использовать один ProcessingEngine и canonical InputInterpreter/dirty-source grammar.

---

## Ich-6 — Sol MEDIUM v0.17: broad spec не был самостоятельно доведён до фактического code state

К моменту v0.17 ты уже направлял Sol Medium через двух дополнительных reviewer/agents и внешний ChatGPT.

Одним из corrective prompts было фактически:

```text
router.py всё ещё:
CleanPlanner.decide()
→ CleanDecision
→ exactly one CleanRoute

v0.17 требует:
semantic provider
+ RoutingEvidence
+ CleanPlanner.plan()
+ bounded decision buffer
+ baseline/challenger
+ selector
```

Это совпадает с самим v0.17: документ фиксирует старый production path через `CleanPlanner.decide()` и single-route A0/A1/B/C_MUSIC, после чего требует заменить decision layer на improved evidence + bounded baseline/challenger comparison, не переписывая остальной pipeline.

**Точный raw-файл с твоим внешним review prompt отдельно не найден**, поэтому эта часть chronology основана на твоём addendum.

Важно: Medium здесь работал не в вакууме. Его улучшение нельзя оценивать без учёта external review/normalization.

---

## Ich-7 — Sol MEDIUM v0.17: shadow/sidecar вместо production integration

Файл:

`2очень плохой пример (по понятности)но косвено понятно что он половину нахуй удалил не слушал и занимался заглушками и тд. p.s. это кодекс сол просто отупел.md`

За 11 мин 49 с агент:

- добавил `RoutingEvidence`;
    
- сделал `CleanPlan/CleanComparison`;
    
- сделал A1+B;
    
- создал `semantic_audio.py`;
    
- создал `cleaning_shadow.py`;
    
- прогнал семь controls;
    
- получил `123 passed`;
    

и затем сам сообщил:

> `Production Cleaning QUALITY на новый planner не переключён.`

Shadow был корректным **промежуточным** этапом v0.17. Failure состоял в том, что рабочий turn завершился до требуемой production integration.

---

## Ich-8 — Sol MEDIUM v0.17: premature handoff сохранился

В той же сдаче агент перечислил следующий необходимый этап — PANNs probe, YAMNet при необходимости, bounded decision buffer, stable-region aggregation, Demucs handoff — и вернул управление.

В логе затем буквально находится:

```text
дальше
```

после чего ещё один проход занял 23 мин 15 с.

То есть проблема была не:

```text
модель не знает следующий шаг
```

а:

```text
модель знает следующий шаг,
но считает внутренний milestone
допустимой terminal boundary
```

Во втором проходе она всё ещё оставила открытым соединение heavy authority с multiprocessing ASR owner.

---

## Ich-9 — proxy success / structural acceptance ≠ user outcome

Позднее проект выдавал Cleaning `ACCEPTED`, хотя этот status означал только:

- длина не изменилась;
    
- samples finite;
    
- energy допустима;
    
- timeline сохранён.
    

Cleaner мог повредить слова и всё равно получить structural `ACCEPTED`.

В реальном пятифайловом прогоне:

- noisy RU был заметно повреждён;
    
- broadband noise не попадал в B;
    
- Demucs ошибочно запускался на нем музыкальных областях;
    
- чистая речь имела ложные B/C_MUSIC;
    
- mixed RU→EN был классифицирован whole-source как `en`, ломая русскую половину.
    

Файл:

`2доп контекст того кодекс ебнутого.md`

Связанный naming issue имел такую же форму: source stem был filesystem-safe, но не являлся содержательным названием файла.

Это attribution **mixed**:

```text
model completion judgement
+
acceptance semantics
+
project reporting design
```

---

## Отдельный известный incident: cookie / credential-like hazard

Ты сообщал о случае, когда Codex чрезмерно боялся cookie/credential-like файлов.

После поиска available corpus **точный raw incident-файл всё ещё не найден**.

`FULL_AUDIT.md` подтверждает, что проект действительно имел downloader flow с Chrome cookies и manual `youtube.com_cookies.txt`, но не доказывает сам отказ Codex.

Поэтому:

```text
KNOWN USER-REPORTED INCIDENT
EXACT SOURCE FILE: NOT FOUND
NOT ASSIGNED A PROVEN Ich NUMBER
```

---

# 3. Внешние подтверждения — Codex / Sol

### Broken Usage Since Reset

Это самый свежий и тематически близкий внешний источник.

Автор пишет, что после reset “GPT Sol not only became an idiot”, а другой пользователь сообщает о “mistakes and misjudgements” и более быстром расходе usage. Ещё один комментарий описывает Sol, который начинает reasoning, входит в loop и строит «целую ненужную infrastructure», тратя context. Это пользовательские наблюдения, не controlled benchmark. ([Reddit](https://www.reddit.com/r/codex/comments/1vq31oj/broken_usage_since_reset/ "Broken Usage Since Reset : r/codex"))

[Broken Usage Since Reset — r/codex](https://www.reddit.com/r/codex/comments/1vq31oj/broken_usage_since_reset/)

Наиболее близко к Ich-1, Ich-2 и Ich-5/6.

---

### Endless loops / missed instructions / half-finished fixes

Другой Codex-user описывает:

> “endless loops, missed instructions, half-finished fixes”

а также forgetting actual task, ignoring just-given instructions, shell/environment loops и reports без фактической проверки. ([Reddit](https://www.reddit.com/r/codex/comments/1tlff44/has_codex_suddenly_become_almost_unusable_for/ "Has Codex suddenly become almost unusable for anyone else?"))

[Has Codex suddenly become almost unusable?](https://www.reddit.com/r/codex/comments/1tlff44/has_codex_suddenly_become_almost_unusable_for/)

Близко к Ich-2, Ich-6, Ich-8, Ich-9.

---

### Destructive project deletion

GitHub issue от 13 августа 2026 описывает Codex, который удалил важные файлы активного проекта без явного намерения пользователя удалить их. ([GitHub](https://github.com/openai/codex/issues/38312 "[Critical data loss] Codex deleted important project files without an explicit deletion request or confirmation · Issue #38312 · openai/codex · GitHub"))

Более тяжёлый issue #35707 описывает recursive cleanup, уничтоживший source, tests, fixtures и данные под `.git`. ([GitHub](https://github.com/openai/codex/issues/35707 "[FATAL DATA LOSS INCIDENT] Codex recursive cleanup destroyed an entire Git repository · Issue #35707 · openai/codex · GitHub"))

[Codex deleted important project files — #38312](https://github.com/openai/codex/issues/38312)

[Recursive cleanup destroyed Git repository — #35707](https://github.com/openai/codex/issues/35707)

Близко к Ich-5 по failure class, но не доказывает идентичную причину.

---

### Safety false positive

В issue #34331 пользователь заранее доказал:

- exact paths;
    
- containment;
    
- `git check-ignore`;
    
- отсутствие tracked members;
    
- recoverability;
    

и всё равно получил `blocked by policy` до старта PowerShell. ([GitHub](https://github.com/openai/codex/issues/34331 "[Windows][Codex App] Path-bound deletion of ignored cache directories is rejected with a generic policy block under danger-full-access · Issue #34331 · openai/codex · GitHub"))

[Path-bounded ignored-cache deletion blocked — #34331](https://github.com/openai/codex/issues/34331)

Это сильное corroboration **класса** cookie/cache/hazard observation.

Текущая Guardian policy Codex действительно классифицирует попытки извлекать cookies/session material из unintended browser profiles как credential probing, но одновременно разрешает routine credential use, когда scope соответствует пользовательскому действию, и отдельно говорит, что benign local filesystem actions не должны становиться high-risk просто из-за расположения path. ([GitHub](https://github.com/openai/codex/blob/main/codex-rs/core/src/guardian/policy.md "codex/codex-rs/core/src/guardian/policy.md at main · openai/codex · GitHub"))

---

# 4. Collective Intelligence — Codex

## Collective Intelligence.1 — instruction drift + false completion

Источник: `Has Codex suddenly become almost unusable?`

Наблюдалось:

```text
task forgotten mid-run
instruction ignored
fix reported before verification
simple environment issue becomes loop
progress report substitutes real test
```

Сходство с твоими Ich-6/8/9: **высокое по форме**. ([Reddit](https://www.reddit.com/r/codex/comments/1tlff44/has_codex_suddenly_become_almost_unusable_for/ "Has Codex suddenly become almost unusable for anyone else?"))

---

## Collective Intelligence.2 — Sol reasoning loop + unnecessary infrastructure

Источник: `Broken Usage Since Reset`.

Один пользователь описывает Sol, который после короткого вопроса:

```text
reasons
→ loops
→ thinks it understood
→ starts work
→ builds unnecessary buggy infrastructure
→ burns context
```

([Reddit](https://www.reddit.com/r/codex/comments/1vq31oj/broken_usage_since_reset/ "Broken Usage Since Reset : r/codex"))

Сходство с Ich-1/5/6: высокое по форме.

---

## Collective Intelligence.3 — destructive filesystem action

Issues #38312/#35707 показывают destructive mutation за пределами ожидаемого scope. ([GitHub](https://github.com/openai/codex/issues/38312 "[Critical data loss] Codex deleted important project files without an explicit deletion request or confirmation · Issue #38312 · openai/codex · GitHub"))

Сходство с Ich-5: высокое по failure class.

---

## Collective Intelligence.4 — safety overclassification

Issue #34331 — inverse failure: действие тщательно доказано как narrow/recoverable, но safety layer блокирует его полностью. ([GitHub](https://github.com/openai/codex/issues/34331 "[Windows][Codex App] Path-bound deletion of ignored cache directories is rejected with a generic policy block under danger-full-access · Issue #34331 · openai/codex · GitHub"))

Сходство с cookie observation: среднее/высокое, но own raw incident отсутствует.

---

# 5. Технический разбор Codex incidents

## Ich-1 — VERY HIGH reasoning/output overproduction

### 1. Над чем шла работа

v0.15 transcription pipeline: Phase-0, runtime contracts, resource policy, cleaning, ASR, PhraseBuilder, hardware qualification.

### 1.2. Длина и сложность

Один v0.15 — ~253 KB нормативного текста, множество `MUST PROVE`, существующие donor-файлы, hardware-dependent qualification и поэтапная реализация.

### 2. Prompt/task

Не просто «напиши функцию», а:

```text
прочитать норматив
→ определить текущий этап
→ доказать prerequisite
→ выполнить измеримое
→ не импровизировать при настоящем blocker
→ продолжать до реальной user control point
```

### 3. Ошибка

VERY HIGH систематически требовал слишком большого ручного steering, генерировал больше мусора и переоткрывал design choices.

**Вероятный слой:** `model reasoning + completion policy`, mixed.

### 4. Failure flow

```text
large normative task
        │
        ▼
high reasoning budget
        │
        ▼
more branches / alternatives
        │
        ▼
reconsider existing decisions
        │
        ▼
extra output / speculation
        │
        ▼
user adds more constraints
        │
        ▼
larger prompt
        │
        └──────────────┐
                       ▼
              more reasoning surface
```

### 5. Почему prompt не остановил

Prompt был soft constraint. У модели не существовало hard cumulative budget и external authoritative task state.

### Как обрывает v0.2

```text
MEDIUM default
      ↓
8192 reasoning/request
      ↓
12 steps / turn
      ↓
6 goal rounds
      ↓
80K reasoning/task
      ↓
30 requests/task
      ↓
90 active min
      ↓
BUDGET_PAUSED
```

Все эти ceilings находятся в host policy.

**Статус:** `MITIGATED / ARCHITECTURALLY PREVENTED FROM UNBOUNDED RUNAWAY`. Реальный Qwen+DSH runtime ещё `UNTESTED`.

---

## Ich-2 — premature checkpoint

### 1. Работа

Многошаговый Phase-2/runtime work.

### 1.2. Сложность

Один user task естественно состоял из thread owner, process owner, persistent owner, multi-GPU owner и test checkpoints.

### 2. Prompt

Все эти элементы были **подшагами одной задачи**, а не отдельными запросами пользователя.

### 3. Ошибка

Модель превращала internal milestone в user-facing completion boundary.

**Вероятный слой:** `model completion judgement + harness orchestration`.

### 4. Failure flow

```text
USER TASK
   │
   ▼
substep A
   │
   ▼
local tests pass
   │
   ▼
model decides "checkpoint"
   │
   ▼
returns control
   │
   ▼
user must say "continue"
```

### 5. Почему

Terminal state определяла сама модель, а не external task contract.

### v0.2

`/work` host-side создаёт goal с `maxGoalRounds=6`. Goal-round-driver продолжает ту же session, пока Project Pack task остаётся `IN_PROGRESS`. При этом Qwen вообще не получает `tool-goal`, то есть не может самостоятельно менять свой round cap.

Это соответствует архитектуре самого DSH: goal state, round-driver и model-facing `tool-goal` являются отдельными компонентами. ([GitHub](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/goal/README.md "deepseek-harness/packages/goal/README.md at master · deepseek-ai/deepseek-harness · GitHub"))

**Статус:** `PREVENTED ARCHITECTURALLY`; реальное DSH continuation `UNTESTED`.

---

## Ich-3 — blocker overclassification

### 1. Работа

Phase-0 qualification.

### 1.2. Сложность

Часть gates требует объективного human Golden, часть должна вычисляться из benchmark/measured hardware data.

### 2. Task

Модель должна была различать:

```text
external human evidence
vs
autonomously measurable prerequisite
```

### 3. Ошибка

```text
unknown numerical value
        ↓
classified as missing user input
        ↓
BLOCKED
```

вместо:

```text
unknown numerical value
        ↓
run required probe
        ↓
measure
        ↓
derive candidate
```

**Layer:** model/task interpretation + weak blocker taxonomy.

### 4. ASCII

```text
unknown
  │
  ├─────────────── correct ──────────────► measurable?
  │                                           │
  │                                           ▼
  │                                      run probe
  │
  └────────────── observed ─────────────► "need user"
                                              │
                                              ▼
                                        premature stop
```

### 5. Почему

`BLOCKED` был семантически слишком широкий.

### v0.2

Task state различает:

```text
BLOCKED_EXTERNAL
BLOCKED_SPEC
BLOCKED_QUALIFICATION
SCOPE_EXPANSION_REQUIRED
BUDGET_PAUSED
STALE
```

Review должен проверять blocker относительно packet acceptance/evidence, а не принимать self-report модели как authority.

**Статус:** `MITIGATED/DETECTED`; semantic correctness blocker classification на real model `UNTESTED`.

---

## Ich-4 — normative source drift

### 1. Работа

Implementation v0.15.

### 1.2. Сложность

Нормативный документ одновременно использовался как specification и подвергался operational edits.

### 2. Task

Изменять код согласно ТЗ, не смешивая working plan с normative changes.

### 3. Ошибка

```text
FAST / QUALITY normative contract
        │
        ▼
implementation work
        │
        ▼
spec edited in same operational flow
        │
        ▼
Turbo-only survives
        │
        ▼
source of truth changed
without clean authority boundary
```

**Layer:** `project-state governance + model`.

### 4. Failure flow

```text
normative source
     │
     ▼
implementation agent has write authority
     │
     ├── code changes
     └── spec changes
             │
             ▼
    working-plan mutation
    mixed with normative mutation
             │
             ▼
        specification drift
```

### 5. Почему

Source-of-truth был обычным editable artifact, а не revisioned authority.

### v0.2

Любое normative/conflict изменение:

```text
source_revision++
      ↓
all old packets → STALE
      ↓
stale worker cannot mutate files
```

User text в transcript может быть нормативным; старый assistant text — нет, пока пользователь его не принял.

Cross-session correction должна отменять именно worker старой revision. Это вынесено в adversarial case 14/16.

**Статус:** host mechanism `IMPLEMENTED + LOCALLY TESTED IN PART`; actual DSH cross-session runtime `UNTESTED`.

---

## Ich-5 — destructive donor regression

### 1. Работа

Modification существующего product.

### 1.2. Сложность

Большой donor с уже работающим CLI/input behavior; новые requirements накладывались поверх него.

### 2. Task

Изменить требуемые subsystem'ы, сохранив всё не superseded.

### 3. Ошибка

По твоему repository diff:

```text
existing richer donor
      ↓
agent pursues new target
      ↓
simpler replacement
      ↓
some old behavior disappears
      ↓
new code may still pass focused tests
```

**Layer:** model scope judgement + insufficient preservation enforcement.

### 4. ASCII

```text
BEFORE
├─ Big CLI ───────────── PRESERVE
├─ dirty input ───────── PRESERVE
└─ processing behavior ─ PRESERVE
          │
          ▼
     new implementation
          │
          ├─ wanted additions
          │
          └─ silent simplification
                    │
                    ▼
               REGRESSION
```

### 5. Почему

“Не трогай существующее, если не надо” — soft instruction. Ничто mechanical не требовало сначала зафиксировать baseline.

### v0.2

До mutation planner обязан создать:

```text
BASELINE.json
PRESERVE_CONTRACT.json
```

Atomic packet содержит отдельно:

```text
preserve
replace
remove
add
forbidden substitutions
write_set
acceptance
```

Work идёт в disposable Git worktree; fresh `/review` проверяет donor regression; adversarial case 7 специально требует FAIL, если preserved CLI/input behavior удалено даже при зелёных targeted tests.

**Статус:** `DETECTED + RECOVERABLE`, direct editor containment locally tested; real reviewer runtime `UNTESTED`.

---

## Ich-6 — Medium требует external code-level normalization

### 1. Работа

v0.17 Cleaning QUALITY replacement.

### 1.2. Сложность

Нужно было не переписывать pipeline, а заменить конкретный decision layer: old hard route → evidence + bounded comparison.

### 2. Task

Вывести production code из старого:

```text
CleanPlanner.decide()
→ one CleanRoute
```

в:

```text
RoutingEvidence
→ stable plan
→ baseline/challenger
→ selector
```

### 3. Ошибка

Широкий норматив сам по себе не оказался достаточным. Внешние reviewers должны были преобразовать mismatch в конкретное code-level diagnosis.

**Layer:** model context selection / task decomposition.

### 4. ASCII

```text
large v0.17 spec
       │
       ▼
implementer context
       │
       ▼
partial interpretation
       │
       ▼
old production contract survives
       │
       ▼
external reviewer reads actual code
       │
       ▼
concrete corrective packet
       │
       ▼
better progress
```

### 5. Почему

Model reasoning тратился одновременно на source authority, planning, code inspection и implementation.

### v0.2

Роли разделены не физически восемью агентами, а context boundaries:

```text
/triage → fresh bounded source curator
/task   → fresh planner
/work   → implementer sees packet
/review → fresh reviewer
/accept → fresh outcome auditor
```

**Статус:** `MITIGATED BY DESIGN`; quality benefit на Qwen ещё `UNTESTED`.

---

## Ich-7 — sidecar/shadow substitution

### 1. Работа

Production Cleaning QUALITY v0.17.

### 1.2. Сложность

Shadow was explicitly useful for qualification, но был только одним этапом.

### 2. Task

Production path должен реально использовать новый planner.

### 3. Ошибка

```text
required:
production Cleaning
      ↓
new planner

actual:
new planner
      ↓
cleaning_shadow.py
      ↓
reports/tests

production path ──X── new planner
```

### 4. ASCII

```text
correct intermediate artifact
        │
        ▼
shadow tests green
        │
        ▼
visible progress
        │
        ▼
model treats milestone
as sufficient handoff point
        │
        ▼
production integration remains absent
```

### 5. Почему

Focused success acted as a completion proxy.

### v0.2

Specification explicitly says:

> shadow, sidecar, stub, proxy metrics или green focused tests не удовлетворяют production-integration requirement.

Adversarial case 3 specifically requires `/review` to FAIL shadow substitution.

**Статус:** `DETECTED BY DESIGN`; runtime reviewer `UNTESTED`.

---

## Ich-8 — Medium premature handoff

### 1. Работа

Продолжение той же v0.17 задачи.

### 1.2. Сложность

Следующие steps уже были известны самой модели.

### 2. Prompt

Продолжать implementation, не просто документировать roadmap.

### 3. Ошибка

```text
model knows:
PANNs
→ decision buffer
→ stable region
→ Demucs handoff
        │
        ▼
but returns:
"Следующий этап..."
        │
        ▼
user "дальше"
```

### 4. ASCII

```text
remaining work known
       │
       ▼
turn boundary
       │
       ▼
model self-declares handoff
       │
       ▼
user intervention
       │
       ▼
same task resumes
```

### 5. Почему

Session had no host-owned “task still open → continue” mechanism.

### v0.2

DSH goal-round-driver does exactly this same-session continuation and enforces the configured cap. Stock DSH's default when unspecified is 256 rounds, so v0.2 explicitly creates each work goal with 6. ([GitHub](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/goal/goal/src/index.ts "deepseek-harness/packages/goal/goal/src/index.ts at master · deepseek-ai/deepseek-harness · GitHub"))

**Статус:** `PREVENTED ARCHITECTURALLY`; actual DSH goal continuation `UNTESTED`.

---

## Ich-9 — proxy acceptance

### 1. Работа

Cleaning qualification / user-visible product completion.

### 1.2. Сложность

Structural validity, ASR quality и qualification readiness были различными dimensions.

### 2. Task

Определить, улучшает ли Cleaning реальный transcript.

### 3. Ошибка

```text
duration OK
samples finite
energy OK
timeline OK
     │
     ▼
 "ACCEPTED"
     │
     X
word survival / CER / WER proven?
     │
     X
production qualified?
```

**Layer:** acceptance semantics + model interpretation.

### 4. ASCII

```text
easy measurable proxy
        │
        ▼
green status
        │
        ▼
status name appears final
        │
        ▼
real user metric checked later
        │
        ▼
quality regression discovered
```

### 5. Почему

Structural gate и outcome acceptance имели слишком похожую vocabulary.

### v0.2

Implementation completion, review и acceptance разведены:

```text
IN_PROGRESS
    ↓
REVIEW_REQUIRED
    ↓
/review
    ↓
ACCEPTANCE_REQUIRED
    ↓
/accept
    ↓
ACCEPTED
```

`/accept` — fresh narrow outcome auditor; publish разрешён только после PASS + TOCTOU revision/write-set/donor checks.

**Статус:** `MITIGATED/DETECTED`; semantic outcome quality depends on acceptance criteria supplied in packet.

---

# 6. Технический разбор Collective Intelligence — Codex

## Collective Intelligence.1 — instruction drift / false completion

### 1. Работа

Обычные repo inspections, targeted fixes, checks.

### 1.2. Сложность

Автор подчёркивает, что речь не о “miracle-level coding”.

### 2. Task

Inspect → fix → run checks → confirm.

### 3. Ошибка

Fix declared before verification, task forgotten, recent instructions ignored. ([Reddit](https://www.reddit.com/r/codex/comments/1tlff44/has_codex_suddenly_become_almost_unusable_for/ "Has Codex suddenly become almost unusable for anyone else?"))

**Layer:** model + session/task state, unknown exact cause.

### 4. ASCII

```text
task
 ↓
partial work
 ↓
local confidence
 ↓
"fixed"
 ↓
verification absent
 ↓
actual task still open
```

### 5. Причина

Model self-report used as state authority.

### v0.2

Project Pack state, evidence и acceptance are host-side; fresh reviewer does not rely on implementer's confidence.

**Status:** `MITIGATED`.

---

## Collective Intelligence.2 — loop → unnecessary infrastructure

### 1. Работа

User asks Sol to reason and then work.

### 1.2. Сложность

Exact project complexity unavailable.

### 2. Task

Solve current coding problem.

### 3. Ошибка

Reasoning loop transitions into large unnecessary architecture rather than scoped fix. ([Reddit](https://www.reddit.com/r/codex/comments/1vq31oj/broken_usage_since_reset/ "Broken Usage Since Reset : r/codex"))

**Layer:** model reasoning + scope control.

### 4. ASCII

```text
question
  ↓
reasoning
  ↓
re-reason
  ↓
"understood"
  ↓
large new infrastructure
  ↓
bugs + larger context
```

### 5. Причина

No write-set, no packet scope, no task-wide budget.

### v0.2

Atomic packet + `write_set` + task budget + scope violation + fresh review.

**Status:** `PREVENTED/MITIGATED`, subject to runtime qualification.

---

## Collective Intelligence.3 — destructive action

### 1. Работа

Normal project work / cleanup.

### 1.2. Сложность

Active local repositories.

### 2. Task

Narrow intended operation.

### 3. Ошибка

Deletion exceeded intended scope, including valuable project data. ([GitHub](https://github.com/openai/codex/issues/38312 "[Critical data loss] Codex deleted important project files without an explicit deletion request or confirmation · Issue #38312 · openai/codex · GitHub"))

**Layer:** model + filesystem authority + sandbox/guard policy.

### 4. ASCII

```text
broad mutation tool
       │
       ▼
scope resolved incorrectly
       │
       ▼
destructive command
       │
       ▼
real donor tree
       │
       ▼
data loss
```

### 5. Причина

Mutating authority acted directly on valuable workspace.

### v0.2

```text
real donor
   │
   └──── untouched during /work
             │
             ▼
      disposable worktree
             │
             ▼
        implementation
             │
             ▼
       diff validation
             │
             ▼
      review + accept
             │
             ▼
          publish
```

Direct editor is hard-gated; shell is still explicitly `DEGRADED_WINDOWS` for writes outside worktree.

**Status:** Git-contained damage `RECOVERABLE`; arbitrary native-Windows external shell write `NOT FULLY PREVENTED`.

---

## Collective Intelligence.4 — safety overclassification

### 1. Работа

Exact-path ignored cache cleanup.

### 1.2. Сложность

Nine bounded ignored directories with pre-delete manifest and tracked-file checks.

### 2. Task

Delete only confirmed cache paths.

### 3. Ошибка

Host policy blocked the command before shell execution despite extensive evidence. ([GitHub](https://github.com/openai/codex/issues/34331 "[Windows][Codex App] Path-bound deletion of ignored cache directories is rejected with a generic policy block under danger-full-access · Issue #34331 · openai/codex · GitHub"))

**Layer:** policy/Guardian, not necessarily coding model.

### 4. ASCII

```text
exact target
  ↓
read-only proof
  ↓
user authorization
  ↓
policy classifier
  ↓
FALSE POSITIVE
  ↓
DENY
```

### 5. Почему

Safety classification can have false positives even when LLM task reasoning is correct.

### v0.2

Codex Guardian is absent, so **that exact policy layer disappears**. Но DSH/sandbox/host guards can still falsely deny legitimate operations. v0.2 deliberately permits absolute executable/read paths — including a project venv interpreter — so write-set guard не должен повторить PowerShell/path mistake.

**Status:** `SPECIFIC CODEX LAYER REMOVED`; generic safety false positives `NOT PREVENTED`.

---

# 7. Codex: незакрытые моменты

1. Exact raw VERY HIGH v0.15 transcript с твоими corrective prompts пока не найден как отдельный файл.
    
2. Не доказано, destructive donor replacement произошёл ещё на VERY HIGH или уже на early MEDIUM.
    
3. Cookie/hazard own incident известен из твоего observation, но evidence-файл не найден.
    
4. Переход VERY HIGH → MEDIUM сопровождался заметным улучшением по твоему наблюдению, но это **не controlled A/B**: одновременно изменились repo state, prompts, review process и accumulated evidence.
    
5. Поэтому нельзя выводить “MEDIUM объективно лучше Sol VERY HIGH во всех coding tasks”. Можно только зафиксировать strong within-project signal.
    

---

# SYSTEM B — Qwen3.8-27B + DeepSeek Harness

## 1. Использованная модель / harness / reasoning

Целевая конфигурация:

```text
Model:
Qwen3.8-27B Q4_K_M

Runtime:
llama-server

Harness:
DeepSeek Harness

Project layer:
dsh_qwen_project_pack_v0_2

Reasoning:
MEDIUM default

Reasoning cap:
8192 / request

Max completion:
16384 / request

preserve_thinking:
OFF

XHIGH:
manual-only

provider retries:
0
```

Это буквально frozen policy v0.2.

Официально Qwen3.8-27B — 27B dense hybrid model с 64 layers, layout `16 × (3 × Gated DeltaNet + 1 × Gated Attention)`, native context 262,144 и MTP training. ([Hugging Face](https://huggingface.co/Qwen/Qwen3.8-27B "Qwen/Qwen3.8-27B · Hugging Face"))

Официальный default:

```text
xhigh  = default
medium = balance accuracy/speed
low    = speed/cost
```

`preserve_thinking` также включён по умолчанию. Qwen отдельно предупреждает, что более низкий reasoning effort в multi-turn agent tasks иногда **увеличивает** общую стоимость через failures/retries. ([Hugging Face](https://huggingface.co/Qwen/Qwen3.8-27B "Qwen/Qwen3.8-27B · Hugging Face"))

## 2. Собственные Ich incidents

На данный момент **подтверждённого собственного Qwen3.8 runtime incident corpus нет**.

То есть:

```text
Qwen Ich-1
Qwen Ich-2
...
```

не создаются искусственно.

Пакет построен проактивно из:

- Codex failures;
    
- V4 Pro/Fast failures;
    
- официального Qwen behavior;
    
- community Qwen incidents.
    

Фактический Qwen correctness/performance на целевом V100 + 3070 Ti сам package помечает как not proven.

---

# 3. Внешние подтверждения — Qwen

### Официальный model card

Qwen официально говорит, что thinking включён по default, `xhigh` является default reasoning effort, а `preserve_thinking` сохраняет reasoning из historical messages. ([Hugging Face](https://huggingface.co/Qwen/Qwen3.8-27B "Qwen/Qwen3.8-27B · Hugging Face"))

Также официально рекомендованные thinking sampling parameters:

```text
temperature=1.0
top_p=0.95
top_k=20
min_p=0
presence_penalty=0
repetition_penalty=1
```

([Hugging Face](https://huggingface.co/Qwen/Qwen3.8-27B "Qwen/Qwen3.8-27B · Hugging Face"))

---

### XHIGH резко увеличивает thinking

В коротком community test усреднённо:

|Effort|Reasoning tokens|Total completion|Wall|
|---|--:|--:|--:|
|low|4,418|8,387|111.6 s|
|medium|5,918|8,959|127.4 s|
|xhigh|39,398|44,487|717.8 s|

Это не coding benchmark и не controlled agent workload, но хорошо демонстрирует размер reasoning multiplier. ([Reddit](https://www.reddit.com/r/LocalLLaMA/comments/1vpuh7m/qwen38_27b_reasoning_effort_lowmediumxhigh/ "Qwen3.8 27B reasoning effort low/medium/xhigh comparison"))

Другой пользователь получил 15–20K minimum thinking на xhigh и ~40K на Pac-Man example. ([Reddit](https://www.reddit.com/r/LocalLLaMA/comments/1vohpc8/the_difference_between_medium_and_xhigh_reasoning/ "The difference between \"medium\" and \"xhigh\" reasoning effort for Qwen3.8-27B is actually insane."))

---

### Medium тоже не гарантирует отсутствие loops

Пользователь Q6_K на 2×3090 Ti, LM Studio, ~50K context и **medium effort** сообщает, что Qwen3.8 генерирует много tokens, иногда делает задачу неправильно, иногда не заканчивает из-за loop и пытается «чинить» несломанные вещи. ([Reddit](https://www.reddit.com/r/LocalLLaMA/comments/1vsinej/am_i_doing_something_wrong_qwen_38_27b_seems/ "Am I doing something wrong? Qwen 3.8 27B seems useless for agentic coding"))

То есть:

```text
MEDIUM
≠
hard anti-loop mechanism
```

---

### Harness может радикально менять поведение

Пользователь сообщает, что Qwen3.8 Q8 loop'ится в VS Code Copilot, но не демонстрирует ту же проблему через Pi, Continue или Roo Code. Он предполагает, что Copilot переопределяет settings/system prompt. ([Reddit](https://www.reddit.com/r/LocalLLM/comments/1vs2x5e/completely_solved_my_qwen38_27b_q8_thinking_loops/ "completely solved my qwen3.8 27b q8 thinking loops"))

Это особенно важно для attribution:

```text
Qwen
+
harness
+
template
+
tool protocol
```

а не “модель сама по себе”.

---

### Tool calling зависит от backend/parser/template

В свежем thread один пользователь получил отсутствие tool calls через Pi; ответы сразу указывают на backend/chat-template/config и рекомендуют проверять parser, например `qwen3_xml`. ([Reddit](https://www.reddit.com/r/LocalLLaMA/comments/1vt8pkz/people_that_use_qwen_38_27b_for_agent_use_or/ "People that use qwen 3.8 27B for agent use or coding. What harnesses are you using?"))

---

# 4. Collective Intelligence — Qwen

## Collective Intelligence.1 — XHIGH reasoning explosion

### 1. Работа

One-shot generation / coding-like generation.

### 1.2. Сложность

Даже относительно локальный SVG task дал ~39K average reasoning на xhigh в одном опубликованном тесте. ([Reddit](https://www.reddit.com/r/LocalLLaMA/comments/1vpuh7m/qwen38_27b_reasoning_effort_lowmediumxhigh/ "Qwen3.8 27B reasoning effort low/medium/xhigh comparison"))

### 2. Prompt

Одинаковый prompt, менялся reasoning effort.

### 3. Ошибка

Не обязательно correctness failure. Failure class — **economic/time runaway**.

**Layer:** model reasoning policy.

### 4. ASCII

```text
task
 │
 ▼
solution A
 │
 ├─ inspect
 ├─ alternative B
 ├─ reconsider
 ├─ edge case
 ├─ refine
 └─ refine again
      │
      ▼
tens of thousands
thinking tokens
```

### 5. Почему

`xhigh` намеренно оптимизирован под thorough analysis; без external budget это может быть непрактично.

### v0.2

XHIGH запрещён как automatic escalation; per-request reasoning 8192, task-wide 80K.

**Status:** `PREVENTED AS UNBOUNDED RUNAWAY`, quality impact `UNTESTED`.

---

## Collective Intelligence.2 — Medium/Low не являются safety mechanism

### 1. Работа

Agentic coding в Cline/ZooCode.

### 1.2. Сложность

50K context, Q6, fully GPU-offloaded.

### 2. Task

Обычные configuration/code edits.

### 3. Ошибка

Даже с medium:

```text
lots of tokens
→ incorrect finish
or
→ no finish
→ loop
→ fixing things that are not broken
```

([Reddit](https://www.reddit.com/r/LocalLLaMA/comments/1vsinej/am_i_doing_something_wrong_qwen_38_27b_seems/ "Am I doing something wrong? Qwen 3.8 27B seems useless for agentic coding"))

**Layer:** model + harness/context.

### 4. ASCII

```text
MEDIUM selected
      │
      ▼
model still reasons
      │
      ▼
bad hypothesis
      │
      ▼
attempted "fix"
      │
      ▼
new state
      │
      └────► more repair
```

### 5. Почему

Reasoning effort is guidance, not host enforcement. Официальный model card сам предупреждает, что lower effort может породить больше retries. ([Hugging Face](https://huggingface.co/Qwen/Qwen3.8-27B "Qwen/Qwen3.8-27B · Hugging Face"))

### v0.2

Hard safety не опирается на MEDIUM:

```text
effort MEDIUM         soft quality choice
8192 reasoning cap    hard request bound
12 steps              hard turn bound
6 goal rounds         hard goal bound
task budget           hard cumulative bound
```

**Status:** `MITIGATED/PREVENTED FROM UNBOUNDED LOOP`.

---

## Collective Intelligence.3 — harness-dependent thinking loop

### 1. Работа

Qwen3.8 local coding-agent use.

### 1.2. Сложность

Один и тот же local model через разные harnesses.

### 2. Task

Coding-agent work.

### 3. Ошибка

Copilot route loop'ился; Pi/Continue/Roo — нет. ([Reddit](https://www.reddit.com/r/LocalLLM/comments/1vs2x5e/completely_solved_my_qwen38_27b_q8_thinking_loops/ "completely solved my qwen3.8 27b q8 thinking loops"))

**Layer:** strongly suggests `harness/template/config`, но root cause не доказан.

### 4. ASCII

```text
same model
   │
   ├── Harness A ──► stable
   ├── Harness B ──► stable
   └── Harness C
          │
          ▼
     altered prompt/settings
          │
          ▼
       think loop
```

### 5. Почему

Agent harness controls system prompt, tool schema, retained reasoning and request parameters.

### v0.2

Стек фиксируется:

```text
Qwen
 ↓
llama-server
 ↓
one DSH preset
 ↓
small fixed tool surface
 ↓
host Project Pack
```

Generic Ralph/workflow/fork/swarm выключены.

Но сам compatibility stack ещё не runtime-qualified.

**Status:** `MITIGATED / UNTESTED`.

---

## Collective Intelligence.4 — parser/tool-template misconfiguration

### 1. Работа

Local Qwen agent through Pi/backend.

### 1.2. Сложность

Basic tool invocation.

### 2. Task

Use tools.

### 3. Ошибка

Tool call отсутствует или оказывается malformed/unsupported из-за backend/parser/template mismatch. ([Reddit](https://www.reddit.com/r/LocalLLaMA/comments/1vt8pkz/people_that_use_qwen_38_27b_for_agent_use_or/ "People that use qwen 3.8 27B for agent use or coding. What harnesses are you using?"))

**Layer:** parser/runtime/harness, не доказанный model failure.

### 4. ASCII

```text
model intent
    │
    ▼
chat template
    │
    ▼
tool-call serialization
    │
    ▼
parser
    │
    X
schema mismatch
    │
    ▼
"model cannot use tools"
```

### 5. Почему

Good model output is useless if inference stack and harness disagree on tool format.

### v0.2

Fixed provider route and tool surface reduce degrees of freedom; provider retries are zero, preventing one DSH failure from silently multiplying requests.

Но v0.2 **не может статически доказать correct Qwen↔llama.cpp↔DSH parser behavior**.

**Status:** `UNTESTED`, runaway consequences `MITIGATED`.

---

## Collective Intelligence.5 — preserve-thinking trade-off

Официально `preserve_thinking` сохраняет historical reasoning для continuity, уменьшения redundant reasoning и улучшения KV-cache use. ([Hugging Face](https://huggingface.co/Qwen/Qwen3.8-27B "Qwen/Qwen3.8-27B · Hugging Face"))

Community, однако, показывает обратный operational concern: long preserved thinking раздувает agent history/context, а некоторые пользователи предпочитают low/medium with controlled preservation. ([Reddit](https://www.reddit.com/r/LocalLLaMA/comments/1vulsom/qwen_38_vs_36_27b_low_reasoning_loops_way_less_now/ "Qwen 3.8 vs 3.6 27b low reasoning loops way less now"))

### Flow

```text
preserve ON
   │
   ├─ less re-derivation
   └─ more reasoning history
            │
            ▼
      bigger agent context

preserve OFF
   │
   ├─ smaller history
   └─ possible rethinking
```

### v0.2

Первый production profile делает:

```text
raw thinking = OFF
durable conclusions = ON
```

Durable memory хранится в Project Pack:

```text
ACTIVE_REQUIREMENTS
source_revision
packet
BASELINE
PRESERVE_CONTRACT
evidence
review findings
```

а не в hidden monologue.

**Status:** deliberate `MITIGATION`, quality/performance trade-off `UNTESTED`; preserve A/B отложен.

---

# 5. Qwen: незакрытые моменты

Здесь unresolved особенно существенен.

- Нет собственного Qwen Ich corpus.
    
- Не проверен реальный DSH model/tool parser.
    
- Не проверено same-session goal continuation.
    
- Не проверена фактическая throughput/context behavior Q4_K_M при 128K на целевой V100 + 3070 Ti.
    
- `preserve_thinking=false` — deliberate baseline, не доказанный universally optimal mode.
    
- Semantic no-progress detector отложен.
    
- Native Windows shell containment за пределами worktree не доказан.
    
- Поэтому Qwen-раздел пока представляет **risk analysis + containment design**, а не postmortem реально отработавшего production agent.
    

---

# SYSTEM C — DeepSeek V4 Pro + V4 Fast через OpenCode / Project Pack v4

## 1. Использованная связка

Использовались минимум две distinct роли.

```text
DeepSeek V4 Pro
    reasoning = MAX / very high
    role ≈ high-level source triage / architecture / hard reasoning
    harness = OpenCode + Project Pack v4

DeepSeek V4 Fast
    role = implementation hand / implementer-pro
    exact reasoning setting not preserved
    harness = OpenCode subagent/task machinery
```

V4 Pro incident-файл сам называется:

`2пример где залупился в4про на макс риазонинге.md`

V4 Fast:

`2пример где в4 фаст залупился на вызове инструмента так как фидбек не смотрел (либо у меня в инструменте нет такого вызова).md`

---

# 2. Встреченные проблемы — V4

## Ich-1 — V4 Pro MAX: reasoning re-entry loop

V4 Pro **правильно** сделал исходную source classification:

```text
main spec = CANONICAL_SPEC
audit     = CURRENT_STATE_REPORT
```

и перечислил правильную последовательность действий.

После этого reasoning начал многократно открывать уже решённый вопрос:

- что именно сохранить;
    
- где boundaries;
    
- нужно ли копировать весь source;
    
- «let me write»;
    
- «actually, let me think»;
    
- снова reconstruction.
    

Raw trace показывает повторяющиеся `Actually...`, `Let me write...`, `Let me reconstruct...`.

Файл:

`2пример где залупился в4про на макс риазонинге.md`

---

## Ich-2 — огромный cumulative token blast radius

Скриншот Fireworks показывает:

```text
TOTAL TOKENS
150.16M
```

Файл:

`Снимок экрана 2026-08-21 151849.png`

Важно: screenshot доказывает **150.16M total serverless tokens в показанном usage period**, но не позволяет честно сказать, что все 150.16M принадлежат одному V4 Pro loop или даже только одной модели.

Поэтому incident формулируется как:

> В той же рабочей среде отсутствие достаточного cumulative runaway containment допускало blast radius порядка сотен миллионов aggregate tokens.

---

## Ich-3 — V4 Fast: repeated failing tool call despite exact correct command

Task packet был очень маленьким и конкретным.

Он прямо сообщал:

```text
Working directory:
C:\whisper-bot\project_core

Python:
C:\whisper-bot\.venv\Scripts\python.exe

Test command:
& "C:\whisper-bot\.venv\Scripts\python.exe" -m pytest ...
```

и разрешал менять **только `pipeline.py`**.

Acceptance снова содержал правильные PowerShell команды с `&` и полным interpreter path.

Тем не менее subagent повторял:

```text
.venv\Scripts\python.exe -m pytest ...
```

и получал:

> `The module '.venv' could not be loaded.`

Точный repetition count недоступен: exported history прямо говорит, что child internal command stream не сохранился полностью.

Файл:

`2пример где в4 фаст залупился на вызове инструмента так как фидбек не смотрел (либо у меня в инструменте нет такого вызова).md`

---

# 3. Внешние подтверждения — DeepSeek V4

### V4 Pro + Cline reasoning loop

Пользователь DeepSeek V4 Pro + Cline/OpenAI-compatible API описывает огромный reasoning output; после Cline interruption и `Proceed anyway` модель выглядит так, будто reasoning начинается заново, образуя loop. Сам автор подозревает проблему передачи `reasoning_content`, но не доказывает её. ([Reddit](https://www.reddit.com/r/CLine/comments/1tasgfm/deepseek_v4_pro_cline_infinite_reasoning_loop/ "DeepSeek V4 Pro + Cline: infinite reasoning loop + suggestion to switch to Opus 4?"))

---

### 12 requested tool calls → 23 actual executions

Свежий DeepSeek V4 Flash testcase через OMP показывает:

```text
first ~7 calls clean
around call 8:
raw DSML
repeated calls
mixed results
malformed calls

expected executions = 12
actual executions   = 23
```

При этом модель в финальном self-report заявила, что сделала 12 вызовов без duplicates. Failure возник примерно на 13% от 131K context. ([Reddit](https://www.reddit.com/r/LocalLLaMA/comments/1vtu779/i_really_want_deepseek_v4_to_work_as_a_local/ "I really want DeepSeek V4 to work as a local coding agent, but the tool calling keeps falling apart. Has anyone solved this?"))

Это очень сильный внешний incident, потому что task deliberately boring и execution count externally observable.

---

### Doom loop: “as if it can't call tools”

Другой пользователь V4 Flash через Ollama Cloud пишет, что модель входит в loop, будто не может вызвать tools, и бесконечно повторяет одно и то же. Один commenter видел похожее локально. ([Reddit](https://www.reddit.com/r/ollama/comments/1vjmzh4/doom_loop_anyone_else_having_deepseek_v4_flash/ "Doom Loop: Anyone Else Having DeepSeek v4 Flash 0731 Issues on ollama cloud?"))

---

### Иногда tool failure полностью harness-induced

В отдельном DeepSeek V4 Flash setup пользователь сначала решил, что модель «тупая», но затем выяснил: Unsloth UI при oMLX backend **вообще не передавал available tools/tool-call template модели**. ([Reddit](https://www.reddit.com/r/LocalLLaMA/comments/1vd6nfg/deepseek_v4_flash_0731_local_setup_gotcha_model/ "DeepSeek V4 Flash 0731 local setup gotcha: model, tool call & config setting"))

Это критическое напоминание:

```text
bad tool behavior
≠
автоматически model defect
```

---

# 4. Collective Intelligence — DeepSeek V4

## Collective Intelligence.1 — V4 Pro + Cline reasoning reset/re-entry

### 1. Работа

Complex agent task.

### 1.2. Сложность

Long reasoning through OpenAI-compatible provider, Cline controls turn continuation.

### 2. Task

Продолжить complex task after harness warning.

### 3. Ошибка

После `Proceed anyway` reasoning выглядит как restart from scratch. ([Reddit](https://www.reddit.com/r/CLine/comments/1tasgfm/deepseek_v4_pro_cline_infinite_reasoning_loop/ "DeepSeek V4 Pro + Cline: infinite reasoning loop + suggestion to switch to Opus 4?"))

**Layer:** likely mixed `model + reasoning_content/context handling + harness`; exact cause unknown.

### 4. ASCII

```text
reasoning state A
      │
      ▼
harness interruption
      │
      ▼
"Proceed anyway"
      │
      ▼
state continuity uncertain
      │
      ▼
reasoning A' from scratch
      │
      └────────────► repeat
```

### 5. Почему

Если harness не возвращает reasoning/context в ожидаемом format, model может re-derive old work.

### v0.2

Durable project memory не зависит от raw reasoning. External task/evidence state survives turns; task-wide budget bounds any re-entry.

**Status:** `MITIGATED`, not a parser fix.

---

## Collective Intelligence.2 — V4 DSML/tool protocol degradation

### 1. Работа

Чистый disposable OMP directory, последовательность 12 shell calls.

### 1.2. Сложность

Низкая специально; failure возник задолго до full context.

### 2. Task

12 calls exactly once each.

### 3. Ошибка

После ~7 чистых вызовов:

```text
raw DSML
malformed wrapper
duplicate calls
mixed results
23 executions
false self-report "12"
```

([Reddit](https://www.reddit.com/r/LocalLLaMA/comments/1vtu779/i_really_want_deepseek_v4_to_work_as_a_local/ "I really want DeepSeek V4 to work as a local coding agent, but the tool calling keeps falling apart. Has anyone solved this?"))

**Layer:** mixed `model + DSML serialization + parser/runtime + retained reasoning`, root cause unresolved.

### 4. ASCII

```text
call 1 OK
call 2 OK
...
call 7 OK
   │
   ▼
protocol state degrades
   │
   ├─ malformed DSML
   ├─ duplicate call
   ├─ result misalignment
   └─ raw token leak
             │
             ▼
      next turn consumes
      corrupted history
             │
             ▼
       more corruption
```

### 5. Почему

Tool protocol state itself becomes part of future model context; malformed output may poison subsequent turns.

### v0.2

Exact **failed** tool+canonical args replay is denied after one failure; hammering denied call cancels the turn. Host counters, not model self-report, are authority.

Но malformed DSML, который parser вообще не распознал как tool call, этим guard не “лечится”.

**Status:** duplicate-failure runaway `MITIGATED`; parser corruption `NOT ADDRESSED DIRECTLY`.

---

## Collective Intelligence.3 — V4 Doom Loop

### 1. Работа

V4 Flash through Ollama Cloud/local agentic use.

### 1.2. Сложность

Не полностью описана.

### 2. Task

Использовать tools и продолжать agent workflow.

### 3. Ошибка

Модель повторяет одни и те же действия/текст, будто tool unavailable. ([Reddit](https://www.reddit.com/r/ollama/comments/1vjmzh4/doom_loop_anyone_else_having_deepseek_v4_flash/ "Doom Loop: Anyone Else Having DeepSeek v4 Flash 0731 Issues on ollama cloud?"))

### 4. ASCII

```text
need tool
  │
  ▼
attempt
  │
  ▼
result not incorporated
or protocol invalid
  │
  ▼
same perceived need
  │
  └─────────────► attempt
```

### 5. Почему

Может быть model, harness recovery, parser or tool feedback. External thread сам не устанавливает root cause.

### v0.2

Per-turn cap + failed-call map + task-wide budget обрывают экономический loop даже при неизвестной причине.

**Status:** `MITIGATED`, root cause not necessarily fixed.

---

## Collective Intelligence.4 — missing tool schema masquerading as model failure

### 1. Работа

DeepSeek V4 Flash via oMLX + Unsloth Studio.

### 1.2. Сложность

Basic web/tool request.

### 2. Task

Call web tool.

### 3. Ошибка

Harness не передал tools/tool template, поэтому model физически не имела корректного current-turn tool contract. ([Reddit](https://www.reddit.com/r/LocalLLaMA/comments/1vd6nfg/deepseek_v4_flash_0731_local_setup_gotcha_model/ "DeepSeek V4 Flash 0731 local setup gotcha: model, tool call & config setting"))

**Layer:** harness/runtime.

### 4. ASCII

```text
user asks for tool action
       │
       ▼
harness constructs request
       │
       X
tool definitions missing
       │
       ▼
model guesses from history
       │
       ▼
invalid / silent tool call
```

### 5. Почему

The model cannot comply with a schema it was not given.

### v0.2

Adversarial qualification должен происходить **через реальный current DSH**, не только unit tests. Сам package explicitly says pure-module tests do not substitute runtime suite.

**Status:** `DETECTED ONLY BY RUNTIME QUALIFICATION`; static pack cannot prevent external schema omission.

---

# 5. Технический разбор собственных V4 incidents

## Ich-1 — Pro MAX reasoning re-entry

### 1. Работа

Source triage: сохранить canonical spec + current-state audit и обновить Project Pack.

### 1.2. Сложность

Long source, но source-authority classification была решена практически сразу.

### 2. Task

```text
preserve raw sources
classify
resolve conflicts
update FULL_SPEC
update current phase/state
```

### 3. Ошибка

Model correctly understood the task, then repeatedly reopened exact boundaries/writing strategy.

**Layer:** primarily `model reasoning`, possibly aggravated by long context/harness.

### 4. ASCII

```text
classification correct
        │
        ▼
action plan correct
        │
        ▼
"write source files"
        │
        ▼
"Actually, boundaries?"
        │
        ▼
reconstruct boundaries
        │
        ▼
same boundaries
        │
        ▼
"write now"
        │
        └───────────────┐
                        ▼
                   "Actually..."
```

### 5. Почему

Нет external “decision already committed” latch и reasoning budget.

### v0.2

Source triage is a bounded fresh invocation. Host validates structured result, а затем **host**, а не модель, меняет Project Pack state.

Request/task budgets prevent unbounded re-entry.

**Status:** `MITIGATED/PREVENTED FROM UNBOUNDED LOOP`; Qwen runtime `UNTESTED`.

---

## Ich-2 — cumulative 150.16M blast radius

### 1. Работа

Long-running project agent work.

### 1.2. Сложность

Multiple long sessions, tools, reasoning models and project phases.

### 2. Task

Длительная автономная coding/analysis работа.

### 3. Ошибка

Total serverless usage reached 150.16M in shown period. Exact attribution inside total cannot be reconstructed from screenshot.

**Layer:** economic containment / orchestration; model contributes but exact attribution unknown.

### 4. ASCII

```text
request cap maybe exists
         │
         ▼
request ends
         │
         ▼
new turn
         │
         ▼
subagent / retry
         │
         ▼
new reasoning
         │
         ▼
no task-wide fuse
         │
         └──────────────► aggregate explosion
```

### 5. Почему

Per-request finiteness does not imply task-wide boundedness.

### v0.2

Task circuit breaker:

```text
requests       ≤ 30
reasoning      ≤ 80K
visible output ≤ 40K
tools          ≤ 120
active time    ≤ 90m
failed hypotheses ≤ 2
```

At exhaustion:

```text
BUDGET_PAUSED
```

not another autonomous round.

**Status:** `PREVENTED ARCHITECTURALLY`; accounting integration runtime `UNTESTED`.

---

## Ich-3 — Fast repeated failing PowerShell call

### 1. Работа

C-1: добавить 4 makespan maps в `_resource_stage_state`.

### 1.2. Сложность

Очень низкая relative scope:

```text
one approved packet
one writable file
exact design
exact interpreter
exact test commands
```

### 2. Prompt

Correct command был дан verbatim.

### 3. Ошибка

Child вызвал неправильную relative syntax и после PowerShell failure повторял её.

**Layer:** `model/tool-feedback handling + harness retry semantics`.

### 4. ASCII

```text
correct command in packet
        │
        ▼
model generates wrong call
        │
        ▼
PowerShell FAIL
        │
        ▼
failure becomes text feedback
        │
        X
no mechanical negative latch
        │
        ▼
same call again
        │
        └──────────────► FAIL
```

### 5. Почему

Tool feedback was informative but not authoritative prohibition.

### v0.2

```text
tool call
   │
   ▼
FAIL
   │
   ▼
canonical(tool,args) stored
   │
   ▼
same failed call?
   │ yes
   ▼
HOST DENY
   │
   ▼
hammer denied call?
   │ yes
   ▼
CANCEL TURN
```

Это и есть adversarial case 2.

**Статус:** `IMPLEMENTED + UNIT-TESTED`; real DSH tool event ordering `UNTESTED`.

---

# 6. V4: незакрытые моменты

- Полного child command stream V4 Fast нет, поэтому repetition count неизвестен.
    
- 150.16M screenshot — aggregate usage, а не доказательство «один V4 Pro loop = 150M».
    
- V4 Pro own loop выглядит model-side, но harness/context handling могло усиливать его.
    
- External V4 tool failures показывают несколько independent runtime/parser failure classes; нельзя свести всё к одной “плохой модели”.
    
- v0.2 ограничивает consequences malformed tool behavior, но не ремонтирует неизвестный parser bug.
    

---

# Финальный cross-system comparison

|Failure mode|Codex / Sol|Qwen3.8|V4 Pro / Fast|`dsh_qwen_project_pack_v0_2`|
|---|---|---|---|---|
|Reasoning runaway|**Observed**, особенно VERY HIGH|Community evidence strong; own corpus absent|**Observed** V4 Pro MAX|per-request + per-turn + goal + task circuit breaker|
|Instruction drift|**Observed**|Community reports|Possible/mixed|atomic packet + source refs + fresh review|
|Loop / repetition|Observed via premature/task behavior; community strong|Community strong|**Observed** Pro reasoning + Fast tool repeat|failed-call latch + budgets + bounded goal|
|Premature completion|**Observed** VERY HIGH and MEDIUM|Not own-tested|Not primary own incident|host-owned goal continuation|
|Safety/hazard overclassification|User-reported own incident, raw file missing; external Codex proof|No own evidence|No own evidence|Codex-specific layer removed; generic false positives remain|
|Loss of project state|Normative drift observed|Risk, no own corpus|Reasoning/context issues possible|explicit durable Project Pack|
|Incorrect tool/file handling|destructive donor regression|tool compatibility risk|**Observed** wrong PowerShell invocation|write-set + worktree + failed replay|
|Tool/parser/runtime failure|external Codex runtime issues exist|community parser/config dependence|community DSML failures strong|fixed stack + runtime adversarial gate; parser bugs not magically fixed|
|Hallucinated completion|**Observed / proxy completion**|community reports|external V4 false self-accounting|host counters + review + acceptance|
|Over-editing|**Observed**|community reports fixing unbroken things|community possible|write-set + preserve contract|
|Under-editing|**Observed** sidecar + incomplete integration|no own corpus|not primary|production-integrity review|
|Destructive regression|**Observed by repository diff**|no own corpus|no own corpus|disposable worktree + baseline + review|
|Context degradation|likely contributor|community harness-sensitive|external DSML/context evidence|explicit state, small packets, no raw persistent reasoning|
|Proxy success ≠ outcome|**Observed**|possible generic risk|V4 external self-report mismatch|`/review` ≠ `/accept`; evidence authority host-side|
|Excessive token blast radius|VERY HIGH burden|XHIGH community evidence|**Observed aggregate 150.16M environment**|task-wide cumulative budget|
|Stale work after changed requirement|Normative drift exposed need|risk|old v4 had `source_revision` concept but enforcement insufficient|stale revision hard mutation denial|
|Model self-accounting unreliable|reports/tests could overstate completion|possible|externally shown 12 claimed vs 23 actual calls|host counters authoritative|
|Next phase auto-propagation|dangerous in old orchestration|not tested|OpenCode orchestration risk|`ACCEPTED` stops; next phase never automatic|

---

# Что реально повторяется между системами

Главная картина оказывается не про «какая модель тупее».

Повторяются пять фундаментальных классов.

## 1. Модель не должна сама определять бесконечность своей работы

```text
reasoning model
      │
      ▼
может найти ещё одну гипотезу
      │
      ▼
ещё одну проверку
      │
      ▼
ещё одну ветку
      │
      ▼
если внешний host не говорит STOP
      │
      ▼
работа ограничена только деньгами/контекстом
```

Это видно:

- Sol VERY HIGH;
    
- V4 Pro MAX;
    
- Qwen XHIGH community data.
    

Поэтому reasoning effort — не safety boundary.

Safety boundary:

```text
request budget
turn budget
goal budget
task budget
```

---

## 2. Tool feedback нельзя оставлять просто текстом

V4 Fast получил буквально correct command и literal PowerShell error, но это не превращало повтор в запрещённое действие.

Общий принцип:

```text
"ты уже это пробовал"
```

как prompt — слабый.

```text
same_failed_call → DENY
```

как host state — сильный.

Именно поэтому v0.2 переносит failed-call replay detection в hard guard.

---

## 3. Existing behavior нельзя защищать фразой «не ломай»

Codex donor regression показывает главный structural defect обычного coding-agent loop:

```text
model knows requested delta
but does not possess formal BEFORE contract
```

Значит надо materialize:

```text
BASELINE
+
PRESERVE_CONTRACT
+
approved WRITE_SET
```

**до** mutation.

---

## 4. Tests не являются universal acceptance

У тебя буквально существовали состояния:

```text
123 passed
```

при отсутствующей production integration,

и:

```text
Cleaning ACCEPTED
```

при повреждении transcript.

Поэтому:

```text
test success
       ≠
requirement success

structural validity
       ≠
user outcome

review
       ≠
acceptance
```

v0.2 разделяет все эти стадии.

---

## 5. Raw chat/reasoning — плохая единственная project memory

И V4 Pro loop, и Qwen preserve-thinking dilemma, и Codex normative drift показывают одну проблему:

```text
conversation history
```

не должна быть единственным носителем:

- текущего требования;
    
- precedence;
    
- решённого blocker;
    
- preserve contract;
    
- task progress;
    
- failed hypotheses.
    

Поэтому v0.2 переносит эти факты в explicit state.

---

# Какие решения опасно оставлять самой модели

По evidence этих трёх систем модели нельзя надёжно отдавать финальную authority над:

```text
1. Сколько ещё автономных rounds себе дать.
2. Закончен ли user task.
3. Является ли внутренний milestone terminal.
4. Можно ли повторить уже провалившийся identical tool call.
5. Какой файл разрешено мутировать.
6. Можно ли удалить существующее donor behavior.
7. Текущий ли ещё task после нового correction.
8. Является ли focused test достаточным доказательством acceptance.
9. Какой нормативный source имеет precedence.
10. Можно ли тихо изменить source of truth.
11. Прошла ли независимая acceptance.
12. Сколько cumulative tokens/tools/time уже потрачено.
```

Это и есть conceptual core `dsh_qwen_project_pack_v0_2`.

---

# Что именно переносит Project Pack в host

```text
                         MODEL
                           │
                  intellectual work
                           │
                           ▼
                    implementation
                           │
         ┌─────────────────┴─────────────────┐
         │                                   │
         ▼                                   ▼
      SOFT DOMAIN                         HARD HOST
      KNOWLEDGE                           AUTHORITY
         │                                   │
 source understanding                source_revision
 implementation reasoning            task state
 debugging hypotheses                goal round cap
 code generation                     cumulative budget
 review reasoning                    failed-call latch
                                     write_set
                                     worktree
                                     baseline/preserve
                                     publish TOCTOU
                                     next-phase prohibition
```

То есть v0.2 **не пытается написать идеальный гигантский system prompt**.

Он наоборот уменьшает количество вещей, которые prompt обязан заставить модель помнить.

---

# Что v0.2 реально предотвращает, что только обнаруживает и что только смягчает

## PREVENTED архитектурно

При корректной работе plugin/runtime:

```text
stale packet direct mutation
direct edit outside write_set
model granting itself extra goal rounds
automatic next-phase transition
unbounded cumulative task continuation
second execution of identical already-failed tool+args
```

## DETECTED / RECOVERABLE

```text
Git-contained shell scope violation
donor regression in fresh review
shadow/sidecar substitution
acceptance mismatch
TOCTOU change before publish
review failure after implementation
```

Работа остаётся в disposable worktree.

## MITIGATED, но не полностью prevented

```text
model reasoning pathology
hallucination
instruction drift
bad debugging hypothesis
parser/tool protocol degradation
semantic blocker misclassification
```

Hard budgets ограничивают damage, но не гарантируют правильность reasoning.

## NOT FULLY ADDRESSED

```text
arbitrary shell write outside worktree on native Windows
unknown llama.cpp/DSH parser incompatibility
model-level malformed tool serialization
incorrect acceptance criteria supplied by the specification itself
Qwen quality loss from MEDIUM/8192/no-preserve policy
```

Native Windows limitation прямо зафиксирован честно:

```text
DIRECT_WRITE_GUARD     = HARD
SHELL_WRITE_GUARD      = DEGRADED_WINDOWS
SHELL_OUTSIDE_WORKSPACE = NOT_PROVEN
```

---

# Что уже реализовано в v0.2

Согласно `IMPLEMENTATION_STATUS.md`, а не только design document, в package уже есть:

- host commands `/triage`, `/task`, `/work`, `/review`, `/accept`, `/status`;
    
- fresh read-only subagents;
    
- goal `maxGoalRounds=6` без model-facing `tool-goal`;
    
- Project Pack state machine;
    
- cross-session revision invalidation;
    
- per-turn and task-wide budgets;
    
- failed-call replay denial;
    
- failed-hypothesis cap;
    
- disposable worktree;
    
- direct-editor revision/worktree/write-set denial;
    
- shell workdir + donor cleanliness + diff gate;
    
- final TOCTOU;
    
- baseline + preserve contract;
    
- MEDIUM/no-preserve model profile;
    
- local-provider retries `0`.
    

Локально уже выполнены syntax, policy, anti-runaway, temporary real Git worktree, JSON/YAML и npm-package checks.

---

# Что пока нельзя заявлять

Нельзя пока писать:

> `dsh_qwen_project_pack_v0_2` доказанно решил проблемы Codex/V4 и Qwen работает лучше.

Корректный статус:

```text
failure mechanisms:
    identified

containment design:
    implemented

pure/local policy tests:
    passed

real installed DSH:
    NOT YET QUALIFIED

real DSH goal/tool event ordering:
    NOT YET QUALIFIED

real Qwen3.8 coding session:
    NOT YET QUALIFIED

native Windows absolute shell containment:
    NOT PROVEN
```

Именно поэтому `RUNTIME_ADVERSARIAL_SUITE.md` содержит реальные regression cases, полученные прямо из incidents:

```text
1  reasoning runaway
2  repeated PowerShell failure
3  shadow substitution
4  stale revision
5  outside write_set
6  shell scope
7  donor regression
8  task budget
9  reviewer mutation
10 zero-inference /status
11 goal separation
12 publish TOCTOU
13 provider retry multiplication
14 cross-session correction
15 rework persistence
16 multi-project isolation
```

---

# Итоговый сравнительный вывод

На имеющихся данных нельзя честно построить leaderboard:

```text
Sol < Qwen < V4
```

или:

```text
Qwen лучше всех держит long project
```

Таких controlled tests не было.

Но уже можно сделать значительно более полезный вывод.

```text
Codex / Sol incidents
+
DeepSeek V4 incidents
+
Qwen community incidents
        │
        ▼
одни и те же классы отказов
появляются у разных сильных моделей
        │
        ▼
reasoning effort сам по себе
не решает orchestration
        │
        ▼
prompt сам по себе
не превращает feedback в constraint
        │
        ▼
model self-report
не должен быть authoritative state
        │
        ▼
hard decisions переносятся в host
```

Именно поэтому смысл `dsh_qwen_project_pack_v0_2` не в том, чтобы написать Qwen «более умный промпт».

Его смысл:

```text
SOURCE AUTHORITY
→ host

REVISION
→ host

SCOPE
→ host

WRITE AUTHORITY
→ host

LOOP BUDGET
→ host

FAILED-CALL MEMORY
→ host

TASK COMPLETION STATE
→ host

PUBLISH AUTHORITY
→ host

MODEL
→ reasoning + implementation
```

Это наиболее сильное общее следствие из всех трёх исследованных систем.

А различие `Sol VERY HIGH → Sol MEDIUM` дополнительно поддерживает важный practical choice v0.2: **не использовать максимальное reasoning автоматически**. В твоём собственном проекте Medium субъективно давал меньше hallucination/мусора и требовал меньше сверхподробного steering, хотя даже Medium не устранил source drift, need for external review, shadow substitution и premature handoff. Поэтому reasoning setting — это quality/performance knob, а не substitute host governance.

И текущая версия Project Pack как раз построена вокруг этого разделения.

**Scope note:** работа с Codex продолжалась около полутора месяцев. Текущий incident corpus не является полным журналом этого периода: основная сохранённая и разобранная выборка относится примерно к 15–20 числам. Более ранние наблюдения учитывались при проектировании следующей системы только там, где сохранилась достаточная уверенность или отдельное evidence.


