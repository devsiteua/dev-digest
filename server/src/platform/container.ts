import type {
  AuthProvider,
  SecretsProvider,
  GitHubClient,
  GitClient,
  CodeIndex,
  Embedder,
  FeatureModelChoice,
  FeatureModelId,
  LLMProvider,
  UnifiedDiff,
} from '@devdigest/shared';
import type { AppConfig } from './config.js';
import type { Db } from '../db/client.js';
import { JobRunner } from './jobs.js';
import { runBus, type RunBus } from './sse.js';
import { LocalSecretsProvider } from '../adapters/secrets/local.js';
import { LocalNoAuthProvider } from '../adapters/auth/local.js';
import { OctokitGitHubClient } from '../adapters/github/octokit.js';
import { SimpleGitClient } from '../adapters/git/simple-git.js';
import { RipgrepCodeIndex } from '../adapters/codeindex/ripgrep.js';
import { OpenAIProvider } from '../adapters/llm/openai.js';
import { AnthropicProvider } from '../adapters/llm/anthropic.js';
import { OpenAIEmbedder } from '../adapters/embedder/openai.js';
import { OpenRouterProvider } from '@devdigest/reviewer-core';
import { estimateCost } from '../adapters/llm/pricing.js';
import { PriceBook } from './price-book.js';
import { ConfigError } from './errors.js';
import { AgentsRepository } from '../modules/agents/repository.js';
import { SkillsRepository } from '../modules/skills/repository.js';
import { SkillsService } from '../modules/skills/service.js';
import { ReviewRepository } from '../modules/reviews/repository.js';
import { ConventionsService, type ConventionsApi } from '../modules/conventions/service.js';
import { IntentService, type IntentApi } from '../modules/intent/service.js';
import { BlastService, type BlastApi } from '../modules/blast/service.js';
import {
  ProjectContextService,
  type ProjectContextApi,
} from '../modules/context/service.js';
import { ProjectContextRepository } from '../modules/context/repository.js';
import { EvalsService, type EvalsApi } from '../modules/evals/service.js';
import { EvalsRepository } from '../modules/evals/repository.js';
import { loadDiff } from '../modules/reviews/diff-loader.js';
import { getFeatureModelOverride } from '../modules/settings/feature-models.js';
import type { RepoIntel } from '../modules/repo-intel/types.js';
import { RepoIntelService } from '../modules/repo-intel/service.js';
import { type DepGraph, DepCruiseGraph } from '../adapters/depgraph/index.js';
import { type Tokenizer, TiktokenTokenizer } from '../adapters/tokenizer/index.js';

/**
 * How long ONE OpenRouter HTTP attempt may take before the SDK retries it.
 * Deliberately shorter than every `req.timeoutMs` any caller passes — see the
 * comment at its use site in `buildLlm`.
 */
const OPENROUTER_ATTEMPT_TIMEOUT_MS = 30_000;

/**
 * DI container. One per app instance. Holds config, db, the JobRunner,
 * the SSE bus, and lazily-constructed adapters resolved through SecretsProvider.
 *
 * Tests construct a container with `overrides` to inject mock adapters; the
 * Services depend on these interfaces, not the concrete classes.
 */
export interface ContainerOverrides {
  secrets?: SecretsProvider;
  auth?: AuthProvider;
  github?: GitHubClient;
  git?: GitClient;
  codeIndex?: CodeIndex;
  embedder?: Embedder;
  /** Pre-built providers by id (skip key lookup). */
  llm?: Partial<Record<'openai' | 'anthropic' | 'openrouter', LLMProvider>>;
  /** repo-intel facade (T1.1+) — tests inject mock RepoIntel implementations. */
  repoIntel?: RepoIntel;
  /** repo-intel T3 adapter — only the indexer pipeline reads this one. */
  depgraph?: DepGraph;
  /**
   * The token counter. NOT a repo-intel adapter any more: `modules/brief`
   * counts its input budget with the same instance, so a stub here changes
   * what both the repo map and the brief's trim ladder measure.
   */
  tokenizer?: Tokenizer;
  /**
   * Conventions extractor (L02). Injected as the four-verb API rather than the
   * class so a test can stand in a stub — e.g. a browser flow that renders the
   * screen must never reach a model.
   */
  conventions?: ConventionsApi;
  /**
   * Intent layer (L03). Injected as the verb set rather than the class for the
   * same reason `conventions` is: a class with private fields can only ever be
   * satisfied by itself, which is not an override. Stubbing this is what lets a
   * browser flow render the Intent card without reaching a model.
   */
  intent?: IntentApi;
  /**
   * Project Context (L05). Injected as the verb set rather than the class, for
   * the reason `conventions` and `intent` are: a review run reads documents
   * through this, and a test that must not depend on a populated table stands
   * in a stub here.
   */
  projectContext?: ProjectContextApi;
  /**
   * Blast radius (L04). Injected as the verb set rather than the class, for the
   * reason `conventions`, `intent` and `projectContext` are: a class with
   * private fields can only ever be satisfied by itself, which is not an
   * override. Stubbing this is what lets a test drive the PR brief without an
   * indexed repository.
   */
  blast?: BlastApi;
  /**
   * The eval pipeline (L06). Injected as the verb set rather than the class, for
   * the reason every entry above it is.
   */
  evals?: EvalsApi;
}

export class Container {
  readonly config: AppConfig;
  readonly db: Db;
  readonly secrets: SecretsProvider;
  readonly auth: AuthProvider;
  readonly jobs: JobRunner;
  readonly runBus: RunBus;

  private _git?: GitClient;
  private _github?: GitHubClient;
  private _codeIndex?: CodeIndex;
  private _embedder?: Embedder;
  private llmCache = new Map<string, LLMProvider>();

  // Shared repositories for cross-cutting entities (agents, reviews/pulls,
  // runs). Constructed here, in the composition root, so consuming modules use
  // `container.agentsRepo` instead of reaching into another module's folder.
  private _agentsRepo?: AgentsRepository;
  private _skillsRepo?: SkillsRepository;
  private _skillsService?: SkillsService;
  private _conventions?: ConventionsApi;
  private _intent?: IntentApi;
  private _projectContext?: ProjectContextApi;
  private _blast?: BlastApi;
  private _evals?: EvalsApi;
  private _reviewRepo?: ReviewRepository;
  private _repoIntel?: RepoIntel;
  private _depgraph?: DepGraph;
  private _tokenizer?: Tokenizer;
  private _priceBook?: PriceBook;

  constructor(config: AppConfig, db: Db, private overrides: ContainerOverrides = {}) {
    this.config = config;
    this.db = db;
    this.secrets = overrides.secrets ?? new LocalSecretsProvider(config.secretsPath);
    this.auth = overrides.auth ?? new LocalNoAuthProvider(db);
    this.runBus = runBus;
    this.jobs = new JobRunner(db);
  }

  get git(): GitClient {
    if (this.overrides.git) return this.overrides.git;
    this._git ??= new SimpleGitClient(this.config.cloneDir);
    return this._git;
  }

  get agentsRepo(): AgentsRepository {
    return (this._agentsRepo ??= new AgentsRepository(this.db));
  }

  get skillsRepo(): SkillsRepository {
    return (this._skillsRepo ??= new SkillsRepository(this.db));
  }

  /**
   * The skills application layer, brokered here because a second module now
   * creates skills. The conventions extractor needs `source` stamping, the name
   * check and the body ceiling to stay where they are — one module owns what a
   * skill is allowed to be — and reaching into `modules/skills/` from
   * `modules/conventions/` is the cross-module import the onion guard warns
   * about. Same argument as `agentsRepo` above.
   */
  get skillsService(): SkillsService {
    return (this._skillsService ??= new SkillsService(this));
  }

  get conventions(): ConventionsApi {
    if (this.overrides.conventions) return this.overrides.conventions;
    this._conventions ??= new ConventionsService(this);
    return this._conventions;
  }

  /**
   * The intent layer, brokered for the same reason `conventions` is: the review
   * run needs it, and `modules/reviews/` reaching into `modules/intent/` is the
   * cross-module import the onion guard warns about — a warning that does NOT
   * fail `arch:check`, so the discipline has to come from here.
   */
  get intent(): IntentApi {
    if (this.overrides.intent) return this.overrides.intent;
    this._intent ??= new IntentService(this);
    return this._intent;
  }

  /**
   * The project-context layer (L05), brokered for the same reason `conventions`
   * and `intent` are: the review run reads a repo's documents, and
   * `modules/reviews/` reaching into `modules/context/` is the cross-module
   * import the onion guard warns about — a warning that does NOT fail
   * `arch:check`, so the discipline has to come from here.
   *
   * The repository is constructed HERE rather than inside the service: this is
   * the composition root, and a service that needs nothing but its own store is
   * better off taking it than taking the whole container.
   */
  get projectContext(): ProjectContextApi {
    if (this.overrides.projectContext) return this.overrides.projectContext;
    this._projectContext ??= new ProjectContextService(new ProjectContextRepository(this.db));
    return this._projectContext;
  }

  get reviewRepo(): ReviewRepository {
    return (this._reviewRepo ??= new ReviewRepository(this.db));
  }

  /**
   * The eval pipeline (L06), brokered for the same reason `intent`,
   * `projectContext` and `blast` are.
   *
   * The repository is constructed HERE: this is the composition root, and the
   * service takes the container only because it needs `reviewRepo` and
   * `loadPrDiff` — everything else it owns.
   */
  get evals(): EvalsApi {
    if (this.overrides.evals) return this.overrides.evals;
    this._evals ??= new EvalsService(this, new EvalsRepository(this.db));
    return this._evals;
  }

  /**
   * The unified diff of one pull request, by the SAME path a review takes.
   *
   * It lives here rather than in `modules/evals/` because `diff-loader.ts`
   * belongs to `modules/reviews/`, and a module importing a sibling module is
   * `no-cross-module-import` — a rule declared `severity: 'warn'`, so
   * `arch:check` would exit 0 and nobody would be told. The composition root is
   * allowed to see every ring at once, which is exactly what it is for.
   *
   * Sharing the path with the reviewer is the point, not a convenience: a case
   * frozen from a diff assembled differently from the one the reviewer is later
   * given would measure the agent against an input it never sees.
   */
  async loadPrDiff(workspaceId: string, prId: string): Promise<UnifiedDiff | null> {
    const pull = await this.reviewRepo.getPull(workspaceId, prId);
    if (!pull) return null;
    const repoRow = await this.reviewRepo.getRepo(pull.repoId);
    if (!repoRow) return null;
    return loadDiff(this, this.reviewRepo, workspaceId, pull, repoRow);
  }

  /**
   * The blast map (L04), brokered for the same reason `intent` and
   * `projectContext` are — and now with the second consumer the old comment in
   * `modules/blast/routes.ts` was waiting for: the PR brief needs the map to
   * build its grounding allow-list.
   *
   * The alternative — `modules/brief/**` importing `modules/blast/service.js`
   * directly — would have been caught by NOBODY: `no-cross-module-import` is the
   * one rule in `.dependency-cruiser-onion.cjs` declared `severity: 'warn'`, and
   * depcruise's exit code counts errors only. The discipline has to come from
   * here.
   */
  get blast(): BlastApi {
    if (this.overrides.blast) return this.overrides.blast;
    this._blast ??= new BlastService(this);
    return this._blast;
  }

  /**
   * The workspace's per-feature model choice, or `undefined` when it has not
   * picked one — brokered for the same reason as `skillsService`.
   *
   * Deliberately the OVERRIDE and not `resolveFeatureModel`: a caller that keeps
   * its own default (conventions does, and it is the first caller anywhere) must
   * not silently inherit the registry's, which for `conventions` is the priciest
   * model in the file. See `modules/settings/feature-models.ts:30-35`.
   */
  async featureModelOverride(
    workspaceId: string,
    id: FeatureModelId,
  ): Promise<FeatureModelChoice | undefined> {
    return getFeatureModelOverride(this, workspaceId, id);
  }

  get codeIndex(): CodeIndex {
    if (this.overrides.codeIndex) return this.overrides.codeIndex;
    this._codeIndex ??= new RipgrepCodeIndex(this.git);
    return this._codeIndex;
  }

  /**
   * The repo-intel facade (T1.1). All higher-level features (reviews,
   * blast/onboarding migrations, phantom-gate) code against this interface.
   * Tests inject a mock via `ContainerOverrides.repoIntel`.
   */
  get repoIntel(): RepoIntel {
    if (this.overrides.repoIntel) return this.overrides.repoIntel;
    this._repoIntel ??= new RepoIntelService(this);
    return this._repoIntel;
  }

  /** Import-graph builder (dependency-cruiser). T3 indexer pipeline only. */
  get depgraph(): DepGraph {
    if (this.overrides.depgraph) return this.overrides.depgraph;
    this._depgraph ??= new DepCruiseGraph();
    return this._depgraph;
  }

  /**
   * The process-wide token counter (js-tiktoken). Two consumers: the repo-map
   * budget search, and `modules/brief`'s 8 000-token input ladder.
   *
   * One instance for the process, and `TiktokenTokenizer`'s fallback to
   * `ceil(chars / 4)` is STICKY per instance — a process whose BPE load failed
   * counts differently for the rest of its life. The brief hashes what it
   * counted, so that shows up as a brief which will not stop reading stale.
   */
  get tokenizer(): Tokenizer {
    if (this.overrides.tokenizer) return this.overrides.tokenizer;
    this._tokenizer ??= new TiktokenTokenizer();
    return this._tokenizer;
  }

  /**
   * Live OpenRouter pricing for cost attribution. The lister builds a bare
   * OpenRouter provider just for `/models` (no estimator needed) and degrades to
   * `[]` when no key is configured; the static `estimateCost` table is the
   * fallback for OpenAI/Anthropic and a cold/cold-failed cache.
   */
  get priceBook(): PriceBook {
    this._priceBook ??= new PriceBook(async () => {
      try {
        const key = await this.secrets.get('OPENROUTER_API_KEY');
        if (!key) return [];
        return await new OpenRouterProvider(key).listModels();
      } catch {
        return [];
      }
    }, estimateCost);
    return this._priceBook;
  }

  async github(): Promise<GitHubClient> {
    if (this.overrides.github) return this.overrides.github;
    if (this._github) return this._github;
    const token = await this.secrets.get('GITHUB_TOKEN');
    if (!token) throw new ConfigError('GITHUB_TOKEN is not configured');
    this._github = new OctokitGitHubClient(token);
    return this._github;
  }

  /** Resolve an LLM provider by id; constructs from the secret key, cached. */
  async llm(id: 'openai' | 'anthropic' | 'openrouter'): Promise<LLMProvider> {
    const injected = this.overrides.llm?.[id];
    if (injected) return injected;
    const cached = this.llmCache.get(id);
    if (cached) return cached;
    const provider = await this.buildLlm(id);
    this.llmCache.set(id, provider);
    return provider;
  }

  private async buildLlm(id: 'openai' | 'anthropic' | 'openrouter'): Promise<LLMProvider> {
    if (id === 'openai') {
      const key = await this.secrets.get('OPENAI_API_KEY');
      if (!key) throw new ConfigError('OPENAI_API_KEY is not configured');
      return new OpenAIProvider(key);
    }
    if (id === 'openrouter') {
      // Single OpenRouter provider lives in reviewer-core (shared with the CI
      // runner); inject the PriceBook so cost attribution uses LIVE OpenRouter
      // prices (with the static table as a fallback) rather than a hardcoded one.
      const key = await this.secrets.get('OPENROUTER_API_KEY');
      if (!key) throw new ConfigError('OPENROUTER_API_KEY is not configured');
      return new OpenRouterProvider(key, {
        // PER-ATTEMPT, and it must stay well under the shortest wall-clock budget
        // a caller passes as `req.timeoutMs` (60 s today: intent, the brief).
        // The library default is 90 s, which is LONGER than that budget — so a
        // stalled attempt could never be retried inside it, and one stall meant
        // certain failure instead of a fast second try.
        //
        // Measured against `deepseek-v4-flash` on this workload: a healthy call
        // is ~14 s, while two stalled ones took 126 s and >60 s. 30 s is twice
        // the healthy figure, so it does not cut a working call short, and it
        // leaves room for one retry inside a 60 s budget.
        timeoutMs: OPENROUTER_ATTEMPT_TIMEOUT_MS,
        estimateCost: (model, tokensIn, tokensOut) =>
          this.priceBook.estimate(model, tokensIn, tokensOut),
      });
    }
    const key = await this.secrets.get('ANTHROPIC_API_KEY');
    if (!key) throw new ConfigError('ANTHROPIC_API_KEY is not configured');
    return new AnthropicProvider(key);
  }

  async embedder(): Promise<Embedder> {
    // Injected embedders (tests) always win. Otherwise embeddings are gated by
    // config: when disabled we throw BEFORE constructing the OpenAI client, so
    // the app makes ZERO OpenAI requests. All callers wrap this in try/catch and
    // degrade gracefully (memory/RAG simply returns no hits).
    if (this.overrides.embedder) return this.overrides.embedder;
    if (!this.config.embeddingsEnabled) {
      throw new ConfigError('Embeddings are disabled (set EMBEDDINGS_ENABLED=true to enable memory/RAG)');
    }
    if (this._embedder) return this._embedder;
    const openai = await this.llm('openai');
    this._embedder = new OpenAIEmbedder(openai);
    return this._embedder;
  }

  /**
   * Drop cached provider clients so the next resolve picks up changed secrets.
   * Call after persisting a new API key/PAT via SecretsProvider.set.
   */
  invalidateSecretCaches(): void {
    this.llmCache.clear();
    this._github = undefined;
    this._embedder = undefined;
  }
}
